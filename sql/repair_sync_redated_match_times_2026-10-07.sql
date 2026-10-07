-- repair_sync_redated_match_times_2026-10-07.sql — give matches back the time
-- they were played, after an External Source sync restamped them with its own.
--
-- WHAT HAPPENED
-- A mail report writes a result with THREE decimals (pr 8.054, luck 1.355) and
-- the moment it was played. The External Source serves the same match with TWO
-- (8.05, 1.36). The sync therefore sees every mail-recorded match as "changed":
-- it rewrites `matches`, and the match_history reconcile
-- (js/data/matchHistoryReconcile.js) — whose rule is "numbers differ → the
-- result changed → stamp now" — moves `updated_at` to the sync's own clock.
-- Same score, same winner, a rounding step, and the played-at moment is gone.
--
-- A league whose results all arrived by mail (every October 2026 league) loses
-- every time at once on its first sync. This is not new: the audit log shows the
-- same thing on 16–18 Aug 2026 for the August leagues, a few rows at a time.
--
-- WHERE THE TIMES ARE
-- In audit_log. match_history carries the per-row audit trigger, so each
-- restamp left an UPDATE row whose old_value holds the timestamp it destroyed.
-- Nothing is reconstructed or guessed — every restored value is read back.
--
-- WHAT COUNTS AS A RESTAMP (all must hold)
--   • an UPDATE of match_history at/after `since` (section 1)
--   • not written by a mail apply (those carry a real played_at on purpose)
--   • source stayed 'csv' — an admin's manual edit is a real change, left alone
--   • updated_at moved FORWARD
--   • score_a and score_b unchanged — a sync that changed the SCORE recorded a
--     real change of result; those are listed in 2(c) and not touched
--   • the row still carries the stamp that update gave it — anything edited
--     again since is left alone
--
-- Run in the Supabase SQL Editor (cloud). Sections 1–2 only read (and fill a
-- work table); section 3 is the write. Idempotent: a second run restores nothing.
--
-- NOT FIXED HERE: the cause. Until the reconcile stops treating a rounding step
-- as a new result, the next sync that meets a mail-recorded match does this
-- again — do not run a sync between this repair and that fix.

-- ============================================================================
-- 1. COLLECT — one row per match whose time was overwritten
-- ============================================================================
-- A real table rather than a temp one: the SQL Editor does not promise that two
-- separately-run sections share a session. It also stays behind as the record
-- of exactly what this repair changed (sync_stamp → restored_at).
create table if not exists public.sync_redate_repair_log (
    history_id   bigint primary key,
    league_id    text        not null,
    player_a     text        not null,
    player_b     text        not null,
    sync_stamp   timestamptz not null,   -- what the sync wrote
    restored_at  timestamptz not null,   -- what it had destroyed
    audit_id     bigint      not null,   -- the audit_log row this was read from
    applied_at   timestamptz             -- set by section 3
);
alter table public.sync_redate_repair_log enable row level security;  -- no policy: not served

-- Rebuild the not-yet-applied part on every run, so changing `since` and
-- re-running the dry run never leaves stale candidates behind.
delete from public.sync_redate_repair_log where applied_at is null;

with params as (
    -- Every restamp from here on is undone. 15 Aug 2026 = the day mail reports
    -- began: before it no match carried a played-at moment for a sync to
    -- destroy, so this reaches every restamp there has ever been — the
    -- 16–18 Aug ones in the August leagues as well as the 7 Oct sync this file
    -- was first run for (then with since = 1 Oct; those rows are already
    -- applied and are not touched again).
    select timestamptz '2026-08-15 00:00:00+00' as since
),
restamps as (
    select a.id                                        as audit_id,
           (a.new_value->>'id')::bigint                as history_id,
           (a.old_value->>'updated_at')::timestamptz   as old_at,
           (a.new_value->>'updated_at')::timestamptz   as new_at
    from   public.audit_log a
    left join public.audit_batches b on b.id = a.batch_id
    cross join params p
    where  a.table_name = 'match_history'
      and  a.action     = 'UPDATE'
      and  a.changed_at >= p.since
      and  coalesce(b.detail, '') not like '%e-mail report'
      and  a.old_value->>'source' = 'csv'
      and  a.new_value->>'source' = 'csv'
      and  (a.new_value->>'updated_at')::timestamptz > (a.old_value->>'updated_at')::timestamptz
      and  (a.old_value->>'score_a')::numeric is not distinct from (a.new_value->>'score_a')::numeric
      and  (a.old_value->>'score_b')::numeric is not distinct from (a.new_value->>'score_b')::numeric
),
-- A match restamped by two syncs in the window: the time to give back is the
-- one the FIRST of them destroyed; the stamp to recognise is the LAST one's.
per_row as (
    select history_id,
           (array_agg(old_at   order by audit_id asc))[1]  as restored_at,
           (array_agg(audit_id order by audit_id asc))[1]  as audit_id,
           (array_agg(new_at   order by audit_id desc))[1] as last_stamp
    from   restamps
    group by history_id
)
insert into public.sync_redate_repair_log
       (history_id, league_id, player_a, player_b, sync_stamp, restored_at, audit_id)
select h.id, h.league_id, h.player_a, h.player_b, h.updated_at, r.restored_at, r.audit_id
from   per_row r
join   public.match_history h on h.id = r.history_id
where  h.updated_at = r.last_stamp          -- untouched since the sync
  and  h.source = 'csv'
on conflict (history_id) do nothing;        -- already repaired on an earlier run

-- ============================================================================
-- 2. DRY RUN — read before writing
-- ============================================================================
-- (a) Per league and per sync stamp. Expect each damaged league as ONE row per
--     sync run: many matches sharing a single stamp, spread back over many
--     distinct real times.
select league_id,
       sync_stamp,
       count(*)                     as matches,
       count(distinct restored_at)  as distinct_real_times,
       min(restored_at)             as earliest,
       max(restored_at)             as latest
from   public.sync_redate_repair_log
where  applied_at is null
group by league_id, sync_stamp
order by sync_stamp, league_id;

-- (b) Every match, shown in Israel time.
select league_id, player_a, player_b,
       sync_stamp  at time zone 'Asia/Jerusalem' as now_shows,
       restored_at at time zone 'Asia/Jerusalem' as will_show
from   public.sync_redate_repair_log
where  applied_at is null
order by league_id, restored_at;

-- (c) NOT restored: the sync changed the SCORE as well as the time. That is a
--     change of result, so the new time may be the right one. Expect a handful
--     in the August leagues, to judge by hand.
select a.changed_at, a.new_value->>'league_id' as league_id,
       a.new_value->>'player_a' as player_a, a.new_value->>'player_b' as player_b,
       (a.old_value->>'score_a') || '-' || (a.old_value->>'score_b') as score_before,
       (a.new_value->>'score_a') || '-' || (a.new_value->>'score_b') as score_after,
       a.old_value->>'updated_at' as time_before
from   public.audit_log a
left join public.audit_batches b on b.id = a.batch_id
where  a.table_name = 'match_history'
  and  a.action     = 'UPDATE'
  and  a.changed_at >= timestamptz '2026-08-15 00:00:00+00'   -- keep equal to `since`
  and  coalesce(b.detail, '') not like '%e-mail report'
  and  a.old_value->>'source' = 'csv'
  and  a.new_value->>'source' = 'csv'
  and  ((a.old_value->>'score_a')::numeric is distinct from (a.new_value->>'score_a')::numeric
     or (a.old_value->>'score_b')::numeric is distinct from (a.new_value->>'score_b')::numeric)
order by a.changed_at;

-- ============================================================================
-- 3. THE WRITE
-- ============================================================================
begin;

-- One UPDATE per match would otherwise put one row per match into audit_log and
-- bury Historical Changes. Same transaction-local flag rename_league() and
-- match_time_precision.sql use; one summary row is logged below instead.
-- (The per-STATEMENT projection triggers still fire, which is wanted: the
--  timeline these leagues are replayed along really does change back.)
select set_config('app.suppress_audit', 'true', true);

with done as (
    update public.match_history h
    set    updated_at = l.restored_at
    from   public.sync_redate_repair_log l
    where  l.history_id = h.id
      and  l.applied_at is null
      and  h.updated_at = l.sync_stamp      -- still the sync's stamp, re-checked at write time
    returning h.id
)
update public.sync_redate_repair_log l
set    applied_at = now()
from   done
where  done.id = l.history_id;

insert into public.audit_log (table_name, row_pk, action, old_value, new_value, changed_by)
select 'match_history', 'sync_redate_repair', 'UPDATE',
       jsonb_build_object('updated_at', 'restamped by an External Source sync'),
       jsonb_build_object('updated_at', 'restored from audit_log', 'matches', count(*)),
       coalesce(auth.email(), 'migration')
from   public.sync_redate_repair_log
where  applied_at >= now()                  -- now() is fixed for the transaction
having count(*) > 0;

commit;

-- ============================================================================
-- 4. VERIFY
-- ============================================================================
-- Expect: zero rows left unapplied.
select count(*) filter (where applied_at is not null) as restored,
       count(*) filter (where applied_at is null)     as left_unapplied
from   public.sync_redate_repair_log;

-- Expect: no October league with a pile of matches on one instant, other than
-- the matches a sync itself brought in for the first time (they have no earlier
-- time to return to). Deliberately October only: in August an ordinary sync
-- legitimately stamped many new results at once.
select league_id, updated_at at time zone 'Asia/Jerusalem' as israel_time, count(*) as matches
from   public.match_history
where  has_exact_time
  and  updated_at >= timestamptz '2026-10-01 00:00:00+00'
group by league_id, updated_at
having count(*) >= 5
order by count(*) desc;
