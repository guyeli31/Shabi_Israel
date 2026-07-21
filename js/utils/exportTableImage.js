/**
 * exportTableImage.js — Single source of truth for "Export Image" PNG
 * downloads across the app. Clones a live <table>, applies the standard
 * html2canvas survival kit, optionally prepends a heading + subtitle,
 * and triggers a download.
 *
 * Callers (v1):
 *   • js/render/leaguePage.js     — D (League Table)         — uses headerNode (V13 hero)
 *   • js/render/landingPage.js    — A2 (Annual Leaderboard)  — uses title + maxRows
 *   • js/render/dashboardPage.js  — B7a / B7b / B7c          — uses title + subtitle
 *
 * v2 destination: src/components/ExportTableImage/exportTableImage.js
 * (Phase 3 scaffold exists with a thinner API; Phase 6 will absorb all
 *  of the fixes below and replace each v1 call with a v2 component call.)
 */

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

// ── WhatsApp-ready fixed frame ─────────────────────────────────────
// The dashboard/league table exports (D, B7a, B7b, B7c) render into a
// fixed 4:5 portrait canvas so the whole image shows in a WhatsApp chat
// preview without vertical cropping. Rendered at html2canvas scale:1 so
// CSS px == output px → the PNG is exactly WA_FRAME_WIDTH × WA_FRAME_HEIGHT.
export const WA_FRAME_WIDTH = 1080;
export const WA_FRAME_HEIGHT = 1350;
// Hard row cap: above this the caller must block export (show a notice
// instead of the button) — a taller table would force the font below the
// readable floor inside the fixed frame.
export const MAX_EXPORT_ROWS = 30;

// Frame internals (all in output px). The header band is a constant height
// across all four export types so every image shares the same identity
// layout; only its text differs. Kept tight so the table gets most of the
// canvas.
const WA_PADDING = 56;
const WA_HEADER_HEIGHT = 120;
const WA_HEADER_FONT = 34;
const WA_SUB_FONT = 22;
const WA_PILL_FONT = 20;
// Table font is fit dynamically: few rows → large & readable (capped at
// MAX), dense tables → shrink toward the floor so they still fit the band.
// MAX is pinned to the title size so table data never dwarfs the heading
// and the heading↔data gap stays tight; dense tables grow to fill the body
// region up to this cap.
const WA_TABLE_FONT_MAX = 34;
const WA_TABLE_FONT_MIN = 8;
const WA_LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

/** Human label for a league type — shared by the header pill and filenames. */
export function leagueTypeLabel(leagueType) {
    return WA_LEAGUE_TYPE_LABELS[leagueType] || WA_LEAGUE_TYPE_LABELS.doubling;
}
// The whole fluid type family, keyed by its design-max in rem. Tables use
// several of these — not just --fs-085 (data cells): B7b's "played ≥ half"
// divider is --fs-075, footers are --fs-060, etc. The font-fit below drives
// EVERY token off the single fitted size, preserving each token's designed
// ratio to --fs-085. Overriding only --fs-085/--fs-093 would leave the rest
// at the page's live fluid (viewport-dependent!) value, so they'd render
// disproportionately tiny next to the scaled-up data cells.
const WA_FS_TOKENS = {
    '--fs-060': 0.60, '--fs-075': 0.75, '--fs-085': 0.85, '--fs-093': 0.93,
    '--fs-100': 1.00, '--fs-105': 1.05, '--fs-110': 1.10, '--fs-112': 1.12,
    '--fs-115': 1.15, '--fs-120': 1.20, '--fs-125': 1.25, '--fs-135': 1.35,
    '--fs-140': 1.40, '--fs-150': 1.50, '--fs-160': 1.60, '--fs-180': 1.80,
    '--fs-190': 1.90,
};
// The fitted size we solve for IS --fs-085 (the data-cell token); every
// other token is scaled relative to it.
const WA_FS_BASE_REM = 0.85;

/**
 * Export a live table as a fixed 4:5 WhatsApp-ready PNG (1080×1350).
 *
 * Unlike exportTableImage() (which shrink-wraps to content), this renders
 * into a constant-size portrait frame: fixed header band + a body region
 * that the table is stretched to fill horizontally and font-fit to fill
 * vertically. Background/foreground inherit the current site theme.
 *
 * Callers MUST pre-check the row count against MAX_EXPORT_ROWS and block
 * the export path when it is exceeded.
 *
 * @param {object} args
 * @param {HTMLTableElement} args.sourceTable  live <table> to clone
 * @param {string}           args.filename     base filename (no .png)
 * @param {string}           [args.title]      heading line (bold)
 * @param {string}           [args.subtitle]   muted line under the title
 * @param {string}           [args.leagueType] 'doubling'|'regular'|'ubc' —
 *                                             renders the coloured type pill
 *                                             to the right of the title
 * @param {boolean}          [args.shrinkToContent] Column-width policy. Wide
 *   tables (D, ~11 cols) default to false: columns stretch to fill the frame.
 *   Narrow tables (B7a/B7b 2 cols, B7c 1 col) MUST pass true: stretching them
 *   across 968px leaves each cell ~80% empty with the text swimming in it.
 *   With true, cells are pinned nowrap so every column sizes to its widest
 *   text (nothing is ever clipped or wrapped) and the resulting narrower
 *   table is centred in the frame.
 */
export async function exportWhatsAppTableImage({ sourceTable, filename, title, subtitle, leagueType, shrinkToContent = false }) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    if (!sourceTable) return;

    const bodyStyle = getComputedStyle(document.body);

    // Fixed portrait frame — themed background/foreground.
    const wrap = document.createElement('div');
    wrap.style.cssText =
        `position:fixed;left:-10000px;top:0;`
        + `width:${WA_FRAME_WIDTH}px;height:${WA_FRAME_HEIGHT}px;`
        + `padding:${WA_PADDING}px;box-sizing:border-box;`
        + `background:${bodyStyle.backgroundColor};color:${bodyStyle.color};`
        + `font-family:${bodyStyle.fontFamily};direction:ltr;`
        + `display:flex;flex-direction:column;`;

    // Constant-height header band (title + subtitle), centred.
    const header = document.createElement('div');
    header.style.cssText =
        `flex:0 0 ${WA_HEADER_HEIGHT}px;height:${WA_HEADER_HEIGHT}px;`
        + `display:flex;flex-direction:column;align-items:center;justify-content:center;`
        + `text-align:center;gap:8px;overflow:hidden;`;
    if (title) {
        const titleRow = document.createElement('div');
        titleRow.style.cssText =
            `display:flex;align-items:center;justify-content:center;gap:16px;`;
        const h = document.createElement('div');
        h.style.cssText = `font-size:${WA_HEADER_FONT}px;font-weight:700;line-height:1.15;`;
        h.textContent = title;
        titleRow.appendChild(h);
        if (leagueType) {
            const pill = document.createElement('span');
            pill.className = `league-type-pill type-${leagueType}`;
            pill.textContent = leagueTypeLabel(leagueType);
            pill.style.fontSize = WA_PILL_FONT + 'px';
            titleRow.appendChild(pill);
        }
        header.appendChild(titleRow);
    }
    if (subtitle) {
        const s = document.createElement('div');
        s.style.cssText = `font-size:${WA_SUB_FONT}px;opacity:0.75;line-height:1.2;`;
        s.textContent = subtitle;
        header.appendChild(s);
    }
    wrap.appendChild(header);

    // Body region fills the remaining height; table is top-aligned inside it.
    // shrinkToContent additionally centres it horizontally, since the table
    // is then narrower than the frame.
    const bodyRegion = document.createElement('div');
    bodyRegion.style.cssText =
        `flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;`
        + (shrinkToContent ? `align-items:center;` : ``);
    wrap.appendChild(bodyRegion);

    // Clone + the standard html2canvas survival kit (mirrors exportTableImage).
    const tableClone = sourceTable.cloneNode(true);
    tableClone.querySelectorAll('tr.table-row-hidden').forEach(tr => tr.classList.remove('table-row-hidden'));
    tableClone.querySelectorAll('tr.avg-row, tr.stat-row').forEach(tr => {
        tr.style.position = 'static';
        tr.style.bottom = 'auto';
    });
    tableClone.querySelectorAll('thead th, tbody td').forEach(cell => {
        cell.style.position = 'static';
        cell.style.left = 'auto';
        cell.style.boxShadow = 'none';
    });
    tableClone.querySelectorAll('.title-abbr:not(.title-abbr-champ)').forEach(pill => {
        pill.style.boxShadow = 'none';
        pill.style.border = '1.5px solid currentColor';
        pill.style.boxSizing = 'border-box';
    });
    tableClone.style.maxWidth = 'none';

    // Content-width mode: pin every cell nowrap so each column sizes to its
    // widest text — the table can then only be as wide as its content needs,
    // and nothing wraps or gets clipped. (B7a's page CSS forces
    // table-layout:fixed + width:100%; the clone lives outside .rem-b6a-wrap
    // so that rule can't reach it, but we clear it explicitly to be safe.)
    if (shrinkToContent) {
        tableClone.style.tableLayout = 'auto';
        tableClone.querySelectorAll('thead th, tbody td').forEach(cell => {
            cell.style.whiteSpace = 'nowrap';
        });
    }

    const scroll = document.createElement('div');
    scroll.className = 'mf-wrap';
    scroll.style.cssText = 'max-height:none;overflow:visible;'
        + (shrinkToContent ? 'width:max-content;max-width:100%;margin:0 auto;' : 'width:100%;');
    scroll.appendChild(tableClone);
    bodyRegion.appendChild(scroll);
    document.body.appendChild(wrap);

    // Font-fit. The table's fonts come from the rem-based --fs-* tokens (not
    // the inherited table font-size), so we drive the whole family directly.
    // Measure at width:auto (intrinsic) then shrink until the table fits both
    // the frame's inner width and the body band height.
    const baseSpaceMdPx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--space-md').trim()
    ) || 16;
    const availW = WA_FRAME_WIDTH - WA_PADDING * 2;
    const availH = WA_FRAME_HEIGHT - WA_PADDING * 2 - WA_HEADER_HEIGHT;

    const applyFont = (f) => {
        tableClone.style.fontSize = f + 'px';
        for (const [token, rem] of Object.entries(WA_FS_TOKENS)) {
            tableClone.style.setProperty(token, (f * (rem / WA_FS_BASE_REM)) + 'px');
        }
        tableClone.style.setProperty('--space-md', (baseSpaceMdPx * (f / WA_TABLE_FONT_MAX)) + 'px');
    };

    tableClone.style.width = 'auto';
    let font = WA_TABLE_FONT_MAX;
    applyFont(font);
    for (let i = 0; i < 16; i++) {
        const r = Math.max(tableClone.offsetWidth / availW, tableClone.offsetHeight / availH);
        if (r <= 1 || font <= WA_TABLE_FONT_MIN) break;
        font = Math.max(WA_TABLE_FONT_MIN, (font / r) * 0.99);
        applyFont(font);
    }
    // Final width policy. Wide tables stretch to fill the frame (cells are
    // white-space:nowrap, so this only widens columns — it does not re-wrap
    // or change the fitted height). Narrow tables keep the intrinsic width
    // they were just fitted at and stay centred by the wrapper above.
    if (!shrinkToContent) tableClone.style.width = '100%';

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, {
            scale: 1,
            backgroundColor: bodyStyle.backgroundColor,
            useCORS: true,
            width: WA_FRAME_WIDTH,
            height: WA_FRAME_HEIGHT,
        });
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
