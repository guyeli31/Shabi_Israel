-- ============================================================================
-- audit_soft_purge.sql — make "Undo + remove" (✕) archive instead of hard-delete
-- ============================================================================
-- Until now the ✕ button ran a bare `delete from audit_log`, so the change's
-- old_value/new_value were gone for good: no SQL on the live DB could bring
-- them back, only a PITR/backup restore. This migration keeps the button's
-- user-facing behaviour identical (the batch disappears from Historical
-- Changes and can never be shown there again) while moving the rows into
-- archive tables that no page reads, so a mistaken ✕ stays recoverable.
--
-- It is SAFE and RE-RUNNABLE:
--   • additive schema (two _purged tables), no existing table altered
--   • only redefines functions (create or replace)
--   • archives nothing retroactively — rows already hard-deleted before this
--     migration ran are still gone; this only changes future purges
--
-- Run once per environment (same script for Docker-local and cloud):
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/audit_soft_purge.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
--
-- Companion to sql/supabase_schema.sql + sql/audit_batching.sql. Run AFTER both.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Archive tables
-- ----------------------------------------------------------------------------
-- `like ... including defaults` copies the column list, types and NOT NULLs but
-- deliberately NOT the identity property of audit_log.id — the archive must
-- store each row's ORIGINAL id verbatim, never generate a new one.
create table if not exists public.audit_log_purged (
    like public.audit_log including defaults,
    purged_at timestamptz not null default now(),
    purged_by text
);

create table if not exists public.audit_batches_purged (
    like public.audit_batches including defaults,
    purged_at timestamptz not null default now(),
    purged_by text
);

create index if not exists idx_audit_purged_batch on public.audit_log_purged (batch_id);
create index if not exists idx_audit_purged_at    on public.audit_log_purged (purged_at desc);

-- Deny-all from the client. The whole point of ✕ is that the change is no
-- longer visible in the app; leaving these readable to `authenticated` would
-- hand it straight back. Reachable only via service_role / the SQL editor.
alter table public.audit_log_purged     enable row level security;
alter table public.audit_batches_purged enable row level security;
revoke all on public.audit_log_purged     from anon, authenticated;
revoke all on public.audit_batches_purged from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Shared archiver — one place that knows how to move rows out of history.
--    Columns are listed explicitly (not `a.*`) so a future column added to
--    audit_log fails loudly here instead of silently landing in the wrong slot.
-- ----------------------------------------------------------------------------
create or replace function public.archive_audit_rows(p_batch_id uuid, p_log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce(auth.email(), 'unknown');
begin
  insert into public.audit_log_purged (
      id, table_name, row_pk, action, old_value, new_value,
      changed_at, changed_by, batch_id, purged_at, purged_by)
  select a.id, a.table_name, a.row_pk, a.action, a.old_value, a.new_value,
         a.changed_at, a.changed_by, a.batch_id, now(), who
    from public.audit_log a
   where (p_batch_id is not null and a.batch_id = p_batch_id)
      or (p_log_id   is not null and a.id       = p_log_id);

  if p_batch_id is not null then
    insert into public.audit_batches_purged (
        id, changed_by, changed_at, topic, subject, specific, icon, detail,
        purged_at, purged_by)
    select b.id, b.changed_by, b.changed_at, b.topic, b.subject, b.specific,
           b.icon, b.detail, now(), who
      from public.audit_batches b
     where b.id = p_batch_id;
  end if;
end;
$$;

revoke all on function public.archive_audit_rows(uuid, bigint) from public;

-- ----------------------------------------------------------------------------
-- 3. Redefine the two purge RPCs to archive before deleting.
--    Behaviour is otherwise byte-for-byte what sql/audit_batching.sql and
--    sql/supabase_schema.sql defined: revert silently (app.suppress_audit), in
--    reverse insertion order, in one transaction.
-- ----------------------------------------------------------------------------
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

  perform public.archive_audit_rows(p_batch_id, null);

  delete from public.audit_log     where batch_id = p_batch_id;
  delete from public.audit_batches where id = p_batch_id;
end;
$$;

revoke all on function public.restore_and_delete_batch(uuid) from public;
grant execute on function public.restore_and_delete_batch(uuid) to authenticated;

-- Single-row variant (no longer wired to a button, kept for parity/API use).
-- Only the row itself is archived; its batch row is left alone, exactly as
-- before — this function never managed batches.
create or replace function public.restore_and_delete_audit_row(log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.suppress_audit', 'true', true);
  perform public.restore_audit_row(log_id);
  perform public.archive_audit_rows(null, log_id);
  delete from public.audit_log where id = log_id;
end;
$$;

revoke all on function public.restore_and_delete_audit_row(bigint) from public;
grant execute on function public.restore_and_delete_audit_row(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The escape hatch: put a purged batch back into history.
--    NOT granted to `authenticated` — this is a deliberate admin/DBA action run
--    from the SQL editor, not a button. It only restores the HISTORY ROWS; the
--    data itself was already reverted by the ✕ and stays reverted. To also undo
--    that revert, re-apply the batch's new_value rows afterwards (they are all
--    back in audit_log at that point).
-- ----------------------------------------------------------------------------
create or replace function public.unpurge_batch(p_batch_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- Batch first: audit_log.batch_id has an FK onto it.
  insert into public.audit_batches (id, changed_by, changed_at, topic, subject, specific, icon, detail)
  select id, changed_by, changed_at, topic, subject, specific, icon, detail
    from public.audit_batches_purged where id = p_batch_id
  on conflict (id) do nothing;

  -- `overriding system value` so each row keeps its original identity id,
  -- the same technique restore_audit_row() uses to undo a DELETE.
  insert into public.audit_log (id, table_name, row_pk, action, old_value, new_value,
                                changed_at, changed_by, batch_id)
  overriding system value
  select id, table_name, row_pk, action, old_value, new_value,
         changed_at, changed_by, batch_id
    from public.audit_log_purged where batch_id = p_batch_id
  on conflict (id) do nothing;
  get diagnostics n = row_count;

  -- The archive holds only what is currently purged, so drop what came back.
  delete from public.audit_log_purged     where batch_id = p_batch_id;
  delete from public.audit_batches_purged where id       = p_batch_id;

  return n;
end;
$$;

revoke all on function public.unpurge_batch(uuid) from public;

commit;

-- ----------------------------------------------------------------------------
-- 5. Report
-- ----------------------------------------------------------------------------
select
    (select count(*) from public.audit_log)                as audit_rows_live,
    (select count(*) from public.audit_log_purged)         as audit_rows_archived,
    (select count(*) from public.audit_batches)            as batches_live,
    (select count(*) from public.audit_batches_purged)     as batches_archived;

-- ----------------------------------------------------------------------------
-- 6. Browsing the archive (run by hand in the SQL editor)
-- ----------------------------------------------------------------------------
-- What was removed from history, newest first:
--
--   select b.purged_at, b.purged_by, b.changed_at, b.changed_by,
--          b.topic, b.subject, b.specific, b.detail,
--          (select count(*) from public.audit_log_purged a where a.batch_id = b.id) as rows
--     from public.audit_batches_purged b
--    order by b.purged_at desc;
--
-- Put one back:   select public.unpurge_batch('<batch-uuid>');

-- ----------------------------------------------------------------------------
-- 7. OPTIONAL retention prune — opt in explicitly by uncommenting. Archived
--    rows carry full old_value/new_value jsonb, so the table grows with every
--    ✕; at the current volume that is negligible, but this caps it.
-- ----------------------------------------------------------------------------
-- delete from public.audit_log_purged     where purged_at < now() - interval '1 year';
-- delete from public.audit_batches_purged where purged_at < now() - interval '1 year';
