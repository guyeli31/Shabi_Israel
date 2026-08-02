-- Shabi Israel — Smooth league rename (league id is the natural key)
-- Companion to sql/supabase_schema.sql. Run once in the Supabase SQL Editor
-- (cloud) and via the local Docker DB. Idempotent — safe to run repeatedly.
--
-- BACKGROUND: leagues.id (text) is the league's identity — it is the primary
-- key, the ?league= URL param, the leagues/<id>/ folder name, AND (since we
-- dropped the cosmetic `title`) the display name shown everywhere. There is no
-- separate visual title. Renaming a league therefore means renaming its id,
-- which must propagate to every reference atomically. This file provides that
-- primitive so the Admin "League Name" field can drive a REAL rename instead of
-- only rewriting a cosmetic field.
--
-- TWO CHANNELS need updating on a rename; this file covers the DB channel:
--   1. FK children (matches / manual_overrides / match_history / league_snapshots)
--      — made to cascade automatically via ON UPDATE CASCADE below.
--   2. analytics_events — NOT a foreign key (free-text league_id + from_league_id),
--      so rename_league() rewrites both columns explicitly. A league is one
--      entity that got a new name, so its analytics stay unified under it
--      (deliberately unlike sessions/region, which are immutable facts).
-- The file/folder channel (leagues/<id>/ + landing_settings) is handled on the
-- Admin/GitHub side through the normal staging path, not here.

-- ============================================================================
-- 1. ON UPDATE CASCADE on EVERY FK that points at leagues.id
-- ============================================================================
-- FKs to leagues are defined ON DELETE CASCADE only (in supabase_schema.sql AND
-- external_source_scheduler.sql), so an id change is rejected. There are more of
-- them than the core four — the external-source sync tables reference leagues
-- too (external_source_sync_events / external_source_sync_log / sync_plan_members).
-- Rather than hardcode a list that a future table could silently break, iterate
-- over every FK that targets public.leagues and re-add it with ON UPDATE CASCADE,
-- preserving its existing ON DELETE clause (pg_get_constraintdef already carries
-- it). The `ON UPDATE` guard makes this idempotent — already-cascading FKs are
-- skipped. analytics_events is intentionally absent here: its league_id /
-- from_league_id are free-text (no FK), rewritten explicitly by rename_league().

do $$
declare r record;
begin
  for r in
    select con.conname,
           con.conrelid::regclass::text as tbl,
           pg_get_constraintdef(con.oid)  as def
    from pg_constraint con
    where con.contype = 'f'
      and con.confrelid = 'public.leagues'::regclass
      and position('ON UPDATE' in upper(pg_get_constraintdef(con.oid))) = 0
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    -- def ends with its ON DELETE clause; appending ON UPDATE CASCADE is valid
    -- (clause order is irrelevant) and keeps the original delete behaviour.
    execute format('alter table %s add constraint %I %s on update cascade',
                   r.tbl, r.conname, r.def);
  end loop;
end $$;

-- ============================================================================
-- 2. rename_league(old_id, new_id) — the atomic rename primitive
-- ============================================================================
-- SECURITY DEFINER so it runs with the owner's rights (the client is a plain
-- authenticated admin). Uniqueness is enforced case-insensitively — two leagues
-- differing only by case would be indistinguishable in a URL and re-create the
-- exact ambiguity the natural-key model exists to prevent — while the id keeps
-- the caller's exact casing. The whole body is one statement-level transaction:
-- the leagues UPDATE cascades to the FK children, then analytics is rewritten;
-- any failure rolls the entire call back.

create or replace function public.rename_league(old_id text, new_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_id is null or btrim(new_id) = '' then
    raise exception 'New league name cannot be empty';
  end if;
  -- Normalise the caller's target: trim only. Casing is preserved on purpose.
  new_id := btrim(new_id);

  if old_id = new_id then
    return;  -- no-op rename
  end if;

  if not exists (select 1 from public.leagues where id = old_id) then
    raise exception 'League "%" does not exist', old_id;
  end if;

  -- Uniqueness guard (case-insensitive), excluding the row being renamed.
  if exists (
    select 1 from public.leagues
    where lower(id) = lower(new_id) and id <> old_id
  ) then
    raise exception 'A league named "%" already exists', new_id;
  end if;

  -- The FK cascade rewrites league_id on every child row, and matches /
  -- manual_overrides / match_history each carry the trg_*_audit row trigger — so
  -- a single rename would otherwise dump hundreds of UPDATE rows into audit_log
  -- and bury Historical Changes. Suppress the per-row audit for this transaction
  -- (the same transaction-local flag restore_and_delete_audit_row() uses), then
  -- log exactly ONE clean row for the rename below. audit_log has no trigger, so
  -- that manual insert is unaffected by the suppression.
  perform set_config('app.suppress_audit', 'true', true);

  -- Rename the PK. ON UPDATE CASCADE propagates to matches, manual_overrides,
  -- match_history, league_snapshots and the external-source sync tables in the
  -- same transaction. (The legacy cosmetic `title` column is not touched here —
  -- it is being dropped by sql/drop_league_title.sql; while it still exists it
  -- simply goes stale, which is harmless since nothing reads it any more.)
  update public.leagues set id = new_id where id = old_id;

  -- analytics_events is not an FK — rewrite both league references so the
  -- renamed league's history stays under one name. (No audit trigger here.)
  update public.analytics_events set league_id      = new_id where league_id      = old_id;
  update public.analytics_events set from_league_id = new_id where from_league_id = old_id;

  -- The one audit row that represents the whole rename. Batched by the publish
  -- path (finalize_publish_batch) and rendered in Historical Changes; old/new
  -- carry just the id so the Details diff reads "id: <old> → <new>".
  insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
  values ('leagues', new_id, 'UPDATE',
          jsonb_build_object('id', old_id),
          jsonb_build_object('id', new_id),
          coalesce(auth.email(), 'external-source-automation'));
end;
$$;

-- ============================================================================
-- 3. Grants — authenticated admins only, never anon/public
-- ============================================================================
revoke all on function public.rename_league(text, text) from public;
revoke execute on function public.rename_league(text, text) from anon;
grant execute on function public.rename_league(text, text) to authenticated;
