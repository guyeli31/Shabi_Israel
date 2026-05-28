// data/matchHistory.js — per-match timeline store.
//
// Each league may carry a `match_history.json` with shape:
//   { matches: [ { playerA, playerB, scoreA, scoreB, prA, prB, luckA, luckB,
//                  round, updatedAt, source } ] }
// source: "csv" | "manual".
//
// History is the source of truth for "as-of date" views. For the live view,
// history records override matching CSV rows on the unordered playerA+playerB
// key.
//
// Lives under data/ in v2 (was js/compute/matchHistory.js in v1). The file
// mixes I/O and pure merging; only `loadMatchHistory` touches the network.

const LEAGUES_BASE = "/data";

export function matchKey(playerA, playerB) {
    return [playerA, playerB].sort().join("|");
}

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
 * Merge history records onto CSV-parsed matches. History wins on conflict;
 * history-only entries are appended. Returns a new array.
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
            source: h.source,
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

/** History matches updated on or before the cutoff date (ISO string or Date). */
export function getMatchesAsOf(history, dateISO) {
    if (!dateISO) return history.matches.slice();
    const cutoff = new Date(dateISO).getTime();
    return history.matches.filter((m) => {
        if (!m.updatedAt) return false;
        return new Date(m.updatedAt).getTime() <= cutoff;
    });
}

/** Unique update day stamps (ISO yyyy-mm-dd), descending. */
export function getUpdateDates(history) {
    const days = new Set();
    for (const m of history.matches) {
        if (!m.updatedAt) continue;
        days.add(m.updatedAt.slice(0, 10));
    }
    return [...days].sort().reverse();
}
