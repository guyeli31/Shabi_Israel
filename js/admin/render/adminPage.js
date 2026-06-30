/**
 * adminPage.js — Render the admin panel shell: login, sidebar, settings, pending changes.
 */

import { isLoggedIn, logout, getToken, setToken, getRepo, setRepo, isGitHubConfigured, getUsername } from '../auth.js';
import { testConnection } from '../githubApi.js';
import { getChanges, removeChange, removeGroup, removeOverrideFromChange, restoreOverrideToChange, removePlayerFromGroup, getChangeCount, publishAll, clearChanges, diffOverrides, overrideKey } from '../stagingStore.js';
import { setTopbarSection } from '../adminDrawer.js';
import { mountSidebarToggle } from '../../render/sidebarToggle.js';

const VIEW_TITLES = { leagues: 'Leagues', players: 'Players', pending: 'Pending Changes', settings: 'Settings' };

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
        const initial = (hash === 'pending' || hash === 'settings' || hash === 'leagues' || hash === 'players') ? hash : 'leagues';
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
    document.querySelectorAll('.admin-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    const main = document.getElementById('admin-content');
    if (!main) return;

    if (view === 'settings') {
        renderSettings(main);
    } else if (view === 'pending') {
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
    const count = getChangeCount();

    app.innerHTML = `
        <div class="admin-layout">
            <aside class="admin-sidebar" id="admin-sidebar">
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
                    <a href="index.html?edit=1" class="admin-nav-item">
                        <span class="admin-nav-icon" aria-hidden="true">🏠</span><span>Main Dashboard</span>
                    </a>
                    <button class="admin-nav-item" data-view="leagues">
                        <span class="admin-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="6.5" x2="8" y2="13"/></svg></span><span>Leagues</span>
                    </button>
                    <button class="admin-nav-item" data-view="players">
                        <span class="admin-nav-icon" aria-hidden="true">👥</span><span>Players</span>
                    </button>
                    <button class="admin-nav-item" data-view="pending">
                        <span class="admin-nav-icon" aria-hidden="true">📝</span><span>Pending Changes</span> <span id="staging-badge" class="staging-badge ${count === 0 ? 'empty' : ''}">${count}</span>
                    </button>
                    <button class="admin-nav-item" data-view="settings">
                        <span class="admin-nav-icon" aria-hidden="true">⚙️</span><span>Settings</span>
                    </button>
                </nav>
                <div class="admin-sidebar-footer">
                    <a href="index.html" class="admin-nav-item admin-home-link" title="View Site">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
                        <span>Home</span>
                    </a>
                    <button class="admin-nav-item admin-logout-btn" id="logout-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>
            <main class="admin-main" id="admin-content">
                <div class="loading">Loading...</div>
            </main>
        </div>`;

    // Nav clicks
    document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        logout();
        location.href = 'index.html';
    });

    // Mount the SAME universal hamburger that drives the public site sidebar.
    // It manipulates `body.site-sidebar-closed`; the .admin-sidebar CSS in
    // admin.css honors that class with the same transform/margin transition,
    // so the toggle UX is identical across both surfaces. Replaces the older
    // initAdminDrawer() topbar+drawer combo (the page title <h1> in the main
    // content already provides the "where am I" cue the old topbar did).
    mountSidebarToggle({ ariaControlsId: 'admin-sidebar' });
}

// ---- Settings ----

function renderSettings(container) {
    const repo = getRepo();
    const repoStr = repo ? `${repo.owner}/${repo.repo}` : '';
    const token = getToken();
    const masked = token ? token.slice(0, 8) + '...' + token.slice(-4) : '';

    container.innerHTML = `
        <h1>Settings</h1>

        <div class="admin-card">
            <h2>GitHub Repository</h2>
            <div id="settings-msg"></div>
            <div class="form-group">
                <label for="settings-repo">Repository (owner/repo)</label>
                <input type="text" id="settings-repo" value="${repoStr}" placeholder="owner/repo">
            </div>
            <div class="form-group">
                <label for="settings-token">Personal Access Token</label>
                <input type="password" id="settings-token" value="${token}" placeholder="ghp_...">
                ${masked ? `<small style="color:var(--color-text-muted)">Current: ${masked}</small>` : ''}
            </div>
            <button class="btn btn-primary" id="settings-save">Save</button>
            <button class="btn btn-secondary" id="settings-test" style="margin-left:var(--space-sm)">Test Connection</button>
        </div>

        <div class="admin-card">
            <h2>Session</h2>
            <p style="color:var(--color-text-secondary);font-size:0.9rem">
                Logged in as <b>admin</b>.
                Token and repo settings persist across sessions in localStorage.
            </p>
        </div>`;

    document.getElementById('settings-save').addEventListener('click', () => {
        const repoVal = document.getElementById('settings-repo').value.trim();
        const tokenVal = document.getElementById('settings-token').value.trim();

        if (repoVal && !repoVal.includes('/')) {
            showMsg('settings-msg', 'Repo must be in "owner/repo" format.', 'error');
            return;
        }

        if (repoVal) setRepo(repoVal);
        if (tokenVal) setToken(tokenVal);
        showMsg('settings-msg', 'Settings saved.', 'success');
    });

    document.getElementById('settings-test').addEventListener('click', async () => {
        if (!isGitHubConfigured()) {
            showMsg('settings-msg', 'Please save repo and token first.', 'error');
            return;
        }
        const btn = document.getElementById('settings-test');
        btn.disabled = true;
        btn.textContent = 'Testing...';
        try {
            const ok = await testConnection();
            showMsg('settings-msg', ok ? 'Connection successful!' : 'Connection failed — check credentials.', ok ? 'success' : 'error');
        } catch (err) {
            showMsg('settings-msg', `Error: ${err.message}`, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Test Connection';
    });
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
            showMsg('publish-msg', 'GitHub not configured. Go to Settings first.', 'error');
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
