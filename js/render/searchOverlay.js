/**
 * searchOverlay.js — iOS-only search "sheet" that sidesteps Safari's
 * focus-zoom-on-sub-16px-input behaviour.
 *
 * On iOS, tapping any `.app-search-input` is intercepted BEFORE the native
 * input can focus (so iOS never zooms). Instead we open a fixed sheet pinned
 * to the top of the visual viewport whose own input is 16px — at/above the
 * threshold, so iOS leaves the zoom alone. For smart-search fields the results
 * render below the sheet input; picking a result either navigates (sidebar) or
 * writes the value back into the originating field and re-fires its `input`
 * handler (matchup / What-If / filters). Because we never zoom and never scroll
 * the underlying document, closing the sheet leaves the page exactly where it
 * was — only the field ends up filled.
 *
 * Non-iOS platforms don't have the zoom bug, so they never install this; on
 * Android the inline fields are simply enlarged to 16px via a coarse-pointer
 * media query (see `html:not(.is-ios) .app-search-input` in layout.css).
 *
 * Each field declares behaviour through a tiny adapter:
 *   registerSearchAdapter(inputEl, { suggest(query) => Item[]|Promise, pick(item) })
 *   Item = { label, sublabel?, key? }
 * Datalist-backed fields (`<input list=...>`) need NO registration — a default
 * adapter reads their `<option>`s and writes the pick back automatically.
 */

import { isMobile, closeSidebar } from './sidebarToggle.js';

/* ── iOS detection ────────────────────────────────────────────────────────
   Covers iPhone/iPod/iPad plus iPadOS 13+ which masquerades as "MacIntel"
   with a touch screen. A `?searchoverlay=force` / `=off` query param lets us
   exercise the sheet on a desktop browser (Playwright) where real iOS zoom
   can't be observed. */
function detectIOS() {
    const params = new URLSearchParams(location.search);
    const override = params.get('searchoverlay');
    if (override === 'force') return true;
    if (override === 'off') return false;
    const ua = navigator.userAgent || '';
    if (/iP(hone|od|ad)/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

let installed = false;
const adapters = new WeakMap();

/**
 * Register how a given input feeds + consumes the overlay. Called by the field
 * at mount time. Only consulted on iOS (no-op cost otherwise).
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
                <button class="search-sheet-close" type="button" aria-label="Close search" data-close>✕</button>
            </div>
            <ul class="search-sheet-results" role="listbox"></ul>
        </div>`;
    document.body.appendChild(sheet);

    sheetInput = sheet.querySelector('.search-sheet-input');
    sheetResults = sheet.querySelector('.search-sheet-results');

    // ONE delegated pointer handler for every tap inside the sheet. We use raw
    // Pointer Events (pointerup), NOT click/mousedown: when the sheet input is
    // focused (keyboard up), iOS treats the first tap elsewhere as a
    // keyboard-dismiss and SWALLOWS the synthesized click/mousedown — so those
    // never fire on the option/✕. pointerup is a native pointer event, not a
    // synthesized mouse event, so it fires normally; it also respects scroll (a
    // drag emits pointercancel, not pointerup). Covers mouse on desktop too.
    //   • tap on [data-close] (the ✕ button OR the backdrop scrim) → cancel
    //   • tap on a result row → select it
    const onSheetActivate = (e) => {
        if (e.target.closest('[data-close]')) { e.preventDefault(); closeOverlay(); return; }
        const opt = e.target.closest('.search-sheet-option');
        if (opt && opt._item) { e.preventDefault(); selectItem(opt._item); }
    };
    sheet.addEventListener('pointerup', onSheetActivate);   // primary (iOS-safe)
    sheet.addEventListener('click', onSheetActivate);        // desktop fallback; idempotent
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

        const text = document.createElement('span');
        text.className = 'search-sheet-option-text';
        const name = document.createElement('span');
        name.className = 'search-sheet-option-label';
        name.textContent = item.label;
        text.appendChild(name);
        if (item.sublabel) {
            const sub = document.createElement('span');
            sub.className = 'search-sheet-option-sub';
            sub.textContent = item.sublabel;
            text.appendChild(sub);
        }
        li.appendChild(text);

        // Selection is handled by the ONE delegated `pointerup` on the sheet
        // (see buildSheet) — it reads `li._item`. No per-row listener needed.
        sheetResults.appendChild(li);
    }
}

/* ── visualViewport pinning — keep the bar at the top of the VISIBLE area
   even while the iOS keyboard is up (same technique as the admin drawer). ── */
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

    sheet.hidden = false;
    document.documentElement.classList.add('search-sheet-open');
    // Focus the 16px input — iOS won't zoom because it's at the threshold.
    sheetInput.focus();
    if (sheetInput.value) refreshResults();
}

function closeOverlay() {
    if (!sheet || sheet.hidden) return;
    sheetInput.blur();                 // dismiss the keyboard → viewport restores
    sheet.hidden = true;
    document.documentElement.classList.remove('search-sheet-open');
    window.visualViewport?.removeEventListener('resize', pinToViewport);
    window.visualViewport?.removeEventListener('scroll', pinToViewport);
    currentAdapter = null;
    currentSrc = null;
}

/* ── Install — iOS only. Intercepts the tap before focus so no zoom fires. ── */
export function installSearchOverlay() {
    // Mark iOS once so the Android-only coarse-pointer 16px rule can exclude it.
    if (!detectIOS()) return;
    document.documentElement.classList.add('is-ios');
    if (installed) return;
    installed = true;

    // `mousedown` preventDefault blocks the input from focusing (so iOS never
    // zooms) while STILL letting the click through — the classic keep-focus
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
        input.blur();
        openOverlay(input);
    }, true);
}
