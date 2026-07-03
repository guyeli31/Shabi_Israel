/**
 * topbar.js — Fixed top bar shown while the sidebar/menu is CLOSED.
 *
 * Restores the pre-sidebar top nav as one shared chrome across BOTH the
 * public site and admin mode. Left→right: the floating hamburger
 * (.site-hamburger from sidebarToggle overlays the bar's left edge) · round
 * logo · "Shabi Israel" · admin unit (logo + avatar + username pill, far
 * right, only when logged in).
 *
 * Visibility is driven purely by `body.site-sidebar-closed` in
 * css/site-sidebar.css — opening the menu hides the bar so the two chromes
 * never show at once. Same DOM + CSS on every surface, so the bar looks and
 * behaves identically in admin.
 */

import { isLoggedIn, getUsername } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Mount the top bar once. Idempotent.
 * @param {object} [opts]
 * @param {boolean} [opts.forceAdmin] — always render the admin unit (admin
 *        surfaces are logged-in by definition; skips the preview-mode check).
 */
export function mountTopbar(opts = {}) {
    if (document.querySelector('.site-topbar')) return;

    const loggedIn = opts.forceAdmin || (isLoggedIn() && !isPreviewMode());
    const initial = loggedIn ? escapeHtml(getUsername().charAt(0).toUpperCase()) : '';
    const name = loggedIn ? escapeHtml(getUsername()) : '';
    // Old .nav-admin-user unit: brand logo + avatar + username as one pill.
    const adminUnit = loggedIn
        ? `<div class="site-topbar-admin" aria-label="Signed in as ${name}">
               <img class="site-topbar-admin-logo" id="site-topbar-admin-logo" src="assets/favicon-round.png" alt="">
               <div class="site-topbar-admin-avatar">${initial}</div>
               <span class="site-topbar-admin-name">${name}</span>
           </div>`
        : '';

    const bar = document.createElement('header');
    bar.className = 'site-topbar';
    bar.innerHTML = `
        <a class="site-topbar-brand" href="index.html" aria-label="Shabi Israel — home">
            <img class="site-topbar-logo" id="site-topbar-logo" src="assets/favicon-round.png" alt="">
            <span class="site-topbar-title" id="site-topbar-title">Shabi Israel</span>
        </a>
        <div class="site-topbar-right">${adminUnit}</div>
    `;
    document.body.appendChild(bar);
}

/**
 * Update the bar's logo + title once brand settings are known (public site).
 * No-op for fields left undefined.
 * @param {{logoPath?: string, title?: string}} brand
 */
export function setTopbarBrand({ logoPath, title } = {}) {
    if (logoPath) {
        const logo = document.querySelector('#site-topbar-logo');
        const adminLogo = document.querySelector('#site-topbar-admin-logo');
        if (logo) logo.src = logoPath;
        if (adminLogo) adminLogo.src = logoPath;
    }
    if (title) {
        const t = document.querySelector('#site-topbar-title');
        if (t) t.textContent = title;
    }
}
