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
create policy ess_log_authenticated_select on public.external_source_sync_log for select to authenticated using (true);
grant select on public.external_source_sync_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

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
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object(
        'mode', 'full',
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

-- ── One-time manual step (run separately, never commit the real value) ──
-- select vault.create_secret(
--   '<PASTE-YOUR-GITHUB-PAT-HERE, repo+workflow scope>',
--   'github_dispatch_pat',
--   'PAT for triggering sync-source.yml workflow_dispatch from Postgres (pg_cron/pg_net)'
-- );
