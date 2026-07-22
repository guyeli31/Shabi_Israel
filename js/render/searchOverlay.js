/**
 * searchOverlay.js — mobile search "sheet" for every touch device.
 *
 * On any touch device (phones + tablets), tapping any `.app-search-input` is
 * intercepted BEFORE the native input can focus, and we open a fixed sheet
 * pinned to the top of the visual viewport whose own input is 16px — large
 * enough that mobile browsers don't zoom the page on focus, and a comfortable
 * mobile typing size besides. For smart-search fields the results render below
 * the sheet input; picking a result either navigates (sidebar) or writes the
 * value back into the originating field and re-fires its `input` handler
 * (matchup / What-If / filters). Because we never zoom and never scroll the
 * underlying document, closing the sheet leaves the page exactly where it was —
 * only the field ends up filled.
 *
 * Desktop (fine pointer) never installs this — the inline fields work as-is.
 *
 * Each field declares behaviour through a tiny adapter:
 *   registerSearchAdapter(inputEl, { suggest(query) => Item[]|Promise, pick(item) })
 *   Item = { label, sublabel?, key? }
 * Datalist-backed fields (`<input list=...>`) need NO registration — a default
 * adapter reads their `<option>`s and writes the pick back automatically.
 */

import { isMobile, closeSidebar } from './sidebarToggle.js';

/* ── Touch-device detection ───────────────────────────────────────────────
   The sheet runs on any touch / coarse-pointer device (phones + tablets). A
   `?searchoverlay=force` / `=off` query param overrides detection — used by the
   typo-editor device preview and by Playwright, where there's no real touch
   input to detect. */
export function isTouchDevice() {
    const params = new URLSearchParams(location.search);
    const override = params.get('searchoverlay');
    if (override === 'force') return true;
    if (override === 'off') return false;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

let installed = false;
const adapters = new WeakMap();

/**
 * Register how a given input feeds + consumes the overlay. Called by the field
 * at mount time. Only consulted on touch devices (no-op cost otherwise).
 */
export function registerSearchAdapter(inputEl, adapter) {
    if (inputEl) adapters.set(inputEl, adapter);
}

/* ── Default adapter for `<input list="...">` (datalist) fields ──────────── */
function defaultDatalistAdapter(input) {
    return {
        suggest(query) {
            const list = input.list;
            if (!list) return [];
            const q = query.trim().toLowerCase();
            const opts = [...list.options].map(o => o.value).filter(Boolean);
            const pool = q ? opts.filter(v => v.toLowerCase().includes(q)) : opts;
            return pool.slice(0, 50).map(v => ({ label: v, key: v }));
        },
        pick(item) {
            input.value = item.label;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        },
    };
}

/* ── Sheet construction (built once, reused) ─────────────────────────────── */
let sheet, sheetInput, sheetResults, currentAdapter = null, currentSrc = null;

function buildSheet() {
    sheet = document.createElement('div');
    sheet.className = 'search-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `
        <div class="search-sheet-scrim" data-close></div>
        <div class="search-sheet-panel">
            <div class="search-sheet-bar">
                <svg class="search-sheet-icon" viewBox="0 0 16 16" width="16" height="16" fill="none"
                     stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
                </svg>
                <input class="search-sheet-input" type="text" inputmode="search"
                       autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                <button class="search-sheet-clear" type="button" aria-label="Clear search" data-clear>Clear</button>
                <button class="search-sheet-close" type="button" aria-label="Close search" data-close>✕</button>
            </div>
            <ul class="search-sheet-results" role="listbox"></ul>
        </div>`;
    document.body.appendChild(sheet);

    sheetInput = sheet.querySelector('.search-sheet-input');
    sheetResults = sheet.querySelector('.search-sheet-results');

    // Delegated Pointer Events (not click/mousedown, which mobile browsers
    // swallow on the keyboard-dismiss first-tap). Split by role:
    //   • CLOSE — the ✕ button OR the backdrop scrim ([data-close]) — acts on
    //     `pointerdown`: the EARLIEST touch event, fired on finger-down before
    //     the OS decides "keyboard dismiss" (so it can't be swallowed) and
    //     before any scroll interpretation. This is why ✕/backdrop now close
    //     reliably. `preventDefault` also stops the synthesized click that
    //     could otherwise land on — and reopen from — an element underneath.
    //   • SELECT — a result row — acts on `pointerup`, so a scroll-drag over a
    //     long results list emits pointercancel and does NOT select.
    sheet.addEventListener('pointerdown', (e) => {
        // Permanent Clear — empties the query and shows the full list again
        // (browse-all), WITHOUT closing the sheet. Distinct from ✕ (close).
        if (e.target.closest('[data-clear]')) {
            e.preventDefault();
            sheetInput.value = '';
            refreshResults();
            sheetInput.focus();
            return;
        }
        if (e.target.closest('[data-close]')) { e.preventDefault(); closeOverlay(); }
    });
    sheet.addEventListener('pointerup', (e) => {
        const opt = e.target.closest('.search-sheet-option');
        if (opt && opt._item) { e.preventDefault(); selectItem(opt._item); }
    });
    sheetInput.addEventListener('input', refreshResults);
    sheetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeOverlay(); return; }
        if (e.key === 'Enter') {
            const first = sheetResults.querySelector('.search-sheet-option');
            if (first && first._item) { e.preventDefault(); selectItem(first._item); }
        }
    });
}

let refreshSeq = 0;
async function refreshResults() {
    if (!currentAdapter) return;
    const query = sheetInput.value;
    const seq = ++refreshSeq;
    let items = [];
    try { items = await currentAdapter.suggest(query); } catch { items = []; }
    if (seq !== refreshSeq) return; // a newer keystroke won
    renderList(items);
}

function selectItem(item) {
    const adapter = currentAdapter;
    closeOverlay();
    if (adapter) adapter.pick(item);
}

function renderList(items) {
    sheetResults.innerHTML = '';
    if (!items || items.length === 0) {
        if (sheetInput.value.trim()) {
            const li = document.createElement('li');
            li.className = 'search-sheet-empty';
            li.textContent = 'No matches found';
            sheetResults.appendChild(li);
        }
        return;
    }
    for (const item of items) {
        const li = document.createElement('li');
        li.className = 'search-sheet-option';
        li.setAttribute('role', 'option');
        li._item = item;

        // Optional leading icon (league glyph / player avatar). The adapter
        // hands us trusted, pre-escaped markup; we reuse the flyout's
        // `.search-icon` styling, shared via navigation.css (.search-sheet-results).
        if (item.iconHtml) {
            const icon = document.createElement('span');
            icon.className = 'search-sheet-option-icon';
            icon.innerHTML = item.iconHtml;
            li.appendChild(icon);
        }

        // Optional country flag, immediately left of the name (player lists).
        if (item.flagHtml) {
            const tmp = document.createElement('template');
            tmp.innerHTML = item.flagHtml.trim();
            if (tmp.content.firstChild) li.appendChild(tmp.content.firstChild);
        }

        const text = document.createElement('span');
        text.className = 'search-sheet-option-text';
        const name = document.createElement('span');
        name.className = 'search-sheet-option-label';
        name.textContent = item.label;
        // Optional title badges (BMAB rank / championship: G0 / WC / NC …),
        // trusted pre-escaped markup from titleConstants.js, inline after the name.
        if (item.titleHtml) name.insertAdjacentHTML('beforeend', item.titleHtml);
        text.appendChild(name);
        if (item.sublabel) {
            const sub = document.createElement('span');
            sub.className = 'search-sheet-option-sub';
            sub.textContent = item.sublabel;
            text.appendChild(sub);
        }
        li.appendChild(text);

        // Optional trailing pill (What-If Player B: WON / LOST / DREW / NOT-PLAYED).
        // `kind` names the modifier class directly (css/search-overlay.css).
        if (item.badge) {
            const kind = /^[a-z]+$/.test(item.badge.kind || '') ? item.badge.kind : 'unplayed';
            const badge = document.createElement('span');
            badge.className = `search-sheet-badge search-sheet-badge--${kind}`;
            badge.textContent = item.badge.text;
            li.appendChild(badge);
        }

        // Selection is handled by the ONE delegated `pointerup` on the sheet
        // (see buildSheet) — it reads `li._item`. No per-row listener needed.
        sheetResults.appendChild(li);
    }
}

/* ── visualViewport pinning — keep the bar at the top of the VISIBLE area
   even while the on-screen keyboard is up (same technique as the admin drawer). ── */
function pinToViewport() {
    const vv = window.visualViewport;
    if (!vv || !sheet) return;
    sheet.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    sheet.style.setProperty('--vv-height', `${vv.height}px`);
}

function openOverlay(srcInput) {
    if (!sheet) buildSheet();
    currentSrc = srcInput;
    currentAdapter = adapters.get(srcInput) || defaultDatalistAdapter(srcInput);

    // Narrow viewport: get the off-canvas drawer out of the way so the sheet
    // is the only chrome on screen (the page itself stays put underneath).
    if (isMobile()) closeSidebar();

    sheetInput.placeholder = srcInput.getAttribute('placeholder') || 'Search…';
    sheetInput.value = srcInput.value || '';
    sheetResults.innerHTML = '';

    pinToViewport();
    window.visualViewport?.addEventListener('resize', pinToViewport);
    window.visualViewport?.addEventListener('scroll', pinToViewport);

    // Lock the page WITHOUT losing its scroll position. Setting `overflow:hidden`
    // on the scrolling root (<html>) collapses the page to the top on some mobile
    // browsers — the "field jumped the page" bug. Instead we pin <body> with a
    // negative top equal to the current scroll, then restore it on close, so the
    // view stays exactly where it was.
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${savedScrollY}px`;

    sheet.hidden = false;
    document.documentElement.classList.add('search-sheet-open');
    // Focus the 16px input — large enough that mobile browsers won't zoom.
    sheetInput.focus();
    // Show the full option list immediately on open (empty query → all items),
    // so tapping a picker behaves like the desktop combo's click-to-browse.
    refreshResults();
}

let lastCloseTs = 0;
let savedScrollY = 0;
function closeOverlay() {
    if (!sheet || sheet.hidden) return;
    sheetInput.blur();                 // dismiss the keyboard → viewport restores
    sheet.hidden = true;
    lastCloseTs = Date.now();          // guard against a ghost-click reopen (below)
    document.documentElement.classList.remove('search-sheet-open');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);  // restore the exact pre-open scroll position
    window.visualViewport?.removeEventListener('resize', pinToViewport);
    window.visualViewport?.removeEventListener('scroll', pinToViewport);
    currentAdapter = null;
    currentSrc = null;
}

/* ── Install — touch devices only. Intercepts the tap before focus. ── */
export function installSearchOverlay() {
    if (!isTouchDevice()) return;
    if (installed) return;
    installed = true;

    // `mousedown` preventDefault blocks the input from focusing (so the page
    // never zooms) while STILL letting the click through — the classic keep-focus
    // trick. We deliberately use mousedown, not pointerdown/touchstart, because
    // cancelling those would also cancel the click. Capture phase so it beats
    // the field's own listeners.
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest?.('.app-search-input')) e.preventDefault();
    }, true);

    // Capture-phase click: stopPropagation so the field's OWN focus/click
    // handlers (e.g. the What-If combo's open-on-click) never fire — the sheet
    // is the only thing that opens. Then open it.
    document.addEventListener('click', (e) => {
        const input = e.target.closest?.('.app-search-input');
        if (!input) return;
        e.preventDefault();
        e.stopPropagation();
        // Ignore the "ghost click" that fires right after a close-tap: closing
        // on pointerdown hides the sheet, then the tap's synthesized click can
        // land on the field underneath and re-open. Swallow opens for a beat.
        if (Date.now() - lastCloseTs < 500) return;
        input.blur();
        openOverlay(input);
    }, true);
}
