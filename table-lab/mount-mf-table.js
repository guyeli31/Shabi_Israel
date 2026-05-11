/**
 * mount-mf-table.js — The single MF table renderer.
 *
 * Implements ALL shared MF principles internally:
 *   • border-collapse: separate / border-spacing: 0  (via CSS)
 *   • row hairlines  (via global tbody td rule)
 *   • sticky thead   (via global thead rule)
 *   • sticky left cols  (applied per-cell in JS)
 *   • sticky col measurement  (--sticky-col-1-width written to wrapper)
 *   • drop-shadow on sticky boundary during horizontal scroll  (attachStickyShadow)
 *   • hover  (via global tbody tr:hover rule)
 *   • medal rows  (rank-gold / rank-silver / rank-bronze classes)
 *   • avg summary row  (tr.avg-row — sticky bottom via global CSS rule)
 *   • column color gradient  (colorFn per col descriptor)
 *   • sort  (click on th)
 *   • show top N  (with Show All toggle — state preserved across re-sorts)
 *
 * Caller provides only what is UNIQUE to the table (args).
 * All per-table logic (row classes, summary calculation, cell colors)
 * is passed as functions — the renderer calls them at the right moment.
 */

import { attachStickyShadow } from '../js/utils/stickyShadow.js';

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * @param {HTMLElement} mountPoint  — plain empty container the caller owns;
 *                                   the function creates all DOM inside it.
 * @param {object}      args        — table configuration (see below)
 *
 * args:
 *   data            {object[]}          row objects
 *   cols            {ColDef[]}          column descriptors
 *   fontClass       {'font-small'|'font-large'}   default: 'font-small'
 *   stickyCols      {0|1|2}            how many left columns are pinned
 *   medalRows       {boolean}          gold/silver/bronze tints on rows
 *   medalCounts     {{gold,silver,bronze}}  row counts per medal tier; default 1/1/1
 *   showTopN        {number|null}      hide rows after N; null = show all
 *   mfWidth         {string|null}      CSS width on wrapper, null = auto
 *   mfMb            {string|null}      CSS margin-bottom on wrapper
 *   mfBg            {string|null}      CSS background on wrapper
 *   flagSize        {string|null}      CSS height for flag images
 *   getRowClass     {function|null}    (row, index) => string|null — extra row class
 *   buildSummaryRow {function|null}    (data) => object — summary row data
 *
 * ColDef:
 *   key         {string}
 *   label       {string}
 *   type        {'number'|'string'}
 *   sortable    {boolean}
 *   colorFn     {function|null}   (value, min, max) => CSS color string
 *   format      {function|null}   (value, row) => display HTML string
 *   tdClass     {string|null}
 *   sortKey     {function|null}   (row) => sort value override
 *   boldExtreme {boolean}         bold min and max numeric values
 */
export function mountMFTable(mountPoint, args) {
    const {
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

    // 1. Create fresh wrapper inside mountPoint (replaces external wrapper pattern)
    mountPoint.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mf-wrap';
    mountPoint.appendChild(wrapper);

    // 2. Apply CSS variable args onto the wrapper
    if (mfWidth)  wrapper.style.setProperty('--mf-width', mfWidth);
    if (mfMb)     wrapper.style.setProperty('--mf-mb', mfMb);
    if (mfBg)     wrapper.style.setProperty('--mf-bg', mfBg);
    if (flagSize) wrapper.style.setProperty('--mf-flag-height', flagSize);

    // 3. Compute column extents for colorFn (min/max per column across all rows)
    const extents = computeExtents(data, cols);

    // 4. Compute summary row data if caller provided a builder function
    const summaryData = buildSummaryRow ? buildSummaryRow(data) : null;

    // 5. Build + inject table HTML
    wrapper.innerHTML = buildTableHTML(data, cols, summaryData, fontClass, medalRows, medalCounts, getRowClass, extents);

    const table = wrapper.querySelector('table');

    // 6. Apply sticky left columns (position/left/z-index per cell)
    if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);

    // 7. Measure + keep sticky col-2 offset updated (only when 2 sticky cols)
    if (stickyCols >= 2) {
        const measure = () => measureStickyCols(wrapper, table);
        measure();
        window.addEventListener('resize', measure);
        if (typeof ResizeObserver !== 'undefined')
            new ResizeObserver(measure).observe(table);
    }

    // 8. Drop-shadow on sticky boundary — only during horizontal scroll
    attachStickyShadow(wrapper);

    // 9. Show top N — set up controls first so sort can re-sync collapsed state
    const topNControls = showTopN !== null ? applyShowTopN(mountPoint, table, showTopN) : null;

    // 10. Sorting — receives topNControls to preserve collapsed/expanded after each sort
    attachSort(wrapper, table, cols, data, summaryData, medalRows, medalCounts, getRowClass, extents, stickyCols, topNControls);
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
        // Divider row — spans all columns with a single <td colspan>
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

        // Bold extreme (min/max) values when col has boldExtreme
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

// Renders summary row — values are pre-formatted strings, no col.format applied
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
            // z-index only — background left to CSS so medal tints, hover, avg-row cascade normally
            cell.style.zIndex   = inThead ? '4' : (row.classList.contains('avg-row') ? '3' : '2');

            if (isLastSticky) cell.classList.add('sticky-last');
        }
    });
}

// ─────────────────────────────────────────────
// Sticky col measurement
// ─────────────────────────────────────────────

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

            // Update sort icons
            table.querySelectorAll('thead th .sort-icon').forEach(icon => icon.textContent = '▲');
            table.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted'));
            th.classList.add('sorted');
            th.querySelector('.sort-icon').textContent = sortDir === 'asc' ? '▲' : '▼';

            // Sort data
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

            // Rebuild tbody (summary row stays at bottom)
            const tbody      = table.querySelector('tbody');
            const newExtents = computeExtents(sorted, cols);
            tbody.innerHTML  = buildTbody(sorted, cols, summaryData, medalRows, medalCounts, getRowClass, newExtents)
                .replace(/^<tbody>|<\/tbody>$/g, '');

            // Re-apply sticky
            if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);
            if (stickyCols >= 2) measureStickyCols(wrapper, table);

            // Re-sync Show Top N collapsed/expanded state
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

    // Re-queries tbody on every call so it works after sort rebuilds
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
