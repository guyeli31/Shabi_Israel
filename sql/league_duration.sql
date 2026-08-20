-- ============================================================================
-- leagues.duration_mode / duration_days — how long a league runs
-- ============================================================================
-- Until now every league was assumed to run for the calendar month its
-- issue_date falls in. That assumption lived only in the dashboard's League
-- Progress card, so a league that ran for two weeks, or ran open-endedly, had
-- no way to say so and was measured against a month it never had.
--
-- Three modes, matching js/compute/leagueDuration.js (the one client-side
-- definition of a league's window):
--
--   'month'      the CALENDAR MONTH the issue date falls in — the league runs
--                from its issue date to the LAST DAY of that month. So it is a
--                month-long league only when it opens on the 1st: issued
--                21 Feb 2026 it runs 8 days (21→28 Feb), issued 31 Aug it runs
--                a single day. This is the default and the mode every existing
--                league gets, which is exactly how they were already being
--                measured, so nothing moves.
--   'days'       duration_days days counted from the start day, inclusive.
--   'unlimited'  no end date at all. The Days progress bar is not shown.
--
-- duration_days is meaningful ONLY in 'days' mode; the CHECK below makes that a
-- database rule rather than a client convention, so a stale count can never
-- linger behind a mode that doesn't use it.
--
-- The read path needs no change: get_site_bundle() ships each league row via
-- to_jsonb(l), so the new columns flow through on their own.
--
-- Additive and idempotent — safe to re-run. Apply to BOTH the cloud project and
-- the local Docker instance.
-- ============================================================================

-- 1) The columns. The default is what makes this migration a no-op for every
--    league that already exists: they all come out on 'month', which is exactly
--    how they were being measured before.
alter table public.leagues
    add column if not exists duration_mode text not null default 'month';

alter table public.leagues
    add column if not exists duration_days int;

comment on column public.leagues.duration_mode is
    'How long the league runs: month (to the last day of the calendar month the '
    'issue date falls in) | days (duration_days from the start day) | unlimited '
    '(no end date).';
comment on column public.leagues.duration_days is
    'Length in days, counted inclusively from issue_date. Set only when duration_mode = ''days''.';

-- 2) Any row that predates the column and somehow holds NULL/'' lands on the
--    default too. (A no-op on a fresh apply — the DEFAULT already covered it.)
update public.leagues
   set duration_mode = 'month'
 where duration_mode is null or duration_mode = '';

-- 3) A count belongs to 'days' mode alone; clear leftovers before constraining.
update public.leagues
   set duration_days = null
 where duration_mode <> 'days'
   and duration_days is not null;

-- 4) Enforce both halves: a legal mode, and the mode↔count pairing.
alter table public.leagues
    drop constraint if exists leagues_duration_mode_valid;
alter table public.leagues
    add constraint leagues_duration_mode_valid
    check (duration_mode in ('month', 'days', 'unlimited'));

alter table public.leagues
    drop constraint if exists leagues_duration_days_pairing;
alter table public.leagues
    add constraint leagues_duration_days_pairing
    check (
        (duration_mode = 'days' and duration_days is not null and duration_days > 0)
        or (duration_mode <> 'days' and duration_days is null)
    );

-- 5) Verify: every league, its mode, and the window that mode produces.
--    `ends` is computed here the same way leagueDuration.js computes it — a
--    month runs to the last day of the month it STARTED in; days run inclusively
--    from the start; unlimited has no end. `runs_days` is the inclusive length,
--    which for month mode is shorter the later in the month the league opened.
with w as (
    select
        id,
        issue_date,
        duration_mode,
        duration_days,
        case
            when issue_date is null      then null
            when duration_mode = 'month' then (date_trunc('month', issue_date) + interval '1 month' - interval '1 day')::date
            when duration_mode = 'days'  then (issue_date + (duration_days - 1))::date
            else null
        end as ends
    from public.leagues
)
select id as league, issue_date as starts, duration_mode, duration_days, ends,
       case when ends is null then null else (ends - issue_date) + 1 end as runs_days
from w
order by issue_date desc nulls last, id;
