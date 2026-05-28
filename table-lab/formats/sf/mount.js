/**
 * mount.js — Canonical SF (Secondary Format) table renderer.
 *
 * Lives in the lab (table-lab/formats/sf/) as the single source of truth.
 * Production currently still renders SF tables by hand (landingPage.js,
 * playerGeneralPage.js) — Phase 7 of the table-lab unification plan will
 * rewire those call sites to `mountSFTable`.
 *
 * SF format (per docs/TABLE-DESIGN.md):
 *   • Card chrome: border + radius + padding + opaque surface
 *   • Optional <h3> title inside the card
 *   • Cell padding 0.45em 0.5em (em-based, matches MF)
 *   • border-collapse: separate; border-spacing: 0 (matches MF)
 *   • Optional sticky left columns (0..3) with JS-measured offsets for cols 2/3
 *   • MF-style drop-shadow on the rightmost sticky boundary during horizontal scroll
 *   • Optional Show-top-N toggle (button appended inside the card)
 *   • Sticky thead resolves against the card's internal scroll
 *   • Theme-token driven — no hard-coded colors
 *
 * What SF does NOT do (intentionally):
 *   • No click-to-sort (SF tables are rendered in a fixed semantic order)
 *   • No color gradients per column
 *   • No medal rows
 *   • No summary / avg-row
 *   If a future SF table needs any of these, port from MF.
 */

import { attachStickyShadow } from '../../../js/utils/stickyShadow.js';

/**
 * @param {HTMLElement} mountPoint  Empty container the caller owns; renderer rebuilds inside.
 * @param {object}      args        Table configuration.
 *
 * args:
 *   tableId    {string|null}                 Stable id for data-mf-table-id (e.g. 'A3','A4','A5','A6','C4').
 *   data       {object[]}                    Row objects.
 *   cols       {ColDef[]}                    Column descriptors (see below).
 *   title      {string|null}                 Optional <h3> rendered inside the card. null = no title element.
 *   fontClass  'font-small'|'font-large'     Default 'font-small'.
 *   stickyCols {0|1|2|3}                     Number of leftmost columns pinned. Default 0.
 *   showTopN   {number|null}                 If set, hide rows after N and show a toggle button. Default null.
 *
 * ColDef:
 *   key      {string}                        Property name on row objects.
 *   label    {string}                        Header text (may contain HTML).
 *   format   {(value,row)=>html|null}|null   Display formatter; null = raw.
 *   tdClass  {string|null}                   CSS class on every <td> in this column.
 */
export function mountSFTable(mountPoint, args) {
    const {
        tableId    = null,
        data       = [],
        cols       = [],
        title      = null,
        fontClass  = 'font-small',
        stickyCols = 0,
        showTopN   = null,
    } = args;

    mountPoint.innerHTML = '';
    if (tableId) mountPoint.setAttribute('data-mf-table-id', tableId);
    else         mountPoint.removeAttribute('data-mf-table-id');

    // Card → optional <h3> → wrapper (scroll context) → table.
    const card = document.createElement('div');
    card.className = 'achv-table-card';

    if (title) {
        const h = document.createElement('h3');
        h.innerHTML = title;
        card.appendChild(h);
    }

    const wrap = document.createElement('div');
    wrap.className = 'achv-table-wrapper';
    card.appendChild(wrap);

    const table = document.createElement('table');
    table.className = `achv-table ${fontClass}`;
    if (tableId) table.setAttribute('data-mf-table-id', tableId);
    table.innerHTML = buildThead(cols) + buildTbody(data, cols);
    wrap.appendChild(table);

    mountPoint.appendChild(card);

    if (stickyCols >= 2) {
        const measure = () => measureStickyCols(table, stickyCols);
        requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(measure).observe(table);
        }
    }

    attachStickyShadow(wrap);

    if (showTopN !== null) applyShowTopN(card, table, showTopN);

    return { card, wrap, table };
}

// ─────────────────────────────────────────────
// HTML builders
// ─────────────────────────────────────────────

function buildThead(cols) {
    const cells = cols.map(col => `<th scope="col">${col.label}</th>`).join('');
    return `<thead><tr>${cells}</tr></thead>`;
}

function buildTbody(data, cols) {
    if (data.length === 0) {
        return `<tbody><tr><td colspan="${cols.length}" class="na">No data</td></tr></tbody>`;
    }
    const rows = data.map(row => {
        const cells = cols.map(col => {
            const raw     = row[col.key];
            const display = col.format ? col.format(raw, row) : (raw == null ? '' : raw);
            const cls     = col.tdClass ? ` class="${col.tdClass}"` : '';
            return `<td${cls}>${display}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    });
    return `<tbody>${rows.join('')}</tbody>`;
}

// ─────────────────────────────────────────────
// Sticky col measurement (cols 2/3 offset)
// ─────────────────────────────────────────────

function measureStickyCols(table, stickyCols) {
    if (stickyCols >= 2) {
        const th1 = table.querySelector('thead th:nth-child(1)');
        if (th1) {
            const w = th1.getBoundingClientRect().width;
            if (w > 0) table.style.setProperty('--sf-col1-w', `${w}px`);
        }
    }
    if (stickyCols >= 3) {
        const th2 = table.querySelector('thead th:nth-child(2)');
        if (th2) {
            const w = th2.getBoundingClientRect().width;
            if (w > 0) table.style.setProperty('--sf-col2-w', `${w}px`);
        }
    }
}

// ─────────────────────────────────────────────
// Show top N
// ─────────────────────────────────────────────

function applyShowTopN(card, table, n) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return null;
    const totalRows = tbody.querySelectorAll('tr').length;
    if (totalRows <= n) return null;

    let isExpanded = false;
    function sync() {
        [...tbody.querySelectorAll('tr')].forEach((row, i) => {
            row.classList.toggle('table-row-hidden', !isExpanded && i >= n);
        });
    }
    sync();

    const btn = document.createElement('button');
    btn.className   = 'show-more-btn';
    btn.textContent = `Show all (${totalRows})`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        sync();
        btn.textContent = isExpanded ? `Show top ${n}` : `Show all (${totalRows})`;
    });
    card.appendChild(btn);
    return { sync };
}
