/**
 * leagueLoader.js — Fetch league data (CSV + JSON config) and leagues order.
 */

import { parseCSV, countAllPlayers, getAllPlayersFromCSV } from './csvParser.js';

const LEAGUES_BASE = 'leagues';

/**
 * Load the display order of leagues from leagues_order.json.
 * Returns array of league folder names (strings).
 */
export async function loadLeagueOrder() {
    const resp = await fetch(`${LEAGUES_BASE}/leagues_order.json`);
    if (!resp.ok) throw new Error('Failed to load leagues_order.json');
    const data = await resp.json();
    return data.DisplayOrder || [];
}

/**
 * Load a single league's params (JSON config).
 */
export async function loadLeagueParams(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/league_params.json`);
    if (!resp.ok) throw new Error(`Failed to load params for "${leagueId}"`);
    return resp.json();
}

/**
 * Load a single league's match data (CSV).
 * Returns parsed array of match objects.
 */
export async function loadLeagueMatches(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/leaguedata.csv`);
    if (!resp.ok) throw new Error(`Failed to load CSV for "${leagueId}"`);
    const text = await resp.text();
    const lastModified = resp.headers.get('Last-Modified') || null;
    const allPlayers = getAllPlayersFromCSV(text);
    const totalPlayers = allPlayers.size;
    return { matches: parseCSV(text), lastModified, totalPlayers, allPlayers };
}

/**
 * Load everything for a single league: params + matches.
 */
export async function loadLeague(leagueId) {
    const [params, matchData] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId)
    ]);
    return { id: leagueId, params, matches: matchData.matches, lastModified: matchData.lastModified, totalPlayers: matchData.totalPlayers, allPlayers: matchData.allPlayers };
}

/**
 * Load params for all leagues (for the landing page — needs title, status, etc.).
 * Returns array of { id, params }.
 */
export async function loadAllLeagueParams(leagueIds) {
    const results = await Promise.all(
        leagueIds.map(async id => {
            const params = await loadLeagueParams(id);
            return { id, params };
        })
    );
    return results;
}
