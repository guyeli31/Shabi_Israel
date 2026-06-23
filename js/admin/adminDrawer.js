/**
 * adminDrawer.js — Mobile hamburger drawer for the admin sidebar.
 *
 * On mobile, injects a fixed topbar containing the hamburger, an "Admin"
 * title, and a user-chip (avatar + name). Wires the drawer open/close,
 * backdrop, Esc, focus-trap, and auto-close on resize.
 */

const MOBILE_MEDIA = '(max-width: 767px)';

let sidebarEl = null;
let hamburgerEl = null;
let backdropEl = null;
let topbarTitleEl = null;
let lastFocus = null;
let keydownHandler = null;

function isMobile() {
    return window.matchMedia(MOBILE_MEDIA).matches;
}

let _vvBound = false;

/**
 * Publish the exact drawer height to CSS as `--admin-drawer-h`.
 *
 * `100dvh` only subtracts *docked* browser toolbars; floating/overlay URL bars
 * (common on Android & some iOS browsers) are NOT subtracted, so the drawer
 * footer (Home/Logout) ends up trapped behind them. Rather than hand-compute
 * topbar height + safe-area offsets (error-prone), we measure both real edges
 * from the DOM: the topbar's bottom and the visual viewport's bottom. The
 * drawer height is simply the gap between them, so its bottom lands exactly on
 * the last visible pixel regardless of chrome style.
 */
function syncDrawerHeight() {
    const sidebar = document.querySelector('.admin-sidebar');
    if (!sidebar) return;
    const vv = window.visualViewport;
    // Bottom edge of the genuinely-visible area, in client/layout coords.
    const visibleBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
    const topbar = document.querySelector('.admin-mobile-topbar');
    const topbarBottom = topbar ? topbar.getBoundingClientRect().bottom : 60;
    const h = Math.max(0, Math.round(visibleBottom - topbarBottom));
    document.documentElement.style.setProperty('--admin-drawer-h', h + 'px');
}

function bindViewportSync() {
    if (_vvBound) return;
    _vvBound = true;
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncDrawerHeight);
        window.visualViewport.addEventListener('scroll', syncDrawerHeight);
    }
    window.addEventListener('resize', syncDrawerHeight);
    window.addEventListener('orientationchange', syncDrawerHeight);
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
 *
 * @param {string} username — shown in the mobile topbar user chip
 */
export function initAdminDrawer(username = '') {
    sidebarEl = document.querySelector('.admin-sidebar');
    if (!sidebarEl) return;

    // Remove any stale drawer chrome from a previous render.
    document.querySelector('.admin-mobile-topbar')?.remove();
    document.querySelector('.admin-backdrop')?.remove();

    // ---- Build mobile topbar: [hamburger] [logo] [section title] [user chip] ----
    const topbarEl = document.createElement('div');
    topbarEl.className = 'admin-mobile-topbar';
    topbarEl.setAttribute('role', 'banner');

    hamburgerEl = document.createElement('button');
    hamburgerEl.className = 'admin-hamburger';
    hamburgerEl.type = 'button';
    hamburgerEl.setAttribute('aria-label', 'Open menu');
    hamburgerEl.setAttribute('aria-controls', 'admin-sidebar');
    hamburgerEl.setAttribute('aria-expanded', 'false');
    hamburgerEl.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

    const logoEl = document.createElement('img');
    logoEl.className = 'admin-topbar-logo';
    logoEl.src = 'assets/logo/logo.png';
    logoEl.alt = '';
    logoEl.setAttribute('aria-hidden', 'true');

    topbarTitleEl = document.createElement('span');
    topbarTitleEl.className = 'admin-topbar-title';
    topbarTitleEl.textContent = 'Leagues';

    topbarEl.appendChild(hamburgerEl);
    topbarEl.appendChild(logoEl);
    topbarEl.appendChild(topbarTitleEl);

    if (username) {
        const userEl = document.createElement('div');
        userEl.className = 'admin-topbar-user';
        userEl.innerHTML = `<div class="admin-topbar-avatar">${username.charAt(0).toUpperCase()}</div><span class="admin-topbar-name">${username}</span>`;
        topbarEl.appendChild(userEl);
    }

    backdropEl = document.createElement('div');
    backdropEl.className = 'admin-backdrop';

    sidebarEl.id = sidebarEl.id || 'admin-sidebar';
    document.body.appendChild(topbarEl);
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

    // Keep the drawer height pinned to the genuinely-visible viewport so the
    // footer never hides behind a floating mobile URL bar.
    bindViewportSync();
    syncDrawerHeight();
}

/** Update the section title shown in the mobile topbar. */
export function setTopbarSection(title) {
    if (topbarTitleEl) topbarTitleEl.textContent = title;
}
