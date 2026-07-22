/**
 * combobox.js — the ONE canonical search field for the whole project.
 *
 * Replaces the ad-hoc "type → filter → list → pick" logic that used to be
 * re-implemented per search. Every player/entity picker mounts THIS and passes
 * only its own deltas (see the config below); the shared base owns:
 *
 *   • Touch vs non-touch separation — the base decides. On a touch device it
 *     NEVER opens the inline (under-the-field) list; the top search sheet
 *     (searchOverlay.js) is the only UI, and every field feeds it through the
 *     same adapter. On desktop the inline dropdown + keyboard nav work as usual.
 *   • The mobile sheet's shared chrome: 16px input (no zoom), pinned to the top,
 *     scroll-locked, browse-all on open, and a permanent Clear button.
 *   • Selection = write the value back + notify via a DIRECT `onChange(value)`
 *     callback — NOT a re-dispatched DOM `input` event — so a pick can never
 *     re-trigger the field's own "open on input" and re-open the list under it.
 *   • Standard extension hooks: getOptions/suggest (source), labelFor (display),
 *     decorate (flag / badge / sublabel), onPick (selection behaviour),
 *     resultTarget ('popup' inline list, or 'inplace' — no desktop popup, the
 *     caller renders results elsewhere e.g. filtering a table).
 *
 * Config (all optional):
 *   getOptions()      → (string | {value,label})[]   — sync source, substring-filtered here
 *   suggest(query)    → items | Promise<items>        — full control of matching + order
 *   labelFor(value)   → string                        — display text (default: the value)
 *   decorate(value)   → { flagCode?, badge?:{text,kind}, sublabel? }
 *   flagFor(value)    → html                           — legacy shorthand for a leading flag
 *   onPick(value)                                       — default: write value + onChange
 *   onChange(value)                                     — external notify (filters); direct call
 *   onSelect(value)                                     — legacy post-pick callback (kept)
 *   allowFreeText     — Enter with a non-list value is accepted (default true)
 *   resultTarget      — 'popup' (default) | 'inplace'  — mobile always uses the sheet
 */

import { registerSearchAdapter, isTouchDevice } from '../render/searchOverlay.js';
import { searchFlagHtml } from './helpers.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Normalize an option (string OR {value,label}) to a { value, label } pair.
function normOption(o) {
    if (o && typeof o === 'object') {
        const value = o.value != null ? o.value : (o.label != null ? o.label : '');
        return { value: String(value), label: String(o.label != null ? o.label : value) };
    }
    return { value: String(o), label: String(o) };
}

export function mountSearchField(input, opts = {}) {
    const {
        getOptions, suggest, labelFor, decorate, flagFor,
        onPick, onChange, onSelect,
        allowFreeText = true,
        resultTarget = 'popup',
    } = opts;

    const popup = resultTarget !== 'inplace';
    const touch = isTouchDevice();

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

    let filtered = [];   // current [{value,label}]
    let activeIdx = -1;
    let openSeq = 0;
    // Only used by the legacy notify path below (callers with neither onChange
    // nor onPick): guards the field's own open() while we re-emit a DOM `input`.
    let suppressOpen = false;

    // Resolve the item list for a query — `suggest` (may be async) wins, else a
    // substring filter over `getOptions`. Always returns a Promise<normOption[]>.
    function resolveItems(query) {
        const q = query.trim().toLowerCase();
        if (suggest) return Promise.resolve(suggest(query)).then(list => (list || []).map(normOption));
        const all = (getOptions ? getOptions() : []).map(normOption);
        const pool = q ? all.filter(o => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : all;
        return Promise.resolve(pool);
    }

    // Per-option display + decorations.
    function displayLabel(o) { return labelFor ? labelFor(o.value) : o.label; }
    function extrasFor(o) {
        const d = decorate ? (decorate(o.value) || {}) : {};
        const flagHtml = d.flagCode ? searchFlagHtml(d.flagCode) : (flagFor ? (flagFor(o.value) || '') : '');
        // titleHtml is trusted markup (BMAB / championship badges from
        // titleConstants.js, already escaped there) — rendered right after the name.
        return { iconHtml: d.iconHtml || '', flagHtml, titleHtml: d.titleHtml || '', badge: d.badge || null, sublabel: d.sublabel || '' };
    }

    function optionHtml(o, i) {
        const { iconHtml, flagHtml, titleHtml, badge, sublabel } = extrasFor(o);
        const name = escapeHtml(displayLabel(o));
        const rich = !!(iconHtml || flagHtml || titleHtml || badge || sublabel);
        if (!rich) return `<li class="app-combo-option" role="option" data-idx="${i}">${name}</li>`;
        return `<li class="app-combo-option app-combo-option--flag" role="option" data-idx="${i}">`
            + `${iconHtml}${flagHtml}<span class="app-combo-option-name">${name}${titleHtml}</span>`
            + (sublabel ? `<span class="app-combo-option-sub">${escapeHtml(sublabel)}</span>` : '')
            + (badge ? `<span class="sf-badge sf-badge--${escapeHtml(badge.kind)}">${escapeHtml(badge.text)}</span>` : '')
            + `</li>`;
    }

    function highlight() {
        const items = dropdown.querySelectorAll('.app-combo-option');
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    // Open the inline list. No-op on touch (the sheet is the only UI there) and
    // for inplace fields (no desktop popup at all).
    function open() {
        if (!popup || touch) return;
        const seq = ++openSeq;
        resolveItems(input.value).then(items => {
            if (seq !== openSeq) return;
            filtered = items;
            activeIdx = -1;
            if (filtered.length === 0) { close(); return; }
            dropdown.innerHTML = filtered.map(optionHtml).join('');
            dropdown.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        });
    }

    function close() {
        openSeq++;               // cancel any in-flight open()
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        activeIdx = -1;
    }

    // Selection: write the value, close, then notify. The canonical path uses
    // DIRECT callbacks (no DOM `input` event) so a pick can never re-open the
    // list. Callers that pass neither onPick nor onChange (legacy) still get a
    // one-shot DOM `input` event — guarded so it can't self-reopen.
    function choose(value) {
        if (onPick) { onPick(value); close(); return; }
        input.value = value;
        close();
        if (onChange || onSelect) {
            if (onChange) onChange(value);
            if (onSelect) onSelect(value);
        } else {
            suppressOpen = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            suppressOpen = false;
        }
    }

    // Programmatic reset — used by a caller's own Clear button. Empties the
    // field, closes the list, and notifies (so dependent filters reset) WITHOUT
    // re-focusing (focusing would re-open the list).
    function clear() {
        input.value = '';
        close();
        if (onChange) onChange('');
    }

    // Mobile sheet adapter — same source, decorations and pick path.
    registerSearchAdapter(input, {
        suggest(query) {
            return resolveItems(query).then(items => items.slice(0, 200).map(o => {
                const { iconHtml, flagHtml, titleHtml, badge, sublabel } = extrasFor(o);
                const item = { label: displayLabel(o), value: o.value, key: o.value };
                if (iconHtml) item.iconHtml = iconHtml;
                if (flagHtml) item.flagHtml = flagHtml;
                if (titleHtml) item.titleHtml = titleHtml;
                if (badge) item.badge = badge;
                if (sublabel) item.sublabel = sublabel;
                return item;
            }));
        },
        pick(item) { choose(item.value); },
    });

    const maybeOpen = () => { if (!suppressOpen) open(); };
    input.addEventListener('focus', maybeOpen);
    input.addEventListener('click', maybeOpen);
    input.addEventListener('input', () => {
        if (suppressOpen) return;
        // Real user typing: open the list (desktop) and notify filters live.
        open();
        if (onChange) onChange(input.value);
    });

    input.addEventListener('keydown', (e) => {
        if (dropdown.hidden) {
            if (e.key === 'Enter' && allowFreeText && onChange) onChange(input.value);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
            highlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            highlight();
        } else if (e.key === 'Enter') {
            if (activeIdx >= 0 && filtered[activeIdx]) {
                e.preventDefault();
                e.stopImmediatePropagation();
                choose(filtered[activeIdx].value);
            }
        } else if (e.key === 'Escape') {
            close();
        }
    });

    // mousedown (not click) so selection fires before the input's blur closes the list
    dropdown.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.app-combo-option');
        if (!li) return;
        e.preventDefault();
        choose(filtered[Number(li.dataset.idx)].value);
    });

    input.addEventListener('blur', () => setTimeout(close, 150));

    return { close, clear, wrap, dropdown };
}

// Backward-compatible alias — existing callers keep working unchanged.
export const mountCombobox = mountSearchField;
