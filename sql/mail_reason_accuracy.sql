-- ============================================================================
-- mail_reason_accuracy.sql — the "why is this report unassigned" chain reports
-- what it MEASURED, in the order an admin reads it.
--
-- RUN LAST, after sql/mail_sync.sql, sql/mail_rescan_pending.sql and
-- sql/players_registry.sql. It redefines mail_reports_pending() once more (so
-- it must follow mail_rescan_pending.sql) and reads public.players_registry
-- (so it must follow players_registry.sql).
--
-- ── THE BUG ────────────────────────────────────────────────────────────────
-- The chain re-walks the candidate scan's conditions one at a time and reports
-- the first that fails. Two of its steps did not actually check anything:
--
--   "Length mismatch (5 vs 5)" — the step asks "is there an open fixture?" and,
--     if so, announces a length mismatch and prints two numbers WITHOUT ever
--     comparing them. The reasoning behind it was sound but load-bearing: the
--     scan rejects an open fixture only over length, so an open fixture must
--     mean a length problem. That holds only while the scan's verdict and this
--     explanation describe the same instant — and they did not, because the
--     verdict was frozen at arrival and the explanation is computed on read.
--     Report 295's league did not exist when it arrived; by the time anyone
--     read the row the fixture was there, matching at 5 points, and the cell
--     confidently blamed a mismatch of 5 against 5.
--     (sql/mail_rescan_pending.sql closed the timing half of that. This closes
--     the half where the message asserts what it never tested.)
--
--   "Not scheduled to meet" — a claim about what the schedule INTENDED. All the
--     step knows is that the running leagues hold no fixture for the pair.
--     Whether they were meant to meet is a question about the league's format,
--     which nothing in the database records — so the cell must not answer it.
--     That sentence is what made an incomplete schedule read as a deliberate
--     one, and cost a month before anyone doubted it.
--
-- ── THE RULE THIS RESTORES ─────────────────────────────────────────────────
-- Every string here states something read out of the fixture lists of the
-- running leagues. Never something inferred about what those lists ought to
-- contain.
--
-- ── ORDER ──────────────────────────────────────────────────────────────────
-- Names, then the score, then where it could land — "is this mail coherent at
-- all" before "does it have somewhere to go". The impossible-score step moves
-- BELOW the name steps (it used to be first): when a report is wrong in both
-- ways, the name is the more useful thing to be told.
--
-- This is the DISPLAY order only. mail_resolve_report still tests the score
-- before it scans for candidates, and must keep doing so — there it is not a
-- message but a gate, the one thing standing between a score of 1004 and an
-- automatic apply.
-- ============================================================================


-- ── mail_orphan_reason — now takes the scores, so the whole chain is here ──
-- The scores arrive as arguments rather than the step living in the caller,
-- because a chain split across two files is a chain whose order is invisible.
-- Signature changes, so the old one goes first — Postgres will not replace a
-- function with different parameters.
drop function if exists public.mail_orphan_reason(text, text, int);

create or replace function public.mail_orphan_reason(
    p_a       text,
    p_b       text,
    p_len     int,
    p_score_a int default null,
    p_score_b int default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_a_known   boolean;
    v_b_known   boolean;
    v_a_running boolean;
    v_b_running boolean;
    v_a         text[];
    v_b         text[];
    v_both      text[];
    v_played    record;
    v_ovr       record;
    v_lens      int[];
begin
    -- "Does this name exist" is asked of public.players_registry
    -- (sql/players_registry.sql), the one definition of who is a player — the
    -- same one the site's Players tab shows. It used to be asked of the RUNNING
    -- leagues alone, which conflated two different facts and produced two wrong
    -- answers: a player of five seasons who happened to be between leagues was
    -- reported as an unrecognised name, and with every league stopped (between
    -- seasons) EVERY name read as unknown.
    --
    -- `in_running_league_any` ignores `hidden`, matching mail_candidate_leagues,
    -- which filters on running/archived only. The two must agree about which
    -- leagues count or this chain is back to explaining a decision it did not
    -- make.
    select true, in_running_league_any into v_a_known, v_a_running
      from public.players_registry where id = p_a;
    select true, in_running_league_any into v_b_known, v_b_running
      from public.players_registry where id = p_b;

    -- Which name is the unrecognised one is the whole point, so it is named.
    -- Both unknown needs no name: they are the only two on the row.
    if v_a_known is null and v_b_known is null then
        return 'Both names unknown';
    elsif v_a_known is null then
        return format('Unknown player: %s', p_a);
    elsif v_b_known is null then
        return format('Unknown player: %s', p_b);
    end if;

    -- Known, but with nowhere to play right now. A separate fact from an
    -- unrecognised name and a separate action for the admin — nothing is wrong
    -- with the report, and it will apply itself the moment their league starts.
    -- This is also what "no league is running at all" now reads as, which is
    -- more use than a message about the system: it names the people involved.
    if not v_a_running and not v_b_running then
        return 'Neither is in a running league';
    elsif not v_a_running then
        return format('Not in a running league: %s', p_a);
    elsif not v_b_running then
        return format('Not in a running league: %s', p_b);
    end if;

    -- Which running leagues does each player appear in? Only needed from here
    -- on, now that both are known to be in one.
    select array_agg(distinct l.id) into v_a
      from public.leagues l
      join public.matches m on m.league_id = l.id
     where l.running and not l.archived and (m.player_a = p_a or m.player_b = p_a);

    select array_agg(distinct l.id) into v_b
      from public.leagues l
      join public.matches m on m.league_id = l.id
     where l.running and not l.archived and (m.player_a = p_b or m.player_b = p_b);

    -- The scores, once the names are known to be real. Below the name steps by
    -- choice: a report that is wrong in both ways is more usefully described by
    -- the name than by the number.
    if not public.mail_score_ok(p_score_a, p_score_b, p_len) then
        return format('Impossible score (%s-%s in a %spt match)',
                      coalesce(p_score_a::text, '?'), coalesce(p_score_b::text, '?'),
                      coalesce(p_len::text, '?'));
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

    -- The lengths of the open fixtures that ACTUALLY DIFFER from the report's.
    -- Two corrections in one query:
    --   * the comparison is in the WHERE clause, so a mismatch is measured
    --     rather than assumed. The old step selected any open fixture at all
    --     and announced a mismatch over it, which is how "5 vs 5" came to be
    --     printed as a diagnosis.
    --   * every distinct length is collected, not `limit 1`. With several
    --     leagues holding the pair the old step named an arbitrary one, so the
    --     cell could blame a league that had nothing to do with the problem.
    -- A null on either side is NOT a mismatch: mail_candidate_leagues treats an
    -- unset length as matching anything, and this must agree with it.
    select array_agg(distinct l.match_length) into v_lens
      from public.matches m
      join public.leagues l on l.id = m.league_id
     where l.id = any(v_both) and not m.played
       and ((m.player_a = p_a and m.player_b = p_b) or (m.player_a = p_b and m.player_b = p_a))
       and l.match_length is not null and p_len is not null
       and l.match_length <> p_len;

    if v_lens is not null then
        return format('Length mismatch (%s vs %s)',
                      array_to_string(v_lens, ' or '), p_len::text);
    end if;

    -- The end of the chain. Reaching here means something specific and worth
    -- saying: a running league holds BOTH players (v_both is non-empty), they
    -- have not played, no override covers them — the league's fixture list
    -- simply has no row pairing them.
    --
    -- "Not scheduled to play" is a fact here, not a guess: the fixture list IS
    -- the schedule, and it does not contain this pair. What the old wording
    -- ("Not scheduled to meet", full stop) got wrong was reading as a claim
    -- about INTENT — as though the draw had deliberately kept them apart — which
    -- is what let September 2026's truncated import pass for a design decision
    -- for a month. The second half removes that reading: it states that a
    -- suitable league does exist, so an empty fixture is a thing to look at
    -- rather than a closed answer.
    --
    -- Whether they SHOULD have been paired depends on the league's format, which
    -- the database does not record — so the cell still does not answer it. It
    -- only makes clear that the question is open.
    return 'No fixture in their league';
end;
$$;


-- ── mail_reports_pending — one chain, and candidates that cannot lie ───────
-- Same shape as before. Two changes:
--   * `reason` is now the whole chain in one call; the score step moved inside
--     mail_orphan_reason, where the rest of the order lives.
--   * an impossible score forces `candidates` to empty. Since these are
--     computed LIVE (sql/mail_rescan_pending.sql), a report with a nonsense
--     score sitting on a real open fixture would otherwise be handed a league
--     picker and an Apply button — a control that can only ever be refused by
--     mail_apply_report's own score gate.
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
           case when public.mail_score_ok((r.payload->>'score_a')::int,
                                          (r.payload->>'score_b')::int,
                                          (r.payload->>'match_length')::int)
                then coalesce(live.cands, '[]'::jsonb)
                else '[]'::jsonb
           end as candidates,
           r.received_at,
           case when public.mail_score_ok((r.payload->>'score_a')::int,
                                          (r.payload->>'score_b')::int,
                                          (r.payload->>'match_length')::int)
                     and coalesce(jsonb_array_length(live.cands), 0) > 0
                then null
                else public.mail_orphan_reason(r.payload->>'player_a',
                                               r.payload->>'player_b',
                                               (r.payload->>'match_length')::int,
                                               (r.payload->>'score_a')::int,
                                               (r.payload->>'score_b')::int)
           end as reason
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


-- ── Grants ─────────────────────────────────────────────────────────────────
-- The old three-argument mail_orphan_reason is gone, and with it its grant.
revoke all on function public.mail_orphan_reason(text, text, int, int, int) from public;
revoke all on function public.mail_reports_pending()                        from public;
grant execute on function public.mail_orphan_reason(text, text, int, int, int) to authenticated;
grant execute on function public.mail_reports_pending()                        to authenticated;


-- ── The complete set of answers, in the order they are asked ───────────────
--   Both names unknown
--   Unknown player: <name>
--   Neither is in a running league
--   Not in a running league: <name>
--   Impossible score (1004-0 in a 7pt match)
--   Different leagues
--   Already played (7-1)
--   Manual override exists
--   Length mismatch (7 vs 5)          — one open fixture's league length
--   Length mismatch (7 or 9 vs 5)     — several, all of them listed
--   No fixture in their league
--                                     — a running league holds BOTH, unplayed,
--                                       un-overridden, and its fixture list has
--                                       no row pairing them
--
-- Verify (read-only):
--   select * from public.mail_reports_pending();
-- ============================================================================
