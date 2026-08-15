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
 * ── HOW TO REMOVE (the whole feature is 2 deletions) ────────────────────────
 *   1. delete this file
 *   2. delete its one import in js/analytics.js
 * Optionally also drop the `+ moved` bit from 404.html, though leaving it is
 * harmless — an unknown flag is stripped by nothing and ignored by everything.
 *
 * It also expires on its own: past EXPIRES_ON it stops rendering even if
 * nobody remembers to delete it. A temporary banner that outlives its purpose
 * is worse than no banner.
 *
 * Dismissals are logged via the button's `data-track` (analytics.js picks it up
 * through its existing delegated listener — no tracking code here), so the
 * Analytics dashboard shows how many people are still arriving on stale links
 * and, via the row's Page column, WHICH old links are still circulating.
 */

import { hasUrlFlag, spliceQueryParam } from '../utils/queryString.js';

/** Hard stop — two weeks after the move. Past this date the banner is dead code. */
const EXPIRES_ON = '2026-08-27';
const DISMISSED_KEY = 'shabi-moved-notice-dismissed';
const NEW_URL = 'golan.me.uk/shabi-israel';

export function mountMovedNotice() {
    if (!hasUrlFlag('moved')) return;

    // Strip the flag first and unconditionally: whatever we decide below, the
    // address bar must not keep a marker the visitor would copy into a share.
    // replaceState, not push — arriving here is not a place the user navigated to.
    history.replaceState(history.state, '', spliceQueryParam('moved', null));

    if (new Date() > new Date(EXPIRES_ON)) return;
    try { if (localStorage.getItem(DISMISSED_KEY)) return; } catch { /* private mode */ }

    document.body.appendChild(buildBanner());

    // Log the ARRIVAL, not just the dismissal — someone who reads the banner and
    // carries on without clicking "Got it" is still a person holding a stale
    // link, and dismissals alone would undercount them. Reuses analytics.js's
    // existing `shabi:interaction` hook (same pattern as the dashboard's
    // snapshot picker), so no new tracking API is introduced for a temporary
    // feature. The row's Page column names which old link they arrived on.
    window.dispatchEvent(new CustomEvent('shabi:interaction', {
        detail: { target: 'Moved notice: shown' },
    }));
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
        try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* private mode */ }
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
