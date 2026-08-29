/**
 * stickyCols.js — publish the rendered width of the leading sticky columns as
 * CSS custom properties, so column 2 (and 3) can pin at `left: var(--…)`
 * without a hard-coded px anywhere (iron rule 12).
 *
 * Sibling of stickyShadow.js: that one owns the scroll shadow at the sticky
 * boundary, this one owns where the boundary IS.
 *
 * Every table with more than one sticky column needs this, and before this
 * module existed each one measured by hand — nine near-copies across
 * landingPage / dashboardPage / playerGeneralPage / mailSync / table-lab, each
 * with its own trigger set, so a trap solved in one file stayed live in the
 * other eight. All three known traps are handled here, once:
 *
 *  1. MEASURING WHILE HIDDEN. A table built inside an inactive tab panel or a
 *     collapsed section measures 0 on every cell, the write is skipped, and the
 *     CSS fallback (typically 36px) is what the user finally sees — parking
 *     column 2 ~20px to the RIGHT of column 1 on mobile, leaving a gap through
 *     which the scrolled-under column shows. A one-shot `requestAnimationFrame`
 *     cannot fix this: the frame it runs in is one where the table has no size.
 *
 *  2. MEASURING BEFORE THE FLAGS LOAD. `.flag` is `height: 1em; width: auto`,
 *     so an unloaded flag contributes 0 width. Measured live on F8: th1 is
 *     117.67px before the flags land and 131.33px after — exactly one 13.67px
 *     flag — which parks column 2 fourteen pixels INSIDE column 1, permanently.
 *
 *  3. THE MEASURE→WRITE LOOP. Writing the variable can reflow the table, which
 *     re-fires the observer, which measures and writes again. It converges, but
 *     every lap costs a forced layout. Remembering the last value written makes
 *     the second lap free.
 *
 * The fix for 1 and 2 is the same one: observe the HEADER CELLS themselves.
 * A ResizeObserver on a cell fires on the 0 → n transition when the tab opens,
 * when an image inside it finally has a size, and on any later width change
 * (mobile font breakpoint, longer values revealed by "Show all"). Observing the
 * WRAPPER instead does not work — its size never changes — and a `resize`
 * listener catches only the last of those three.
 *
 * Usage:
 *   pinStickyCols(table, '--pg-col1-w');                    // 2 sticky cols
 *   pinStickyCols(table, ['--sf-col1-w', '--sf-col2-w']);   // 3 sticky cols
 *   pinStickyCols(table, '--col1-w', { target: wrap });     // CSS reads it off
 *                                                           // the wrapper
 *
 * One var per MEASURED column, i.e. one fewer than the number of sticky
 * columns — the first one pins at `left: 0` and needs no measurement.
 */

/** table → (var-name key → pin), so a re-render cannot stack observers. */
const pins = new WeakMap();

/**
 * @param {Element} table   the <table> whose leading header cells are measured
 * @param {string|string[]} vars  CSS custom property name(s), col 1 outwards
 * @param {{target?: Element}} [opts]  element the properties are written on
 *                                     (default: the table itself)
 * @returns {() => void} dispose — stops observing; call on teardown
 */
export function pinStickyCols(table, vars, opts = {}) {
    const noop = () => {};
    if (!table || !vars) return noop;

    const names = Array.isArray(vars) ? vars : [vars];
    const key = names.join('|');
    const byKey = pins.get(table) || new Map();
    const existing = byKey.get(key);
    // Idempotent: a second call for the same table+vars re-measures instead of
    // attaching a second observer to the same cells.
    if (existing) {
        existing.refresh();
        return existing.dispose;
    }

    const host = opts.target || table;
    const cells = names.map((_, i) => table.querySelector(`thead th:nth-child(${i + 1})`));
    // No header row yet — nothing to measure, and nothing to observe either.
    if (cells.some(cell => !cell)) return noop;

    const last = new Array(names.length).fill(null);
    const refresh = () => {
        cells.forEach((cell, i) => {
            const w = cell.getBoundingClientRect().width;
            // Skip 0 rather than write it: a hidden table must keep the CSS
            // fallback until the observer reports a real width (trap 1).
            if (w > 0 && w !== last[i]) {
                last[i] = w;
                host.style.setProperty(names[i], w + 'px');
            }
        });
    };

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(refresh);
        cells.forEach(cell => ro.observe(cell));
    }

    const dispose = () => {
        if (ro) ro.disconnect();
        pins.get(table)?.delete(key);
    };

    byKey.set(key, { refresh, dispose });
    pins.set(table, byKey);

    refresh();
    return dispose;
}

/**
 * Convenience for the common "a container full of same-shaped tables" case
 * (a records stack, a tab panel). Same contract as pinStickyCols per table.
 *
 * @param {Element} root      container to search
 * @param {string} selector   table selector, e.g. '.pg-mr-table'
 * @param {string|string[]} vars
 * @param {{target?: (table: Element) => Element}} [opts]  per-table target
 *                                                         resolver
 */
export function pinStickyColsAll(root, selector, vars, opts = {}) {
    if (!root) return;
    root.querySelectorAll(selector).forEach(table => {
        pinStickyCols(table, vars, {
            target: opts.target ? opts.target(table) : undefined,
        });
    });
}
