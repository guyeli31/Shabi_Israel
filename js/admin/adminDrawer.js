/**
 * adminDrawer.js — Mobile hamburger drawer for the admin sidebar.
 *
 * Wires a hamburger button + backdrop to toggle `.admin-sidebar.open` below
 * the 768px breakpoint. Handles Esc, tap-outside-to-close, focus trap, and
 * auto-closes when a nav item is selected or the viewport grows past the
 * breakpoint.
 */

const MOBILE_MEDIA = '(max-width: 767px)';

let sidebarEl = null;
let hamburgerEl = null;
let backdropEl = null;
let lastFocus = null;
let keydownHandler = null;

function isMobile() {
    return window.matchMedia(MOBILE_MEDIA).matches;
}

function getFocusable() {
    if (!sidebarEl) return [];
    return Array.from(sidebarEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
}

function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

function onKeydown(e) {
    if (e.key === 'Escape') {
        closeDrawer();
        return;
    }
    trapFocus(e);
}

export function openDrawer() {
    if (!sidebarEl || !hamburgerEl || !backdropEl) return;
    if (sidebarEl.classList.contains('open')) return;
    lastFocus = document.activeElement;
    sidebarEl.classList.add('open');
    backdropEl.classList.add('visible');
    hamburgerEl.setAttribute('aria-expanded', 'true');
    hamburgerEl.setAttribute('aria-label', 'Close menu');
    document.body.style.overflow = 'hidden';
    keydownHandler = onKeydown;
    document.addEventListener('keydown', keydownHandler);
    const focusable = getFocusable();
    if (focusable.length > 0) focusable[0].focus();
}

export function closeDrawer() {
    if (!sidebarEl || !hamburgerEl || !backdropEl) return;
    if (!sidebarEl.classList.contains('open')) return;
    sidebarEl.classList.remove('open');
    backdropEl.classList.remove('visible');
    hamburgerEl.setAttribute('aria-expanded', 'false');
    hamburgerEl.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
    if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler);
        keydownHandler = null;
    }
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

/**
 * Initialize the drawer. Call after `.admin-sidebar` exists in the DOM.
 * Idempotent — safe to call whenever the shell is re-rendered.
 */
export function initAdminDrawer() {
    sidebarEl = document.querySelector('.admin-sidebar');
    if (!sidebarEl) return;

    // Remove any stale drawer chrome from a previous render.
    const staleBtn = document.querySelector('.admin-hamburger');
    if (staleBtn) staleBtn.remove();
    const staleBackdrop = document.querySelector('.admin-backdrop');
    if (staleBackdrop) staleBackdrop.remove();

    hamburgerEl = document.createElement('button');
    hamburgerEl.className = 'admin-hamburger';
    hamburgerEl.type = 'button';
    hamburgerEl.setAttribute('aria-label', 'Open menu');
    hamburgerEl.setAttribute('aria-controls', 'admin-sidebar');
    hamburgerEl.setAttribute('aria-expanded', 'false');
    hamburgerEl.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

    backdropEl = document.createElement('div');
    backdropEl.className = 'admin-backdrop';

    sidebarEl.id = sidebarEl.id || 'admin-sidebar';
    document.body.appendChild(hamburgerEl);
    document.body.appendChild(backdropEl);

    hamburgerEl.addEventListener('click', openDrawer);
    backdropEl.addEventListener('click', closeDrawer);

    // Close drawer when a nav item is tapped on mobile.
    sidebarEl.addEventListener('click', (e) => {
        if (!isMobile()) return;
        const navItem = e.target.closest('.admin-nav-item');
        if (navItem) closeDrawer();
    });

    // Auto-close if the viewport grows past the breakpoint.
    const mq = window.matchMedia(MOBILE_MEDIA);
    const mqHandler = (ev) => { if (!ev.matches) closeDrawer(); };
    if (mq.addEventListener) mq.addEventListener('change', mqHandler);
    else mq.addListener(mqHandler);
}
