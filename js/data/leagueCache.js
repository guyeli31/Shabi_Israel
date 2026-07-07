/**
 * leagueCache.js — short-TTL sessionStorage cache for loadLeague() results.
 *
 * This is a multi-page app: navigating from index.html into league.html or
 * league_table.html is a full browser navigation, not client-side routing, so
 * every in-memory memoization (e.g. crossLeague.js's allLeaguesPromise) is
 * lost the instant the page changes. Without this cache, clicking from the
 * landing page (which already fetched every league's full data to build its
 * cross-league sections) into one specific league re-fetches that exact same
 * league from scratch.
 *
 * TTL is short on purpose: this only exists to bridge a single navigation
 * within the same browsing session, not to serve stale data indefinitely.
 */

const PREFIX = 'sb-league-cache:';
const TTL_MS = 60_000;

export function getCachedLeague(leagueId) {
    try {
        const raw = sessionStorage.getItem(PREFIX + leagueId);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > TTL_MS) {
            sessionStorage.removeItem(PREFIX + leagueId);
            return null;
        }
        return { ...data, allPlayers: new Set(data.allPlayers) };
    } catch {
        return null;
    }
}

export function setCachedLeague(leagueId, league) {
    try {
        const serializable = { ...league, allPlayers: [...league.allPlayers] };
        sessionStorage.setItem(PREFIX + leagueId, JSON.stringify({ ts: Date.now(), data: serializable }));
    } catch {
        // sessionStorage full or unavailable (private browsing, quota) — caching
        // is a pure optimization, silently skipping it is always safe.
    }
}
