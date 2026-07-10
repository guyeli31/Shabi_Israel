-- Shabi Israel — Query-strategy redesign, Phase 1 (additive only)
-- Spec: docs/data-architecture/01-architecture.md §A1, A3, A5
-- Applied: 2026-07-10 (local Docker only — see docs/data-architecture/README.md
-- phase-status table for whether/when this has also been applied to cloud).
--
-- Purely additive: no existing table, column, trigger, or policy is altered
-- or dropped. Old clients (current js/data/supabaseLoader.js) are completely
-- unaffected — nothing in the app reads these new objects yet. That happens
-- in Phase 2 (js/data/store.js + js/data/bundleMapper.js).
--
-- Companion files: sql/supabase_schema.sql (core schema this builds on),
-- sql/analytics_poc.sql, sql/external_source_scheduler.sql (independent,
-- no overlap).

-- ============================================================================
-- leagues.archived — pre-designed archive-split column (§A1). Not used by
-- any query yet; get_site_bundle()'s include_archived parameter exists from
-- day one so activating the split later needs no signature change.
-- ============================================================================

alter table public.leagues add column archived boolean not null default false;

-- ============================================================================
-- site_meta — singleton data-version counter (§A3)
-- ============================================================================

create table public.site_meta (
  id            int primary key default 1 check (id = 1),
  data_version  bigint not null default 1,
  updated_at    timestamptz not null default now()
);

insert into public.site_meta (id) values (1) on conflict (id) do nothing;

-- Statement-level (not row-level, unlike set_updated_at()/log_audit_event()
-- in sql/supabase_schema.sql) — a bulk scraper write touching hundreds of
-- rows in one statement bumps data_version exactly once, not once per row.
create or replace function public.bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.site_meta set data_version = data_version + 1, updated_at = now() where id = 1;
  return null; -- statement-level triggers ignore the return value
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['leagues','matches','manual_overrides','match_history','players_metadata','landing_settings']
  loop
    execute format(
      'create trigger trg_%I_bump_data_version after insert or update or delete on public.%I for each statement execute function public.bump_data_version();',
      t, t
    );
  end loop;
end;
$$;

alter table public.site_meta enable row level security;
create policy site_meta_anon_select on public.site_meta for select to anon using (true);
create policy site_meta_authenticated_select on public.site_meta for select to authenticated using (true);

grant select on public.site_meta to anon, authenticated;
grant all on public.site_meta to service_role;

-- ============================================================================
-- get_site_bundle() — single-RPC snapshot of the whole public read surface
-- (§A5). security invoker: returns exactly what the calling role's RLS
-- policies already allow (anon's existing select policies from
-- sql/supabase_schema.sql) — no new definer-privilege surface.
--
-- Deterministic ordering with a unique tiebreaker on every aggregate — this
-- is the structural fix for the two known-bugs-register items in
-- docs/data-architecture/00-current-state-map.md: the PostgREST 1000-row
-- default cap (moot here — one jsonb row, no pagination) and non-deterministic
-- ORDER BY (every jsonb_agg orders by a column set ending in a primary key).
--
-- created_at/updated_at are stripped from matches/manual_overrides/
-- players_metadata — pure audit metadata no page reads (see
-- 01-architecture.md §A1 payload-trimming note). leagues.last_updated and
-- match_history.updated_at are kept; pages use them.
-- ============================================================================

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
    )
  );
$$;

revoke all on function public.get_site_bundle(boolean) from public;
grant execute on function public.get_site_bundle(boolean) to anon, authenticated;
