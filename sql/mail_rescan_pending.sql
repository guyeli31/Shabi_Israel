-- ============================================================================
-- mail_rescan_pending.sql — the pending queue re-checks itself.
--
-- THE BUG THIS FIXES
-- public.mail_resolve_report() runs exactly once per report: at the moment the
-- mail arrives. Its verdict — including the stored `candidates` list — is then
-- frozen forever. But the thing it was judging against, the set of open
-- fixtures, keeps changing: a league is created, a CSV sync lands, an override
-- is removed.
--
-- So a report that arrives BEFORE its league exists is judged unassignable and
-- then never re-judged. Report 295 (KingDavidR vs Ofek) arrived 2026-09-01
-- 19:08; its league's fixtures were written 2026-09-02 08:57. It sat assignable
-- and unnoticed for two days, and F8 — which renders its picker from the frozen
-- list — offered no Apply button at all. The one control the screen gave for an
-- applicable report was Discard.
--
-- TWO CHANGES, and they fix different halves:
--
--   1. mail_reports_pending() computes `candidates` LIVE instead of returning
--      the frozen column. F8 then always shows the truth, so an admin can
--      always act on what is really there. This alone removes the trap.
--
--   2. mail_rescan_pending() re-runs the resolver over the whole pending queue,
--      so a report that BECAME assignable applies itself, exactly as it would
--      have on arrival — carrying the mail's own date, like any other applied
--      report. It is driven by TRIGGERS on the three tables a candidate scan
--      reads, so it happens because the data changed, not because a particular
--      client remembered to ask. Publishing a league from Admin, a sync run and
--      a hand-written SQL repair all trip it identically; no page needs to be
--      open and no automation needs to be running.
--
-- Idempotent: safe to run more than once, and safe to run on an environment
-- where it has already been applied. Run after sql/mail_sync.sql.
--
-- ORDER MATTERS with one other file: sql/mail_reason_accuracy.sql redefines
-- mail_reports_pending() again (same live-candidate body, plus the corrected
-- reason chain), so it must run AFTER this one. Applying them the other way
-- round silently reverts the reason fix while leaving everything else working.
-- ============================================================================


-- ── mail_reports_pending — same shape, live candidates ─────────────────────
-- Signature and return type are unchanged from sql/mail_sync.sql, so this
-- replaces in place and no caller needs to know.
--
-- `reason` still fills in only for the rows with no candidate, and it is now
-- asking about the SAME instant the candidate list came from — previously it
-- explained a frozen verdict using present-day facts, which is how a report
-- with a perfectly good open fixture came to be labelled "Length mismatch
-- (5 vs 5)". That message's own bug (it never compares the two lengths) is
-- separate and lives in mail_orphan_reason.
create or replace function public.mail_reports_pending()
returns table (
    id          bigint,
    payload     jsonb,
    candidates  jsonb,
    received_at timestamptz,
    reason      text
)
language sql
stable
security definer
set search_path = public
as $$
    select r.id, r.payload,
           coalesce(live.cands, '[]'::jsonb) as candidates,
           r.received_at,
           case
                -- An impossible score is reported as itself, ahead of any
                -- league reasoning — "they are not scheduled to meet" is true
                -- but useless when the actual problem is a score of 1004.
                when not public.mail_score_ok((r.payload->>'score_a')::int,
                                              (r.payload->>'score_b')::int,
                                              (r.payload->>'match_length')::int)
                then format('Impossible score (%s-%s in a %spt match)',
                            r.payload->>'score_a', r.payload->>'score_b',
                            coalesce(r.payload->>'match_length', '?'))
                when coalesce(jsonb_array_length(live.cands), 0) = 0
                then public.mail_orphan_reason(r.payload->>'player_a',
                                               r.payload->>'player_b',
                                               (r.payload->>'match_length')::int)
           end
      from public.match_reports r
      left join lateral (
          select jsonb_agg(jsonb_build_object('league_id', c.league_id,
                                              'round', c.round)) as cands
            from public.mail_candidate_leagues(
                     r.payload->>'player_a',
                     r.payload->>'player_b',
                     (r.payload->>'match_length')::int) c
      ) live on true
     where r.status = 'pending_assign'
     order by r.received_at desc;
$$;


-- ── mail_rescan_pending — re-judge the whole queue ─────────────────────────
-- Applies exactly the arrival-time rule, nothing looser: mail_resolve_report()
-- auto-applies only when the live scan finds EXACTLY ONE candidate league, and
-- mail_apply_report() re-verifies once more before it writes. A report with
-- zero or several candidates is left pending, untouched.
--
-- Reports are locked one at a time by mail_apply_report's `for update`, so two
-- admins (or an admin and a sync run) sweeping at once cannot double-apply: the
-- second sees status = 'applied' and declines.
--
-- Returns a summary rather than a row set, because every caller asks the same
-- one question — did anything change? — and an empty table would not answer it.
create or replace function public.mail_rescan_pending()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r          record;
    res        jsonb;
    v_scanned  int := 0;
    v_applied  bigint[] := '{}';
begin
    -- Snapshot the ids first: mail_resolve_report changes the very status this
    -- would be looping over, and a cursor over a set the body mutates is a trap
    -- worth stepping around rather than reasoning about.
    for r in select id from public.match_reports
              where status = 'pending_assign' order by id
    loop
        v_scanned := v_scanned + 1;
        res := public.mail_resolve_report(r.id);
        if coalesce((res->>'ok')::boolean, false)
           and coalesce((res->>'auto')::boolean, false) then
            v_applied := v_applied || r.id;
        end if;
    end loop;

    return jsonb_build_object(
        'scanned',       v_scanned,
        'applied',       coalesce(array_length(v_applied, 1), 0),
        'applied_ids',   to_jsonb(v_applied),
        'still_pending', (select count(*) from public.match_reports
                           where status = 'pending_assign'));
end;
$$;


-- ── The sweep runs itself — triggers on what a candidate scan reads ────────
-- The point of putting this in the database rather than in a caller: a report
-- must be re-judged BECAUSE THE FACTS CHANGED, not because someone opened a
-- page or an automation happened to run. A new league published from Admin, a
-- sync run, a hand-written SQL repair and a future client nobody has written
-- yet all land here identically.
--
-- mail_candidate_leagues reads exactly three things, so those are the three
-- tables watched:
--   matches           — the fixture must exist and be unplayed  (INSERT/UPDATE)
--   leagues           — running, not archived, match_length     (INSERT/UPDATE)
--   manual_overrides  — no override may cover the pair          (DELETE)
--
-- STATEMENT-level, not row-level: publishing a league inserts 300 fixtures in
-- one statement, and that is one sweep, not three hundred.
create or replace function public.mail_rescan_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_batch text;
begin
    -- Re-entry guard. The sweep applies a report by UPDATEing matches and
    -- leagues, which are two of the tables this very trigger watches. Without
    -- the flag the first applied report would start a second sweep from inside
    -- the first.
    if coalesce(current_setting('app.mail_rescan_running', true), '') = '1' then
        return null;
    end if;

    -- The cheap exit, and the reason this is affordable on every write: an empty
    -- queue costs one indexed existence check. The expensive part only runs when
    -- there is actually something waiting.
    if not exists (select 1 from public.match_reports where status = 'pending_assign') then
        return null;
    end if;

    -- mail_apply_report opens its own audit batch and clears app.batch_id when
    -- it is done. Fired mid-publish that would blank the PUBLISHER's batch id
    -- for every statement after it, scattering the rest of one publish across
    -- unbatched audit rows — so the incoming value is saved and put back.
    v_batch := coalesce(current_setting('app.batch_id', true), '');

    perform set_config('app.mail_rescan_running', '1', true);
    perform public.mail_rescan_pending();
    perform set_config('app.mail_rescan_running', '', true);

    perform set_config('app.batch_id', v_batch, true);
    return null;
end;
$$;

drop trigger if exists trg_matches_mail_rescan          on public.matches;
drop trigger if exists trg_leagues_mail_rescan          on public.leagues;
drop trigger if exists trg_manual_overrides_mail_rescan on public.manual_overrides;

create trigger trg_matches_mail_rescan
    after insert or update on public.matches
    for each statement execute function public.mail_rescan_on_change();

create trigger trg_leagues_mail_rescan
    after insert or update on public.leagues
    for each statement execute function public.mail_rescan_on_change();

-- DELETE only: an override being ADDED can only ever remove a candidate, never
-- create one, so there is nothing to re-judge on the way in.
create trigger trg_manual_overrides_mail_rescan
    after delete on public.manual_overrides
    for each statement execute function public.mail_rescan_on_change();


-- ── Grants ─────────────────────────────────────────────────────────────────
-- Same model as the rest of sql/mail_sync.sql: nothing to public, and only
-- `authenticated` may sweep by hand. `anon` keeps its single verb
-- (submit_match_report) and gains nothing here. The trigger function is called
-- by the trigger itself, never by a client, so it needs no grant at all.
revoke all on function public.mail_rescan_pending()   from public;
revoke all on function public.mail_reports_pending()  from public;
revoke all on function public.mail_rescan_on_change() from public;
grant execute on function public.mail_rescan_pending()  to authenticated;
grant execute on function public.mail_reports_pending() to authenticated;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Read-only: the queue with live candidate lists.
--   select * from public.mail_reports_pending();
--
-- The manual sweep, still available as an escape hatch. On a healthy queue it
-- reports applied = 0 and changes nothing.
--   select public.mail_rescan_pending();
--
-- The triggers are the mechanism; nothing needs to call anything.
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname like '%mail_rescan%' order by 2;
-- ============================================================================
