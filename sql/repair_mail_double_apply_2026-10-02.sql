-- ============================================================================
-- repair_mail_double_apply_2026-10-02.sql — undo e-mail results that were
-- written into a league the admin did NOT choose.
--
-- WHAT HAPPENED
-- An admin resolving a two-league conflict in F8 (Unassigned Email Matches)
-- picked league X. mail_apply_report() wrote the result into X — and the UPDATE
-- on matches fired trg_matches_mail_rescan, whose sweep still found the report
-- 'pending_assign' (it was closed only at the END of the function). X was now
-- played, so exactly one candidate was left — league Y — and the sweep
-- auto-applied the same result there too, inside the same transaction.
--
-- THE FOOTPRINT IT LEFT — exact, no time window needed
--   * match_reports: status 'applied', auto_applied = TRUE, but resolved_by is
--     the ADMIN (a genuine auto-apply always reads resolved_by = 'mail-automation').
--   * audit_batches: a second batch by 'mail-automation' for league Y with
--     changed_at = the report's resolved_at to the microsecond (both are now()
--     of one transaction). That batch holds the wrong matches + match_history
--     writes, with their before-values.
--
-- WHAT THIS DOES
--   Step 1  installs the fixed mail_apply_report (closes the report first),
--           so no new case can appear while you repair.          [changes code]
--   Step 2  lists every affected report.                          [read-only]
--   Step 3  reverts the wrong league's matches + match_history rows from the
--           audit before-values, one "Reverted" Historical entry per report,
--           and marks the report as admin-applied (F9 shows ADMIN). [writes]
--   Step 4  confirms.                                              [read-only]
--
-- The CHOSEN league is not touched. The wrong league's `leagues` row is not
-- reverted either (only last_updated changed there; reverting the whole row
-- could undo an unrelated settings edit made since).
--
-- Projections recompute by themselves (triggers on matches/match_history).
-- If the real Y match was reported meanwhile, it sat in F8 as "Already played";
-- once Step 3 frees the fixture, the rescan trigger applies it automatically.
--
-- Run in the Supabase SQL Editor, step by step.
-- ============================================================================


-- ── Step 1: install the fix ─────────────────────────────────────────────────
-- Identical to the body in sql/mail_sync.sql. Here so the live DB can take it
-- without re-running mail_sync.sql's four-file chain.
create or replace function public.mail_apply_report(
    p_report_id bigint,
    p_league_id text,
    p_actor     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    r         public.match_reports;
    cand      record;
    who       text := coalesce(p_actor, auth.email(), 'mail-automation');
    batch     uuid;
    pl        jsonb;
    f_score_a numeric; f_score_b numeric;
    f_pr_a    numeric; f_pr_b    numeric;
    f_luck_a  numeric; f_luck_b  numeric;
    f_name_a  text;    f_name_b  text;
    played_at timestamptz;
begin
    select * into r from public.match_reports where id = p_report_id for update;
    if r.id is null then
        return jsonb_build_object('ok', false, 'error', 'report_not_found');
    end if;

    if not public.mail_score_ok((r.payload->>'score_a')::int,
                                (r.payload->>'score_b')::int,
                                (r.payload->>'match_length')::int) then
        return jsonb_build_object('ok', false, 'error', 'implausible_score',
                                  'detail', format('%s-%s in a %spt match',
                                      r.payload->>'score_a', r.payload->>'score_b',
                                      coalesce(r.payload->>'match_length', '?')));
    end if;
    if r.status = 'applied' then
        return jsonb_build_object('ok', false, 'error', 'already_applied');
    end if;

    pl := r.payload;

    select * into cand
      from public.mail_candidate_leagues(pl->>'player_a', pl->>'player_b',
                                         (pl->>'match_length')::int)
     where league_id = p_league_id;

    if cand.match_id is null then
        return jsonb_build_object('ok', false, 'error', 'not_a_candidate',
            'hint', 'the fixture is already played, override-covered, or the league stopped running');
    end if;

    if cand.swapped then
        f_name_a := pl->>'player_b';  f_name_b := pl->>'player_a';
        f_score_a := (pl->>'score_b')::numeric; f_score_b := (pl->>'score_a')::numeric;
        f_pr_a    := (pl->>'pr_b')::numeric;    f_pr_b    := (pl->>'pr_a')::numeric;
        f_luck_a  := (pl->>'luck_b')::numeric;  f_luck_b  := (pl->>'luck_a')::numeric;
    else
        f_name_a := pl->>'player_a';  f_name_b := pl->>'player_b';
        f_score_a := (pl->>'score_a')::numeric; f_score_b := (pl->>'score_b')::numeric;
        f_pr_a    := (pl->>'pr_a')::numeric;    f_pr_b    := (pl->>'pr_b')::numeric;
        f_luck_a  := (pl->>'luck_a')::numeric;  f_luck_b  := (pl->>'luck_b')::numeric;
    end if;

    played_at := coalesce((pl->>'played_at')::timestamptz, r.received_at);

    insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
    values (who, 'league', p_league_id, 'Match data updated', '📊',
            format('%s vs %s (%s-%s) — e-mail report',
                   f_name_a, f_name_b, f_score_a, f_score_b))
    returning id into batch;
    perform set_config('app.batch_id', batch::text, true);

    -- Close the report BEFORE touching matches — the order is the fix.
    update public.match_reports
       set status = 'applied',
           league_id = p_league_id,
           match_id = cand.match_id,
           auto_applied = coalesce(auto_applied, false),
           resolved_at = now(),
           resolved_by = who
     where id = p_report_id;

    update public.matches
       set score_a = f_score_a, score_b = f_score_b,
           pr_a    = f_pr_a,    pr_b    = f_pr_b,
           luck_a  = f_luck_a,  luck_b  = f_luck_b,
           played  = true
     where id = cand.match_id;

    insert into public.match_history
        (league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, source, updated_at, has_exact_time)
    values
        (p_league_id, f_name_a, f_name_b, f_score_a, f_score_b, f_pr_a, f_pr_b, f_luck_a, f_luck_b,
         cand.round, 'csv', played_at, true)
    on conflict (league_id, player_a, player_b) do update
        set score_a = excluded.score_a, score_b = excluded.score_b,
            pr_a    = excluded.pr_a,    pr_b    = excluded.pr_b,
            luck_a  = excluded.luck_a,  luck_b  = excluded.luck_b,
            round   = excluded.round,   source  = excluded.source,
            updated_at = excluded.updated_at,
            has_exact_time = excluded.has_exact_time;

    update public.leagues set last_updated = now() where id = p_league_id;

    perform set_config('app.batch_id', '', true);

    return jsonb_build_object('ok', true, 'league_id', p_league_id,
                              'match_id', cand.match_id, 'batch_id', batch);
end;
$$;


-- ── Step 2: find the affected reports (read-only) ───────────────────────────
-- One row per report. Before Step 3, every row must have:
--   wrong_batch     NOT null — the wrong write was found
--   untouched_since true     — nothing has edited those rows since
-- Anything else: STOP, Step 3 refuses it anyway.
select r.id                                         as report_id,
       r.payload->>'player_a'                        as player_a,
       r.payload->>'player_b'                        as player_b,
       (r.payload->>'score_a') || '-' || (r.payload->>'score_b') as score,
       r.league_id                                   as chosen_league,
       b.subject                                     as wrong_league,
       b.id                                          as wrong_batch,
       b.detail                                      as wrong_detail,
       r.resolved_at,
       r.resolved_by,
       (select bool_and(case a.table_name
                  when 'matches'       then (select to_jsonb(m) from public.matches m
                                              where m.id = a.row_pk::bigint) = a.new_value
                  when 'match_history' then (select to_jsonb(x) from public.match_history x
                                              where x.id = a.row_pk::bigint) = a.new_value
                end)
          from public.audit_log a
         where a.batch_id = b.id
           and a.table_name in ('matches', 'match_history')) as untouched_since
  from public.match_reports r
  left join public.audit_batches b
    on b.changed_by = 'mail-automation'
   and b.changed_at = r.resolved_at
   and b.subject is distinct from r.league_id
   and exists (
         select 1 from public.audit_log a
          where a.batch_id = b.id and a.table_name = 'matches'
            and least(a.new_value->>'player_a', a.new_value->>'player_b')
                  = least(r.payload->>'player_a', r.payload->>'player_b')
            and greatest(a.new_value->>'player_a', a.new_value->>'player_b')
                  = greatest(r.payload->>'player_a', r.payload->>'player_b'))
 where r.status = 'applied'
   and r.auto_applied
   and r.resolved_by is distinct from 'mail-automation'
 order by r.resolved_at;


-- ── Step 3: revert the wrong league ─────────────────────────────────────────
-- All-or-nothing: one bad row aborts the whole transaction, nothing changes.
begin;

do $$
declare
    h     record;
    lg    record;
    v_new uuid;
    v_n   int := 0;
begin
    -- Snapshot first: the loop flips auto_applied, which removes rows from the
    -- very query it iterates.
    create temp table _fix on commit drop as
    select r.id as report_id, r.payload, r.league_id as chosen_league,
           b.subject as wrong_league, b.id as wrong_batch, b.detail,
           (select bool_and(case a.table_name
                      when 'matches'       then (select to_jsonb(m) from public.matches m
                                                  where m.id = a.row_pk::bigint) = a.new_value
                      when 'match_history' then (select to_jsonb(x) from public.match_history x
                                                  where x.id = a.row_pk::bigint) = a.new_value
                    end)
              from public.audit_log a
             where a.batch_id = b.id
               and a.table_name in ('matches', 'match_history')) as untouched
      from public.match_reports r
      left join public.audit_batches b
        on b.changed_by = 'mail-automation'
       and b.changed_at = r.resolved_at
       and b.subject is distinct from r.league_id
       and exists (
             select 1 from public.audit_log a
              where a.batch_id = b.id and a.table_name = 'matches'
                and least(a.new_value->>'player_a', a.new_value->>'player_b')
                      = least(r.payload->>'player_a', r.payload->>'player_b')
                and greatest(a.new_value->>'player_a', a.new_value->>'player_b')
                      = greatest(r.payload->>'player_a', r.payload->>'player_b'))
     where r.status = 'applied'
       and r.auto_applied
       and r.resolved_by is distinct from 'mail-automation';

    for h in select * from _fix order by report_id loop
        if h.wrong_batch is null then
            raise exception 'Report %: the wrong-league write was not found in the audit — stop and investigate',
                h.report_id;
        end if;
        if h.untouched is distinct from true then
            raise exception 'Report % (% vs %): the rows in "%" were edited after the bad write — fix that league by hand',
                h.report_id, h.payload->>'player_a', h.payload->>'player_b', h.wrong_league;
        end if;

        insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
        values (coalesce(auth.email(), 'admin'), 'league', h.wrong_league,
                'Reverted: Match data updated', '↩️',
                format('%s written to the wrong league (admin chose %s)',
                       h.detail, h.chosen_league))
        returning id into v_new;
        perform set_config('app.batch_id', v_new::text, true);

        -- Newest first, the same order restore_batch() uses.
        for lg in select id from public.audit_log
                   where batch_id = h.wrong_batch
                     and table_name in ('matches', 'match_history')
                   order by id desc loop
            perform public.restore_audit_row(lg.id);
        end loop;

        update public.leagues set last_updated = now() where id = h.wrong_league;
        perform set_config('app.batch_id', '', true);

        -- The admin made this choice; F9 should say so.
        update public.match_reports set auto_applied = false where id = h.report_id;

        raise notice 'Report %: % vs % reverted in "%" (kept in "%")',
            h.report_id, h.payload->>'player_a', h.payload->>'player_b',
            h.wrong_league, h.chosen_league;
        v_n := v_n + 1;
    end loop;

    raise notice 'Done: % report(s) repaired', v_n;
end $$;

commit;


-- ── Step 4: confirm ─────────────────────────────────────────────────────────
-- Must return 0: no report left carrying the footprint.
select count(*) as still_affected
  from public.match_reports
 where status = 'applied' and auto_applied
   and resolved_by is distinct from 'mail-automation';

-- The admin-resolved reports now read ADMIN, each in its one chosen league.
select id, league_id, auto_applied, resolved_by, resolved_at
  from public.match_reports
 where status = 'applied' and resolved_by is distinct from 'mail-automation'
 order by resolved_at desc
 limit 20;
-- ============================================================================
