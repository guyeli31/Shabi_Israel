-- ============================================================================
-- audit_batching.sql — group audit_log rows into logical "batches"
-- ============================================================================
-- One Publish-to-Site (or one automation sync) fans out into many audit_log
-- rows: the real edit, its valid derived rows (match_history reconcile,
-- last_updated bump), and — under the pre-delta write path — a flock of no-op
-- "ghost" UPDATEs (old == new). This migration lets the Historical view show
-- ONE row per logical change, with the valid derived rows tucked under a
-- details toggle and the ghosts filtered out.
--
-- It is SAFE and RE-RUNNABLE:
--   • additive schema (audit_batches table + audit_log.batch_id column)
--   • backfill only touches rows whose batch_id is still NULL
--   • no audit_log row is deleted (the optional prune at the very end is
--     commented out — opt in explicitly)
--
-- Run once per environment (same script for Docker-local and cloud):
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/audit_batching.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
--
-- Companion to sql/supabase_schema.sql (log_audit_event trigger).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Schema: batch table + link column
-- ----------------------------------------------------------------------------
create table if not exists public.audit_batches (
    id          uuid primary key default gen_random_uuid(),
    changed_by  text,
    changed_at  timestamptz not null default now(),
    topic       text,   -- 'league' | 'player' | 'settings' (TOPIC_META key)
    subject     text,   -- which league / player / setting
    specific    text,   -- specific-change wording (e.g. 'Override edited')
    icon        text,   -- secondary (specific-change) icon
    detail      text    -- trailing detail (e.g. 'A vs B (result)')
);

alter table public.audit_log
    add column if not exists batch_id uuid references public.audit_batches(id) on delete set null;

create index if not exists idx_audit_batch on public.audit_log (batch_id);

-- ----------------------------------------------------------------------------
-- 2. Shared classifiers (used by the backfill here AND the Historical view)
-- ----------------------------------------------------------------------------

-- A "ghost": an UPDATE that changed nothing real. updated_at is row-mtime
-- noise everywhere; last_updated is an automatic publish stamp on leagues.
create or replace function public.audit_is_noop(p_action text, p_table text, p_old jsonb, p_new jsonb)
returns boolean language sql immutable as $$
    select p_action = 'UPDATE' and p_old is not null and p_new is not null
      and case
            when p_table = 'leagues'
              then (p_old - 'updated_at' - 'last_updated') = (p_new - 'updated_at' - 'last_updated')
            else (p_old - 'updated_at') = (p_new - 'updated_at')
          end;
$$;

-- Map one audit row to the change it would headline AS IF it were the primary.
-- topic/subject/specific/icon mirror js/admin/render/changeVocabulary.js exactly.
-- `rank` picks the batch headline: higher = more "intent". match_history is a
-- reconcile output (never edited by a human) → lowest rank, always a derived row.
create or replace function public.audit_row_intent(p_table text, p_action text, p_old jsonb, p_new jsonb)
returns table(topic text, subject text, specific text, icon text, detail text, rank int)
language plpgsql immutable as $$
declare v jsonb := coalesce(p_new, p_old);
begin
    if p_table = 'leagues' then
        if p_action = 'INSERT' then
            return query select 'league', v->>'id', 'Created', '🆕', null::text, 100;
        elsif p_action = 'DELETE' then
            return query select 'league', v->>'id', 'Deleted', '🗑️', null::text, 100;
        elsif (p_old->'external_source_sync') is distinct from (p_new->'external_source_sync')
           or (p_old->'source_league_name') is distinct from (p_new->'source_league_name') then
            return query select 'settings', v->>'id', 'Auto-sync updated', '🔄', null::text, 60;
        elsif (p_old->'custom_flags')    is distinct from (p_new->'custom_flags')
           or (p_old->'retired_players') is distinct from (p_new->'retired_players') then
            return query select 'league', v->>'id', 'Players updated', '🚩', null::text, 80;
        else
            return query select 'league', v->>'id', 'Settings updated', '⚙️', null::text, 80;
        end if;
    elsif p_table = 'matches' then
        if p_action = 'DELETE' then
            return query select 'league', v->>'league_id', 'Match removed', '📊', (v->>'player_a')||' vs '||(v->>'player_b'), 70;
        else
            return query select 'league', v->>'league_id', 'Match data updated', '📊', (v->>'player_a')||' vs '||(v->>'player_b'), 70;
        end if;
    elsif p_table = 'manual_overrides' then
        if p_action = 'INSERT' then
            return query select 'league', v->>'league_id', 'Override added', '⚖️', (v->>'player_a')||' vs '||(v->>'player_b'), 75;
        elsif p_action = 'DELETE' then
            return query select 'league', v->>'league_id', 'Override removed', '➖', (v->>'player_a')||' vs '||(v->>'player_b'), 75;
        else
            return query select 'league', v->>'league_id', 'Override edited', '✏️', (v->>'player_a')||' vs '||(v->>'player_b'), 75;
        end if;
    elsif p_table = 'players_metadata' then
        if p_action = 'INSERT' then
            return query select 'player', v->>'id', 'Created', '🆕', null::text, 80;
        elsif p_action = 'DELETE' then
            return query select 'player', v->>'id', 'Removed', '🗑️', null::text, 80;
        else
            return query select 'player', v->>'id', 'Details updated', '📝', null::text, 80;
        end if;
    elsif p_table = 'landing_settings' then
        return query select 'settings', 'Landing page', 'Landing updated', '🏠', null::text, 50;
    elsif p_table = 'match_history' then
        return query select 'league', v->>'league_id', 'Match history updated', '🕘', (v->>'player_a')||' vs '||(v->>'player_b'), 10;
    else
        return query select 'settings', p_table, coalesce(p_action, 'changed'), '📄', null::text, 5;
    end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Backfill: cluster existing rows into batches by (changed_by, gap <= 3s).
--    The gap distribution is sharply bimodal (within-publish <= 1s, between
--    publishes >= 5s), so 3s reconstructs logical publishes cleanly.
-- ----------------------------------------------------------------------------

-- 3a. Assign a time-island AND a subject to each still-unbatched row. A batch =
--     (changed_by, island, subject) — so a single automation run that touched X
--     leagues splits into X per-league batches, not one lump. Subject keeps a
--     league's own fan-out (matches + overrides + match_history + leagues bump)
--     together, while players_metadata / landing stay grouped (not per-row) so a
--     bulk import doesn't fragment into hundreds of tiny rows.
create temp table _island on commit drop as
with base as (
    select id, changed_by, changed_at, table_name, action, old_value, new_value,
        case
            when table_name = 'leagues' then coalesce(new_value->>'id', old_value->>'id')
            when table_name in ('matches','manual_overrides','match_history')
                then coalesce(new_value->>'league_id', old_value->>'league_id')
            when table_name = 'players_metadata' then 'players'
            when table_name = 'landing_settings' then 'landing'
            else table_name
        end as subj
    from public.audit_log
    where batch_id is null
),
ordered as (
    select *,
        case when lag(changed_at) over w is null
               or extract(epoch from (changed_at - lag(changed_at) over w)) > 3
             then 1 else 0 end as is_new
    from base
    window w as (partition by changed_by order by changed_at, id)
)
select id, changed_by, changed_at, table_name, action, old_value, new_value, subj,
       sum(is_new) over (partition by changed_by order by changed_at, id) as grp
from ordered;

-- 3b. One pre-generated batch id per (island, subject).
create temp table _batchmap on commit drop as
select changed_by, grp, subj, gen_random_uuid() as batch_id, min(changed_at) as batch_at
from _island
group by changed_by, grp, subj;

-- 3c. Pick each batch's headline: highest-rank NON-ghost row (ties → lowest id).
create temp table _headline on commit drop as
with cand as (
    select i.changed_by, i.grp, i.subj, i.id, ai.topic, ai.subject, ai.specific, ai.icon, ai.detail, ai.rank
    from _island i
    cross join lateral public.audit_row_intent(i.table_name, i.action, i.old_value, i.new_value) ai
    where not public.audit_is_noop(i.action, i.table_name, i.old_value, i.new_value)
),
ranked as (
    select *, row_number() over (partition by changed_by, grp, subj order by rank desc, id asc) as rn
    from cand
)
select changed_by, grp, subj, topic, subject, specific, icon, detail from ranked where rn = 1;

-- 3d. Create the batch rows (batches with only ghosts get a 'Housekeeping' label).
insert into public.audit_batches (id, changed_by, changed_at, topic, subject, specific, icon, detail)
select m.batch_id, m.changed_by, m.batch_at,
       coalesce(h.topic, 'settings'), h.subject,
       coalesce(h.specific, 'Housekeeping'), coalesce(h.icon, '🧹'), h.detail
from _batchmap m
left join _headline h on h.changed_by = m.changed_by and h.grp = m.grp and h.subj = m.subj;

-- 3e. Link every audit row to its batch.
update public.audit_log a
set batch_id = m.batch_id
from _island i
join _batchmap m on m.changed_by = i.changed_by and m.grp = i.grp and m.subj = i.subj
where a.id = i.id;

commit;

-- ----------------------------------------------------------------------------
-- 4. Report
-- ----------------------------------------------------------------------------
select
    (select count(*) from public.audit_batches)                          as batches,
    (select count(*) from public.audit_log where batch_id is not null)   as rows_batched,
    (select count(*) from public.audit_log
       where public.audit_is_noop(action, table_name, old_value, new_value)) as ghost_rows;

-- ----------------------------------------------------------------------------
-- 5. Trigger seed: let a mutation carry a batch_id from a transaction-local GUC.
--    log_audit_event() already exists in sql/supabase_schema.sql; this re-defines
--    it identically PLUS reading app.batch_id, so grouped writes (a Publish, or a
--    grouped Undo below) stamp all their rows into one batch. Unset GUC → NULL
--    batch_id (unchanged behaviour for un-grouped writes).
-- ----------------------------------------------------------------------------
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pk_value text;
begin
  if coalesce(current_setting('app.suppress_audit', true), '') = 'true' then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  pk_value := case
    when TG_OP = 'DELETE' then (to_jsonb(old)->>'id')
    else (to_jsonb(new)->>'id')
  end;

  insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by, batch_id)
  values (
    TG_TABLE_NAME,
    pk_value,
    TG_OP,
    case when TG_OP != 'INSERT' then to_jsonb(old) else null end,
    case when TG_OP != 'DELETE' then to_jsonb(new) else null end,
    coalesce(auth.email(), 'external-source-automation'),
    nullif(current_setting('app.batch_id', true), '')::uuid
  );

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grouped Undo / Undo+Remove for a whole batch (Historical view buttons).
--    Both revert EVERY row of the batch in reverse insertion order, in one
--    transaction, so the DB returns to exactly its pre-publish state. Ghost
--    rows revert to a harmless no-op. Mirrors restore_audit_row /
--    restore_and_delete_audit_row (sql/supabase_schema.sql) but batch-scoped.
-- ----------------------------------------------------------------------------

-- Undo: revert the batch, and log the reverts as ONE new "Reverted…" batch
-- (so the history still shows that it happened, as a single tidy row).
create or replace function public.restore_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.audit_batches%rowtype;
  new_batch uuid;
  r record;
begin
  select * into src from public.audit_batches where id = p_batch_id;
  if not found then
    raise exception 'audit_batch % not found', p_batch_id;
  end if;

  -- New batch that the revert-writes will group under.
  insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
  values (coalesce(auth.email(), 'unknown'), src.topic, src.subject,
          'Reverted: ' || coalesce(src.specific, 'change'), '↩️', src.detail)
  returning id into new_batch;

  perform set_config('app.batch_id', new_batch::text, true);

  for r in select id from public.audit_log where batch_id = p_batch_id order by id desc loop
    perform public.restore_audit_row(r.id);
  end loop;
end;
$$;

revoke all on function public.restore_batch(uuid) from public;
grant execute on function public.restore_batch(uuid) to authenticated;

-- Undo + Remove: revert silently (no new audit rows) and purge the batch and
-- all its rows from history — the whole change vanishes as if never made.
create or replace function public.restore_and_delete_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform set_config('app.suppress_audit', 'true', true);
  for r in select id from public.audit_log where batch_id = p_batch_id order by id desc loop
    perform public.restore_audit_row(r.id);
  end loop;
  delete from public.audit_log where batch_id = p_batch_id;
  delete from public.audit_batches where id = p_batch_id;
end;
$$;

revoke all on function public.restore_and_delete_batch(uuid) from public;
grant execute on function public.restore_and_delete_batch(uuid) to authenticated;

-- Let authenticated read the batch headlines (same policy shape as audit_log).
alter table public.audit_batches enable row level security;
drop policy if exists audit_batches_authenticated_select on public.audit_batches;
create policy audit_batches_authenticated_select on public.audit_batches for select to authenticated using (true);
grant select on public.audit_batches to authenticated;

-- ----------------------------------------------------------------------------
-- 6a. Live batching for a Publish-to-Site. publishAll() makes many separate
--     PostgREST calls (pooled connections), so a session GUC can't span them.
--     Instead: snapshot the audit high-water mark before publishing, then after
--     all writes tag every new row of this user into one batch in a single RPC.
-- ----------------------------------------------------------------------------
create or replace function public.current_max_audit_id()
returns bigint language sql security definer set search_path = public as $$
    select coalesce(max(id), 0) from public.audit_log;
$$;
revoke all on function public.current_max_audit_id() from public;
grant execute on function public.current_max_audit_id() to authenticated;

-- p_intent carries the primary staged change's headline (topic/subject/specific/
-- icon/detail), computed client-side from the same CATEGORY_TAXONOMY the Pending
-- list uses — so a live batch reads identically to its Pending row. Rows created
-- since p_after_id by this user (and not already batched) become its members.
-- If no rows were produced (e.g. a storage-only photo change), the empty batch
-- is dropped so it never shows as a phantom entry.
create or replace function public.finalize_publish_batch(p_intent jsonb, p_after_id bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  who text := coalesce(auth.email(), 'external-source-automation');
  n int;
begin
  insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
  values (who, p_intent->>'topic', p_intent->>'subject', p_intent->>'specific',
          p_intent->>'icon', p_intent->>'detail')
  returning id into new_id;

  update public.audit_log
     set batch_id = new_id
   where id > p_after_id and batch_id is null and changed_by = who;
  get diagnostics n = row_count;

  if n = 0 then
    delete from public.audit_batches where id = new_id;
    return null;
  end if;
  return new_id;
end;
$$;
revoke all on function public.finalize_publish_batch(jsonb, bigint) from public;
grant execute on function public.finalize_publish_batch(jsonb, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 6b. Cheap per-batch summary for the Historical list (counts without hauling
--     every row to the client). Details rows are fetched lazily on expand.
--     security_invoker so the caller's RLS on audit_log/audit_batches applies.
-- ----------------------------------------------------------------------------
drop view if exists public.audit_batch_summary;
create view public.audit_batch_summary
with (security_invoker = true) as
select b.id, b.changed_by, b.changed_at, b.topic, b.subject, b.specific, b.icon, b.detail,
       count(a.*) as total_rows,
       count(*) filter (where public.audit_is_noop(a.action, a.table_name, a.old_value, a.new_value)) as ghost_rows,
       -- primary = real edits on the table the admin touched; derived = reconcile
       -- output (match_history), shown as attachments, not counted as the action.
       count(*) filter (where not public.audit_is_noop(a.action, a.table_name, a.old_value, a.new_value)
                          and a.table_name <> 'match_history') as primary_rows,
       count(*) filter (where not public.audit_is_noop(a.action, a.table_name, a.old_value, a.new_value)
                          and a.table_name =  'match_history') as derived_rows
from public.audit_batches b
left join public.audit_log a on a.batch_id = b.id
group by b.id;

grant select on public.audit_batch_summary to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Prune ghost rows for good. Ghosts are old == new: zero information, safe to
--    hard-delete. The write paths (admin + automation) no longer create them, so
--    this is a one-time cleanup of history written before those fixes. Runs on
--    every migration re-run (a no-op once none remain).
-- ----------------------------------------------------------------------------
delete from public.audit_log
 where public.audit_is_noop(action, table_name, old_value, new_value);

-- Drop any batch left with no rows after the prune (was all-ghost "Housekeeping").
delete from public.audit_batches b
 where not exists (select 1 from public.audit_log a where a.batch_id = b.id);

select
    (select count(*) from public.audit_log)                              as audit_rows_remaining,
    (select count(*) from public.audit_log
       where public.audit_is_noop(action, table_name, old_value, new_value)) as ghosts_left,
    (select count(*) from public.audit_batches)                          as batches_remaining;
