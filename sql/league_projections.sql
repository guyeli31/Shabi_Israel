-- Shabi Israel — Projection cache (Title Race chart)
-- Spec: docs/data-architecture/05-projection-cache.md
--
-- PURELY ADDITIVE. No existing table, column, trigger, policy or function is
-- altered or dropped. Nothing in the app reads this until the read path ships,
-- and the chart keeps its client-side fallback either way — so applying this
-- file on its own changes nothing a visitor can see.
--
-- WHY THIS TABLE EXISTS
-- The chart asks, for every update point of a league, what each player's odds
-- of a top-X finish were at that moment. That is a Monte Carlo projection, ~1.1s
-- per point at full accuracy: 98 seconds for one league, paid by every visitor
-- on every visit, for an answer identical for all of them — and not even
-- identical, since Monte Carlo is random and a refresh gives a different number.
-- Computing it once, server-side, when the data changes makes it both free to
-- read and stable enough to quote.
--
-- SHAPE: ONE ROW PER LEAGUE. The chart reads a whole league or nothing, and the
-- repetition across a season's points is exactly what Postgres' compression
-- exploits: 308 KB of raw values store as ~16 KB. Per-point rows cannot see that
-- repetition (each row compresses alone) and measured 144 KB against 56 KB.
-- See the doc's "Why one row per league" for the measurements, including the
-- one that first argued the opposite by counting un-vacuumed dead rows.

-- ============================================================================
-- league_projections
-- ============================================================================

create table if not exists public.league_projections (
  league_id   text primary key references public.leagues(id) on delete cascade,

  -- The player roster the positional arrays index into.
  -- APPEND-ONLY: position i must mean the same player for the life of the
  -- league. A player joining mid-season is appended; nobody is reordered and
  -- nobody is removed. An older point simply carries fewer entries than the
  -- roster, which reads as "they were not in that projection". The writer
  -- enforces this (scripts/lib/projectionWriter.js); it is not an assumption.
  roster      text[] not null,

  -- One entry per update point, OLDEST FIRST:
  --   { "at":   "<iso timestamp>",       -- match_history.updated_at
  --     "ord":  <1-based within that instant>,
  --     "hash": "<inputs fingerprint>",  -- see below
  --     "r":    [[p1,p2,…,p10], …] }     -- per roster position, cumulative
  --                                      -- P(finish in top N) × 1000
  --
  -- `hash` is PER POINT, not per league, and that is load-bearing: an admin
  -- correcting a result from match 30 of 250 leaves points 1-29 perfectly valid.
  -- A single league-level hash would flag the whole chart as stale, including
  -- the parts that are correct. The client recomputes each hash from data it
  -- already holds and compares — so staleness is a property of the data, not an
  -- inference about whether a background job happens to be running.
  points      jsonb not null default '[]'::jsonb,

  -- How many Monte Carlo iterations produced these numbers. Stored per row so a
  -- future raise can roll out league by league without invalidating everything.
  iterations  int not null,

  computed_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.league_projections is
  'Precomputed title-race projections, one row per league. See docs/data-architecture/05-projection-cache.md.';

-- Row-level security: the projections are derived from data that is already
-- public (matches, results), so reads are open exactly like every other public
-- table here. Writes are service_role only — the sync job is the sole writer.
alter table public.league_projections enable row level security;

drop policy if exists league_projections_anon_select on public.league_projections;
create policy league_projections_anon_select
  on public.league_projections for select to anon using (true);

drop policy if exists league_projections_authenticated_select on public.league_projections;
create policy league_projections_authenticated_select
  on public.league_projections for select to authenticated using (true);

grant select on public.league_projections to anon, authenticated;
grant all    on public.league_projections to service_role;

-- The generic mtime trigger IS wanted here: unlike match_history.updated_at
-- (domain data — when a result changed), this column is a plain row mtime and
-- nothing reads it as anything else.
drop trigger if exists set_updated_at on public.league_projections;
create trigger set_updated_at
  before update on public.league_projections
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Dispatch: recompute when a league's history changes
-- ============================================================================
--
-- match_history is the input; when it moves, the projections behind it are
-- stale. This fires the same GitHub workflow_dispatch path the External Source
-- scheduler already uses (sql/external_source_scheduler.sql — Vault PAT +
-- pg_net), so there is one mechanism for "the database asks the outside world
-- to run some Node", not two.
--
-- COALESCED, and that matters: an admin publishing five corrections must not
-- queue five full recomputes. A request is recorded per league; the queue holds
-- at most one pending entry per league, and the dispatcher claims it.

-- Three timestamps, three different questions, and conflating any two of them
-- breaks the queue:
--   requested_at  — when the data changed
--   dispatched_at — when GitHub was last ASKED to run (debounce only)
--   claimed_at    — when a job actually TOOK the work
-- The first version stamped dispatched_at on asking and then claimed only rows
-- where it was null, so asking GitHub to run made the work invisible to the run
-- it had just asked for.
create table if not exists public.projection_queue (
  league_id     text primary key references public.leagues(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  dispatched_at timestamptz,
  claimed_at    timestamptz,
  reason        text
);

-- Older installs predate claimed_at.
alter table public.projection_queue add column if not exists claimed_at timestamptz;

alter table public.projection_queue enable row level security;
grant all on public.projection_queue to service_role;

create or replace function public.request_projection_refresh(p_league_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.projection_queue (league_id, requested_at, dispatched_at, reason)
  values (p_league_id, now(), null, p_reason)
  on conflict (league_id) do update
    set requested_at = now(),
        claimed_at = null,             -- supersede: the work is outstanding again
        reason = excluded.reason;

  -- Ask GitHub to run the job NOW. The queue alone would be drained by the
  -- workflow's schedule, but a result published at 14:01 should not wait until
  -- 14:30 to appear on the chart — the recompute takes ~80 seconds and there is
  -- no reason for the delay to be measured in tens of minutes.
  perform public._dispatch_projection_run();
exception
  when others then
    -- The QUEUE ENTRY IS THE CONTRACT; the dispatch is only an accelerator.
    -- If the Vault secret is missing, pg_net is unavailable (local Docker), or
    -- GitHub is down, the work stays queued and the schedule picks it up. This
    -- must never take down the admin's publish, which is the transaction this
    -- trigger is running inside.
    raise warning 'projection dispatch failed (work stays queued): %', sqlerrm;
end $$;

/**
 * Fire ONE workflow_dispatch for the projection job.
 *
 * Debounced, and that is the point of the timestamp check: an admin publishing
 * five corrections fires this five times within a second. The queue already
 * coalesces the WORK (one row per league); this coalesces the ASKING, so five
 * edits cost one workflow run rather than five.
 *
 * Mirrors _dispatch_external_source_sync() in sql/external_source_scheduler.sql
 * — same Vault secret, same pg_net call, same User-Agent requirement. The `ref`
 * is the branch whose code runs; keep it pointed at the branch that actually
 * holds the scripts.
 */
create or replace function public._dispatch_projection_run()
returns void language plpgsql security definer set search_path = public as $$
declare
  pat text;
  recent timestamptz;
  req_id bigint;
begin
  -- Debounce: a dispatch in the last 2 minutes covers anything queued since.
  select max(dispatched_at) into recent from public.projection_queue;
  if recent is not null and recent > now() - interval '2 minutes' then
    return;
  end if;

  select decrypted_secret into pat from vault.decrypted_secrets where name = 'github_dispatch_pat';
  if pat is null then
    raise warning 'projection dispatch skipped: vault secret "github_dispatch_pat" is not set';
    return;
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/guyeli31/Shabi_Israel/actions/workflows/project-title-race.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || pat,
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json',
      'User-Agent', 'shabi-israel-projections'   -- GitHub REST 403s a UA-less request
    ),
    body := jsonb_build_object('ref', 'development')
  ) into req_id;

  -- Record the ask (for debouncing only). Deliberately NOT claimed_at: the run
  -- being asked for has not taken the work yet, and marking it here would hide
  -- the work from it.
  update public.projection_queue set dispatched_at = now();
end $$;

revoke all on function public._dispatch_projection_run() from public;

comment on function public.request_projection_refresh(text, text) is
  'Mark a league as needing a projection recompute. Idempotent per league — repeated calls coalesce into one pending entry.';

-- The trigger. Statement-level (not per row): one publish rewrites many
-- match_history rows, and that is ONE reason to recompute, not two hundred.
create or replace function public.projections_on_history_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ids text[];
begin
  if (tg_op = 'DELETE') then
    select array_agg(distinct league_id) into ids from old_rows;
  else
    select array_agg(distinct league_id) into ids from new_rows;
  end if;
  if ids is not null then
    perform public.request_projection_refresh(unnest, 'match_history ' || lower(tg_op))
    from unnest(ids) as unnest;
  end if;
  return null;
end $$;

drop trigger if exists projections_history_ins on public.match_history;
create trigger projections_history_ins
  after insert on public.match_history
  referencing new table as new_rows
  for each statement execute function public.projections_on_history_change();

drop trigger if exists projections_history_upd on public.match_history;
create trigger projections_history_upd
  after update on public.match_history
  referencing new table as new_rows
  for each statement execute function public.projections_on_history_change();

drop trigger if exists projections_history_del on public.match_history;
create trigger projections_history_del
  after delete on public.match_history
  referencing old table as old_rows
  for each statement execute function public.projections_on_history_change();

-- ============================================================================
-- Claiming work
-- ============================================================================
-- The job asks "what needs recomputing?" and marks what it took. Returning the
-- claimed ids in one statement keeps a second dispatcher from taking the same
-- league — there is only one dispatcher today, but a queue that relies on that
-- is a queue that breaks the first time there are two.

-- NOTE the shape: the rows are picked in a FROM sub-select, not an `IN (…)`.
-- `FOR UPDATE SKIP LOCKED` needs its own scan to lock, and the OUT parameter
-- `league_id` otherwise collides with the column name inside the subquery.
create or replace function public.claim_projection_work(p_limit int default 5)
returns table (out_league_id text) language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.projection_queue q
     set claimed_at = now()
    from (
      select pq.league_id
        from public.projection_queue pq
       -- Unclaimed, or claimed so long ago that the job that took it is gone.
       -- Without the second clause a crashed run would strand its league until
       -- the next data change happened to re-queue it.
       where pq.claimed_at is null
          or pq.claimed_at < now() - interval '30 minutes'
       order by pq.requested_at
       limit p_limit
       for update skip locked
    ) picked
   where q.league_id = picked.league_id
  returning q.league_id;
end $$;

-- Called by the job once a league's projection is safely written. Until then the
-- row stays, so a failed run leaves the work outstanding rather than silently
-- dropping it.
create or replace function public.complete_projection_work(p_league_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.projection_queue where league_id = p_league_id;
end $$;

grant execute on function public.complete_projection_work(text) to service_role;

grant execute on function public.request_projection_refresh(text, text) to service_role;
grant execute on function public.claim_projection_work(int) to service_role;

-- ============================================================================
-- Applying this file
-- ============================================================================
--   psql "$DATABASE_URL" -f sql/league_projections.sql
--
-- Safe to re-run: every object is create-if-not-exists or create-or-replace,
-- and the policies/triggers are dropped before being recreated.
--
-- To undo entirely:
--   drop trigger if exists projections_history_ins on public.match_history;
--   drop trigger if exists projections_history_upd on public.match_history;
--   drop trigger if exists projections_history_del on public.match_history;
--   drop function if exists public.projections_on_history_change();
--   drop function if exists public.claim_projection_work(int);
--   drop function if exists public.request_projection_refresh(text, text);
--   drop table if exists public.projection_queue;
--   drop table if exists public.league_projections;
