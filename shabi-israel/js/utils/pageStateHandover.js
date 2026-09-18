/**
 * pageStateHandover.js — keep the reader's PLACE when the entity changes but
 * the surface doesn't.
 *
 * Switching from one league to the next on the same page (the dashboard's
 * prev/next arrows, the sidebar's Leagues flyout, "Also plays in", a league
 * link inside a table) used to drop the reader back to the default view: the
 * first tab, the preset's default sort. That is wrong — moving sideways
 * between two instances of the SAME surface is a change of subject, not a
 * change of place. The question "how does the next league's Charts tab look,
 * sorted the way I just sorted this one" is exactly the question those arrows
 * exist to answer.
 *
 * Two pieces of state travel:
 *
 *   • the open main tab — carried in the URL (?tab=…), per CLAUDE.md
 *     § URL contract, and only when the target link doesn't name one itself.
 *     A default tab stays absent from the URL, so nothing is carried and the
 *     shortest URL stays canonical.
 *   • every mounted MF table's live sort — stashed into
 *     sessionStorage[`mf-sort-pending-<tableId>`], which mountMFTable()
 *     consumes ONE-SHOT on its next mount (see table-lab/formats/mf/mount.js).
 *     One-shot matters: a sort travels across a deliberate sideways step and
 *     nowhere else. Arriving from search, a breadcrumb, a bookmark or a fresh
 *     load still gets the preset's default.
 *
 * This is the single implementation. It replaces a `stashPendingSort()` that
 * had been hand-copied into leaguePage.js and playerPage.js and wired to the
 * nav arrows alone — the two copies already disagreed with the dashboard,
 * which carried nothing at all.
 *
 * Known gap, by nature rather than oversight: a link opened through the
 * browser's own context menu ("Open in new tab") fires no click event, so it
 * lands on the defaults. Every ordinary activation — left click, middle click,
 * Ctrl/Cmd-click, Enter on a focused link — goes through here.
 */

const sortKey = (tableId) => `mf-sort-pending-${tableId}`;

/**
 * Stash the live sort of one mounted MF table, so the next mount of that same
 * tableId restores it. No-op when the table isn't on the page or is sitting at
 * its unsorted default.
 */
export function stashPendingSort(tableId, root = document) {
    const table = root.querySelector(`table[data-mf-table-id="${tableId}"]`);
    if (table) stashTableSort(table);
}

/** Stash the live sort of every MF table currently mounted on the page. */
export function stashMountedSorts(root = document) {
    root.querySelectorAll('table[data-mf-table-id]').forEach(stashTableSort);
}

function stashTableSort(table) {
    if (typeof sessionStorage === 'undefined') return;
    const tableId = table.dataset.mfTableId;
    const colKey  = table.dataset.sortColKey;
    const dir     = table.dataset.sortDir;
    // No colKey = the user never clicked a header: the table is showing the
    // preset's own order, and there is nothing to carry.
    if (!tableId || !colKey) return;
    try {
        sessionStorage.setItem(sortKey(tableId), JSON.stringify({ colKey, dir }));
    } catch { /* quota / disabled — ignore */ }
}

/**
 * Install the handover on the current page.
 *
 * A single delegated capture-phase listener rather than per-link wiring: the
 * links that switch league are built by at least five different modules
 * (dashboard arrows, sidebar, nav flyout, "Also plays in", table cells), and
 * the ones in the sidebar are rebuilt on every open. A listener on the
 * document sees them all, including the ones that don't exist yet.
 *
 * Fires for a link that stays on the SAME page (same pathname) and asks for a
 * different query — i.e. the same surface showing a different entity. A
 * cross-page link (dashboard → full table → player) is a step to a different
 * surface and deliberately carries nothing.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.carryParams] — query params copied onto the target
 *        when the target doesn't name them itself. Defaults to the main tab.
 * @returns {{ destroy(): void }}
 */
let installed = null;

export function installPageStateHandover({ carryParams = ['tab'] } = {}) {
    // Idempotent: every page that uses this re-renders in place (store.js's
    // onVisibleRevalidate, a theme switch, a cross-tab storage event), so the
    // install call runs many times per page life. Wiring the document listener
    // once means those re-renders can't stack duplicate handlers that each
    // append the same param again.
    if (installed) return installed;

    const onActivate = (e) => {
        if (e.defaultPrevented) return;
        const a = e.target.closest?.('a[href]');
        if (!a) return;

        const raw = a.getAttribute('href');
        if (!raw || raw.startsWith('#')) return;          // in-page anchor

        let target;
        try { target = new URL(raw, location.href); } catch { return; }
        if (target.origin !== location.origin) return;
        if (target.pathname !== location.pathname) return; // different surface
        if (!target.search) return;                        // no entity named
        if (target.search === location.search) return;     // same entity

        stashMountedSorts();

        const here = new URLSearchParams(location.search);
        let href = raw;
        for (const name of carryParams) {
            const value = here.get(name);
            if (value == null) continue;                   // default → stays absent
            if (target.searchParams.has(name)) continue;   // the link decided already
            href = appendParam(href, name, value);
        }
        if (href !== raw) a.setAttribute('href', href);
    };

    // 'click' covers left click, Ctrl/Cmd-click and Enter on a focused link;
    // 'auxclick' adds middle click (open in a background tab).
    document.addEventListener('click', onActivate, true);
    document.addEventListener('auxclick', onActivate, true);

    installed = {
        destroy() {
            document.removeEventListener('click', onActivate, true);
            document.removeEventListener('auxclick', onActivate, true);
            installed = null;
        },
    };
    return installed;
}

/**
 * Append one param to a raw href, leaving every other byte of it alone.
 *
 * The same asymmetry spliceQueryParam() exists for (CLAUDE.md § URL contract):
 * round-tripping the href through URLSearchParams would re-encode the league
 * name's spaces from `%20` to `+`, giving one league two URL spellings. So the
 * href is edited as a string. spliceQueryParam() itself can't be reused — it
 * reads a Location and only ever rewrites the CURRENT url, while this appends
 * to a foreign href.
 */
function appendParam(href, name, value) {
    const hashAt = href.indexOf('#');
    const hash   = hashAt === -1 ? '' : href.slice(hashAt);
    const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
    const queryAt = beforeHash.indexOf('?');
    const sep = queryAt === -1 ? '?' : '&';
    return `${beforeHash}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}${hash}`;
}
