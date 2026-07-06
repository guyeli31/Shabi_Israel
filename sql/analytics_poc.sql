-- Shabi Israel — In-house anonymous analytics POC
-- Independent of sql/supabase_schema.sql: own table, own RLS shape
-- (insert-only for anon), no naming collisions with the 8 core tables.
--
-- Zero-correlation design: there is NO session/visitor identifier of any
-- kind (no session_id, no cookie, no sessionStorage on the client — see
-- js/analytics.js). Every row stands completely alone; no two rows can be
-- linked to "the same visit". This is a deliberate trade-off: it rules out
-- true per-visit session reconstruction (entry→exit timeline for one
-- distinguishable visitor), in exchange for being the equivalent, legally,
-- of a standard anonymous server access log — no online identifier, no
-- storage on the client's device, nothing to single out an individual.
-- Only bucketed/categorical fields are kept (no raw referrer URL, no exact
-- screen/viewport pixel dimensions) to avoid incidental fingerprinting.
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

-- Columns from the very first (pre zero-correlation-redesign) version of this
-- table. Drop them if an old deployment still has them; no-op otherwise.
alter table public.analytics_events drop column if exists session_id;
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
alter table public.analytics_events add constraint analytics_events_page_check check (page in ('landing','league','league_table','player','player_league'));

alter table public.analytics_events drop constraint if exists analytics_events_from_page_check;
alter table public.analytics_events add constraint analytics_events_from_page_check check (from_page in ('landing','league','league_table','player','player_league'));

alter table public.analytics_events drop constraint if exists analytics_events_referrer_kind_check;
alter table public.analytics_events add constraint analytics_events_referrer_kind_check check (referrer_kind in ('direct','search','social','internal','other'));

alter table public.analytics_events drop constraint if exists analytics_events_device_type_check;
alter table public.analytics_events add constraint analytics_events_device_type_check check (device_type in ('mobile','tablet','desktop'));

create index if not exists idx_analytics_created_at on public.analytics_events (created_at);
create index if not exists idx_analytics_page       on public.analytics_events (page);
create index if not exists idx_analytics_event_type on public.analytics_events (event_type);

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
create or replace function public.analytics_summary(from_date timestamptz, to_date timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ev as (
    select * from public.analytics_events
    where created_at >= from_date and created_at < to_date
  )
  select jsonb_build_object(
    'total_pageviews', (select count(*) from ev where event_type = 'pageview'),
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
    'by_referrer',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select referrer_kind, count(*) views from ev
                           where event_type='pageview' and referrer_kind is not null
                           group by referrer_kind order by views desc) t),

    -- Pageviews per calendar day, in Israel time (see header note re: UTC).
    'timeseries',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select (date_trunc('day', created_at at time zone 'Asia/Jerusalem'))::date as day,
                                  count(*) as views
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
    'clicks_log',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select created_at, page, league_id, player, click_target, device_type
                           from ev
                           where event_type='click'
                           order by created_at desc limit 500) t)
  );
$$;

revoke all on function public.analytics_summary(timestamptz, timestamptz) from public;
grant execute on function public.analytics_summary(timestamptz, timestamptz) to anon;

-- POC tradeoff (documented): analytics_summary is granted to anon so the
-- dashboard works without auth. Upgrade path: restrict execute to
-- `authenticated` and put analytics.html behind Supabase Auth once the
-- Admin Auth migration (this repo's Phase E) has landed.
