-- ============================================================================
-- mail_sync.sql — Real-time match ingestion from External Source e-mail reports
--
-- Flow:
--   automation (recipient's mailbox)
--     → submit_match_report(token, payload)          [anon, token-gated]
--       → mail_resolve_report()                      [scan running leagues]
--         → exactly 1 eligible candidate → mail_apply_report() → matches + history
--           0 or >1 eligible             → status pending_assign, admin picks in F8
--
--   "Eligible" = a candidate whose league type agrees with the report's source
--   code (public.mail_source_types), or any candidate when the code is absent
--   or unmapped. See the note above that table.
--
-- Design notes:
--
--  • NO Supabase key is issued to the reporting side. `anon` may execute
--    exactly one function; every table stays RLS-closed with no policies.
--    The shared secret is a random token, stored only as a SHA-256 hash.
--
--  • Applying a report is an UPDATE of an existing UNPLAYED fixture row, not
--    an INSERT. `matches` already carries the full round-robin (played +
--    unplayed) — see js/data/supabaseLoader.js loadLeagueMatches. That is also
--    what makes league inference possible at all: a candidate league is one
--    that already has this exact pairing as an open fixture.
--
--  • Override immunity, per spec: a pairing covered by manual_overrides is NOT
--    a candidate. Mail behaves exactly like a CSV import here (the same rule
--    js/admin/csvValidation.js applies to "N updates").
--
--  • match_history.source is written as 'csv' — deliberately. The spec is that
--    a mail-applied match is indistinguishable from a CSV-uploaded one for
--    override precedence and Historical Changes. Provenance is not lost: it
--    lives in match_reports, which is what the F9 table reads.
--
--  • Audit: mail_apply_report opens an audit_batches row and sets the
--    `app.batch_id` GUC before writing, so every touched row lands in ONE
--    Historical Changes entry — the same mechanism a manual Publish uses
--    (sql/audit_batching.sql §5).
--
-- Run in the Supabase SQL Editor. Idempotent (create ... if not exists /
-- create or replace), and re-runnable against a fully set-up database — but
-- NOT ON ITS OWN once it has been. It is the FIRST file of a four-file chain,
-- each of which redefines mail_reports_pending():
--
--    1. sql/mail_sync.sql            (this file)
--    2. sql/mail_rescan_pending.sql
--    3. sql/players_registry.sql
--    4. sql/mail_reason_accuracy.sql  ← must be LAST
--
-- Stopping halfway leaves mail_reports_pending() — everything the admin's Mail
-- tab reads — defined by an earlier file than the one that should own it. Run
-- all four, in that order, every time you run any of them. See the note above
-- mail_orphan_reason for what specifically breaks if you do not.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.report_tokens (
    id           bigint generated always as identity primary key,
    label        text not null,               -- human label; NOT the person's identity
    token_hash   text not null unique,        -- sha256 hex of the secret, never the secret
    revoked_at   timestamptz,
    last_used_at timestamptz,
    use_count    int not null default 0,
    created_at   timestamptz not null default now()
);

create table if not exists public.match_reports (
    id            bigint generated always as identity primary key,

    -- Parsed match data. No sender address, no headers, no raw MIME — the
    -- automation never transmits them.
    payload       jsonb  not null,
    content_hash  text   not null unique,     -- replay / double-run guard

    token_id      bigint references public.report_tokens(id),

    status        text not null default 'pending_assign'
        check (status in ('pending_assign','applied','discarded')),

    -- Populated by the resolver: the leagues that matched. [] = none found.
    candidates    jsonb  not null default '[]'::jsonb,

    -- Populated on apply.
    league_id     text   references public.leagues(id) on delete set null,
    match_id      bigint references public.matches(id) on delete set null,
    auto_applied  boolean,                    -- true = 1 candidate, no admin touch

    received_at   timestamptz not null default now(),
    resolved_at   timestamptz,
    resolved_by   text,
    discard_reason text
);

create index if not exists idx_match_reports_status on public.match_reports (status);
create index if not exists idx_match_reports_league on public.match_reports (league_id);
create index if not exists idx_match_reports_received on public.match_reports (received_at desc);

-- ----------------------------------------------------------------------------
-- Source code → league type
-- ----------------------------------------------------------------------------
-- The subject line ends "… on Heroes in 325". That trailing number is NOT a
-- match id (see tools/mail-sync/Code.gs, SUBJECT_RE) — it repeats across
-- unrelated matches. It identifies the COMPETITION on the source, and each
-- competition is one kind of league: as observed, 325 = doubling, 326 =
-- regular, 331 = ubc. The mailbox sends it as payload.source_ref.
--
-- That makes it a tie-breaker the candidate scan never had. A pair can hold an
-- open fixture in two running leagues at once — the same two people in this
-- month's DOUBLING and this month's REGULAR — and the scan, which knows only
-- names and length, cannot tell them apart. The code can.
--
-- How the rule is applied, and why it is no stronger than this:
--   * It narrows AUTO-APPLY only. A report auto-applies when exactly one
--     candidate's league type agrees with its code. A candidate of the wrong
--     type is still a candidate: F8 lists it (marked) and an admin may apply
--     it by hand. A mapping can be wrong; when it is, the cost must be a report
--     waiting for a human, never a result written into the wrong league.
--   * No code, or a code with no row here, changes nothing — the scan behaves
--     exactly as it did before this table existed.
--   * It does not end conflicts. Two running leagues of the SAME type holding
--     the same open pair (two doubling leagues overlapping) still go to F8.
--
-- This is DATA, not code: a new competition on the source is one INSERT, and
-- public.mail_source_ref_evidence() (below) checks every row against what
-- admins and the scan have actually done with reports carrying that code.
-- The seed is inserted with ON CONFLICT DO NOTHING, so re-running this file
-- never overwrites a mapping someone has since corrected.
create table if not exists public.mail_source_types (
    source_ref   text primary key,
    league_type  text not null check (league_type in ('doubling', 'regular', 'ubc')),
    note         text,
    created_at   timestamptz not null default now()
);

insert into public.mail_source_types (source_ref, league_type, note) values
    ('325', 'doubling', 'initial mapping, 2026-10-02'),
    ('326', 'regular',  'initial mapping, 2026-10-02'),
    ('331', 'ubc',      'initial mapping, 2026-10-02')
on conflict (source_ref) do nothing;

alter table public.report_tokens enable row level security;
alter table public.match_reports enable row level security;
alter table public.mail_source_types enable row level security;

-- No policies at all: anon and authenticated see nothing directly. Reads for
-- the admin UI go through mail_reports_admin() below; writes go through the
-- security-definer functions.

-- ============================================================================
-- Candidate scan — the league-inference rule
-- ============================================================================
-- A league is a candidate when ALL hold:
--   1. it is Running
--   2. its match_length equals the reported length (a NULL length on the
--      league is treated as "no constraint", matching how the app reads it)
--   3. it has a fixture for this exact pair (either orientation) that is
--      NOT yet played
--   4. that pair is not covered by a manual override
--
-- Returns the fixture row too, so apply never has to re-derive it — including
-- `swapped`, which says the report's A/B are reversed relative to the fixture.
-- Getting that wrong is the override-orientation bug this project already paid
-- for once; it is resolved here, once, at the source.
--
-- `type_ok` is the source-code verdict (see public.mail_source_types): true or
-- false when the report's code is mapped, NULL when there is no code or no
-- mapping. It does NOT filter — a wrong-type league is still returned, because
-- an admin may still apply it by hand. Callers that decide AUTO-apply treat
-- `type_ok is not false` as eligible.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- Is this pair of scores possible at all?
-- ----------------------------------------------------------------------------
-- A match ends the moment somebody reaches the match length. So exactly one
-- side is ON the length and the other is BELOW it — there is no third shape.
--
-- Measured, not assumed: across all 3,825 played matches in this database the
-- winner's score equals the match length every single time (3,476 sevens in
-- 7-point leagues, 349 fives in 5-point leagues). Not one overshoot, not one
-- unfinished match. The rule below is that observation written down.
--
-- It exists because the source has twice put something that is not a score in
-- the winner's slot: 1004 (its marker for "the opponent resigned"), and a 13 in
-- a 7-point match whose meaning is still unknown. The mailbox script resolves
-- the first; this catches the second, and whatever comes next, without needing
-- to know what it means. A report that fails lands in F8 for an admin instead
-- of writing an impossible result into a league.
create or replace function public.mail_score_ok(
    p_score_a int,
    p_score_b int,
    p_length  int
)
returns boolean
language sql
immutable
as $$
    select p_score_a is not null and p_score_b is not null and p_length is not null
       and p_score_a >= 0 and p_score_b >= 0
       and greatest(p_score_a, p_score_b) = p_length      -- someone won, exactly
       and least(p_score_a, p_score_b)    < p_length;     -- and only one of them
$$;

-- The signature gained a parameter and the result a column, so the old
-- three-argument version goes first. Left in place it would sit beside the new
-- one, and every three-argument call would then match both overloads (the new
-- one through its default) and fail as "not unique".
drop function if exists public.mail_candidate_leagues(text, text, int);

create or replace function public.mail_candidate_leagues(
    p_player_a   text,
    p_player_b   text,
    p_length     int,
    p_source_ref text default null
)
returns table (league_id text, match_id bigint, round int, swapped boolean, type_ok boolean)
language sql
stable
security definer
set search_path = public
as $$
    select l.id,
           m.id,
           m.round,
           (m.player_a = p_player_b) as swapped,
           case when st.league_type is null then null
                else l.league_type = st.league_type
           end as type_ok
    from public.leagues l
    join public.matches m
      on m.league_id = l.id
     and m.played = false
     and (   (m.player_a = p_player_a and m.player_b = p_player_b)
          or (m.player_a = p_player_b and m.player_b = p_player_a))
    left join public.mail_source_types st
      on st.source_ref = p_source_ref
    where l.running = true
      and l.archived = false
      and (l.match_length is null or p_length is null or l.match_length = p_length)
      and not exists (
            select 1 from public.manual_overrides o
             where o.league_id = l.id
               and (   (o.player_a = p_player_a and o.player_b = p_player_b)
                    or (o.player_a = p_player_b and o.player_b = p_player_a))
          );
$$;

-- ============================================================================
-- Apply — write the result into matches + match_history, as one audit batch
-- ============================================================================
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
    -- fixture-oriented values
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

    -- The same gate the resolver applies, repeated at the point of writing.
    --
    -- Not redundant: the resolver decides whether to auto-apply, and this is
    -- the only path an ADMIN takes when assigning a report by hand from F8. A
    -- held report is visible in that list with its picker, so without this
    -- check the one control built for reviewing a bad report is also the one
    -- that commits it.
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

    -- Re-run the scan for THIS league. Never trust the stored candidate list:
    -- an admin may sit on the F8 screen for an hour while a CSV import or an
    -- override lands underneath, and applying a stale candidate would silently
    -- overwrite a played result.
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

    -- One Historical Changes entry for the whole apply. topic/specific/icon are
    -- deliberately IDENTICAL to what scripts/sync-source.js writes for a CSV
    -- sync — the spec is that a mail-applied match is documented as a CSV one,
    -- so this is not the place to invent a private vocabulary. (An earlier draft
    -- used a bespoke '📧' here; it also rendered as a tofu box in the history
    -- list, which is how the divergence got noticed.) Only `detail`, free text,
    -- names the specific match.
    insert into public.audit_batches (changed_by, topic, subject, specific, icon, detail)
    values (who, 'league', p_league_id, 'Match data updated', '📊',
            format('%s vs %s (%s-%s) — e-mail report',
                   f_name_a, f_name_b, f_score_a, f_score_b))
    returning id into batch;
    perform set_config('app.batch_id', batch::text, true);

    -- Close the report BEFORE touching matches — the order is the fix, not style.
    -- The UPDATE below fires trg_matches_mail_rescan (sql/mail_rescan_pending.sql),
    -- which sweeps every report still 'pending_assign'. With this update placed
    -- after the write, the sweep found THIS report still pending, saw the league
    -- just written as played, found the one league left — and auto-applied the
    -- same result to it. Every admin pick between exactly two leagues was written
    -- into both (repair: sql/repair_mail_double_apply_2026-10-02.sql).
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

    -- source='csv' on purpose — see header note.
    --
    -- has_exact_time is stated on BOTH halves, never left to the column default.
    -- The default covers the insert; the DO UPDATE half would otherwise leave a
    -- pre-existing `false` in place while replacing updated_at with a real
    -- played_at, and the row would then render as a timezone-less day on a date
    -- it no longer holds. A mail report always carries a real moment.
    -- See sql/match_time_precision.sql and js/utils/matchTime.js.
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

-- ============================================================================
-- Resolver — decide auto-apply vs. hand to the admin
-- ============================================================================
create or replace function public.mail_resolve_report(p_report_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r     public.match_reports;
    cands jsonb;
    n     int;
    one   text;
begin
    select * into r from public.match_reports where id = p_report_id;
    if r.id is null then
        return jsonb_build_object('ok', false, 'error', 'report_not_found');
    end if;

    -- Before looking for a league at all: are these scores possible?
    --
    -- Placed here, ahead of the candidate scan, because the scan's job is to
    -- find a fixture and it would happily find a perfectly good one — and then
    -- a single candidate means AUTO-APPLY, writing 1004-0 into a league with no
    -- one ever seeing it. An impossible score has no correct league; it has an
    -- admin.
    if not public.mail_score_ok((r.payload->>'score_a')::int,
                                (r.payload->>'score_b')::int,
                                (r.payload->>'match_length')::int) then
        update public.match_reports
           set candidates = '[]'::jsonb, status = 'pending_assign', auto_applied = false
         where id = p_report_id;
        return jsonb_build_object('ok', true, 'auto', false, 'candidates', 0,
                                  'held', 'implausible_score');
    end if;

    -- Every candidate is stored, wrong-type ones included (F8 offers them to the
    -- admin), but only the ELIGIBLE ones are counted towards auto-apply — those
    -- whose league type agrees with the source code, or all of them when the
    -- code is absent or unmapped (type_ok is null). See public.mail_source_types.
    select coalesce(jsonb_agg(jsonb_build_object(
               'league_id', c.league_id, 'round', c.round, 'type_ok', c.type_ok)
               order by c.type_ok desc nulls last, c.league_id), '[]'::jsonb),
           count(*) filter (where c.type_ok is not false)
      into cands, n
      from public.mail_candidate_leagues(r.payload->>'player_a', r.payload->>'player_b',
                                         (r.payload->>'match_length')::int,
                                         r.payload->>'source_ref') c;

    update public.match_reports set candidates = cands where id = p_report_id;

    if n = 1 then
        select c.league_id into one
          from public.mail_candidate_leagues(r.payload->>'player_a', r.payload->>'player_b',
                                             (r.payload->>'match_length')::int,
                                             r.payload->>'source_ref') c
         where c.type_ok is not false;
        update public.match_reports set auto_applied = true where id = p_report_id;
        return public.mail_apply_report(p_report_id, one, 'mail-automation')
               || jsonb_build_object('auto', true);
    end if;

    -- 0 eligible (unknown players / already played / override-covered / only a
    -- wrong-type league) and >1 eligible all go to the admin. The stored
    -- candidate list, with its type_ok flags, tells the admin which it is.
    return jsonb_build_object('ok', true, 'auto', false,
                              'candidates', jsonb_array_length(cands), 'eligible', n);
end;
$$;

-- ============================================================================
-- The ONLY externally-callable entry point
-- ============================================================================
create or replace function public.submit_match_report(
    p_token   text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_token_id bigint;
    v_hash     text;
    v_id       bigint;
    k          text;
begin
    select id into v_token_id
      from public.report_tokens
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       and revoked_at is null;

    if v_token_id is null then
        perform pg_sleep(0.5);                       -- blunt the guessing rate
        return jsonb_build_object('ok', false, 'error', 'unauthorized');
    end if;

    -- Shape gate. The automation is supposed to send only match reports; this
    -- is the second line of that same rule, in case the parser is ever loosened.
    foreach k in array array['player_a','player_b','score_a','score_b','match_length'] loop
        if p_payload->>k is null then
            return jsonb_build_object('ok', false, 'error', 'invalid_payload', 'missing', k);
        end if;
    end loop;

    if (p_payload->>'player_a') = (p_payload->>'player_b') then
        return jsonb_build_object('ok', false, 'error', 'invalid_payload', 'missing', 'distinct players');
    end if;

    -- Identity for dedupe: an `external_id` when a sender supplies one,
    -- otherwise the full content. Two runs over the same mailbox therefore
    -- cannot double-count a match.
    --
    -- The "in 325" of the subject line is NOT an external_id and must never be
    -- sent as one: it is the source's COMPETITION code, shared by every match in
    -- that competition (it arrives as `source_ref` — see public.mail_source_types).
    -- Keyed on it, every match after the first would be swallowed as a duplicate.
    v_hash := encode(extensions.digest(
        coalesce(p_payload->>'external_id', p_payload::text), 'sha256'), 'hex');

    insert into public.match_reports (payload, content_hash, token_id)
    values (p_payload, v_hash, v_token_id)
    on conflict (content_hash) do nothing
    returning id into v_id;

    update public.report_tokens
       set last_used_at = now(), use_count = use_count + 1
     where id = v_token_id;

    if v_id is null then
        return jsonb_build_object('ok', true, 'status', 'duplicate');
    end if;

    return public.mail_resolve_report(v_id) || jsonb_build_object('status', 'received', 'id', v_id);
end;
$$;

-- ============================================================================
-- Admin-side reads and actions (F8 / F9)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Why did a report match NO league?
-- ----------------------------------------------------------------------------
-- mail_candidate_leagues answers "which leagues qualify" and, when the answer
-- is none, says nothing about WHY. Nine very different situations collapse into
-- that one empty result — an unknown player name, a result already recorded, an
-- override, a match length no running league uses — and they need different
-- actions from the admin. Without this, every empty row costs a manual
-- investigation to tell them apart.
--
-- So: re-walk the same conditions one at a time, in the order an admin would,
-- and report the FIRST one that fails. Recomputed on read rather than stored,
-- because the answer changes when the roster does — a stored reason would go
-- quietly stale the moment a player is renamed.
--
-- ── House style for these strings ─────────────────────────────────────────
-- They are read inside a TABLE CELL, next to the row they describe and next to
-- a Discard button. That context does three things to the wording:
--
--   * No advice. "Delete that result first", "Check the spelling against the
--     roster" — the cell says what is true; what to do about it is the admin's
--     call and the buttons are right there.
--   * Nothing the row already shows. The league, and both player names, are
--     columns of their own. Repeating them in prose doubles the reading with
--     no information added.
--   * Only the facts that are NOT on screen: the score of the clashing result,
--     the two match lengths, and which of the two names is the unknown one.
--
-- Two to four words wherever the case carries no such fact. The long-form
-- versions these replaced ran to two full sentences and pushed the cell past
-- the width of every other column in the table.
--
-- ── WHY THE DROP BELOW EXISTS: THIS FILE MUST SURVIVE A RE-RUN ─────────────
-- sql/mail_reason_accuracy.sql supersedes this function with a five-argument
-- version whose last two arguments DEFAULT TO NULL. Once that has been applied,
-- `create or replace` here does not replace anything — it adds a second
-- overload beside it, and a three-argument call then matches both. The very
-- next statement in this file, mail_reports_pending(), makes exactly such a
-- call, so the file dies on itself with
--   ERROR: function public.mail_orphan_reason(text, text, integer) is not unique
-- and every statement after that point — including all of the grants and
-- revokes at the end — is silently skipped.
--
-- That made this file runnable only against a database no one had finished
-- setting up: a cloud already carrying the full chain could not take a re-run
-- of it at all, which is the one thing a `create or replace` file exists for.
-- Dropping the superseding overload first leaves exactly one candidate, so the
-- file completes. The documented order then restores the newer version: run
-- sql/mail_reason_accuracy.sql LAST, and its own matching drop removes this
-- three-argument one again. Either file, from any starting state, ends with one
-- function.
drop function if exists public.mail_orphan_reason(text, text, int, int, int);

create or replace function public.mail_orphan_reason(
    p_a   text,
    p_b   text,
    p_len int
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_running   int;
    v_a         text[];
    v_b         text[];
    v_both      text[];
    v_played    record;
    v_ovr       record;
    v_len       record;
begin
    select count(*) into v_running from public.leagues where running and not archived;
    if v_running = 0 then
        return 'No running league';
    end if;

    -- Which running leagues does each player appear in at all?
    select array_agg(distinct l.id) into v_a
      from public.leagues l
      join public.matches m on m.league_id = l.id
     where l.running and not l.archived and (m.player_a = p_a or m.player_b = p_a);

    select array_agg(distinct l.id) into v_b
      from public.leagues l
      join public.matches m on m.league_id = l.id
     where l.running and not l.archived and (m.player_a = p_b or m.player_b = p_b);

    -- Which name is the unrecognised one is the whole point of these three, so
    -- it is named. Both unknown needs no name: they are the only two on the row.
    if v_a is null and v_b is null then
        return 'Both names unknown';
    elsif v_a is null then
        return format('Unknown player: %s', p_a);
    elsif v_b is null then
        return format('Unknown player: %s', p_b);
    end if;

    select array(select unnest(v_a) intersect select unnest(v_b)) into v_both;
    if v_both = '{}' then
        return 'Different leagues';
    end if;

    select l.id as lid, m.player_a, m.player_b, m.score_a, m.score_b
      into v_played
      from public.matches m
      join public.leagues l on l.id = m.league_id
     where l.id = any(v_both) and m.played
       and ((m.player_a = p_a and m.player_b = p_b) or (m.player_a = p_b and m.player_b = p_a))
     limit 1;
    if found then
        -- The score is ORIENTED to the report's own player order. Dropping the
        -- names from this string is only safe because of that: the stored match
        -- may hold the same pair the other way round, and "Already played
        -- (7-1)" printed in storage order would name the wrong winner while
        -- reading perfectly next to the row's own two columns.
        return format('Already played (%s-%s)',
                      case when v_played.player_a = p_a then v_played.score_a else v_played.score_b end,
                      case when v_played.player_a = p_a then v_played.score_b else v_played.score_a end);
    end if;

    select o.league_id into v_ovr
      from public.manual_overrides o
     where o.league_id = any(v_both)
       and ((o.player_a = p_a and o.player_b = p_b) or (o.player_a = p_b and o.player_b = p_a))
     limit 1;
    if found then
        return 'Manual override exists';
    end if;

    select l.id as lid, l.match_length
      into v_len
      from public.matches m
      join public.leagues l on l.id = m.league_id
     where l.id = any(v_both) and not m.played
       and ((m.player_a = p_a and m.player_b = p_b) or (m.player_a = p_b and m.player_b = p_a))
     limit 1;
    if found then
        -- League length first, then the report's — the same order as the words
        -- "expected" and "got", which is how this gets read.
        return format('Length mismatch (%s vs %s)',
                      coalesce(v_len.match_length::text, '?'),
                      coalesce(p_len::text, '?'));
    end if;

    return 'Not scheduled to meet';
end;
$$;

-- F8 — reports still waiting for a league, each carrying the reason it is here.
-- The signature gained a column, and Postgres will not `create or replace` a
-- function into a different return type — so drop first. Safe on re-run.
drop function if exists public.mail_reports_pending();
-- F8 — reports still waiting for a league, each carrying the reason it is here.
-- Returns only the columns F8 renders; `reason` is null for the ambiguous rows,
-- which have a candidate list instead and need no explanation.
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
    select r.id, r.payload, r.candidates, r.received_at,
           case
                -- An impossible score is reported as itself, ahead of any
                -- league reasoning. mail_orphan_reason would otherwise answer
                -- the wrong question — "they are not scheduled to meet" is true
                -- but useless when the actual problem is a score of 1004.
                when not public.mail_score_ok((r.payload->>'score_a')::int,
                                              (r.payload->>'score_b')::int,
                                              (r.payload->>'match_length')::int)
                then format('Impossible score (%s-%s in a %spt match)',
                            r.payload->>'score_a', r.payload->>'score_b',
                            coalesce(r.payload->>'match_length', '?'))
                when jsonb_array_length(r.candidates) = 0
                then public.mail_orphan_reason(r.payload->>'player_a',
                                               r.payload->>'player_b',
                                               (r.payload->>'match_length')::int)
           end
      from public.match_reports r
     where r.status = 'pending_assign'
     order by r.received_at desc;
$$;

-- F9 — every mail-sourced match, newest first.
create or replace function public.mail_reports_log(p_limit int default 200)
returns setof public.match_reports
language sql
stable
security definer
set search_path = public
as $$
    select * from public.match_reports
     order by received_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- Health strip: when did the last report arrive, and how do they split.
create or replace function public.mail_reports_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'last_received',  max(received_at),
        'auto_applied',   count(*) filter (where status = 'applied' and auto_applied),
        'admin_applied',  count(*) filter (where status = 'applied' and not auto_applied),
        'pending',        count(*) filter (where status = 'pending_assign'),
        'discarded',      count(*) filter (where status = 'discarded'))
    from public.match_reports;
$$;

-- ----------------------------------------------------------------------------
-- Is the source-code mapping true? — checked against what actually happened
-- ----------------------------------------------------------------------------
-- public.mail_source_types is an assumption written down. This reads every
-- report that carried a code and asks which league TYPE it ended up in, then
-- compares that with the mapping. One row per code, mapped or merely seen.
--
-- The evidence is an applied report's league. Admin picks are independent of
-- the mapping, and so were all auto-applies made before the mapping existed;
-- an auto-apply made since can have been DECIDED by the mapping, so it agrees
-- by construction. `admin_by_type` is therefore listed on its own: it is the
-- column that can contradict a mapping, and the one to read first.
--
-- An unmapped code that keeps landing in one type is the signal to add a row;
-- `verdict` names the type to add it with. It never adds the row itself — an
-- inference that writes the rule it was inferred from cannot be checked.
create or replace function public.mail_source_ref_evidence()
returns table (
    source_ref     text,
    mapped_type    text,
    applied_by_type jsonb,
    admin_by_type  jsonb,
    reports        bigint,
    pending        bigint,
    first_seen     timestamptz,
    last_seen      timestamptz,
    verdict        text
)
language sql
stable
security definer
set search_path = public
as $$
    with seen as (
        select r.payload->>'source_ref'                          as ref,
               r.status, r.received_at, l.league_type,
               r.status = 'applied' and not coalesce(r.auto_applied, false) as by_admin
          from public.match_reports r
          left join public.leagues l on l.id = r.league_id
         where r.payload->>'source_ref' is not null
    ),
    per_type as (
        select ref,
               jsonb_object_agg(league_type, n)                              as applied,
               jsonb_object_agg(league_type, n_admin) filter (where n_admin > 0) as admin,
               count(*)                                                      as n_types
          from (select ref, league_type,
                       count(*)                         as n,
                       count(*) filter (where by_admin) as n_admin
                  from seen
                 where status = 'applied' and league_type is not null
                 group by ref, league_type) t
         group by ref
    ),
    totals as (
        select ref, count(*) as reports,
               count(*) filter (where status = 'pending_assign') as pending,
               min(received_at) as first_seen, max(received_at) as last_seen
          from seen group by ref
    )
    select coalesce(t.ref, st.source_ref),
           st.league_type,
           coalesce(p.applied, '{}'::jsonb),
           coalesce(p.admin,   '{}'::jsonb),
           coalesce(t.reports, 0),
           coalesce(t.pending, 0),
           t.first_seen,
           t.last_seen,
           case
               when st.league_type is null and p.ref is null
                   then 'unmapped — no applied report yet'
               when st.league_type is null and p.n_types = 1
                   then 'unmapped — every applied report is ' ||
                        (select k from jsonb_object_keys(p.applied) k) || '; add it'
               when st.league_type is null
                   then 'unmapped — applied reports split across types'
               when p.ref is null
                   then 'mapped — no applied report yet'
               when p.n_types = 1 and p.applied ? st.league_type
                   then 'confirmed'
               else 'CONTRADICTED — applied reports landed in other types'
           end
      from totals t
      left join per_type p on p.ref = t.ref
      full join public.mail_source_types st on st.source_ref = t.ref
     order by 1;
$$;

create or replace function public.mail_discard_report(p_report_id bigint, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.match_reports
       set status = 'discarded', discard_reason = p_reason,
           resolved_at = now(), resolved_by = coalesce(auth.email(), 'admin')
     where id = p_report_id and status = 'pending_assign';
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_pending');
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================================
-- Grants — the whole security model in six lines
-- ============================================================================
revoke all on function public.submit_match_report(text, jsonb)            from public;
revoke all on function public.mail_apply_report(bigint, text, text)       from public;
revoke all on function public.mail_resolve_report(bigint)                 from public;
revoke all on function public.mail_candidate_leagues(text, text, int, text) from public;
revoke all on function public.mail_source_ref_evidence()                  from public;
revoke all on function public.mail_reports_pending()                      from public;
revoke all on function public.mail_orphan_reason(text, text, int)         from public;
revoke all on function public.mail_reports_log(int)                       from public;
revoke all on function public.mail_reports_health()                       from public;
revoke all on function public.mail_discard_report(bigint, text)           from public;
-- mail_score_ok is a pure predicate over three integers: it reads nothing,
-- writes nothing, and reveals nothing. It is left executable so the callers
-- above (all security definer) need no further grant, and so the rule can be
-- checked from a query without reproducing it by hand.

-- anon gets exactly one verb, and it cannot read anything back.
grant execute on function public.submit_match_report(text, jsonb) to anon;

grant execute on function public.mail_apply_report(bigint, text, text)   to authenticated;
grant execute on function public.mail_candidate_leagues(text, text, int, text) to authenticated;
grant execute on function public.mail_source_ref_evidence()              to authenticated;
grant execute on function public.mail_reports_pending()                  to authenticated;
grant execute on function public.mail_orphan_reason(text, text, int)     to authenticated;
grant execute on function public.mail_reports_log(int)                   to authenticated;
grant execute on function public.mail_reports_health()                   to authenticated;
grant execute on function public.mail_discard_report(bigint, text)       to authenticated;

-- ============================================================================
-- Issuing a token (run manually, once per reporting mailbox)
-- ============================================================================
-- 1. Generate a secret locally and keep it OUT of this file and out of git:
--       node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- 2. Register only its hash:
--
--   insert into public.report_tokens (label, token_hash)
--   values ('mailbox automation #1',
--           encode(extensions.digest('<paste-the-secret-here>', 'sha256'), 'hex'));
--
-- 3. Paste the secret into the automation's Script Properties. Nowhere else.
-- To revoke:  update public.report_tokens set revoked_at = now() where label = '…';
-- ============================================================================
