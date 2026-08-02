-- Shabi Israel — one-time bulk rename to the "id is the name" scheme.
-- Requires sql/league_rename.sql to have been applied first (rename_league RPC +
-- ON UPDATE CASCADE FKs). Safe to run on BOTH the cloud DB and local Docker, and
-- idempotent: the loops only match rows still in the old shape, so re-running is
-- a no-op.
--
-- Target names:
--   • DOUBLING leagues → "<Month Year>"          (drop the "Shabi Israel " prefix)
--   • REGULAR  leagues → "<Month Year> Regular"   (so it stays distinct from the
--                                                  doubling league of the same month)
--
-- ORDER MATTERS. The cloud has a doubling "Shabi Israel July 2026" AND a regular
-- "July 2026". Renaming the doubling to "July 2026" would collide, so REGULAR is
-- renamed FIRST (freeing the "July 2026" name) inside the same transaction. On
-- local Docker the regular league is absent, so its loop is simply a no-op.
--
-- rename_league() does the heavy lifting per league: cascades every FK child,
-- rewrites analytics_events, suppresses the per-row audit flood (logging ONE
-- clean row), enforces case-insensitive uniqueness, and sets title = id — so
-- after this script every league has title = id and the title column can be
-- dropped with zero loss.

do $$
declare
  r    record;
  base text;
  new  text;
begin
  -- 1. REGULAR first — strip any "Shabi Israel " prefix, then ensure a
  --    " Regular" suffix. This frees the bare "<Month Year>" name for the
  --    doubling league that will take it.
  for r in select id from public.leagues where league_type = 'regular'
  loop
    base := regexp_replace(r.id, '^Shabi Israel ', '');
    new  := base || (case when base ~ ' Regular$' then '' else ' Regular' end);
    if new <> r.id then
      perform public.rename_league(r.id, new);
    end if;
  end loop;

  -- 2. DOUBLING — drop the "Shabi Israel " prefix.
  for r in select id from public.leagues
           where league_type = 'doubling' and id like 'Shabi Israel %'
  loop
    perform public.rename_league(r.id, regexp_replace(r.id, '^Shabi Israel ', ''));
  end loop;
end $$;

-- 3. Landing order references leagues by their dash-title ("Shabi Israel - July
--    2026"); after the rename those entries point at ids that no longer exist
--    (and the admin's league list is derived from this array). Strip the same
--    prefix so each entry maps to its new id. Idempotent — already-stripped
--    entries have no prefix to remove.
update public.landing_settings
set display_order = (
  select coalesce(jsonb_agg(regexp_replace(elem, '^Shabi Israel - ', '')), '[]'::jsonb)
  from jsonb_array_elements_text(display_order) as elem
)
where id = 1
  -- Only touch the row if at least one entry still carries the prefix, so a
  -- re-run is a true no-op and doesn't log a ghost audit row (landing_settings
  -- has its own audit trigger).
  and exists (
    select 1 from jsonb_array_elements_text(display_order) as e
    where e like 'Shabi Israel - %'
  );
