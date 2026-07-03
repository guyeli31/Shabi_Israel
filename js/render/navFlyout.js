/**
 * navFlyout.js — Canonical click-to-pin / hover-to-open wiring for the
 * `.site-nav-flyout-host` / `.site-nav-flyout` menu system defined in
 * css/site-sidebar.css. Hover-open and the rail-mode collapse are pure CSS
 * (driven by `.pinned` and `:has()`); this module only owns the JS half:
 * toggling `.pinned` on click and clearing it on outside clicks / mobile
 * leaf taps.
 *
 * Used by BOTH the public sidebar (siteSidebar.js) and every admin sidebar
 * surface (admin.html's adminPage.js, the dashboard edit-mode overlay in
 * adminSidebar.js) so the menu hierarchy behaves identically everywhere —
 * one implementation, not one per surface.
 */

import { closeSidebar, isMobile } from './sidebarToggle.js';

/**
 * Wire click-to-pin flyouts inside `sidebar`.
 * @param {HTMLElement} sidebar — the `.site-sidebar`-class root element.
 */
export function wireNavFlyouts(sidebar) {
    sidebar.addEventListener('click', e => {
        const trigger = e.target.closest('.site-nav-group, .site-sidebar-search-trigger');
        if (trigger && sidebar.contains(trigger)) {
            const host = trigger.closest('.site-nav-flyout-host');
            if (host) {
                const wasPinned = host.classList.contains('pinned');
                // Unpin all hosts at the same level first.
                const parent = host.parentElement;
                parent.querySelectorAll(':scope > .site-nav-flyout-host.pinned').forEach(p => p.classList.remove('pinned'));
                if (!wasPinned) host.classList.add('pinned');
                e.preventDefault();
                return;
            }
        }

        // Leaf link tap on mobile closes the drawer.
        const leaf = e.target.closest('a.site-nav-item, a.site-nav-flyout-item');
        if (leaf && isMobile()) closeSidebar();

        // Mobile rail-mode exit: a tap on blank sidebar space (not an
        // interactive control) unpins everything in the nav tree and the
        // sidebar springs back from rail → full width.
        if (isMobile()) {
            const onInteractive = e.target.closest(
                '.site-nav-item, .site-nav-flyout-item, .site-nav-flyout, ' +
                '.site-sidebar-brand, .site-sidebar-search, .site-sidebar-logout, ' +
                '.sidebar-admin-banner'
            );
            if (!onInteractive) {
                sidebar.querySelectorAll('.site-nav-tree .site-nav-flyout-host.pinned')
                    .forEach(p => p.classList.remove('pinned'));
            }
        }
    });

    // Click anywhere outside a pinned host closes the pin.
    document.addEventListener('click', e => {
        if (!sidebar.contains(e.target)) {
            sidebar.querySelectorAll('.site-nav-flyout-host.pinned').forEach(p => p.classList.remove('pinned'));
        }
    });
}
