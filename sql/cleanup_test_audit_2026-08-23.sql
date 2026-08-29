-- Cleanup for the freshness verification run against PRODUCTION, 2026-08-23.
--
-- What the run did (docs/data-architecture/02-query-standards.md rule 12,
-- verified live): swapped one September-2025 match result, watched an open tab
-- pick it up with no reload, restored it, then proved every one of the six
-- bundle-backed tables bumps site_meta.data_version in the cloud.
--
-- All league data is ALREADY BACK to its original values — this file removes
-- only the audit trail the test left behind. Nothing here is required: the rows
-- are honest history of real writes, they carry batch_id = NULL so the admin's
-- Historical Changes view (which lists batches) never shows them, and deleting
-- them is purely a matter of taste. Run it only if you want the log clean.
--
-- Everything below is scoped to changed_by = 'claude-demo@example.com' AND a
-- 5-minute window, so it cannot reach a real edit even if that account is later
-- used by a person.

-- ---------------------------------------------------------------------------
-- 1. Review first — expect exactly 8 rows, all batch_id NULL.
--    2 tables × 2 (swap + restore) + 4 self-assigning writes that changed
--    no value and existed only to observe the version counter move.
-- ---------------------------------------------------------------------------
select id, table_name, row_pk, action, batch_id, changed_at
  from public.audit_log
 where changed_by = 'claude-demo@example.com'
   and changed_at between '2026-08-23T18:44:00Z' and '2026-08-23T18:49:00Z'
 order by id;

-- ---------------------------------------------------------------------------
-- 2. Keep a copy before deleting anything.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log_backup_2026_08_23 as
select * from public.audit_log
 where changed_by = 'claude-demo@example.com'
   and changed_at between '2026-08-23T18:44:00Z' and '2026-08-23T18:49:00Z';

-- ---------------------------------------------------------------------------
-- 3. Delete. The batch_id IS NULL clause is a third guard: any write made
--    through the admin UI carries a batch, so this can only ever match the
--    direct REST writes the test made.
-- ---------------------------------------------------------------------------
delete from public.audit_log
 where changed_by = 'claude-demo@example.com'
   and changed_at between '2026-08-23T18:44:00Z' and '2026-08-23T18:49:00Z'
   and batch_id is null;

-- ---------------------------------------------------------------------------
-- 4. Verify — expect 0.
-- ---------------------------------------------------------------------------
select count(*) as remaining
  from public.audit_log
 where changed_by = 'claude-demo@example.com'
   and changed_at between '2026-08-23T18:44:00Z' and '2026-08-23T18:49:00Z';

-- ---------------------------------------------------------------------------
-- NOT cleanable, stated for the record: matches.updated_at for row 2980 now
-- reads 2026-08-23T18:48:52Z instead of its original 2026-08-01T22:12:44.996919Z.
-- The set_updated_at() BEFORE-UPDATE trigger overwrites that column with now()
-- on every write, so there is no UPDATE that can put the old value back. It is
-- row-modification metadata, stripped from get_site_bundle() and read by no
-- page — the score, PR, luck, round and match_history.updated_at (the column
-- that IS domain data) are all exactly as they were.
-- ---------------------------------------------------------------------------
