/**
 * combobox.js — canonical themed replacement for native `<input list> +
 * <datalist>`. Native datalist popups are OS/browser chrome: no CSS can
 * touch their background/border, so they render "white" regardless of the
 * site's own theme. This builds the same suggest-as-you-type UX as a plain
 * DOM `<ul>` (fully themed via .app-combo-* in layout.css) and wires the
 * mobile search-sheet adapter so touch devices still get the 16px overlay.
 *
 * Usage: mountCombobox(input, { getOptions: () => string[] })
 * The input keeps its own value; on pick it's set to the chosen option and
 * a bubbling `input` event fires so existing change handlers keep working.
 */

import { registerSearchAdapter } from '../render/searchOverlay.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function mountCombobox(input, { getOptions, onSelect, flagFor } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'app-combo-wrap';
    input.replaceWith(wrap);
    wrap.appendChild(input);

    const dropdown = document.createElement('ul');
    dropdown.className = 'app-combo-dropdown';
    dropdown.hidden = true;
    dropdown.setAttribute('role', 'listbox');
    wrap.appendChild(dropdown);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');

    let filtered = [];
    let activeIdx = -1;

    function highlight() {
        const items = dropdown.querySelectorAll('.app-combo-option');
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    function open() {
        const q = input.value.trim().toLowerCase();
        const all = getOptions ? getOptions() : [];
        filtered = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all.slice();
        activeIdx = -1;
        if (filtered.length === 0) { close(); return; }
        dropdown.innerHTML = filtered
            .map((v, i) => {
                const name = escapeHtml(v);
                // Optional country flag left of the name (player-name pickers).
                return flagFor
                    ? `<li class="app-combo-option app-combo-option--flag" role="option" data-idx="${i}">${flagFor(v)}<span class="app-combo-option-name">${name}</span></li>`
                    : `<li class="app-combo-option" role="option" data-idx="${i}">${name}</li>`;
            })
            .join('');
        dropdown.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function close() {
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        activeIdx = -1;
    }

    function choose(val) {
        input.value = val;
        close();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (onSelect) onSelect(val);
    }

    // Mobile search-sheet adapter: same option source, feeds the 16px overlay.
    registerSearchAdapter(input, {
        suggest(query) {
            const q = query.trim().toLowerCase();
            const all = getOptions ? getOptions() : [];
            const pool = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all;
            return pool.slice(0, 50).map(v => {
                const item = { label: v, key: v, value: v };
                if (flagFor) item.flagHtml = flagFor(v);
                return item;
            });
        },
        pick(item) { choose(item.value); },
    });

    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('input', open);

    input.addEventListener('keydown', (e) => {
        if (dropdown.hidden) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
            highlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            highlight();
        } else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx] !== undefined) {
            e.preventDefault();
            e.stopImmediatePropagation();
            choose(filtered[activeIdx]);
        } else if (e.key === 'Escape') {
            close();
        }
    });

    // mousedown (not click) so selection fires before the input's blur closes the list
    dropdown.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.app-combo-option');
        if (!li) return;
        e.preventDefault();
        choose(filtered[Number(li.dataset.idx)]);
    });

    input.addEventListener('blur', () => setTimeout(close, 150));

    return { close, wrap, dropdown };
}
