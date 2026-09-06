-- Shabi Israel — backfill leagues.last_updated for the pre-Supabase era.
--
-- Every league up to and including JUNE 2026 ran before the site moved its read
-- path to Supabase, so nothing ever stamped `leagues.last_updated` for them and
-- the UI shows no "Last Updated". This gives each of them a deterministic,
-- honest-looking value: the LAST MINUTE OF ITS OWN MONTH, Israel wall-clock
-- (e.g. April 2026 → 2026-04-30 23:59 Asia/Jerusalem).
--
-- Which month a league belongs to comes from `issue_date` — the same rule the
-- site itself uses (see leagueLeaderboardSlot() in js/utils/helpers.js: the
-- NAME is not a reliable date, `created_at` is a row-creation timestamp). Only
-- when `issue_date` is null do we fall back to parsing "<Month> <Year>" out of
-- the id, which is the naming scheme every league has carried since
-- sql/rename_leagues_to_month_year.sql.
--
-- IDEMPOTENT: touches only rows where last_updated IS NULL, so a league that
-- already has a real timestamp (any post-Supabase league, or one fixed by hand)
-- is never overwritten. Re-running is a no-op.
--
-- Run in the Supabase SQL Editor (cloud). Section 1 is a dry run — read it
-- first, then run section 2.

-- ============================================================================
-- 0. The month → "last minute of that month, Israel time" mapping, in one place
-- ============================================================================
-- Reused by all three sections below.
create or replace view public.v_last_updated_backfill as
select
  l.id,
  l.league_type,
  l.running,
  l.hidden,
  l.issue_date,
  m.month,
  ((date_trunc('month', m.month::timestamp)
      + interval '1 month'
      - interval '1 minute') at time zone 'Asia/Jerusalem') as proposed_last_updated
from public.leagues l
cross join lateral (
  select coalesce(
    l.issue_date,
    -- fallback: "<Month> <Year>" anywhere in the id ("July 2026 Regular" too)
    to_date(substring(l.id from '([A-Z][a-z]+ [0-9]{4})'), 'FMMonth YYYY')
  ) as month
) m
where l.last_updated is null
  and m.month is not null
  and m.month < date '2026-07-01';   -- everything up to and including June 2026

-- ============================================================================
-- 1. DRY RUN — review before writing anything
-- ============================================================================
select id,
       league_type,
       issue_date,
       to_char(month, 'YYYY-MM')                          as resolved_month,
       proposed_last_updated,
       to_char(proposed_last_updated at time zone 'Asia/Jerusalem',
               'YYYY-MM-DD HH24:MI')                      as israel_wall_clock
from public.v_last_updated_backfill
order by month, id;

-- Leagues DELIBERATELY skipped — glance at this list too. A row here with a
-- null month is a league whose id carries no month AND has no issue_date; it
-- needs a hand-picked value rather than a guess.
select l.id,
       l.league_type,
       l.issue_date,
       l.last_updated,
       case
         when l.last_updated is not null then 'already stamped'
         when coalesce(l.issue_date,
                       to_date(substring(l.id from '([A-Z][a-z]+ [0-9]{4})'),
                               'FMMonth YYYY')) is null   then 'NO MONTH — needs manual value'
         else 'July 2026 or later'
       end as skip_reason
from public.leagues l
where l.id not in (select id from public.v_last_updated_backfill)
order by l.issue_date nulls first, l.id;

-- ============================================================================
-- 2. THE WRITE
-- ============================================================================
begin;

update public.leagues l
set    last_updated = b.proposed_last_updated
from   public.v_last_updated_backfill b
where  b.id = l.id
  and  l.last_updated is null;   -- belt-and-braces; the view already filters

-- Expect: one row per pre-July-2026 league that had no stamp.
-- If the count looks wrong, ROLLBACK instead of COMMIT.
commit;

-- ============================================================================
-- 3. VERIFY
-- ============================================================================
select id,
       league_type,
       issue_date,
       to_char(last_updated at time zone 'Asia/Jerusalem',
               'YYYY-MM-DD HH24:MI') as israel_wall_clock,
       last_updated
from public.leagues
where issue_date < date '2026-07-01'
   or id ~ '(January|February|March|April|May|June) 20[0-9]{2}'
order by issue_date nulls last, id;

-- Anything still missing a stamp:
select id, league_type, issue_date
from public.leagues
where last_updated is null
order by id;

-- ============================================================================
-- 4. CLEANUP — the view was scaffolding, not schema
-- ============================================================================
drop view public.v_last_updated_backfill;
