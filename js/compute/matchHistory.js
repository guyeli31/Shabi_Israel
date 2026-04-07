/**
 * matchHistory.js — Per-match timeline store.
 *
 * Each league may have a `match_history.json` file with shape:
 *   { matches: [ { playerA, playerB, scoreA, scoreB, prA, prB, luckA, luckB,
 *                  round, updatedAt, source } ] }
 *
 * source: "csv" | "manual"
 *
 * The history is the source of truth for the "as of date" view. For the live
 * (current) view, history records override matching CSV rows (if both exist).
 */

const LEAGUES_BASE = 'leagues';

export function matchKey(playerA, playerB) {
    return [playerA, playerB].sort().join('|');
}

/**
 * Load match_history.json for a league. Returns { matches: [] } if missing.
 */
export async function loadMatchHistory(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    try {
        const resp = await fetch(`${LEAGUES_BASE}/${encoded}/match_history.json`);
        if (!resp.ok) return { matches: [] };
        const data = await resp.json();
        return { matches: data.matches || [] };
    } catch {
        return { matches: [] };
    }
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
        const merged = {
            playerA: h.playerA, playerB: h.playerB,
            scoreA: h.scoreA, scoreB: h.scoreB,
            prA: h.prA, prB: h.prB,
            luckA: h.luckA, luckB: h.luckB,
            round: h.round,
            updatedAt: h.updatedAt,
            source: h.source
        };
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
