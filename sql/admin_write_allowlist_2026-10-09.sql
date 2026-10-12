-- ============================================================================
-- admin_write_allowlist_2026-10-09.sql
-- Close the "any authenticated = admin" write model with an email allowlist.
-- ============================================================================
-- BEFORE this migration every Supabase user with role `authenticated` had full
-- read/write/delete on the 6 data tables, could insert league_snapshots, upload
-- to the flags / player-photos storage buckets, and call the SECURITY DEFINER
-- restore/purge RPCs (which mutate the data tables bypassing RLS). The only gate
-- was "is there a session at all". With self-signup enabled on the project, any
-- stranger could register (directly against the public /auth/v1/signup endpoint,
-- the site's own UI is irrelevant), confirm their OWN email, and inherit all of
-- the above.
--
-- AFTER this migration write authority is gated on membership in
-- public.admin_emails — a table only service_role (i.e. you, via the Dashboard)
-- can edit. authenticated users not in that table keep READ access only (which
-- anon already has anyway). This is defense-in-depth: it holds even if self-
-- signup is turned back on by accident, or a stray `authenticated` user is
-- created in the background.
--
-- Managing admins (your approval gate):
--   • A new admin = add their email as a row in public.admin_emails
--     (Dashboard → Table Editor → admin_emails → Insert). No SQL, no redeploy.
--   • Revoke = delete the row. Effective immediately on their next request.
--   • Creating the Auth USER is still a separate manual step (Dashboard →
--     Authentication → Add user); self-signup stays OFF. Being an Auth user
--     grants nothing but read until the email is also in admin_emails.
--
-- SAFE and RE-RUNNABLE:
--   • additive table (admin_emails), no existing table altered
--   • policies dropped-if-exists then recreated; functions create-or-replace
--   • seeds with ON CONFLICT DO NOTHING — re-running never duplicates or wipes
--
-- Run order: AFTER sql/supabase_schema.sql AND sql/audit_soft_purge.sql
-- (it redefines the two soft-purge RPCs; running audit_soft_purge.sql again
--  afterwards would drop the is_admin() guard, so this stays last).
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/admin_write_allowlist_2026-10-09.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The allowlist table. Deny-all to anon/authenticated: it is read ONLY
--    through is_admin() (SECURITY DEFINER, below) and edited ONLY via
--    service_role / the Dashboard. A client that could read it would learn the
--    admin roster; a client that could write it would grant itself admin.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_emails (
    email    text primary key,
    note     text,
    added_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;
grant  all on public.admin_emails to service_role;

-- Seed the three current admins. Emails stored lowercase; is_admin() compares
-- case-insensitively so a differently-cased JWT claim still matches.
insert into public.admin_emails (email, note) values
    ('guyeli31@gmail.com',      'developer / owner'),
    ('marcel.dana@gmail.com',   'league manager'),
    ('claude-demo@example.com', 'claude test account (write/publish)')
on conflict (email) do nothing;

-- ----------------------------------------------------------------------------
-- 2. is_admin() — the single predicate every write policy and RPC guard calls.
--    SECURITY DEFINER so it can read admin_emails even though the calling role
--    has no grant on it. STABLE: one evaluation per statement, not per row.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.admin_emails
     where lower(email) = lower(auth.email())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The 6 data tables: replace `authenticated using(true) with check(true)`
--    with the is_admin() gate. anon SELECT policies are left untouched.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leagues','matches','manual_overrides','match_history','players_metadata','landing_settings']
  loop
    execute format('drop policy if exists %I_authenticated_all on public.%I;', t, t);
    execute format(
      'create policy %I_authenticated_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());',
      t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. league_snapshots: append-only insert, now admins only.
-- ----------------------------------------------------------------------------
drop policy if exists league_snapshots_authenticated_insert on public.league_snapshots;
create policy league_snapshots_authenticated_insert
  on public.league_snapshots for insert to authenticated
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. Storage buckets: public read stays; write/update/delete now admins only.
-- ----------------------------------------------------------------------------
drop policy if exists flags_authenticated_write  on storage.objects;
create policy flags_authenticated_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'flags' and public.is_admin());
drop policy if exists flags_authenticated_update on storage.objects;
create policy flags_authenticated_update on storage.objects for update to authenticated
  using (bucket_id = 'flags' and public.is_admin());
drop policy if exists flags_authenticated_delete on storage.objects;
create policy flags_authenticated_delete on storage.objects for delete to authenticated
  using (bucket_id = 'flags' and public.is_admin());

drop policy if exists player_photos_authenticated_write  on storage.objects;
create policy player_photos_authenticated_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos' and public.is_admin());
drop policy if exists player_photos_authenticated_update on storage.objects;
create policy player_photos_authenticated_update on storage.objects for update to authenticated
  using (bucket_id = 'player-photos' and public.is_admin());
drop policy if exists player_photos_authenticated_delete on storage.objects;
create policy player_photos_authenticated_delete on storage.objects for delete to authenticated
  using (bucket_id = 'player-photos' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. SECURITY DEFINER restore/purge RPCs. These run as the function owner and
--    bypass table RLS, so the is_admin() gate on the tables does NOT protect
--    them — they need their own guard, as the FIRST statement so an
--    unauthorized call mutates nothing. Bodies are otherwise verbatim:
--      • restore_audit_row       — from sql/supabase_schema.sql
--      • restore_and_delete_*    — from sql/audit_soft_purge.sql (the archiving
--        variants; copying the base-schema bodies here would regress soft-purge)
-- ----------------------------------------------------------------------------
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
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into rec from public.audit_log where id = log_id;
  if not found then
    raise exception 'audit_log row % not found', log_id;
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into cols_all
  from information_schema.columns
  where table_schema = 'public' and table_name = rec.table_name;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into cols_no_id
  from information_schema.columns
  where table_schema = 'public' and table_name = rec.table_name and column_name <> 'id';

  if rec.action = 'INSERT' then
    execute format('delete from public.%I where id = %L', rec.table_name, rec.row_pk);
  elsif rec.action = 'DELETE' then
    execute format(
      'insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, %L) r',
      rec.table_name, cols_all, cols_all, rec.table_name, rec.old_value
    );
  elsif rec.action = 'UPDATE' then
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, %L) r) where t.id = %L',
      rec.table_name, cols_no_id, cols_no_id, rec.table_name, rec.old_value, rec.row_pk
    );
  end if;
end;
$$;

revoke all on function public.restore_audit_row(bigint) from public;
grant execute on function public.restore_audit_row(bigint) to authenticated;

create or replace function public.restore_and_delete_audit_row(log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform set_config('app.suppress_audit', 'true', true);
  perform public.restore_audit_row(log_id);
  perform public.archive_audit_rows(null, log_id);
  delete from public.audit_log where id = log_id;
end;
$$;

revoke all on function public.restore_and_delete_audit_row(bigint) from public;
grant execute on function public.restore_and_delete_audit_row(bigint) to authenticated;

create or replace function public.restore_and_delete_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform set_config('app.suppress_audit', 'true', true);
  for r in select id from public.audit_log where batch_id = p_batch_id order by id desc loop
    perform public.restore_audit_row(r.id);
  end loop;

  perform public.archive_audit_rows(p_batch_id, null);

  delete from public.audit_log     where batch_id = p_batch_id;
  delete from public.audit_batches where id = p_batch_id;
end;
$$;

revoke all on function public.restore_and_delete_batch(uuid) from public;
grant execute on function public.restore_and_delete_batch(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. External Source sync (sql/external_source_scheduler.sql surfaces).
--    Two more tables carried the open `authenticated using(true)` write policy,
--    and the two "Run now" RPCs — which DISPATCH a GitHub Actions workflow via
--    the Vault PAT + pg_net — were callable by any authenticated user. A non-
--    admin could reconfigure sync plans or burn Actions minutes / force the
--    external source to overwrite league data. Gate all four on is_admin().
--    The _dispatch_* helpers themselves are not granted to authenticated, so
--    the two wrappers below are the only authenticated entry points to guard.
-- ----------------------------------------------------------------------------
drop policy if exists sync_plans_authenticated_all on public.sync_plans;
create policy sync_plans_authenticated_all on public.sync_plans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sync_plan_members_authenticated_all on public.sync_plan_members;
create policy sync_plan_members_authenticated_all on public.sync_plan_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.trigger_external_source_sync_now(p_league_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public._dispatch_external_source_sync(p_league_id, 'manual');
end;
$$;

revoke all on function public.trigger_external_source_sync_now(text) from public;
grant execute on function public.trigger_external_source_sync_now(text) to authenticated;

create or replace function public.trigger_external_source_sync_now_leagues(p_league_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public._dispatch_external_source_sync_multi(p_league_ids, 'manual', 'fast');
end;
$$;

revoke all on function public.trigger_external_source_sync_now_leagues(text[]) from public;
grant execute on function public.trigger_external_source_sync_now_leagues(text[]) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- 7. Report — who is an admin, and that the gated policies are in place.
-- ----------------------------------------------------------------------------
select email, note, added_at from public.admin_emails order by added_at;

select tablename, policyname, qual
  from pg_policies
 where schemaname = 'public'
   and policyname like '%_authenticated_all'
 order by tablename;
