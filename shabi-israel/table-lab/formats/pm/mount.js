/**
 * PM — PR Matrix Format.
 *
 * A read-only numeric reference grid. Two shapes share one canonical look
 * (see pm.css):
 *   • 'matrix' — PR-gap rows × match-length columns (the PR Win-Probability
 *                Table): a grouped super-header, a sticky-toned row-header
 *                column, coloured probability cells.
 *   • 'list'   — one row per PR gap with arbitrary stat columns, left-aligned
 *                (the dashboard's Table Validation popup).
 *
 * Because both consumers build HTML strings that get injected into "?" popups
 * (not a live mount point), the core is `pmTableHtml(config) → string`.
 * `mountPMTable(mountPoint, config)` is a thin DOM wrapper for callers that do
 * own an element. No DOM is touched at import time, so this module is safe to
 * import from the otherwise DOM-free compute layer.
 *
 * @typedef {{ html: string, color?: string|null, className?: string|null }} PMCell
 * @typedef {{ header?: string|number|null, cells: PMCell[], className?: string|null }} PMRow
 * @typedef {Object} PMConfig
 * @property {'matrix'|'list'} [variant='list']
 * @property {string}  caption                 Bold title in the figcaption
 * @property {string} [note]                   Muted note after an em-dash
 * @property {{label:string}} [colGroup]       Matrix super-header spanning cols
 * @property {{label:string}} [rowHeader]      Matrix corner cell (col of row headers)
 * @property {{label:string}[]} cols           Leaf column headers
 * @property {PMRow[]} rows
 * @property {boolean} [scroll=false]          Wrap in a horizontal-scroll shell
 * @property {string} [tableClass]             Extra class(es) on the <table> (e.g. 'pm-rtl')
 */

function cellHtml(c) {
    const style = c.color ? ` style="color:${c.color}"` : '';
    const cls = c.className ? ` class="${c.className}"` : '';
    return `<td${cls}${style}>${c.html}</td>`;
}

/** Build the full <figure> HTML string for a PM table. */
export function pmTableHtml(config) {
    const {
        variant = 'list', caption, note,
        colGroup, rowHeader, cols = [], rows = [], scroll = false, tableClass = '',
    } = config;

    // Header.
    let thead;
    if (variant === 'matrix' && colGroup && rowHeader) {
        const leaf = cols.map(c => `<th scope="col">${c.label}</th>`).join('');
        thead = `<thead>
            <tr><th rowspan="2" scope="col">${rowHeader.label}</th><th colspan="${cols.length}" scope="colgroup">${colGroup.label}</th></tr>
            <tr>${leaf}</tr>
        </thead>`;
    } else {
        const leaf = cols.map(c => `<th scope="col">${c.label}</th>`).join('');
        thead = `<thead><tr>${leaf}</tr></thead>`;
    }

    // Body.
    const body = rows.map(r => {
        const rh = (r.header != null) ? `<th scope="row">${r.header}</th>` : '';
        const cls = r.className ? ` class="${r.className}"` : '';
        return `<tr${cls}>${rh}${r.cells.map(cellHtml).join('')}</tr>`;
    }).join('');

    const capNote = note ? ` <span class="pm-note">&mdash; ${note}</span>` : '';
    const cap = (caption || note)
        ? `<figcaption class="pm-caption">${caption ? `<b>${caption}</b>` : ''}${capNote}</figcaption>`
        : '';
    const cls = `pm-table pm-${variant}${tableClass ? ' ' + tableClass : ''}`;
    const figure = `
        <figure class="pm-figure">
            ${cap}
            <table class="${cls}">
                ${thead}
                <tbody>${body}</tbody>
            </table>
        </figure>`;

    return scroll ? `<div class="pm-scroll">${figure}</div>` : figure;
}

/**
 * DOM convenience: render a PM table into a caller-owned element.
 * @param {HTMLElement} mountPoint
 * @param {PMConfig} config
 * @returns {{ table: HTMLElement|null, figure: HTMLElement|null }}
 */
export function mountPMTable(mountPoint, config) {
    mountPoint.innerHTML = pmTableHtml(config);
    return {
        figure: mountPoint.querySelector('.pm-figure'),
        table: mountPoint.querySelector('.pm-table'),
    };
}
