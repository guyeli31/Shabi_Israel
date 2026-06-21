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

const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
}

/** Format "2026-04-01" → "1 Apr 2026"; "2026-04" → "Apr 2026". */
export function formatStartDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return iso;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = m[3] ? parseInt(m[3], 10) : null;
    const mn = MONTHS_SHORT[month - 1] || '';
    return day ? `${day} ${mn} ${year}` : `${mn} ${year}`;
}

/** Format a Last-Modified header value → "14 Apr 2026, 16:06". */
export function formatLastUpdated(headerVal) {
    if (!headerVal) return '';
    const d = new Date(headerVal);
    if (isNaN(d)) return headerVal;
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
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
export function buildLeagueHeaderData(params, lastModified) {
    const type = params.LeagueType || 'doubling';
    return {
        name: params.LeagueTitle || '',
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
 */
export function renderV13Header(target, data, opts = {}) {
    if (!target) return;
    const omit = opts.omitStartDate !== false;  // default true on the table-D page
    const items = [];
    if (!omit) items.push(`Started ${escapeHtml(data.startDate)}`);
    items.push(`Last updated ${escapeHtml(data.lastUpdated)}`);
    const meta = items.join(' <span class="sep">·</span> ');

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
