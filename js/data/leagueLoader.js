/**
 * leagueLoader.js — Fetch league data (CSV + JSON config) and leagues order.
 */

import { parseCSV, parseCSVAll, countAllPlayers, getAllPlayersFromCSV } from './csvParser.js';
import { loadMatchHistory, mergeHistoryIntoMatches } from '../compute/matchHistory.js';

let LEAGUES_BASE = 'leagues';
export function setLeaguesBase(path) { LEAGUES_BASE = path; }

/**
 * Load full landing settings (title, subtitle, logo, display order).
 */
export async function loadLandingSettings() {
    const resp = await fetch(`${LEAGUES_BASE}/landing_settings.json`);
    if (!resp.ok) throw new Error('Failed to load landing settings');
    const data = await resp.json();
    return {
        title: data.title || 'Shabi Israel',
        subtitle: data.subtitle || '',
        logoPath: data.logoPath || 'assets/logo/logo.png',
        displayOrder: data.DisplayOrder || []
    };
}

/**
 * Load the display order of leagues.
 * Returns array of league folder names (strings).
 */
export async function loadLeagueOrder() {
    const settings = await loadLandingSettings();
    return settings.displayOrder;
}

/**
 * Load a single league's params (JSON config).
 */
export async function loadLeagueParams(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/league_params.json`);
    if (!resp.ok) throw new Error(`Failed to load params for "${leagueId}"`);
    const raw = await resp.json();
    return normalizeParams(raw);
}

/**
 * Apply defaults for newer params fields so consumers see a uniform shape.
 */
function normalizeParams(p) {
    return {
        ...p,
        IssueDate: p.IssueDate ?? null,
        EntryFee: p.EntryFee ?? 0,
        Prizes: p.Prizes ?? { Gold: 0, Silver: 0, Bronze: 0 }
    };
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
 * Load a league's match data including unplayed rows (for admin editor).
 */
export async function loadLeagueMatchesAll(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/leaguedata.csv`);
    if (!resp.ok) throw new Error(`Failed to load CSV for "${leagueId}"`);
    const text = await resp.text();
    const allPlayers = getAllPlayersFromCSV(text);
    return { matches: parseCSVAll(text), allPlayers };
}

/**
 * Load manual overrides for a league (if they exist).
 * Returns the overrides array, or empty array if no file.
 */
export async function loadOverrides(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    try {
        const resp = await fetch(`${LEAGUES_BASE}/${encoded}/manual_overrides.json`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.overrides || [];
    } catch {
        return [];
    }
}

/**
 * Load everything for a single league: params + matches + overrides applied.
 */
export async function loadLeague(leagueId) {
    const [params, matchData, overrides, history] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId),
        loadOverrides(leagueId),
        loadMatchHistory(leagueId)
    ]);

    // Apply overrides, then merge in history (history wins on conflict)
    const withOverrides = applyOverrides(matchData.matches, overrides);
    const mergedMatches = mergeHistoryIntoMatches(withOverrides, history.matches);

    return {
        id: leagueId,
        params,
        matches: mergedMatches,
        lastModified: matchData.lastModified,
        totalPlayers: matchData.totalPlayers,
        allPlayers: matchData.allPlayers,
        history
    };
}

/**
 * Apply manual overrides on top of CSV-parsed matches.
 * Each override replaces or adds a match by playerA+playerB key.
 */
export function applyOverrides(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;

    const result = [...matches];

    for (const o of overrides) {
        const key = [o.playerA, o.playerB].sort().join('|');

        // Find existing match
        const idx = result.findIndex(m => {
            const mKey = [m.playerA, m.playerB].sort().join('|');
            return mKey === key;
        });

        let newMatch;
        if (o.type === 'result') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                _overridden: true
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true
            };
        } else if (o.type === 'technical_draw') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true, _draw: true
            };
        } else if (o.type === 'not_played') {
            // Remove match from played matches (treat as unplayed)
            if (idx !== -1) result.splice(idx, 1);
            continue;
        }

        if (newMatch) {
            if (idx !== -1) {
                result[idx] = newMatch;
            } else {
                result.push(newMatch);
            }
        }
    }

    return result;
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
