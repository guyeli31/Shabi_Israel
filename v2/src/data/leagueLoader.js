// data/leagueLoader.js — fetch league data (CSV + JSON config + history).
//
// All paths resolve under `/data/<league>/...`, which Vite's shared-data-proxy
// plugin (see vite.config.js) maps to the shared `../leagues` directory that
// v1 also reads. For production builds, scripts/data-sync.js will snapshot
// the same tree into v2/public/data.
//
// `setLeaguesBase(path)` is provided for tests / non-default deployments;
// callers in the app never need it.

import {
    parseCSV,
    parseCSVAll,
    getAllPlayersFromCSV,
} from "./csvParser.js";
import { loadMatchHistory, mergeHistoryIntoMatches } from "./matchHistory.js";

let LEAGUES_BASE = "/data";
export function setLeaguesBase(path) { LEAGUES_BASE = path; }

export async function loadLandingSettings() {
    const resp = await fetch(`${LEAGUES_BASE}/landing_settings.json`);
    if (!resp.ok) throw new Error("Failed to load landing settings");
    const data = await resp.json();
    return {
        title: data.title || "Shabi Israel",
        subtitle: data.subtitle || "",
        logoPath: data.logoPath || "assets/logo/logo.png",
        displayOrder: data.DisplayOrder || [],
    };
}

export async function loadLeagueOrder() {
    const settings = await loadLandingSettings();
    return settings.displayOrder;
}

export async function loadLeagueParams(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/league_params.json`);
    if (!resp.ok) throw new Error(`Failed to load params for "${leagueId}"`);
    const raw = await resp.json();
    return normaliseParams(raw);
}

function normaliseParams(p) {
    return {
        ...p,
        IssueDate: p.IssueDate ?? null,
        EntryFee: p.EntryFee ?? 0,
        Prizes: p.Prizes ?? { Gold: 0, Silver: 0, Bronze: 0 },
    };
}

export async function loadLeagueMatches(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/leaguedata.csv`);
    if (!resp.ok) throw new Error(`Failed to load CSV for "${leagueId}"`);
    const text = await resp.text();
    const lastModified = resp.headers.get("Last-Modified") || null;
    const allPlayers = getAllPlayersFromCSV(text);
    return {
        matches: parseCSV(text),
        lastModified,
        totalPlayers: allPlayers.size,
        allPlayers,
    };
}

export async function loadLeagueMatchesAll(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const resp = await fetch(`${LEAGUES_BASE}/${encoded}/leaguedata.csv`);
    if (!resp.ok) throw new Error(`Failed to load CSV for "${leagueId}"`);
    const text = await resp.text();
    return { matches: parseCSVAll(text), allPlayers: getAllPlayersFromCSV(text) };
}

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

export async function loadLeague(leagueId) {
    const [params, matchData, overrides, history] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId),
        loadOverrides(leagueId),
        loadMatchHistory(leagueId),
    ]);

    const withOverrides = applyOverrides(matchData.matches, overrides);
    const mergedMatches = mergeHistoryIntoMatches(withOverrides, history.matches);

    return {
        id: leagueId,
        params,
        matches: mergedMatches,
        lastModified: matchData.lastModified,
        totalPlayers: matchData.totalPlayers,
        allPlayers: matchData.allPlayers,
        history,
    };
}

/**
 * Apply manual overrides on top of CSV-parsed matches. Each override
 * replaces or adds a match keyed by the unordered (playerA, playerB) pair.
 */
export function applyOverrides(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;
    const result = [...matches];

    for (const o of overrides) {
        const key = [o.playerA, o.playerB].sort().join("|");
        const idx = result.findIndex(
            (m) => [m.playerA, m.playerB].sort().join("|") === key
        );

        let newMatch = null;
        if (o.type === "result") {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                _overridden: true,
            };
        } else if (o.type === "technical_win") {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true,
            };
        } else if (o.type === "technical_draw") {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true, _draw: true,
            };
        } else if (o.type === "not_played") {
            if (idx !== -1) result.splice(idx, 1);
            continue;
        }

        if (newMatch) {
            if (idx !== -1) result[idx] = newMatch;
            else result.push(newMatch);
        }
    }
    return result;
}

export async function loadAllLeagueParams(leagueIds) {
    return Promise.all(
        leagueIds.map(async (id) => ({ id, params: await loadLeagueParams(id) }))
    );
}
