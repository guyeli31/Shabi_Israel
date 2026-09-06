/**
 * leagueHeader.js — Shared league-page headers.
 *
 * Two render functions, picked by page:
 *   • renderV13Header — Lichess-style centred title bar. Used on
 *     league_table.html (table-D page). Drops the "Started …" field by
 *     default; the "Last updated …" line already establishes the
 *     league has been running, so duplicating the start date adds
 *     no information on that surface.
 *   • renderV16Header — Hero banner with type/status pills, Bebas
 *     display title and a 2-tile stat grid (Start Date + Last
 *     Updated). Used on league.html.
 *
 * Both functions accept a `target` element (typically the page's
 * <h1 id="page-title">) and overwrite its innerHTML. Production
 * CSS in css/league-header.css neutralises the h1's default block
 * styling when it contains one of the cards.
 */

import { formatMatchStamp, formatMatchDay, isDayOnly } from '../utils/matchTime.js';

const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
}

/**
 * Format "2026-04-01" → "1 Apr 2026"; "2026-04" → "Apr 2026".
 *
 * A league's opening date is a DAY — the same reading for every viewer, no
 * timezone conversion (see matchTime.js) and NO CLOCK. A league does not open
 * at an hour; printing "00:00" beside it states a time nobody set.
 */
export function formatStartDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return iso;
    if (!m[3]) return `${MONTHS_SHORT[parseInt(m[2], 10) - 1] || ''} ${parseInt(m[1], 10)}`;
    return formatMatchDay(String(iso).slice(0, 10), iso);
}

/**
 * Format a Last-Modified header value → "14 Apr 2026, 16:06".
 *
 * A real instant, so it reads in the viewer's own timezone.
 *
 * It also accepts a value carrying NO clock — the league's opening date, which
 * the historical view passes as the "last updated" of the Initial point. That
 * one prints as a bare day: a header line reports what is known, and inventing
 * a "00:00" for a value that never had a time is not reporting.
 */
export function formatLastUpdated(headerVal) {
    if (!headerVal) return '';
    return isDayOnly(headerVal)
        ? formatMatchDay(headerVal, headerVal)
        : formatMatchStamp(headerVal, headerVal);
}

/**
 * The WhatsApp image-export subtitles' "Last updated …".
 *
 * Was date-only. It now carries the time, like every other reading on the site:
 * an exported image is read hours or days after it was made, and "7 Jul 2026"
 * cannot answer the question the subtitle exists for — whether the picture is
 * newer than the result someone is arguing about.
 *
 * The image is rendered from the exporter's own screen, so the clock in it is
 * the exporter's local time, not the reader's.
 */
export function formatLastUpdatedDate(headerVal) {
    if (!headerVal) return '';
    return isDayOnly(headerVal)
        ? formatMatchDay(headerVal, headerVal)
        : formatMatchStamp(headerVal, headerVal);
}

/**
 * Build a header-data object from a league's params + CSV
 * Last-Modified header.
 *
 * @param {Object}  params       contents of league_params.json
 * @param {?string} lastModified raw Last-Modified header (or null)
 * @returns {Object} { name, type, typeLabel, running, statusLabel,
 *                     startDate, lastUpdated }
 */
export function buildLeagueHeaderData(params, lastModified, leagueId) {
    const type = params.LeagueType || 'doubling';
    return {
        name: leagueId || params.LeagueTitle || '',
        type,
        typeLabel: LEAGUE_TYPE_LABELS[type] || type,
        running: !!params.Running,
        statusLabel: params.Running ? 'Running' : 'Completed',
        startDate: formatStartDate(params.IssueDate || ''),
        lastUpdated: formatLastUpdated(lastModified),
    };
}

function typePill(l) {
    return `<span class="league-type-pill type-${l.type}">${escapeHtml(l.typeLabel)}</span>`;
}
function statusPill(l) {
    const cls = l.running ? 'status-running' : 'status-completed';
    return `<span class="status-pill ${cls}"><span class="lh-dot"></span>${escapeHtml(l.statusLabel)}</span>`;
}

/**
 * Render the V13 Lichess title bar.
 *
 * @param {HTMLElement} target
 * @param {Object} data  result of buildLeagueHeaderData()
 * @param {Object} [opts]
 *   {boolean} [opts.omitStartDate=true]  hide the "Started …" item
 *   {string}  [opts.historicalNote]      when set, appended to the meta
 *     subtitle after the "Last updated …" date to flag that this is a
 *     historical snapshot and a newer version exists.
 */
export function renderV13Header(target, data, opts = {}) {
    if (!target) return;
    const omit = opts.omitStartDate !== false;  // default true on the table-D page
    const items = [];
    if (!omit) items.push(`Started ${escapeHtml(data.startDate)}`);
    items.push(`Last updated ${escapeHtml(data.lastUpdated)}`);
    let meta = items.join(' <span class="sep">·</span> ');
    if (opts.historicalNote) {
        meta += ` <span class="sep">·</span> <span class="lh13-historical-note">${escapeHtml(opts.historicalNote)}</span>`;
    }

    target.innerHTML = `
        <div class="lh13-card">
            <div class="lh13-name-line">
                <span class="lh13-name">${escapeHtml(data.name)}</span>
                ${typePill(data)}
                ${statusPill(data)}
            </div>
            <div class="lh13-meta">${meta}</div>
        </div>
    `;
}

/**
 * Render the V16 hero banner.
 *
 * @param {HTMLElement} target
 * @param {Object} data  result of buildLeagueHeaderData()
 * @param {Object} [opts]
 *   {boolean} [opts.omitStartDate=false] collapse to a 1-col stat grid
 */
export function renderV16Header(target, data, opts = {}) {
    if (!target) return;
    const omit = !!opts.omitStartDate;
    const startTile = omit ? '' :
        `<div><div class="lh16-statlbl">Start Date</div><div class="lh16-statval">${escapeHtml(data.startDate)}</div></div>`;
    const gridStyle = omit ? ' style="grid-template-columns:1fr"' : '';

    target.innerHTML = `
        <div class="lh16-hero">
            <div class="lh16-top">
                ${typePill(data)}
                ${statusPill(data)}
            </div>
            <h2 class="lh16-display">${escapeHtml(data.name)}</h2>
            <div class="lh16-statgrid"${gridStyle}>
                ${startTile}
                <div><div class="lh16-statlbl">Last Updated</div><div class="lh16-statval">${escapeHtml(data.lastUpdated)}</div></div>
            </div>
        </div>
    `;
}
