-- ============================================================================
-- repair_september_2026_round_25.sql — restore rounds 24 and 25, then let the
-- two waiting e-mail reports apply themselves.
--
-- WHAT HAPPENED
-- September 2026 was created from a TRUNCATED export: the last two rounds were
-- absent. The CSV was still perfectly self-consistent — every round 13 rows, all
-- 25 players present — so validateCsvStructure() had nothing to object to (with
-- `expected` null, at creation, it only checks self-consistency). The league was
-- published with 276 fixtures instead of C(25,2) = 300, and 276 then became its
-- locked shape.
--
-- The visible symptom: two real results arrived by e-mail and were refused with
-- "Not scheduled to meet" — mail_orphan_reason()'s last-resort answer. True, and
-- useless: the pairs have no fixture because the fixtures were never created.
--
-- HOW THE TWO MISSING ROUNDS WERE IDENTIFIED
-- In a 25-player round-robin each player byes exactly once. Reading the bye rows
-- of the source's own 25-round export: rounds 1-23 hold the byes of 23 players;
-- Hummus byes in round 24 and YKwin in round 25. Those two are therefore the only
-- players who play in EVERY round the database holds — which is exactly what the
-- database shows (23 players with 22 fixtures, Hummus and YKwin with 23). The
-- stored rounds 1-23 are the source's rounds 1-23, unshifted, so this script only
-- appends; nothing existing is renumbered or touched.
--
-- WHAT THIS DOES
--   Step 2 inserts the 24 missing fixtures as rounds 24 and 25, UNPLAYED.
--   Step 3 re-runs the resolver on the two reports waiting for them, which finds
--          exactly one candidate league each and applies the scores ITSELF.
--
-- NO SCORE IS TYPED ANYWHERE IN THIS FILE — not even the one the export already
-- carries (fridlich 7-1 UV1). Both results reach the league by the ordinary mail
-- path, so they land in matches + match_history + audit like every other one.
--
-- Note on Nissimb vs YossiEliezer23: it is unplayed even in the current export.
-- A CSV sync would not bring it. The e-mail report is the only source for that
-- result, which is why discarding it would lose it for good.
--
-- Pairs and their A/B order below are transcribed from the source export's own
-- rounds 24 and 25, so a later sync keys the same rows rather than re-creating
-- them. Bye rows are omitted: `matches` never stores them (see csvParser.js).
--
-- Run in the Supabase SQL Editor, in order. Steps 0 and 1 change nothing.
-- ============================================================================


-- ── Step 0: confirm the diagnosis ───────────────────────────────────────────
-- Expect: players = 25, rounds = 23, fixtures = 276, expected_fixtures = 300.
-- `running` must be true and `match_length` = 7 — mail_candidate_leagues()
-- filters on both, so Step 3 is a silent no-op without them.
with roster as (
    select player_a as p from public.matches where league_id = 'September 2026'
    union
    select player_b     from public.matches where league_id = 'September 2026'
)
select
    (select count(*) from roster)                                             as players,
    (select count(*) * (count(*) - 1) / 2 from roster)                        as expected_fixtures,
    (select count(*) from public.matches where league_id = 'September 2026')  as fixtures,
    (select max(round) from public.matches where league_id = 'September 2026') as rounds,
    (select running from public.leagues where id = 'September 2026')          as running,
    (select archived from public.leagues where id = 'September 2026')         as archived,
    (select match_length from public.leagues where id = 'September 2026')     as match_length;

-- The two reports this repair is for, and why they are stuck.
select r.id,
       r.payload->>'player_a' as player_a,
       r.payload->>'player_b' as player_b,
       (r.payload->>'score_a') || ' - ' || (r.payload->>'score_b') as score,
       r.payload->>'match_length' as len,
       jsonb_array_length(r.candidates) as candidates,
       p.reason,
       r.received_at
  from public.match_reports r
  left join public.mail_reports_pending() p on p.id = r.id
 where r.status = 'pending_assign'
 order by r.received_at desc;


-- ── Step 1: prove the fixtures below are exactly the missing ones ───────────
-- Left join of the 24 pairs this script will insert against the pairs the league
-- already holds. Every row must read 'MISSING'. An 'ALREADY EXISTS' means the
-- diagnosis is wrong and Step 2 must not be run.
with incoming (round, player_a, player_b) as (values
    (24, 'Moriarty',   'Avshalom'),       (24, 'UziMutsafy', 'YossiEliezer23'),
    (24, 'bardak65',   'GS18671'),        (24, 'Nissimb',    'sagivquina'),
    (24, 'GuyEliyahu', 'OvedBenZeev'),    (24, 'MarcelDana', 'Danny_kondrea'),
    (24, 'ys',         'ilanblum'),       (24, 'Yannay',     'gidio'),
    (24, 'Yaniv162',   'Efi'),            (24, 'Avi',        'avila07'),
    (24, 'Izhako',     'UV1'),            (24, 'YKwin',      'fridlich'),
    (25, 'Moriarty',   'UziMutsafy'),     (25, 'bardak65',   'Avshalom'),
    (25, 'Nissimb',    'YossiEliezer23'), (25, 'GuyEliyahu', 'GS18671'),
    (25, 'MarcelDana', 'sagivquina'),     (25, 'ys',         'OvedBenZeev'),
    (25, 'Yannay',     'Danny_kondrea'),  (25, 'Yaniv162',   'ilanblum'),
    (25, 'Avi',        'gidio'),          (25, 'Hummus',     'Efi'),
    (25, 'Izhako',     'avila07'),        (25, 'fridlich',   'UV1')
)
select i.round, i.player_a, i.player_b,
       case when m.id is null then 'MISSING' else 'ALREADY EXISTS — STOP' end as status
  from incoming i
  left join public.matches m
    on m.league_id = 'September 2026'
   and least(m.player_a, m.player_b)    = least(i.player_a, i.player_b)
   and greatest(m.player_a, m.player_b) = greatest(i.player_a, i.player_b)
 order by i.round, i.player_a;

-- And the reverse direction: are there missing pairs this script does NOT cover?
-- Must return zero rows.
with roster as (
    select player_a as p from public.matches where league_id = 'September 2026'
    union
    select player_b     from public.matches where league_id = 'September 2026'
),
all_pairs as (select x.p a, y.p b from roster x join roster y on x.p < y.p),
scheduled as (
    select least(player_a, player_b) a, greatest(player_a, player_b) b
      from public.matches where league_id = 'September 2026'
),
missing as (select a, b from all_pairs except select a, b from scheduled),
incoming (player_a, player_b) as (values
    ('Moriarty','Avshalom'),      ('UziMutsafy','YossiEliezer23'),
    ('bardak65','GS18671'),       ('Nissimb','sagivquina'),
    ('GuyEliyahu','OvedBenZeev'), ('MarcelDana','Danny_kondrea'),
    ('ys','ilanblum'),            ('Yannay','gidio'),
    ('Yaniv162','Efi'),           ('Avi','avila07'),
    ('Izhako','UV1'),             ('YKwin','fridlich'),
    ('Moriarty','UziMutsafy'),    ('bardak65','Avshalom'),
    ('Nissimb','YossiEliezer23'), ('GuyEliyahu','GS18671'),
    ('MarcelDana','sagivquina'),  ('ys','OvedBenZeev'),
    ('Yannay','Danny_kondrea'),   ('Yaniv162','ilanblum'),
    ('Avi','gidio'),              ('Hummus','Efi'),
    ('Izhako','avila07'),         ('fridlich','UV1')
)
select m.a as uncovered_player_a, m.b as uncovered_player_b
  from missing m
 where not exists (
     select 1 from incoming i
      where least(i.player_a, i.player_b)    = m.a
        and greatest(i.player_a, i.player_b) = m.b);


-- ── Step 2: create rounds 24 and 25 ─────────────────────────────────────────
-- One transaction, one audit batch, guarded by assertions that refuse to run on
-- a league whose gap does not match the diagnosis above.
begin;

do $$
declare
    v_players  int;
    v_rounds   int;
    v_missing  int;
    v_batch    uuid;
    v_inserted int;
    v_short    int;
begin
    if not exists (select 1 from public.leagues where id = 'September 2026') then
        raise exception 'League "September 2026" not found — wrong database?';
    end if;

    with roster as (
        select player_a as p from public.matches where league_id = 'September 2026'
        union
        select player_b     from public.matches where league_id = 'September 2026'
    ),
    all_pairs as (select x.p a, y.p b from roster x join roster y on x.p < y.p),
    scheduled as (
        select least(player_a, player_b) a, greatest(player_a, player_b) b
          from public.matches where league_id = 'September 2026'
    ),
    missing as (select a, b from all_pairs except select a, b from scheduled)
    select (select count(*) from roster),
           (select max(round) from public.matches where league_id = 'September 2026'),
           (select count(*) from missing)
      into v_players, v_rounds, v_missing;

    -- Each assertion names the number it expected, so a failure says which
    -- assumption broke rather than just refusing.
    if v_players <> 25 then
        raise exception 'Expected a 25-player roster, found %', v_players;
    end if;
    if v_rounds <> 23 then
        raise exception 'Expected 23 existing rounds, found % — rounds 24/25 may already exist', v_rounds;
    end if;
    if v_missing <> 24 then
        raise exception 'Expected 24 missing fixtures, found % — the gap is not the last two rounds', v_missing;
    end if;

    -- One Historical Changes entry for the whole insert. Without it the per-row
    -- audit trigger writes 24 separate rows into the history list.
    insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
    values (coalesce(auth.email(), 'admin'), 'league', 'September 2026',
            'Match data updated', '📊',
            'Rounds 24-25 restored — 24 fixtures the original import was missing, added unplayed')
    returning id into v_batch;
    perform set_config('app.batch_id', v_batch::text, true);

    insert into public.matches
        (league_id, round, player_a, player_b, pr_a, luck_a, score_a, pr_b, luck_b, score_b, played)
    select 'September 2026', v.round, v.a, v.b, 0, 0, 0, 0, 0, 0, false
      from (values
        (24, 'Moriarty',   'Avshalom'),       (24, 'UziMutsafy', 'YossiEliezer23'),
        (24, 'bardak65',   'GS18671'),        (24, 'Nissimb',    'sagivquina'),
        (24, 'GuyEliyahu', 'OvedBenZeev'),    (24, 'MarcelDana', 'Danny_kondrea'),
        (24, 'ys',         'ilanblum'),       (24, 'Yannay',     'gidio'),
        (24, 'Yaniv162',   'Efi'),            (24, 'Avi',        'avila07'),
        (24, 'Izhako',     'UV1'),            (24, 'YKwin',      'fridlich'),
        (25, 'Moriarty',   'UziMutsafy'),     (25, 'bardak65',   'Avshalom'),
        (25, 'Nissimb',    'YossiEliezer23'), (25, 'GuyEliyahu', 'GS18671'),
        (25, 'MarcelDana', 'sagivquina'),     (25, 'ys',         'OvedBenZeev'),
        (25, 'Yannay',     'Danny_kondrea'),  (25, 'Yaniv162',   'ilanblum'),
        (25, 'Avi',        'gidio'),          (25, 'Hummus',     'Efi'),
        (25, 'Izhako',     'avila07'),        (25, 'fridlich',   'UV1')
      ) as v(round, a, b);

    get diagnostics v_inserted = row_count;
    perform set_config('app.batch_id', '', true);

    if v_inserted <> 24 then
        raise exception 'Inserted % rows, expected 24 — rolling back', v_inserted;
    end if;

    -- The real proof: after this insert every player must hold 24 fixtures.
    -- A name that does not exist in the league would leave two players short and
    -- create a 26th player, and this is what catches it.
    select count(*) into v_short from (
        select p from (
            select player_a as p from public.matches where league_id = 'September 2026'
            union all
            select player_b     from public.matches where league_id = 'September 2026'
        ) q group by p having count(*) <> 24
    ) bad;
    if v_short <> 0 then
        raise exception '% player(s) do not hold exactly 24 fixtures — rolling back', v_short;
    end if;

    update public.leagues set last_updated = now() where id = 'September 2026';
    raise notice 'Rounds 24-25 created: % fixtures, audit batch %', v_inserted, v_batch;
end $$;

commit;


-- ── Step 3: let the reports apply themselves ────────────────────────────────
-- Scoped deliberately to reports whose pair is one of the fixtures just created.
-- A blanket re-resolve of the whole queue would also auto-apply reports pending
-- for entirely unrelated reasons — a far wider blast radius than this repair.
--
-- mail_resolve_report() re-scans, finds exactly one candidate league, and calls
-- mail_apply_report() itself. Returns ok=true, auto=true and the match_id when
-- it applied; auto=false plus a candidate count when it did not.
select r.id,
       r.payload->>'player_a' as player_a,
       r.payload->>'player_b' as player_b,
       public.mail_resolve_report(r.id) as result
  from public.match_reports r
 where r.status = 'pending_assign'
   and exists (
       select 1 from public.matches m
        where m.league_id = 'September 2026'
          and m.round in (24, 25)
          and least(m.player_a, m.player_b)    = least(r.payload->>'player_a', r.payload->>'player_b')
          and greatest(m.player_a, m.player_b) = greatest(r.payload->>'player_a', r.payload->>'player_b')
   );


-- ── Step 4: confirm ─────────────────────────────────────────────────────────
-- fixtures = 300, rounds = 25.
select count(*) as fixtures, max(round) as rounds
  from public.matches where league_id = 'September 2026';

-- Rounds 24-25: 24 rows, of which exactly the two reported ones are played.
select round, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, played
  from public.matches
 where league_id = 'September 2026' and round in (24, 25)
 order by round, played desc, player_a;

-- Both reports should read 'applied', auto_applied = true, with a match_id.
select id, status, auto_applied, league_id, match_id, resolved_at, resolved_by
  from public.match_reports
 where league_id = 'September 2026' or status = 'pending_assign'
 order by received_at desc;


-- ── Undo ────────────────────────────────────────────────────────────────────
-- Only if nothing else has touched the league since. Order matters: the reports
-- must be released BEFORE their fixtures are deleted, or the FK sets match_id to
-- null and the link is lost.
--
--   update public.match_reports
--      set status = 'pending_assign', auto_applied = false,
--          league_id = null, match_id = null, resolved_at = null, resolved_by = null
--    where league_id = 'September 2026' and auto_applied;
--
--   delete from public.match_history h
--    where h.league_id = 'September 2026'
--      and exists (
--          select 1 from public.matches m
--           where m.league_id = 'September 2026' and m.round in (24, 25)
--             and least(m.player_a, m.player_b)    = least(h.player_a, h.player_b)
--             and greatest(m.player_a, m.player_b) = greatest(h.player_a, h.player_b));
--
--   delete from public.matches where league_id = 'September 2026' and round in (24, 25);
--
-- (match_history is matched order-independently on purpose: mail_apply_report
--  writes it in the REPORT's orientation, which need not match the fixture's.)
--
-- Rounds 24 and 25 are the only ones this script created, so `round in (24,25)`
-- targets exactly its own rows and cannot reach an original fixture.
-- ============================================================================
