-- ============================================================================
-- cleanup_test_analytics_2026-08-18.sql
-- Remove the analytics rows created by performance testing against PRODUCTION
-- on 2026-08-18. NOT applied — run it yourself, step by step, after reviewing.
-- ============================================================================
--
-- What happened: the page-transition harness (scripts/perf/measure-transitions.mjs)
-- and the admin harness (scripts/perf/measure-admin-views.mjs) were pointed at
-- golan.me.uk to capture "before" numbers. Both drive a real browser, so every
-- page they opened fired a real analytics beacon. Each harness run also uses a
-- FRESH browser profile per measurement, so each one registered as its own
-- visit — which is why the session count is the giveaway.
--
-- Two windows, and they need different treatment.
--
--   Window A — public pages, logged OUT.   10:25–11:01 UTC (13:25–14:01 Israel)
--     151 pageviews / 103 sessions / 36 clicks / 46 transitions.
--     Of those, exactly ONE row carries admin_user: the tail of your own admin
--     session from earlier that morning. Everything else in the window is the
--     harness. The `admin_user is null` guard below is what keeps your row.
--
--   Window C — the admin walkthrough, logged IN as the demo account.
--     12:50–13:10 UTC (15:50–16:10 Israel). 1 pageview / 20 clicks, every one
--     of them stamped admin_user = 'claude-demo@example.com'. That account is
--     used only for automated checks, so this one is exact — no time window
--     even strictly needed.
--
-- Deliberately NOT touched:
--   • anything before 10:24:19 UTC — your own admin session (13 pageviews)
--   • anything after 13:10 UTC — real browsing (league "July 2026", player
--     "Hummus"; the harness never requested either)
--   • analytics.html itself never emits events (it does not load analytics.js),
--     so the dashboard visits made while investigating cost nothing.
--
-- ── Confidence note, stated plainly ────────────────────────────────────────
-- Window A is bounded by TIME, not by a marker, because the harness left none.
-- 103 sessions inside 36 minutes is not organic — but if a genuine visitor
-- browsed in that window, their rows would go too. Step 1 shows you the
-- breakdown first; the harness's own fingerprints are easy to spot there (see
-- the note under it).
--
-- ── The device guard, and why it is in every statement below ───────────────
-- Every harness run drove a DESKTOP browser. Playwright's mobile emulation
-- lives behind a separate MCP server that was never pointed at production, so
-- the harness cannot have produced a single mobile or tablet row. Verified
-- against the live data, not assumed:
--
--   window A     151 pageviews — 151 desktop, 0 mobile, 0 tablet
--   window C       1 pageview  —   1 desktop, 0 mobile, 0 tablet
--   whole day    176 pageviews — 172 desktop, 4 mobile (1 session)
--
-- So the day's only mobile visitor sits entirely OUTSIDE both windows, and
-- `device_type = 'desktop'` therefore deletes no fewer rows than without it.
-- It is here anyway: it costs nothing and turns "a phone visitor in that window
-- would have been caught" from a risk into an impossibility. A guard that
-- changes no rows today but forecloses a whole class of mistake is worth its
-- line.
-- ============================================================================


-- ── STEP 1 — REVIEW. Changes nothing. Run this first. ───────────────────────
select
    case
        when created_at >= timestamptz '2026-08-18 10:25:00+00'
         and created_at <  timestamptz '2026-08-18 11:01:00+00' then 'A · public-page harness'
        when created_at >= timestamptz '2026-08-18 12:50:00+00'
         and created_at <  timestamptz '2026-08-18 13:10:00+00' then 'C · admin harness'
    end                                    as window,
    event_type,
    page,
    league_id,
    player,
    admin_user,
    count(*)                               as rows,
    count(distinct session_id)             as sessions,
    min(created_at)                        as first_seen,
    max(created_at)                        as last_seen
from public.analytics_events
where (created_at >= timestamptz '2026-08-18 10:25:00+00'
       and created_at < timestamptz '2026-08-18 11:01:00+00'
       and admin_user is null
       and device_type = 'desktop')
   or (created_at >= timestamptz '2026-08-18 12:50:00+00'
       and created_at < timestamptz '2026-08-18 13:10:00+00'
       and admin_user = 'claude-demo@example.com'
       and device_type = 'desktop')
group by 1, 2, 3, 4, 5, 6
order by 1, 7 desc;

-- Two fingerprints that prove the window-A rows are the harness, not visitors:
--
--   league_id = 'Shabi Israel June 2026'   (~15 rows)
--   player    = 'Idan1986'                 (~5 rows)
--
-- That league id has not existed since the rename to month-year names. Nothing
-- on the live site links to it any more — the only thing that still asked for
-- it was the harness's stale hardcoded target, which is exactly the bug that
-- sent this whole exercise back to the drawing board. A real visitor in August
-- 2026 could not have produced those rows.
--
-- The rest of window A is the same harness under its corrected target:
-- league "August 2026" / player "GuyEliyahu", one or two pageviews per session.


-- ── STEP 2 — optional backup, so this is reversible ─────────────────────────
-- Keeps a copy of every row about to be deleted. Drop the table once you are
-- satisfied. Costs nothing to run and turns a DELETE into something you can
-- undo, which for a table with no other backup is worth the ten seconds.
create table if not exists public.analytics_events_backup_20260818 as
select * from public.analytics_events
where (created_at >= timestamptz '2026-08-18 10:25:00+00'
       and created_at < timestamptz '2026-08-18 11:01:00+00'
       and admin_user is null
       and device_type = 'desktop')
   or (created_at >= timestamptz '2026-08-18 12:50:00+00'
       and created_at < timestamptz '2026-08-18 13:10:00+00'
       and admin_user = 'claude-demo@example.com'
       and device_type = 'desktop');

-- Restore, if it ever comes to that:
--   insert into public.analytics_events
--   overriding system value
--   select * from public.analytics_events_backup_20260818;


-- ── STEP 3 — DELETE window C (the admin walkthrough). Exact, zero risk. ─────
-- Scoped by the account rather than by the clock: 'claude-demo@example.com' is
-- the automation account, so any row it ever produced is test traffic.
delete from public.analytics_events
where created_at >= timestamptz '2026-08-18 12:50:00+00'
  and created_at <  timestamptz '2026-08-18 13:10:00+00'
  and admin_user = 'claude-demo@example.com'
  and device_type = 'desktop';
-- expected: 21 rows (1 pageview + 20 clicks)


-- ── STEP 4 — DELETE window A (the public-page harness) ──────────────────────
-- `admin_user is null` is load-bearing: it is what spares the one row in this
-- window that belongs to your own admin session.
delete from public.analytics_events
where created_at >= timestamptz '2026-08-18 10:25:00+00'
  and created_at <  timestamptz '2026-08-18 11:01:00+00'
  and admin_user is null
  and device_type = 'desktop';
-- expected: ~230 rows (150 pageviews + 36 clicks + 45 transitions/durations)


-- ── STEP 5 — verify ────────────────────────────────────────────────────────
select
    date_trunc('hour', created_at at time zone 'Asia/Jerusalem') as hour_israel,
    count(*) filter (where event_type = 'pageview')              as pageviews,
    count(distinct session_id)                                   as sessions,
    -- Should still show 4 mobile pageviews for the day: that visitor is real,
    -- sits outside both windows, and is the check that nothing over-reached.
    count(*) filter (where event_type = 'pageview'
                       and device_type <> 'desktop')             as non_desktop_pageviews
from public.analytics_events
where created_at >= timestamptz '2026-08-18 00:00:00+00'
  and created_at <  timestamptz '2026-08-19 00:00:00+00'
group by 1
order by 1;

-- The 13:00 Israel row should drop from ~147 pageviews / ~103 sessions to a
-- handful. If any hour still shows dozens of sessions, something was missed.


-- ── Cleanup, once you are happy ────────────────────────────────────────────
-- drop table public.analytics_events_backup_20260818;
