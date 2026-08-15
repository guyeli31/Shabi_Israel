/**
 * mount.js — Canonical FF (Form Format) table renderer.
 *
 * Unified Admin "form-style" format covering both list+navigate (read-only
 * cells + action buttons) and edit-in-place (input/select/toggle cells +
 * Save callback) patterns. The distinction is per-column, not per-table —
 * a single FF table can mix read-only display cells, action buttons, and
 * inline-edit widgets freely.
 *
 * Used by: F1 (Leagues / League Manager), F2 (Players in Edit League),
 *          F3 (Round Editor), F4 (View Overrides). All on admin.html.
 *
 * Lives in the lab (table-lab/formats/ff/) as the single source of truth.
 * Production currently still renders these tables by hand. Phase 8 of the
 * table-lab unification plan rewires call sites to `mountFFTable`.
 *
 * FF format (per docs/TABLE-DESIGN.md):
 *   • Mirrors SF on the 7 shared parameters: border-collapse: separate,
 *     row hairline via box-shadow inset, white-space: nowrap, cell padding
 *     0.45em 0.5em, sticky thead, scroll-wrapper with max-height + auto
 *     overflow, MF-style drop-shadow on the sticky col boundary during
 *     horizontal scroll.
 *   • Admin-specific chrome: header background --color-bg (subtle tint vs
 *     body --color-surface), header text uppercase + letter-spacing,
 *     1 sticky left column by default (typically Name).
 *   • Caller owns: page-level <h1>/<h2> heading, "+ Add" button, Save
 *     button, validation message slots, sub-forms (e.g. Upload Custom Flag),
 *     and event-delegation handlers for action buttons and cell editors.
 *     FF owns only the scroll wrapper + table itself.
 *
 * Three cell modes (per-column via ColDef):
 *   • Display    — ColDef.format(row) returns plain HTML (text, pills, etc.)
 *   • Action     — ColDef.format(row) returns button HTML with data-* attrs;
 *                  caller wires onclick via event delegation on the table.
 *   • Edit       — ColDef.format(row) returns input/select/toggle HTML AND
 *                  ColDef.getValue(td, row) is defined. The cell participates
 *                  in getDiff() and (optional) validate().
 *
 * What FF does NOT do (intentionally):
 *   • No click-to-sort.
 *   • No color gradients per column.
 *   • No medal rows, summary/avg rows.
 *   • No <h?> heading / Save button / sub-form rendering — caller chrome.
 *   • No .admin-card wrapping — caller owns the card so multi-element
 *     cards (heading + msg slot + table + Save + sub-form) compose freely.
 */

import { attachStickyShadow } from '../../../js/utils/stickyShadow.js';

/**
 * @param {HTMLElement} mountPoint  Empty container the caller owns; renderer rebuilds inside.
 * @param {object}      args        Table configuration.
 *
 * args:
 *   tableId          {string|null}                 Stable id for data-mf-table-id (e.g. 'F1','F2','F4').
 *   data             {object[]}                    Row objects.
 *   cols             {ColDef[]}                    Column descriptors (see below).
 *   fontClass        'font-small'|'font-large'     Default 'font-large'.
 *   cellInvalidClass {string}                      CSS class set on cells that fail validation. Default 'cell-invalid'.
 *
 * ColDef:
 *   key          {string}                          Property name on row objects.
 *   label        {string}                          Header text (may contain HTML).
 *   format       {(value,row)=>html|null}|null     Display formatter — what's rendered IN the cell.
 *                                                  Returns: display HTML (Display mode)
 *                                                       OR button HTML with data-* attrs (Action mode)
 *                                                       OR input/select/toggle HTML (Edit mode).
 *   tdClass      {string|null}                     CSS class on every <td> in this column.
 *   getValue     {(td,row)=>value}|null            Edit mode: reads the cell's current value from its <td>.
 *                                                  If defined → cell participates in getDiff().
 *   originalKey  {string}                          Edit mode: field on `row` whose value is treated as
 *                                                  the original (for diff comparison). Default: same as `key`.
 *   validate     {(value,row)=>err\|null}|null     Edit mode: returns error message or null. Cells with
 *                                                  errors get `cellInvalidClass`. Optional.
 *
 * Returns: { wrap, table, getDiff, validate }
 *   wrap     — The .ff-wrap element (scroll container).
 *   table    — The <table> element. Use this for event delegation.
 *   getDiff  — () => { row, key, originalValue, newValue }[]. Runs all Edit-mode
 *              cells' getValue and returns only the rows where current ≠ original.
 *              (No-op if no Edit-mode cols exist.)
 *   validate — () => { row, key, error }[]. Runs all Edit-mode cols' validate
 *              against current values, marks invalid cells with cellInvalidClass,
 *              returns list of errors.
 */
export function mountFFTable(mountPoint, args) {
    const {
        tableId          = null,
        data             = [],
        cols             = [],
        fontClass        = 'font-large',
        cellInvalidClass = 'cell-invalid',
    } = args;

    mountPoint.innerHTML = '';
    if (tableId) mountPoint.setAttribute('data-mf-table-id', tableId);
    else         mountPoint.removeAttribute('data-mf-table-id');

    // FF owns only the scroll wrapper + table.
    // Caller wraps the mountPoint with .admin-card (or .rem-tab-panel etc.)
    // and places any heading / Save button / sub-forms above and below.
    const wrap = document.createElement('div');
    wrap.className = 'ff-wrap';

    const table = document.createElement('table');
    table.className = `admin-table ${fontClass}`;
    if (tableId) table.setAttribute('data-mf-table-id', tableId);
    table.innerHTML = buildThead(cols) + buildTbody(data, cols);
    wrap.appendChild(table);

    mountPoint.appendChild(wrap);

    attachStickyShadow(wrap);

    const hasEditCols = cols.some(c => typeof c.getValue === 'function');

    const getDiff = !hasEditCols ? null : () => {
        const out = [];
        const trs = table.querySelectorAll('tbody > tr');
        trs.forEach((tr, rowIndex) => {
            const row = data[rowIndex];
            if (!row) return;
            cols.forEach((col, colIndex) => {
                if (typeof col.getValue !== 'function') return;
                const td = tr.children[colIndex];
                if (!td) return;
                const newValue      = col.getValue(td, row);
                const originalValue = row[col.originalKey ?? col.key];
                if (newValue !== originalValue) {
                    out.push({ row, key: col.key, originalValue, newValue });
                }
            });
        });
        return out;
    };

    const validate = !hasEditCols ? null : () => {
        const errors = [];
        const trs = table.querySelectorAll('tbody > tr');
        trs.forEach((tr, rowIndex) => {
            const row = data[rowIndex];
            if (!row) return;
            cols.forEach((col, colIndex) => {
                if (typeof col.validate !== 'function' || typeof col.getValue !== 'function') return;
                const td = tr.children[colIndex];
                if (!td) return;
                td.classList.remove(cellInvalidClass);
                const value = col.getValue(td, row);
                const error = col.validate(value, row);
                if (error) {
                    td.classList.add(cellInvalidClass);
                    errors.push({ row, key: col.key, error });
                }
            });
        });
        return errors;
    };

    return { wrap, table, getDiff, validate };
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
        return `<tbody><tr><td colspan="${cols.length}" style="text-align:center;color:var(--color-text-muted)">No data</td></tr></tbody>`;
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