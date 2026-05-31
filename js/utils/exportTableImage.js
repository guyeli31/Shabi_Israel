/**
 * exportTableImage.js — Single source of truth for "Export Image" PNG
 * downloads across the app. Clones a live <table>, applies the standard
 * html2canvas survival kit, optionally prepends a heading + subtitle,
 * and triggers a download.
 *
 * Callers (v1):
 *   • js/render/leaguePage.js     — D (League Table)         — uses headerNode (V13 hero)
 *   • js/render/landingPage.js    — A2 (Annual Leaderboard)  — uses title + maxRows
 *   • js/render/dashboardPage.js  — B6a / B6b / B6c          — uses title + subtitle
 *
 * v2 destination: src/components/ExportTableImage/exportTableImage.js
 * (Phase 3 scaffold exists with a thinner API; Phase 6 will absorb all
 *  of the fixes below and replace each v1 call with a v2 component call.)
 */

import { appendExportCredit } from './helpers.js';

// Hard upper bound for the exported PNG's CSS-pixel width. ~ iPhone Pro
// Max class long-side — fits any modern phone (landscape) and stays
// useful on desktop. If natural wrap exceeds this, font + cell padding
// scale down proportionally until it fits.
export const PHONE_MAX_WIDTH = 932;

// Pinned font sizes — resolved at the design-max of the project's fluid
// type clamps so the PNG is identical at any viewport / zoom. Derived:
//   • html { font-size: clamp(0.8125em, …, 0.9375em) }  → max = 15px
//   • table.font-small → var(--fs-085) max 0.85rem       → 12.75px
//   • h3-style headings → var(--fs-135) max 1.35rem      → 20.25px
// Assumes browser default 1rem = 16px (standard).
export const EXPORT_TABLE_FONT_PX = 12.75;
export const EXPORT_HEADER_FONT_PX = 20.25;

/**
 * Export a live table as a PNG download.
 *
 * @param {object} args
 * @param {HTMLTableElement} args.sourceTable     live <table> to clone
 * @param {string}           args.filename        base filename (no .png)
 * @param {string}           [args.title]         plain-string heading (creates <h3>)
 * @param {string}           [args.subtitle]      muted line under title (creates <div>)
 * @param {HTMLElement}      [args.headerNode]    cloneable DOM node to use as heading
 *                                                 instead of `title` (e.g. V13 hero card)
 * @param {number}           [args.maxRows]       if set, keep only the first N tbody rows
 */
export async function exportTableImage({
    sourceTable,
    filename,
    title,
    subtitle,
    headerNode,
    maxRows,
}) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    if (!sourceTable) return;

    const bodyStyle = getComputedStyle(document.body);

    // Inline-block wrap shrink-wraps to widest child → deterministic width
    // depending only on the table's intrinsic columns + theme font.
    const wrap = document.createElement('div');
    wrap.style.cssText =
        `position:fixed;left:-10000px;top:0;padding:24px;`
        + `background:${bodyStyle.backgroundColor};color:${bodyStyle.color};`
        + `font-family:${bodyStyle.fontFamily};display:inline-block;`
        + `box-sizing:border-box;direction:ltr;`;

    // Track scalable heading elements for the phone-cap loop below.
    const scalable = [];

    if (headerNode) {
        // Clone + pin the heading element (e.g. V13 hero card). The hero
        // CSS caps width at 80vw which would defeat determinism — override.
        const headerClone = headerNode.cloneNode(true);
        headerClone.style.maxWidth = 'none';
        headerClone.style.fontSize = EXPORT_HEADER_FONT_PX + 'px';
        const holder = document.createElement('div');
        holder.style.cssText = 'margin:0 0 12px 0;text-align:center;';
        holder.appendChild(headerClone);
        wrap.appendChild(holder);
        scalable.push(headerClone);
    } else if (title) {
        const h = document.createElement('h3');
        h.style.cssText =
            `margin:0 0 4px 0;font-size:${EXPORT_HEADER_FONT_PX}px;`
            + `text-align:center;font-weight:700;`;
        h.textContent = title;
        wrap.appendChild(h);
        scalable.push(h);
    }

    if (subtitle) {
        const s = document.createElement('div');
        s.style.cssText =
            `margin:0 0 12px 0;font-size:${EXPORT_TABLE_FONT_PX}px;`
            + `text-align:center;opacity:0.75;`;
        s.textContent = subtitle;
        wrap.appendChild(s);
        scalable.push(s);
    }

    // Clone the live table — preserves the user's current sort, title-abbr
    // badges (BMAB / WC / NC), and any custom row classes.
    const tableClone = sourceTable.cloneNode(true);

    // Strip the "Show Top N" hidden-row class so the export honours the
    // full cloned set, not the page's collapsible state.
    tableClone.querySelectorAll('tr.table-row-hidden').forEach(tr => {
        tr.classList.remove('table-row-hidden');
    });

    // Truncate to maxRows if requested (A2's "Top N" control).
    if (typeof maxRows === 'number' && maxRows > 0) {
        const tbody = tableClone.querySelector('tbody');
        if (tbody) {
            [...tbody.querySelectorAll('tr')].slice(maxRows).forEach(tr => tr.remove());
        }
    }

    // Neutralise sticky positioning that html2canvas can't capture, and
    // clear inset box-shadow cell-hairlines (html2canvas mis-renders them
    // as full-cell colour overlays — same root cause as the BMAB pill
    // rendering bug).
    tableClone.querySelectorAll('tr.avg-row, tr.stat-row').forEach(tr => {
        tr.style.position = 'static';
        tr.style.bottom = 'auto';
    });
    tableClone.querySelectorAll('thead th, tbody td').forEach(cell => {
        cell.style.position = 'static';
        cell.style.left = 'auto';
        cell.style.boxShadow = 'none';
    });

    // BMAB pill border is `box-shadow: inset 0 0 0 1.5px currentColor` —
    // same html2canvas inset bug. Replace with a real border on the clone.
    tableClone.querySelectorAll('.title-abbr:not(.title-abbr-champ)').forEach(pill => {
        pill.style.boxShadow = 'none';
        pill.style.border = '1.5px solid currentColor';
        pill.style.boxSizing = 'border-box';
    });

    // Width policy + font pin → deterministic output at any viewport/zoom.
    tableClone.style.width = 'auto';
    tableClone.style.maxWidth = 'none';
    const baseSpaceMdPx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--space-md').trim()
    ) || 16;
    tableClone.style.fontSize = EXPORT_TABLE_FONT_PX + 'px';
    tableClone.style.setProperty('--space-md', baseSpaceMdPx + 'px');

    // .mf-wrap class → MF stylesheet rank-* / surface-bg / divider rules
    // apply to the cloned table.
    const scroll = document.createElement('div');
    scroll.className = 'mf-wrap';
    scroll.style.cssText = 'max-height:none;overflow:visible;';
    scroll.appendChild(tableClone);
    wrap.appendChild(scroll);
    document.body.appendChild(wrap);

    // Phone cap: scale font + the --space-md token + all scalable headings
    // proportionally. Iterates because flags + pill borders (fixed px)
    // introduce slack that a re-measure absorbs.
    for (let i = 0; i < 4 && wrap.offsetWidth > PHONE_MAX_WIDTH; i++) {
        const ratio = PHONE_MAX_WIDTH / wrap.offsetWidth;
        const currTableFont = parseFloat(tableClone.style.fontSize);
        const currSpaceMd = parseFloat(tableClone.style.getPropertyValue('--space-md'));
        tableClone.style.fontSize = (currTableFont * ratio) + 'px';
        tableClone.style.setProperty('--space-md', (currSpaceMd * ratio) + 'px');
        scalable.forEach(el => {
            const f = parseFloat(el.style.fontSize);
            el.style.fontSize = (f * ratio) + 'px';
        });
    }

    appendExportCredit(wrap);

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename.replace(/\s+/g, '_')}.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}
