// utils/urlParams.js — query-string reader + page-URL builders.
//
// Page URLs are emitted as bare `<page>.html?...` strings, matching v1's
// shape. Vite's build resolves them to the right paths in production; the
// migrate-v1-to-v2.sh cutover script promotes `src/pages/<x>/<x>.html` to
// repo-root `<x>.html`, so these strings stay valid post-cutover.

export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

export function leagueUrl(leagueId) {
    return `league.html?league=${encodeURIComponent(leagueId)}`;
}

export function dashboardUrl(leagueId) {
    return `dashboard.html?league=${encodeURIComponent(leagueId)}`;
}

export function playerUrl(leagueId, playerName) {
    return `player.html?league=${encodeURIComponent(leagueId)}&player=${encodeURIComponent(playerName)}`;
}

export function playerGeneralUrl(playerName) {
    return `player_general.html?player=${encodeURIComponent(playerName)}`;
}
