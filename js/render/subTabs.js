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

export function mountPillTabs(mountEl, { tabs, defaultId = null, pillClassFor = null, onSelect } = {}) {
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
