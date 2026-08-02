-- check_override_orientation.sql — READ ONLY. Paste-and-run.
--
-- Finds manual_overrides rows whose player A/B order disagrees with the
-- `matches` row for the same pairing.
--
-- WHY IT MATTERS
--   An override identifies a MATCH, and a match has no A/B order — "Dan vs Ron"
--   and "Ron vs Dan" are the same fixture. syncOverrides() used to key on the raw
--   `player_a|player_b`, so a disagreeing order made it treat the override as
--   brand-new: it DELETED the stored row and INSERTed a fresh one with a new id
--   on every publish. Fixed 2026-08-02 in js/admin/supabaseAdmin.js (sorted key +
--   orientLike()), which now matches the row and updates it in place.
--
--   Rows returned here are not corrupt and need no repair — the fixed code
--   handles them correctly. They are simply the ones that would have triggered
--   the old delete/re-insert churn, so this is the "was I exposed?" check.
--
-- No rows returned = every override is stored in the same order as its match.

SELECT o.league_id,
       o.player_a  AS override_a,
       o.player_b  AS override_b,
       m.player_a  AS match_a,
       m.player_b  AS match_b,
       o.type,
       o.reason,
       'override order is reversed vs the match row' AS note
FROM manual_overrides o
JOIN matches m
  ON  m.league_id = o.league_id
  AND least(m.player_a, m.player_b)    = least(o.player_a, o.player_b)
  AND greatest(m.player_a, m.player_b) = greatest(o.player_a, o.player_b)
WHERE m.player_a <> o.player_a
ORDER BY o.league_id, o.player_a;
