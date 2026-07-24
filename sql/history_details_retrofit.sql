-- ============================================================================
-- history_details_retrofit.sql — per-PLAYER Historical batches
-- ============================================================================
-- Companion to sql/audit_batching.sql. Two parts, both SAFE and RE-RUNNABLE:
--
--   1. finalize_player_batches(bigint) — the forward-path RPC (identical to
--      audit_batching.sql §6a-bis). A players_metadata publish now becomes ONE
--      Historical batch PER edited player, mirroring the per-player rows the
--      Pending list already shows. CREATE OR REPLACE → idempotent.
--
--   2. One-time RETRO split — existing batches that lumped several players into
--      a single "Details updated" row are broken apart into one batch per
--      player, each headlined with that player's own name. Only pure
--      players_metadata batches with >= 2 players are touched; "Reverted…"
--      batches are left intact to preserve their wording. Re-running is a no-op
--      once every such batch is already single-player.
--
-- NOTE: the plain-English Details text (describeFieldChange / describeEntitySummary)
-- is client-side JS and needs NO SQL — it re-renders existing history on reload.
-- This file only concerns the per-player *batching*.
--
-- Run once per environment (same script for Docker-local and cloud):
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/history_details_retrofit.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Forward-path RPC (idempotent; safe even if audit_batching.sql already ran)
-- ----------------------------------------------------------------------------
create or replace function public.finalize_player_batches(p_after_id bigint)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce(auth.email(), 'external-source-automation');
  r record;
  new_id uuid;
  n int := 0;
begin
  for r in
    select row_pk,
           bool_or(action = 'INSERT') as any_insert,
           bool_or(action = 'DELETE') as any_delete
      from public.audit_log
     where id > p_after_id
       and batch_id is null
       and changed_by = who
       and table_name = 'players_metadata'
       and not public.audit_is_noop(action, table_name, old_value, new_value)
     group by row_pk
  loop
    insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
    values (who, 'player', r.row_pk,
            case when r.any_insert then 'Created'
                 when r.any_delete then 'Removed'
                 else 'Details updated' end,
            case when r.any_insert then '🆕'
                 when r.any_delete then '🗑️'
                 else '📝' end,
            null)
    returning id into new_id;

    update public.audit_log
       set batch_id = new_id
     where id > p_after_id and batch_id is null and changed_by = who
       and table_name = 'players_metadata' and row_pk = r.row_pk;

    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.finalize_player_batches(bigint) from public;
grant execute on function public.finalize_player_batches(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. RETRO: split existing multi-player batches into one batch per player.
--    A candidate = a batch whose rows are ALL players_metadata and that spans
--    >= 2 distinct players. Each player gets a fresh batch that inherits the
--    original's actor + timestamp; the now-empty original is dropped.
-- ----------------------------------------------------------------------------
do $$
declare
  b record;
  p record;
  nb uuid;
begin
  for b in
    select bt.id, bt.changed_by, bt.changed_at
      from public.audit_batches bt
     where exists (select 1 from public.audit_log a where a.batch_id = bt.id)
       and not exists (select 1 from public.audit_log a
                        where a.batch_id = bt.id and a.table_name <> 'players_metadata')
       and (select count(distinct a.row_pk) from public.audit_log a where a.batch_id = bt.id) >= 2
       and coalesce(bt.specific, '') not like 'Reverted%'
  loop
    for p in
      select row_pk,
             bool_or(action = 'INSERT') as any_insert,
             bool_or(action = 'DELETE') as any_delete
        from public.audit_log
       where batch_id = b.id
       group by row_pk
    loop
      insert into public.audit_batches (changed_by, changed_at, topic, subject, specific, icon, detail)
      values (b.changed_by, b.changed_at, 'player', p.row_pk,
              case when p.any_insert then 'Created'
                   when p.any_delete then 'Removed'
                   else 'Details updated' end,
              case when p.any_insert then '🆕'
                   when p.any_delete then '🗑️'
                   else '📝' end,
              null)
      returning id into nb;

      update public.audit_log set batch_id = nb
       where batch_id = b.id and row_pk = p.row_pk;
    end loop;

    -- Original is empty now → remove it.
    delete from public.audit_batches
     where id = b.id
       and not exists (select 1 from public.audit_log a where a.batch_id = b.id);
  end loop;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- 3. Report: no pure players_metadata batch should span >1 player after this.
-- ----------------------------------------------------------------------------
select count(*) as remaining_multi_player_batches
  from public.audit_batches bt
 where exists (select 1 from public.audit_log a where a.batch_id = bt.id)
   and not exists (select 1 from public.audit_log a
                    where a.batch_id = bt.id and a.table_name <> 'players_metadata')
   and (select count(distinct a.row_pk) from public.audit_log a where a.batch_id = bt.id) >= 2
   and coalesce(bt.specific, '') not like 'Reverted%';
