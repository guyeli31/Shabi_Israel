-- diagnose_override_churn.sql — read-only. Detects the "every override came back"
-- symptom in audit_log.
--
-- THE BUG (fixed 2026-08-02, see js/admin/stagingStore.js):
--   Publishing an override change staged the league's FULL override set, and
--   syncOverrides() skips rows that are unchanged via sameOverrideRow(), which
--   compares `edited_at` against the staged `timestamp`. The staged set used to
--   be read from the repo's frozen leagues/<id>/manual_overrides.json, where
--   every entry carried a timestamp like "2026-05-05T00:00:00.000Z" while the DB
--   row's edited_at was NULL. sameInstant(NULL, "2026-05-05…") = false, so EVERY
--   override in the league was rewritten on EVERY publish — one real edit
--   produced N audit rows, N history entries and N restore-point diffs.
--
-- A healthy publish touches 1-2 override rows. A churned one touches the whole
-- league.
--
-- READ Q3 AND Q4 FIRST — they are the decisive ones and neither is affected by
-- audit batching. Q3 finds the exact fingerprint of the bug (an UPDATE that
-- changed nothing but edited_at); Q4 finds duplicate overrides for one match.
-- Q1/Q2/Q5 are volume context and are expected to show large numbers for the
-- initial data load and for league renames, neither of which is churn.
--
-- Usage:
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/diagnose_override_churn.sql

-- == Q1: manual_overrides audit volume per day ==========================
SELECT changed_at::date            AS day,
       action,
       count(*)                    AS rows_written,
       count(DISTINCT batch_id)    AS batches,
       round(count(*)::numeric / NULLIF(count(DISTINCT batch_id), 0), 1) AS rows_per_batch
FROM audit_log
WHERE table_name = 'manual_overrides'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;


-- == Q2: bulk writes — 3+ override rows in one second ==================
--    A genuine edit touches 1 row; a bulk technical-loss touches a handful.
--    Grouped by (actor, second) rather than by batch_id ON PURPOSE: if
--    audit_batching_for_automation.sql has been run, its backfill already
--    grouped every orphaned row into synthetic per-second batches, so
--    grouping by batch_id here would just re-report the backfill as churn.
--    EXPECTED, NOT CHURN: the initial data load (all INSERT), and a league
--    rename (all UPDATE, league_id differs before/after — the FK cascade).
--    Q3 is the test that actually distinguishes churn; this is context.
WITH per_second AS (
    SELECT date_trunc('second', changed_at)                   AS at,
           changed_by,
           count(*)                                           AS override_rows,
           count(*) FILTER (WHERE action = 'UPDATE')          AS updates,
           count(*) FILTER (WHERE action = 'INSERT')           AS inserts,
           count(*) FILTER (WHERE action = 'DELETE')           AS deletes,
           count(*) FILTER (
               WHERE action = 'UPDATE'
                 AND (old_value ->> 'league_id') IS DISTINCT FROM (new_value ->> 'league_id')
           )                                                   AS league_id_changed,
           min(COALESCE(new_value ->> 'league_id',
                        old_value ->> 'league_id'))            AS league
    FROM audit_log
    WHERE table_name = 'manual_overrides'
    GROUP BY 1, 2
)
SELECT at, changed_by, league, override_rows, updates, inserts, deletes,
       CASE
           WHEN inserts = override_rows            THEN 'initial load / new overrides'
           WHEN league_id_changed = updates
            AND updates > 0                        THEN 'league rename (FK cascade)'
           WHEN updates > 0                        THEN '*** investigate — see Q3 ***'
           ELSE 'deletes'
       END                                          AS explanation
FROM per_second
WHERE override_rows >= 3
ORDER BY override_rows DESC, at DESC
LIMIT 40;


-- == Q3: SMOKING GUN — UPDATEs where nothing but edited_at changed =====
--    (the no-op rewrite the timestamp mismatch produced)
SELECT changed_at, row_pk,
       old_value ->> 'league_id'  AS league,
       old_value ->> 'player_a'   AS player_a,
       old_value ->> 'player_b'   AS player_b,
       old_value ->> 'edited_at'  AS edited_at_before,
       new_value ->> 'edited_at'  AS edited_at_after
FROM audit_log
WHERE table_name = 'manual_overrides'
  AND action = 'UPDATE'
  AND (old_value - 'edited_at' - 'updated_at')
   IS NOT DISTINCT FROM
      (new_value - 'edited_at' - 'updated_at')
ORDER BY changed_at DESC
LIMIT 40;


-- == Q4: current duplicates (same league + unordered player pair) ======
--    The UNIQUE constraint is on (league_id, player_a, player_b) — it does
--    NOT stop the same MATCH being stored twice with the players swapped,
--    because syncOverrides keys on `a|b` unsorted. Any row here is a real
--    duplicate override for one match.
SELECT league_id,
       least(player_a, player_b)    AS p1,
       greatest(player_a, player_b) AS p2,
       count(*)                     AS copies,
       array_agg(id ORDER BY id)    AS ids,
       array_agg(type ORDER BY id)  AS types
FROM manual_overrides
GROUP BY 1, 2, 3
HAVING count(*) > 1
ORDER BY copies DESC, league_id;


-- == Q5: match_history churn — same match logged repeatedly ============
--    Each override rewrite triggers reconcileMatchHistory(), so override
--    churn shows up here too.
SELECT changed_at::date         AS day,
       count(*)                 AS history_rows_written,
       count(DISTINCT batch_id) AS batches
FROM audit_log
WHERE table_name = 'match_history'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 20;
