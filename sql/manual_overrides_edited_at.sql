-- manual_overrides_edited_at.sql — add the admin-authored edit date column.
--
-- Idempotent: safe to run repeatedly, on the cloud and on local Docker. Run this
-- on any existing database; new databases get the column from supabase_schema.sql.
--
-- WHY: the round editor lets an admin pick the date a result was decided, staged
-- into manual_overrides.json as `timestamp`. That date had nowhere to live in the
-- database — syncOverrides dropped it — so the reconcile stamped match_history's
-- updated_at with the RUN time instead. updated_at then read as "last sync ran"
-- rather than "result last changed", which is the same category error that the
-- dropped set_updated_at trigger caused on match_history. This column gives the
-- authored date a home; the reconcile prefers it over now(), and mapDbOverride
-- surfaces it back to the round editor so F3 shows it after publish too.

alter table public.manual_overrides
  add column if not exists edited_at timestamptz;

comment on column public.manual_overrides.edited_at is
  'Admin-authored date the result was decided (round editor date picker). Feeds match_history.updated_at. Distinct from updated_at (row mtime).';
