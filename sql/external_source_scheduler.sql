-- Shabi Israel — External Source scheduled sync trigger (plan-driven)
-- Independent of sql/supabase_schema.sql and sql/analytics_poc.sql.
--
-- Runs entirely inside Postgres (pg_cron + pg_net): every SYNC_TICK_MINUTES,
-- checks which SYNC PLANS say a run is due right now, and for each due plan
-- fires a GitHub `workflow_dispatch` for every member league that is still
-- Running and has a source-site name configured — no external server, no PAT
-- in any client-side code. The GitHub PAT lives encrypted in Supabase Vault and
-- is only ever read inside a SECURITY DEFINER function.
--
-- SCHEDULE MODEL (rewritten 2026-07): sync is no longer per-league. The Admin
-- "Sync" page edits leagues/sync_settings.json (staged → published), which the
-- publish path mirrors into two tables here:
--   • sync_plans          — one row per named plan (schedule + enabled + dates)
--   • sync_plan_members    — which leagues belong to each plan (many-to-many)
-- Plus leagues.source_league_name — the per-league source-site search name that
-- the dispatch needs and that gates membership (no name → never dispatched).
--
-- The dispatched workflow (.github/workflows/sync-source.yml) writes to
-- matches/match_history via service_role (Build C); those writes flow through
-- log_audit_event() and show up in Historical Changes tagged
-- 'external-source-automation' (Build H). Nothing more is needed there.
--
-- TIMES ARE LOCAL (Asia/Jerusalem), not UTC. The admin UI collects them via a
-- plain <input type="time"> with no timezone, so "11:24" means 11:24 in Israel;
-- check_and_trigger_external_source_syncs() compares against
-- `now() at time zone 'Asia/Jerusalem'` (DST-safe). Was UTC until 2026-07-11 —
-- which fired every plan 3 hours late in local terms.
--
-- The fire time is still an APPROXIMATION, by design:
--   • the cron ticks every 15 min, so a plan time fires at the first tick at or
--     after it (up to ~15 min late — e.g. 11:24 fires on the 11:30 tick);
--   • the "±1h randomization" disguise then comes from the sync job's full-mode
--     anti-bot delays (pre-delay + a randomised action sequence in which the real
--     export can sit anywhere), not from a scheduler-side jitter.
--
-- This file is idempotent: safe to re-run after every schema change.

-- pg_cron / pg_net drive the scheduled dispatch. They exist on Supabase cloud
-- (and Supabase-local), but a bare local Postgres may lack them. Guard each so a
-- missing extension only skips scheduling — it must NOT roll back the whole
-- migration (which would leave the tables uncreated and Admin publishes failing).
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable (%): scheduled auto-sync will not run here; tables/functions still created.', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable (%): dispatch will not run here; tables/functions still created.', sqlerrm;
end $$;

-- ── Per-league source-site name (dispatch input + membership gate) ─────────
alter table public.leagues add column if not exists source_league_name text;

-- ── Named sync plans (mirrored from leagues/sync_settings.json on publish) ──
create table if not exists public.sync_plans (
  id            text primary key,          -- 'default' is reserved; others are timestamp ids
  name          text not null,
  enabled       boolean not null default true,
  mode          text not null default 'full' check (mode in ('full', 'fast')),
  times         jsonb not null default '[]'::jsonb,  -- array of 'HH:MM' strings (UTC)
  jitter_minutes int not null default 60,
  start_date    date,
  end_date      date,
  updated_at    timestamptz not null default now()
);

-- Admin writes as the `authenticated` role (anon key + Auth session + RLS), per
-- the project's flat "any authenticated = admin" model (see supabase_schema.sql).
-- So authenticated needs full DML + an all-command RLS policy, not just select —
-- the Sync page publish upserts/deletes plans + members directly.
alter table public.sync_plans enable row level security;
drop policy if exists sync_plans_authenticated_select on public.sync_plans;
drop policy if exists sync_plans_authenticated_all on public.sync_plans;
create policy sync_plans_authenticated_all on public.sync_plans for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.sync_plans to authenticated;

-- Seed the reserved 'default' plan so it always exists (the Admin UI treats
-- id='default' as un-deletable "Nightly Sync"). Idempotent — never clobbers an
-- edited default on re-run.
insert into public.sync_plans (id, name, enabled, mode, times, jitter_minutes)
values ('default', 'Nightly Sync', true, 'full', '["03:00"]'::jsonb, 60)
on conflict (id) do nothing;

create table if not exists public.sync_plan_members (
  plan_id    text not null references public.sync_plans(id) on delete cascade,
  league_id  text not null references public.leagues(id) on delete cascade,
  primary key (plan_id, league_id)
);

create index if not exists idx_sync_plan_members_league on public.sync_plan_members (league_id);

alter table public.sync_plan_members enable row level security;
drop policy if exists sync_plan_members_authenticated_select on public.sync_plan_members;
drop policy if exists sync_plan_members_authenticated_all on public.sync_plan_members;
create policy sync_plan_members_authenticated_all on public.sync_plan_members for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.sync_plan_members to authenticated;

-- ── Trigger-attempt log (idempotency guard + audit trail for dispatches) ───
create table if not exists public.external_source_sync_log (
  id           bigint generated always as identity primary key,
  league_id    text not null references public.leagues(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  trigger_kind text not null check (trigger_kind in ('scheduled', 'manual')),
  request_id   bigint  -- pg_net's net.http_post request id; correlate with net._http_response later if needed
);

-- Per-(plan,league) idempotency needs to know which plan fired a scheduled row.
alter table public.external_source_sync_log add column if not exists plan_id text;

create index if not exists idx_ess_log_league_time on public.external_source_sync_log (league_id, triggered_at desc);

alter table public.external_source_sync_log enable row level security;
drop policy if exists ess_log_authenticated_select on public.external_source_sync_log;
create policy ess_log_authenticated_select on public.external_source_sync_log for select to authenticated using (true);
grant select on public.external_source_sync_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── Live progress events — streamed by the sync job, shown in the Admin UI ──
-- The GitHub sync job inserts one plain-language row per milestone (via the
-- service_role key, which bypasses RLS). The Admin UI polls these to render a
-- live activity log. Authored ONLY by the job — Postgres never composes these
-- messages, it just stores and serves them.
create table if not exists public.external_source_sync_events (
  id         bigint generated always as identity primary key,
  league_id  text references public.leagues(id) on delete cascade,
  run_id     text,
  created_at timestamptz not null default now(),
  level      text not null default 'info' check (level in ('info', 'success', 'error', 'warning')),
  message    text not null
);

-- 'warning' was added after the table shipped ("it worked, but you should know" —
-- e.g. a match whose only result is a manual override, which the source correctly
-- reports as unplayed). Distinct from 'error', which means nothing was written.
-- Re-point the constraint on an already-created table.
do $$
begin
  alter table public.external_source_sync_events drop constraint if exists external_source_sync_events_level_check;
  alter table public.external_source_sync_events
    add constraint external_source_sync_events_level_check
    check (level in ('info', 'success', 'error', 'warning'));
end $$;

-- league_id is NULLABLE: a null row is a SITE-LEVEL event (connecting / login),
-- shared across the whole run rather than tied to one league — the Admin Run Now
-- log shows those once in its global log, while per-league cards show only their
-- own league_id rows. (drop-not-null also migrates an already-created table.)
alter table public.external_source_sync_events alter column league_id drop not null;

create index if not exists idx_ess_events_league_time on public.external_source_sync_events (league_id, created_at);

alter table public.external_source_sync_events enable row level security;
drop policy if exists ess_events_authenticated_select on public.external_source_sync_events;
create policy ess_events_authenticated_select on public.external_source_sync_events for select to authenticated using (true);
grant select on public.external_source_sync_events to authenticated;
-- The GitHub sync job writes these rows with the service_role key. New tables do
-- not always inherit service_role privileges, so grant them explicitly (insert +
-- delete for the 14-day retention prune). Without this the job's insert is
-- silently rejected and the live log stays empty.
grant select, insert, delete on public.external_source_sync_events to service_role;

-- ── Source-name resolver ───────────────────────────────────────────────────
-- The name the source site is searched by. Prefer the dedicated column; fall
-- back to the legacy per-league ExternalSourceSync jsonb (pre-plan model), then
-- to the folder id as a last resort.
create or replace function public._source_league_name(p_league_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(source_league_name, '') from public.leagues where id = p_league_id),
    (select nullif(external_source_sync->>'sourceLeagueName', '') from public.leagues where id = p_league_id),
    p_league_id
  );
$$;

-- ── Single-league dispatch helper ──────────────────────────────────────────
-- Fires one workflow_dispatch call for one league and logs the attempt.
-- p_plan_id is null for manual "Run now" dispatches.
create or replace function public._dispatch_external_source_sync(
  p_league_id text,
  p_kind text,
  p_plan_id text default null,
  p_mode text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pat text;
  source_name text;
  run_mode text;
  req_id bigint;
begin
  select decrypted_secret into pat from vault.decrypted_secrets where name = 'github_dispatch_pat';
  if pat is null then
    raise exception 'external_source_scheduler: vault secret "github_dispatch_pat" is not set';
  end if;

  source_name := public._source_league_name(p_league_id);
  -- Manual "Run now" wants an immediate result (fast, ~20s). Scheduled runs use
  -- the plan's mode (default full, for the anti-bot disguise).
  run_mode := coalesce(p_mode, case when p_kind = 'manual' then 'fast' else 'full' end);

  select net.http_post(
    url := 'https://api.github.com/repos/guyeli31/Shabi_Israel/actions/workflows/sync-source.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || pat,
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'shabi-israel-sync'  -- GitHub REST rejects UA-less requests with 403
    ),
    body := jsonb_build_object(
      -- Which branch's workflow + code actually runs. Dispatch is still only
      -- *accepted* because sync-source.yml exists on the default branch (main),
      -- but the run itself checks out this ref. Point it at the branch that
      -- holds the current code. Flip back to 'main' at cutover.
      'ref', 'development',
      'inputs', jsonb_build_object(
        'mode', run_mode,
        'leagues', jsonb_build_array(jsonb_build_object('folder', p_league_id, 'source_league_name', source_name))::text
      )
    )
  ) into req_id;

  insert into public.external_source_sync_log (league_id, trigger_kind, request_id, plan_id)
  values (p_league_id, p_kind, req_id, p_plan_id);
end;
$$;

revoke all on function public._dispatch_external_source_sync(text, text, text, text) from public;

-- ── Multi-league dispatch helper (one workflow run, sequential leagues) ─────
-- Used by "Run now" when several leagues are selected: a single workflow_dispatch
-- carrying a LEAGUES array. sync-source.js loops the array in one browser session
-- (runAllExports), and each league still streams its own progress events. One log
-- row per league is written so external_source_sync_status() resolves per league.
drop function if exists public._dispatch_external_source_sync_multi(text[], text, text);

create or replace function public._dispatch_external_source_sync_multi(
  p_league_ids text[],
  p_kind text,
  p_mode text default 'fast',
  p_plan_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pat text;
  leagues_json jsonb := '[]'::jsonb;
  lid text;
  req_id bigint;
begin
  if p_league_ids is null or array_length(p_league_ids, 1) is null then
    raise exception 'external_source_scheduler: no leagues supplied to multi-dispatch';
  end if;

  select decrypted_secret into pat from vault.decrypted_secrets where name = 'github_dispatch_pat';
  if pat is null then
    raise exception 'external_source_scheduler: vault secret "github_dispatch_pat" is not set';
  end if;

  foreach lid in array p_league_ids loop
    leagues_json := leagues_json || jsonb_build_object('folder', lid, 'source_league_name', public._source_league_name(lid));
  end loop;

  select net.http_post(
    url := 'https://api.github.com/repos/guyeli31/Shabi_Israel/actions/workflows/sync-source.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || pat,
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'shabi-israel-sync'
    ),
    body := jsonb_build_object(
      'ref', 'development',
      'inputs', jsonb_build_object(
        'mode', p_mode,
        'leagues', leagues_json::text
      )
    )
  ) into req_id;

  foreach lid in array p_league_ids loop
    insert into public.external_source_sync_log (league_id, trigger_kind, request_id, plan_id)
    values (lid, p_kind, req_id, p_plan_id);
  end loop;
end;
$$;

revoke all on function public._dispatch_external_source_sync_multi(text[], text, text, text) from public;

-- ── Scheduled check — run by pg_cron every SYNC_TICK_MINUTES ────────────
-- Iterates enabled, in-window plans; for each, dispatches ONE workflow run
-- carrying ALL of its member leagues that are still Running and have a source name.
--
-- ONE RUN PER PLAN (not per league): sync-source.js walks the LEAGUES array
-- sequentially inside a SINGLE browser session. Dispatching one workflow per
-- league instead starts N concurrent runs that all restore the SAME saved session
-- cookie and log into the source site with the same account at the same moment —
-- the site only holds one live session, so every run but the winner desynchronises
-- and dies with "tab not found" / "Leagues list did not render (state not ready)".
--
-- OVERLAP RULE: a league is dispatched AT MOST ONCE per tick, even if it belongs
-- to two plans whose times collide. Plans are processed OLDEST-FIRST ('default'
-- first, then by ascending id = ascending creation time), and the per-league
-- de-dup below ignores plan_id — so when two plans overlap on a league, the older
-- plan wins and the newer plan is suppressed for that league (its non-overlapping
-- leagues still run). This prevents double-syncing the same league.
--
-- REMAINING HAZARD (documented, not solved): two DIFFERENT plans scheduled at
-- ~the same time, with disjoint leagues, still produce two concurrent runs and
-- can race on the shared source-site session as above. Stagger plan times.
create or replace function public.check_and_trigger_external_source_syncs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl record;
  tick_minutes int := 15; -- must match the cron.schedule interval below
  hhmm text;
  due boolean;
  local_now timestamp;
  due_leagues text[];
begin
  -- Plan times are WALL-CLOCK IN THE LEAGUE'S LOCAL ZONE, not UTC: the admin types
  -- "11:24" into a plain <input type="time"> meaning 11:24 in Israel. Comparing in
  -- the named zone (rather than 'utc') also keeps DST correct automatically.
  local_now := now() at time zone 'Asia/Jerusalem';

  for pl in
    select id, times, start_date, end_date, mode
    from public.sync_plans
    where enabled = true
      and (start_date is null or start_date <= current_date)
      and (end_date is null or end_date >= current_date)
    order by (id <> 'default'), id  -- oldest-first: 'default', then ascending id (= creation time)
  loop
    due := false;
    for hhmm in select jsonb_array_elements_text(coalesce(pl.times, '[]'::jsonb))
    loop
      if to_timestamp(to_char(local_now, 'YYYY-MM-DD') || ' ' || hhmm, 'YYYY-MM-DD HH24:MI')
         between local_now - (tick_minutes || ' minutes')::interval and local_now
      then
        due := true;
      end if;
    end loop;

    if not due then
      continue;
    end if;

    -- Collect every eligible member league not already dispatched by an earlier
    -- (older) plan in this tick window, then fire ONE run for all of them.
    select coalesce(array_agg(l.id order by l.id), '{}'::text[])
      into due_leagues
    from public.sync_plan_members m
    join public.leagues l on l.id = m.league_id
    where m.plan_id = pl.id
      and l.running = true
      and public._source_league_name(l.id) is not null
      and not exists (
        select 1 from public.external_source_sync_log
        where league_id = l.id and trigger_kind = 'scheduled'
          and triggered_at > now() - (tick_minutes || ' minutes')::interval
      );

    if array_length(due_leagues, 1) is not null then
      perform public._dispatch_external_source_sync_multi(due_leagues, 'scheduled', pl.mode, pl.id);
    end if;
  end loop;
end;
$$;

revoke all on function public.check_and_trigger_external_source_syncs() from public;

-- Guarded so a missing pg_cron (e.g. bare local Postgres) doesn't roll back the
-- migration. On Supabase (cloud/local) this schedules normally.
do $$
begin
  perform cron.schedule(
    'external-source-sync-check',
    '*/15 * * * *', -- keep in sync with tick_minutes above
    $ct$select public.check_and_trigger_external_source_syncs()$ct$
  );
exception when others then
  raise notice 'cron.schedule skipped (%): pg_cron not available in this environment.', sqlerrm;
end $$;

-- Nudge PostgREST to refresh its schema cache so the new tables are queryable
-- immediately (otherwise the first Admin publish can still hit "schema cache").
notify pgrst, 'reload schema';

-- ── "Run now" — immediate, single league, called from the Admin UI ─────
create or replace function public.trigger_external_source_sync_now(p_league_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._dispatch_external_source_sync(p_league_id, 'manual');
end;
$$;

revoke all on function public.trigger_external_source_sync_now(text) from public;
grant execute on function public.trigger_external_source_sync_now(text) to authenticated;

-- ── "Run now" — immediate, several leagues in one workflow run ─────────
create or replace function public.trigger_external_source_sync_now_leagues(p_league_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._dispatch_external_source_sync_multi(p_league_ids, 'manual', 'fast');
end;
$$;

revoke all on function public.trigger_external_source_sync_now_leagues(text[]) from public;
grant execute on function public.trigger_external_source_sync_now_leagues(text[]) to authenticated;

-- ── Status probe — polled by the Admin UI after "Run now" ──────────────
-- Correlates the latest trigger-log row for a league with pg_net's async
-- HTTP response, so the UI can show the dispatch stage (pending → accepted /
-- rejected) without exposing the whole `net` schema to the anon/authenticated
-- role. Returns one jsonb row; `stage='none'` when nothing was ever triggered.
create or replace function public.external_source_sync_status(p_league_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.external_source_sync_log%rowtype;
  resp_status int;
  resp_error  text;
  resp_body   text;
begin
  select * into l
  from public.external_source_sync_log
  where league_id = p_league_id
  order by triggered_at desc
  limit 1;

  if not found then
    return jsonb_build_object('stage', 'none');
  end if;

  select status_code, error_msg, content
    into resp_status, resp_error, resp_body
  from net._http_response
  where id = l.request_id;

  if not found then
    return jsonb_build_object(
      'stage', 'pending', 'request_id', l.request_id, 'triggered_at', l.triggered_at
    );
  end if;

  return jsonb_build_object(
    'stage', case when resp_status between 200 and 299 then 'accepted' else 'rejected' end,
    'request_id', l.request_id,
    'trigger_kind', l.trigger_kind,
    'triggered_at', l.triggered_at,
    'status_code', resp_status,
    'error', case when resp_status >= 300
                  then left(coalesce(nullif(resp_error, ''), resp_body), 300)
                  else null end
  );
end;
$$;

revoke all on function public.external_source_sync_status(text) from public;
grant execute on function public.external_source_sync_status(text) to authenticated;

-- ── One-time manual step (run separately, never commit the real value) ──
-- select vault.create_secret(
--   '<PASTE-YOUR-GITHUB-PAT-HERE, repo+workflow scope>',
--   'github_dispatch_pat',
--   'PAT for triggering sync-source.yml workflow_dispatch from Postgres (pg_cron/pg_net)'
-- );
