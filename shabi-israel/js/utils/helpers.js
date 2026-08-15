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

/**
 * Flag <img> for the smart-search player lists (flyout + mobile sheet + landing).
 * Decorative (aria-hidden — the name carries the meaning); sized in `em` by the
 * shared `.search-flag` rule so it tracks the surrounding font size.
 */
export function searchFlagHtml(flagCode) {
    if (!flagCode) return '';
    return `<img class="search-flag" src="${flagUrl(flagCode)}" alt="" aria-hidden="true">`;
}

// URL helpers for the 4 entity pages. Names match the page filenames.
// Rename history (2026-06-20): dashboardUrl→leagueUrl, leagueUrl→leagueTableUrl,
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

export function getFlagCode(playerName, customFlags) {
    if (customFlags && customFlags[playerName]) {
        return customFlags[playerName];
    }
    return 'IL';
}

/**
 * Dual-label th content: full desktop text + abbreviated mobile text.
 * CSS swaps visibility at ≤640px.
 */
export function thLabel(full, abbr) {
    const a = (abbr == null || abbr === '') ? full : abbr;
    return `<span class="th-full">${full}</span><span class="th-abbr">${a}</span>`;
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
 * "July 2026 Regular"       → { year: 2026, monthIndex: 6, monthShort: "Jul" }
 *
 * The month/year tokens are scanned for ANYWHERE in the id rather than assumed
 * to be the last two. Two leagues of different types can run in the same month,
 * so their ids carry a trailing type suffix ("July 2026 Regular") — under the
 * old trailing-token assumption those parsed as monthIndex -1 / year null and
 * were silently dropped from every id-derived date (annual leaderboards most
 * visibly).
 */
export function parseLeagueDate(folderId) {
    const parts = String(folderId || '').split(/\s+/).filter(Boolean);
    let year = null;
    let monthIndex = -1;
    for (const part of parts) {
        if (monthIndex < 0) {
            const i = _MONTHS.findIndex(m => m.toLowerCase() === part.toLowerCase());
            if (i >= 0) { monthIndex = i; continue; }
        }
        if (year == null && /^\d{4}$/.test(part)) year = parseInt(part, 10);
    }
    return {
        year,
        monthIndex,
        monthShort: _MONTH_SHORT[monthIndex] || null
    };
}

/**
 * The Annual Leaderboard's calendar slot for a league: { year, monthIndex,
 * monthShort }, or null when the league has no slot.
 *
 * The date comes from params.IssueDate ALONE — deliberately not from the
 * league name, and deliberately not from params.StartDate:
 *  - The NAME carries no reliable date. A league needn't be named after a
 *    month at all, and when it is the name can simply be wrong ("July 2026"
 *    was stored with an issue date of 1 Jun 2026).
 *  - StartDate is written as `new Date()` when a league is CREATED, so it is a
 *    row-creation timestamp, not the league's own start — trusting it would
 *    silently file a league under the month someone happened to set it up in.
 *
 * A league with no IssueDate therefore has no month column to sit in, which is
 * why it cannot be opted into the leaderboard at all (see
 * leagueJoinsLeaderboard() and the DB's leagues_in_leaderboard_needs_date
 * constraint).
 */
export function leagueLeaderboardSlot(params) {
    const iso = params?.IssueDate;
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const monthIndex = d.getUTCMonth();
    return { year: d.getUTCFullYear(), monthIndex, monthShort: _MONTH_SHORT[monthIndex] };
}

/**
 * Is this league shown in its year's Annual Leaderboard?
 * Both halves are required: an explicit opt-in AND a date to place it under.
 * `InLeaderboard` is treated as opt-OUT-only (missing/undefined counts as in)
 * so a database that hasn't had sql/league_in_leaderboard.sql applied yet keeps
 * showing its leaderboards instead of emptying them.
 */
export function leagueJoinsLeaderboard(params) {
    return params?.InLeaderboard !== false && leagueLeaderboardSlot(params) !== null;
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
