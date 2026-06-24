/**
 * appTabs.js — Reusable segmented-tab controller (pairs with css/tabs.css).
 *
 * One call builds the tablist + the panels and wires:
 *   • click activation
 *   • URL state  (?<urlKey>=<id>, the default tab is omitted)
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
 *   });
 *   container.appendChild(root);
 *   renderLeagues(panels.leagues);   // fill each panel by id; signatures unchanged
 *
 * Returns { root, panels: {[id]: HTMLElement}, activate(id) }.
 *
 * A11y contract (consumed by css/tabs.css):
 *   • tablist  → role="tablist" + aria-label
 *   • each tab → role="tab", id, aria-controls, aria-selected, roving tabindex
 *   • each panel → role="tabpanel", id, aria-labelledby, class `app-tab-panel`
 *     (+ any caller panelClass) and data-panel="<id>" for page-level CSS hooks.
 *   The FIRST tab is the default — its id is never written to the URL.
 */

let _groupSeq = 0;

export function mountAppTabs({
    tabs,
    urlKey = 'tab',
    ariaLabel = 'Sections',
    shellClass = '',
    panelClass = '',
    hotkeys = true,
} = {}) {
    if (!Array.isArray(tabs) || tabs.length === 0) {
        throw new Error('mountAppTabs: `tabs` must be a non-empty array');
    }

    const gid = `apptabs-${++_groupSeq}`;
    const ids = tabs.map(t => t.id);
    const defaultId = ids[0];
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
    function syncUrl(id) {
        if (!urlKey) return;
        const u = new URL(location);
        if (id === defaultId) u.searchParams.delete(urlKey);
        else u.searchParams.set(urlKey, id);
        history.replaceState({}, '', u);
    }

    function activate(id, { focus = false } = {}) {
        if (!ids.includes(id)) id = defaultId;
        tabs.forEach(t => {
            const selected = t.id === id;
            buttons[t.id].setAttribute('aria-selected', selected ? 'true' : 'false');
            buttons[t.id].tabIndex = selected ? 0 : -1;
            panels[t.id].hidden = !selected;
        });
        if (focus) buttons[id].focus();
        syncUrl(id);
    }

    tabs.forEach(t => buttons[t.id].addEventListener('click', () => activate(t.id)));

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
        activate(ids[next], { focus: true });
    });

    // Optional 1-N number hotkeys — skipped while a form field is focused.
    if (hotkeys) {
        root.addEventListener('keydown', e => {
            if (e.target.matches('input, textarea, select')) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= tabs.length) activate(ids[n - 1]);
        });
    }

    // Initial tab — URL wins, else the default.
    const fromUrl = urlKey ? new URL(location).searchParams.get(urlKey) : null;
    activate(ids.includes(fromUrl) ? fromUrl : defaultId);

    return { root, panels, activate };
}