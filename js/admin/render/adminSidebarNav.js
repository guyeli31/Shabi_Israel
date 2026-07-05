/**
 * adminSidebarNav.js — Canonical admin sidebar content: brand row, welcome
 * banner, nav items, and the Settings ▸ Theme Customize flyout. Single
 * source of truth for BOTH admin surfaces:
 *   - admin.html (js/admin/render/adminPage.js) — items are in-page view
 *     switches (`<button data-view>`), pinned flyout state lives on the
 *     one persistent page.
 *   - the dashboard edit-mode overlay on index.html (adminSidebar.js) —
 *     items are real links (`<a href="admin.html#...">`) since it's a
 *     different page.
 *
 * Markup uses the SAME `.site-sidebar` / `.site-nav-*` classes as the
 * public sidebar (css/site-sidebar.css) so layout, hover/pin flyouts, and
 * the mobile rail-mode collapse are all defined once and apply everywhere
 * without per-surface CSS duplication.
 */

import { getUsername } from '../auth.js';
import { getChangeCount } from '../stagingStore.js';
import { buildThemePickerPanel } from '../../render/themePicker.js';
import { wireNavFlyouts } from '../../render/navFlyout.js';

const NAV_ITEMS = [
    { key: 'dashboard', label: 'Main Dashboard', icon: '🏠', href: 'index.html?edit=1' },
    { key: 'leagues',   label: 'Leagues',        icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="6.5" x2="8" y2="13"/></svg>' },
    { key: 'players',   label: 'Players',        icon: '👥' },
    { key: 'pending',   label: 'Pending Changes', icon: '📝', badge: true }
];

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="site-nav-chevron"><polyline points="9 6 15 12 9 18"/></svg>';

/**
 * @param {object} opts
 * @param {'view'|'link'} opts.mode — 'view' renders `<button data-view>` for
 *        in-page switching (admin.html); 'link' renders `<a href="admin.html#...">`.
 * @param {string} [opts.activeKey] — nav item to mark `.active` (mode:'link' only —
 *        mode:'view' marks active dynamically via navigateTo()).
 */
export function buildAdminSidebarHtml(opts = {}) {
    const { mode = 'view', activeKey = null } = opts;
    const count = getChangeCount();

    const navHtml = NAV_ITEMS.map(item => {
        const activeCls = (mode === 'link' && item.key === activeKey) ? ' active' : '';
        const badgeHtml = item.badge
            ? ` <span id="staging-badge" class="staging-badge ${count === 0 ? 'empty' : ''}">${count}</span>`
            : '';
        const inner = `<span class="site-nav-icon" aria-hidden="true">${item.icon}</span><span class="site-nav-label">${item.label}</span>${badgeHtml}`;
        if (mode === 'link') {
            const href = item.href || `admin.html#${item.key}`;
            return `<a href="${href}" class="site-nav-item${activeCls}">${inner}</a>`;
        }
        if (item.href) {
            return `<a href="${item.href}" class="site-nav-item">${inner}</a>`;
        }
        return `<button class="site-nav-item" data-view="${item.key}" type="button">${inner}</button>`;
    }).join('\n');

    return `
        <a class="site-sidebar-brand" href="index.html" aria-label="Shabi Israel — home">
            <img class="site-sidebar-brand-logo" src="assets/favicon-round.png" alt="">
            <span class="site-sidebar-brand-text">Shabi Israel</span>
        </a>
        <div class="sidebar-admin-banner">
            <div class="sidebar-admin-avatar">${getUsername().charAt(0).toUpperCase()}</div>
            <div class="sidebar-admin-body">
                <div class="sidebar-admin-label">Welcome back</div>
                <div class="sidebar-admin-name">${getUsername()}</div>
                <div class="sidebar-admin-status"><span class="sidebar-admin-dot"></span>Active</div>
            </div>
        </div>
        <nav aria-label="Admin sections" class="site-nav-tree">
            ${navHtml}
            <div class="site-nav-flyout-host" data-flyout="settings">
                <button class="site-nav-item site-nav-group" data-group="settings" type="button">
                    <span class="site-nav-icon" aria-hidden="true">⚙️</span><span class="site-nav-label">Settings</span>
                    ${CHEVRON}
                </button>
                <div class="site-nav-flyout" data-submenu="settings" role="menu">
                    <div class="site-nav-flyout-host site-nav-flyout-host--nested" data-flyout="settings-theme">
                        <button class="site-nav-flyout-item site-nav-group" data-group="settings-theme">
                            <span class="site-nav-icon" aria-hidden="true">🎨</span>
                            <span class="site-nav-label">Theme Customize</span>
                            ${CHEVRON}
                        </button>
                        <div class="site-nav-flyout site-nav-flyout--nested site-nav-flyout--theme" data-submenu="settings-theme" role="menu"></div>
                    </div>
                </div>
            </div>
            <a href="index.html" class="site-nav-item" title="View Site">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
                <span class="site-nav-label">Home</span>
            </a>
        </nav>
        <button class="site-sidebar-logout" id="admin-sidebar-logout" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            <span>Logout</span>
        </button>`;
}

/**
 * Wire the Settings ▸ Theme Customize flyout + generic pin/hover behavior
 * for a sidebar built by buildAdminSidebarHtml(). Does NOT wire logout
 * (callers attach their own handler to #admin-sidebar-logout since the
 * post-logout redirect differs slightly by surface).
 */
export function wireAdminSidebar(sidebar) {
    const themeSubmenu = sidebar.querySelector('[data-submenu="settings-theme"]');
    if (themeSubmenu) {
        const themePanel = buildThemePickerPanel();
        themeSubmenu.appendChild(themePanel);

        // Collapse the Customize sub-panel once this flyout actually closes
        // (mouse leaves it while unpinned, or its pin is removed) so hovering
        // it open again later doesn't resurrect a stale expanded state.
        const themeHost = sidebar.querySelector('[data-flyout="settings-theme"]');
        if (themeHost) {
            const collapseIfClosed = () => {
                if (!themeHost.classList.contains('pinned') && !themeHost.matches(':hover')) {
                    themePanel.collapseCustomize();
                }
            };
            themeHost.addEventListener('mouseleave', collapseIfClosed);
            new MutationObserver(collapseIfClosed)
                .observe(themeHost, { attributes: true, attributeFilter: ['class'] });
        }
    }
    wireNavFlyouts(sidebar);
}
