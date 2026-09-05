/**
 * matchHistory.js — Per-match timeline logic (pure).
 *
 * A history record has the shape:
 *   { playerA, playerB, scoreA, scoreB, prA, prB, luckA, luckB,
 *     round, updatedAt, source }   // source: "csv" | "manual"
 *
 * The history is the source of truth for the "as of date" view. For the live
 * (current) view, history records override matching match rows (if both exist).
 *
 * Loading lives in js/data/{store,supabaseLoader}.js — the `match_history`
 * table. This module holds only the merge/replay logic that runs on top.
 */

export function matchKey(playerA, playerB) {
    return [playerA, playerB].sort().join('|');
}

/**
 * Merge a history record list onto CSV-parsed matches.
 * For each history record, replace the corresponding CSV match (by playerA+playerB
 * unordered key). History matches not present in CSV are appended.
 * Returns a new array; does not mutate inputs.
 */
export function mergeHistoryIntoMatches(csvMatches, historyMatches) {
    if (!historyMatches || historyMatches.length === 0) return csvMatches;
    const result = [...csvMatches];
    const indexByKey = new Map();
    result.forEach((m, i) => indexByKey.set(matchKey(m.playerA, m.playerB), i));

    for (const h of historyMatches) {
        const key = matchKey(h.playerA, h.playerB);
        const prior = indexByKey.has(key) ? result[indexByKey.get(key)] : null;
        const merged = {
            playerA: h.playerA, playerB: h.playerB,
            scoreA: h.scoreA, scoreB: h.scoreB,
            prA: h.prA, prB: h.prB,
            luckA: h.luckA, luckB: h.luckB,
            round: h.round,
            updatedAt: h.updatedAt,
            source: h.source
        };
        // History carries the VALUES, but it can't say how they were derived —
        // `source: 'manual'` covers a plain result override as much as a technical
        // one. applyOverrides() runs before this and already marked the match, so
        // carry its markers across. Dropping them silently un-technicals the match:
        // every `if (m._technical) continue` guard stops firing, and the presets'
        // `luckSelf - luckOpp` turns null - null into a real-looking 0.00.
        if (prior) {
            if (prior._overridden) merged._overridden = true;
            if (prior._technical) merged._technical = true;
            if (prior._draw) merged._draw = true;
        }
        if (indexByKey.has(key)) {
            result[indexByKey.get(key)] = merged;
        } else {
            result.push(merged);
            indexByKey.set(key, result.length - 1);
        }
    }
    return result;
}

/**
 * The league BEFORE anything was played — the oldest point on every league's
 * timeline, and the only one guaranteed to exist. A history built from
 * match_history alone can't express it: its oldest update point is the first
 * batch of results, which for a league imported in one go IS the whole league.
 * So "empty" is a sentinel, not a stored row — there is nothing to store.
 */
export const INITIAL_POINT = '__initial__';

/**
 * THE timeline — the one played-match list every time-aware view is built from:
 * the Played Matches table (B5), the update points offered by the Historical (B2)
 * and What-If (B4) pickers, the as-of replay behind both, and the live merge.
 *
 * It is `match_history` minus the pairings a `not_played` override says never
 * happened. Those must vanish from the PAST as well as the present: an admin who
 * marks a match not-played is saying it was never a result, so the update point
 * it once contributed has to go with it — otherwise the picker offers a point
 * built on a match the site refuses to show anywhere else. The reconcile deletes
 * such rows on the next publish/sync ([matchHistoryReconcile.js]), but a league
 * read between the override and that publish still carries them, and until this
 * filter existed the stale row also resurrected the match through the live merge.
 *
 * @param {{matches:object[]}|object[]} history  the loaded history (or its rows)
 * @param {object[]} overrides                   the league's manual_overrides
 * @param {object[]} [allMatches]                the authoritative with-unplayed
 *   match set (overrides already applied), when the caller has it. A pairing it
 *   marks `played: false` is dropped too — the same guard B5 applies to its own
 *   rows, so the points offered and the matches listed can never disagree.
 */
export function buildMatchTimeline(history, overrides, allMatches) {
    const rows = Array.isArray(history) ? history : (history && history.matches) || [];
    const dropped = new Set();
    for (const o of overrides || []) {
        if (o.type === 'not_played') dropped.add(matchKey(o.playerA, o.playerB));
    }
    for (const m of allMatches || []) {
        if (!m.played) dropped.add(matchKey(m.playerA, m.playerB));
    }
    if (dropped.size === 0) return rows.slice();
    return rows.filter(m => !dropped.has(matchKey(m.playerA, m.playerB)));
}

/**
 * Filter the timeline to matches updated on or before the given date (ISO string
 * or Date). Returns matches in the format expected by stats/rankings (no _ flags
 * by default). INITIAL_POINT resolves to no matches at all.
 *
 * Takes the timeline (see buildMatchTimeline), NOT the raw history object — the
 * as-of view and the update-point list have to be built from the same set, or the
 * picker offers points the table can't reproduce.
 */
export function getMatchesAsOf(timeline, pointValue) {
    if (pointValue === INITIAL_POINT) return [];
    if (!pointValue) return timeline.slice();
    const { stamp, ordinal } = parsePointValue(pointValue);
    const cutoff = new Date(stamp).getTime();
    const dated = orderTimeline(timeline);
    const before = dated.filter(m => new Date(m.updatedAt).getTime() < cutoff);
    const group = dated.filter(m => new Date(m.updatedAt).getTime() === cutoff);
    // No ordinal (a plain timestamp — including every link shared before points
    // became per-match) means the whole instant: every match recorded then.
    return before.concat(ordinal == null ? group : group.slice(0, ordinal));
}

/**
 * The timeline in chronological order, dateless rows dropped.
 *
 * Rows sharing an instant are ordered by their PAIRING, alphabetically. Nothing
 * in the data says which of them was played first — a league imported in one go
 * stamps every match with the same instant — so the order is arbitrary in
 * meaning, but it must not be arbitrary in FACT.
 *
 * It was, once, and the bug is worth keeping in view: the tie-break used to be
 * arrival order, which is stable only within one source. The browser reads
 * match_history from the site bundle (ordered by id); a Node job reads it with
 * no ORDER BY and gets whatever Postgres returns. Same rows, same timestamps,
 * different sequence — so the two disagreed about which match point #1 was, the
 * per-point fingerprints computed from that sequence never matched, and every
 * precomputed projection looked stale to the page that was meant to read it.
 *
 * Deriving the order from the data itself makes it reproducible anywhere, by
 * anyone, forever — which is what a fingerprint, a `#n` ordinal in a URL, and an
 * as-of replay all quietly depend on.
 */
function orderTimeline(timeline) {
    return timeline
        .filter(m => m.updatedAt)
        .map(m => ({ m, t: new Date(m.updatedAt).getTime(), k: matchKey(m.playerA, m.playerB) }))
        .sort((a, b) => (a.t - b.t) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
        .map(x => x.m);
}

/** `"<iso>"` or `"<iso>#<n>"` → the instant plus which match within it. */
function parsePointValue(value) {
    const s = String(value);
    const hash = s.lastIndexOf('#');
    if (hash === -1) return { stamp: s, ordinal: null };
    const n = Number(s.slice(hash + 1));
    if (!Number.isInteger(n) || n < 1) return { stamp: s, ordinal: null };
    return { stamp: s.slice(0, hash), ordinal: n };
}

/**
 * Sorted list of unique update dates (ISO date strings, day precision), descending.
 */
export function getUpdateDates(history) {
    const days = new Set();
    for (const m of history.matches) {
        if (!m.updatedAt) continue;
        days.add(m.updatedAt.slice(0, 10));
    }
    return [...days].sort().reverse();
}

/**
 * ONE UPDATE POINT PER PLAYED MATCH, newest first.
 *
 * The invariant this exists to hold: **the number of points equals the number of
 * rows in Played Matches (B5)** — plus the synthetic "Initial" the caller adds.
 * Every match the league counts is a place you can rewind to, and nothing else
 * is. Points used to be grouped by MINUTE, which quietly broke that: a league
 * imported in one go stamps every match with the same instant, so 89 matches
 * offered 3 points. Grouping is gone — a point is a match.
 *
 * Two matches can still share an instant, so a timestamp alone no longer
 * identifies a point. `value` is the timestamp, plus `#n` (1-based, in the
 * arbitrary-but-stable order of orderTimeline) when several matches share it —
 * "the state after the nth match of that instant". A bare timestamp still means
 * the whole instant, so links shared before this change keep working.
 *
 * Each point also carries the `match` it is, so the picker can render it as the
 * match rather than as a bare clock reading. `label` is the plain-text form
 * (also what a filter matches on); `dateLabel` is just the date part.
 *
 * Built from the timeline (see buildMatchTimeline), so a match marked not-played
 * contributes no point. An override's date is the one the admin authored
 * (`edited_at`, stored as local midnight by the Round Editor's date field) — so
 * an edited match moves, in B5 and in this list together.
 *
 * @param {object[]} timeline
 * @returns {{value:string,label:string,dateLabel:string,match:object}[]}
 */
export function getUpdatePoints(timeline) {
    const dated = orderTimeline(timeline);
    const countByStamp = new Map();
    for (const m of dated) countByStamp.set(m.updatedAt, (countByStamp.get(m.updatedAt) || 0) + 1);

    const seen = new Map();
    const points = dated.map((m) => {
        const n = (seen.get(m.updatedAt) || 0) + 1;
        seen.set(m.updatedAt, n);
        // Date AND time, always. Matches that share an instant (a league imported
        // in one go) therefore share a clock reading too — that is the truth about
        // them: one moment of recording, arbitrary order within it. The row still
        // tells them apart, because it names the match.
        const dateLabel = formatUpdatePoint(m.updatedAt);
        return {
            value: countByStamp.get(m.updatedAt) > 1 ? `${m.updatedAt}#${n}` : m.updatedAt,
            dateLabel,
            label: `${dateLabel} — ${describeResult(m)}`,
            match: m,
        };
    });
    return points.reverse();
}

/** "Moriarty beats UziMutsafy" / "ys draws Izhako" — plain text, no markup. */
export function describeResult(m) {
    const { winner, loser, drawn } = resultSides(m);
    return drawn ? `${winner} draws ${loser}` : `${winner} beats ${loser}`;
}

/**
 * Which side won. A technical draw carries `_draw`; otherwise the higher score
 * wins, and equal scores with no `_draw` flag (data we can't read as a result)
 * fall back to the recorded A/B order rather than inventing a winner.
 */
export function resultSides(m) {
    const drawn = !!m._draw || (m.scoreA != null && m.scoreA === m.scoreB);
    const aWon = Number(m.scoreA) > Number(m.scoreB);
    return {
        winner: aWon || drawn ? m.playerA : m.playerB,
        loser: aWon || drawn ? m.playerB : m.playerA,
        drawn,
    };
}

/** "9 Jul 2026, 17:39" — date + time for an update-point label. */
export function formatUpdatePoint(ts) {
    const d = new Date(ts);
    return formatUpdateDay(ts)
        + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "9 Jul 2026" — the date alone. */
export function formatUpdateDay(ts) {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "9 Jul" — the date without the year, for a CHART AXIS.
 *
 * Every tick on such an axis belongs to one league, so the year is identical on
 * all of them: it costs width on every label and distinguishes none of them.
 * Deliberately separate from formatUpdateDay, which labels things that stand on
 * their own (a picker row, a header) and there the year is not derivable from
 * context.
 */
export function formatAxisDay(ts) {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
