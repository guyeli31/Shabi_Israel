-- repair_november_mail_times_2026-11-02_3_verify.sql — READ-ONLY.
-- Run after _2_apply.sql. Expected:
--   history  — two rows, dated 2026-11-01 21:23:07+00 and 21:41:07+00
--   report   — 1282 and 1283, both "applied / November 2026 Regular"
--   override — no rows

select 'history' as what, h.player_a || ' vs ' || h.player_b as pair,
       h.updated_at::text as detail
  from public.match_history h
 where h.league_id = 'November 2026 Regular'
   and h.player_a in ('UziMutsafy', 'SHIMICO', 'pshapiro', 'rina')
union all
select 'report', (r.payload->>'player_a') || ' vs ' || (r.payload->>'player_b'),
       r.status || ' / ' || coalesce(r.league_id, '-')
  from public.match_reports r where r.id in (1282, 1283)
union all
select 'override', o.player_a || ' vs ' || o.player_b, o.type
  from public.manual_overrides o
 where o.league_id = 'November 2026 Regular'
   and o.player_a in ('SHIMICO', 'rina');
