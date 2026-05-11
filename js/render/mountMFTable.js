/**
 * mountMFTable.js — Single MF table renderer for the whole project.
 *
 * Originated as table-lab/mount-mf-table.js. Promoted to js/render/ as
 * canonical home; the lab now imports from here.
 *
 * Implements all shared MF primitives internally:
 *   • sticky thead, sticky left cols (1 or 2), drop-shadow on sticky boundary
 *   • medal rows, avg summary row (sticky bottom), color gradients per col
 *   • sort, show-top-N (state preserved across re-sorts)
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

import { attachStickyShadow } from '../utils/stickyShadow.js';

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
    if (tableId) mountPoint.setAttribute('data-mf-table-id', tableId);
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
    wrapper.innerHTML = buildTableHTML(data, cols, summaryData, fontClass, medalRows, medalCounts, getRowClass, extents);

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

    // 10. Sort
    attachSort(wrapper, table, cols, data, summaryData, medalRows, medalCounts, getRowClass, extents, stickyCols, topNControls);

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

function buildTableHTML(data, cols, summaryData, fontClass, medalRows, medalCounts, getRowClass, extents) {
    const thead = buildThead(cols);
    const tbody = buildTbody(data, cols, summaryData, medalRows, medalCounts, getRowClass, extents);
    return `<table class="${fontClass}" data-sort-col="-1" data-sort-dir="desc">
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
            if (i < goldCount)                                   cls = 'rank-gold';
            else if (i < goldCount + silverCount)                cls = 'rank-silver';
            else if (i < goldCount + silverCount + bronzeCount)  cls = 'rank-bronze';
        }
        const callerClass = getRowClass ? getRowClass(row, i) : null;
        if (callerClass) cls = cls ? `${cls} ${callerClass}` : callerClass;

        return buildDataRow(row, cols, extents, cls);
    });

    if (summaryData) rows.push(buildSummaryRowHTML(summaryData, cols));

    return `<tbody>${rows.join('')}</tbody>`;
}

function buildDataRow(row, cols, extents, rowClass) {
    const cells = cols.map(col => {
        const raw = row[col.key];
        let display = raw == null ? '—' : raw === '' ? '' : (col.format ? col.format(raw, row) : raw);

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

function attachSort(wrapper, table, cols, data, summaryData, medalRows, medalCounts, getRowClass, extents, stickyCols, topNControls) {
    table.querySelectorAll('thead th[data-col]').forEach(th => {
        const colIdx = parseInt(th.dataset.col, 10);
        const col    = cols[colIdx];
        if (!col?.sortable) return;

        let sortCol = -1;
        let sortDir = 'asc';

        th.addEventListener('click', () => {
            if (sortCol === colIdx) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = colIdx;
                sortDir = 'asc';
            }

            table.querySelectorAll('thead th .sort-icon').forEach(icon => icon.textContent = '▲');
            table.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted'));
            th.classList.add('sorted');
            th.querySelector('.sort-icon').textContent = sortDir === 'asc' ? '▲' : '▼';

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
        });
    });
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
