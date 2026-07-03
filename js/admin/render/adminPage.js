/**
 * adminPage.js — Render the admin panel shell: login, sidebar, pending changes.
 */

import { isLoggedIn, logout, isGitHubConfigured } from '../auth.js';
import { getChanges, removeChange, removeGroup, removeOverrideFromChange, restoreOverrideToChange, removePlayerFromGroup, getChangeCount, publishAll, clearChanges, diffOverrides, overrideKey } from '../stagingStore.js';
import { setTopbarSection } from '../adminDrawer.js';
import { mountSidebarToggle } from '../../render/sidebarToggle.js';
import { mountTopbar } from '../../render/topbar.js';
import { installSearchOverlay } from '../../render/searchOverlay.js';
import { buildAdminSidebarHtml, wireAdminSidebar } from './adminSidebarNav.js';

const VIEW_TITLES = { leagues: 'Leagues', players: 'Players', pending: 'Pending Changes' };

let currentView = 'leagues';
let onNavigate = null; // callback set by admin.html to handle view switching

/**
 * Initialize the admin page. Called once on load.
 * @param {function} viewCallback — called with (viewName) when nav changes
 */
export function initAdminPage(viewCallback) {
    onNavigate = viewCallback;

    if (!isLoggedIn()) {
        location.href = 'index.html';
        return;
    } else {
        renderAdminShell();
        const hash = (location.hash || '').replace('#', '');
        const initial = (hash === 'pending' || hash === 'leagues' || hash === 'players') ? hash : 'leagues';
        navigateTo(initial);
    }
}

/**
 * Navigate to a view.
 */
export function navigateTo(view) {
    currentView = view;
    setTopbarSection(VIEW_TITLES[view] || view);

    // Update active nav item
    document.querySelectorAll('.site-nav-item[data-view]').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    const main = document.getElementById('admin-content');
    if (!main) return;

    if (view === 'pending') {
        renderPendingChanges(main);
    } else if (onNavigate) {
        onNavigate(view, main);
    }
}

/**
 * Refresh the staging badge count.
 */
export function refreshBadge() {
    const badge = document.getElementById('staging-badge');
    if (!badge) return;
    const count = getChangeCount();
    badge.textContent = count;
    badge.classList.toggle('empty', count === 0);
}

// ---- Admin Shell ----

function renderAdminShell() {
    const app = document.getElementById('app');

    app.innerHTML = `
        <div class="admin-layout">
            <aside class="admin-sidebar site-sidebar" id="admin-sidebar">
                ${buildAdminSidebarHtml({ mode: 'view' })}
            </aside>
            <main class="admin-main" id="admin-content">
                <div class="loading">Loading...</div>
            </main>
        </div>`;

    const sidebar = document.getElementById('admin-sidebar');

    // Nav clicks
    document.querySelectorAll('.site-nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    // Logout
    document.getElementById('admin-sidebar-logout').addEventListener('click', () => {
        logout();
        location.href = 'index.html';
    });

    // Settings ▸ Theme Customize flyout + click-to-pin/hover — canonical,
    // shared with the dashboard edit-mode sidebar (adminSidebarNav.js).
    wireAdminSidebar(sidebar);

    // Mount the SAME universal hamburger that drives the public site sidebar.
    // It manipulates `body.site-sidebar-closed`; .site-sidebar's CSS (shared
    // by .admin-sidebar via the class above) honors that class with the same
    // transform/margin transition, so the toggle UX is identical across both
    // surfaces. Replaces the older initAdminDrawer() topbar+drawer combo (the
    // page title <h1> in the main content already provides the "where am I"
    // cue the old topbar did).
    mountSidebarToggle({ ariaControlsId: 'admin-sidebar' });

    // Same top bar as the public site (shown while the sidebar is closed).
    // forceAdmin: admin.html is logged-in by definition, so always render the
    // admin unit without the preview-mode check.
    mountTopbar({ forceAdmin: true });

    // Mobile search-sheet for the admin match/round filter inputs (datalist-
    // backed, so they use the default adapter — no registration needed). No-op
    // off touch devices.
    installSearchOverlay();
}

// ---- Pending Changes ----

function renderPendingChanges(container) {
    const changes = getChanges();

    if (changes.length === 0) {
        container.innerHTML = `
            <h1>Pending Changes</h1>
            <div class="admin-card">
                <p style="color:var(--color-text-muted);text-align:center;padding:var(--space-lg)">
                    No pending changes. Make changes in the Leagues section and they'll appear here.
                </p>
            </div>`;
        return;
    }

    // Group changes by group field, render grouped items as single line
    const displayItems = buildDisplayItems(changes);

    let listHtml = '';
    for (const item of displayItems) {
        const time = new Date(item.timestamp).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        let cancelAttr;
        if (item.removePlayer) {
            cancelAttr = `data-remove-player="${escHtml(item.removePlayer)}"`;
        } else if (item.group) {
            cancelAttr = `data-remove-group="${escHtml(item.group)}"`;
        } else if (item.overridePath != null) {
            cancelAttr = `data-remove-override-path="${escHtml(item.overridePath)}" data-remove-override-idx="${item.overrideIndex}"`;
        } else if (item.restorePath != null) {
            cancelAttr = `data-restore-override-path="${escHtml(item.restorePath)}" data-restore-override-key="${encodeURIComponent(item.restoreKey)}"`;
        } else {
            cancelAttr = `data-remove="${item.indices[0]}"`;
        }
        listHtml += `
            <li class="pending-item">
                <span class="pending-item-desc">${item.displayText}</span>
                <span class="pending-item-time">${time}</span>
                <button class="btn btn-danger btn-sm" ${cancelAttr}>Cancel</button>
            </li>`;
    }

    container.innerHTML = `
        <h1>Pending Changes</h1>
        <div class="pending-panel">
            <h3>${displayItems.length} change${displayItems.length === 1 ? '' : 's'} waiting to be published</h3>
            <ul class="pending-list">${listHtml}</ul>
            <div id="publish-msg"></div>
            <div id="publish-progress"></div>
            <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
                <button class="btn btn-success" id="publish-btn">Publish to Site</button>
                <button class="btn btn-secondary" id="preview-btn">Preview</button>
                <button class="btn btn-danger" id="discard-all-btn">Discard All</button>
            </div>
        </div>`;

    // Cancel individual change
    container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
            removeChange(parseInt(btn.dataset.remove));
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Cancel individual player from grouped metadata
    container.querySelectorAll('[data-remove-player]').forEach(btn => {
        btn.addEventListener('click', () => {
            removePlayerFromGroup(btn.dataset.removePlayer);
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Cancel grouped changes
    container.querySelectorAll('[data-remove-group]').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupId = btn.dataset.removeGroup;
            removeGroup(groupId);
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Cancel individual override from expanded overrides list
    container.querySelectorAll('[data-remove-override-path]').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.removeOverridePath;
            const idx = parseInt(btn.dataset.removeOverrideIdx);
            removeOverrideFromChange(path, idx);
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Cancel a removed-override delta row (restore it into the staged file)
    container.querySelectorAll('[data-restore-override-path]').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.restoreOverridePath;
            const key = decodeURIComponent(btn.dataset.restoreOverrideKey);
            restoreOverrideToChange(path, key);
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Discard all
    document.getElementById('discard-all-btn').addEventListener('click', () => {
        if (confirm('Discard all pending changes?')) {
            clearChanges();
            refreshBadge();
            renderPendingChanges(container);
        }
    });

    // Publish
    document.getElementById('publish-btn').addEventListener('click', async () => {
        if (!isGitHubConfigured()) {
            showMsg('publish-msg', 'GitHub not configured.', 'error');
            return;
        }

        const pubBtn = document.getElementById('publish-btn');
        pubBtn.disabled = true;
        pubBtn.textContent = 'Publishing...';

        const progressEl = document.getElementById('publish-progress');
        progressEl.innerHTML = `
            <div class="publish-progress">
                <div class="publish-progress-bar"><div class="publish-progress-fill" id="progress-fill" style="width:0%"></div></div>
                <div class="publish-progress-text" id="progress-text">Starting...</div>
            </div>`;

        const result = await publishAll((index, total, desc) => {
            const pct = ((index + 1) / total * 100).toFixed(0);
            const fill = document.getElementById('progress-fill');
            const text = document.getElementById('progress-text');
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = `${index + 1}/${total}: ${desc}`;
        });

        if (result.success) {
            showMsg('publish-msg', `Published ${result.published} change${result.published === 1 ? '' : 's'} successfully!`, 'success');
        } else {
            const errList = result.errors.map(e => `<li>${escHtml(e)}</li>`).join('');
            showMsg('publish-msg', `Published ${result.published} changes with ${result.errors.length} error(s):<ul>${errList}</ul>`, 'error');
        }

        refreshBadge();

        // Re-render after short delay
        setTimeout(() => renderPendingChanges(container), 1500);
    });

    // Preview
    document.getElementById('preview-btn').addEventListener('click', () => {
        window.location.href = 'index.html?preview=true';
    });
}

// ---- Helpers ----

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Single source of truth for the icon + default action label per change category.
 * Adding a new change type = one entry here; the label format never drifts.
 */
const CATEGORY_META = {
    'create-league':   { icon: '🆕', action: 'Create league' },
    'delete-league':   { icon: '🗑️', action: 'Delete league' },
    'league-settings': { icon: '⚙️', action: 'Settings updated' },
    'league-players':  { icon: '🚩', action: 'Players updated' },
    'league-data':     { icon: '📊', action: 'League data updated' },
    'match-override':  { icon: '⚖️', action: 'Match override' },
    'edit-override':   { icon: '✏️', action: 'Override edited' },
    'remove-override': { icon: '➖', action: 'Override removed' },
    'bgsync':          { icon: '🔄', action: 'Auto-sync updated' },
    'player-meta':     { icon: '👤', action: 'Player updated' },
    'player-photo':    { icon: '📷', action: 'Photo updated' },
    'player-rename':   { icon: '✏️', action: 'Renamed across leagues' },
    'create-player':   { icon: '🆕', action: 'Player created' },
    'flag-upload':     { icon: '🏳️', action: 'Flag uploaded' },
    'landing':         { icon: '🏠', action: 'Landing updated' }
};

/**
 * Canonical pending-row label: `{icon}  <b>{subject}</b> · {action}{ — {detail}}`.
 * Only the subject (league / player / flag code) is bold. Returns null when the
 * category is unknown, so callers can fall back to the legacy formatter.
 */
function renderLabel(category, subject, detail, action) {
    const meta = CATEGORY_META[category];
    if (!meta) return null;
    let s = `${meta.icon}&nbsp; `;
    if (subject) s += `<b>${escHtml(subject)}</b> · `;
    s += escHtml(action || meta.action);
    if (detail) s += ` — ${escHtml(detail)}`;
    return s;
}

/**
 * Build display items from raw changes. Groups changes with the same `group` field.
 * Labels come from `renderLabel` (category-based) when a `category` is present,
 * otherwise from the legacy path-sniffing `formatChangeDesc`.
 */
function buildDisplayItems(changes) {
    const items = [];
    const groupMap = new Map();

    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];

        if (c.group) {
            if (!groupMap.has(c.group)) {
                groupMap.set(c.group, {
                    group: c.group,
                    indices: [],
                    timestamp: c.timestamp,
                    description: c.groupDescription || c.description,
                    descriptionHtml: c.groupDescriptionHtml || null,
                    editedPlayers: c.editedPlayers || null,
                    category: c.category || null,
                    subject: c.subject || null,
                    detail: c.detail || null,
                    action: c.action || null
                });
            }
            const g = groupMap.get(c.group);
            g.indices.push(i);
            if (c.timestamp > g.timestamp) g.timestamp = c.timestamp;
            if (c.editedPlayers) g.editedPlayers = c.editedPlayers;
            if (c.groupDescriptionHtml) g.descriptionHtml = c.groupDescriptionHtml;
            // A group inherits its category/subject from the first change that declares one.
            if (!g.category && c.category) {
                g.category = c.category;
                g.subject = c.subject || null;
                g.detail = c.detail || null;
                g.action = c.action || null;
            }
        } else if (c.path && c.path.endsWith('manual_overrides.json') && c.content) {
            // Show only the DELTA vs the published baseline: one row per added/changed
            // override (⚖️) and one per removed override (➖). Unchanged overrides that
            // happen to live in the same file are NOT shown.
            try {
                const staged = JSON.parse(c.content).overrides || [];
                const { added, changed, removed } = diffOverrides(staged, c.baselineOverrides || []);
                let league = '';
                const lm = c.path.match(/^leagues\/([^/]+)\//);
                if (lm) league = decodeURIComponent(lm[1]);

                // Added — brand-new override. Cancel removes it outright.
                for (const { override: o, index } of added) {
                    items.push({
                        group: null,
                        indices: [i],
                        overridePath: c.path,
                        overrideIndex: index,
                        timestamp: o.timestamp || c.timestamp,
                        displayText: renderLabel('match-override', league, `${o.playerA} vs ${o.playerB} (${o.type})`)
                    });
                }
                // Changed — an existing published override was edited. Cancel reverts
                // it to the published value (NOT a deletion).
                for (const { override: o } of changed) {
                    items.push({
                        group: null,
                        indices: [i],
                        restorePath: c.path,
                        restoreKey: overrideKey(o),
                        timestamp: o.timestamp || c.timestamp,
                        displayText: renderLabel('edit-override', league, `${o.playerA} vs ${o.playerB} (${o.type})`)
                    });
                }
                // Removed — Cancel restores the published value.
                for (const o of removed) {
                    items.push({
                        group: null,
                        indices: [i],
                        restorePath: c.path,
                        restoreKey: overrideKey(o),
                        timestamp: c.timestamp,
                        displayText: renderLabel('remove-override', league, `${o.playerA} vs ${o.playerB}`)
                    });
                }
            } catch {
                items.push({
                    group: null, indices: [i],
                    timestamp: c.timestamp,
                    displayText: renderLabel(c.category, c.subject, c.detail, c.action) || formatChangeDesc(c)
                });
            }
        } else {
            items.push({
                group: null,
                indices: [i],
                timestamp: c.timestamp,
                displayText: renderLabel(c.category, c.subject, c.detail, c.action) || formatChangeDesc(c)
            });
        }
    }

    // Add grouped items — show editedPlayers as individual sub-lines
    for (const g of groupMap.values()) {
        if (g.editedPlayers && g.editedPlayers.length > 0) {
            for (const player of g.editedPlayers) {
                items.push({
                    group: g.group,
                    indices: g.indices,
                    removePlayer: player,
                    timestamp: g.timestamp,
                    displayText: renderLabel('player-meta', player)
                });
            }
        } else {
            items.push({
                group: g.group,
                indices: g.indices,
                timestamp: g.timestamp,
                displayText: renderLabel(g.category, g.subject, g.detail, g.action)
                    || g.descriptionHtml || escHtml(g.description)
            });
        }
    }

    return items;
}

/**
 * Format a change into: [League] • [Type] — [Detail]
 */
function formatChangeDesc(change) {
    const path = change.path || '';

    // Extract league name from path like "leagues/Shabi%20Israel%20April%202026/..."
    let league = '';
    const leagueMatch = path.match(/^leagues\/([^/]+)\//);
    if (leagueMatch) {
        league = decodeURIComponent(leagueMatch[1]);
    }

    // Determine type and detail
    let type = '';
    let detail = change.description || '';

    if (path.endsWith('manual_overrides.json')) {
        type = 'Match Override';
        // Extract detail from description like "Override: X vs Y (result)"
        const m = detail.match(/Override:\s*(.+)/);
        if (m) detail = m[1];
        else if (detail.startsWith('Remove override')) {
            type = 'Remove Override';
            detail = detail.replace(/Remove override #\d+:\s*/, '');
        }
    } else if (path.endsWith('league_params.json')) {
        if (change.type === 'delete') {
            type = 'Delete';
            detail = 'League files';
        } else if (detail.includes('Update players')) {
            type = 'Players';
            detail = 'Updated player settings';
        } else if (detail.includes('Update settings') || detail.includes('Create league')) {
            type = 'Settings';
            detail = detail.replace(/^(Update settings|Create league):\s*/, '');
        } else {
            type = 'Settings';
        }
    } else if (path.endsWith('leaguedata.csv')) {
        if (change.type === 'delete') {
            type = 'Delete';
            detail = 'CSV data';
        } else if (detail.includes('Rename')) {
            type = 'CSV';
            detail = detail.replace(/Rename players in CSV:\s*/, 'Renamed: ');
        } else {
            type = 'CSV Import';
        }
    } else if (path === 'leagues/landing_settings.json') {
        type = 'Landing Settings';
        league = '';
        const addMatch = detail.match(/Add "(.+)" to/);
        const rmMatch = detail.match(/Remove "(.+)" from/);
        if (addMatch) detail = `Added: ${addMatch[1]}`;
        else if (rmMatch) detail = `Removed: ${rmMatch[1]}`;
        else if (detail.includes('Update landing')) detail = 'Landing page updated';
    } else if (path.startsWith('assets/flags/') || path.startsWith('assets/logo/')) {
        type = 'Flag Upload';
        league = '';
    } else {
        type = change.type || 'Update';
    }

    // Build formatted string
    let text = '';
    if (league) text += `<b>${escHtml(league)}</b> · `;
    if (type) text += `${escHtml(type)} — `;
    text += escHtml(detail);
    return text;
}
