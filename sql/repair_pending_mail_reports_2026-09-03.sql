-- ============================================================================
-- repair_pending_mail_reports_2026-09-03.sql — clear the four reports left in
-- F8 after the September 2026 rounds-24/25 repair.
--
-- All four belong to "September 2026 Regular" (a 5-point league), not to the
-- league that repair_september_2026_round_25.sql fixed. They split into two
-- groups that need OPPOSITE actions, which is the whole reason this file exists
-- rather than a blanket sweep:
--
--   RELEASE (1 report) — id 295, KingDavidR 2-5 Ofek.
--     Its fixture (match 11817, round 1) is OPEN, and a live candidate scan
--     returns exactly one league. It is assignable right now.
--     Why it is stuck: the report arrived 2026-09-01 19:08, BEFORE the league
--     existed (its matches were written 2026-09-02 08:57). At that moment there
--     was nothing to match, so its candidate list was stored empty — and nothing
--     ever re-scans a pending report. F8 shows a picker only when the STORED
--     list is non-empty, so the row offers Discard and nothing else: the only
--     button the screen gives for an assignable report is the one that throws
--     it away.
--     Note: the "Length mismatch (5 vs 5)" that F8 prints for this row is a
--     display bug, not a diagnosis — mail_orphan_reason returns that message for
--     ANY open fixture it finds without actually comparing the two lengths.
--
--   DISCARD (3 reports) — ids 293, 300, 302.
--     Each names a match the league ALREADY holds, with an identical score:
--       302  Amiros 5-4 xbuster       = stored round 10  (xbuster 4-5 Amiros)
--       300  Avshalom 5-1 KingDavidR  = stored round 15
--       293  david2402 5-4 Avi        = stored round 2   (Avi 4-5 david2402)
--     All three were written by the CSV sync of 2026-09-02 08:57. There is
--     nothing to apply; the reports are redundant copies.
--
-- NO SCORE IS TYPED IN THIS FILE. The release goes through
-- mail_resolve_report(), which re-scans and applies on its own.
--
-- Both actions are DERIVED BY RULE and then asserted against the expected ids,
-- so a report that arrived since this file was written cannot be swept up by
-- accident — the assertion fails and nothing runs.
--
-- Run in the Supabase SQL Editor, in order. Steps 0 and 1 change nothing.
-- ============================================================================


-- ── Step 0: the queue as it stands ──────────────────────────────────────────
-- Expect exactly four rows: 293, 295, 300, 302.
select r.id,
       r.payload->>'player_a' as player_a,
       r.payload->>'player_b' as player_b,
       (r.payload->>'score_a') || ' - ' || (r.payload->>'score_b') as score,
       r.payload->>'match_length' as len,
       jsonb_array_length(r.candidates) as stored_candidates,
       p.reason,
       r.received_at
  from public.match_reports r
  left join public.mail_reports_pending() p on p.id = r.id
 where r.status = 'pending_assign'
 order by r.id;


-- ── Step 1a: which pending reports are assignable RIGHT NOW ─────────────────
-- The stored candidate list is a snapshot from arrival time; this re-runs the
-- scan live. Expect exactly one row: 295 → September 2026 Regular.
select r.id,
       r.payload->>'player_a' as player_a,
       r.payload->>'player_b' as player_b,
       c.league_id, c.round, c.match_id
  from public.match_reports r
  cross join lateral public.mail_candidate_leagues(
      r.payload->>'player_a', r.payload->>'player_b',
      (r.payload->>'match_length')::int) c
 where r.status = 'pending_assign'
 order by r.id;


-- ── Step 1b: which pending reports duplicate a result already stored ────────
-- Compared ORIENTATION-AWARE: a stored match may hold the pair the other way
-- round, and comparing score_a to score_a would then call an exact duplicate a
-- conflict. Every row must read 'IDENTICAL'. A 'DIFFERENT' row is not a
-- duplicate at all — it is a disagreement about a played match, and it must be
-- looked at by hand rather than discarded.
select r.id,
       r.payload->>'player_a' as report_a,
       r.payload->>'player_b' as report_b,
       (r.payload->>'score_a') || ' - ' || (r.payload->>'score_b') as report_score,
       m.league_id, m.round,
       m.player_a || ' ' || m.score_a || ' - ' || m.score_b || ' ' || m.player_b as stored,
       case when (m.player_a = r.payload->>'player_a'
                  and m.score_a = (r.payload->>'score_a')::numeric
                  and m.score_b = (r.payload->>'score_b')::numeric)
                 or (m.player_a = r.payload->>'player_b'
                  and m.score_a = (r.payload->>'score_b')::numeric
                  and m.score_b = (r.payload->>'score_a')::numeric)
            then 'IDENTICAL — safe to discard'
            else '⚠ DIFFERENT — STOP, do not discard'
       end as verdict
  from public.match_reports r
  join public.leagues l on l.running and not l.archived
  join public.matches m
    on m.league_id = l.id and m.played
   and least(m.player_a, m.player_b)    = least(r.payload->>'player_a', r.payload->>'player_b')
   and greatest(m.player_a, m.player_b) = greatest(r.payload->>'player_a', r.payload->>'player_b')
 where r.status = 'pending_assign'
 order by r.id;


-- ── Step 2: release the assignable report ───────────────────────────────────
-- Guarded: refuses unless exactly ONE pending report has exactly ONE live
-- candidate, and that report is 295. mail_resolve_report() then re-scans and
-- calls mail_apply_report() itself — the result is written by the ordinary mail
-- path, with its own audit batch and match_history row.
begin;

do $$
declare
    v_ids  bigint[];
    v_res  jsonb;
begin
    select array_agg(id order by id) into v_ids from (
        select r.id
          from public.match_reports r
         where r.status = 'pending_assign'
           and (select count(*) from public.mail_candidate_leagues(
                    r.payload->>'player_a', r.payload->>'player_b',
                    (r.payload->>'match_length')::int)) = 1
    ) q;

    if v_ids is distinct from array[295]::bigint[] then
        raise exception 'Expected exactly report 295 to be assignable, found % — review Step 1a before running this',
                        coalesce(v_ids::text, '{}');
    end if;

    v_res := public.mail_resolve_report(295);
    if not (v_res->>'ok')::boolean then
        raise exception 'mail_resolve_report(295) refused: %', v_res::text;
    end if;
    if not coalesce((v_res->>'auto')::boolean, false) then
        raise exception 'Report 295 did not auto-apply: % — nothing written', v_res::text;
    end if;
    raise notice 'Report 295 applied: %', v_res::text;
end $$;

commit;


-- ── Step 3: discard the three duplicates ────────────────────────────────────
-- Derived by the same rule Step 1b prints — a pending report whose pair is
-- already played, in a running league, with an identical score — then asserted
-- against the three expected ids. A report that fails the identical-score test
-- is not in the set and cannot be discarded by this script.
--
-- 'discarded' is a status, not a delete: payload, arrival time and reason all
-- stay readable, and the rows keep appearing in Mail Automated Matches.
begin;

do $$
declare
    v_ids bigint[];
    v_n   int;
begin
    select array_agg(distinct r.id order by r.id) into v_ids
      from public.match_reports r
      join public.leagues l on l.running and not l.archived
      join public.matches m
        on m.league_id = l.id and m.played
       and least(m.player_a, m.player_b)    = least(r.payload->>'player_a', r.payload->>'player_b')
       and greatest(m.player_a, m.player_b) = greatest(r.payload->>'player_a', r.payload->>'player_b')
     where r.status = 'pending_assign'
       and ((m.player_a = r.payload->>'player_a'
             and m.score_a = (r.payload->>'score_a')::numeric
             and m.score_b = (r.payload->>'score_b')::numeric)
            or (m.player_a = r.payload->>'player_b'
             and m.score_a = (r.payload->>'score_b')::numeric
             and m.score_b = (r.payload->>'score_a')::numeric));

    if v_ids is distinct from array[293, 300, 302]::bigint[] then
        raise exception 'Expected duplicates {293,300,302}, found % — review Step 1b before running this',
                        coalesce(v_ids::text, '{}');
    end if;

    select count(*) into v_n from unnest(v_ids) id
     where (public.mail_discard_report(
                id, 'duplicate — identical result already stored from the CSV sync of 2026-09-02'
            )->>'ok')::boolean;

    if v_n <> 3 then
        raise exception 'Discarded % of 3 — rolling back', v_n;
    end if;
    raise notice 'Discarded 3 duplicate reports';
end $$;

commit;


-- ── Step 4: confirm ─────────────────────────────────────────────────────────
-- The pending queue should now be EMPTY.
select count(*) as still_pending
  from public.match_reports where status = 'pending_assign';

-- 295 applied (auto), the other three discarded with the reason above.
select id, status, auto_applied, league_id, match_id, discard_reason, resolved_at, resolved_by
  from public.match_reports
 where id in (293, 295, 300, 302)
 order by id;

-- The fixture 295 was waiting for: Ofek vs KingDavidR should now read played,
-- 5-2 in Ofek's favour whichever way round the row stores the pair.
select id, round, player_a, player_b, score_a, score_b, pr_a, pr_b, played
  from public.matches
 where league_id = 'September 2026 Regular'
   and least(player_a, player_b)    = least('Ofek', 'KingDavidR')
   and greatest(player_a, player_b) = greatest('Ofek', 'KingDavidR');


-- ── Undo ────────────────────────────────────────────────────────────────────
-- The three discards (safe, touches nothing but their own status — the reason
-- string marks exactly the rows this script wrote, so a hand-made discard from
-- another day cannot be resurrected):
--
--   update public.match_reports
--      set status = 'pending_assign', discard_reason = null,
--          resolved_at = null, resolved_by = null
--    where discard_reason = 'duplicate — identical result already stored from the CSV sync of 2026-09-02';
--
-- The release of 295 (un-plays the fixture and removes the history row — do this
-- only if the result itself turns out to be wrong):
--
--   update public.match_reports
--      set status = 'pending_assign', auto_applied = false,
--          league_id = null, match_id = null, resolved_at = null, resolved_by = null
--    where id = 295;
--
--   delete from public.match_history
--    where league_id = 'September 2026 Regular'
--      and least(player_a, player_b)    = least('Ofek', 'KingDavidR')
--      and greatest(player_a, player_b) = greatest('Ofek', 'KingDavidR');
--
--   update public.matches
--      set score_a = 0, score_b = 0, pr_a = 0, pr_b = 0,
--          luck_a = 0, luck_b = 0, played = false
--    where id = 11817;
-- ============================================================================
