-- Shabi Israel — External Source scheduled sync trigger
-- Independent of sql/supabase_schema.sql and sql/analytics_poc.sql.
--
-- Runs entirely inside Postgres (pg_cron + pg_net): every SYNC_TICK_MINUTES,
-- checks which leagues' `external_source_sync` settings say a run is due
-- right now, and fires a GitHub `workflow_dispatch` for each — no external
-- server, no PAT in any client-side code. The GitHub PAT lives encrypted in
-- Supabase Vault and is only ever read inside a SECURITY DEFINER function.
--
-- The dispatched workflow (.github/workflows/sync-source.yml) already writes
-- to matches/match_history via service_role (Build C) — those writes already
-- flow through log_audit_event() and show up in Historical Changes tagged
-- 'external-source-automation' (Build H). Nothing more is needed there.
--
-- KNOWN SIMPLIFICATION (documented, not solved): `external_source_sync.times`
-- (HH:MM strings, set in League Manager) are interpreted here in UTC. The
-- admin UI collects them via a plain <input type="time">, so there is no
-- timezone captured at the source — treat this as an approximation until the
-- UI is changed to record a timezone explicitly.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Trigger-attempt log (idempotency guard + audit trail for dispatches) ───
create table if not exists public.external_source_sync_log (
  id           bigint generated always as identity primary key,
  league_id    text not null references public.leagues(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  trigger_kind text not null check (trigger_kind in ('scheduled', 'manual')),
  request_id   bigint  -- pg_net's net.http_post request id; correlate with net._http_response later if needed
);

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
  league_id  text not null references public.leagues(id) on delete cascade,
  run_id     text,
  created_at timestamptz not null default now(),
  level      text not null default 'info' check (level in ('info', 'success', 'error')),
  message    text not null
);

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

-- ── Shared dispatch helper ──────────────────────────────────────────────
-- Fires one workflow_dispatch call for one league and logs the attempt.
create or replace function public._dispatch_external_source_sync(p_league_id text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pat text;
  sync_cfg jsonb;
  source_name text;
  req_id bigint;
begin
  select decrypted_secret into pat from vault.decrypted_secrets where name = 'github_dispatch_pat';
  if pat is null then
    raise exception 'external_source_scheduler: vault secret "github_dispatch_pat" is not set';
  end if;

  select external_source_sync into sync_cfg from public.leagues where id = p_league_id;
  source_name := coalesce(sync_cfg->>'sourceLeagueName', p_league_id);

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
        -- Manual "Run now" wants an immediate result, so it uses fast mode
        -- (~20s). Scheduled runs stay on full mode for the anti-bot disguise.
        'mode', case when p_kind = 'manual' then 'fast' else 'full' end,
        'leagues', jsonb_build_array(jsonb_build_object('folder', p_league_id, 'source_league_name', source_name))::text
      )
    )
  ) into req_id;

  insert into public.external_source_sync_log (league_id, trigger_kind, request_id)
  values (p_league_id, p_kind, req_id);
end;
$$;

revoke all on function public._dispatch_external_source_sync(text, text) from public;

-- ── Scheduled check — run by pg_cron every SYNC_TICK_MINUTES ────────────
create or replace function public.check_and_trigger_external_source_syncs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  lg record;
  tick_minutes int := 15; -- must match the cron.schedule interval below
  hhmm text;
  due boolean;
begin
  for lg in
    select id, external_source_sync
    from public.leagues
    where external_source_sync->>'enabled' = 'true'
      and (external_source_sync->>'startDate' is null or (external_source_sync->>'startDate')::date <= current_date)
      and (external_source_sync->>'endDate' is null or (external_source_sync->>'endDate')::date >= current_date)
  loop
    due := false;
    for hhmm in select jsonb_array_elements_text(coalesce(lg.external_source_sync->'times', '[]'::jsonb))
    loop
      if to_timestamp(to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ' ' || hhmm, 'YYYY-MM-DD HH24:MI')
         between (now() at time zone 'utc') - (tick_minutes || ' minutes')::interval and (now() at time zone 'utc')
      then
        due := true;
      end if;
    end loop;

    if due and not exists (
      select 1 from public.external_source_sync_log
      where league_id = lg.id and trigger_kind = 'scheduled'
        and triggered_at > now() - (tick_minutes || ' minutes')::interval
    ) then
      perform public._dispatch_external_source_sync(lg.id, 'scheduled');
    end if;
  end loop;
end;
$$;

revoke all on function public.check_and_trigger_external_source_syncs() from public;

select cron.schedule(
  'external-source-sync-check',
  '*/15 * * * *', -- keep in sync with tick_minutes above
  $$select public.check_and_trigger_external_source_syncs()$$
);

-- ── "Run now" — immediate, single-league, called from the Admin UI ─────
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
