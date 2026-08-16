-- Test fixture: a player who carries TWO title badges at once.
--
-- Every player in the real data has at most one badge (a BMAB rank OR a
-- championship), which meant there was no way to eyeball how a pair of
-- `.title-abbr` pills sits next to a name — in a table cell, in a search row,
-- and inside a search field's identity overlay, where the badges are absolutely
-- positioned siblings of the <input>. Hummus already holds Master M2; this adds
-- a national championship so the pair renders as `NC` + `M2`.
--
-- LOCAL DEV ONLY. Re-run after any reset of the Docker Supabase volume:
--   docker exec supabase_db_supabase-migration psql -U postgres -d postgres \
--     -f - < sql/test_fixture_two_titles.sql
-- Idempotent: writes the same single-element array every time.

update public.players_metadata
   set championship_titles = '[{"type": "national", "year": 2024, "country": "Belgium", "doubles": false, "location": ""}]'::jsonb
 where id = 'Hummus';
