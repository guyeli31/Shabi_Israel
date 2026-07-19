/**
 * scrollOffset.js — live measurement of whatever chrome is currently pinned
 * to the top of the viewport (the site topbar today), for deep-link/jump
 * scrolling that needs to clear it.
 *
 * Deliberately NOT a cached constant (e.g. --topbar-height): it re-measures
 * the actual rendered DOM every call, so it stays correct if the topbar's
 * height changes, or anything else becomes fixed/sticky at the top later
 * (e.g. a hero banner) — no code change needed here when that happens.
 *
 * THIS MODULE IS THE ONE WAY TO SCROLL A SECTION INTO VIEW. Nothing else may
 * scroll the page to a section by hand:
 *
 *   · Link clicks  → handled for you. `installSectionLinkScroll()` (below) is
 *                    called once from mountTopbar(), so EVERY `<a href="#id">`
 *                    that points into the current page — on any surface, in any
 *                    page — is already routed through the corrected scroll. Do
 *                    not add per-surface click wiring for this.
 *   · Everything    → call `scrollToClearingTopbar(target)` directly.
 *     else (button
 *     handlers, …)
 *
 * The two things NOT to reach for, both of which caused real bugs here:
 *   ✗ `el.scrollIntoView({block:'start'})` — aligns to the top of the SCROLLPORT,
 *     and a `position:fixed` topbar does not shrink the scrollport, so the
 *     element lands underneath it.
 *   ✗ a CSS `scroll-margin-top` constant to compensate — it silently drifts from
 *     the chrome's real height (and the chrome isn't always there: the topbar
 *     only shows while the sidebar is CLOSED).
 * `block:'nearest'` inside a scrollable dropdown/listbox is unrelated and fine.
 */

/** Height of whatever is currently pinned to the very top of the viewport.
 *  Scoped to `body`'s (and `#app`'s, if present) direct children — that's
 *  where global chrome mounts (see js/render/topbar.js's
 *  `document.body.appendChild`) — so this stays cheap instead of walking
 *  the whole page on every scroll. */
export function measureFixedTopOffset() {
    const app = document.getElementById('app');
    const candidates = [...document.body.children, ...(app ? app.children : [])];
    let offset = 0;
    for (const el of candidates) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.top <= 1) offset = Math.max(offset, rect.bottom);
    }
    return offset;
}

/** Reads the live `--space-md` design token instead of duplicating its value
 *  as a JS literal — if the token changes (or a theme overrides it), this
 *  follows automatically with no code change here. */
function readSpaceMdPx() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--space-md');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 16;
}

/** Scroll so `target`'s top edge clears the fixed top chrome + a small
 *  breathing-room gap, instead of landing flush underneath it. `breathingRoom`
 *  defaults to the live `--space-md` token (see readSpaceMdPx) rather than a
 *  hardcoded number, so it too stays in sync with the rest of the design system. */
export function scrollToClearingTopbar(target, { breathingRoom, behavior = 'auto' } = {}) {
    const gap = breathingRoom ?? readSpaceMdPx();
    const offset = measureFixedTopOffset() + gap;
    const targetY = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, targetY), behavior });
}

/** Shared so every jump animates (or doesn't) by the same rule. */
export function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

let sectionLinkScrollInstalled = false;

/**
 * Install the ONE document-level handler that owns same-page section links.
 * Called from mountTopbar() — the module that puts fixed chrome at the top of
 * the viewport is also the one that installs the compensation for it, so a page
 * cannot mount the topbar and forget to wire this. Idempotent.
 *
 * WHY a listener at all, rather than letting the browser follow the href:
 * a link like `index.html?tab=records#records-pr` only causes a document load
 * while you're on a DIFFERENT url. Click it again once you're already there and
 * the browser treats it as a same-document fragment navigation — no reload, so
 * any scroll correction that lives in a page's render path never runs again, and
 * the browser's own anchor jump parks the section flush at the viewport top,
 * i.e. underneath the fixed topbar. This handler takes those clicks over.
 *
 * Scope — a click is ours only when all of these hold, otherwise it falls
 * through to a normal navigation:
 *   · plain left click (no modifier / new-tab intent), not already prevented;
 *   · same `pathname` AND same `search` as the current document;
 *   · the `#id` resolves to an element that exists.
 * Comparing `search` is also what keeps this safe against hidden tab panels:
 * appTabs.js mirrors the active tab into `?tab=` on every switch, so an
 * identical `search` guarantees the target sits in the VISIBLE panel — never in
 * a `hidden` one we'd scroll to blindly.
 */
export function installSectionLinkScroll() {
    if (sectionLinkScrollInstalled) return;
    sectionLinkScrollInstalled = true;

    document.addEventListener('click', e => {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const link = e.target.closest?.('a[href*="#"]');
        if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

        const url = new URL(link.href, location.href);
        if (url.pathname !== location.pathname || url.search !== location.search) return;

        const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (!target) return;

        e.preventDefault();
        // Leave the URL hash-free, matching what the landing page's load-time
        // path does: a hash left sitting in the bar makes the browser re-run its
        // own uncorrected jump on the next reload.
        history.replaceState(history.state, '', location.pathname + location.search);
        // A nav flyout only stayed open to show this link; the click is being
        // handled here rather than navigating away, so close it by hand.
        link.closest('.site-nav-flyout-host')?.classList.remove('pinned');
        scrollToClearingTopbar(target, { behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
}
