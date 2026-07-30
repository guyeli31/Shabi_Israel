-- Shabi Israel — Phase 2 Supabase schema
-- Core league/admin data model + audit trail + storage buckets.
-- Run once in the Supabase SQL Editor (or via `supabase db push` locally).
-- Companion file: sql/analytics_poc.sql (separate table, no overlap).

-- ============================================================================
-- Tables
-- ============================================================================

create table public.leagues (
  id                    text primary key,
  title                 text not null,
  league_type           text not null,
  running               boolean not null default false,
  hidden                boolean not null default false,
  gold_count            int default 0,
  silver_count          int default 0,
  bronze_count          int default 0,
  match_length          int,
  issue_date            date,
  entry_fee             numeric default 0,
  prizes                jsonb default '{"Gold":0,"Silver":0,"Bronze":0}',
  custom_flags          jsonb default '{}',
  retired_players       jsonb default '[]',
  external_source_sync  jsonb,
  last_updated          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.matches (
  id          bigint generated always as identity primary key,
  league_id   text not null references public.leagues(id) on delete cascade,
  round       int not null default 1,
  player_a    text not null,
  player_b    text not null,
  pr_a numeric, luck_a numeric, score_a numeric,
  pr_b numeric, luck_b numeric, score_b numeric,
  played      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (league_id, round, player_a, player_b)
);

create index idx_matches_league on public.matches (league_id);

create table public.manual_overrides (
  id          bigint generated always as identity primary key,
  league_id   text not null references public.leagues(id) on delete cascade,
  player_a    text not null,
  player_b    text not null,
  type        text not null check (type in ('result','technical_win','technical_draw','not_played')),
  winner      text,
  score_a numeric, score_b numeric, pr_a numeric, pr_b numeric, luck_a numeric, luck_b numeric,
  reason      text,
  -- The admin-authored edit date (round editor's date picker). DOMAIN data:
  -- feeds match_history.updated_at so history reflects WHEN a result changed,
  -- not when a sync last ran. Distinct from updated_at (this row's mtime).
  edited_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (league_id, player_a, player_b)
);

create index idx_overrides_league on public.manual_overrides (league_id);

create table public.match_history (
  id          bigint generated always as identity primary key,
  league_id   text not null references public.leagues(id) on delete cascade,
  player_a    text not null,
  player_b    text not null,
  score_a numeric, score_b numeric, pr_a numeric, pr_b numeric, luck_a numeric, luck_b numeric,
  round       int,
  source      text not null check (source in ('csv','manual')),
  updated_at  timestamptz not null default now(),
  unique (league_id, player_a, player_b)
);

create index idx_match_history_league on public.match_history (league_id);

create table public.players_metadata (
  id                    text primary key,
  full_name             text,
  bmab_title            text,
  championship_titles   jsonb default '[]',
  hidden                boolean default false,
  photo_path            text,
  inactive              boolean default false,
  joined                text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.landing_settings (
  id             int primary key default 1 check (id = 1),
  title          text not null default 'Shabi Israel',
  subtitle       text,
  logo_path      text,
  display_order  jsonb not null default '[]',
  updated_at     timestamptz not null default now()
);

insert into public.landing_settings (id) values (1) on conflict (id) do nothing;

create table public.league_snapshots (
  id          bigint generated always as identity primary key,
  league_id   text not null references public.leagues(id) on delete cascade,
  created_at  timestamptz not null default now(),
  csv_content text,
  overrides   jsonb
);

create index idx_snapshots_league on public.league_snapshots (league_id);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_pk      text not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_value   jsonb,
  new_value   jsonb,
  changed_at  timestamptz not null default now(),
  changed_by  text
);

create index idx_audit_table on public.audit_log (table_name);
create index idx_audit_changed_at on public.audit_log (changed_at desc);

-- ============================================================================
-- Triggers: updated_at + audit log
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pk_value text;
begin
  -- restore_and_delete_audit_row() sets this (transaction-local) before it
  -- writes the restored row, so the "✕" purge flow doesn't leave a fresh
  -- audit_log entry behind for the restore itself — the whole point of "✕"
  -- is to erase the change from history, not just relabel it. The plain
  -- "Undo" button (restore_audit_row() called directly) never sets this, so
  -- it still logs normally and visibly shows the row was reverted.
  if coalesce(current_setting('app.suppress_audit', true), '') = 'true' then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  pk_value := case
    when TG_OP = 'DELETE' then (to_jsonb(old)->>'id')
    else (to_jsonb(new)->>'id')
  end;

  insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
  values (
    TG_TABLE_NAME,
    pk_value,
    TG_OP,
    case when TG_OP != 'INSERT' then to_jsonb(old) else null end,
    case when TG_OP != 'DELETE' then to_jsonb(new) else null end,
    coalesce(auth.email(), 'external-source-automation')
  );

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

-- Apply triggers to every data table (audit_log/league_snapshots excluded —
-- see A.4/H design notes: they're append-only from the app's perspective).
--
-- set_updated_at() is applied to every data table EXCEPT match_history:
-- match_history.updated_at is DOMAIN data — the reconcile (scripts/sync-source.js
-- + js/admin/supabaseAdmin.js) writes it explicitly to record when a pairing's
-- RESULT last changed, and the Historical view (B2) reads it as such. A blanket
-- before-update stamp would overwrite those real change-dates with now() on every
-- reconcile upsert and collapse the whole history to one timestamp. The audit
-- trigger still applies to all six tables.
do $$
declare
  t text;
begin
  foreach t in array array['leagues','matches','manual_overrides','players_metadata','landing_settings']
  loop
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
  foreach t in array array['leagues','matches','manual_overrides','match_history','players_metadata','landing_settings']
  loop
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.log_audit_event();', t, t);
  end loop;
end;
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.leagues            enable row level security;
alter table public.matches            enable row level security;
alter table public.manual_overrides   enable row level security;
alter table public.match_history      enable row level security;
alter table public.players_metadata   enable row level security;
alter table public.landing_settings   enable row level security;
alter table public.audit_log          enable row level security;
alter table public.league_snapshots   enable row level security;

-- anon: read-only on the 6 data tables
do $$
declare
  t text;
begin
  foreach t in array array['leagues','matches','manual_overrides','match_history','players_metadata','landing_settings']
  loop
    execute format('create policy %I_anon_select on public.%I for select to anon using (true);', t, t);
    execute format('create policy %I_authenticated_all on public.%I for all to authenticated using (true) with check (true);', t, t);
  end loop;
end;
$$;

-- audit_log: no anon policy at all (deny-all to anon). authenticated may
-- read (Historical Changes tab); no direct write policy — INSERT happens
-- only via the audit trigger (table owner) and the seed script (service_role,
-- bypasses RLS). The only sanctioned mutator is the restore_audit_row() RPC
-- below (SECURITY DEFINER).
create policy audit_log_authenticated_select on public.audit_log for select to authenticated using (true);

-- league_snapshots: unlike audit_log, this table has no populating trigger —
-- createSnapshot() (js/admin/supabaseAdmin.js) inserts directly as the logged
-- -in admin (authenticated role) from the Publish flow, so it needs its own
-- insert policy (append-only: no update/delete for authenticated).
create policy league_snapshots_authenticated_select on public.league_snapshots for select to authenticated using (true);
create policy league_snapshots_authenticated_insert on public.league_snapshots for insert to authenticated with check (true);

-- ============================================================================
-- Table-level GRANTs (separate from RLS — RLS only filters ROWS a role can
-- already attempt to touch; the role still needs a GRANT to touch the table
-- at all). service_role bypasses RLS but still needs these grants too.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.leagues, public.matches, public.manual_overrides,
  public.match_history, public.players_metadata, public.landing_settings
to anon;

grant select, insert, update, delete on
  public.leagues, public.matches, public.manual_overrides,
  public.match_history, public.players_metadata, public.landing_settings
to authenticated;

grant select on public.audit_log to authenticated;
grant select, insert on public.league_snapshots to authenticated;

grant all on
  public.leagues, public.matches, public.manual_overrides, public.match_history,
  public.players_metadata, public.landing_settings, public.audit_log, public.league_snapshots
to service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- ============================================================================
-- Historical Changes: undo RPC
-- ============================================================================

create or replace function public.restore_audit_row(log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.audit_log%rowtype;
  cols_all text;
  cols_no_id text;
begin
  select * into rec from public.audit_log where id = log_id;
  if not found then
    raise exception 'audit_log row % not found', log_id;
  end if;

  -- Full column list of the target table, used with jsonb_populate_record so
  -- every column gets its correct native type (numeric/boolean/jsonb/timestamptz),
  -- instead of naive text extraction which would fail to cast on non-text columns.
  -- "id" is excluded from the UPDATE column list because it's a generated
  -- identity column on several tables (matches/manual_overrides/match_history)
  -- and Postgres rejects assigning it directly; it never changes anyway since
  -- it's also the WHERE key. The INSERT (DELETE-undo) path still needs it, via
  -- OVERRIDING SYSTEM VALUE, so the restored row keeps its original id.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into cols_all
  from information_schema.columns
  where table_schema = 'public' and table_name = rec.table_name;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into cols_no_id
  from information_schema.columns
  where table_schema = 'public' and table_name = rec.table_name and column_name <> 'id';

  if rec.action = 'INSERT' then
    -- undo an insert => delete the row it created
    execute format('delete from public.%I where id = %L', rec.table_name, rec.row_pk);
  elsif rec.action = 'DELETE' then
    -- undo a delete => re-insert the old row, typed via jsonb_populate_record
    execute format(
      'insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, %L) r',
      rec.table_name, cols_all, cols_all, rec.table_name, rec.old_value
    );
  elsif rec.action = 'UPDATE' then
    -- undo an update => write every old_value column back over the current row
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, %L) r) where t.id = %L',
      rec.table_name, cols_no_id, cols_no_id, rec.table_name, rec.old_value, rec.row_pk
    );
  end if;
end;
$$;

revoke all on function public.restore_audit_row(bigint) from public;
grant execute on function public.restore_audit_row(bigint) to authenticated;

-- Undo + purge in one step (the "✕" button in Historical Changes): runs the
-- same restore as restore_audit_row(), then deletes the log_id row itself so
-- the undone change no longer shows up in the history list. The undo write
-- still goes through log_audit_event() like any other mutation, so a fresh
-- audit_log row for the restore itself is created — only the row being
-- undone is purged. (sql/audit_soft_purge.sql redefines this to archive the
-- purged row into audit_log_purged before deleting it, so it stays recoverable.)
create or replace function public.restore_and_delete_audit_row(log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- is_local => true: scoped to this transaction only, reset automatically
  -- once it commits — never leaks into any other request.
  perform set_config('app.suppress_audit', 'true', true);
  perform public.restore_audit_row(log_id);
  delete from public.audit_log where id = log_id;
end;
$$;

revoke all on function public.restore_and_delete_audit_row(bigint) from public;
grant execute on function public.restore_and_delete_audit_row(bigint) to authenticated;

-- ============================================================================
-- Storage buckets: flags, player-photos
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('flags', 'flags', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', true)
on conflict (id) do nothing;

create policy flags_public_read on storage.objects for select to public using (bucket_id = 'flags');
create policy flags_authenticated_write on storage.objects for insert to authenticated with check (bucket_id = 'flags');
create policy flags_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'flags');
create policy flags_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'flags');

create policy player_photos_public_read on storage.objects for select to public using (bucket_id = 'player-photos');
create policy player_photos_authenticated_write on storage.objects for insert to authenticated with check (bucket_id = 'player-photos');
create policy player_photos_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'player-photos');
create policy player_photos_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'player-photos');
