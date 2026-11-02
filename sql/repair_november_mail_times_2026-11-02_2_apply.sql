-- repair_november_mail_times_2026-11-02_2_apply.sql
--
-- November 2026 Regular was created (2026-11-01 21:53 UTC) with results that
-- had ALREADY been reported by e-mail half an hour earlier — before the league
-- existed, so the reports sat in F8 as unassigned. The league's CSV then carried
-- the same results, stamped with the import moment (21:54:52.386), and the
-- reports became "Already played". One of them (rina vs SHIMICO) was also marked
-- NOT PLAYED by hand while sorting this out, hiding a real result.
--
-- This stitches each such match exactly as if mail_apply_report had applied it
-- on arrival (sql/mail_sync.sql): the report closed as applied, the result
-- written from the report, the match_history row dated by the report
-- (played_at, else received_at), has_exact_time = true, source 'csv', one
-- Historical Changes batch per match. A NOT PLAYED override on such a pair is
-- removed — the e-mail and the CSV agree that the match was played.
--
-- A match qualifies only if ALL hold: it is in this league and played; a report
-- for the same pair, received since v_since, is not yet applied; and the
-- report's score, oriented to the fixture, equals the stored one. So a report
-- whose score disagrees with the league is never touched.
--
--
-- Run repair_november_mail_times_2026-11-02_1_preview.sql first, then this whole file.
-- One DO block: if the count differs from v_expected, or a pair is
-- covered by an override other than NOT PLAYED, it raises and nothing changes.
--
-- Before running: discard any STAGED (unpublished) admin changes to this
-- league's overrides — a publish from a stale draft would put the NOT PLAYED
-- back.

-- ── STEP 2 — the stitch (all-or-nothing) ───────────────────────────────────
do $$
declare
    v_league   constant text        := 'November 2026 Regular';
    v_since    constant timestamptz := '2026-11-01 00:00:00+02';
    v_expected constant int         := 2;   -- rina vs SHIMICO, pshapiro vs UziMutsafy
    v_actor    constant text        := 'admin-repair-2026-11-02';
    x          record;
    v_n        int := 0;
    v_batch    uuid;
    sw         boolean;
    v_at       timestamptz;
begin
    for x in
        select distinct on (m.id) m.*, r.id as report_id, r.payload as pl, r.received_at
          from public.matches m
          join public.match_reports r
            on r.status <> 'applied'
           and r.received_at >= v_since
           and ((r.payload->>'player_a' = m.player_a and r.payload->>'player_b' = m.player_b)
             or (r.payload->>'player_a' = m.player_b and r.payload->>'player_b' = m.player_a))
           and (case when r.payload->>'player_a' = m.player_a then r.payload->>'score_a' else r.payload->>'score_b' end)::numeric = m.score_a
           and (case when r.payload->>'player_a' = m.player_a then r.payload->>'score_b' else r.payload->>'score_a' end)::numeric = m.score_b
         where m.league_id = v_league
           and m.played
         order by m.id, r.received_at          -- the FIRST report of a match wins
    loop
        v_n  := v_n + 1;
        sw   := (x.pl->>'player_a') = x.player_b;
        v_at := coalesce((x.pl->>'played_at')::timestamptz, x.received_at);

        if exists (select 1 from public.manual_overrides o
                    where o.league_id = v_league
                      and least(o.player_a, o.player_b) = least(x.player_a, x.player_b)
                      and greatest(o.player_a, o.player_b) = greatest(x.player_a, x.player_b)
                      and o.type <> 'not_played') then
            raise exception 'Override other than NOT PLAYED on % vs % — resolve it by hand first',
                x.player_a, x.player_b;
        end if;

        insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
        values (v_actor, 'league', v_league, 'Match data updated', '📊',
                format('%s vs %s (%s-%s) — e-mail report, dated by its arrival',
                       x.player_a, x.player_b, x.score_a, x.score_b))
        returning id into v_batch;
        perform set_config('app.batch_id', v_batch::text, true);

        -- Close the report first, as mail_apply_report does: the writes below
        -- fire the rescan triggers, which must not find this report pending.
        update public.match_reports
           set status = 'applied', league_id = v_league, match_id = x.id,
               auto_applied = false, resolved_at = now(), resolved_by = v_actor
         where id = x.report_id;

        -- Any OTHER pending report for the same match is the same result twice.
        update public.match_reports
           set status = 'discarded', resolved_at = now(), resolved_by = v_actor,
               discard_reason = format('Duplicate of report %s', x.report_id)
         where status = 'pending_assign' and id <> x.report_id
           and ((payload->>'player_a' = x.player_a and payload->>'player_b' = x.player_b)
             or (payload->>'player_a' = x.player_b and payload->>'player_b' = x.player_a))
           and received_at >= v_since;

        -- The report's figures (finer than the CSV's two decimals), fixture-oriented.
        update public.matches
           set score_a = (x.pl->>(case when sw then 'score_b' else 'score_a' end))::numeric,
               score_b = (x.pl->>(case when sw then 'score_a' else 'score_b' end))::numeric,
               pr_a    = (x.pl->>(case when sw then 'pr_b'    else 'pr_a'    end))::numeric,
               pr_b    = (x.pl->>(case when sw then 'pr_a'    else 'pr_b'    end))::numeric,
               luck_a  = (x.pl->>(case when sw then 'luck_b'  else 'luck_a'  end))::numeric,
               luck_b  = (x.pl->>(case when sw then 'luck_a'  else 'luck_b'  end))::numeric,
               played  = true
         where id = x.id;

        delete from public.manual_overrides o
         where o.league_id = v_league
           and least(o.player_a, o.player_b) = least(x.player_a, x.player_b)
           and greatest(o.player_a, o.player_b) = greatest(x.player_a, x.player_b)
           and o.type = 'not_played';

        -- Re-read the fixture (just written) and date its history row by the report.
        insert into public.match_history
            (league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b,
             round, source, updated_at, has_exact_time)
        select m.league_id, m.player_a, m.player_b, m.score_a, m.score_b, m.pr_a, m.pr_b,
               m.luck_a, m.luck_b, m.round, 'csv', v_at, true
          from public.matches m where m.id = x.id
        on conflict (league_id, player_a, player_b) do update
            set score_a = excluded.score_a, score_b = excluded.score_b,
                pr_a    = excluded.pr_a,    pr_b    = excluded.pr_b,
                luck_a  = excluded.luck_a,  luck_b  = excluded.luck_b,
                round   = excluded.round,   source  = excluded.source,
                updated_at = excluded.updated_at,
                has_exact_time = excluded.has_exact_time;

        -- A history row stored under the OTHER orientation would survive the
        -- upsert above as a second row for the same match.
        delete from public.match_history h
         where h.league_id = v_league
           and h.player_a = x.player_b and h.player_b = x.player_a;

        perform set_config('app.batch_id', '', true);
        raise notice '% vs %: dated %', x.player_a, x.player_b, v_at;
    end loop;

    if v_n <> v_expected then
        raise exception 'Found % matches, expected % — nothing was changed. Check STEP 1.',
            v_n, v_expected;
    end if;
end;
$$;
