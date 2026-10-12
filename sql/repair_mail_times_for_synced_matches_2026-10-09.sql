-- repair_mail_times_for_synced_matches_2026-10-09.sql — give a match the time it
-- was played, when its mail report arrived only AFTER a sync had recorded it.
--
-- WHAT HAPPENED
-- From 7 Oct 2026 10:16 (Israel) the mailbox script lost its Google
-- authorisation and stopped forwarding match reports — the mailbox owner had
-- changed the account password, which revokes every Apps Script grant on the
-- account ("Authorization is required to perform that action" in the script's
-- Executions list; the trigger then stops firing). The reports kept
-- arriving in the mailbox, unprocessed. Meanwhile External Source syncs brought
-- the same matches in — and a sync has no played-at moment to give, so it
-- stamped each one with its own clock.
--
-- On 9 Oct the script was re-authorised and sent the whole backlog at once,
-- each report carrying its true played_at (the mail's own date). But a report
-- applies itself only to an OPEN fixture, and these fixtures were already
-- played — so they all landed in the admin's pending list ("match no open
-- fixture in any running league"), and the matches kept the sync's time.
--
-- WHAT THIS DOES
-- Pairs each such pending report with the match it describes, moves that
-- match's time to the report's played_at, and closes the report as applied.
-- The result on screen is what it would have been had the mail never stopped.
--
-- WHEN A REPORT IS "THE SAME MATCH" (all must hold)
--   • the report is still pending
--   • a running league holds this pair in match_history, as a source ('csv') row
--   • the league's match length equals the report's
--   • the league's type agrees with the report's source code (325/326/331 —
--     public.mail_source_types). This is what tells apart the same two people
--     in this month's DOUBLING and this month's UBC
--   • the SCORE is identical, oriented to the stored row — so it is this
--     result, not the pair's other meeting
--   • PR and Luck agree to the source's rounding (mail: 3 decimals, sync: 2)
--   • exactly ONE league and ONE report match each other — anything ambiguous
--     is left for a human and listed in 2(c)
--
-- WHAT IT DOES NOT TOUCH
-- The stored PR/Luck figures (they stay at the sync's two decimals), `matches`,
-- any manual override, and any report it could not pair with certainty.
--
-- Run in the Supabase SQL Editor (cloud). Sections 1–2 only read (and fill a
-- work table); section 3 is the write. Idempotent.

-- ============================================================================
-- 1. COLLECT
-- ============================================================================
create table if not exists public.mail_time_repair_log (
    report_id    bigint primary key,
    history_id   bigint      not null,
    league_id    text        not null,
    player_a     text        not null,
    player_b     text        not null,
    sync_stamp   timestamptz not null,   -- what the match showed
    played_at    timestamptz not null,   -- what the report says
    applied_at   timestamptz             -- set by section 3
);
alter table public.mail_time_repair_log enable row level security;  -- no policy: not served

delete from public.mail_time_repair_log where applied_at is null;

with rep as (
    select r.id as report_id,
           r.payload->>'player_a' as p_a, r.payload->>'player_b' as p_b,
           (r.payload->>'score_a')::numeric as s_a, (r.payload->>'score_b')::numeric as s_b,
           (r.payload->>'pr_a')::numeric    as pr_a, (r.payload->>'pr_b')::numeric   as pr_b,
           (r.payload->>'luck_a')::numeric  as l_a,  (r.payload->>'luck_b')::numeric as l_b,
           (r.payload->>'match_length')::int as len,
           r.payload->>'source_ref' as source_ref,
           coalesce((r.payload->>'played_at')::timestamptz, r.received_at) as played_at
    from   public.match_reports r
    where  r.status = 'pending_assign'
),
pairs as (
    select rep.report_id, rep.played_at,
           h.id as history_id, h.league_id, h.player_a, h.player_b, h.updated_at
    from   rep
    join   public.match_history h
           on (h.player_a = rep.p_a and h.player_b = rep.p_b)
           or (h.player_a = rep.p_b and h.player_b = rep.p_a)
    join   public.leagues l on l.id = h.league_id
    left join public.mail_source_types t on t.source_ref = rep.source_ref
    -- The report's figures, turned to face the stored row's A/B.
    cross join lateral (
        select case when h.player_a = rep.p_a then rep.s_a  else rep.s_b  end as s_a,
               case when h.player_a = rep.p_a then rep.s_b  else rep.s_a  end as s_b,
               case when h.player_a = rep.p_a then rep.pr_a else rep.pr_b end as pr_a,
               case when h.player_a = rep.p_a then rep.pr_b else rep.pr_a end as pr_b,
               case when h.player_a = rep.p_a then rep.l_a  else rep.l_b  end as l_a,
               case when h.player_a = rep.p_a then rep.l_b  else rep.l_a  end as l_b
    ) o
    where  l.running
      and  h.source = 'csv'
      and  h.has_exact_time
      and  (l.match_length is null or l.match_length = rep.len)
      and  (t.league_type is null or t.league_type = l.league_type)
      and  h.score_a = o.s_a and h.score_b = o.s_b
      -- Same figures, allowing for the source's two decimals (half a unit of the
      -- last one, plus slack — the rule in js/data/matchValueEquality.js).
      and  abs(coalesce(h.pr_a, 0)   - coalesce(o.pr_a, 0)) <= 0.0051
      and  abs(coalesce(h.pr_b, 0)   - coalesce(o.pr_b, 0)) <= 0.0051
      and  abs(coalesce(h.luck_a, 0) - coalesce(o.l_a, 0))  <= 0.0051
      and  abs(coalesce(h.luck_b, 0) - coalesce(o.l_b, 0))  <= 0.0051
      and  h.updated_at <> rep.played_at
),
certain as (
    select p.*,
           count(*) over (partition by report_id)  as leagues_for_report,
           count(*) over (partition by history_id) as reports_for_match
    from   pairs p
)
insert into public.mail_time_repair_log
       (report_id, history_id, league_id, player_a, player_b, sync_stamp, played_at)
select report_id, history_id, league_id, player_a, player_b, updated_at, played_at
from   certain
where  leagues_for_report = 1 and reports_for_match = 1
on conflict (report_id) do nothing;

-- ============================================================================
-- 2. DRY RUN — read before writing
-- ============================================================================
-- (a) Per league: how many matches get their time back, and from when to when.
select league_id,
       count(*)                                          as matches,
       min(played_at) at time zone 'Asia/Jerusalem'      as earliest_il,
       max(played_at) at time zone 'Asia/Jerusalem'      as latest_il,
       count(distinct sync_stamp)                        as sync_stamps_replaced
from   public.mail_time_repair_log
where  applied_at is null
group by league_id
order by league_id;

-- (b) Every match. `will_show` should always be EARLIER than `now_shows`: a
--     match is played before the sync that reads it.
select report_id, league_id, player_a, player_b,
       sync_stamp at time zone 'Asia/Jerusalem' as now_shows,
       played_at  at time zone 'Asia/Jerusalem' as will_show,
       case when played_at > sync_stamp then 'LATER THAN THE SYNC — look at this one' else 'ok' end as sanity
from   public.mail_time_repair_log
where  applied_at is null
order by league_id, played_at;

-- (c) Pending reports this repair leaves alone — no certain match was found.
--     These stay in the admin's pending list for a human.
select r.id as report_id,
       r.payload->>'player_a' as player_a, r.payload->>'player_b' as player_b,
       (r.payload->>'score_a') || '-' || (r.payload->>'score_b') as score,
       r.payload->>'match_length' as len, r.payload->>'source_ref' as source_ref,
       (r.payload->>'played_at')::timestamptz at time zone 'Asia/Jerusalem' as played_il
from   public.match_reports r
where  r.status = 'pending_assign'
  and  not exists (select 1 from public.mail_time_repair_log l where l.report_id = r.id)
order by r.received_at;

-- ============================================================================
-- 3. THE WRITE
-- ============================================================================
begin;

-- One summary row in audit_log instead of one per match (same flag
-- rename_league() and the earlier repair use). The per-STATEMENT projection
-- triggers still fire, which is wanted: the timeline really does change.
select set_config('app.suppress_audit', 'true', true);

with done as (
    update public.match_history h
    set    updated_at = l.played_at
    from   public.mail_time_repair_log l
    where  l.history_id = h.id
      and  l.applied_at is null
      and  h.updated_at = l.sync_stamp      -- still the sync's stamp, re-checked at write time
    returning l.report_id, h.league_id, h.player_a, h.player_b
),
closed as (
    -- The report did its job: it is applied, to this league and this fixture.
    update public.match_reports r
    set    status       = 'applied',
           league_id    = d.league_id,
           match_id     = (select m.id from public.matches m
                            where m.league_id = d.league_id
                              and least(m.player_a, m.player_b)    = least(d.player_a, d.player_b)
                              and greatest(m.player_a, m.player_b) = greatest(d.player_a, d.player_b)
                            limit 1),
           auto_applied = false,
           resolved_at  = now(),
           resolved_by  = coalesce(auth.email(), 'migration') || ' (time repair)'
    from   done d
    where  r.id = d.report_id
      and  r.status = 'pending_assign'
    returning r.id
)
update public.mail_time_repair_log l
set    applied_at = now()
from   closed c
where  c.id = l.report_id;

insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
select 'match_history', 'mail_time_repair', 'UPDATE',
       jsonb_build_object('updated_at', 'the sync''s clock'),
       jsonb_build_object('updated_at', 'played_at from the late mail report', 'matches', count(*)),
       coalesce(auth.email(), 'migration')
from   public.mail_time_repair_log
where  applied_at >= now()                  -- now() is fixed for the transaction
having count(*) > 0;

commit;

-- ============================================================================
-- 4. VERIFY
-- ============================================================================
-- Expect: nothing left unapplied.
select count(*) filter (where applied_at is not null) as restored,
       count(*) filter (where applied_at is null)     as left_unapplied
from   public.mail_time_repair_log;

-- Expect: the pending list shrank by exactly `restored`.
select status, count(*) from public.match_reports group by status order by status;

-- Expect: no October league with 5+ matches on one instant any more — every
-- row here is a match that still has only a sync's time.
select league_id, updated_at at time zone 'Asia/Jerusalem' as israel_time, count(*) as matches
from   public.match_history
where  has_exact_time
  and  updated_at >= timestamptz '2026-10-01 00:00:00+00'
group by league_id, updated_at
having count(*) >= 5
order by count(*) desc;
