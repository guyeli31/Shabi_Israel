-- ============================================================================
-- backfill_match_history_dates.sql
--
-- `match_history.updated_at` is the only per-match date the app has. Matches
-- that were played before the database was connected have no `match_history`
-- row at all, so they read as dateless ("—"), drop out of the year filter, and
-- sink to the bottom of the cross-league Matches table regardless of when they
-- were actually played. This affects whole legacy leagues AND the older part of
-- a league that was only partway through when the sync was first switched on.
--
-- This script gives every such pairing a history row stamped at its league's
-- start date (`leagues.issue_date`) — the best date available for a match whose
-- own date was never recorded.
--
-- Scope: PAIRINGS THAT HAVE NO HISTORY ROW, in leagues that have an issue_date.
-- Existing history rows are never read for their values and never updated —
-- their dates are real data.
--
-- It mirrors js/data/matchHistoryReconcile.js exactly, so a later sync/publish
-- sees the new rows as unchanged and LEAVES THE DATES ALONE:
--   pass 1  every played `matches` row            → source 'csv'
--   pass 2  `manual_overrides` win over pass 1    → source 'manual'
--           - result         → the override's scores/PR/luck
--           - technical_win  → 1–0 / 0–1, no PR, no luck
--           - technical_draw → 0–0, no PR, no luck
--           - not_played     → NO row at all (the pairing never happened)
-- Skipping pass 2 would let the raw CSV numbers override every technical result
-- on read, because mergeHistoryIntoMatches() lets history win.
--
-- Pairings are matched on an ORDER-INDEPENDENT key (least/greatest), since an
-- override may store the two players in the opposite order from `matches`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Dry run. How many undated pairings per league, and what date would
--          they get? Leagues with no issue_date are reported and then SKIPPED.
-- ----------------------------------------------------------------------------
select
    l.id,
    l.league_type,
    l.issue_date,
    count(*) filter (where m.played)                                    as played_matches,
    count(*) filter (
        where m.played
          and not exists (
              select 1 from public.match_history h
              where h.league_id = l.id
                and least(h.player_a, h.player_b)    = least(m.player_a, m.player_b)
                and greatest(h.player_a, h.player_b) = greatest(m.player_a, m.player_b)
          )
    )                                                                   as undated_pairings,
    case when l.issue_date is null then 'SKIPPED — no issue_date' else 'will backfill' end as action
from public.leagues l
left join public.matches m on m.league_id = l.id
group by l.id, l.league_type, l.issue_date
order by l.issue_date nulls first, l.id;


-- ----------------------------------------------------------------------------
-- STEP 2 — The backfill. Runs in a transaction: inspect the counts at the
--          bottom, then COMMIT or ROLLBACK.
--
--          Every inserted id is recorded in `match_history_backfill_log` so the
--          UNDO at the bottom is exact rather than heuristic.
--
--          set_config('app.suppress_audit', ...) keeps this bulk load out of
--          audit_log — see log_audit_event() in sql/supabase_schema.sql. It is
--          transaction-local (third arg = true), so it lifts on commit/rollback.
--          Drop that line if you WANT the backfill audited.
-- ----------------------------------------------------------------------------
create table if not exists public.match_history_backfill_log (
    history_id  bigint primary key,
    league_id   text        not null,
    stamped_at  timestamptz not null,
    inserted_at timestamptz not null default now()
);

begin;

select set_config('app.suppress_audit', 'true', true);

with target as (
    select l.id, l.issue_date::timestamptz as stamp
    from public.leagues l
    where l.issue_date is not null
),
-- Pairings that already carry a real date — left completely alone.
dated as (
    select h.league_id,
           least(h.player_a, h.player_b)    as k1,
           greatest(h.player_a, h.player_b) as k2
    from public.match_history h
),
csv_rows as (
    select m.league_id, m.player_a, m.player_b,
           m.score_a, m.score_b, m.pr_a, m.pr_b, m.luck_a, m.luck_b,
           m.round, 'csv'::text as source, t.stamp,
           least(m.player_a, m.player_b)    as k1,
           greatest(m.player_a, m.player_b) as k2
    from public.matches m
    join target t on t.id = m.league_id
    where m.played
      and not exists (
          select 1 from dated d
          where d.league_id = m.league_id
            and d.k1 = least(m.player_a, m.player_b)
            and d.k2 = greatest(m.player_a, m.player_b)
      )
),
ovr as (
    select o.*, t.stamp as league_stamp,
           least(o.player_a, o.player_b)    as k1,
           greatest(o.player_a, o.player_b) as k2
    from public.manual_overrides o
    join target t on t.id = o.league_id
    where not exists (
        select 1 from dated d
        where d.league_id = o.league_id
          and d.k1 = least(o.player_a, o.player_b)
          and d.k2 = greatest(o.player_a, o.player_b)
    )
),
ovr_rows as (
    select o.league_id, o.player_a, o.player_b,
           case o.type
               when 'result'         then o.score_a
               when 'technical_win'  then (case when o.winner = o.player_a then 1 else 0 end)::numeric
               when 'technical_draw' then 0::numeric
           end as score_a,
           case o.type
               when 'result'         then o.score_b
               when 'technical_win'  then (case when o.winner = o.player_a then 0 else 1 end)::numeric
               when 'technical_draw' then 0::numeric
           end as score_b,
           case when o.type = 'result' then o.pr_a   end as pr_a,
           case when o.type = 'result' then o.pr_b   end as pr_b,
           case when o.type = 'result' then o.luck_a end as luck_a,
           case when o.type = 'result' then o.luck_b end as luck_b,
           (select c.round from csv_rows c
             where c.league_id = o.league_id and c.k1 = o.k1 and c.k2 = o.k2) as round,
           'manual'::text as source,
           -- The admin-authored edit date wins when present (it is real domain
           -- data); otherwise the league's start date, same as every other row.
           coalesce(o.edited_at, o.league_stamp) as stamp,
           o.k1, o.k2
    from ovr o
    where o.type <> 'not_played'
),
final as (
    select league_id, player_a, player_b, score_a, score_b,
           pr_a, pr_b, luck_a, luck_b, round, source, stamp
    from ovr_rows
    union all
    select c.league_id, c.player_a, c.player_b, c.score_a, c.score_b,
           c.pr_a, c.pr_b, c.luck_a, c.luck_b, c.round, c.source, c.stamp
    from csv_rows c
    where not exists (
        select 1 from ovr o
        where o.league_id = c.league_id and o.k1 = c.k1 and o.k2 = c.k2
    )
),
inserted as (
    insert into public.match_history
        (league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, source, updated_at)
    select
        league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, source, stamp
    from final
    on conflict (league_id, player_a, player_b) do nothing
    returning id, league_id, updated_at
)
insert into public.match_history_backfill_log (history_id, league_id, stamped_at)
select id, league_id, updated_at from inserted;

-- Inspect what landed before committing.
select league_id, count(*) as backfilled, min(stamped_at)::date as stamped
from public.match_history_backfill_log
group by league_id
order by league_id;

commit;
-- rollback;   -- use this instead if the numbers above look wrong


-- ----------------------------------------------------------------------------
-- STEP 3 — Verify: no played pairing should be left without a history row.
--          Expect zero rows (other than leagues with no issue_date).
-- ----------------------------------------------------------------------------
select l.id, l.issue_date, count(*) as still_undated
from public.leagues l
join public.matches m on m.league_id = l.id and m.played
where not exists (
    select 1 from public.match_history h
    where h.league_id = l.id
      and least(h.player_a, h.player_b)    = least(m.player_a, m.player_b)
      and greatest(h.player_a, h.player_b) = greatest(m.player_a, m.player_b)
)
group by l.id, l.issue_date
order by l.id;


-- ----------------------------------------------------------------------------
-- UNDO — exact: removes only the rows this script inserted, by id. Safe even
--        after a later sync has added other rows. (A sync that MODIFIED one of
--        these rows would have redated it — that is real data now, so review the
--        log against match_history.updated_at first if any time has passed.)
-- ----------------------------------------------------------------------------
-- begin;
-- select set_config('app.suppress_audit', 'true', true);
-- delete from public.match_history h
--  using public.match_history_backfill_log b
--  where b.history_id = h.id;
-- delete from public.match_history_backfill_log;
-- commit;
