/**
 * mount.js — Canonical exp (Expandable Format) table renderer.
 *
 * Lives in the lab (table-lab/formats/exp/) as the single source of truth.
 * Production currently still renders C0 by hand (playerGeneralPage.js
 * renderRankTable + applyC0StickyAndScroll) — Phase 7 of the table-lab
 * unification plan will rewire to `mountExpTable`.
 *
 * exp format (per docs/TABLE-DESIGN.md):
 *   • Mount point is owned by the caller (typically the visible expansion
 *     container e.g. .pg-rank-expanded — width:fit-content + margin:auto).
 *   • Single scroll context (.pg-rank-table-wrap) for BOTH axes — so sticky
 *     thead (top:0) and sticky cols (left:0) resolve against the same element.
 *   • Table is `width: max-content` — sum of column intrinsic widths
 *     (content + em-based padding), no excess distributed to the widest col.
 *   • Cell padding 0.45em 0.5em (em-based, matches MF).
 *   • border-collapse: separate; border-spacing: 0 (matches MF).
 *   • Always sticky thead and sticky 2 leftmost cols.
 *   • Theme-aware self-row highlight via --color-accent-light.
 *   • Self row is scroll-centered within the wrap on mount.
 *   • MF-style drop-shadow on the rightmost sticky boundary during horizontal scroll.
 */

import { attachStickyShadow } from '../../../js/utils/stickyShadow.js';

/**
 * @param {HTMLElement} mountPoint  Caller-owned container; renderer rebuilds inside.
 *                                  Typically positioned + sized externally
 *                                  (e.g. via .pg-rank-expanded { width: fit-content; margin: 0 auto }).
 * @param {object}      args        Table configuration.
 *
 * args:
 *   tableId     {string|null}                    Stable id for data-mf-table-id (e.g. 'C0').
 *   data        {object[]}                       Row objects.
 *   cols        {ColDef[]}                       Column descriptors (see below).
 *   selfKey     {string|null}                    Row field whose value identifies the "self" row. e.g. 'name'.
 *   selfValue   {*}                              Value to match against row[selfKey]. e.g. playerName.
 *                                                If selfKey or selfValue is null, no row is highlighted.
 *   fontClass   'font-small'|'font-large'        Default 'font-small'.
 *   stickyCols  {0|1|2}                          Number of leftmost cols pinned. Default 2.
 *
 * ColDef:
 *   key      {string}                            Property name on row objects.
 *   label    {string}                            Header text (may contain HTML).
 *   format   {(value,row)=>html|null}|null       Display formatter; null = raw.
 *   tdClass  {string|null}                       CSS class on every <td> in this column.
 */
export function mountExpTable(mountPoint, args) {
    const {
        tableId    = null,
        data       = [],
        cols       = [],
        selfKey    = null,
        selfValue  = null,
        fontClass  = 'font-small',
        stickyCols = 2,
    } = args;

    mountPoint.innerHTML = '';
    if (tableId) mountPoint.setAttribute('data-mf-table-id', tableId);
    else         mountPoint.removeAttribute('data-mf-table-id');

    if (data.length === 0) {
        mountPoint.innerHTML = '<div class="pg-note">No data.</div>';
        return { wrap: null, table: null };
    }

    const wrap = document.createElement('div');
    wrap.className = 'pg-rank-table-wrap';

    const table = document.createElement('table');
    table.className = `pg-rank-table ${fontClass}`;
    if (tableId) table.setAttribute('data-mf-table-id', tableId);
    table.innerHTML = buildThead(cols) + buildTbody(data, cols, selfKey, selfValue);
    wrap.appendChild(table);
    mountPoint.appendChild(wrap);

    requestAnimationFrame(() => {
        if (stickyCols >= 2) {
            const th1 = table.querySelector('thead th:nth-child(1)');
            if (th1) {
                const w = th1.getBoundingClientRect().width;
                if (w > 0) table.style.setProperty('--c0-col1-w', `${w}px`);
            }
        }
        attachStickyShadow(wrap);
        const selfRow = table.querySelector('tr.pg-rank-self');
        if (selfRow) {
            const rowTop    = selfRow.offsetTop;
            const rowHeight = selfRow.offsetHeight;
            const targetTop = rowTop - (wrap.clientHeight - rowHeight) / 2;
            wrap.scrollTop = Math.max(0, targetTop);
        }
    });

    return { wrap, table };
}

// ─────────────────────────────────────────────
// HTML builders
// ─────────────────────────────────────────────

function buildThead(cols) {
    const cells = cols.map(col => `<th scope="col">${col.label}</th>`).join('');
    return `<thead><tr>${cells}</tr></thead>`;
}

function buildTbody(data, cols, selfKey, selfValue) {
    const rows = data.map(row => {
        const isSelf = selfKey && selfValue != null && row[selfKey] === selfValue;
        const cls    = isSelf ? ' class="pg-rank-self"' : '';
        const cells  = cols.map(col => {
            const raw     = row[col.key];
            const display = col.format ? col.format(raw, row) : (raw == null || raw === '' ? '' : raw);
            const tdCls   = col.tdClass ? ` class="${col.tdClass}"` : '';
            return `<td${tdCls}>${display}</td>`;
        }).join('');
        return `<tr${cls}>${cells}</tr>`;
    });
    return `<tbody>${rows.join('')}</tbody>`;
}
