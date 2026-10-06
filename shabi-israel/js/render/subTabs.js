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
 *   mountLeagueTypeFilter(mountEl, { types, selected?, trackFor?, onChange })
 *     League-type FILTER: several pills on at once, pooled; ALL clears them.
 *     Renders the canonical league-type pill itself — callers pass type ids.
 *
 *   mountAccordionTabs(barEl, { tabs, defaultOpenId?, onOpen, onClose })
 *     Expandable rows: zero or one panel open; clicking an open tab closes it.
 *     `tabs`: [{ id, label, panelId? }] (panelId defaults to id; the panel
 *     element must already exist in the DOM with that id). `onOpen(panelId,
 *     panelEl)` fires every time a panel opens (caller owns lazy-build vs
 *     re-render). `onClose(panelId)` fires when the user closes the open panel
 *     and nothing is left open — a caller that reflects the open panel in the
 *     URL needs it to clear the slug. Returns { open(panelId), toggle(panelId) }.
 */

/**
 * ALL — the type-agnostic pill token. Not a league type: filter bars use it for
 * the "no filter" tab. It is DEFINED in compute/leagueTypes.js — the compute
 * functions behind these pills have to recognise the same token, and they must
 * not import the render layer — and re-exported here so pill call sites keep
 * importing it from the primitive they already use. Styling comes from
 * `.league-type-pill.type-all` (components.css → --lt-all-* tokens).
 */
import { ALL_TYPES_ID, leagueTypeLabel, leagueTypeRank } from '../compute/leagueTypes.js';
export { ALL_TYPES_ID };
export const ALL_TYPES_LABEL = 'All';
export const ALL_TYPES_TAB = { id: ALL_TYPES_ID, label: ALL_TYPES_LABEL };

/**
 * Canonical left-to-right order for league-type pills. Every pill bar in the
 * app switches league types, so the order is enforced here (once) rather than
 * at each call site — callers may hand us tabs in data order, count order, etc.
 * ALL always sits leftmost. Tabs whose id isn't a known league type keep their
 * given order, after the known ones (Array.sort is stable).
 *
 * The order itself is leagueTypeRank's — Doubling → UBC → Regular — and is READ
 * from there, not restated. This used to be a list of its own (doubling,
 * regular, ubc), so the pills disagreed with every card and table the same
 * page ordered by leagueTypeRank.
 */
function orderPillTabs(tabs) {
    const rank = (id) => (id === ALL_TYPES_ID ? -1 : leagueTypeRank(id));
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
 * League-type FILTER — the site's own league-type pills, but several can be on
 * at once and the view pools everything selected.
 *
 * It renders THE league-type pill and nothing else: the label comes from
 * leagueTypes.js and the look from `.league-type-pill.type-<id>` (components.css
 * → the --lt-* tokens), so a caller passes type ids and cannot hand it a
 * different label or class. Mount it OUTSIDE any `.dash-controls` box — that
 * rule restyles every <button> inside it (border, square corners, padding) and
 * the pill stops looking like the pill everywhere else.
 *
 *   ALL            → clears every type and is the only pill left on.
 *   a type         → toggles; turning one on turns ALL off.
 *   last type off  → falls back to ALL (a filter never selects nothing).
 *   every type on  → collapses to ALL: it IS "no filter", and one state must
 *                    not have two looks (all pills lit vs. only ALL lit).
 *
 * A filter, not a view switch: the pills carry `aria-pressed` and no tab role
 * (same reasoning as mountFilterToggle below). That also keeps them out of the
 * analytics listener's generic `[role="tab"]` branch, which would log a bare
 * "Tab: Doubling" that names neither the section nor whether the pill went on or
 * off — so each pill carries its own `data-track`, from `trackFor`.
 *
 * @param {HTMLElement} mountEl  appended to
 * @param {object} opts
 *   types        {string[]} the league types on offer — WITHOUT ALL, which is
 *                added here when there is more than one type to choose from
 *   selected     {string[]|null} initial selection (null/empty = ALL)
 *   trackFor     (id, willBeOn) => the analytics target of the NEXT click on
 *                that pill. Written ahead of time because the analytics listener
 *                runs in the capture phase, before the click handler toggles.
 *   onChange     (ids|null) called on mount and after every click; null = ALL
 * @returns {{ bar: HTMLElement, get: () => string[]|null }}
 */
export function mountLeagueTypeFilter(mountEl, { types: typeIds, selected = null, trackFor = null, onChange } = {}) {
    const types = orderPillTabs(typeIds.map(id => ({ id, label: leagueTypeLabel(id) })));
    const offered = types.length > 1 ? [ALL_TYPES_TAB, ...types] : types;
    const on = new Set((selected || []).filter(id => types.some(t => t.id === id)));
    // Every type on is ALL (see above) — on a click and in the initial selection.
    const collapseFull = () => { if (types.length > 1 && on.size === types.length) on.clear(); };
    collapseFull();
    // A single type has nothing to filter between: it is simply on.
    if (types.length === 1) on.add(types[0].id);

    const bar = document.createElement('div');
    bar.className = 'subtabs subtabs--pill';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'League type filter');

    const isOn = (id) => (id === ALL_TYPES_ID ? on.size === 0 : on.has(id));
    const current = () => (on.size === 0 ? null : types.filter(t => on.has(t.id)).map(t => t.id));

    const btns = offered.map(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'subtab subtab--pill league-type-pill type-' + t.id;
        b.textContent = t.label;
        b.addEventListener('click', () => {
            if (types.length === 1) return;
            if (t.id === ALL_TYPES_ID) on.clear();
            else if (on.has(t.id)) on.delete(t.id);
            else on.add(t.id);
            collapseFull();
            paint();
            if (onChange) onChange(current());
        });
        bar.appendChild(b);
        return { id: t.id, el: b };
    });

    function paint() {
        for (const { id, el } of btns) {
            const active = isOn(id);
            el.classList.toggle('active', active);
            el.setAttribute('aria-pressed', active ? 'true' : 'false');
            // A lone pill does nothing when clicked, so it reports nothing.
            if (trackFor && types.length > 1) el.dataset.track = trackFor(id, id === ALL_TYPES_ID ? true : !active);
        }
    }

    mountEl.appendChild(bar);
    paint();
    if (onChange) onChange(current());
    return { bar, get: current };
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

export function mountAccordionTabs(barEl, { tabs, defaultOpenId = null, onOpen, onClose } = {}) {
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
        // Fired only here, never from the closeAll() inside open() — switching
        // panels would otherwise emit a spurious close between the two states.
        // A caller that puts the open panel in the URL needs this to clear it;
        // without it the URL claims a panel is open when nothing is.
        else if (onClose) onClose(b.dataset.panel);
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

/**
 * Filter toggle — one neutral pill that is ON or OFF.
 *
 * A toggle, NOT a tab: it carries `aria-pressed` and no `role`. `mountPillTabs`
 * looks superficially right for this and is wrong twice over — it declares
 * role="tablist"/role="tab" with aria-selected (a filter is not a view), and it
 * reorders its pills by league-type ranking.
 *
 * The class and the ARIA state are flipped together in `paint()` on purpose.
 * They are read by different consumers — CSS reads `.active`, assistive tech
 * reads `aria-pressed` — and when call sites did this by hand it was one line
 * away from a pill that changes colour but tells a screen reader nothing.
 *
 * Owns the control only. What the toggle DOES is the caller's business: hiding
 * rows client-side, re-querying with a different argument, whatever — the two
 * current call sites do exactly those two different things.
 *
 * @param {HTMLElement} mountEl   appended to (may be null to build detached)
 * @param {object} opts
 *   label     {string}   button text
 *   title     {string}   native tooltip; use it to say what "on" means
 *   pressed   {boolean}  initial state (default false)
 *   id        {string}   optional DOM id
 *   onToggle  {(on:boolean)=>void}
 * @returns {{ button: HTMLElement, set: (on:boolean)=>void, isOn: ()=>boolean }}
 */
export function mountFilterToggle(mountEl, { label, title = '', pressed = false, id = null, onToggle } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subtab subtab--pill pill-neutral';
    if (id) btn.id = id;
    if (title) btn.title = title;
    btn.textContent = label;

    const paint = (on) => {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('active', !!on);
    };
    paint(pressed);

    btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        paint(on);
        if (onToggle) onToggle(on);
    });

    if (mountEl) mountEl.appendChild(btn);
    return { button: btn, set: paint, isOn: () => btn.getAttribute('aria-pressed') === 'true' };
}
