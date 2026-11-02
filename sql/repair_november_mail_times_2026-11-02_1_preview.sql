-- repair_november_mail_times_2026-11-02_1_preview.sql — READ-ONLY. Run first; expect the two matches.
-- The full story is in repair_november_mail_times_2026-11-02_2_apply.sql.

-- ── STEP 1 — preview (read-only) ───────────────────────────────────────────
select m.id                    as match_id,
       m.round,
       m.player_a || ' vs ' || m.player_b as fixture,
       m.score_a || '-' || m.score_b      as stored_score,
       r.id                    as report_id,
       r.status                as report_status,
       r.received_at,
       coalesce((r.payload->>'played_at')::timestamptz, r.received_at) as new_history_time,
       h.updated_at            as current_history_time,
       o.type                  as override_type
  from public.matches m
  join public.match_reports r
    on r.status <> 'applied'
   and r.received_at >= timestamptz '2026-11-01 00:00:00+02'
   and ((r.payload->>'player_a' = m.player_a and r.payload->>'player_b' = m.player_b)
     or (r.payload->>'player_a' = m.player_b and r.payload->>'player_b' = m.player_a))
   and (case when r.payload->>'player_a' = m.player_a then r.payload->>'score_a' else r.payload->>'score_b' end)::numeric = m.score_a
   and (case when r.payload->>'player_a' = m.player_a then r.payload->>'score_b' else r.payload->>'score_a' end)::numeric = m.score_b
  left join public.match_history h
    on h.league_id = m.league_id
   and least(h.player_a, h.player_b) = least(m.player_a, m.player_b)
   and greatest(h.player_a, h.player_b) = greatest(m.player_a, m.player_b)
  left join public.manual_overrides o
    on o.league_id = m.league_id
   and least(o.player_a, o.player_b) = least(m.player_a, m.player_b)
   and greatest(o.player_a, o.player_b) = greatest(m.player_a, m.player_b)
 where m.league_id = 'November 2026 Regular'
   and m.played
 order by r.received_at;

