-- ============================================================================
-- gevkahoot_analytics.sql
-- GevKahoot analytics — what PLAYERS do (live and demo), read by an admin at
-- golan.me.uk/gevkahoot/analytics. The host's own work is not measured.
-- ============================================================================
-- The same principles as the main site's analytics (sql/analytics_poc.sql,
-- js/analytics.js), with two differences that come from how GevKahoot works:
--
--   1. A LIVE quiz is already recorded, exactly, by the quiz itself:
--      gk_sessions / gk_players / gk_answers / gk_relink_requests say who
--      joined, what they answered, how fast, and who dropped out. So the beacon
--      sends almost nothing during a live quiz (no event per question — thirty
--      phones beaconing every screen is load the server does not need), and
--      gk_analytics_runs() reads the quiz's own tables instead.
--   2. The DEMO has no backend at all, so there the beacon is the only record:
--      a 'stage' event per screen the player reaches, carrying the verdict at a
--      reveal.
--
-- Privacy (as on the main site): no IP is read or stored. `session_id` is a
-- random per-TAB id from sessionStorage, sent only for an Asia/Jerusalem
-- timezone or a signed-in operator; everyone else carries only a continent.
-- NEVER the device token (localStorage['gevkahoot:device']) or its hash — that
-- one persists across visits and would link them. The name a player types is
-- free text and is never sent; a LIVE player's name is shown to the admin only
-- from gk_players, where the quiz already holds it (it is on the projector).
--
-- Writes: anon calls gk_track(), a SECURITY DEFINER insert — no gk_* table is
-- writable by a browser role, this one included. Reads: gk_analytics_*(), each
-- of which starts with the allowlist check (_gk_require_admin), unlike the main
-- site's analytics RPCs, which admit any authenticated user.
--
-- SAFE and RE-RUNNABLE. Run order: AFTER sql/gevkahoot.sql. (gevkahoot.sql's
-- function-grant loop knows these names, so re-running it keeps them granted.)
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/gevkahoot_analytics.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
-- ============================================================================

begin;

create table if not exists public.gk_analytics_events (
    id            bigint generated always as identity primary key,
    created_at    timestamptz not null default now(),
    session_id    text,          -- per-tab visit id (Israel / signed-in route only)
    region        text,          -- continent (global route only)
    admin_user    text,          -- the OPERATOR's email local part, never a player
    event_type    text not null check (event_type in ('pageview', 'duration', 'click', 'stage')),
    page          text check (page in ('entry', 'handoff', 'legacy')),
    mode          text check (mode in ('browse', 'live', 'demo', 'saved')),
    quiz_id       uuid,          -- the saved quiz (saved demo) or the live quiz
    run_id        uuid,          -- gk_sessions.id of a live run
    phase         text,          -- the screen ('lobby', 'question', 'reveal', …)
    item_kind     text,
    item_no       smallint,
    correct       boolean,       -- demo 'stage' at a reveal: this player's verdict
    points        integer,
    click_target  text,
    device_type   text check (device_type in ('mobile', 'tablet', 'desktop')),
    os            text,
    browser       text,
    referrer_kind text check (referrer_kind in ('direct', 'search', 'social', 'internal', 'other')),
    from_page     text,
    duration_ms   integer
);
-- Added with the "Quizzes Opened" tab: which slide, by name, and how fast.
alter table public.gk_analytics_events add column if not exists item_id     text;     -- a uuid live, 'demo-q1' in the demo
alter table public.gk_analytics_events add column if not exists item_title  text;     -- the question as shown on screen
alter table public.gk_analytics_events add column if not exists answered_ms integer;  -- at a reveal: this player's time
create index if not exists gk_analytics_events_created on public.gk_analytics_events (created_at);

alter table public.gk_analytics_events enable row level security;
revoke all on public.gk_analytics_events from anon, authenticated;
grant all on public.gk_analytics_events to service_role;

-- ----------------------------------------------------------------------------
-- The beacon's one door. Takes a batch (at most 25), silently drops what does
-- not fit the shape — a beacon never gets an error back worth showing.
-- ----------------------------------------------------------------------------
create or replace function public._gk_uuid_or_null(p text)
returns uuid language sql immutable set search_path = public, pg_catalog as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

create or replace function public.gk_track(p_events jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 25 then return; end if;
  insert into public.gk_analytics_events
    (session_id, region, admin_user, event_type, page, mode, quiz_id, run_id, phase, item_kind,
     item_no, correct, points, item_id, item_title, answered_ms, click_target, device_type, os, browser, referrer_kind, from_page, duration_ms)
  select left(e->>'session_id', 40),
         case when e->>'region' in ('Africa','America','Antarctica','Arctic','Asia','Atlantic','Australia','Europe','Indian','Pacific','Other')
              then e->>'region' end,
         left(e->>'admin_user', 64),
         e->>'event_type',
         case when e->>'page' in ('entry', 'handoff', 'legacy') then e->>'page' end,
         case when e->>'mode' in ('browse', 'live', 'demo', 'saved') then e->>'mode' end,
         public._gk_uuid_or_null(e->>'quiz_id'),
         public._gk_uuid_or_null(e->>'run_id'),
         left(e->>'phase', 20),
         left(e->>'item_kind', 20),
         case when e->>'item_no' ~ '^\d{1,4}$' then (e->>'item_no')::smallint end,
         case e->>'correct' when 'true' then true when 'false' then false end,
         case when e->>'points' ~ '^-?\d{1,7}$' then (e->>'points')::integer end,
         left(e->>'item_id', 40),
         left(e->>'item_title', 120),
         case when e->>'answered_ms' ~ '^\d{1,7}$' then (e->>'answered_ms')::integer end,
         left(e->>'click_target', 120),
         case when e->>'device_type' in ('mobile', 'tablet', 'desktop') then e->>'device_type' end,
         left(e->>'os', 20),
         left(e->>'browser', 20),
         case when e->>'referrer_kind' in ('direct', 'search', 'social', 'internal', 'other') then e->>'referrer_kind' end,
         left(e->>'from_page', 40),
         case when e->>'duration_ms' ~ '^\d{1,9}$' then least((e->>'duration_ms')::bigint, 86400000)::integer end
    from jsonb_array_elements(p_events) e
   where jsonb_typeof(e) = 'object'
     and e->>'event_type' in ('pageview', 'duration', 'click', 'stage');
end;
$$;

-- ----------------------------------------------------------------------------
-- Admin reads.
-- ----------------------------------------------------------------------------
-- Months that hold anything — beacon events or a live run — newest first.
create or replace function public.gk_analytics_months()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform public._gk_require_admin();
  return coalesce((
    select jsonb_agg(m order by m desc)
      from (select distinct to_char(created_at at time zone 'Asia/Jerusalem', 'YYYY-MM') m
              from (select created_at from public.gk_analytics_events
                    union all select created_at from public.gk_sessions) x) t), '[]'::jsonb);
end;
$$;

-- Every beacon row in a range; the page filters and aggregates in the browser.
create or replace function public.gk_analytics_raw(from_date timestamptz, to_date timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform public._gk_require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(t) - 'id' order by t.created_at, t.id)   -- id: one batch shares one now()
      from (select * from public.gk_analytics_events
             where created_at >= from_date and created_at < to_date
             order by created_at desc, id desc limit 20000) t), '[]'::jsonb);
end;
$$;

-- Visit id → a stable serial (#1 = the first visit ever recorded), so a visit
-- has the same number in every month's view.
create or replace function public.gk_analytics_session_ordinals()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform public._gk_require_admin();
  return coalesce((
    select jsonb_object_agg(session_id, n)
      from (select session_id, row_number() over (order by min(created_at), session_id) as n
              from public.gk_analytics_events where session_id is not null
             group by session_id) t), '{}'::jsonb);
end;
$$;

-- The live runs in a range, read from the quiz's own tables. Items are listed
-- in the order they were first answered (= the order they were asked); an
-- item nobody answered has no row to date it by and is absent. Voided answers
-- (the host went back) are left out, as everywhere else in GevKahoot.
create or replace function public.gk_analytics_runs(from_date timestamptz, to_date timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform public._gk_require_admin();
  return coalesce((
    select jsonb_agg(run order by (run->>'created_at') desc)
      from (
        select jsonb_build_object(
          'id', s.id, 'quiz_id', s.quiz_id, 'quiz_title', s.quiz_title, 'status', s.status,
          'created_at', s.created_at, 'started_at', s.started_at, 'finished_at', s.finished_at,
          'relinks', (select jsonb_build_object(
                         'pending',  count(*) filter (where r.status = 'pending'),
                         'approved', count(*) filter (where r.status = 'approved'),
                         'rejected', count(*) filter (where r.status = 'rejected'))
                        from public.gk_relink_requests r where r.session_id = s.id),
          'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'no', it.no, 'item_id', it.item_id, 'kind', it.kind, 'title', it.title,
                      'answered', it.answered, 'correct', it.correct, 'median_ms', it.median_ms)
                    order by it.no)
               from (select a.item_id,
                            row_number() over (order by min(a.created_at)) as no,
                            coalesce(i.kind, '?') as kind, coalesce(i.title, '') as title,
                            count(*) as answered,
                            count(*) filter (where a.is_correct) as correct,
                            round(percentile_cont(0.5) within group (order by a.answered_ms))::int as median_ms
                       from public.gk_answers a
                       left join public.gk_items i on i.id = a.item_id
                      where a.session_id = s.id and not a.voided
                      group by a.item_id, i.kind, i.title) it), '[]'::jsonb),
          'players', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'name', p.name, 'joined_at', p.joined_at, 'last_seen', p.last_seen, 'kicked', p.kicked,
                      'answered', st.answered, 'correct', st.correct, 'points', st.points,
                      'last_answer_at', st.last_at)
                    order by st.points desc nulls last, p.joined_at)
               from public.gk_players p
               left join lateral (
                 select count(*) as answered, count(*) filter (where a.is_correct) as correct,
                        coalesce(sum(a.points), 0) as points, max(a.created_at) as last_at
                   from public.gk_answers a
                  where a.player_id = p.id and not a.voided) st on true
              where p.session_id = s.id), '[]'::jsonb)
        ) as run
          from public.gk_sessions s
         where s.created_at >= from_date and s.created_at < to_date
      ) t), '[]'::jsonb);
end;
$$;

-- Grants (the same shape as gevkahoot.sql §8, for this file's functions).
revoke all on function public._gk_uuid_or_null(text) from public, anon, authenticated;
revoke all on function public.gk_track(jsonb) from public, anon, authenticated;
grant execute on function public.gk_track(jsonb) to anon, authenticated;
revoke all on function public.gk_analytics_months() from public, anon, authenticated;
grant execute on function public.gk_analytics_months() to authenticated;
revoke all on function public.gk_analytics_raw(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.gk_analytics_raw(timestamptz, timestamptz) to authenticated;
revoke all on function public.gk_analytics_runs(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.gk_analytics_runs(timestamptz, timestamptz) to authenticated;
revoke all on function public.gk_analytics_session_ordinals() from public, anon, authenticated;
grant execute on function public.gk_analytics_session_ordinals() to authenticated;

commit;

notify pgrst, 'reload schema';
