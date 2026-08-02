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
 * Filter history matches to those updated on or before the given date (ISO string or Date).
 * Returns matches in the format expected by stats/rankings (no _ flags by default).
 */
export function getMatchesAsOf(history, dateISO) {
    if (!dateISO) return history.matches.slice();
    const cutoff = new Date(dateISO).getTime();
    return history.matches.filter(m => {
        if (!m.updatedAt) return false;
        return new Date(m.updatedAt).getTime() <= cutoff;
    });
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
 * Distinct update POINTS (not just dates), newest first. Records are grouped by
 * minute — so a single sync's sub-second spread collapses to one point, while
 * two genuinely separate updates on the same day stay distinct (the day-only
 * getUpdateDates merged them and lost the time). Each point's `value` is the
 * exact latest timestamp in its minute, so getMatchesAsOf(history, value)
 * includes every row written in that minute; `label` shows date + time.
 * @returns {{value:string,label:string}[]}
 */
export function getUpdatePoints(history) {
    const byMinute = new Map(); // "YYYY-MM-DDTHH:MM" -> latest exact ISO in that minute
    for (const m of history.matches) {
        if (!m.updatedAt) continue;
        const minute = m.updatedAt.slice(0, 16);
        const existing = byMinute.get(minute);
        if (!existing || m.updatedAt > existing) byMinute.set(minute, m.updatedAt);
    }
    return [...byMinute.values()]
        .sort()
        .reverse()
        .map((ts) => ({ value: ts, label: formatUpdatePoint(ts) }));
}

/** "9 Jul 2026, 17:39" — date + time for an update-point label. */
export function formatUpdatePoint(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
