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

-- ── Table ────────────────────────────────────────────────────────────────
drop function if exists public.analytics_summary(timestamptz, timestamptz);
drop table if exists public.analytics_events;

create table public.analytics_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  event_type    text not null check (event_type in ('pageview','duration','click')),
  path          text,
  page          text check (page in ('landing','league','league_table','player','player_league')),
  league_id     text,
  player        text,
  -- Internal page-to-page navigation, derived client-side from document.referrer
  -- (a standard browser-navigation property, not an added tracking identifier).
  -- Populated only when the referrer was this same site.
  from_page     text check (from_page in ('landing','league','league_table','player','player_league')),
  referrer_kind text check (referrer_kind in ('direct','search','social','internal','other')),
  device_type   text check (device_type in ('mobile','tablet','desktop')),
  os            text,
  browser       text,
  duration_ms   int,            -- duration events only
  click_target  text            -- click events only
);

create index idx_analytics_created_at on public.analytics_events (created_at);
create index idx_analytics_page       on public.analytics_events (page);
create index idx_analytics_event_type on public.analytics_events (event_type);

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
    'timeseries',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select date_trunc('day', created_at) as day, count(*) as views from ev
                           where event_type='pageview' group by 1 order by 1) t),

    -- Traffic heatmap: day-of-week (0=Sunday) x hour-of-day, pageview counts only.
    'by_hour_dow',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select extract(dow from created_at)::int as dow,
                                  extract(hour from created_at)::int as hour,
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
    'transitions',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select from_page, page as to_page, count(*) as n
                           from ev
                           where event_type='pageview' and from_page is not null and page is not null
                           group by 1, 2 order by n desc limit 20) t)
  );
$$;

revoke all on function public.analytics_summary(timestamptz, timestamptz) from public;
grant execute on function public.analytics_summary(timestamptz, timestamptz) to anon;

-- POC tradeoff (documented): analytics_summary is granted to anon so the
-- dashboard works without auth. Upgrade path: restrict execute to
-- `authenticated` and put analytics.html behind Supabase Auth once the
-- Admin Auth migration (this repo's Phase E) has landed.
