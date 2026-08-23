-- ============================================================================
-- discard_pending_mail_reports.sql — clear the F8 queue in one go
--
-- Marks every mail report still waiting for a league as 'discarded' and
-- reports how many it touched.
--
-- Why this exists: after a parser correction, the mailbox re-sends every
-- report and the corrected copies arrive as NEW rows (the duplicate key is the
-- payload's content, which the correction changed). The originals stay behind
-- in F8 holding the wrong figures — `1004`, `5-9` — with no way to fix them,
-- because a report's payload is frozen at the moment it was received and only
-- its *reason* is recomputed on read. They are superseded, not salvageable.
-- Discarding is the per-row Discard button, applied to the whole queue.
--
-- SAFE by construction:
--   * touches ONLY status = 'pending_assign'. A report that was applied to a
--     league is 'applied' and is not selected, so no league result can be
--     altered by this.
--   * writes no matches, no match_history, no audit batch. Nothing leaves the
--     match_reports table.
--   * 'discarded' is a status, not a delete. Every row, its payload and its
--     arrival time stay exactly where they are and can be read back.
--
-- Run in the Supabase SQL Editor. Step 1 first — it changes nothing.
-- ============================================================================


-- ── Step 0: how many, and why ───────────────────────────────────────────────
-- The one-glance version. A row with candidates is the ONLY kind worth a second
-- look before sweeping — it means more than one running league holds this pair
-- as an open fixture, so there is a real choice being thrown away rather than a
-- superseded report. Everything else is already recorded on the live site.
select coalesce(reason, '⚠ has candidate leagues — a real choice to discard') as reason,
       count(*) as reports
  from public.mail_reports_pending()
 group by 1
 order by reports desc;

select count(*) as pending_total
  from public.match_reports
 where status = 'pending_assign';


-- ── Step 1: look before you leap ────────────────────────────────────────────
-- What is actually in the queue, and why each row is there. Read this and
-- satisfy yourself that nothing here deserves to be assigned to a league.
select
    r.id,
    r.payload->>'player_a'      as player_a,
    r.payload->>'player_b'      as player_b,
    (r.payload->>'score_a') || ' - ' || (r.payload->>'score_b') as score,
    r.payload->>'match_length'  as len,
    jsonb_array_length(r.candidates) as candidates,
    r.received_at
  from public.match_reports r
 where r.status = 'pending_assign'
 order by r.received_at desc;


-- ── Step 2: the discard ─────────────────────────────────────────────────────
-- One statement, so it is all-or-nothing, and it returns the count.
--
-- The written fields mirror public.mail_discard_report() exactly — same status,
-- same resolved_at, same resolved_by fallback — so a bulk discard and a
-- button-click discard are indistinguishable afterwards. Only discard_reason
-- differs, and only to record that this one was a sweep.
with discarded as (
    update public.match_reports
       set status         = 'discarded',
           discard_reason = 'bulk discard — superseded by corrected re-send',
           resolved_at    = now(),
           resolved_by    = coalesce(auth.email(), 'admin')
     where status = 'pending_assign'
    returning id
)
select count(*) as discarded_count from discarded;


-- ── Step 3: confirm ─────────────────────────────────────────────────────────
-- The queue should now be empty, and the discarded tally should have grown by
-- the number Step 2 printed. This is the same breakdown the Sync page's health
-- strip shows.
select status, count(*)
  from public.match_reports
 group by status
 order by status;


-- ── Undo, should you need it ────────────────────────────────────────────────
-- Within a few minutes of running the above, and only if nothing else has been
-- discarded since:
--
--   update public.match_reports
--      set status = 'pending_assign', discard_reason = null,
--          resolved_at = null, resolved_by = null
--    where status = 'discarded'
--      and discard_reason = 'bulk discard — superseded by corrected re-send';
--
-- The reason string is what makes this reversible: it marks exactly the rows
-- this script touched, so an undo cannot resurrect a report someone discarded
-- deliberately by hand.
-- ============================================================================
