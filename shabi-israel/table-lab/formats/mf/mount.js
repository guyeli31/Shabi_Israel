/**
 * mount.js — Canonical MF table renderer.
 *
 * Lives in the lab (table-lab/formats/mf/) as the single source of truth.
 * Production imports through js/render/mountMFTable.js (re-export shim).
 *
 * Implements all shared MF primitives internally:
 *   • sticky left cols (1 or 2), drop-shadow on sticky boundary
 *   • medal rows, avg summary row, color gradients per col
 *   • sort, show-top-N (state preserved across re-sorts)
 *
 * Vertical sticky (thead top:0 / avg-row bottom:0) was removed for D and E —
 * those tables now scroll with the page; only horizontal sticky cols remain.
 *
 * External config infrastructure (for typo-editor & friends):
 *   • Pass `tableId` — wrapper gets [data-mf-table-id="<id>"] so external CSS
 *     can target one table by id without touching the renderer.
 *   • Each mounted table is recorded in window.__mfTableRegistry__ so
 *     typo-editor can discover live mounts and offer per-table font/width
 *     overrides. Entry shape:
 *       { id, mountPoint, wrapper, table, args }
 *   • Width: `mfWidth` arg writes `--mf-width` on the wrapper. Typo-editor can
 *     also override via CSS rule `[data-mf-table-id="D"] .mf-wrap { --mf-width: 75%; }`.
 *   • Font-size: pass `fontClass` ('font-small' | 'font-large'). Typo-editor
 *     can override via `[data-mf-table-id="D"] table { font-size: <value>; }`
 *     in css/typography-overrides.css.
 */

import { attachStickyShadow } from '../../../js/utils/stickyShadow.js';

// Public registry of mounted MF tables, keyed by tableId. Each entry:
//   { id, mountPoint, wrapper, table, args }
// External tools (typo-editor, audit scripts) can read this to enumerate
// live tables and target them by id.
if (typeof window !== 'undefined' && !window.__mfTableRegistry__) {
    window.__mfTableRegistry__ = new Map();
}

/**
 * @param {HTMLElement} mountPoint  Container the caller owns; renderer rebuilds inside.
 * @param {object}      args        Table configuration.
 *
 * args:
 *   tableId         {string|null}     Stable id for external CSS targeting & registry. e.g. 'D', 'E', 'A1'.
 *   data            {object[]}        Row objects.
 *   cols            {ColDef[]}        Column descriptors.
 *   fontClass       {'font-small'|'font-large'}   Default 'font-small'. Acts as base; typo-editor can override.
 *   stickyCols      {0|1|2}           How many left columns are pinned.
 *   medalRows       {boolean}         Gold/silver/bronze tints on rows.
 *   medalCounts     {{gold,silver,bronze}}  Default 1/1/1.
 *   showTopN        {number|null}     Hide rows after N (null = show all).
 *   mfWidth         {string|null}     CSS width on wrapper, null = auto.
 *   mfMb            {string|null}     CSS margin-bottom on wrapper.
 *   mfBg            {string|null}     CSS background on wrapper.
 *   flagSize        {string|null}     CSS height for flag images.
 *   getRowClass     {function|null}   (row, index) => string|null.
 *   buildSummaryRow {function|null}   (data) => object — summary row data.
 *   (Sort handover) — When `tableId` is set, mountMFTable reads (and clears)
 *                     sessionStorage[`mf-sort-pending-${tableId}`] on mount.
 *                     If a `{ colKey, dir }` entry exists, it's applied as the
 *                     initial sort. The renderer never *writes* to this key —
 *                     callers (e.g. league/player nav arrows) write it just
 *                     before navigating so the next mount picks it up. This
 *                     makes sort handover opt-in *per navigation path*: only
 *                     paths that explicitly stash the sort carry it across.
 *                     Other entries (search, breadcrumb, fresh load) get the
 *                     preset's default sort.
 *
 * ColDef:
 *   key, label, type, sortable, colorFn, format, tdClass, sortKey, boldExtreme
 */
export function mountMFTable(mountPoint, args) {
    const {
        tableId         = null,
        data            = [],
        cols            = [],
        fontClass       = 'font-small',
        fontItalic      = false,
        stickyCols      = 1,
        medalRows       = false,
        medalCounts     = { gold: 1, silver: 1, bronze: 1 },
        showTopN        = null,
        mfWidth         = null,
        mfMb            = null,
        mfBg            = null,
        flagSize        = null,
        getRowClass     = null,
        buildSummaryRow = null,
    } = args;

    // 1. Fresh wrapper
    mountPoint.innerHTML = '';
    // Always reset the data attribute — leaving a stale id from a previous
    // mount lets the next preset accidentally inherit the prior preset's
    // CSS scope (e.g. sticky rules keyed off [data-mf-table-id]).
    if (tableId) mountPoint.setAttribute('data-mf-table-id', tableId);
    else         mountPoint.removeAttribute('data-mf-table-id');
    const wrapper = document.createElement('div');
    wrapper.className = 'mf-wrap';
    if (tableId) wrapper.setAttribute('data-mf-table-id', tableId);
    mountPoint.appendChild(wrapper);

    // 2. CSS variable args
    if (mfWidth)  wrapper.style.setProperty('--mf-width', mfWidth);
    if (mfMb)     wrapper.style.setProperty('--mf-mb', mfMb);
    if (mfBg)     wrapper.style.setProperty('--mf-bg', mfBg);
    if (flagSize) wrapper.style.setProperty('--mf-flag-height', flagSize);

    // 3. Extents for color gradients
    const extents = computeExtents(data, cols);

    // 4. Optional summary row data
    const summaryData = buildSummaryRow ? buildSummaryRow(data) : null;

    // 5. Build + inject HTML
    wrapper.innerHTML = buildTableHTML(data, cols, summaryData, fontClass, fontItalic, medalRows, medalCounts, getRowClass, extents);

    const table = wrapper.querySelector('table');
    if (tableId) table.setAttribute('data-mf-table-id', tableId);

    // 6. Sticky left columns
    if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);

    // 7. Sticky col-2 offset measurement
    if (stickyCols >= 2) {
        const measure = () => measureStickyCols(wrapper, table);
        measure();
        window.addEventListener('resize', measure);
        if (typeof ResizeObserver !== 'undefined')
            new ResizeObserver(measure).observe(table);
    }

    // 8. Drop-shadow on sticky boundary during horizontal scroll
    attachStickyShadow(wrapper);

    // 9. Show-top-N
    const topNControls = showTopN !== null ? applyShowTopN(mountPoint, table, showTopN) : null;

    // 10. Sort + one-shot pending-sort handover.
    //     If sessionStorage holds a `mf-sort-pending-${tableId}` entry, consume
    //     it (read + delete) and apply as the initial sort. Callers stash this
    //     entry just before navigating between linked surfaces (e.g. D/E nav
    //     arrows). One-shot semantics — the next non-handover mount falls back
    //     to the preset's default.
    const initialSort = (tableId) ? consumePendingSort(`mf-sort-pending-${tableId}`) : null;
    attachSort(
        wrapper, table, cols, data, summaryData, medalRows, medalCounts,
        getRowClass, extents, stickyCols, topNControls,
        initialSort
    );

    // 11. Register
    if (tableId && typeof window !== 'undefined') {
        window.__mfTableRegistry__.set(tableId, { id: tableId, mountPoint, wrapper, table, args });
    }

    return { wrapper, table };
}

/**
 * List all currently-mounted MF tables. External tools (typo-editor) call
 * this to discover available tables and offer per-table overrides.
 */
export function listMountedMFTables() {
    if (typeof window === 'undefined' || !window.__mfTableRegistry__) return [];
    return [...window.__mfTableRegistry__.values()];
}

// ─────────────────────────────────────────────
// HTML builder
// ─────────────────────────────────────────────

function buildTableHTML(data, cols, summaryData, fontClass, fontItalic, medalRows, medalCounts, getRowClass, extents) {
    const thead    = buildThead(cols);
    const tbody    = buildTbody(data, cols, summaryData, medalRows, medalCounts, getRowClass, extents);
    const tablecls = fontItalic ? `${fontClass} font-italic` : fontClass;
    return `<table class="${tablecls}" data-sort-col="-1" data-sort-dir="desc">
${thead}
${tbody}
</table>`;
}

function buildThead(cols) {
    const cells = cols.map((col, i) => {
        const sortAttr = col.sortable ? `data-col="${i}"` : `data-col="${i}" style="cursor:default"`;
        const icon = col.sortable ? ' <span class="sort-icon">&#x25B2;</span>' : '';
        return `<th scope="col" ${sortAttr}>${col.label}${icon}</th>`;
    }).join('');
    return `<thead><tr>${cells}</tr></thead>`;
}

function buildTbody(data, cols, summaryData, medalRows, medalCounts, getRowClass, extents) {
    const goldCount   = medalRows ? (medalCounts.gold   ?? 1) : 0;
    const silverCount = medalRows ? (medalCounts.silver ?? 1) : 0;
    const bronzeCount = medalRows ? (medalCounts.bronze ?? 1) : 0;

    const rows = data.map((row, i) => {
        if (row._divider) {
            const dividerClass = row._dividerClass || 'mf-divider';
            const text = row._dividerText || '';
            return `<tr class="${dividerClass}"><td colspan="${cols.length}">${text}</td></tr>`;
        }

        let cls = '';
        if (medalRows) {
            // Use row.rank when available so medal tint follows the player during sort,
            // not the visual position. Fall back to position for tables without a rank field.
            const rankForMedal = typeof row.rank === 'number' ? row.rank : i + 1;
            if (rankForMedal <= goldCount)                                      cls = 'rank-gold';
            else if (rankForMedal <= goldCount + silverCount)                   cls = 'rank-silver';
            else if (rankForMedal <= goldCount + silverCount + bronzeCount)     cls = 'rank-bronze';
        }
        const callerClass = getRowClass ? getRowClass(row, i) : null;
        if (callerClass) cls = cls ? `${cls} ${callerClass}` : callerClass;

        return buildDataRow(row, cols, extents, cls, i);
    });

    if (summaryData) rows.push(buildSummaryRowHTML(summaryData, cols));

    return `<tbody>${rows.join('')}</tbody>`;
}

function buildDataRow(row, cols, extents, rowClass, rowIndex = 0) {
    const cells = cols.map(col => {
        const raw = row[col.key];
        let display = raw == null ? '—' : raw === '' ? '' : (col.format ? col.format(raw, row, rowIndex) : raw);

        if (col.boldExtreme && typeof raw === 'number' && extents[col.key]) {
            const { min, max } = extents[col.key];
            if (raw === min || raw === max) display = `<b>${display}</b>`;
        }

        const style = getCellColorStyle(col, raw, extents);
        const cls   = col.tdClass ? ` class="${col.tdClass}"` : '';
        return `<td${cls}${style ? ` style="${style}"` : ''}>${display}</td>`;
    }).join('');
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>${cells}</tr>`;
}

function buildSummaryRowHTML(summary, cols) {
    const cells = cols.map(col => {
        const raw     = summary[col.key];
        const display = raw == null || raw === '' ? '' : String(raw);
        const cls     = col.tdClass ? ` class="${col.tdClass}"` : '';
        return `<td${cls}>${display}</td>`;
    }).join('');
    return `<tr class="avg-row">${cells}</tr>`;
}

function getCellColorStyle(col, value, extents) {
    if (!col.colorFn || value == null || typeof value !== 'number') return '';
    const { min, max } = extents[col.key] || {};
    if (min == null) return '';
    return `color:${col.colorFn(value, min, max)}`;
}

// ─────────────────────────────────────────────
// Sticky left columns
// ─────────────────────────────────────────────

function applyStickyLeftCols(table, stickyCols) {
    const rows = [...table.querySelectorAll('thead tr, tbody tr')];
    rows.forEach(row => {
        const cells = [...row.querySelectorAll('th, td')];
        for (let c = 0; c < stickyCols && c < cells.length; c++) {
            const cell        = cells[c];
            const isLastSticky = (c === stickyCols - 1);
            const inThead     = cell.tagName === 'TH';

            cell.style.position = 'sticky';
            cell.style.left     = c === 0 ? '0' : 'var(--sticky-col-1-width, 0px)';
            cell.style.zIndex   = inThead ? '4' : (row.classList.contains('avg-row') ? '3' : '2');

            if (isLastSticky) cell.classList.add('sticky-last');
        }
    });
}

function measureStickyCols(wrapper, table) {
    const th1 = table.querySelector('thead th:first-child');
    if (!th1) return;
    const w = th1.getBoundingClientRect().width;
    if (w > 0) wrapper.style.setProperty('--sticky-col-1-width', `${w}px`);
}

// ─────────────────────────────────────────────
// Sort
// ─────────────────────────────────────────────

function attachSort(
    wrapper, table, cols, data, summaryData, medalRows, medalCounts,
    getRowClass, extents, stickyCols, topNControls,
    initialSort = null
) {
    // Single shared sort closure — drives click handlers AND the optional
    // initial-sort restoration from a one-shot pending entry. Tracks the
    // active state so subsequent clicks on the same column flip the direction
    // correctly. The current sort (key + dir) is mirrored to the <table>
    // element via dataset attrs so external code (nav arrows) can read it
    // to hand the sort over to the next page.
    let sortCol = -1;
    let sortDir = 'asc';

    function runSort(colIdx, dir) {
        const col = cols[colIdx];
        if (!col || !col.sortable) return;

        sortCol = colIdx;
        sortDir = dir === 'desc' ? 'desc' : 'asc';

        table.dataset.sortColKey = col.key;
        table.dataset.sortDir    = sortDir;

        const th = table.querySelector(`thead th[data-col="${colIdx}"]`);
        table.querySelectorAll('thead th .sort-icon').forEach(icon => icon.textContent = '▲');
        table.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted'));
        if (th) {
            th.classList.add('sorted');
            const ic = th.querySelector('.sort-icon');
            if (ic) ic.textContent = sortDir === 'asc' ? '▲' : '▼';
        }

        const sorted = [...data].sort((a, b) => {
            const va = col.sortKey ? col.sortKey(a) : a[col.key];
            const vb = col.sortKey ? col.sortKey(b) : b[col.key];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'string') return sortDir === 'asc'
                ? va.localeCompare(vb, 'en')
                : vb.localeCompare(va, 'en');
            return sortDir === 'asc' ? va - vb : vb - va;
        });

        const tbody      = table.querySelector('tbody');
        const newExtents = computeExtents(sorted, cols);
        tbody.innerHTML  = buildTbody(sorted, cols, summaryData, medalRows, medalCounts, getRowClass, newExtents)
            .replace(/^<tbody>|<\/tbody>$/g, '');

        if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);
        if (stickyCols >= 2) measureStickyCols(wrapper, table);

        if (topNControls) topNControls.syncHiddenRows();
    }

    // Click handlers — flip-on-repeat. No session writes here; the click
    // updates the live table state, and any handover key is written by
    // the navigation surface (nav-arrow click) just before unload.
    table.querySelectorAll('thead th[data-col]').forEach(th => {
        const colIdx = parseInt(th.dataset.col, 10);
        const col    = cols[colIdx];
        if (!col?.sortable) return;

        th.addEventListener('click', () => {
            const nextDir = (sortCol === colIdx)
                ? (sortDir === 'asc' ? 'desc' : 'asc')
                : 'asc';
            runSort(colIdx, nextDir);
        });
    });

    // Apply the one-shot initial sort, if any was handed over from a previous
    // page. Match by col.key so a preset whose column set changes between
    // mounts (e.g. UBC vs Doubling) silently drops sorts that don't apply to
    // the new shape.
    if (initialSort && initialSort.colKey) {
        const restoreIdx = cols.findIndex(c => c.sortable && c.key === initialSort.colKey);
        if (restoreIdx >= 0) runSort(restoreIdx, initialSort.dir || 'asc');
    }
}

// ─────────────────────────────────────────────
// Pending-sort handover (sessionStorage, one-shot)
// ─────────────────────────────────────────────

function consumePendingSort(key) {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        sessionStorage.removeItem(key);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.colKey !== 'string') return null;
        return { colKey: parsed.colKey, dir: parsed.dir === 'desc' ? 'desc' : 'asc' };
    } catch { return null; }
}

// ─────────────────────────────────────────────
// Show top N
// ─────────────────────────────────────────────

function applyShowTopN(mountPoint, table, n) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return null;
    const totalRows = [...tbody.querySelectorAll('tr:not(.avg-row)')].length;
    if (totalRows <= n) return null;

    let isExpanded = false;

    function syncHiddenRows() {
        const rows = [...tbody.querySelectorAll('tr:not(.avg-row)')];
        rows.forEach((row, i) => row.classList.toggle('table-row-hidden', !isExpanded && i >= n));
    }

    syncHiddenRows();

    const btn = document.createElement('button');
    btn.className   = 'show-more-btn';
    btn.textContent = `Show all (${totalRows})`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        syncHiddenRows();
        btn.textContent = isExpanded ? `Show top ${n}` : `Show all (${totalRows})`;
    });

    mountPoint.appendChild(btn);
    return { syncHiddenRows };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function computeExtents(data, cols) {
    const extents = {};
    cols.forEach(col => {
        if (!col.colorFn) return;
        let min = Infinity, max = -Infinity;
        data.forEach(row => {
            const v = row[col.key];
            if (typeof v === 'number' && !isNaN(v)) {
                if (v < min) min = v;
                if (v > max) max = v;
            }
        });
        if (min !== Infinity) extents[col.key] = { min, max };
    });
    return extents;
}
