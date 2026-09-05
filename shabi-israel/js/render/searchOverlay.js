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
 * Does a tap on this field open the sheet?
 *
 * No, when the field's results are rendered IN THE PAGE (`resultTarget:
 * 'inplace'` — the Players directory, where every keystroke filters the table
 * sitting under the box). Such a field has no separate result surface to show
 * on ANY device: the table already IS the result list, so a sheet would stack a
 * second list of the same players on top of it and force a pick where desktop
 * only ever filters. Its adapter is marked `inplace` and the interceptor below
 * leaves its taps alone, so it behaves as the plain filter box it is.
 *
 * Not registering an adapter at all would NOT achieve this: the interceptor
 * fires on the class, and an unregistered field falls through to the datalist
 * adapter — an empty sheet, which is worse than the wrong one.
 */
function usesSheet(input) {
    return !adapters.get(input)?.inplace;
}

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
        if (opt && opt._item && !opt._item.disabled) { e.preventDefault(); selectItem(opt._item); }
    });
    sheetInput.addEventListener('input', refreshResults);
    sheetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeOverlay(); return; }
        if (e.key === 'Enter') {
            const first = sheetResults.querySelector('.search-sheet-option:not(.is-disabled)');
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
        // `item.disabled` — listed but unpickable (e.g. a What-If opponent whose
        // match is already staged). The tap/Enter handlers below skip these.
        li.className = item.disabled ? 'search-sheet-option is-disabled' : 'search-sheet-option';
        li.setAttribute('role', 'option');
        if (item.disabled) li.setAttribute('aria-disabled', 'true');
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
        // `nameHtml` is trusted markup the adapter assembled (the snapshot
        // picker's "A beats B", both identities with their flags and title
        // badges) — a row whose SUBJECT is more than one player cannot be
        // expressed as a single escaped name. `label` stays the plain-text form
        // and is what the filter matches on, so the two never diverge.
        if (item.nameHtml) name.innerHTML = item.nameHtml;
        else name.textContent = item.label;
        // Optional title badges (BMAB rank / championship: G0 / WC / NC …),
        // trusted pre-escaped markup from titleConstants.js, inline after the name.
        if (item.titleHtml) name.insertAdjacentHTML('beforeend', item.titleHtml);
        // Optional luck percentile — trusted pre-escaped markup from
        // utils/playerLuckBadge.js, carrying its own inline colour. Like the
        // desktop row, it is a SIBLING of the name, never inside it: title
        // badges are part of how a player is addressed, a luck percentile is a
        // measurement about them, and only a sibling is safe from whatever the
        // name span does to its own contents (a future ellipsis on a long name
        // would otherwise carry the figure off-screen with it).
        //
        // `.search-sheet-option-text` is a COLUMN flex (name above sublabel), so
        // the pair needs its own row to sit side by side — that is what this
        // line wrapper is for. Added only when there is a figure to place, so
        // every other row keeps the markup it had.
        if (item.luckHtml) {
            const nameLine = document.createElement('span');
            nameLine.className = 'search-sheet-option-nameline';
            nameLine.appendChild(name);
            nameLine.insertAdjacentHTML('beforeend', item.luckHtml);
            text.appendChild(nameLine);
        } else {
            text.appendChild(name);
        }
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
   even while the on-screen keyboard is up (same technique as the admin drawer).

   EXPORTED because there are now two things that need to sit above the
   keyboard: the sheet, and (for a field whose results are the page, so no sheet
   opens) the field itself. That is ONE behaviour — "on touch, the typing
   surface is at the top" — and it must not be implemented twice, or mobile
   breaks in half the searches the day the two copies drift. Callers get a stop
   function; call it on close/blur. ── */
export function trackVisualViewport(el) {
    const apply = () => {
        const vv = window.visualViewport;
        if (!vv || !el) return;
        el.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        el.style.setProperty('--vv-height', `${vv.height}px`);
    };
    apply();
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
    return () => {
        window.visualViewport?.removeEventListener('resize', apply);
        window.visualViewport?.removeEventListener('scroll', apply);
    };
}

let untrackViewport = null;

function openOverlay(srcInput) {
    if (!sheet) buildSheet();
    currentSrc = srcInput;
    currentAdapter = adapters.get(srcInput) || defaultDatalistAdapter(srcInput);

    // Narrow viewport: get the off-canvas drawer out of the way so the sheet
    // is the only chrome on screen (the page itself stays put underneath).
    if (isMobile()) closeSidebar();

    sheetInput.placeholder = srcInput.getAttribute('placeholder') || 'Search…';
    // A `browseOnOpen` field opens on the WHOLE list, exactly as it does on
    // desktop — its value is a standing selection, not a query to refine, so
    // carrying it in filtered the sheet down to the one name already chosen.
    // Every other field keeps its text, where the text really is a query.
    sheetInput.value = currentAdapter.browseOnOpen ? '' : (srcInput.value || '');
    sheetResults.innerHTML = '';

    untrackViewport = trackVisualViewport(sheet);

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
    untrackViewport?.();
    untrackViewport = null;
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
        const input = e.target.closest?.('.app-search-input');
        if (input && usesSheet(input)) e.preventDefault();
    }, true);

    // Capture-phase click: stopPropagation so the field's OWN focus/click
    // handlers (e.g. the What-If combo's open-on-click) never fire — the sheet
    // is the only thing that opens. Then open it.
    document.addEventListener('click', (e) => {
        const input = e.target.closest?.('.app-search-input');
        if (!input || !usesSheet(input)) return;
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
