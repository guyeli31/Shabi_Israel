-- audit_batching_for_automation.sql
--
-- Makes automated runs (the External Source sync, which connects with the
-- service_role key and has no auth.email()) appear in Historical Changes and in
-- the DB version tree exactly like an admin publish does.
--
-- WHY THEY WERE MISSING
--   Historical Changes reads public.audit_batch_summary, which is
--     FROM audit_batches b LEFT JOIN audit_log a ON a.batch_id = b.id
--   so ONLY rows carrying a batch_id are ever shown. An admin publish batches
--   its rows (stagingStore.publishAll calls current_max_audit_id() before the
--   unit and finalize_publish_batch() after it). scripts/sync-source.js never
--   called either — so every sync wrote its matches/match_history/leagues rows
--   with batch_id NULL, i.e. invisible to the view. The rows were always in
--   audit_log; nothing was lost, they just had no batch to be grouped under.
--
--   The sync could not have called them anyway: both RPCs are granted to
--   `authenticated` only, and the sync authenticates as service_role.
--
-- WHAT THIS DOES
--   1. Grants the two batching RPCs to service_role (dbc_snapshot already had it).
--   2. Teaches finalize_publish_batch to accept an explicit actor, so a
--      service_role caller can label its batch (e.g. 'external-source-automation')
--      instead of inheriting a NULL auth.email(). Default argument keeps every
--      existing authenticated call site working unchanged.
--   3. Backfills existing unbatched rows into synthetic batches, one per
--      (actor, table, second), so past automation runs become visible too.
--
-- Idempotent. Safe to re-run.

begin;

-- ── 1 + 2. finalize_publish_batch with an optional explicit actor ────────────
-- Same body as sql/audit_batching.sql, plus p_actor. Claiming rows is still
-- scoped to that actor, so two callers can never steal each other's rows.
--
-- The 2-arg version MUST go first: a defaulted third parameter would otherwise
-- make finalize_publish_batch(jsonb, bigint) ambiguous ("function name is not
-- unique") and break every existing admin call site.
drop function if exists public.finalize_publish_batch(jsonb, bigint);

create or replace function public.finalize_publish_batch(
    p_intent   jsonb,
    p_after_id bigint,
    p_actor    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  who text := coalesce(p_actor, auth.email(), 'external-source-automation');
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

revoke all on function public.finalize_publish_batch(jsonb, bigint, text) from public;
grant execute on function public.finalize_publish_batch(jsonb, bigint, text) to authenticated;
grant execute on function public.current_max_audit_id() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.finalize_publish_batch(jsonb, bigint, text) to service_role;
    grant execute on function public.current_max_audit_id() to service_role;
    grant execute on function public.finalize_player_batches(bigint) to service_role;
  end if;
end $$;

-- ── 3. Backfill: adopt the orphaned rows into synthetic batches ──────────────
-- Grouped by (actor, table, whole second) so one sync run collapses to a handful
-- of rows rather than one per changed match. Ghost/no-op rows are pulled in with
-- their siblings; audit_batch_summary already filters those from display.
do $$
declare
  g   record;
  bid uuid;
begin
  for g in
    select changed_by,
           table_name,
           date_trunc('second', changed_at) as sec,
           min(coalesce(new_value ->> 'league_id', old_value ->> 'league_id',
                        new_value ->> 'id',        old_value ->> 'id')) as subject,
           count(*)                   as n,
           bool_or(action = 'INSERT')  as has_insert,
           bool_or(action = 'DELETE')  as has_delete
    from public.audit_log
    where batch_id is null
    group by changed_by, table_name, date_trunc('second', changed_at)
    order by 3
  loop
    insert into public.audit_batches (changed_by, changed_at, topic, subject, specific, icon, detail)
    values (
      g.changed_by,
      g.sec,
      case g.table_name
        when 'players_metadata' then 'player'
        when 'landing_settings' then 'settings'
        else 'league'
      end,
      g.subject,
      case g.table_name
        when 'matches'          then case when g.has_delete then 'Match removed' else 'Match data updated' end
        when 'match_history'    then 'Match history updated'
        when 'manual_overrides' then case when g.has_insert then 'Override added' else 'Override updated' end
        when 'leagues'          then 'Settings updated'
        when 'players_metadata' then 'Details updated'
        when 'landing_settings' then 'Landing page updated'
        else 'Updated'
      end,
      case g.table_name
        when 'matches'          then '📊'
        when 'match_history'    then '🕘'
        when 'manual_overrides' then '⚖️'
        when 'leagues'          then '⚙️'
        when 'players_metadata' then '👤'
        when 'landing_settings' then '🏠'
        else '•'
      end,
      g.n || ' row' || case when g.n = 1 then '' else 's' end || ' (backfilled)'
    )
    returning id into bid;

    update public.audit_log a
       set batch_id = bid
     where a.batch_id is null
       and a.changed_by  = g.changed_by
       and a.table_name  = g.table_name
       and date_trunc('second', a.changed_at) = g.sec;
  end loop;

  -- Any synthetic batch that ended up claiming nothing is removed again.
  delete from public.audit_batches b
   where b.detail like '%(backfilled)'
     and not exists (select 1 from public.audit_log a where a.batch_id = b.id);
end $$;

commit;

select count(*) filter (where batch_id is null) as still_unbatched,
       count(*)                                 as audit_rows
from public.audit_log;
