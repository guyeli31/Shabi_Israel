/**
 * msgScroll.js — shared "bring this admin element into view" helpers.
 *
 * Both delegate their geometry to js/utils/scrollOffset.js, the single source of
 * truth for how far the fixed top chrome intrudes: admin.html mounts the same
 * `.site-topbar` as the public pages (adminPage.js → mountTopbar), and that bar
 * is `position: fixed`, so it covers the top of the scrollport without shrinking
 * it. Anything that scrolls by raw viewport coordinates lands underneath it.
 */

import { measureFixedTopOffset, scrollToClearingTopbar, prefersReducedMotion } from '../utils/scrollOffset.js';

/**
 * Admin messages sit at the top of their section/panel. When the user triggers a
 * Save from far down (e.g. a match deep in the Round Editor), the message can be
 * off-screen and go unnoticed. Call this after rendering a message to bring it
 * into view — but only when it's actually off-screen, and honour reduced-motion.
 *
 * "On screen" means below the fixed chrome, not below y=0: a message tucked under
 * the topbar is just as unread as one scrolled off the top, however positive its
 * rect.top happens to be.
 *
 * @param {HTMLElement|null} el - the message container that was just populated.
 */
export function revealMsg(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < measureFixedTopOffset() || rect.bottom > viewH) {
        // block:'center' is safe against the topbar by construction (the element
        // ends up mid-viewport), so this one may stay a plain scrollIntoView.
        el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    }
}

/**
 * Bring an element to the TOP of the viewport — always, and regardless of where
 * it already sits. Unlike revealMsg (which only nudges an off-screen message
 * into the centre), this is for the element the user should now be looking at:
 * it lands at the top, with everything that follows it below the fold, so
 * scrolling further stays the user's choice.
 *
 * Not `scrollIntoView({block:'start'})`: that aligns the element to the top of
 * the scrollport, which the fixed topbar overlaps — the element's first ~64px
 * (its heading, typically) end up hidden behind the bar whenever the sidebar is
 * closed, which on mobile is always. scrollToClearingTopbar measures the bar as
 * actually rendered and clears it, plus a breathing-room gap.
 *
 * @param {HTMLElement|null} el - the element to bring to the top.
 */
export function revealAtTop(el) {
    if (!el) return;
    scrollToClearingTopbar(el, { behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
