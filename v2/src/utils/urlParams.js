// utils/urlParams.js — query-string reader + page-URL builders.
//
// Page URLs are emitted as bare `<page>.html?...` strings, matching v1's
// shape. Vite's build resolves them to the right paths in production; the
// migrate-v1-to-v2.sh cutover script promotes `src/pages/<x>/<x>.html` to
// repo-root `<x>.html`, so these strings stay valid post-cutover.

export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

// Page URL helpers. Names match the page filenames after the 2026-06-20
// rename: dashboardUrl→leagueUrl, leagueUrl→leagueTableUrl,
// playerUrl→playerLeagueUrl, playerGeneralUrl→playerUrl.
export function leagueUrl(leagueId) {
    return `league.html?league=${encodeURIComponent(leagueId)}`;
}

export function leagueTableUrl(leagueId) {
    return `league_table.html?league=${encodeURIComponent(leagueId)}`;
}

export function playerLeagueUrl(leagueId, playerName) {
    return `player_league.html?league=${encodeURIComponent(leagueId)}&player=${encodeURIComponent(playerName)}`;
}

export function playerUrl(playerName) {
    return `player.html?player=${encodeURIComponent(playerName)}`;
}
