/**
 * adminSidebar.js — Mount the admin sidebar around an existing page
 * (used by the landing page when admin is editing the Main Dashboard,
 * so the sidebar stays visible and Pending Changes badge updates live).
 */

import { logout } from '../auth.js';
import { getChangeCount } from '../stagingStore.js';

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
        <h2>Shabi Admin</h2>
        <nav>
            <a href="index.html?edit=1" class="admin-nav-item ${activeView === 'dashboard' ? 'active' : ''}">Main Dashboard</a>
            <a href="admin.html#leagues" class="admin-nav-item">Leagues</a>
            <a href="admin.html#players" class="admin-nav-item">Players</a>
            <a href="admin.html#pending" class="admin-nav-item">
                Pending Changes <span id="staging-badge" class="staging-badge ${count === 0 ? 'empty' : ''}">${count}</span>
            </a>
            <a href="admin.html#settings" class="admin-nav-item">Settings</a>
        </nav>
        <div class="admin-sidebar-footer">
            <a href="index.html" class="admin-nav-item admin-home-link" title="View Site">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
                <span>Home</span>
            </a>
            <button class="admin-nav-item" id="admin-sidebar-logout">Logout</button>
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
