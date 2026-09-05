/**
 * matchHistoryReconcile.js — the ONE canonical match_history reconcile.
 *
 * `match_history` records, per pairing, the current result AND when that result
 * last changed (`updated_at` is DOMAIN data — it feeds the historical / as-of
 * views, B2's update points — NOT a row mtime). Reconciling means: given the
 * league's live state (matches + manual_overrides) and what history already
 * holds, decide which rows to upsert and which to delete, WITHOUT redating rows
 * that didn't actually change (a redate is a real, visible edit to the history,
 * and re-upserting a no-op also fires the audit trigger across the league).
 *
 * This module is PURE (no Supabase, no fs) so the two write paths share exactly
 * one implementation:
 *   - the admin publish  (js/admin/supabaseAdmin.js  → reconcileMatchHistory)
 *   - the sync job       (scripts/sync-source.js      → reconcileMatchHistoryInSupabase)
 * They used to be hand-copied twins that silently drifted apart in three places
 * (override date handling, not_played, changedKeys) — the source of a string of
 * history-corruption bugs. Keep the logic here; the callers only do the I/O.
 *
 * Inputs are raw Supabase rows (snake_case); the returned upsert rows are raw
 * Supabase rows ready to hand straight to `.upsert()`.
 */

function key(a, b) {
    return [a, b].sort().join('|');
}

// Postgres `numeric` round-trips through PostgREST as a string; override records
// are built from JS number literals. A strict === would read "0" !== 0 as a real
// change and mark every row dirty. Compare numerically, treating null/undefined
// as equal to each other only.
function numEq(x, y) {
    if (x === null || x === undefined) return y === null || y === undefined;
    if (y === null || y === undefined) return false;
    return Number(x) === Number(y);
}

function sameNumericFields(a, b) {
    return numEq(a.scoreA, b.scoreA) && numEq(a.scoreB, b.scoreB)
        && numEq(a.prA, b.prA) && numEq(a.prB, b.prB)
        && numEq(a.luckA, b.luckA) && numEq(a.luckB, b.luckB);
}

/**
 * @param {object}   args
 * @param {object[]} args.matchRows     raw `matches` rows (already filtered to played=true)
 * @param {object[]} args.overrideRows  raw `manual_overrides` rows
 * @param {object[]} args.historyRows   raw `match_history` rows
 * @param {string}   args.leagueId
 * @param {string}   args.now           ISO timestamp for genuinely-new/changed rows
 * @returns {{ skipped: boolean, reason?: string, staleIds: Array<number>, upsertRows: object[] }}
 */
export function computeMatchHistoryReconcile({ matchRows, overrideRows, historyRows, leagueId, now }) {
    const matches = matchRows || [];
    const overrideList = overrideRows || [];
    const history = historyRows || [];

    // Refuse to reconcile a non-empty history down to nothing from an empty match
    // set. A league with existing history but suddenly 0 played matches is almost
    // certainly a transient/upstream glitch, not a real reset — skip rather than
    // wipe every pairing's history (the failure mode that collapsed B2 once).
    if (matches.length === 0 && history.length > 0) {
        return {
            skipped: true,
            reason: `0 played matches but ${history.length} existing history row(s) — refusing to wipe`,
            staleIds: [],
            upsertRows: [],
        };
    }

    const csvMatches = matches.map((m) => ({
        playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
        prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b, round: m.round,
    }));
    const overrides = overrideList.map((o) => ({
        type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
        scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
        // The date the admin authored the override (domain data). Null on legacy
        // rows written before the column existed → fall back to `now`.
        editedAt: o.edited_at || null,
    }));
    const previous = history.map((h) => ({
        playerA: h.player_a, playerB: h.player_b, scoreA: h.score_a, scoreB: h.score_b,
        prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b, round: h.round,
        updatedAt: h.updated_at, source: h.source,
    }));
    const prevByKey = new Map(previous.map((m) => [key(m.playerA, m.playerB), m]));

    // Which pairings an override still speaks for. A stored `manual` row is only
    // protected while its override is LIVE — see the revert rule below.
    const liveOverrideKeys = new Set(overrides.map((o) => key(o.playerA, o.playerB)));

    // Pass 1 — the CSV/matches side. Keep the stored row (and its date) when the
    // numbers are unchanged; a manual row survives the CSV pass untouched for as
    // long as its override exists.
    //
    // REVERT: deleting an override has to undo it. The rule used to be "a manual
    // row always survives", which meant a cancelled override left its values in
    // match_history forever — and since history OUTRANKS the CSV in the read-side
    // merge, the cancelled result kept showing on the site. The admin saw the
    // override disappear from the editor and nothing at all change on the page.
    // So a manual row whose override is gone is treated as any other CSV row: the
    // pairing goes back to what the source says, which is exactly "the DB before
    // the manual change". A pairing the source no longer marks played simply
    // isn't in csvMatches, so it leaves history entirely via the stale-delete —
    // a technical result entered on a match nobody played, then cancelled, ends
    // up not played again, with no update point of its own.
    //
    // Its DATE is `now` whenever the values actually move, because the original
    // recording date was overwritten by the override and is not recoverable.
    // Unchanged values keep the stored date: nothing about the result changed, so
    // nothing should move in B5 or in the update-point list.
    const next = [];
    for (const m of csvMatches) {
        const k = key(m.playerA, m.playerB);
        const prev = prevByKey.get(k);
        const manualHeld = prev && prev.source === 'manual' && liveOverrideKeys.has(k);
        if (manualHeld) {
            next.push({ ...prev, round: m.round });          // pass 2 owns this pairing
        } else if (prev && sameNumericFields(prev, m)) {
            next.push({ ...prev, round: m.round, source: 'csv' });
        } else {
            next.push({
                playerA: m.playerA, playerB: m.playerB, scoreA: m.scoreA, scoreB: m.scoreB,
                prA: m.prA, prB: m.prB, luckA: m.luckA, luckB: m.luckB, round: m.round,
                updatedAt: now, source: 'csv',
            });
        }
    }

    // Pass 2 — manual overrides win over the CSV.
    for (const o of overrides) {
        const k = key(o.playerA, o.playerB);

        // not_played: the pairing did NOT happen. It must leave match_history
        // entirely — otherwise a stale CSV-sourced row survives here and the
        // read-side merge (mergeHistoryIntoMatches) resurrects the very match the
        // admin said to erase. Drop it from `next` so the stale-delete removes it.
        if (o.type === 'not_played') {
            const rmIdx = next.findIndex((x) => key(x.playerA, x.playerB) === k);
            if (rmIdx >= 0) next.splice(rmIdx, 1);
            continue;
        }

        let record;
        if (o.type === 'result') {
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: o.scoreA, scoreB: o.scoreB, prA: o.prA, prB: o.prB, luckA: o.luckA, luckB: o.luckB };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1, prA: null, prB: null, luckA: null, luckB: null };
        } else if (o.type === 'technical_draw') {
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: 0, scoreB: 0, prA: null, prB: null, luckA: null, luckB: null };
        } else {
            continue; // unknown type — ignore
        }

        const idx = next.findIndex((x) => key(x.playerA, x.playerB) === k);
        const prevForKey = prevByKey.get(k);
        const round = idx >= 0 ? next[idx].round : (prevForKey ? prevForKey.round : null);

        // The override's stored date is DOMAIN data — when the result last
        // changed. Priority:
        //   1. the admin-authored edit date (edited_at), whenever present;
        //   2. else, if the result is unchanged from the stored manual row, KEEP
        //      that row's date (do NOT stamp `now` — that redates a manual edit to
        //      the run/publish time, the bug this whole change exists to kill, and
        //      it must not fire on legacy rows that predate the edited_at column);
        //   3. else (genuinely new result, or promoting a CSV row to manual) `now`.
        const resultUnchanged = prevForKey && prevForKey.source === 'manual'
            && prevForKey.round === round && sameNumericFields(prevForKey, record);
        const stampDate = o.editedAt || (resultUnchanged ? prevForKey.updatedAt : now);
        const stamped = { ...record, round, updatedAt: stampDate, source: 'manual' };

        const same = (row) => row && row.source === 'manual' && row.round === round
            && sameNumericFields(row, record) && row.updatedAt === stampDate;

        if (idx >= 0) {
            if (same(next[idx])) continue; // unchanged — leave the stored row (and date) as is
            next[idx] = stamped;
        } else {
            // No played=true row for this pairing (e.g. a technical result on a
            // match nobody played). Compare against the stored history row, and
            // still push something so the key stays out of the stale-delete set.
            next.push(same(prevForKey) ? prevForKey : stamped);
        }
    }

    // Delete history rows whose pairing is no longer present.
    const freshKeys = new Set(next.map((m) => key(m.playerA, m.playerB)));
    const staleIds = history
        .filter((row) => !freshKeys.has(key(row.player_a, row.player_b)))
        .map((row) => row.id);

    // Upsert only rows that genuinely differ from what's stored. Upserting an
    // unchanged row still fires an UPDATE in Postgres, tripping the audit trigger
    // across the league for a no-op (ghost history rows).
    const changed = next.filter((m) => {
        const prev = prevByKey.get(key(m.playerA, m.playerB));
        return !prev || !sameNumericFields(prev, m) || prev.round !== m.round
            || prev.source !== m.source || prev.updatedAt !== m.updatedAt;
    });
    const upsertRows = changed.map((m) => ({
        league_id: leagueId, player_a: m.playerA, player_b: m.playerB,
        score_a: m.scoreA, score_b: m.scoreB, pr_a: m.prA, pr_b: m.prB, luck_a: m.luckA, luck_b: m.luckB,
        round: m.round, source: m.source, updated_at: m.updatedAt,
    }));

    return { skipped: false, staleIds, upsertRows };
}
