-- ============================================================================
-- retirement_flag_sync.sql — flagging a player Retired IS the retirement.
--
-- Spec: docs/RETIREMENT-POLICY.md §2 ("One act")
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- A retirement is stored as two things: the name in `leagues.retired_players`
-- (display) and a `cancelled` override on every fixture of his (all logic).
-- Nothing in the database tied them together, so they could be written apart —
-- and were. October 2026 UBC: the admin ticked Retired and published; the
-- league went live with a player wearing the RETIRED mark whose 14 fixtures
-- every table still listed as matches to be played.
--
-- The admin UI now stages both halves together, but a rule that only one
-- client enforces is a rule the next client breaks (a hand-run UPDATE, the
-- sync job, v2). So the database enforces it: whenever `retired_players`
-- changes, the overrides follow in the same transaction. The flag alone is
-- enough, from any path.
--
-- The two concepts stay separate (§1) — computations still read only
-- `cancelled`. This only guarantees the second is never missing.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────
--   name ADDED    every fixture of his gets a `cancelled` override, and the
--                 pairing leaves match_history (steps 4–5 of
--                 retirement_policy.sql, for one league).
--   name REMOVED  his `cancelled` overrides are deleted — unless the opponent
--                 is still retired (§4 case 3). match_history is NOT rebuilt
--                 here: the reconcile restores each pairing from `matches` on
--                 the next publish/sync, as it always has (§4 case 6).
--
-- Projections need nothing: the existing triggers on manual_overrides and
-- match_history already queue a refresh (sql/league_projections.sql).
--
-- Ends with a one-time backfill, which is what repairs October 2026 UBC.
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

create or replace function public.sync_retirement_overrides(
    p_league_id text,
    p_unretired jsonb default '[]'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
    v_retired jsonb;
begin
    select coalesce(retired_players, '[]'::jsonb) into v_retired
      from public.leagues where id = p_league_id;
    if v_retired is null then return; end if;

    -- Un-retire: only the overrides of the players who just left the list, and
    -- only where the opponent is not still on it. A `cancelled` override that
    -- names nobody from p_unretired is left strictly alone.
    delete from public.manual_overrides o
     where o.league_id = p_league_id
       and o.type = 'cancelled'
       and (jsonb_exists(p_unretired, o.player_a) or jsonb_exists(p_unretired, o.player_b))
       and not (jsonb_exists(v_retired, o.player_a) or jsonb_exists(v_retired, o.player_b));

    if jsonb_array_length(v_retired) = 0 then return; end if;

    -- Retire: every fixture, played or not — the season is withdrawn whole.
    -- A fixture that already carries a `cancelled` override in either
    -- orientation is skipped, so re-running writes nothing.
    insert into public.manual_overrides (league_id, player_a, player_b, type, winner,
                                         score_a, score_b, pr_a, pr_b, luck_a, luck_b,
                                         reason, edited_at)
    select m.league_id, m.player_a, m.player_b, 'cancelled', null,
           null, null, null, null, null, null,
           'Cancelled — retired: ' || (select string_agg(p, ', ' order by p)
                                         from jsonb_array_elements_text(v_retired) p
                                        where p in (m.player_a, m.player_b)),
           now()
      from public.matches m
     where m.league_id = p_league_id
       and m.player_a <> 'Bye' and m.player_b <> 'Bye'
       and (jsonb_exists(v_retired, m.player_a) or jsonb_exists(v_retired, m.player_b))
       and not exists (
           select 1 from public.manual_overrides o
            where o.league_id = m.league_id
              and o.type = 'cancelled'
              and least(o.player_a, o.player_b) = least(m.player_a, m.player_b)
              and greatest(o.player_a, o.player_b) = greatest(m.player_a, m.player_b))
    on conflict (league_id, player_a, player_b) do update
       set type    = 'cancelled',
           winner  = null,
           score_a = null, score_b = null,
           pr_a    = null, pr_b    = null,
           luck_a  = null, luck_b  = null,
           reason  = excluded.reason,
           edited_at = excluded.edited_at;

    -- An older override for the same pairing stored the other way round did not
    -- collide above and would still claim its result. Same rule as
    -- retirement_policy.sql §4: the cancelled row wins, lowest id among twins.
    delete from public.manual_overrides o
     using public.manual_overrides keep
     where o.league_id = p_league_id
       and keep.league_id = o.league_id
       and keep.type = 'cancelled'
       and o.id <> keep.id
       and least(o.player_a, o.player_b) = least(keep.player_a, keep.player_b)
       and greatest(o.player_a, o.player_b) = greatest(keep.player_a, keep.player_b)
       and (o.type <> 'cancelled' or o.id > keep.id);

    -- A cancelled pairing is not a moment in the league's history.
    -- (trg_park_history_date parks each row's date on the fixture first.)
    delete from public.match_history h
     using public.manual_overrides o
     where h.league_id = p_league_id
       and o.league_id = h.league_id
       and o.type = 'cancelled'
       and least(h.player_a, h.player_b) = least(o.player_a, o.player_b)
       and greatest(h.player_a, h.player_b) = greatest(o.player_a, o.player_b);
end $$;

revoke all on function public.sync_retirement_overrides(text, jsonb) from public, anon, authenticated;


create or replace function public.retirement_on_league_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_old jsonb := case when tg_op = 'UPDATE' then coalesce(old.retired_players, '[]'::jsonb) else '[]'::jsonb end;
    v_new jsonb := coalesce(new.retired_players, '[]'::jsonb);
begin
    perform public.sync_retirement_overrides(
        new.id,
        coalesce((select jsonb_agg(p) from jsonb_array_elements_text(v_old) p
                   where not jsonb_exists(v_new, p)), '[]'::jsonb));
    return null;
end $$;

drop trigger if exists retirement_league_ins on public.leagues;
create trigger retirement_league_ins
  after insert on public.leagues
  for each row
  when (jsonb_array_length(coalesce(new.retired_players, '[]'::jsonb)) > 0)
  execute function public.retirement_on_league_change();

drop trigger if exists retirement_league_upd on public.leagues;
create trigger retirement_league_upd
  after update of retired_players on public.leagues
  for each row
  when (old.retired_players is distinct from new.retired_players)
  execute function public.retirement_on_league_change();


-- ── One-time backfill ───────────────────────────────────────────────────────
-- Every league that already has a retired player. A no-op for the five the
-- migration covered; writes October 2026 UBC's 14 missing overrides.
select public.sync_retirement_overrides(id)
  from public.leagues
 where jsonb_array_length(coalesce(retired_players, '[]'::jsonb)) > 0;

commit;


-- ============================================================================
-- VERIFICATION — run after the commit.
-- ============================================================================

-- No fixture of a retired player is left uncancelled. Expect: 0 rows.
select m.league_id, m.player_a, m.player_b, m.round
  from public.matches m
  join public.leagues l on l.id = m.league_id
 where m.player_a <> 'Bye' and m.player_b <> 'Bye'
   and (jsonb_exists(coalesce(l.retired_players, '[]'::jsonb), m.player_a)
        or jsonb_exists(coalesce(l.retired_players, '[]'::jsonb), m.player_b))
   and not exists (
       select 1 from public.manual_overrides o
        where o.league_id = m.league_id
          and o.type = 'cancelled'
          and least(o.player_a, o.player_b) = least(m.player_a, m.player_b)
          and greatest(o.player_a, o.player_b) = greatest(m.player_a, m.player_b));
