-- match_time_precision.sql — tell a match's DAY apart from a match's MOMENT.
--
-- THE PROBLEM
-- `match_history.updated_at` holds two different kinds of value that look
-- identical in the column:
--
--   • a real instant — "this result was recorded at 16:49" (every league from
--     July 2026 on, plus every mail report, which carries its own played_at)
--   • a placeholder — "we know the day, not the time" (the ten pre-Supabase
--     leagues, whose rows were all stamped at their league's opening midnight)
--
-- The first must be rendered in the VIEWER's timezone; the second must not be
-- rendered in a timezone at all. A placeholder pushed through a timezone
-- conversion moves: `2025-10-01T00:00:00Z` reads "1 Oct 2025" in Israel and
-- "30 Sept 2025, 20:00" in New York — the league appears to have opened the
-- month before.
--
-- WHICH IT IS CANNOT BE INFERRED FROM THE VALUE. A match genuinely played at
-- midnight is indistinguishable from a placeholder, and "is this midnight?" has
-- no single answer anyway — 2025-10-01T00:00:00Z is midnight in UTC, 03:00 in
-- Israel and 20:00 the previous day in New York. Hence an explicit column.
--
-- THE SET IS CLOSED. Nothing from here on creates a placeholder: the sync
-- stamps the moment it read the result, mail carries played_at, and the Round
-- Editor now defaults to the current Israel time. So this is a one-time mark on
-- 3,186 existing rows, not an ongoing mechanism.
--
-- Run in the Supabase SQL Editor (cloud), then again on local Docker. Section 1
-- is a dry run. Idempotent: re-running changes nothing.
--
-- THEN RE-RUN sql/mail_sync.sql. Its apply_mail_report() upserts match_history
-- and had to learn to state has_exact_time on the DO UPDATE half — an upsert
-- that omits a column leaves the stored value alone, so a re-applied report
-- would take a real played_at while keeping a `false` that no longer describes
-- it. The browser's own write path (js/data/matchHistoryReconcile.js) states it
-- for the same reason.

-- ============================================================================
-- 1. DRY RUN — what will be marked
-- ============================================================================
-- (a) The pre-Supabase leagues: every row stamped at 00:00:00 UTC on the 1st.
select league_id,
       count(*)                          as rows,
       min(updated_at)                   as stamp
from public.match_history
where (updated_at at time zone 'UTC')::time = '00:00:00'
  and extract(day from updated_at at time zone 'UTC') = 1
group by league_id
order by min(updated_at);

-- (b) June 2026 Regular: 210 rows sharing ONE instant — a single bulk import
--     run on 2 Sept 2026, months after the league itself. Not 210 match times.
select league_id, updated_at, count(*) as rows
from public.match_history
where league_id = 'June 2026 Regular'
group by league_id, updated_at
order by updated_at;

-- (c) What stays a real instant — sanity check. Expect the July 2026+ leagues,
--     each with MANY distinct instants (one per sync run / mail report).
select league_id,
       count(*)                    as rows,
       count(distinct updated_at)  as distinct_instants
from public.match_history
where not ((updated_at at time zone 'UTC')::time = '00:00:00'
           and extract(day from updated_at at time zone 'UTC') = 1)
  and league_id <> 'June 2026 Regular'
group by league_id
order by league_id;

-- ============================================================================
-- 2. THE COLUMN
-- ============================================================================
alter table public.match_history
  add column if not exists has_exact_time boolean not null default true;

comment on column public.match_history.has_exact_time is
  'false = updated_at carries a DAY, not a moment: render it without any '
  'timezone conversion (the stored value is that day at 00:00:00 UTC). '
  'true = a real instant, render it in the viewer''s timezone. Defaults to '
  'true because every row written from now on has a real time — see '
  'sql/match_time_precision.sql. Flipping a row to true (once its real match '
  'time is known) is all that is needed to move it to relative display.';

-- ============================================================================
-- 3. THE WRITE
-- ============================================================================
begin;

-- Both statements below touch thousands of rows, and match_history carries the
-- per-row audit trigger — unsuppressed they would dump 3,186 UPDATE rows into
-- audit_log and bury Historical Changes. Same transaction-local flag
-- rename_league() uses; one clean summary row is logged at the end instead.
-- (The per-STATEMENT projection triggers still fire, which is what we want:
--  June 2026 Regular's timeline really does change.)
select set_config('app.suppress_audit', 'true', true);

-- (a) June 2026 Regular FIRST: move its 210 rows onto the league's own opening
--     day, so it matches the ten leagues of the same era. The date is taken
--     from the league row, never typed in — issue_date is the site's one
--     authority on which day a league opened (js/utils/helpers.js).
--     After this it satisfies rule (b) below, which is the point: one rule
--     ends up describing every placeholder in the table.
update public.match_history h
set    updated_at = (l.issue_date::timestamp at time zone 'UTC')
from   public.leagues l
where  l.id = h.league_id
  and  h.league_id = 'June 2026 Regular'
  and  l.issue_date is not null
  and  h.updated_at <> (l.issue_date::timestamp at time zone 'UTC');

-- (b) Mark every placeholder. One condition, because of (a).
update public.match_history
set    has_exact_time = false
where  (updated_at at time zone 'UTC')::time = '00:00:00'
  and  extract(day from updated_at at time zone 'UTC') = 1
  and  has_exact_time;   -- idempotent: already-marked rows are not rewritten

-- The one audit row standing for the whole migration.
insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
values ('match_history', 'match_time_precision', 'UPDATE',
        jsonb_build_object('has_exact_time', 'absent'),
        jsonb_build_object('has_exact_time', 'placeholders marked false'),
        coalesce(auth.email(), 'migration'));

commit;

-- ============================================================================
-- 4. VERIFY
-- ============================================================================
-- Expect: 3,186 placeholder rows (2,976 + 210), the rest exact.
select has_exact_time, count(*) as rows
from public.match_history
group by has_exact_time
order by has_exact_time;

-- Per league. A league should be wholly one or wholly the other; a league that
-- appears on BOTH sides is worth a look before you trust the display.
select league_id,
       count(*) filter (where not has_exact_time) as placeholder_rows,
       count(*) filter (where has_exact_time)     as exact_rows,
       min(updated_at) filter (where not has_exact_time) as placeholder_stamp
from public.match_history
group by league_id
order by min(updated_at);

-- Every placeholder must sit exactly on its own league's opening day. A row
-- here means the placeholder would render as a day the league was not open.
select h.league_id, l.issue_date, h.updated_at, count(*) as rows
from public.match_history h
join public.leagues l on l.id = h.league_id
where not h.has_exact_time
  and h.updated_at <> (l.issue_date::timestamp at time zone 'UTC')
group by h.league_id, l.issue_date, h.updated_at;
