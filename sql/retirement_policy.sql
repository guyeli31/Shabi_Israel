-- ============================================================================
-- retirement_policy.sql — one way to record a retired player.
--
-- Spec: docs/RETIREMENT-POLICY.md
--
-- ── WHAT THIS CHANGES ──────────────────────────────────────────────────────
-- Retirement was entered four different ways while the project was finding its
-- feet, and the four disagree about what the data means:
--
--   1. `technical_win` overrides, fixture kept          April, February, most of December
--   2. `technical_win` overrides, fixture DELETED       December 2025 (21 of them)
--   3. rows typed straight into match_history, no
--      override behind them at all                      July 2026 (23)
--   4. a real result, later overwritten by one of
--      the above                                        December (3), July (1)
--
-- and one league — July 2026 Regular / Meir65 — is a retirement nobody flagged:
-- 19 fixtures, 19 technical losses, not one match played.
--
-- All of it becomes a single shape: `manual_overrides.type = 'cancelled'`, one
-- row per fixture, `matches` untouched, the pairing gone from `match_history`.
--
-- ── ORDER MATTERS ──────────────────────────────────────────────────────────
-- RUN THIS BEFORE DEPLOYING THE MATCHING SITE CHANGE. `getUpdatePoints` no
-- longer skips a retired player by name — it relies on cancelled pairings being
-- absent from match_history. Deploy first and, until this runs, the 138
-- technical rows below each become an update point on their league's timeline.
--
-- ── WHAT IT COSTS ──────────────────────────────────────────────────────────
-- Measured on production before writing (scripts/report-retirement-impact.mjs):
--   0 rank changes, 0 champion changes, across all five leagues.
-- Every cancellation removes a win from an opponent who loses the game from
-- their denominator too, so the order survives it. Only ONE genuinely played
-- result is affected (Avshalom 7-4 fridlich, July 2026 round 20) and it had
-- already been overwritten in match_history on 2026-07-19.
--
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

-- ── 1. The type ─────────────────────────────────────────────────────────────
-- `cancelled` is deliberately NOT `not_played`. Both clear the result, but
-- not_played means "still to come" and cancelled means "never will be" — and
-- four read-side consumers treat an unplayed fixture as a match the league is
-- still waiting for. See docs/RETIREMENT-POLICY.md §2.
alter table public.manual_overrides drop constraint if exists manual_overrides_type_check;
alter table public.manual_overrides add constraint manual_overrides_type_check
    check (type in ('result', 'technical_win', 'technical_draw', 'not_played', 'cancelled'));


-- ── 1b. Undo has to give the DATES back too ─────────────────────────────────
-- Cancelling a played match deletes its `match_history` row, and that row held
-- the only record of WHEN the result was entered. `matches` holds the result,
-- so un-cancelling restores the score and the PR perfectly — and dates the
-- match to the moment of the undo, because the reconcile sees a pairing with no
-- stored row and treats it as brand new.
--
-- Measured, not theorised (scripts/verify-retirement-cycle.mjs, September 2026):
-- retiring a player with 16 played matches and then un-retiring them brought
-- all 16 results back byte-identical and moved all 16 recording dates from
-- 1–5 September to the moment of the undo. The Title Race X axis, the
-- Historical view's as-of replay and every shared `?asof=…#n` link were wrong
-- afterwards, and NOTHING announced it: the row count and the schedule
-- fingerprint both came back identical.
--
-- So the date is parked on the fixture — `matches` is already the revert
-- source, and the date is part of what must be reverted. A trigger rather than
-- application code, because three different paths delete history rows (this
-- migration, the admin publish, the sync job) and one of them would have been
-- forgotten.
alter table public.matches add column if not exists history_updated_at timestamptz;

comment on column public.matches.history_updated_at is
    'The updated_at this pairing''s match_history row last carried, parked here when that row is deleted so an undone cancellation can restore the MOMENT as well as the result. Never read while a history row exists.';

create or replace function public.park_history_date() returns trigger
language plpgsql as $$
begin
    update public.matches m
       set history_updated_at = old.updated_at
     where m.league_id = old.league_id
       and least(m.player_a, m.player_b) = least(old.player_a, old.player_b)
       and greatest(m.player_a, m.player_b) = greatest(old.player_a, old.player_b);
    return old;
end;
$$;

drop trigger if exists trg_park_history_date on public.match_history;
create trigger trg_park_history_date
    before delete on public.match_history
    for each row execute function public.park_history_date();


-- ── 2. December 2025: put the 21 deleted fixtures back ──────────────────────
-- These were removed outright rather than cancelled, leaving 21 match_history
-- rows with nothing to attach to — 279 fixtures against 300 history rows. That
-- orphaning is the only genuine integrity defect in the database, and it also
-- cost Yehuda 21 of his 24 appearances in `public.players_registry`, which
-- derives who exists from `public.matches`.
--
-- THE ROUND NUMBERS ARE RECOVERED, NOT GUESSED. The history rows carry
-- `round = null`, but the schedule determines them: this is a 25-player
-- round-robin, so a round missing one of Yehuda's fixtures has 11 rather than
-- 12, and exactly three players absent — the bye, Yehuda, and his opponent.
-- Solving all 21 rounds against all 21 opponents as a bipartite matching yields
-- EXACTLY ONE perfect matching. Re-derivable at any time by
-- scripts/audit-retirement-data.mjs's sibling analysis.
--
-- `played = false` with null everywhere is the honest source state: these
-- fixtures were scheduled and never played.
insert into public.matches (league_id, round, player_a, player_b, played,
                            score_a, score_b, pr_a, pr_b, luck_a, luck_b)
select v.league_id, v.round, v.player_a, v.player_b, false,
       null, null, null, null, null, null
from (values
  ('December 2025',  1, 'Yehuda', 'KingArt'),
  ('December 2025',  2, 'Yehuda', 'Tezka11'),
  ('December 2025',  3, 'Yehuda', 'ys'),
  ('December 2025',  5, 'Yehuda', 'lur'),
  ('December 2025',  6, 'Yehuda', 'YKwin'),
  ('December 2025',  7, 'Yehuda', 'UziMutsafy'),
  ('December 2025',  8, 'Yehuda', 'Nissimb'),
  ('December 2025',  9, 'Yehuda', 'Idan1986'),
  ('December 2025', 10, 'Yehuda', 'sasha_er'),
  ('December 2025', 11, 'Yehuda', 'Ran1976'),
  ('December 2025', 12, 'Yehuda', 'fridlich'),
  ('December 2025', 14, 'Yehuda', 'HeartGammon'),
  ('December 2025', 15, 'Yehuda', 'barak100'),
  ('December 2025', 17, 'Yehuda', 'nadavd'),
  ('December 2025', 18, 'Yehuda', 'MarcelDana'),
  ('December 2025', 19, 'Yehuda', 'Avshalom'),
  ('December 2025', 20, 'Yehuda', 'Moriarty'),
  ('December 2025', 21, 'Yehuda', 'hmualem'),
  ('December 2025', 22, 'Yehuda', 'Danny_kondrea'),
  ('December 2025', 24, 'Yehuda', 'Efi'),
  ('December 2025', 25, 'Yehuda', 'GuyEliyahu')
) as v(league_id, round, player_a, player_b)
where not exists (
    select 1 from public.matches m
     where m.league_id = v.league_id
       and least(m.player_a, m.player_b) = least(v.player_a, v.player_b)
       and greatest(m.player_a, m.player_b) = greatest(v.player_a, v.player_b)
);


-- ── 3. July 2026 Regular: the retirement nobody flagged ─────────────────────
-- Meir65: 19 fixtures, 19 technical losses, 0 real matches. Identical in shape
-- to Emergi and to April's two, who were flagged. Only the flag is missing.
--
-- Note the test that found him: ZERO REAL MATCHES, not a count of technical
-- losses. A "3 or more" rule flags four players and is wrong about three of
-- them — barak100, Avi and ynonhagag each have 20+ real matches with their
-- technical losses scattered between them, and kept playing afterwards. Those
-- are no-shows and are deliberately left exactly as they are.
-- `retired_players` is jsonb (a JSON array of names), not text[] — the browser
-- reads it with `.includes()`. `jsonb_exists(...)` rather than the `?` operator
-- on purpose: `?` is a parameter placeholder in several clients and silently
-- turns this statement into a bind error.
update public.leagues
   set retired_players = coalesce(retired_players, '[]'::jsonb) || '["Meir65"]'::jsonb
 where id = 'July 2026 Regular'
   and not jsonb_exists(coalesce(retired_players, '[]'::jsonb), 'Meir65');


-- ── 4. Every retired player's fixtures become `cancelled` ───────────────────
-- Derived from `leagues.retired_players` × `matches`, so it covers all five
-- leagues at once and needs no list of pairings. It deliberately takes EVERY
-- fixture of a retired player, played or not: the policy is that a retired
-- player's season is withdrawn whole, not truncated where they walked away.
with retired_fixtures as (
    select m.league_id, m.player_a, m.player_b,
           (select string_agg(p, ', ' order by p)
              from jsonb_array_elements_text(l.retired_players) p
             where p in (m.player_a, m.player_b)) as who
      from public.matches m
      join public.leagues l on l.id = m.league_id
     where jsonb_array_length(coalesce(l.retired_players, '[]'::jsonb)) > 0
       and (jsonb_exists(l.retired_players, m.player_a)
            or jsonb_exists(l.retired_players, m.player_b))
)
insert into public.manual_overrides (league_id, player_a, player_b, type, winner,
                                     score_a, score_b, pr_a, pr_b, luck_a, luck_b,
                                     reason, edited_at)
select rf.league_id, rf.player_a, rf.player_b, 'cancelled', null,
       null, null, null, null, null, null,
       'Cancelled — retired: ' || rf.who,
       now()
  from retired_fixtures rf
on conflict (league_id, player_a, player_b) do update
   set type    = 'cancelled',
       winner  = null,
       score_a = null, score_b = null,
       pr_a    = null, pr_b    = null,
       luck_a  = null, luck_b  = null,
       reason  = excluded.reason,
       edited_at = coalesce(public.manual_overrides.edited_at, excluded.edited_at);

-- The unique index is on (league_id, player_a, player_b) in the stored
-- ORIENTATION, so an existing override written the other way round would not
-- have collided above and would now sit alongside the new row, still claiming a
-- technical win. Remove any such twin.
-- This is not hypothetical: on the first run it removed 27 rows, so the old
-- technical_win overrides really were stored the other way round from their
-- `matches` row.
--
-- The last clause is what stops it eating BOTH copies. `delete ... using` on
-- the same table evaluates every pair against one snapshot, so for two rows A
-- and B of the same pairing the join matches once as (o=A, keep=B) and once as
-- (o=B, keep=A) — with a symmetric condition, both would be deleted and the
-- pairing would end up with no override at all. Keeping the lowest id breaks
-- the symmetry; a non-cancelled twin always loses regardless of id.
delete from public.manual_overrides o
 using public.manual_overrides keep
 where o.league_id = keep.league_id
   and keep.type = 'cancelled'
   and o.id <> keep.id
   and least(o.player_a, o.player_b) = least(keep.player_a, keep.player_b)
   and greatest(o.player_a, o.player_b) = greatest(keep.player_a, keep.player_b)
   and (o.type <> 'cancelled' or o.id > keep.id);


-- ── 5. A cancelled pairing leaves match_history ─────────────────────────────
-- This is the step that does the real work. match_history is what the timeline
-- is built from, so removing the row is what makes a cancelled match cease to
-- be a moment in the league's history — no update point, absent from every
-- as-of replay including ones dated before the retirement.
--
-- It also removes December's 21 orphans (their pairings are cancelled now that
-- the fixtures are back) and July 2026's 24 hand-typed rows, restoring the
-- invariant `match_history == matches + manual_overrides` across all 17
-- leagues. That invariant is what stops `storedPointPrediction` from falling
-- back to computing the Predictor and What-If in the browser on every load.
delete from public.match_history h
 using public.manual_overrides o
 where o.league_id = h.league_id
   and o.type = 'cancelled'
   and least(h.player_a, h.player_b) = least(o.player_a, o.player_b)
   and greatest(h.player_a, h.player_b) = greatest(o.player_a, o.player_b);


-- ── 6. Drop the stale projections ───────────────────────────────────────────
-- Every affected league's schedule fingerprint changes (cancelled fixtures are
-- now marked in it) and its update-point list is shorter, so every stored point
-- is addressed by a hash that no longer exists. The page falls back to a live
-- computation until scripts/project-title-race.js runs again, which is correct
-- but slow — re-run it after this.
delete from public.league_projections
 where league_id in (
     select id from public.leagues where jsonb_array_length(coalesce(retired_players, '[]'::jsonb)) > 0
 );

commit;


-- ============================================================================
-- VERIFICATION — run after the transaction commits. Expected results inline.
-- ============================================================================

-- 6a. Every retired player's fixtures are cancelled, and nothing else is.
--     Expect: April 47, December 24, February 24, July 24, July Regular 19.
select l.id,
       l.retired_players,
       count(*) filter (where o.type = 'cancelled')     as cancelled,
       count(*) filter (where o.type = 'technical_win') as technical_win_left
  from public.leagues l
  left join public.manual_overrides o on o.league_id = l.id
 where jsonb_array_length(coalesce(l.retired_players, '[]'::jsonb)) > 0
 group by l.id, l.retired_players
 order by l.id;

-- 6b. No fixture of a retired player is left uncancelled. Expect: 0 rows.
select m.league_id, m.player_a, m.player_b, m.round
  from public.matches m
  join public.leagues l on l.id = m.league_id
 where jsonb_array_length(coalesce(l.retired_players, '[]'::jsonb)) > 0
   and (jsonb_exists(l.retired_players, m.player_a) or jsonb_exists(l.retired_players, m.player_b))
   and not exists (
       select 1 from public.manual_overrides o
        where o.league_id = m.league_id
          and o.type = 'cancelled'
          and least(o.player_a, o.player_b) = least(m.player_a, m.player_b)
          and greatest(o.player_a, o.player_b) = greatest(m.player_a, m.player_b)
   );

-- 6c. No orphan history rows anywhere — a history row with no fixture behind
--     it. Expect: 0 rows. (Before this migration: 21, all December 2025.)
select h.league_id, h.player_a, h.player_b
  from public.match_history h
 where not exists (
       select 1 from public.matches m
        where m.league_id = h.league_id
          and least(m.player_a, m.player_b) = least(h.player_a, h.player_b)
          and greatest(m.player_a, m.player_b) = greatest(h.player_a, h.player_b)
   );

-- 6d. No cancelled pairing still carries a history row. Expect: 0 rows.
select o.league_id, o.player_a, o.player_b
  from public.manual_overrides o
  join public.match_history h
    on h.league_id = o.league_id
   and least(h.player_a, h.player_b) = least(o.player_a, o.player_b)
   and greatest(h.player_a, h.player_b) = greatest(o.player_a, o.player_b)
 where o.type = 'cancelled';

-- 6e. Fixture / history arithmetic per affected league.
--     Expect history = fixtures - cancelled, exactly, for every row.
select l.id,
       (select count(*) from public.matches m where m.league_id = l.id)        as fixtures,
       (select count(*) from public.manual_overrides o
         where o.league_id = l.id and o.type = 'cancelled')                    as cancelled,
       (select count(*) from public.match_history h where h.league_id = l.id)  as history
  from public.leagues l
 where jsonb_array_length(coalesce(l.retired_players, '[]'::jsonb)) > 0
 order by l.id;
