-- ============================================================================
-- initial_history_point.sql — companion to the "Initial" history point
--
-- WHAT THE FEATURE NEEDS FROM THE DATABASE: nothing. Read this first.
--
-- Every league's timeline is derived from match_history.updated_at. The oldest
-- point that table can express is the FIRST BATCH OF RESULTS — and for a league
-- imported in one go, that batch IS the finished league. So the empty league,
-- before a single match was played, was simply unreachable in the Historical
-- view and in What-If's "Run from" picker.
--
-- "Initial" is therefore SYNTHESISED client-side (js/compute/matchHistory.js →
-- INITIAL_POINT, offered by buildSnapshotOptions in js/render/dashboardPage.js).
-- It resolves to an empty match set. It applies to every league automatically,
-- past and future, with no migration and no rows to keep in step. Inserting
-- placeholder rows to represent "no matches" would be inventing matches that
-- never existed — and match_history is an audited, restorable table.
--
-- WHAT THIS SCRIPT IS FOR: the label. The Initial option reads
--     "Initial, 1 Jul 2026 — no matches played"
-- when the league knows when it started, and falls back to a bare
--     "Initial — no matches played"
-- when leagues.issue_date is null. Section 2 fills that gap in the cloud so
-- every league shows the dated version.
--
-- Safe to run repeatedly. Section 1 only reads.
-- ============================================================================

-- ── 1. Inspect: what will each league's Initial option say? ─────────────────
-- dated = the label carries a date. first_result / last_result show the real
-- span of play, so you can sanity-check a suspicious issue_date before fixing it.
select
    l.id                                          as league,
    l.issue_date,
    min(h.updated_at)                             as first_result,
    max(h.updated_at)                             as last_result,
    count(distinct to_char(h.updated_at,
          'YYYY-MM-DD HH24:MI'))                  as update_points,
    count(h.*)                                    as history_rows,
    (l.issue_date is not null)                    as dated
from public.leagues l
left join public.match_history h on h.league_id = l.id
group by l.id, l.issue_date
order by l.issue_date desc nulls last, l.id;

-- ── 2. Backfill the missing issue dates ─────────────────────────────────────
-- Only touches leagues with NO issue_date at all: an admin-entered date is
-- domain data and is never overwritten. The date used is the day the league's
-- first result was recorded — the closest thing the data has to "it started".
-- Leagues with no results yet are left alone (nothing to infer from); their
-- Initial option keeps the undated label until an issue date is entered in
-- Admin → Leagues → Edit.
update public.leagues l
   set issue_date = sub.first_day
  from (
        select league_id, min(updated_at)::date as first_day
          from public.match_history
         group by league_id
       ) sub
 where sub.league_id = l.id
   and l.issue_date is null;

-- ── 3. Verify ───────────────────────────────────────────────────────────────
select count(*) filter (where issue_date is null) as leagues_still_undated,
       count(*)                                   as leagues_total
  from public.leagues;
