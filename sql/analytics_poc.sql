-- Shabi Israel — In-house anonymous analytics POC
-- Independent of sql/supabase_schema.sql: own table, own RLS shape
-- (insert-only for anon), no naming collisions with the 8 core tables.
--
-- Privacy-differentiated, timezone-routed identity (see js/analytics.js).
-- Routing uses the browser's own timezone only — never IP (no IP is ever
-- read, sent, or stored). Two shapes of row coexist in this one table:
--   • Israel visitors (timezone 'Asia/Jerusalem') carry a per-visit
--     `session_id` (random, held in sessionStorage, wiped on tab close — no
--     cross-visit linkage). Their rows CAN be linked within a single visit
--     to reconstruct a click sequence.
--   • Everyone else stays zero-correlation: `session_id` is null, nothing is
--     written to their device for analytics, and each row stands alone (the
--     legal equivalent of an anonymous access log). These rows carry only a
--     COARSE continent `region` (e.g. 'Europe') for regional traffic
--     measurement — never a city-level string that could fingerprint.
-- Only bucketed/categorical fields are kept beyond that (no raw referrer
-- URL, no exact screen/viewport pixel dimensions) to avoid fingerprinting.
--
-- `admin_user` is the one named column here, and it is NOT an exception to the
-- above: it names the site OPERATOR (whoever is logged into Admin at the time),
-- never a visitor. It is null on every ordinary visitor's row on both routes.
-- It exists so the dashboard can tell the operator's own browsing apart from
-- real audience traffic, and it is self-declared by an admin about themselves —
-- not an identity inferred about anyone else.
--
-- All calendar/time-of-day bucketing (timeseries, hour/day/month heatmaps)
-- is done in Asia/Jerusalem, not UTC — `created_at` is stored in UTC like
-- every timestamptz, but display buckets must match the audience's clock or
-- "today" silently becomes "yesterday" for events near local midnight.

-- ── Table ────────────────────────────────────────────────────────────────
-- This file is a MIGRATION, not a reset: it only creates the table on first
-- run and otherwise evolves it in place (ADD/DROP COLUMN, DROP+ADD CONSTRAINT
-- IF EXISTS). Re-running it after a schema change must never discard
-- previously collected rows.
create table if not exists public.analytics_events (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  event_type     text not null,
  path           text,
  page           text,
  league_id      text,
  player         text,
  referrer_kind  text,
  device_type    text,
  os             text,
  browser        text,
  duration_ms    int,            -- duration events only
  click_target   text            -- click events only
);

-- Internal page-to-page navigation, derived client-side from document.referrer
-- (a standard browser-navigation property, not an added tracking identifier).
-- Populated only when the referrer was this same site. Added after the
-- table's first release — ADD COLUMN IF NOT EXISTS so upgrading is safe.
alter table public.analytics_events add column if not exists from_page      text;
alter table public.analytics_events add column if not exists from_league_id text;
alter table public.analytics_events add column if not exists from_player    text;

-- Privacy-differentiated identity columns (see header). session_id is
-- populated for Israel-timezone visits only (per-visit, sessionStorage);
-- region is the coarse continent for everyone else. Both are null on the
-- opposite route, so a null session_id + non-null region marks a
-- zero-correlation row and vice versa.
alter table public.analytics_events add column if not exists session_id text;
alter table public.analytics_events add column if not exists region     text;

-- The logged-in admin's OWN username, read from js/admin/auth.js at send time.
-- This is NEVER a visitor identity: it is null for every ordinary visitor on
-- BOTH routes, and its only purpose is to let the dashboard separate the site
-- operator's own browsing from real audience traffic. It rides both routes on
-- purpose — an admin travelling abroad is on the global (session-less) route,
-- and self-identifying there is the operator labelling their own row, not a
-- correlation handle applied to a stranger.
alter table public.analytics_events add column if not exists admin_user text;

-- Columns from the very first version of this table. Drop them if an old
-- deployment still has them; no-op otherwise. (session_id is intentionally
-- NOT dropped anymore — it is now a live column, see above.)
alter table public.analytics_events drop column if exists referrer_raw;
alter table public.analytics_events drop column if exists screen_w;
alter table public.analytics_events drop column if exists screen_h;
alter table public.analytics_events drop column if exists viewport_w;
alter table public.analytics_events drop column if exists viewport_h;

-- CHECK constraints re-declared every run (drop-if-exists + add is the
-- idempotent equivalent for constraints, which have no ADD ... IF NOT EXISTS).
alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check check (event_type in ('pageview','duration','click'));

alter table public.analytics_events drop constraint if exists analytics_events_page_check;
alter table public.analytics_events add constraint analytics_events_page_check check (page in ('landing','league','league_table','player','player_league','admin'));

alter table public.analytics_events drop constraint if exists analytics_events_from_page_check;
alter table public.analytics_events add constraint analytics_events_from_page_check check (from_page in ('landing','league','league_table','player','player_league','admin'));

alter table public.analytics_events drop constraint if exists analytics_events_referrer_kind_check;
alter table public.analytics_events add constraint analytics_events_referrer_kind_check check (referrer_kind in ('direct','search','social','internal','other'));

alter table public.analytics_events drop constraint if exists analytics_events_device_type_check;
alter table public.analytics_events add constraint analytics_events_device_type_check check (device_type in ('mobile','tablet','desktop'));

-- region is a coarse continent bucket (client-side coarseRegion in
-- js/analytics.js) or null on the Israel/session route. Constrain to the
-- IANA top-level regions + 'Other' so a stray value can't slip in.
alter table public.analytics_events drop constraint if exists analytics_events_region_check;
alter table public.analytics_events add constraint analytics_events_region_check check (region is null or region in ('Africa','America','Antarctica','Arctic','Asia','Atlantic','Australia','Europe','Indian','Pacific','Other'));

-- admin_user has no closed set to constrain against (it is whatever local part
-- an admin's address happens to have), and like session_id and region it is
-- client-asserted — anon's insert policy is `with check (true)`, so any value
-- can be POSTed. It is a display/filter convenience, never a security boundary.
-- The only thing worth enforcing here is size, so a hostile POST can't stuff an
-- unbounded blob into the table.
alter table public.analytics_events drop constraint if exists analytics_events_admin_user_check;
alter table public.analytics_events add constraint analytics_events_admin_user_check check (admin_user is null or length(admin_user) <= 254);

create index if not exists idx_analytics_created_at on public.analytics_events (created_at);
create index if not exists idx_analytics_page       on public.analytics_events (page);
create index if not exists idx_analytics_event_type on public.analytics_events (event_type);
-- Partial index: only session rows (Israel route) — keeps it small since
-- most rows on the global route have a null session_id.
create index if not exists idx_analytics_session_id on public.analytics_events (session_id) where session_id is not null;

-- ── RLS: anon may INSERT only; no SELECT/UPDATE/DELETE for anon ───────────
alter table public.analytics_events enable row level security;

drop policy if exists analytics_anon_insert on public.analytics_events;
create policy analytics_anon_insert
  on public.analytics_events
  for insert
  to anon
  with check (true);

-- Table-level GRANT (separate from RLS — the anon role still needs this to
-- attempt the INSERT at all). Also needed by the sequence backing the
-- identity primary key.
grant usage on schema public to anon;
grant insert on public.analytics_events to anon;
grant usage, select on all sequences in schema public to anon;

-- ── Aggregations via SECURITY DEFINER (read-only, returns JSON, no raw rows) ─
-- The 2-arg version of this function must be dropped explicitly: `create or
-- replace` cannot change an argument list, so without this Postgres would keep
-- BOTH overloads and PostgREST could resolve to the old one — silently ignoring
-- scope/exclude_admin and serving contaminated data that looks correct.
drop function if exists public.analytics_summary(timestamptz, timestamptz);

create or replace function public.analytics_summary(
  from_date        timestamptz,
  to_date          timestamptz,
  exclude_admin    boolean default false,
  scope            text    default 'all',  -- 'all' | 'new' | 'legacy'
  hide_admin_pages boolean default false   -- legacy-only, see the `ev` CTE
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with evx as (
    -- Range + scope, with the operator's own traffic still INCLUDED. `ev` below
    -- is what every panel reads; this wider CTE exists only so traffic_mix can
    -- report how much the filter REMOVED — a number ev cannot see by design.
    select * from public.analytics_events
    where created_at >= from_date and created_at < to_date
      -- The format break, defined PER ROW and never by date: send() sets exactly
      -- one of session_id (Israel route) / region (global route) on every event,
      -- so a row with neither predates the route model entirely. A cutover date
      -- could not do this — July 2026 holds both shapes, and a date constant
      -- would misfile genuine new-format rows and need syncing forever.
      and (scope = 'all'
        or (scope = 'legacy' and session_id is null and region is null)
        or (scope = 'new'    and (session_id is not null or region is not null)))
  ),
  ev as (
    select * from evx
    -- admin_user names the operator, never a visitor, so excluding it means
    -- "show me real audience traffic".
    where (not exclude_admin or admin_user is null)
      -- Legacy rows never carried admin_user, but page='admin' PROVES the
      -- operator (admin.html redirects to index when logged out), and
      -- js/analytics.js appends "(Admin Mode)" to sidebar labels only in admin
      -- mode. This is the ONLY recoverable admin signal for legacy rows and it
      -- is a LOWER BOUND (~15%): the operator browsing public pages while logged
      -- in is indistinguishable from a visitor, and the auth log cannot separate
      -- them either (events split 50/50 around admin activity — a coin flip,
      -- because the session refreshed for days and never logged out). Never
      -- present the result as a total.
      --
      -- Gated on scope='legacy' so it is a structural NO-OP everywhere else, not
      -- merely by caller discipline: new-format rows carry a real admin_user, so
      -- exclude_admin is exact there and this proxy is strictly worse. Letting
      -- both apply to the same rows would be two overlapping answers to one
      -- question, and new-format admin pages would drop out even with
      -- exclude_admin off — which reads as data loss.
      and (not (hide_admin_pages and scope = 'legacy')
           or (page is distinct from 'admin'
               and (click_target is null or click_target not like '%(Admin Mode)%')))
  ),
  -- One row per Israel-route VISIT in range, feeding the 'sessions' key below.
  -- `session_id is not null` is the entire privacy gate: global-route rows carry
  -- no id and therefore CANNOT be grouped into a visit — they stay unlinked
  -- individual rows in clicks_log, which is the whole point of the two-route
  -- model (see header). Never relax this predicate.
  --
  -- Capped to the 200 most recent visits HERE, before the timeline lateral
  -- below, so a timeline is only ever built for a session that actually ships.
  --
  -- Only sees rows inside `ev`: a visit straddling from_date reports its first
  -- IN-RANGE event as started_at, and a correspondingly short span. Accepted —
  -- fixing it would need a second, unbounded lookup outside the range.
  sess as (
    select session_id,
           min(created_at) as started_at,
           max(created_at) as ended_at,
           -- WALL-CLOCK SPAN of the visit (last event - first event), NOT
           -- measured attention. Deliberately different from the duration_ms
           -- COLUMN, which is real visible-time from a 'duration' event and is
           -- what avg_dwell_ms/dwell_buckets are built from. A tab left open for
           -- 8h with one click at each end has an 8h span and ~0s dwell.
           -- Cast to bigint: extract(epoch ...) is double/numeric depending on
           -- server version, and an uncast round() serialises into jsonb as
           -- e.g. 5000.0, which the dashboard would print as "5000.0ms".
           (round(extract(epoch from (max(created_at) - min(created_at))) * 1000))::bigint as duration_ms,
           count(*)                                        as event_count,
           count(*) filter (where event_type = 'pageview') as pageview_count,
           count(*) filter (where event_type = 'click')    as click_count,
           -- Chronologically FIRST non-null. The `order by created_at` inside
           -- array_agg is load-bearing: without it array_agg's element order is
           -- unspecified, so [1] would pick an arbitrary row and the same visit
           -- could paint a different colour on each refresh.
           (array_agg(device_type order by created_at) filter (where device_type is not null))[1] as device_type,
           -- Any non-null wins: an admin who logs in (or out) mid-visit still
           -- tags the whole visit as operator traffic, which is what the
           -- dashboard's colour rule wants.
           (array_agg(admin_user  order by created_at) filter (where admin_user  is not null))[1] as admin_user,
           -- Visit SHAPE for the card head: how it started and where it went.
           -- entry_referrer is the first non-null referrer_kind — a pageview
           -- property, so it is the entry hit's source (direct/search/social/…).
           -- entry_/exit_ page+player are the FIRST and LAST pageview's context,
           -- i.e. the arc from landing page to exit page. Same chronological
           -- array_agg[1] pattern as device_type above; the `desc` ordering
           -- grabs the last pageview instead of the first. Clicks/durations are
           -- filtered out so the arc is page-to-page, not event-to-event.
           (array_agg(referrer_kind order by created_at) filter (where referrer_kind is not null))[1] as entry_referrer,
           (array_agg(page   order by created_at)      filter (where event_type = 'pageview'))[1] as entry_page,
           (array_agg(player order by created_at)      filter (where event_type = 'pageview'))[1] as entry_player,
           (array_agg(page   order by created_at desc) filter (where event_type = 'pageview'))[1] as exit_page,
           (array_agg(player order by created_at desc) filter (where event_type = 'pageview'))[1] as exit_player
    from ev
    where session_id is not null
    group by session_id
    order by started_at desc
    limit 200
  )
  select jsonb_build_object(
    -- What this range is actually MADE OF, read from evx (i.e. before the admin
    -- filter) so it can also say how much of it was the operator's own. The
    -- three route buckets partition evx exactly — see the scope predicate above.
    'traffic_mix',    (select jsonb_build_object(
                         'israel',   count(*) filter (where session_id is not null),
                         'global',   count(*) filter (where region is not null),
                         'legacy',   count(*) filter (where session_id is null and region is null),
                         'internal', count(*) filter (where admin_user is not null),
                         -- Legacy's only recoverable admin signal (see `ev`).
                         -- A LOWER BOUND, never a total.
                         'provably_internal',
                                     count(*) filter (where page = 'admin'
                                                         or click_target like '%(Admin Mode)%'),
                         'total',    count(*)
                       ) from evx),

    'total_pageviews', (select count(*) from ev where event_type = 'pageview'),
    -- Distinct Israel-route visits in range (global-route rows have a null
    -- session_id and are simply not counted here).
    'total_sessions',  (select count(distinct session_id) from ev where session_id is not null),
    'avg_dwell_ms',    (select coalesce(round(avg(duration_ms)), 0) from ev where event_type = 'duration'),
    'bounce_pct',      (select coalesce(round(100.0 * count(*) filter (where duration_ms < 10000) / nullif(count(*), 0)), 0)
                          from ev where event_type = 'duration'),
    -- Timestamp of the most recent event in range (informational only — the
    -- dashboard's own "Last Updated" card shows when THIS view was fetched,
    -- not this value; see analyticsPage.js).
    'last_event_at',  (select max(created_at) from ev),

    'top_pages',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select page, count(*) views from ev
                           where event_type='pageview' and page is not null
                           group by page order by views desc limit 20) t),
    'top_leagues',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select league_id, count(*) views from ev
                           where event_type='pageview' and league_id is not null
                           group by league_id order by views desc limit 20) t),
    'top_players',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select player, count(*) views from ev
                           where event_type='pageview' and player is not null
                           group by player order by views desc limit 20) t),
    'by_device',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select device_type, count(*) views from ev
                           where event_type='pageview' and device_type is not null
                           group by device_type order by views desc) t),
    -- Coarse regional traffic (global route only — Israel rows have a null
    -- region). Continent-level buckets, never city-level.
    'by_region',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select region, count(*) views from ev
                           where event_type='pageview' and region is not null
                           group by region order by views desc) t),
    'by_referrer',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select referrer_kind, count(*) views from ev
                           where event_type='pageview' and referrer_kind is not null
                           group by referrer_kind order by views desc) t),

    -- Pageviews per calendar day, in Israel time (see header note re: UTC).
    'timeseries',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select (date_trunc('day', created_at at time zone 'Asia/Jerusalem'))::date as day,
                                  count(*) as views,
                                  -- Distinct Israel visits active that day (session_id is
                                  -- null for global/legacy, and count(distinct) ignores
                                  -- nulls) — same basis as the "Sessions (Israel)" KPI, so
                                  -- the Overview chart can toggle Pageviews ↔ Sessions.
                                  count(distinct session_id) as sessions
                           from ev where event_type='pageview' group by 1 order by 1) t),

    -- Traffic heatmap, DAILY grid: actual calendar date x hour-of-day, Israel time.
    -- Used for short ranges (e.g. last 30 days) where one row per day is readable.
    'by_hour_day',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select (date_trunc('day', created_at at time zone 'Asia/Jerusalem'))::date as bucket,
                                  extract(hour from created_at at time zone 'Asia/Jerusalem')::int as hour,
                                  count(*) as views
                           from ev where event_type='pageview'
                           group by 1, 2 order by 1, 2) t),

    -- Traffic heatmap, MONTHLY grid: same idea but one row per month, for
    -- longer look-back ranges where a daily grid would be unreadably tall.
    'by_hour_month',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select (date_trunc('month', created_at at time zone 'Asia/Jerusalem'))::date as bucket,
                                  extract(hour from created_at at time zone 'Asia/Jerusalem')::int as hour,
                                  count(*) as views
                           from ev where event_type='pageview'
                           group by 1, 2 order by 1, 2) t),

    -- Dwell-time distribution per page, bucketed (never exact per-visit ms).
    'dwell_buckets',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select page,
                                  case
                                    when duration_ms < 10000  then '<10s'
                                    when duration_ms < 30000  then '10-30'
                                    when duration_ms < 60000  then '30-60'
                                    when duration_ms < 300000 then '1-5m'
                                    else '5m+'
                                  end as bucket,
                                  count(*) as n
                           from ev where event_type='duration' and page is not null
                           group by 1, 2) t),

    -- Anonymous page-to-page transitions (A -> B), derived only from the
    -- browser's own referrer on independent pageviews — no linkage added.
    -- Includes league/player context on both sides when available, so a
    -- transition reads as e.g. "League Table (Shabi Israel July 2026) ->
    -- Player History (GuyEliyahu)" instead of just page-type -> page-type.
    -- `last_seen` is the most recent occurrence of this exact (from,to) pair
    -- — still an aggregate over the combination, not a trace of one visit.
    'transitions',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select from_page, from_league_id, from_player,
                                  page as to_page, league_id as to_league_id, player as to_player,
                                  count(*) as n, max(created_at) as last_seen
                           from ev
                           where event_type='pageview' and from_page is not null and page is not null
                           group by 1, 2, 3, 4, 5, 6 order by n desc limit 30) t),

    -- Chronological, UN-aggregated log of every individual transition (same
    -- (from,to) pair repeats across rows on purpose — each occurrence is its
    -- own row, newest first). `running_count` is the cumulative occurrence
    -- count of that exact pair up to and including this row (a window
    -- function over time, not a session trace — no two rows are linked by
    -- any identifier, this is just "how many times has this pair happened
    -- so far", the same aggregate-over-a-combination idea as `transitions`
    -- above, just shown per-occurrence instead of collapsed to one line).
    -- Capped at 500 rows (most recent) to keep the payload bounded.
    'transitions_log', (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select created_at, from_page, from_league_id, from_player,
                                  page as to_page, league_id as to_league_id, player as to_player,
                                  device_type,
                                  count(*) over (
                                    partition by from_page, from_league_id, from_player, page, league_id, player
                                    order by created_at
                                    rows between unbounded preceding and current row
                                  ) as running_count
                           from ev
                           where event_type='pageview' and from_page is not null and page is not null
                           order by created_at desc limit 500) t),

    -- Chronological log of every click/interaction event: button clicks
    -- (Export Image, Run Simulation — carries a per-click summary of the
    -- staged scenario in click_target), search outcomes, and plain link
    -- clicks. `click_target` text is often unique per row (e.g. the staged
    -- Run Simulation summary), so unlike transitions this is shown as a flat
    -- log rather than aggregated by exact text. Capped at 500 (most recent).
    -- session_id/region/admin_user ride along so the dashboard can show which
    -- route each click came from: an id (Israel) vs a coarse continent (global,
    -- zero-correlation), and whether it was the operator's own click.
    'clicks_log',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select created_at, page, league_id, player, click_target, device_type,
                                  session_id, region, admin_user
                           from ev
                           where event_type='click'
                           order by created_at desc limit 500) t),

    -- Per-visit traces — Israel route ONLY (the gate lives in the `sess` CTE).
    -- Each visit carries its own chronological timeline so the dashboard can
    -- expand one session into the same table format as clicks_log above. This
    -- is the ONLY key that reconstructs a sequence of one visitor's events, and
    -- it can only ever contain rows that opted into a session id by being on
    -- the Israel route. Payload is bounded at 200 visits x 500 events each
    -- regardless of traffic; event_count is counted over the FULL visit, so a
    -- truncated timeline still reports its true size and the dashboard can say
    -- "showing the first N of M".
    'sessions',        (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select s.session_id, s.started_at, s.ended_at, s.duration_ms,
                                  s.event_count, s.pageview_count, s.click_count,
                                  s.device_type, s.admin_user,
                                  s.entry_referrer, s.entry_page, s.entry_player,
                                  s.exit_page, s.exit_player, tl.timeline
                           from sess s
                           cross join lateral (
                             select coalesce(jsonb_agg(jsonb_build_object(
                                      'created_at',   x.created_at,
                                      'event_type',   x.event_type,
                                      'page',         x.page,
                                      'league_id',    x.league_id,
                                      'player',       x.player,
                                      'click_target', x.click_target,
                                      'duration_ms',  x.duration_ms
                                    ) order by x.created_at), '[]'::jsonb) as timeline
                             from (select * from ev e
                                   where e.session_id = s.session_id
                                   order by e.created_at limit 500) x
                           ) tl
                           -- Repeated even though `sess` is already ordered:
                           -- order does not propagate out of a CTE, and the
                           -- innermost ORDER BY is what reaches jsonb_agg(t).
                           order by s.started_at desc) t)
  );
$$;

revoke all on function public.analytics_summary(timestamptz, timestamptz, boolean, text, boolean) from public;
revoke execute on function public.analytics_summary(timestamptz, timestamptz, boolean, text, boolean) from anon;
grant execute on function public.analytics_summary(timestamptz, timestamptz, boolean, text, boolean) to authenticated;

-- analytics_summary (the dashboard read) is authenticated-only — anon can
-- still INSERT into analytics_events (tracking works for every visitor, see
-- the analytics_anon_insert policy above), but reading the aggregated
-- dashboard requires a logged-in Admin session.

-- ── Month index — drives the dashboard's month picker ─────────────────────
-- Cannot live inside analytics_summary: the picker needs the list of months
-- BEFORE a month can be chosen. Split by format so the picker and the History
-- tab both know what exists where. Bucketed in Israel time like every other
-- calendar bucket in this file (see header) — a UTC month boundary would misfile
-- events in the 21:00–00:00 window.
create or replace function public.analytics_months()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t order by t.month desc), '[]'::jsonb) from (
    select (date_trunc('month', created_at at time zone 'Asia/Jerusalem'))::date as month,
           count(*) filter (where session_id is not null or region is not null) as new_events,
           count(*) filter (where session_id is null and region is null)        as legacy_events
    from public.analytics_events
    group by 1
  ) t;
$$;

revoke all on function public.analytics_months() from public;
revoke execute on function public.analytics_months() from anon;
grant execute on function public.analytics_months() to authenticated;
