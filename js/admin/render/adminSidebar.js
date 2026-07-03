/**
 * adminSidebar.js — Mount the admin sidebar around an existing page
 * (used by the landing page when admin is editing the Main Dashboard,
 * so the sidebar stays visible and Pending Changes badge updates live).
 */

import { logout } from '../auth.js';
import { getChangeCount } from '../stagingStore.js';
import { setTopbarSection } from '../adminDrawer.js';
import { mountSidebarToggle } from '../../render/sidebarToggle.js';
import { mountTopbar } from '../../render/topbar.js';
import { buildAdminSidebarHtml, wireAdminSidebar } from './adminSidebarNav.js';

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
    sidebar.className = 'admin-sidebar site-sidebar';
    sidebar.innerHTML = buildAdminSidebarHtml({ mode: 'link', activeKey: activeView });

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

    // Settings ▸ Theme Customize flyout + click-to-pin/hover — canonical,
    // shared with admin.html's own sidebar (adminSidebarNav.js).
    wireAdminSidebar(sidebar);

    _wrapper = layout;
    _badgeEl = sidebar.querySelector('#staging-badge');

    // Poll badge so it reflects changes staged from inside the dashboard editor.
    _badgeInterval = setInterval(refreshBadge, 500);

    // Mount the SAME universal hamburger as the public site sidebar so the
    // toggle UX is identical in admin edit mode too. body.site-sidebar-closed
    // drives .admin-sidebar's transform via the shared .site-sidebar rules.
    mountSidebarToggle({ ariaControlsId: 'admin-sidebar' });
    mountTopbar({ forceAdmin: true });
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
