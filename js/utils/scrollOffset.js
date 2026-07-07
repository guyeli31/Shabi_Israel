/**
 * scrollOffset.js — live measurement of whatever chrome is currently pinned
 * to the top of the viewport (the site topbar today), for deep-link/jump
 * scrolling that needs to clear it.
 *
 * Deliberately NOT a cached constant (e.g. --topbar-height): it re-measures
 * the actual rendered DOM every call, so it stays correct if the topbar's
 * height changes, or anything else becomes fixed/sticky at the top later
 * (e.g. a hero banner) — no code change needed here when that happens.
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
