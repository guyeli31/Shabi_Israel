/**
 * adminSidebar.js — Mount the admin sidebar around an existing page
 * (used by the landing page when admin is editing the Main Dashboard,
 * so the sidebar stays visible and Pending Changes badge updates live).
 */

import { logout, getUsername } from '../auth.js';
import { getChangeCount } from '../stagingStore.js';
import { setTopbarSection } from '../adminDrawer.js';
import { mountSidebarToggle } from '../../render/sidebarToggle.js';

let _wrapper = null;
let _badgeEl = null;
let _badgeInterval = null;

/**
 * Wrap document.body's contents in an .admin-layout with a sidebar.
 * @param {object} opts
 * @param {string} opts.activeView — which sidebar item to highlight (e.g. 'dashboard')
 */
export function mountAdminSidebar(opts = {}) {
    if (_wrapper) return; // already mounted
    const activeView = opts.activeView || 'dashboard';

    const body = document.body;
    const existing = [...body.childNodes];

    const layout = document.createElement('div');
    layout.className = 'admin-layout admin-sidebar-mounted';

    const sidebar = document.createElement('aside');
    sidebar.className = 'admin-sidebar';
    const count = getChangeCount();
    sidebar.innerHTML = `
        <a class="admin-sidebar-brand" href="index.html" aria-label="Shabi Israel — home">
            <img class="admin-sidebar-brand-logo" src="assets/favicon-round.png" alt="">
            <span class="admin-sidebar-brand-text">Shabi Israel</span>
        </a>
        <div class="sidebar-admin-banner">
            <div class="sidebar-admin-avatar">${getUsername().charAt(0).toUpperCase()}</div>
            <div class="sidebar-admin-body">
                <div class="sidebar-admin-label">Welcome back</div>
                <div class="sidebar-admin-name">${getUsername()}</div>
                <div class="sidebar-admin-status"><span class="sidebar-admin-dot"></span>Active</div>
            </div>
        </div>
        <nav>
            <a href="index.html?edit=1" class="admin-nav-item ${activeView === 'dashboard' ? 'active' : ''}">
                <span class="admin-nav-icon" aria-hidden="true">🏠</span><span>Main Dashboard</span>
            </a>
            <a href="admin.html#leagues" class="admin-nav-item">
                <span class="admin-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="6.5" x2="8" y2="13"/></svg></span><span>Leagues</span>
            </a>
            <a href="admin.html#players" class="admin-nav-item">
                <span class="admin-nav-icon" aria-hidden="true">👥</span><span>Players</span>
            </a>
            <a href="admin.html#pending" class="admin-nav-item">
                <span class="admin-nav-icon" aria-hidden="true">📝</span><span>Pending Changes</span> <span id="staging-badge" class="staging-badge ${count === 0 ? 'empty' : ''}">${count}</span>
            </a>
            <a href="admin.html#settings" class="admin-nav-item">
                <span class="admin-nav-icon" aria-hidden="true">⚙️</span><span>Settings</span>
            </a>
        </nav>
        <div class="admin-sidebar-footer">
            <a href="index.html" class="admin-nav-item admin-home-link" title="View Site">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
                <span>Home</span>
            </a>
            <button class="admin-nav-item admin-logout-btn" id="admin-sidebar-logout">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                <span>Logout</span>
            </button>
        </div>`;

    const main = document.createElement('main');
    main.className = 'admin-main admin-main-embedded';
    for (const node of existing) main.appendChild(node);

    layout.appendChild(sidebar);
    layout.appendChild(main);
    body.appendChild(layout);

    sidebar.querySelector('#admin-sidebar-logout').addEventListener('click', () => {
        logout();
        location.href = 'index.html';
    });

    _wrapper = layout;
    _badgeEl = sidebar.querySelector('#staging-badge');

    // Poll badge so it reflects changes staged from inside the dashboard editor.
    _badgeInterval = setInterval(refreshBadge, 500);

    // Mount the SAME universal hamburger as the public site sidebar so the
    // toggle UX is identical in admin edit mode too. body.site-sidebar-closed
    // drives .admin-sidebar's transform via the shared rules in admin.css.
    mountSidebarToggle({ ariaControlsId: 'admin-sidebar' });
    setTopbarSection('Main Dashboard');
}

export function unmountAdminSidebar() {
    if (!_wrapper) return;
    const main = _wrapper.querySelector('.admin-main-embedded');
    const body = document.body;
    while (main && main.firstChild) body.appendChild(main.firstChild);
    _wrapper.remove();
    _wrapper = null;
    _badgeEl = null;
    if (_badgeInterval) {
        clearInterval(_badgeInterval);
        _badgeInterval = null;
    }
}

export function refreshBadge() {
    if (!_badgeEl) return;
    const count = getChangeCount();
    _badgeEl.textContent = count;
    _badgeEl.classList.toggle('empty', count === 0);
}
