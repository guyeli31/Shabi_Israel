/**
 * movedNotice.js — TEMPORARY. Delete after 2026-08-27.
 *
 * The site moved from golan.me.uk/ to golan.me.uk/shabi-israel/ on 2026-08-13.
 * Links shared before that still work — 404.html at the domain root redirects
 * them — but the redirect is instant and silent, so someone following an old
 * WhatsApp link lands on the right page having never been told the address
 * changed, and goes on re-sharing the old link forever. This banner is the
 * only thing that closes that loop.
 *
 * It shows ONLY for visitors who actually arrived through the redirect:
 * 404.html appends the valueless `?moved` flag (see CLAUDE.md § URL contract —
 * boolean flags carry no value), and this module strips the flag back out of
 * the address bar immediately so the URL the visitor copies is the clean one.
 *
 * ── HOW TO REMOVE ───────────────────────────────────────────────────────────
 *   1. delete this file
 *   2. in js/analytics.js: drop the two imports here, the MOVED_BANNER const, and
 *      the `moved_banner` field in baseFields()
 *   3. optional cleanup (all harmless if left): the 📦/moved_banner bits in
 *      js/render/analyticsPage.js, the `moved_banner` column + its uses in
 *      sql/analytics_poc.sql, and the `+ moved` flag in 404.html
 *
 * It also expires on its own: past EXPIRES_ON it stops rendering even if
 * nobody remembers to delete it. A temporary banner that outlives its purpose
 * is worse than no banner.
 *
 * The banner persists for the whole VISIT, not just the landing page: arriving
 * through the redirect sets a sessionStorage flag (movedBannerActive below), so
 * every subsequent page re-shows it until the visitor clicks "Got it". analytics.js
 * reads that same flag and stamps `moved_banner` on every event fired while the
 * banner is up, so the dashboard marks each such page with 📦 — one-to-one with
 * "the banner was on screen". The dismissal itself is a real click logged via the
 * button's `data-track`. No arrival event is fired: the 📦 on the pageview already
 * says "reached the site through a pre-move link", so a separate row would double it.
 */

import { hasUrlFlag, spliceQueryParam } from '../utils/queryString.js';

/** Hard stop — two weeks after the move. Past this date the banner is dead code. */
const EXPIRES_ON = '2026-08-27';
const DISMISSED_KEY = 'shabi-moved-notice-dismissed';
// Per-VISIT (sessionStorage, wiped on tab close), so the banner survives page
// navigation until Got it — unlike DISMISSED_KEY, which is per-DEVICE and means
// "acknowledged, never nag again". This is what turns the banner from a
// landing-page-only flash into a visit-long state the 📦 mark can track.
const SESSION_ACTIVE_KEY = 'shabi-moved-notice-active';
const NEW_URL = 'golan.me.uk/shabi-israel';

let _active; // resolved once per page load; cached so the ?moved strip runs once

/**
 * Whether the moved banner is live on THIS page load — the single source of truth
 * for both showing the banner and the analytics `moved_banner` 📦 mark. Resolved
 * once and cached: the first call also performs the one-time side effects (strip
 * the ?moved flag, remember the arrival for the rest of the visit). analytics.js
 * calls this BEFORE its first pageview so the mark rides the pageview itself.
 */
export function movedBannerActive() {
    if (_active !== undefined) return _active;

    // Arriving through the redirect: 404.html appended ?moved. Strip it first and
    // unconditionally — the visitor must never copy a URL carrying the flag — and
    // remember, per-visit, that this session arrived stale so the banner (and the
    // 📦 mark) persist across navigations, not just on the landing page.
    // replaceState, not push — arriving here is not a place the user navigated to.
    if (hasUrlFlag('moved')) {
        history.replaceState(history.state, '', spliceQueryParam('moved', null));
        try { sessionStorage.setItem(SESSION_ACTIVE_KEY, '1'); } catch { /* private mode */ }
    }

    if (new Date() > new Date(EXPIRES_ON)) return (_active = false);
    try { if (localStorage.getItem(DISMISSED_KEY)) return (_active = false); } catch { /* private mode */ }

    let active = false;
    try { active = !!sessionStorage.getItem(SESSION_ACTIVE_KEY); } catch { /* private mode */ }
    return (_active = active);
}

export function mountMovedNotice() {
    if (!movedBannerActive()) return;
    document.body.appendChild(buildBanner());
}

function buildBanner() {
    const bar = document.createElement('div');
    bar.className = 'moved-notice';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
        <span class="moved-notice-text">
            You followed an old link. This site's address is now
            <strong>${NEW_URL}</strong> — please update your bookmark.
        </span>
        <button class="moved-notice-close" type="button" aria-label="Dismiss"
                data-track="Moved notice: dismissed">Got it</button>`;

    bar.querySelector('.moved-notice-close').addEventListener('click', () => {
        // Both flags: DISMISSED (never nag again on this device) AND clearing the
        // per-visit ACTIVE flag (so no later page this session re-shows it or gets
        // the 📦 mark). The events already sent from THIS page keep moved_banner —
        // the banner genuinely was on screen here — only what comes next is clean.
        try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* private mode */ }
        try { sessionStorage.removeItem(SESSION_ACTIVE_KEY); } catch { /* private mode */ }
        bar.remove();
    });

    // Styles live here rather than in css/ so removing the feature is one file
    // deletion, with no orphaned rules left behind in a shared stylesheet.
    const style = document.createElement('style');
    style.textContent = `
        .moved-notice {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            gap: 1rem; flex-wrap: wrap;
            padding: .8rem 1.1rem;
            background: var(--panel, #fff);
            border-top: 3px solid var(--accent, #8a6d3b);
            box-shadow: 0 -2px 12px rgba(0,0,0,.12);
            font-size: .9rem; line-height: 1.5;
            color: var(--ink, #1b1813);
        }
        .moved-notice-text { max-width: 60ch; }
        .moved-notice strong { white-space: nowrap; }
        .moved-notice-close {
            flex: none; cursor: pointer;
            padding: .4rem .9rem; border-radius: .4rem;
            border: 1px solid var(--accent, #8a6d3b);
            background: transparent; color: inherit;
            font: inherit; font-weight: 600;
        }
        .moved-notice-close:hover { background: var(--accent, #8a6d3b); color: #fff; }
    `;
    bar.appendChild(style);
    return bar;
}
