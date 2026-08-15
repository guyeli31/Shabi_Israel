/**
 * appTabs.js — Reusable segmented-tab controller (pairs with css/tabs.css).
 *
 * One call builds the tablist + the panels and wires:
 *   • click activation
 *   • URL state  (?<urlKey>=<id>, the default tab is omitted)
 *   • Back/Forward between tabs (pushState on a user gesture + popstate)
 *   • full WAI-ARIA keyboard support — roving tabindex + Arrow/Home/End
 *   • optional 1-N number hotkeys (ignored while typing in a field)
 *
 * Usage:
 *   const { root, panels } = mountAppTabs({
 *     tabs: [{ id: 'leagues', label: 'Leagues' }, …],
 *     urlKey: 'tab',
 *     ariaLabel: 'Home sections',
 *     shellClass: 'lp-tabs-shell',   // optional extra class on the wrapper
 *     panelClass: 'lp-tab-panel',    // optional extra class on every panel
 *     aliases: { insights: 'charts' },  // optional — see below
 *   });
 *   container.appendChild(root);
 *   renderLeagues(panels.leagues);   // fill each panel by id; signatures unchanged
 *
 * Returns { root, panels: {[id]: HTMLElement}, activate(id), destroy() }.
 *
 * URL contract (CLAUDE.md § URL contract — enforced by
 * scripts/check-url-contract.js and asserted again at mount here):
 *   • Every tab's `id` IS its slug, and the slug is always tabSlug(label).
 *     A tab set whose id and label disagree throws — the drift is invisible in
 *     review ({ id: 'insights', label: 'Charts' } reads fine) and only shows up
 *     in the address bar, so it has to fail loudly instead.
 *   • The FIRST tab is the default — its id is never written to the URL, so the
 *     shortest URL is always the canonical entry point.
 *   • A click / arrow key / hotkey PUSHES, so Back returns to the previous tab
 *     instead of leaving the page. Mount and alias-normalisation REPLACE.
 *   • `aliases` maps a retired slug to a current id: the old link activates the
 *     right tab and the URL is then normalised with replaceState, so links
 *     shared before a rename keep working without polluting Back. Aliases are
 *     permanent and cost one line.
 *
 * A11y contract (consumed by css/tabs.css):
 *   • tablist  → role="tablist" + aria-label
 *   • each tab → role="tab", id, aria-controls, aria-selected, roving tabindex
 *   • each panel → role="tabpanel", id, aria-labelledby, class `app-tab-panel`
 *     (+ any caller panelClass) and data-panel="<id>" for page-level CSS hooks.
 */

import { tabSlug, spliceQueryParam } from '../utils/queryString.js';

let _groupSeq = 0;

export function mountAppTabs({
    tabs,
    urlKey = 'tab',
    ariaLabel = 'Sections',
    shellClass = '',
    panelClass = '',
    hotkeys = true,
    aliases = null,
} = {}) {
    if (!Array.isArray(tabs) || tabs.length === 0) {
        throw new Error('mountAppTabs: `tabs` must be a non-empty array');
    }

    const gid = `apptabs-${++_groupSeq}`;
    const ids = tabs.map(t => t.id);
    const defaultId = ids[0];

    // The iron rule, asserted at mount. scripts/check-url-contract.js catches
    // this statically before a commit; this catches a tab set the checker's
    // regex can't see (built in a loop, spread from a constant, …).
    for (const t of tabs) {
        if (t.id !== tabSlug(t.label)) {
            throw new Error(
                `mountAppTabs: tab id "${t.id}" ≠ tabSlug("${t.label}"). ` +
                `The URL slug is always the visible label — rename the id, or if the slug ` +
                `is too long, shorten the LABEL. See CLAUDE.md § URL contract.`
            );
        }
    }
    const tabDomId = id => `${gid}-tab-${id}`;
    const panelDomId = id => `${gid}-panel-${id}`;

    const root = document.createElement('div');
    root.className = shellClass ? `app-tabs-shell ${shellClass}` : 'app-tabs-shell';

    // ── Tab strip ──
    const tablist = document.createElement('div');
    tablist.className = 'app-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', ariaLabel);

    const buttons = {};
    const panels = {};

    tabs.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'app-tab';
        btn.id = tabDomId(t.id);
        btn.dataset.tab = t.id;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('aria-controls', panelDomId(t.id));
        btn.tabIndex = -1;                       // roving — only the active tab is tabbable
        // Optional decorative icon (emoji or inline SVG) before the label. The
        // icon is aria-hidden so assistive tech reads only the label text.
        btn.innerHTML = t.icon
            ? `<span class="app-tab-icon" aria-hidden="true">${t.icon}</span><span class="app-tab-label">${t.label}</span>`
            : t.label;
        tablist.appendChild(btn);
        buttons[t.id] = btn;

        const panel = document.createElement('div');
        panel.className = panelClass ? `app-tab-panel ${panelClass}` : 'app-tab-panel';
        panel.id = panelDomId(t.id);
        panel.dataset.panel = t.id;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabDomId(t.id));
        panel.hidden = true;                     // panels hold focusable content → no tabindex needed
        panels[t.id] = panel;
    });

    root.appendChild(tablist);
    tabs.forEach(t => root.appendChild(panels[t.id]));

    // ── Behaviour ──

    /** The URL exactly as the address bar shows it. */
    const here = () => location.pathname + location.search + location.hash;

    /**
     * Write the active tab into the query. The default tab is written as the
     * ABSENCE of the param, so `?tab=leagues` never exists.
     *
     * spliceQueryParam edits one param without re-serialising the rest — see
     * js/utils/queryString.js for why (URLSearchParams turns `%20` into `+`).
     * The no-op guard matters twice over: it stops the mount-time write from
     * touching a URL that is already correct, and it keeps a repeated hotkey
     * from stacking identical history entries.
     */
    function writeUrl(id, { push = false } = {}) {
        if (!urlKey) return;
        const next = spliceQueryParam(urlKey, id === defaultId ? null : id);
        if (next === here()) return;
        if (push) history.pushState({ [urlKey]: id }, '', next);
        // Preserve history.state on replace — scrollOffset.js and the landing
        // page's anchor handling both put things there.
        else history.replaceState(history.state, '', next);
    }

    /**
     * @param {object} [opts]
     * @param {boolean} [opts.focus] — move focus to the tab button (keyboard nav)
     * @param {'push'|'replace'|'none'} [opts.history] — 'push' for a user gesture
     *        (Back returns to the previous tab), 'replace' for mount and alias
     *        normalisation, 'none' for popstate (the browser already moved
     *        history; writing again would corrupt it).
     */
    function activate(id, { focus = false, history: mode = 'replace' } = {}) {
        if (!ids.includes(id)) id = defaultId;
        tabs.forEach(t => {
            const selected = t.id === id;
            buttons[t.id].setAttribute('aria-selected', selected ? 'true' : 'false');
            buttons[t.id].tabIndex = selected ? 0 : -1;
            panels[t.id].hidden = !selected;
        });
        if (focus) buttons[id].focus();
        if (mode !== 'none') writeUrl(id, { push: mode === 'push' });
    }

    /** URL slug → tab id. Live id, else a declared alias, else the default. */
    function resolve(slug) {
        if (slug == null) return defaultId;
        if (ids.includes(slug)) return slug;
        const mapped = aliases && aliases[slug];
        return (mapped && ids.includes(mapped)) ? mapped : defaultId;
    }

    tabs.forEach(t => buttons[t.id].addEventListener('click', () => activate(t.id, { history: 'push' })));

    // WAI-ARIA roving keyboard nav (automatic activation on Arrow/Home/End).
    tablist.addEventListener('keydown', e => {
        if (!e.target.matches('[role="tab"]')) return;
        const cur = ids.indexOf(e.target.dataset.tab);
        let next = -1;
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown': next = (cur + 1) % ids.length; break;
            case 'ArrowLeft':
            case 'ArrowUp':   next = (cur - 1 + ids.length) % ids.length; break;
            case 'Home':      next = 0; break;
            case 'End':       next = ids.length - 1; break;
            default: return;
        }
        e.preventDefault();
        activate(ids[next], { focus: true, history: 'push' });
    });

    // Optional 1-N number hotkeys — skipped while a form field is focused.
    if (hotkeys) {
        root.addEventListener('keydown', e => {
            if (e.target.matches('input, textarea, select')) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= tabs.length) activate(ids[n - 1], { history: 'push' });
        });
    }

    /** Read the slug the URL is currently asking for. Reading via
     *  URLSearchParams is safe — the `+`/`%20` asymmetry is a serialise-only
     *  problem, and `+` decodes back to a space here either way. */
    const slugFromUrl = () =>
        urlKey ? new URLSearchParams(location.search).get(urlKey) : null;

    // Initial tab — URL wins (through the alias map), else the default. Replace
    // mode, so a re-render never stacks a history entry, and an unknown slug is
    // normalised away instead of sitting in the URL describing a tab that isn't
    // open.
    activate(resolve(slugFromUrl()), { history: 'replace' });

    // Back/Forward between tabs.
    //
    // Self-evicting rather than caller-managed: every page that mounts tabs
    // re-renders in place — index.html/league.html/player.html via
    // onVisibleRevalidate (store.js) on tab-return and cross-tab storage
    // events, analyticsPage.js on every filter change — and each re-render
    // calls mountAppTabs again. Each of those paths clears the container
    // first, so a superseded shell is genuinely detached; checking isConnected
    // means a stale shell can never fight the live one over the URL, and it
    // unhooks itself the first time it wakes up detached.
    let onPop = null;
    if (urlKey) {
        onPop = () => {
            if (!root.isConnected) { window.removeEventListener('popstate', onPop); return; }
            activate(resolve(slugFromUrl()), { history: 'none' });
        };
        window.addEventListener('popstate', onPop);
    }

    return {
        root, panels, activate,
        destroy() { if (onPop) window.removeEventListener('popstate', onPop); },
    };
}