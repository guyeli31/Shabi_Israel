-- ============================================================================
-- players_registry.sql — "who is a player" gets ONE definition.
--
-- RUN AFTER sql/site_bundle.sql. sql/mail_reason_accuracy.sql depends on the
-- view this creates and must run after it.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- A league is an entity: public.leagues holds a row per league, and a league
-- can exist before it has a single fixture. A PLAYER is not. A player exists in
-- this system only by appearing in the player_a/player_b columns of a match —
-- delete their matches and the person is gone. public.players_metadata looks
-- like the missing table but is not: it is decoration (photo, title, full name)
-- attached to a player who already exists, and holds a handful of rows against
-- a roster of dozens.
--
-- With no entity there is no authoritative answer to "does this name exist",
-- so every caller invented one, and they disagreed:
--
--   js/render/landingPage.js (the Players tab) — appears in ANY league, plus
--     anyone carrying metadata. This is the list the site shows the public.
--   public.mail_orphan_reason — appears in a RUNNING league. Anything else is
--     reported as "Unknown player".
--
-- Both are defensible; neither is more correct; and they answer the same
-- question differently. A player of five seasons who is between leagues got the
-- same "Unknown player: fridlich" as a name someone mistyped — and with every
-- league stopped (between seasons) EVERY name reads as unknown.
--
-- This view is that definition, written once. It deliberately does NOT create
-- rows: it derives them, so it cannot drift from the fixtures the way a real
-- table would need triggers to avoid. What it buys is that both callers now ask
-- the same question of the same place.
--
-- ── COST ───────────────────────────────────────────────────────────────────
-- Nothing new is fetched. The site already loads every match and all of
-- players_metadata in ONE call (get_site_bundle), so the client has always held
-- the raw material — it was deriving the list itself, per page. Adding the
-- `players` key to that same bundle is one more aggregate in a query already
-- being run: no extra round trip, and the derivation moves from every client to
-- one place.
-- ============================================================================


-- ── The view ───────────────────────────────────────────────────────────────
-- One row per name known to the system, from either source.
--
-- The three counts exist so a caller can express its OWN visibility rule
-- without re-deriving the roster:
--   leagues_count          every league, hidden and archived included — the
--                          widest sense of "this name exists here".
--   visible_leagues_count  what the public site may show (see the "Hidden means
--                          hidden from everyone" rule).
--   in_running_league      is this person playing right now.
--
-- 'Bye' never appears: js/data/csvParser.js drops those rows before they reach
-- public.matches, so the fixtures hold no such player.
-- Dropped rather than replaced: `create or replace view` can only append
-- columns at the end, and last_flag/last_league sit beside the other identity
-- fields on purpose. get_site_bundle() is recreated below and its body is
-- resolved at call time, so the drop leaves nothing dangling.
drop view if exists public.players_registry;

create view public.players_registry as
with recency as (
    -- The site's own recency ordering is DisplayOrder, index 0 = newest — NOT
    -- issue_date, which a league may never have had filled in. This mirrors
    -- js/utils/playerFlags.js exactly; the two must not disagree about which
    -- league is "the latest", or last_flag becomes a second opinion.
    -- DisplayOrder titles use " - " where league ids use " " (see CLAUDE.md).
    select replace(t.title, ' - ', ' ') as league_id, t.ord
      from public.landing_settings ls,
           lateral (
               select value #>> '{}' as title, ordinality - 1 as ord
                 from jsonb_array_elements(ls.display_order) with ordinality
           ) t
     where ls.id = 1
),
appearances as (
    select m.player_a as id, m.league_id from public.matches m
    union all
    select m.player_b as id, m.league_id from public.matches m
),
newest_league as (
    -- The newest NON-HIDDEN, non-archived league each player appears in — the
    -- same set landingPage.js hands buildPlayerFlagIndex().
    --
    -- INNER join to recency, not left: a league absent from DisplayOrder does
    -- not exist as far as the site is concerned. Every public page walks
    -- DisplayOrder (crossLeague.js's loadAllLeagues builds its whole array from
    -- it), so such a league is invisible everywhere — and a registry that
    -- resolved a flag THROUGH it would be answering from a league the rest of
    -- the site cannot see. Caught by comparison: with a left join and the
    -- missing league sorted last, this disagreed with playerFlags.js on exactly
    -- the one player whose only league was the one DisplayOrder had lost.
    select distinct on (a.id) a.id, a.league_id, l.custom_flags
      from appearances a
      join public.leagues l on l.id = a.league_id
      join recency r on r.league_id = a.league_id
     where not l.hidden and not l.archived
     order by a.id, r.ord, a.league_id
),
agg as (
    select a.id,
           count(distinct a.league_id)                                          as leagues_count,
           count(distinct a.league_id) filter (
               where not l.hidden and not l.archived)                           as visible_leagues_count,
           bool_or(l.running and not l.archived and not l.hidden)               as in_running_league,
           bool_or(l.running and not l.archived)                                as in_running_league_any
      from appearances a
      join public.leagues l on l.id = a.league_id
     group by a.id
)
select
    coalesce(agg.id, pm.id)                          as id,
    coalesce(agg.leagues_count, 0)                   as leagues_count,
    coalesce(agg.visible_leagues_count, 0)           as visible_leagues_count,
    coalesce(agg.in_running_league, false)           as in_running_league,
    coalesce(agg.in_running_league_any, false)       as in_running_league_any,
    (pm.id is not null)                              as has_metadata,
    -- CONTEXT-FREE flag: the one they LAST played under. IL is the default and
    -- is an ABSENCE from custom_flags, never a stored value — which is exactly
    -- why this resolves through the newest league instead of merging every
    -- league's map: a merge cannot express a player who went BACK to IL, and an
    -- older custom flag would outlive the change forever.
    -- A player with no league at all (metadata only) gets the same default.
    coalesce(nl.custom_flags ->> coalesce(agg.id, pm.id), 'IL') as last_flag,
    nl.league_id                                     as last_league,
    pm.full_name,
    pm.bmab_title,
    pm.championship_titles,
    pm.photo_path,
    coalesce(pm.hidden, false)                       as hidden,
    coalesce(pm.inactive, false)                     as inactive,
    pm.joined
  from agg
  full outer join public.players_metadata pm on pm.id = agg.id
  left join newest_league nl on nl.id = agg.id;


-- ── get_site_bundle — one more key, no extra round trip ────────────────────
-- Identical to sql/site_bundle.sql's definition with `players` added. Existing
-- clients read the bundle by named key (js/data/store.js), so an extra key is
-- inert for anything that has not been taught to look for it.
create or replace function public.get_site_bundle(include_archived boolean default true)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'data_version', (select data_version from public.site_meta where id = 1),
    'generated_at', now(),
    'landing_settings', (select to_jsonb(ls) from public.landing_settings ls where id = 1),
    'leagues', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
      from public.leagues l
      where include_archived or l.archived = false
    ),
    'matches', (
      select coalesce(jsonb_agg((to_jsonb(m) - 'created_at' - 'updated_at') order by m.league_id, m.round, m.id), '[]'::jsonb)
      from public.matches m
      join public.leagues l on l.id = m.league_id
      where include_archived or l.archived = false
    ),
    'manual_overrides', (
      select coalesce(jsonb_agg((to_jsonb(o) - 'created_at' - 'updated_at') order by o.league_id, o.id), '[]'::jsonb)
      from public.manual_overrides o
      join public.leagues l on l.id = o.league_id
      where include_archived or l.archived = false
    ),
    'match_history', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.league_id, h.id), '[]'::jsonb)
      from public.match_history h
      join public.leagues l on l.id = h.league_id
      where include_archived or l.archived = false
    ),
    'players_metadata', (
      select coalesce(jsonb_agg((to_jsonb(p) - 'created_at' - 'updated_at') order by p.id), '[]'::jsonb)
      from public.players_metadata p
    ),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(pr) order by pr.id), '[]'::jsonb)
      from public.players_registry pr
    )
  );
$$;


-- ── Grants ─────────────────────────────────────────────────────────────────
-- The view reads only tables anon may already select from, and is exposed on
-- the same terms — the Players tab is public.
grant select on public.players_registry to anon, authenticated;
revoke all on function public.get_site_bundle(boolean) from public;
grant execute on function public.get_site_bundle(boolean) to anon, authenticated;


-- ── Verify ─────────────────────────────────────────────────────────────────
--   select count(*) from public.players_registry;
--   select id, leagues_count, visible_leagues_count, in_running_league
--     from public.players_registry order by id;
--
-- The roster the Players tab derives client-side must equal
-- `visible_leagues_count > 0 or has_metadata`.
-- ============================================================================
