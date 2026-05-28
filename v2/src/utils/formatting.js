// utils/formatting.js — display formatters + league-date parsing.

export function formatPercent(value) {
    return (value * 100).toFixed(2) + "%";
}

export function formatNumber(value, decimals = 2) {
    return Number(value).toFixed(decimals);
}

/**
 * Two-label table header content: full text for desktop, abbreviation for
 * narrow viewports. Component CSS swaps visibility at the relevant
 * breakpoint (see `.th-full` / `.th-abbr` in table styles).
 */
export function thLabel(full, abbr) {
    const a = abbr == null || abbr === "" ? full : abbr;
    return `<span class="th-full">${full}</span><span class="th-abbr">${a}</span>`;
}

const _MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
];
const _MONTH_SHORT = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
];

/**
 * Decode a league folder id into its calendar components.
 *
 * "Shabi Israel April 2026" → { year: 2026, monthIndex: 3, monthShort: "Apr" }
 */
export function parseLeagueDate(folderId) {
    const parts = String(folderId || "").split(" ");
    const year = parseInt(parts[parts.length - 1], 10);
    const monthName = parts[parts.length - 2];
    const monthIndex = _MONTHS.indexOf(monthName);
    return {
        year: Number.isFinite(year) ? year : null,
        monthIndex,
        monthShort: _MONTH_SHORT[monthIndex] || monthName,
    };
}

/**
 * Resolve a league's calendar year. Prefers explicit params.IssueDate /
 * StartDate; falls back to parsing the folder id. Returns null when no
 * source is available.
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
