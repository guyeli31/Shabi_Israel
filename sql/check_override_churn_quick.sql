-- check_override_churn_quick.sql — paste-and-run health check. READ ONLY.
--
-- Answers one question: "did updating a match ever silently rewrite ALL of a
-- league's manual overrides?" Returns ONE table with a verdict per check, so
-- there is nothing to interpret — read the `verdict` column.
--
-- Safe to run anywhere (psql, Supabase SQL Editor). No \-commands, no writes.

WITH
-- CHECK 1 — the bug's exact fingerprint: an UPDATE that changed nothing real,
-- only edited_at. That is what a rewrite-everything publish leaves behind.
noop_rewrites AS (
    SELECT count(*) AS n, min(changed_at) AS first_at, max(changed_at) AS last_at
    FROM audit_log
    WHERE table_name = 'manual_overrides'
      AND action = 'UPDATE'
      AND (old_value - 'edited_at' - 'updated_at')
       IS NOT DISTINCT FROM
          (new_value - 'edited_at' - 'updated_at')
),
-- CHECK 2 — the same match stored twice. The UNIQUE key is (league_id,
-- player_a, player_b), which does NOT stop a swapped-order duplicate.
dupes AS (
    SELECT count(*) AS n
    FROM (
        SELECT league_id, least(player_a, player_b) AS p1, greatest(player_a, player_b) AS p2
        FROM manual_overrides
        GROUP BY 1, 2, 3
        HAVING count(*) > 1
    ) d
),
-- CHECK 3 — bulk UPDATE bursts that are NOT explained by a league rename.
-- A rename cascades league_id across every row (expected). Anything else that
-- updated 3+ overrides in one second is worth a look.
unexplained_bursts AS (
    SELECT count(*) AS n
    FROM (
        SELECT date_trunc('second', changed_at) AS sec
        FROM audit_log
        WHERE table_name = 'manual_overrides' AND action = 'UPDATE'
        GROUP BY 1
        HAVING count(*) >= 3
           AND count(*) FILTER (
                 WHERE (old_value ->> 'league_id') IS DISTINCT FROM (new_value ->> 'league_id')
               ) < count(*)
    ) b
)
SELECT '1. no-op rewrites (the bug)' AS check,
       n::text                      AS found,
       CASE WHEN n = 0 THEN 'CLEAN — it never happened'
            ELSE 'FOUND — churn occurred between ' || first_at || ' and ' || last_at END AS verdict
FROM noop_rewrites
UNION ALL
SELECT '2. duplicate overrides', n::text,
       CASE WHEN n = 0 THEN 'CLEAN — no match has two overrides'
            ELSE 'FOUND — run sql/diagnose_override_churn.sql Q4 for the list' END
FROM dupes
UNION ALL
SELECT '3. unexplained bulk updates', n::text,
       CASE WHEN n = 0 THEN 'CLEAN — every bulk update was a league rename'
            ELSE 'CHECK — run sql/diagnose_override_churn.sql Q2 for detail' END
FROM unexplained_bursts
ORDER BY 1;
