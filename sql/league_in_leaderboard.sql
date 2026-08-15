-- ============================================================================
-- leagues.in_leaderboard — per-league opt-in to the Annual Leaderboards
-- ============================================================================
-- Not every league belongs in its year's leaderboard (one-off / exhibition /
-- side events would distort the annual standings), so inclusion is now an
-- explicit per-league flag instead of "every league that exists".
--
-- The leaderboard groups leagues into MONTH COLUMNS, and the month is taken
-- from issue_date ALONE — never parsed out of the league name, which carries
-- no reliable date (ids like "Summer Cup" exist, and "July 2026" was stored
-- with issue_date 2026-06-01, i.e. the name can be plain wrong). A league with
-- no issue_date therefore has no column to sit in and CANNOT be included; the
-- CHECK constraint below makes that a database rule, not a UI convention.
--
-- Additive and idempotent — safe to re-run. Apply to BOTH the cloud project
-- and the local Docker instance.
-- ============================================================================

-- 1) Data fix: "July 2026" was issued 2026-06-01, one month before its own
--    name. Under the date-only rule it would land in the June column, colliding
--    with the real "June 2026" league.
update public.leagues
   set issue_date = date '2026-07-01'
 where id = 'July 2026'
   and issue_date = date '2026-06-01';

-- 2) The flag itself. Defaults to true so every existing league keeps showing
--    up exactly as it does today; step 3 then switches off the ones that
--    cannot legally be on.
alter table public.leagues
    add column if not exists in_leaderboard boolean not null default true;

comment on column public.leagues.in_leaderboard is
    'Include this league in its year''s Annual Leaderboard. Requires issue_date '
    '(the leaderboard month comes from issue_date alone, never from the league name).';

-- 3) A league with no issue_date has no month, so it cannot be included.
update public.leagues
   set in_leaderboard = false
 where issue_date is null
   and in_leaderboard;

-- 4) Enforce it. Written as NOT (in_leaderboard AND issue_date IS NULL) so the
--    other three combinations stay legal: a dated league may be excluded, and
--    an undated league is simply always excluded.
alter table public.leagues
    drop constraint if exists leagues_in_leaderboard_needs_date;
alter table public.leagues
    add constraint leagues_in_leaderboard_needs_date
    check (not (in_leaderboard and issue_date is null));
