/**
 * adminPage.js — Render the admin panel shell: login, sidebar, pending changes.
 */

import { isLoggedIn, logout } from '../auth.js';
import { getChanges, removeChange, removeGroup, removeOverrideFromChange, restoreOverrideToChange, removePlayerFromGroup, getChangeCount, publishAll, clearChanges, diffOverrides, overrideKey } from '../stagingStore.js';
import { setTopbarSection } from '../adminDrawer.js';
import { mountSidebarToggle } from '../../render/sidebarToggle.js';
import { mountTopbar } from '../../render/topbar.js';
import { installSearchOverlay } from '../../render/searchOverlay.js';
import { buildAdminSidebarHtml, wireAdminSidebar } from './adminSidebarNav.js';
import { renderHistoricalChanges } from './historicalChanges.js';
import { renderCategoryLabel } from './changeVocabulary.js';
// Stage keys must match SPLASH_STAGE_SETS.admin.
import { splashStage, endSplash, restartSplash } from '../../utils/splash.js';

// Hash slug → view title. Per CLAUDE.md § URL contract the slug IS the title,
// kebab-cased — `#pending-changes`, not `#pending` for a section called
// "Pending Changes". scripts/check-url-contract.js enforces the pairing.
const VIEW_TITLES = {
    leagues: 'Leagues',
    players: 'Players',
    'pending-changes': 'Pending Changes',
    'historical-changes': 'Historical Changes',
    sync: 'Sync',
};
const VIEW_KEYS = Object.keys(VIEW_TITLES);
const DEFAULT_VIEW = 'leagues';
// Slugs retired by the 2026-08 URL-contract rename — an old bookmark still
// lands on the right view, and the hash normalises itself on arrival.
const LEGACY_VIEW_SLUGS = { pending: 'pending-changes', history: 'historical-changes' };

let currentView = DEFAULT_VIEW;
let onNavigate = null; // callback set by admin.html to handle view switching

/**
 * Initialize the admin page. Called once on load.
 * @param {function} viewCallback — called with (viewName) when nav changes
 */
export function initAdminPage(viewCallback) {
    onNavigate = viewCallback;

    splashStage('session');
    if (!isLoggedIn()) {
        // Deliberately leaving the splash up: we are navigating away, and
        // uncovering a half-built admin panel for the instant before the
        // redirect lands is worse than holding the loading screen.
        location.href = 'index.html';
        return;
    } else {
        renderAdminShell();
        splashStage('shell');
        // The hash may carry a sub-route after the view, e.g.
        // #leagues/edit/<id>/round-editor. The first segment picks the top-level
        // view; the rest is handed to that view (only Leagues consumes it today)
        // so a browser refresh restores deep state, not just the section.
        const segments = (location.hash || '').replace(/^#/, '').split('/').filter(Boolean);
        const raw = segments[0];
        const initial = VIEW_KEYS.includes(raw) ? raw : (LEGACY_VIEW_SLUGS[raw] || DEFAULT_VIEW);
        // `restore` normally leaves the hash untouched so a deep sub-route
        // survives a reload — but when a legacy slug fired there IS no sub-route
        // to protect, and the stale hash needs rewriting to the current one.
        navigateTo(initial, { restore: raw === initial, subroute: segments.slice(1) });
    }
}

/**
 * Navigate to a view.
 */
export function navigateTo(view, opts = {}) {
    currentView = view;

    // Mirror the active view into the URL hash so a browser Refresh restores the
    // same section instead of snapping back to the default. initAdminPage() reads
    // location.hash on load — this is the write half. replaceState (not pushState)
    // keeps refresh-persistence without stacking a back-button entry per nav:
    // per CLAUDE.md § URL contract only main tabs push, and stepping Back through
    // a deep admin sub-route one segment at a time is worse than not.
    //
    // The DEFAULT view carries NO hash, exactly as appTabs omits the first tab
    // from ?tab= — the URL names only what differs from the default. Before this,
    // landing on admin.html gave a bare URL while clicking the already-active
    // Leagues item wrote `#leagues`, so one view had two URLs.
    //
    // On `restore` (page load) leave the hash exactly as-is so a view's own deep
    // sub-route (e.g. #leagues/edit/<id>/round-editor, written by the league
    // manager) survives the reload. Otherwise compare the FULL hash so clicking a
    // nav item from inside a deep sub-route collapses it back to the bare view.
    if (!opts.restore) {
        const want = view === DEFAULT_VIEW ? '' : `#${view}`;
        if ((location.hash || '') !== want) {
            history.replaceState(history.state, '', want || location.pathname + location.search);
        }
    }

    setTopbarSection(VIEW_TITLES[view] || view);

    // Update active nav item
    document.querySelectorAll('.site-nav-item[data-view]').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    const main = document.getElementById('admin-content');
    if (!main) {
        finishNav();   // nothing left to wait for; don't strand the splash
        return;
    }

    // Every section here loads its own data from Supabase, so a section switch
    // is a data load, not a panel swap — the same category as analytics' month
    // picker. Each view used to narrate that with its own line of text
    // ("Loading sync settings…", "Loading leagues...", one per module), which
    // is how the admin ended up with seven different loading screens. A no-op
    // on the first navigation, where the page's own splash is still up.
    restartSplash({ stages: 'adminView' });
    splashStage('data');

    let pending;
    if (view === 'pending-changes') {
        pending = renderPendingChanges(main);
    } else if (view === 'historical-changes') {
        pending = renderHistoricalChanges(main);
    } else if (onNavigate) {
        // admin.html's callback is async (it dynamically imports the view
        // module), so this is a promise — the splash must outlive it.
        pending = onNavigate(view, main, opts.subroute || []);
    }

    // Every branch converges here, including the two views above, which never
    // reach onNavigate. Routing the splash through this one point is why opening
    // admin on #historical-changes doesn't leave the loading screen up until the
    // 25s fail-safe. Promise.resolve() normalises the synchronous branches.
    Promise.resolve(pending)
        .catch(() => {})    // a failing view must still uncover the page
        .finally(() => { splashStage('render'); finishNav(); });
}

/** Take the splash away once this navigation's view has settled.
 *
 *  This used to fire only on the FIRST navigation, on the reasoning that later
 *  ones are in-page moves that shouldn't raise a full-screen loader. That was
 *  the wrong cut: every admin section fetches its own data, so a section switch
 *  is a wait of the same kind as opening the page, and leaving it to each view
 *  module meant seven different loading messages for one action. Now every
 *  navigation both starts (restartSplash) and ends the splash — and the
 *  delay/minimum pair means a section that loads from cache never flashes one. */
function finishNav() {
    endSplash();
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
            <!-- Empty: the splash is up for the whole of the first load and
                 the first view renders straight into here, so a placeholder is
                 never seen. It only existed from before the splash. -->
            <main class="admin-main" id="admin-content"></main>
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
        } else if (item.overrideLeague != null) {
            cancelAttr = `data-remove-override-league="${escHtml(item.overrideLeague)}" data-remove-override-idx="${item.overrideIndex}"`;
        } else if (item.restoreLeague != null) {
            cancelAttr = `data-restore-override-league="${escHtml(item.restoreLeague)}" data-restore-override-key="${encodeURIComponent(item.restoreKey)}"`;
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
    container.querySelectorAll('[data-remove-override-league]').forEach(btn => {
        btn.addEventListener('click', () => {
            const leagueId = btn.dataset.removeOverrideLeague;
            const idx = parseInt(btn.dataset.removeOverrideIdx);
            removeOverrideFromChange(leagueId, idx);
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Cancel a removed-override delta row (restore it into the staged file)
    container.querySelectorAll('[data-restore-override-league]').forEach(btn => {
        btn.addEventListener('click', () => {
            const leagueId = btn.dataset.restoreOverrideLeague;
            const key = decodeURIComponent(btn.dataset.restoreOverrideKey);
            restoreOverrideToChange(leagueId, key);
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

        let failureHtml = null;
        if (result.success) {
            showMsg('publish-msg', `Published ${result.published} change${result.published === 1 ? '' : 's'} successfully!`, 'success');
        } else {
            const errList = result.errors.map(e => `<li>${escHtml(e)}</li>`).join('');
            failureHtml = `Published ${result.published} changes with ${result.errors.length} error(s):<ul>${errList}</ul>`;
            showMsg('publish-msg', failureHtml, 'error');
        }

        refreshBadge();

        // Re-render, then PUT THE FAILURE BACK.
        //
        // The re-render rebuilds this whole view, which wipes #publish-msg with
        // it — so the error list that publishAll went to the trouble of
        // collecting was on screen for 1.5 seconds and then gone, and a publish
        // that half-failed ended up looking exactly like one that succeeded.
        // Since a failed write is also dropped from the queue, that message was
        // the ONLY notice the admin would ever get. It stays until they navigate
        // away themselves; the success message still clears, because a clean
        // publish has nothing to come back to.
        setTimeout(() => {
            renderPendingChanges(container);
            if (failureHtml) showMsg('publish-msg', failureHtml, 'error');
        }, 1500);
    });

    // Preview
    document.getElementById('preview-btn').addEventListener('click', () => {
        window.location.href = 'index.html?preview';
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
 * Build display items from raw changes. Groups changes with the same `group` field.
 * Labels come from `renderCategoryLabel` (category-based, shared with the
 * Historical view via changeVocabulary.js) when a `category` is present,
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
        } else if (c.target?.kind === 'manual_overrides' && c.content) {
            // Show only the DELTA vs the published baseline: one row per added/changed
            // override (⚖️) and one per removed override (➖). Unchanged overrides that
            // happen to live in the same file are NOT shown.
            try {
                const staged = JSON.parse(c.content).overrides || [];
                const { added, changed, removed } = diffOverrides(staged, c.baselineOverrides || []);
                const league = c.target.leagueId;

                // Added — brand-new override. Cancel removes it outright.
                for (const { override: o, index } of added) {
                    items.push({
                        group: null,
                        indices: [i],
                        overrideLeague: league,
                        overrideIndex: index,
                        timestamp: o.timestamp || c.timestamp,
                        displayText: renderCategoryLabel('match-override', league, `${o.playerA} vs ${o.playerB} (${o.type})`)
                    });
                }
                // Changed — an existing published override was edited. Cancel reverts
                // it to the published value (NOT a deletion).
                for (const { override: o } of changed) {
                    items.push({
                        group: null,
                        indices: [i],
                        restoreLeague: league,
                        restoreKey: overrideKey(o),
                        timestamp: o.timestamp || c.timestamp,
                        displayText: renderCategoryLabel('edit-override', league, `${o.playerA} vs ${o.playerB} (${o.type})`)
                    });
                }
                // Removed — Cancel restores the published value.
                for (const o of removed) {
                    items.push({
                        group: null,
                        indices: [i],
                        restoreLeague: league,
                        restoreKey: overrideKey(o),
                        timestamp: c.timestamp,
                        displayText: renderCategoryLabel('remove-override', league, `${o.playerA} vs ${o.playerB}`)
                    });
                }
            } catch {
                items.push({
                    group: null, indices: [i],
                    timestamp: c.timestamp,
                    displayText: renderCategoryLabel(c.category, c.subject, c.detail, c.action) || formatChangeDesc(c)
                });
            }
        } else {
            items.push({
                group: null,
                indices: [i],
                timestamp: c.timestamp,
                displayText: renderCategoryLabel(c.category, c.subject, c.detail, c.action) || formatChangeDesc(c)
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
                    displayText: renderCategoryLabel('player-meta', player)
                });
            }
        } else {
            items.push({
                group: g.group,
                indices: g.indices,
                timestamp: g.timestamp,
                displayText: renderCategoryLabel(g.category, g.subject, g.detail, g.action)
                    || g.descriptionHtml || escHtml(g.description)
            });
        }
    }

    return items;
}

/**
 * Format a change into: [League] • [Type] — [Detail]
 *
 * Fallback for changes that carry no `category` (renderCategoryLabel handles
 * the rest). Reads the change's target instead of sniffing a path string.
 */
function formatChangeDesc(change) {
    const target = change.target || {};
    let league = target.leagueId || '';
    let type = '';
    let detail = change.description || '';

    switch (target.kind) {
        case 'manual_overrides': {
            type = 'Match Override';
            // Extract detail from description like "Override: X vs Y (result)"
            const m = detail.match(/Override:\s*(.+)/);
            if (m) detail = m[1];
            else if (detail.startsWith('Remove override')) {
                type = 'Remove Override';
                detail = detail.replace(/Remove override #\d+:\s*/, '');
            }
            break;
        }
        case 'league_rename':
            type = 'Rename';
            break;
        case 'league_params':
            if (change.type === 'delete') {
                type = 'Delete';
                detail = 'League';
            } else if (detail.includes('Update players')) {
                type = 'Players';
                detail = 'Updated player settings';
            } else if (detail.includes('Update settings') || detail.includes('Create league')) {
                type = 'Settings';
                detail = detail.replace(/^(Update settings|Create league):\s*/, '');
            } else {
                type = 'Settings';
            }
            break;
        case 'leaguedata_csv':
            if (change.type === 'delete') {
                type = 'Delete';
                detail = 'Match data';
            } else if (detail.includes('Rename')) {
                type = 'CSV';
                detail = detail.replace(/Rename players in CSV:\s*/, 'Renamed: ');
            } else {
                type = 'CSV Import';
            }
            break;
        case 'landing_settings': {
            type = 'Landing Settings';
            const addMatch = detail.match(/Add "(.+)" to/);
            const rmMatch = detail.match(/Remove "(.+)" from/);
            if (addMatch) detail = `Added: ${addMatch[1]}`;
            else if (rmMatch) detail = `Removed: ${rmMatch[1]}`;
            else if (detail.includes('Update landing')) detail = 'Landing page updated';
            break;
        }
        case 'sync_settings':
            type = 'Sync Settings';
            break;
        case 'players_metadata':
            type = 'Player Metadata';
            break;
        case 'flag_asset':
            type = 'Flag Upload';
            break;
        case 'player_photo':
            type = change.type === 'delete' ? 'Photo Removed' : 'Photo Upload';
            break;
        default:
            type = change.type || 'Update';
    }

    // Build formatted string
    let text = '';
    if (league) text += `<b>${escHtml(league)}</b> · `;
    if (type) text += `${escHtml(type)} — `;
    text += escHtml(detail);
    return text;
}
