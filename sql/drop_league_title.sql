-- Shabi Israel — retire the cosmetic `leagues.title` column.
-- Final step of the "id is the name" migration. Run AFTER:
--   1. sql/league_rename.sql
--   2. sql/rename_leagues_to_month_year.sql  (so every league already has its
--      final id — title is not read anywhere, so its staleness doesn't matter)
--   3. the JS that stops sending `title` on upsert is DEPLOYED and live
--      (js/admin/supabaseAdmin.js → mapParamsToLeagueRow no longer emits title),
--      AND `title` has been made nullable so the gap between deploy and this
--      script can't fail a new-league insert:
--          alter table public.leagues alter column title drop not null;
--      (safe to run any time before this file; harmless if already done).
--
-- Why anything other than a bare DROP is needed:
--   • rename_league() as shipped in league_rename.sql (the version already in the
--     cloud) still does `set ..., title = new_id`; dropping the column first
--     would make every future rename raise "column title does not exist". So we
--     re-create the function in its title-free form BEFORE the drop. (This form
--     is identical to the current sql/league_rename.sql source.)
--   • get_site_bundle builds leagues with to_jsonb(l) — dynamic, so it needs no
--     change; the column simply stops appearing in the bundle, and the client
--     mappers' `LeagueTitle: row.title` become undefined and fall back to the id.
-- Idempotent: the DROP uses IF EXISTS.

-- 1. Title-free rename_league (supersedes the cloud's title-setting version).
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
  new_id := btrim(new_id);

  if old_id = new_id then
    return;
  end if;

  if not exists (select 1 from public.leagues where id = old_id) then
    raise exception 'League "%" does not exist', old_id;
  end if;

  if exists (
    select 1 from public.leagues
    where lower(id) = lower(new_id) and id <> old_id
  ) then
    raise exception 'A league named "%" already exists', new_id;
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  update public.leagues set id = new_id where id = old_id;

  update public.analytics_events set league_id      = new_id where league_id      = old_id;
  update public.analytics_events set from_league_id = new_id where from_league_id = old_id;

  insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
  values ('leagues', new_id, 'UPDATE',
          jsonb_build_object('id', old_id),
          jsonb_build_object('id', new_id),
          coalesce(auth.email(), 'external-source-automation'));
end;
$$;

revoke all on function public.rename_league(text, text) from public;
revoke execute on function public.rename_league(text, text) from anon;
grant execute on function public.rename_league(text, text) to authenticated;

-- 2. Drop the column. The id is now the single source of the league's name
--    (display + primary key + ?league= URL).
alter table public.leagues drop column if exists title;
