/**
 * subTabs.js — the single in-section sub-tab primitive (pairs with css/subtabs.css).
 *
 * Two variants, one per interaction model:
 *
 *   mountPillTabs(mountEl, { tabs, defaultId?, pillClassFor?, onSelect })
 *     League-type pill switcher: exactly one tab active; clicking switches.
 *     `tabs`: [{ id, label }]. `pillClassFor(id)` → extra classes for the pill
 *     (e.g. 'league-type-pill type-doubling'). `onSelect(id)` renders/toggles the
 *     content for the selected tab (called once on mount for the default tab).
 *     Returns { bar, select(id) }.
 *
 *   mountAccordionTabs(barEl, { tabs, defaultOpenId?, onOpen })
 *     Expandable rows: zero or one panel open; clicking an open tab closes it.
 *     `tabs`: [{ id, label, panelId? }] (panelId defaults to id; the panel
 *     element must already exist in the DOM with that id). `onOpen(panelId,
 *     panelEl)` fires every time a panel opens (caller owns lazy-build vs
 *     re-render). Returns { open(panelId), toggle(panelId) }.
 */

/**
 * ALL — the type-agnostic pill token. Not a league type: filter bars use it for
 * the "no filter" tab, so it lives here next to the real types rather than being
 * re-invented as a magic 'all' string at each call site. Styling comes from
 * `.league-type-pill.type-all` (components.css → --lt-all-* tokens).
 */
export const ALL_TYPES_ID = 'all';
export const ALL_TYPES_LABEL = 'All';
export const ALL_TYPES_TAB = { id: ALL_TYPES_ID, label: ALL_TYPES_LABEL };

/**
 * Canonical left-to-right order for league-type pills. Every pill bar in the
 * app switches league types, so the order is enforced here (once) rather than
 * at each call site — callers may hand us tabs in data order, count order, etc.
 * ALL always sits leftmost. Tabs whose id isn't a known league type keep their
 * given order, after the known ones (Array.sort is stable).
 */
const PILL_TYPE_ORDER = [ALL_TYPES_ID, 'doubling', 'regular', 'ubc'];
function orderPillTabs(tabs) {
    const rank = (id) => {
        const i = PILL_TYPE_ORDER.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...tabs].sort((a, b) => rank(a.id) - rank(b.id));
}

export function mountPillTabs(mountEl, { tabs, defaultId = null, pillClassFor = null, onSelect } = {}) {
    tabs = orderPillTabs(tabs);

    const bar = document.createElement('div');
    bar.className = 'subtabs subtabs--pill';
    bar.setAttribute('role', 'tablist');

    const btns = {};
    tabs.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'subtab subtab--pill' + (pillClassFor ? ' ' + pillClassFor(t.id) : '');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', 'false');
        b.textContent = t.label;
        b.addEventListener('click', () => select(t.id));
        btns[t.id] = b;
        bar.appendChild(b);
    });
    mountEl.appendChild(bar);

    function select(id) {
        for (const t of tabs) {
            const on = t.id === id;
            btns[t.id].classList.toggle('active', on);
            btns[t.id].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        if (onSelect) onSelect(id);
    }

    const start = defaultId != null ? defaultId : (tabs[0] && tabs[0].id);
    if (start != null) select(start);
    return { bar, select };
}

/**
 * Match-length sub-selector — a secondary, lighter pill row that narrows a
 * histogram to one match length (e.g. after the league-type pill is chosen).
 * A different match length is a genuinely different win-probability model, so
 * a view built on it must be read on its own.
 *
 * Rendered only when there is more than one length to choose between — a
 * single-length view has nothing to disambiguate, so the selector is omitted.
 * Reuses the pill primitive, so it inherits the themed look (see the `.ml-*`
 * rules in subtabs.css).
 *
 * @param {HTMLElement} mountEl  where to append the selector
 * @param {object} opts
 *   lengths     {number[]} the distinct match lengths available
 *   defaultLen  {number|null} pre-selected length (falls back to "All"/first)
 *   includeAll  {boolean} offer an "All lengths" option (default true). Set
 *               false where mixing lengths would be wrong (e.g. a view compared
 *               against a single win-probability table column).
 *   onSelect(lenOrNull) called with the chosen length, or null for "All".
 * @returns {{ wrap: HTMLElement, select: (id:string)=>void } | null}
 */
export function mountLengthSelector(mountEl, { lengths, defaultLen = null, includeAll = true, onSelect } = {}) {
    const uniq = [...new Set(lengths)].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (uniq.length < 2) return null;   // nothing to choose between → no selector

    const wrap = document.createElement('div');
    wrap.className = 'ml-select';
    const cap = document.createElement('span');
    cap.className = 'ml-select-cap';
    cap.textContent = 'Match length';
    wrap.appendChild(cap);
    mountEl.appendChild(wrap);

    const tabs = [
        ...(includeAll ? [{ id: 'all', label: 'All lengths' }] : []),
        ...uniq.map(l => ({ id: String(l), label: `${l} pt` })),
    ];
    const startId = defaultLen != null && uniq.includes(defaultLen)
        ? String(defaultLen)
        : (includeAll ? 'all' : String(uniq[0]));

    const { select } = mountPillTabs(wrap, {
        tabs,
        defaultId: startId,
        pillClassFor: () => 'ml-pill',
        onSelect: (id) => onSelect(id === 'all' ? null : Number(id)),
    });
    return { wrap, select };
}

export function mountAccordionTabs(barEl, { tabs, defaultOpenId = null, onOpen } = {}) {
    barEl.classList.add('subtabs', 'subtabs--accordion');

    const btns = tabs.map(t => {
        const panelId = t.panelId || t.id;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'subtab subtab--accordion';
        b.dataset.panel = panelId;
        b.innerHTML = `<span class="subtab-arrow">&#x25B8;</span> ${t.label}`;
        b.addEventListener('click', () => toggle(b));
        barEl.appendChild(b);
        return b;
    });

    function closeAll() {
        for (const b of btns) {
            const p = document.getElementById(b.dataset.panel);
            if (p) p.hidden = true;
            b.classList.remove('is-open');
            const arr = b.querySelector('.subtab-arrow');
            if (arr) arr.innerHTML = '&#x25B8;';
        }
    }
    function open(b) {
        closeAll();
        const p = document.getElementById(b.dataset.panel);
        if (!p) return;
        p.hidden = false;
        b.classList.add('is-open');
        const arr = b.querySelector('.subtab-arrow');
        if (arr) arr.innerHTML = '&#x25BE;';
        if (onOpen) onOpen(b.dataset.panel, p);
    }
    function toggle(b) {
        const p = document.getElementById(b.dataset.panel);
        const wasOpen = p && !p.hidden;
        closeAll();
        if (!wasOpen) open(b);
    }

    if (defaultOpenId != null) {
        const db = btns.find(b => b.dataset.panel === defaultOpenId);
        if (db) open(db);
    }

    return {
        open: (panelId) => { const b = btns.find(x => x.dataset.panel === panelId); if (b) open(b); },
        toggle: (panelId) => { const b = btns.find(x => x.dataset.panel === panelId); if (b) toggle(b); },
    };
}
