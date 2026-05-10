/**
 * mount-mf-table.js — The single MF table "function".
 *
 * Implements ALL shared MF principles internally:
 *   • border-collapse: separate / border-spacing: 0  (via CSS in lab.css + components.css)
 *   • row hairlines  (via global tbody td rule in components.css)
 *   • sticky thead   (via global thead rule in components.css)
 *   • sticky left cols  (applied per-cell here in JS)
 *   • sticky col measurement  (--sticky-col-1-width written to wrapper)
 *   • drop-shadow on sticky boundary, only during horizontal scroll  (attachStickyShadow)
 *   • hover  (via global tbody tr:hover rule in components.css)
 *   • medal rows  (rank-gold / rank-silver / rank-bronze classes)
 *   • avg summary row  (tr.avg-row — sticky bottom via global CSS rule)
 *   • column color gradient  (colorScale per col descriptor)
 *   • sort  (click on th)
 *   • show top N  (with Show All toggle)
 *
 * Caller only provides what is UNIQUE to the table (args).
 */

import { attachStickyShadow } from '../js/utils/stickyShadow.js';
import { colorForValue, colorForValueInverted } from '../js/compute/colorScale.js';

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * @param {HTMLElement} wrapper   — .mf-wrap div (already in DOM, will be populated)
 * @param {object}      args      — table arguments (see below)
 *
 * args:
 *   data        {object[]}   row objects
 *   cols        {ColDef[]}   column descriptors
 *   summary     {object|null} avg row data object (same shape as data row), or null
 *   fontClass   {'font-small'|'font-large'}   default: 'font-small'
 *   stickyCols  {0|1|2}      how many left columns are pinned, default: 1
 *   medalRows   {boolean}    gold/silver/bronze tints on rows 1–3, default: false
 *   showTopN    {number|null} hide rows after N + show "Show all" btn; null = show all
 *   mfWidth     {string|null} CSS width on wrapper (e.g. '70%'), null = auto
 *   mfMb        {string|null} CSS margin-bottom on wrapper, null = default
 *   mfBg        {string|null} CSS background on wrapper, null = transparent
 *
 * ColDef:
 *   key         {string}     property name in data row
 *   label       {string}     column header text
 *   type        {'number'|'string'}
 *   sortable    {boolean}
 *   colorScale  {'good-to-bad'|'bad-to-good'|null}
 *   format      {function|null}  value → display string
 */
export function mountMFTable(wrapper, args) {
    const {
        data       = [],
        cols       = [],
        summary    = null,
        fontClass  = 'font-small',
        stickyCols = 1,
        medalRows  = false,
        showTopN   = null,
        mfWidth    = null,
        mfMb       = null,
        mfBg       = null,
        flagSize = null,
    } = args;

    // 1. Apply CSS variable args onto the wrapper
    wrapper.style.removeProperty('--mf-width');
    wrapper.style.removeProperty('--mf-mb');
    wrapper.style.removeProperty('--mf-bg');
    wrapper.style.removeProperty('--mf-flag-height');
    if (mfWidth)  wrapper.style.setProperty('--mf-width', mfWidth);
    if (mfMb)     wrapper.style.setProperty('--mf-mb', mfMb);
    if (mfBg)     wrapper.style.setProperty('--mf-bg', mfBg);
    if (flagSize) wrapper.style.setProperty('--mf-flag-height', flagSize);

    // 2. Compute column extents for color scales
    const extents = computeExtents(data, cols);

    // 3. Build + inject table HTML
    wrapper.innerHTML = buildTableHTML(data, cols, summary, fontClass, medalRows, extents);

    const table = wrapper.querySelector('table');

    // 4. Apply sticky left columns (position/left/z-index/background per cell)
    if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);

    // 5. Measure + keep sticky col-2 offset updated (only when 2 sticky cols)
    if (stickyCols >= 2) {
        const measure = () => measureStickyCols(wrapper, table);
        measure();
        window.addEventListener('resize', measure);
        if (typeof ResizeObserver !== 'undefined')
            new ResizeObserver(measure).observe(table);
    }

    // 6. Drop-shadow on sticky boundary — appears ONLY during horizontal scroll
    attachStickyShadow(wrapper);

    // 7. Sorting
    attachSort(wrapper, table, cols, data, summary, fontClass, medalRows, extents, stickyCols);

    // 8. Show top N
    if (showTopN !== null) applyShowTopN(wrapper, table, showTopN);
}

// ─────────────────────────────────────────────
// HTML builder
// ─────────────────────────────────────────────

function buildTableHTML(data, cols, summary, fontClass, medalRows, extents) {
    const thead = buildThead(cols);
    const tbody = buildTbody(data, cols, summary, medalRows, extents);
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

function buildTbody(data, cols, summary, medalRows, extents) {
    const goldCount   = medalRows ? 1 : 0;
    const silverCount = medalRows ? 1 : 0;
    const bronzeCount = medalRows ? 3 : 0;

    const rows = data.map((row, i) => {
        let cls = '';
        if (medalRows) {
            if (i < goldCount)                              cls = 'rank-gold';
            else if (i < goldCount + silverCount)           cls = 'rank-silver';
            else if (i < goldCount + silverCount + bronzeCount) cls = 'rank-bronze';
        }
        // Support arbitrary extra row classes via _rowClass (e.g. 'unplayed')
        if (row._rowClass) cls = cls ? `${cls} ${row._rowClass}` : row._rowClass;
        return buildDataRow(row, cols, extents, cls);
    });

    if (summary) rows.push(buildSummaryRow(summary, cols));

    return `<tbody>${rows.join('')}</tbody>`;
}

function buildDataRow(row, cols, extents, rowClass) {
    const cells = cols.map((col, i) => {
        const raw = row[col.key];
        // null → '—'  |  '' → empty cell (used for unplayed rows)
        let display = raw == null ? '—' : raw === '' ? '' : (col.format ? col.format(raw, row) : raw);
        // Bold max and min values when col has boldExtreme
        if (col.boldExtreme && typeof raw === 'number' && extents[col.key]) {
            const { min, max } = extents[col.key];
            if (raw === min || raw === max) display = `<b>${display}</b>`;
        }
        const style = getCellColorStyle(col, raw, extents);
        const cls = col.tdClass ? ` class="${col.tdClass}"` : '';
        return `<td${cls}${style ? ` style="${style}"` : ''}>${display}</td>`;
    }).join('');
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>${cells}</tr>`;
}

function buildSummaryRow(summary, cols) {
    const cells = cols.map(col => {
        const raw = summary[col.key];
        // Values in summary are pre-formatted strings — render as-is, no col.format
        const display = raw == null || raw === '' ? '' : String(raw);
        const cls = col.tdClass ? ` class="${col.tdClass}"` : '';
        return `<td${cls}>${display}</td>`;
    }).join('');
    return `<tr class="avg-row">${cells}</tr>`;
}

function getCellColorStyle(col, value, extents) {
    if (!col.colorScale || value == null || typeof value !== 'number') return '';
    const { min, max } = extents[col.key] || {};
    if (min == null) return '';
    const color = col.colorScale === 'good-to-bad'
        ? colorForValue(value, min, max)
        : colorForValueInverted(value, min, max);
    return `color:${color}`;
}

// ─────────────────────────────────────────────
// Sticky left columns
// ─────────────────────────────────────────────

function applyStickyLeftCols(table, stickyCols) {
    const rows = [...table.querySelectorAll('thead tr, tbody tr')];
    rows.forEach(row => {
        const cells = [...row.querySelectorAll('th, td')];
        for (let c = 0; c < stickyCols && c < cells.length; c++) {
            const cell = cells[c];
            const isLastSticky = (c === stickyCols - 1);
            const inThead = cell.tagName === 'TH';

            cell.style.position = 'sticky';
            cell.style.left = c === 0 ? '0' : 'var(--sticky-col-1-width, 0px)';
            // z-index only — background is intentionally left to CSS so that
            // medal tints, hover, and avg-row can override it via normal cascade.
            cell.style.zIndex = inThead ? '4' : (row.classList.contains('avg-row') ? '3' : '2');

            // Mark last sticky col for the drop-shadow CSS rule
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
    if (w > 0) wrapper.style.setProperty('--sticky-col-1-width', w + 'px');
}

// ─────────────────────────────────────────────
// Sort
// ─────────────────────────────────────────────

function attachSort(wrapper, table, cols, data, summary, fontClass, medalRows, extents, stickyCols) {
    let sortCol = -1;
    let sortDir = 'asc';

    table.querySelectorAll('thead th[data-col]').forEach(th => {
        const colIdx = parseInt(th.dataset.col, 10);
        const col = cols[colIdx];
        if (!col?.sortable) return;

        th.addEventListener('click', () => {
            if (sortCol === colIdx) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = colIdx;
                sortDir = 'asc';
            }

            // Update sort icon
            table.querySelectorAll('thead th .sort-icon').forEach(icon => icon.textContent = '▲');
            table.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted'));
            th.classList.add('sorted');
            th.querySelector('.sort-icon').textContent = sortDir === 'asc' ? '▲' : '▼';

            // Sort data
            const sorted = [...data].sort((a, b) => {
                // col.sortKey(row) overrides raw value for custom orderings (e.g. result WIN/LOSS)
                const va = col.sortKey ? col.sortKey(a) : a[col.key];
                const vb = col.sortKey ? col.sortKey(b) : b[col.key];

                if (va == null && vb == null) return 0;
                if (va == null) return 1;
                if (vb == null) return -1;
                if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'en') : vb.localeCompare(va, 'en');
                return sortDir === 'asc' ? va - vb : vb - va;
            });

            // Rebuild tbody (keep avg-row at bottom)
            const tbody = table.querySelector('tbody');
            const newExtents = computeExtents(sorted, cols);
            tbody.innerHTML = buildTbody(sorted, cols, summary, medalRows, newExtents)
                .replace(/^<tbody>|<\/tbody>$/g, '');

            // Re-apply sticky
            if (stickyCols > 0) applyStickyLeftCols(table, stickyCols);
            if (stickyCols >= 2) measureStickyCols(wrapper, table);
        });
    });
}

// ─────────────────────────────────────────────
// Show top N
// ─────────────────────────────────────────────

function applyShowTopN(wrapper, table, n) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    // Exclude avg-row from the count
    const rows = [...tbody.querySelectorAll('tr:not(.avg-row)')];
    if (rows.length <= n) return;

    rows.forEach((row, i) => {
        if (i >= n) row.classList.add('table-row-hidden');
    });

    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `Show all (${rows.length})`;
    btn.addEventListener('click', () => {
        const isCollapsed = rows[n]?.classList.contains('table-row-hidden');
        rows.forEach((row, i) => {
            if (i >= n) row.classList.toggle('table-row-hidden', !isCollapsed);
        });
        btn.textContent = isCollapsed ? `Show top ${n}` : `Show all (${rows.length})`;
    });

    wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function computeExtents(data, cols) {
    const extents = {};
    cols.forEach(col => {
        if (!col.colorScale) return;
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
