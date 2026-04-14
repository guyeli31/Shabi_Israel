/**
 * helpers.js — Shared utilities for URL params, formatting, and flag paths.
 */

export function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

export function formatPercent(value) {
    return (value * 100).toFixed(2) + '%';
}

export function formatNumber(value, decimals = 2) {
    return Number(value).toFixed(decimals);
}

export function flagUrl(countryCode) {
    return `assets/flags/${countryCode}.png`;
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

export function getFlagCode(playerName, customFlags) {
    if (customFlags && customFlags[playerName]) {
        return customFlags[playerName];
    }
    return 'IL';
}

const _MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const _MONTH_SHORT = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
];

/**
 * Extract year and month from a league folder id.
 * "Shabi Israel April 2026" → { year: 2026, monthIndex: 3, monthShort: "Apr" }
 */
export function parseLeagueDate(folderId) {
    const parts = String(folderId || '').split(' ');
    const year = parseInt(parts[parts.length - 1], 10);
    const monthName = parts[parts.length - 2];
    const monthIndex = _MONTHS.indexOf(monthName);
    return {
        year: Number.isFinite(year) ? year : null,
        monthIndex,
        monthShort: _MONTH_SHORT[monthIndex] || monthName
    };
}

/**
 * Resolve a league's calendar year from params.IssueDate, params.StartDate,
 * or by parsing the folder id. Returns null if no source is available.
 */
export function getLeagueYear(league) {
    const p = league?.params || {};
    if (p.IssueDate) {
        const d = new Date(p.IssueDate);
        if (!isNaN(d)) return d.getUTCFullYear();
    }
    if (p.StartDate) {
        const d = new Date(p.StartDate);
        if (!isNaN(d)) return d.getUTCFullYear();
    }
    return parseLeagueDate(league?.id).year ?? null;
}
