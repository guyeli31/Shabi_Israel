/**
 * landingPage.js — Render the index dashboard (Phase H).
 *
 * Sections:
 *   H4 — General info cards (total players, total leagues, last updated)
 *   H3 — Player search
 *   H1 — Active leagues (card grid) + completed leagues (compact table)
 *   H2 — Annual leaderboard tables (per year × league type)
 */

import { loadAllLeagues } from '../compute/crossLeague.js';
import { buildAllTimeRankings } from '../compute/allTimeRankings.js';
import { colorForValue } from '../compute/colorScale.js';
import { luckBellCurveSvg } from './luckBellCurve.js';
import { loadLandingSettings } from '../data/leagueLoader.js';
import { dashboardUrl, flagUrl, getFlagCode, formatPercent, formatNumber, parseLeagueDate, leagueUrl, thLabel } from '../utils/helpers.js';
import { exportTableImage } from '../utils/exportTableImage.js';
import { collectLuckMatches, collectPRMatches, topLuckiestMatches, topBestPRMatches } from '../compute/matchRecords.js';
import { luckPercentileStats } from '../compute/luckPercentile.js';
import { getLevel } from '../compute/rankings.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { mountSFTable } from '../../table-lab/formats/sf/mount.js';
import { buildCompletedLeaguesPreset } from '../presets/completedLeaguesPreset.js';
import { buildAnnualLeaderboardPreset } from '../presets/annualLeaderboardPreset.js';
import { isLoggedIn } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';
import { addChange, getChangeCount } from '../admin/stagingStore.js';
import { mountAdminSidebar, refreshBadge as refreshSidebarBadge } from '../admin/render/adminSidebar.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { hasTitles, compareTitlePriority, getFullTitleDescription } from '../data/titleConstants.js';
import { startSplash, updateSplashLogo, endSplash } from '../utils/splash.js';
import { mountAppTabs } from './appTabs.js';

/* ── Helpers ─────────────────────────────────────────── */

const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const MONTH_SHORT = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
];

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Main entry ──────────────────────────────────────── */

/** Landing settings loaded once, shared with edit mode. */
let _landingSettings = null;
/** Players metadata loaded once, shared across renderers. */
let _playersMeta = {};

export async function renderLandingPage() {
    const container = document.getElementById('content');
    container.innerHTML = '<div class="loading">Loading leagues...</div>';

    const logoEl = document.getElementById('site-logo');
    if (logoEl) logoEl.classList.add('logo-loading');

    startSplash();

    try {
        // Load landing settings and populate header
        _landingSettings = await loadLandingSettings();
        populateHeader(_landingSettings);
        updateSplashLogo(_landingSettings.logoPath);

        const [allLeagues, playersMeta] = await Promise.all([
            loadAllLeagues(),
            loadPlayersMetadata()
        ]);
        _playersMeta = playersMeta;

        // Filter hidden leagues for non-admin users
        const adminLoggedIn = isLoggedIn() && !isPreviewMode();
        const leagues = adminLoggedIn
            ? allLeagues
            : allLeagues.filter(l => !l.params.Hidden);

        // Compute aggregate data
        const allPlayers = new Set();
        const activePlayers = new Set();
        let latestModified = null;

        for (const l of leagues) {
            for (const p of l.allPlayers) {
                allPlayers.add(p);
                if (l.params.Running === true) activePlayers.add(p);
            }
            if (l.lastModified) {
                const d = new Date(l.lastModified);
                if (!latestModified || d > latestModified) latestModified = d;
            }
        }

        // Extract leader per league
        const leaguesWithLeaders = leagues.map(l => {
            const leader = l.rankings.length > 0 && l.rankings[0].games > 0
                ? l.rankings[0] : null;
            return { ...l, leader };
        });

        const running = leaguesWithLeaders.filter(l => l.params.Running === true);
        const completed = leaguesWithLeaders.filter(l => l.params.Running !== true);

        // Build annual leaderboards
        const leaderboards = buildAllLeaderboards(leagues);

        // Render
        container.innerHTML = '';

        // Info cards belong with the hero (right under the subtitle), not inside a tab panel.
        renderInfoCards(container, activePlayers.size, allPlayers.size, leagues.length, latestModified);

        // Tabs shell — groups the existing sections into 4 mental buckets.
        const presentTypes = [...new Set(leagues.map(l => l.leagueType))];
        const shell = buildTabsShell();
        container.appendChild(shell.root);

        // Route renderers to their tab panel — each renderer keeps its existing signature.
        renderActiveLeagues(shell.panels.leagues, running);
        if (completed.length > 0) renderCompletedLeagues(shell.panels.leagues, completed);

        renderLeaderboards(shell.panels.leaderboard, leaderboards);

        renderAchievementsSection(shell.panels.records, presentTypes);
        renderPRLeadersSection(shell.panels.records, presentTypes);
        renderMatchRecordsSection(shell.panels.records, leagues, presentTypes);
        renderLeagueRecordsSection(shell.panels.records, leagues, presentTypes);

        // Players tab — two sub-tabs: Notable Figures + Rest of Players.
        // Both rendered as SF tables (Player / Status / Last Active / Title)
        // with sticky Player column. Fixed sort: active first, then alphabetical.
        renderPlayersTab(shell.panels.players, _playersMeta, leagues);

        const credit = document.createElement('div');
        credit.className = 'platform-credit';
        credit.textContent = 'Built by Guy Eliyahu  ·  April 2026';
        container.appendChild(credit);

        // Auto-enter edit mode if admin and ?edit=1 in URL
        if (adminLoggedIn && new URLSearchParams(location.search).get('edit') === '1') {
            enterEditMode(_landingSettings);
        }
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load leagues: ${err.message}</div>`;
    } finally {
        if (logoEl) logoEl.classList.remove('logo-loading');
        endSplash();
    }
}

/* ── Tabs shell (Progressive Disclosure) ──────────────── */

function buildTabsShell() {
    // Generic tab behaviour (activation, ?tab= URL state, ARIA keyboard nav,
    // 1-N hotkeys) lives in the shared mountAppTabs(). This wrapper only
    // declares the HOME-specific tab set and keeps the page-framing classes
    // (.lp-tabs-shell / .lp-tab-panel) that css/index-dashboard.css styles.
    return mountAppTabs({
        tabs: [
            { id: 'leagues',     label: 'Leagues' },
            { id: 'leaderboard', label: 'Leaderboard' },
            { id: 'records',     label: 'Records' },
            { id: 'players',     label: 'Players' }
        ],
        urlKey: 'tab',
        ariaLabel: 'Home sections',
        shellClass: 'lp-tabs-shell',
        panelClass: 'lp-tab-panel'
    });
}

/* ── Players tab — Notable Figures + Rest of Players (SF tables) ── */

function renderPlayersTab(container, allMeta, leagues) {
    const allRows = computePlayerRows(allMeta, leagues);
    // One combined table: titled players first, untitled below — each subgroup A→Z.
    const rows = sortPlayerRows(allRows);

    const cols = buildPlayerCols();

    const mount = document.createElement('div');
    mount.className = 'lp-players-section';
    container.appendChild(mount);

    const { table } = mountSFTable(mount, {
        tableId:   'A7',
        title:     `Players (${rows.length})`,
        data:      rows,
        cols,
        fontClass: 'font-small',
        stickyCols: 1,
        showTopN:  50
    });
    table.classList.add('sf-sticky-1');

    // Right-click context menu on every player-name link (no leagueId → general profile).
    attachPlayerNameInteractions(mount, null);
}

/** 3-state player status → label/color map.
 *  active   → currently playing in a Running league         (green)
 *  this-year → played in any league this calendar year       (orange / bronze)
 *  inactive → none of the above                              (gray)
 */
const PLAYER_STATUS_LABEL = { active: 'Active', 'this-year': 'This Year', inactive: 'Inactive' };

function computePlayerRows(allMeta, leagues) {
    const allNames = new Set(Object.keys(allMeta || {}));
    for (const l of leagues) for (const p of l.allPlayers) allNames.add(p);

    const activeSet = new Set();
    for (const l of leagues) {
        if (l.params?.Running === true) {
            for (const p of l.allPlayers) activeSet.add(p);
        }
    }

    const playerFlags = {};
    for (const l of leagues) {
        for (const p of l.allPlayers) {
            if (!playerFlags[p]) playerFlags[p] = getFlagCode(p, l.params?.CustomFlags);
        }
    }

    function leagueDate(l) {
        if (l.params?.IssueDate) return new Date(l.params.IssueDate);
        const { year, monthIndex } = parseLeagueDate(l.id);
        return new Date(Date.UTC(year, monthIndex, 1));
    }

    function lastLeagueFor(name) {
        let best = null;
        for (const l of leagues) {
            if (!l.allPlayers.has(name)) continue;
            const d = leagueDate(l);
            if (!best || d > best.date) best = { date: d, title: l.title, id: l.id };
        }
        return best;
    }

    const currentYear = new Date().getUTCFullYear();

    function statusFor(name, last) {
        if (activeSet.has(name)) return 'active';
        if (last && last.date.getUTCFullYear() === currentYear) return 'this-year';
        return 'inactive';
    }

    return [...allNames]
        .map(name => {
            const meta = allMeta?.[name] || {};
            if (meta.hidden) return null;
            const last = lastLeagueFor(name);
            return {
                name,
                meta,
                fullName: meta.fullName || '',
                flag: playerFlags[name] || 'IL',
                hasTitle: hasTitles(meta),
                titleDesc: hasTitles(meta) ? getFullTitleDescription(meta) : '',
                status: statusFor(name, last),
                lastActiveDate: last?.date || null,
                lastActiveTitle: last?.title || null,
                lastActiveLeagueId: last?.id || null,
            };
        })
        .filter(Boolean);
}

function sortPlayerRows(rows) {
    return rows.slice().sort((a, b) => {
        // Titled players first, untitled below.
        if (a.hasTitle !== b.hasTitle) return a.hasTitle ? -1 : 1;
        // Within each subgroup, alphabetical A→Z.
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

function buildPlayerCols() {
    return [
        {
            key: 'name',
            label: 'Player',
            tdClass: 'player-cell',
            format: (_, row) => {
                const realName = row.fullName
                    ? ` <span class="lp-realname">${escapeHtml(row.fullName)}</span>`
                    : '';
                return `<img class="flag" src="${flagUrl(row.flag)}" alt="${row.flag}">` +
                       `${playerNameLink(row.name, row.meta)}${realName}`;
            },
        },
        {
            key: 'status',
            label: 'Status',
            format: (s) => {
                const label = PLAYER_STATUS_LABEL[s] || 'Inactive';
                return `<span class="lp-status lp-status-${s}"><span class="lp-status-dot"></span>${label}</span>`;
            },
        },
        {
            key: 'lastActiveDate',
            label: 'Last Active',
            format: (d, row) => {
                if (!d) return '<span class="lp-muted">—</span>';
                const label = `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
                const href = row.lastActiveLeagueId ? dashboardUrl(row.lastActiveLeagueId) : null;
                return href
                    ? `<a class="league-link" href="${href}">${label}</a>`
                    : label;
            },
        },
        {
            key: 'titleDesc',
            label: 'Title',
            format: (t) => t ? `<em>${escapeHtml(t)}</em>` : '<span class="lp-muted">—</span>',
        },
    ];
}

/* ── Header population ────────────────────────────────── */

function populateHeader(settings) {
    const logo = document.getElementById('site-logo');
    const title = document.getElementById('site-title');
    const subtitle = document.getElementById('site-subtitle');
    if (logo) logo.src = settings.logoPath;
    if (title) title.textContent = settings.title;
    if (subtitle) subtitle.textContent = settings.subtitle;
}

/* ── Admin Edit Mode ──────────────────────────────────── */

let _editModeActive = false;
let _editState = null; // tracks dirty values during edit

function enterEditMode(settings) {
    _editModeActive = true;
    _editState = {
        title: settings.title,
        subtitle: settings.subtitle,
        logoPath: settings.logoPath,
        logoData: null,       // base64 if user picked a new image
        logoFileName: null,
        displayOrder: [...settings.displayOrder],
        dirty: false
    };

    document.querySelector('.page-container').classList.add('edit-mode');

    // Mount admin sidebar so navigation + Pending badge stay visible while editing
    mountAdminSidebar({ activeView: 'dashboard' });

    // Make title/subtitle editable
    const titleEl = document.getElementById('site-title');
    const subtitleEl = document.getElementById('site-subtitle');
    titleEl.contentEditable = 'true';
    subtitleEl.contentEditable = 'true';
    titleEl.classList.add('editable-field');
    subtitleEl.classList.add('editable-field');

    titleEl.addEventListener('input', onHeaderInput);
    subtitleEl.addEventListener('input', onHeaderInput);

    // Add logo overlay
    const logo = document.getElementById('site-logo');
    const logoWrap = document.createElement('div');
    logoWrap.className = 'logo-edit-wrapper';
    logo.parentNode.insertBefore(logoWrap, logo);
    logoWrap.appendChild(logo);
    const overlay = document.createElement('div');
    overlay.className = 'logo-edit-overlay';
    overlay.textContent = 'Change';
    overlay.addEventListener('click', pickLogo);
    logoWrap.appendChild(overlay);

    // Add drag handles to completed leagues table rows
    addDragHandles();

    // Show save/cancel bar
    showEditBar();

    // Hide search during edit mode — admin button is not created in edit mode, theme picker stays visible
    document.querySelectorAll('.nav-search, .nav-search-wrapper').forEach(el => el.style.display = 'none');

    // Block in-page navigation while editing — only embedded admin sidebar
    // links should remain functional. Covers .page-container AND .site-nav
    // (whose "Shabi Israel" home link + league dropdown would otherwise
    // navigate away and drop ?edit=1, exiting edit mode).
    const guard = (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        if (!a.closest('.page-container, .site-nav')) return;
        e.preventDefault();
        e.stopPropagation();
    };
    document.addEventListener('click', guard, true);
    _editState._clickGuard = guard;
}

function exitEditMode() {
    _editModeActive = false;
    document.querySelector('.page-container').classList.remove('edit-mode');

    // Restore header
    const titleEl = document.getElementById('site-title');
    const subtitleEl = document.getElementById('site-subtitle');
    titleEl.contentEditable = 'false';
    subtitleEl.contentEditable = 'false';
    titleEl.classList.remove('editable-field');
    subtitleEl.classList.remove('editable-field');
    titleEl.removeEventListener('input', onHeaderInput);
    subtitleEl.removeEventListener('input', onHeaderInput);

    // Restore original values
    populateHeader(_landingSettings);

    // Remove logo wrapper
    const logoWrap = document.querySelector('.logo-edit-wrapper');
    if (logoWrap) {
        const logo = logoWrap.querySelector('.logo');
        logoWrap.parentNode.insertBefore(logo, logoWrap);
        logoWrap.remove();
    }

    // Remove drag handles
    removeDragHandles();

    // Remove save/cancel bar
    const bar = document.querySelector('.edit-bar');
    if (bar) bar.remove();

    // Keep admin sidebar mounted so the admin can navigate back to admin.html.
    // Strip ?edit=1 so a refresh returns to view mode instead of re-entering edit mode.
    if (location.search.includes('edit=1')) {
        history.replaceState({}, '', location.pathname + location.hash);
    }

    // Restore search hidden during edit mode
    document.querySelectorAll('.nav-search, .nav-search-wrapper').forEach(el => el.style.display = '');

    if (_editState && _editState._clickGuard) {
        document.removeEventListener('click', _editState._clickGuard, true);
    }

    _editState = null;
}

function onHeaderInput() {
    if (!_editState) return;
    _editState.title = document.getElementById('site-title').textContent.trim();
    _editState.subtitle = document.getElementById('site-subtitle').textContent.trim();
    markDirty();
}

function markDirty() {
    if (!_editState) return;
    _editState.dirty = true;
    const saveBtn = document.querySelector('.edit-bar-save');
    if (saveBtn) saveBtn.disabled = false;
}

function pickLogo() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            _editState.logoData = base64;
            _editState.logoFileName = file.name;
            document.getElementById('site-logo').src = reader.result;
            markDirty();
        };
        reader.readAsDataURL(file);
    });
    input.click();
}

/* ── Drag-and-drop league reorder ─────────────────────── */

let _dragSrcRow = null;

function addDragHandles() {
    const table = document.querySelector('.completed-leagues-table');
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const handle = document.createElement('td');
        handle.className = 'drag-handle';
        handle.innerHTML = '&#10303;'; // grip icon ⠿
        handle.title = 'Drag to reorder';
        row.insertBefore(handle, row.firstChild);
        row.draggable = true;

        row.addEventListener('dragstart', onDragStart);
        row.addEventListener('dragover', onDragOver);
        row.addEventListener('drop', onDrop);
        row.addEventListener('dragend', onDragEnd);
    });

    // Also add header cell for the grip column
    const thead = table.querySelector('thead tr');
    if (thead) {
        const th = document.createElement('th');
        th.style.width = '30px';
        thead.insertBefore(th, thead.firstChild);
    }

    // Also handle active league cards
    const cards = document.querySelectorAll('.active-leagues-grid .league-card');
    cards.forEach(card => {
        const handle = document.createElement('div');
        handle.className = 'drag-handle card-drag-handle';
        handle.innerHTML = '&#10303;';
        handle.title = 'Drag to reorder';
        card.insertBefore(handle, card.firstChild);
        card.draggable = true;

        card.addEventListener('dragstart', onCardDragStart);
        card.addEventListener('dragover', onCardDragOver);
        card.addEventListener('drop', onCardDrop);
        card.addEventListener('dragend', onCardDragEnd);
    });
}

function removeDragHandles() {
    document.querySelectorAll('.drag-handle').forEach(el => el.remove());
    document.querySelectorAll('[draggable="true"]').forEach(el => {
        el.draggable = false;
        el.removeEventListener('dragstart', onDragStart);
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('drop', onDrop);
        el.removeEventListener('dragend', onDragEnd);
        el.removeEventListener('dragstart', onCardDragStart);
        el.removeEventListener('dragover', onCardDragOver);
        el.removeEventListener('drop', onCardDrop);
        el.removeEventListener('dragend', onCardDragEnd);
    });
    // Remove extra th
    const table = document.querySelector('.completed-leagues-table');
    if (table) {
        const thead = table.querySelector('thead tr');
        if (thead && thead.firstChild && thead.firstChild.style && thead.firstChild.style.width === '30px') {
            thead.removeChild(thead.firstChild);
        }
    }
}

/* Table row drag */
function onDragStart(e) {
    _dragSrcRow = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
}

function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = this;
    if (row === _dragSrcRow) return;
    row.classList.add('drag-over');
}

function onDrop(e) {
    e.preventDefault();
    const target = this;
    target.classList.remove('drag-over');
    if (!_dragSrcRow || _dragSrcRow === target) return;

    const tbody = target.parentNode;
    const rows = [...tbody.children];
    const srcIdx = rows.indexOf(_dragSrcRow);
    const tgtIdx = rows.indexOf(target);

    if (srcIdx < tgtIdx) {
        tbody.insertBefore(_dragSrcRow, target.nextSibling);
    } else {
        tbody.insertBefore(_dragSrcRow, target);
    }

    syncDisplayOrderFromDOM();
    markDirty();
}

function onDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragSrcRow = null;
}

/* Active league card drag */
let _dragSrcCard = null;

function onCardDragStart(e) {
    _dragSrcCard = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
}

function onCardDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== _dragSrcCard) this.classList.add('drag-over');
}

function onCardDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    if (!_dragSrcCard || _dragSrcCard === this) return;

    const grid = this.parentNode;
    const cards = [...grid.children];
    const srcIdx = cards.indexOf(_dragSrcCard);
    const tgtIdx = cards.indexOf(this);

    if (srcIdx < tgtIdx) {
        grid.insertBefore(_dragSrcCard, this.nextSibling);
    } else {
        grid.insertBefore(_dragSrcCard, this);
    }

    syncDisplayOrderFromDOM();
    markDirty();
}

function onCardDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragSrcCard = null;
}

/**
 * Read the current DOM order of league cards + table rows and rebuild _editState.displayOrder.
 * Titles in DisplayOrder use " - " (dash), folder IDs use " " (space).
 */
function syncDisplayOrderFromDOM() {
    if (!_editState) return;

    // Map folder-id → display title
    const idToTitle = new Map();
    for (const t of _landingSettings.displayOrder) {
        idToTitle.set(t.replace(' - ', ' '), t);
    }

    const order = [];

    // Active league cards first
    document.querySelectorAll('.active-leagues-grid .league-card').forEach(card => {
        const id = card.dataset.leagueId;
        if (id) order.push(idToTitle.get(id) || id);
    });

    // Completed leagues table rows
    document.querySelectorAll('.completed-leagues-table tbody tr').forEach(row => {
        const id = row.dataset.leagueId;
        if (id) order.push(idToTitle.get(id) || id);
    });

    _editState.displayOrder = order;
}

/* ── Save / Cancel bar ────────────────────────────────── */

function showEditBar() {
    if (document.querySelector('.edit-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.innerHTML = `
        <span class="edit-bar-label">Edit Mode</span>
        <button class="edit-bar-cancel">Cancel</button>
        <button class="edit-bar-save" disabled>Save Changes</button>`;

    bar.querySelector('.edit-bar-cancel').addEventListener('click', exitEditMode);
    bar.querySelector('.edit-bar-save').addEventListener('click', saveEditChanges);
    document.body.appendChild(bar);
}

async function saveEditChanges() {
    if (!_editState || !_editState.dirty) return;

    // Compare against original to detect actual changes
    const orig = _landingSettings;
    const titleChanged = _editState.title !== orig.title;
    const subtitleChanged = _editState.subtitle !== orig.subtitle;
    const logoChanged = !!_editState.logoData;
    const orderChanged = JSON.stringify(_editState.displayOrder) !== JSON.stringify(orig.displayOrder);

    if (!titleChanged && !subtitleChanged && !logoChanged && !orderChanged) {
        exitEditMode();
        return;
    }

    // Build updated landing_settings.json
    const newSettings = {
        title: _editState.title,
        subtitle: _editState.subtitle,
        logoPath: _editState.logoData ? _landingSettings.logoPath : _editState.logoPath,
        DisplayOrder: _editState.displayOrder
    };

    // Build single grouped description summarizing what changed
    const parts = [];
    if (titleChanged) parts.push('title');
    if (subtitleChanged) parts.push('subtitle');
    if (logoChanged) parts.push('logo');
    if (orderChanged) parts.push('order');
    const groupDescription = `Dashboard updated (${parts.join(', ')})`;
    const groupId = 'dashboard-edit-' + Date.now();

    addChange({
        type: 'update',
        path: 'leagues/landing_settings.json',
        content: JSON.stringify(newSettings, null, 2),
        description: groupDescription,
        group: groupId,
        groupDescription
    });

    // Stage logo if changed
    if (_editState.logoData) {
        addChange({
            type: 'update',
            path: _landingSettings.logoPath,
            content: _editState.logoData,
            binary: true,
            description: groupDescription,
            group: groupId,
            groupDescription
        });
    }

    // Update in-memory settings
    _landingSettings = {
        title: newSettings.title,
        subtitle: newSettings.subtitle,
        logoPath: newSettings.logoPath,
        displayOrder: newSettings.DisplayOrder
    };

    // Refresh admin sidebar badge
    refreshSidebarBadge();

    // Stay in edit mode after save — reset dirty state and resync editState to saved values
    _editState.title = _landingSettings.title;
    _editState.subtitle = _landingSettings.subtitle;
    _editState.logoPath = _landingSettings.logoPath;
    _editState.displayOrder = [..._landingSettings.displayOrder];
    _editState.logoData = null;
    _editState.logoFileName = null;
    _editState.dirty = false;

    const saveBtn = document.querySelector('.edit-bar-save');
    if (saveBtn) saveBtn.disabled = true;

    // Brief "Saved ✓" confirmation in the edit bar
    const label = document.querySelector('.edit-bar-label');
    if (label) {
        const orig = label.textContent;
        label.textContent = 'Saved ✓';
        setTimeout(() => { label.textContent = orig; }, 1500);
    }
}

/* ── H4 — Info cards ─────────────────────────────────── */

function renderInfoCards(container, activePlayers, totalPlayers, totalLeagues, lastUpdated) {
    const section = document.createElement('div');
    section.className = 'index-info-cards';

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          + ' ' + lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : 'N/A';

    section.innerHTML = `
        <div class="dash-card">
            <div class="dash-card-label">Active Players</div>
            <div class="dash-card-value">${activePlayers}</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-label">Total Players</div>
            <div class="dash-card-value">${totalPlayers}</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-label">Total Leagues</div>
            <div class="dash-card-value">${totalLeagues}</div>
        </div>
        <div class="dash-card dash-card--flex">
            <div class="dash-card-label">Last Updated</div>
            <div class="dash-card-value">${lastUpdatedStr}</div>
        </div>`;

    container.appendChild(section);
}

/* ── H1 — Active leagues ─────────────────────────────── */

function renderActiveLeagues(container, running) {
    const section = document.createElement('div');
    section.className = 'dash-section';

    let cardsHtml = '';
    for (const l of running) {
        const typeLabel = TYPE_LABELS[l.leagueType] || l.leagueType;
        const typeClass = `type-${l.leagueType}`;

        let leaderHtml = '<span style="color:var(--color-text-muted)">—</span>';
        if (l.leader) {
            const flagCode = getFlagCode(l.leader.player, l.params.CustomFlags);
            const leaderIsHidden = !!_playersMeta[l.leader.player]?.hidden;
            leaderHtml = `${leaderIsHidden ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`} ${playerNameLink(l.leader.player, _playersMeta[l.leader.player])}`;
        }

        cardsHtml += `
            <div class="league-card" data-league-id="${escapeHtml(l.id)}">
                <div class="league-card-title">
                    <a href="${dashboardUrl(l.id)}">${escapeHtml(l.title)}</a>
                </div>
                <div class="league-card-meta">
                    <span class="league-type-pill ${typeClass}">${typeLabel}</span>
                    <span class="status-pill status-running">Running</span>
                </div>
                <div class="league-card-leader">Leader: ${leaderHtml}</div>
            </div>`;
    }

    section.innerHTML = `
        <h2>Active Leagues</h2>
        <div class="active-leagues-wrapper">
            <button class="scroll-arrow scroll-arrow-left" hidden>&lsaquo;</button>
            <div class="active-leagues-grid">${cardsHtml || '<p style="color:var(--color-text-muted)">No active leagues</p>'}</div>
            <button class="scroll-arrow scroll-arrow-right" hidden>&rsaquo;</button>
        </div>`;

    // Attach context menus to leader player links in each card
    for (const l of running) {
        if (l.leader) {
            const card = section.querySelector(`.league-card[data-league-id="${CSS.escape(l.id)}"]`);
            if (card) attachPlayerNameInteractions(card, l.id);
        }
    }

    // Setup horizontal scroll arrows
    setupScrollArrows(section);

    container.appendChild(section);
}

function setupScrollArrows(section) {
    const wrapper = section.querySelector('.active-leagues-wrapper');
    if (!wrapper) return;
    const grid = wrapper.querySelector('.active-leagues-grid');
    const leftBtn = wrapper.querySelector('.scroll-arrow-left');
    const rightBtn = wrapper.querySelector('.scroll-arrow-right');

    function updateArrows() {
        const overflows = grid.scrollWidth > grid.clientWidth + 2;
        leftBtn.hidden = !overflows || grid.scrollLeft <= 0;
        rightBtn.hidden = !overflows || grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 2;
    }

    leftBtn.addEventListener('click', () => {
        grid.scrollBy({ left: -300, behavior: 'smooth' });
    });
    rightBtn.addEventListener('click', () => {
        grid.scrollBy({ left: 300, behavior: 'smooth' });
    });
    grid.addEventListener('scroll', updateArrows);

    // Check after render
    requestAnimationFrame(updateArrows);
    window.addEventListener('resize', updateArrows);
}

/* ── Completed leagues (compact table) ────────────────── */

function renderCompletedLeagues(container, completed) {
    const section = document.createElement('div');
    section.className = 'dash-section';

    // Parse dates and sort chronologically (newest first).
    // Prefer explicit IssueDate from params; fall back to folder-name parsing.
    const withDates = completed.map(l => {
        let year, monthIndex, monthShort, day;
        if (l.params.IssueDate) {
            const d = new Date(l.params.IssueDate);
            year = d.getUTCFullYear();
            monthIndex = d.getUTCMonth();
            monthShort = MONTH_SHORT[monthIndex];
            day = d.getUTCDate();
        } else {
            ({ year, monthIndex, monthShort } = parseLeagueDate(l.id));
            day = 1;
        }
        return { ...l, year, monthIndex, monthShort, day };
    });
    withDates.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.monthIndex !== b.monthIndex) return b.monthIndex - a.monthIndex;
        return b.day - a.day;
    });

    // Determine default open state: open if any league is from current year (2026+)
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = withDates.some(l => l.year >= currentYear);
    const collapsed = hasCurrentYear ? '' : ' collapsed';

    section.innerHTML = `
        <div class="collapsible-section${collapsed}">
            <h2 class="collapsible-header">Completed Leagues</h2>
            <div class="collapsible-body">
                <div class="completed-leagues-mount"></div>
            </div>
        </div>`;

    const mountPoint = section.querySelector('.completed-leagues-mount');
    const rows = withDates.map(l => ({
        league:          l.title,
        dateStr:         l.params.IssueDate ? `${l.day} ${l.monthShort} ${l.year}` : `${l.monthShort} ${l.year}`,
        leagueType:      l.leagueType,
        leagueId:        l.id,
        leaderName:      l.leader?.player ?? null,
        leaderHidden:    !!_playersMeta[l.leader?.player]?.hidden,
        leaderFlagCode:  l.leader ? getFlagCode(l.leader.player, l.params.CustomFlags) : null,
        leaderMeta:      l.leader ? _playersMeta[l.leader.player] : null,
    }));
    const preset = buildCompletedLeaguesPreset({ rows, flagUrl, dashboardUrl });
    const { table } = mountMFTable(mountPoint, preset);
    // Preserve legacy class so existing CSS (.completed-leagues-table) continues to apply.
    table.classList.add('completed-leagues-table');

    // Attach collapsible toggle
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    // Wire context menu on each winner link, mapping row index → leagueId.
    const dataRows = mountPoint.querySelectorAll('tbody tr:not(.avg-row)');
    dataRows.forEach((tr, i) => {
        const leagueId = rows[i]?.leagueId;
        if (leagueId) attachPlayerNameInteractions(tr, leagueId);
    });

    container.appendChild(section);
}

/* ── H2 — Annual leaderboards ─────────────────────────── */

/**
 * Group leagues by (year, leagueType) and aggregate per-player stats.
 */
function buildAllLeaderboards(leagues) {
    // Parse dates and group
    const groups = new Map(); // key: "year|type" → { year, leagueType, config, entries }
    for (const l of leagues) {
        const { year, monthIndex, monthShort } = parseLeagueDate(l.id);
        if (isNaN(year) || monthIndex < 0) continue;

        const key = `${year}|${l.leagueType}`;
        if (!groups.has(key)) {
            groups.set(key, {
                year,
                leagueType: l.leagueType,
                config: l.config,
                entries: []
            });
        }
        groups.get(key).entries.push({
            monthIndex,
            monthShort,
            statsMap: l.statsMap,
            params: l.params
        });
    }

    // Build leaderboard per group
    const leaderboards = [];
    for (const [, group] of groups) {
        leaderboards.push(buildAnnualLeaderboard(group));
    }

    // Sort: newest year first, then by type (doubling first)
    const typeOrder = { doubling: 0, regular: 1, ubc: 2 };
    leaderboards.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return (typeOrder[a.leagueType] || 9) - (typeOrder[b.leagueType] || 9);
    });

    return leaderboards;
}

function buildAnnualLeaderboard(group) {
    const { year, leagueType, config, entries } = group;
    const isUBC = leagueType === 'ubc';

    // Sort entries by month
    entries.sort((a, b) => a.monthIndex - b.monthIndex);
    const months = entries.map(e => e.monthShort);

    // Aggregate per player
    const playerData = new Map(); // name → { monthly, totalWins/totalPoints, totalGames, prSum, prCount, customFlags }
    for (const entry of entries) {
        for (const [player, stats] of entry.statsMap) {
            if (!playerData.has(player)) {
                playerData.set(player, {
                    monthly: {},
                    totalWins: 0,
                    totalPoints: 0,
                    totalGames: 0,
                    prSum: 0,
                    prCount: 0,
                    customFlags: {}
                });
            }
            const pd = playerData.get(player);

            if (stats.games > 0) {
                const val = isUBC ? stats.points : stats.wins;
                pd.monthly[entry.monthShort] = (pd.monthly[entry.monthShort] || 0) + val;
                pd.totalWins += stats.wins;
                pd.totalPoints += stats.points || 0;
                pd.totalGames += stats.games;
                if (stats.meanPR !== null) {
                    pd.prSum += stats.meanPR * stats.games;
                    pd.prCount += stats.games;
                }
            }

            // Capture custom flags
            if (entry.params.CustomFlags) {
                Object.assign(pd.customFlags, entry.params.CustomFlags);
            }
        }
    }

    // Build rows
    const rows = [];
    for (const [player, pd] of playerData) {
        if (pd.totalGames === 0) continue;
        const total = isUBC ? pd.totalPoints : pd.totalWins;
        const winRate = pd.totalGames > 0 ? pd.totalWins / pd.totalGames : 0;
        const meanPR = pd.prCount > 0 ? pd.prSum / pd.prCount : null;
        const avgPoints = pd.totalGames > 0 ? pd.totalPoints / pd.totalGames : 0;
        const flagCode = getFlagCode(player, pd.customFlags);

        rows.push({
            player,
            flagCode,
            monthly: pd.monthly,
            total,
            totalGames: pd.totalGames,
            winRate,
            meanPR,
            avgPoints
        });
    }

    // Sort
    if (isUBC) {
        rows.sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (a.meanPR !== null && b.meanPR !== null && a.meanPR !== b.meanPR)
                return a.meanPR - b.meanPR;
            return 0;
        });
    } else {
        rows.sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            if (a.meanPR !== null && b.meanPR !== null && a.meanPR !== b.meanPR)
                return a.meanPR - b.meanPR;
            return 0;
        });
    }

    // Assign ranks
    rows.forEach((r, i) => { r.rank = i + 1; });

    const typeName = TYPE_LABELS[leagueType] || leagueType;
    return { year, leagueType, typeName, months, rows, isUBC };
}

function renderLeaderboards(container, leaderboards) {
    const currentYear = new Date().getFullYear();

    for (const lb of leaderboards) {
        const section = document.createElement('div');
        section.className = 'leaderboard-section';

        const collapsed = lb.year >= currentYear ? '' : ' collapsed';

        // Filter out hidden players up-front (live behaviour: skip entirely)
        const visibleRows = lb.rows
            .filter(row => !_playersMeta[row.player]?.hidden)
            .map(row => ({ ...row, meta: _playersMeta[row.player] }));

        const title = `${lb.year} ${lb.typeName} Leaderboard`;

        const defaultRows = Math.min(10, lb.rows.length);
        const maxAllowed = Math.min(25, lb.rows.length);
        section.innerHTML = `
            <div class="collapsible-section${collapsed}">
                <div class="leaderboard-header-row">
                    <h2 class="collapsible-header">${title}</h2>
                    <div class="img-export-group">
                        <label class="img-export-label">Top
                            <input class="img-export-rows" type="number"
                                   min="1" max="${maxAllowed}" value="${defaultRows}">
                        </label>
                        <button class="img-export-btn">Export Image</button>
                    </div>
                </div>
                <div class="collapsible-body">
                    <div class="leaderboard-mount"></div>
                </div>
            </div>`;

        const mountPoint = section.querySelector('.leaderboard-mount');
        const preset = buildAnnualLeaderboardPreset({
            rows:    visibleRows,
            months:  lb.months,
            isUBC:   lb.isUBC,
            flagUrl,
        });
        const { table } = mountMFTable(mountPoint, preset);
        // Preserve legacy class so existing .leaderboard-table CSS still applies.
        table.classList.add('leaderboard-table');

        // Collapsible toggle
        const header = section.querySelector('.collapsible-header');
        header.addEventListener('click', () => {
            header.closest('.collapsible-section').classList.toggle('collapsed');
        });

        // Image export
        const exportBtn = section.querySelector('.img-export-btn');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentInput = exportBtn.closest('.leaderboard-section').querySelector('.img-export-rows');
            let maxRows = parseInt(currentInput.value, 10);
            if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;
            const cap = Math.min(25, lb.rows.length);
            if (maxRows > cap) maxRows = cap;
            const sourceTable = section.querySelector('.leaderboard-mount table');
            exportLeaderboardImage(sourceTable, title, maxRows);
        });
        // Don't toggle collapsible when interacting with the export controls.
        section.querySelector('.img-export-group').addEventListener('click', e => e.stopPropagation());

        // Wire context menu on each player name link (sortable table — re-attach after sort).
        attachPlayerNameInteractions(mountPoint);
        const tbody = table.querySelector('tbody');
        new MutationObserver(() => attachPlayerNameInteractions(mountPoint))
            .observe(tbody, { childList: true });

        container.appendChild(section);
    }
}

/* Measure the rank column's rendered width and publish it as
   `--sticky-col-1-width` on the wrapper, so the player column's
   `left:` can lock to it without any hard-coded px (iron rule 12). */
function measureLeaderboardStickyCols(wrapper) {
    const table = wrapper.querySelector('.leaderboard-table');
    if (!table) return;
    const write = () => {
        const firstTh = table.querySelector('thead th:first-child');
        if (!firstTh) return;
        const w = firstTh.getBoundingClientRect().width;
        wrapper.style.setProperty('--sticky-col-1-width', `${w}px`);
    };
    write();
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(write);
        ro.observe(table);
    }
    window.addEventListener('resize', write);
}

// Thin wrapper around the shared exportTableImage() helper. A2 is the
// only caller that uses the maxRows option (the "Top N" numeric input).
function exportLeaderboardImage(sourceTable, title, maxRows) {
    return exportTableImage({
        sourceTable,
        filename: `${title}_Top${maxRows}`,
        title,
        maxRows,
    });
}

/* ── Show-top-N helper (hides rows beyond N, adds toggle button) ── */

function applyShowTopN(tableEl, defaultN = 5) {
    const tbody = tableEl.querySelector('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= defaultN) return;

    rows.forEach((row, i) => {
        if (i >= defaultN) row.classList.add('table-row-hidden');
    });

    const wrapper = tableEl.closest('.achv-table-wrapper') || tableEl.closest('.leaderboard-table-wrapper') || tableEl.closest('.completed-table-wrapper');
    const savedMaxH = wrapper ? getComputedStyle(wrapper).maxHeight : '';

    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `Show all (${rows.length})`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = rows[defaultN].classList.contains('table-row-hidden');
        rows.forEach((row, i) => {
            if (i >= defaultN) row.classList.toggle('table-row-hidden', !isCollapsed);
        });
        btn.textContent = isCollapsed ? `Show top ${defaultN}` : `Show all (${rows.length})`;
        if (wrapper) wrapper.style.maxHeight = isCollapsed ? 'none' : '';
    });

    if (wrapper) wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
}

/* ── Achievements (all-time per league type) ─────────── */

const TYPE_ORDER = ['doubling', 'regular', 'ubc'];
// Gold/Silver/Bronze are no longer separate cards — they're merged into the
// single MEDALS table (mountMedalsTable). The remaining metrics stay as their
// own SF cards.
const ACHIEVEMENT_METRICS = [
    { key: 'avgRank',   label: 'Avg Rank',     fmt: v => formatNumber(v) },
    { key: 'winRate',   label: 'Avg Win%',     fmt: v => formatPercent(v) },
    { key: 'prWinRate', label: 'Avg PR Win',   fmt: v => formatPercent(v) }
];

function sortPresentTypes(types) {
    return [...types].sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a);
        const bi = TYPE_ORDER.indexOf(b);
        return (ai < 0 ? 9 : ai) - (bi < 0 ? 9 : bi);
    });
}

function renderAchievementsSection(container, presentTypes) {
    const types = sortPresentTypes(presentTypes);
    if (types.length === 0) return;

    const section = document.createElement('div');
    section.className = 'dash-section achievements-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">Achievements</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    // Collapsible toggle
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    // Tab switching
    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
        });
    });

    container.appendChild(section);

    // Populate panels lazily — fire all in parallel.
    types.forEach(async (t) => {
        const panel = section.querySelector(`.achv-panel[data-type="${t}"]`);
        try {
            const data = await buildAllTimeRankings(t);
            panel.innerHTML = renderAchievementTables(data, t);
            panel.querySelectorAll('.achv-table').forEach(tbl => applyShowTopN(tbl));
            wireLuckInfoPopup(panel, t);

            // Prepend the merged Medals table (SF, 2 sticky cols). Mounted after
            // the old applyShowTopN loop so it isn't double-processed — mountSFTable
            // wires its own show-top-N.
            const grid = panel.querySelector('.achv-tables-grid');
            if (grid) {
                const tmp = document.createElement('div');
                mountMedalsTable(tmp, data);
                const card = tmp.firstElementChild;
                if (card) grid.insertBefore(card, grid.firstChild);
            }
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function wireLuckInfoPopup(panel, leagueType) {
    const btn   = panel.querySelector(`#luck-info-btn-${leagueType}`);
    const popup = panel.querySelector(`#luck-info-popup-${leagueType}`);
    const close = panel.querySelector(`#luck-info-close-${leagueType}`);
    if (!btn || !popup) return;
    btn.addEventListener('click', e => {
        e.stopPropagation();
        popup.hidden = !popup.hidden;
    });
    if (close) {
        close.addEventListener('click', () => { popup.hidden = true; });
    }
}

/* ── Merged MEDALS table (SF format, 2 sticky cols, no sorting) ──────
   Replaces the three standalone Gold/Silver/Bronze cards. Fixed semantic
   order: gold DESC → silver DESC → bronze DESC (Olympic medal-table order).
   Only players who won at least one medal are listed. */

function buildMedalRows(data) {
    return data.players
        .filter(p => p.participations > 0
                  && (p.gold + p.silver + p.bronze) > 0
                  && !_playersMeta[p.name]?.hidden)
        .sort((a, b) =>
            (b.gold   - a.gold)   ||
            (b.silver - a.silver) ||
            (b.bronze - a.bronze))
        .map((p, i) => ({
            rank:   i + 1,
            name:   p.name,
            gold:   p.gold,
            silver: p.silver,
            bronze: p.bronze
        }));
}

function mountMedalsTable(mount, data) {
    const cols = [
        { key: 'rank', label: '#' },
        {
            key: 'name',
            label: 'Player',
            format: (_v, row) =>
                `<img class="flag" src="${flagUrl(getFlagCode(row.name, data.customFlags))}" alt="flag"> ` +
                `${playerNameLink(row.name, _playersMeta[row.name])}`
        },
        { key: 'gold',   label: '🥇' },
        { key: 'silver', label: '🥈' },
        { key: 'bronze', label: '🥉' }
    ];

    const { card, table } = mountSFTable(mount, {
        tableId:    'A3',
        title:      'Medals 🏅',
        data:       buildMedalRows(data),
        cols,
        fontClass:  'font-small',
        stickyCols: 2,
        showTopN:   5
    });
    card.classList.add('achv-medals-card');
    table.classList.add('sf-sticky-2');
}

function renderAchievementTables(data, leagueType) {
    const coreCards = ACHIEVEMENT_METRICS
        .filter(m => data.rankings[m.key] != null)
        .map(m => {
        const rows = (data.rankings[m.key] || []).filter(r => !_playersMeta[r.name]?.hidden);
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td><img class="flag" src="${flagUrl(getFlagCode(r.name, data.customFlags))}" alt="flag"> ${playerNameLink(r.name, _playersMeta[r.name])}</td>
                <td>${m.fmt(r.value)}</td>
            </tr>
        `).join('');
        const heading = m.medal ? `${m.medal} ${m.label}` : m.label;
        return `
            <div class="achv-table-card">
                <h3>${heading}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table font-small" data-mf-table-id="A3">
                        <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">${m.label}</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="3">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('');

    const luckCard = data.rankings.luckPercentile
        ? renderLuckPercentileCard(data, leagueType)
        : '';

    return `<div class="achv-tables-grid type-${leagueType}">${coreCards}${luckCard}</div>`;
}

function renderLuckPercentileCard(data, leagueType) {
    const rows = (data.rankings.luckPercentile || []).filter(r => !_playersMeta[r.name]?.hidden);
    const rowsHtml = rows.map(r => {
        const cls = r.unstableSample ? 'unstable-sample' : '';
        const color = colorForValue(r.value, 0, 100);
        return `
            <tr class="${cls}">
                <td>${r.rank}</td>
                <td><img class="flag" src="${flagUrl(getFlagCode(r.name, data.customFlags))}" alt="flag"> ${playerNameLink(r.name, _playersMeta[r.name])}</td>
                <td>${r.games}</td>
                <td style="color:${color};font-weight:600;">${r.value}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="achv-table-card achv-luck-card">
            <h3>Luck Percentile <span class="predictor-tooltip" id="luck-info-btn-${leagueType}">?</span></h3>
            <div class="predictor-info-popup luck-info-popup" id="luck-info-popup-${leagueType}" hidden>
                <button class="predictor-info-close" id="luck-info-close-${leagueType}">&times;</button>
                <h3>How It Works</h3>
                <p>For each historical match we look up the a-priori win probability <i>p<sub>i</sub></i> from the PR difference and match length, then compare <b>actual wins</b> to <b>expected wins</b>. The result is standardized into a Z-score and mapped to a percentile via the standard normal distribution.</p>
                <ul>
                    <li><b>EW</b> (expected wins) = Σ p<sub>i</sub></li>
                    <li><b>Var</b> = Σ p<sub>i</sub>(1 − p<sub>i</sub>)</li>
                    <li><b>Z</b> = (AW − EW) / √Var</li>
                    <li><b>Percentile</b> = Φ(Z) × 100</li>
                </ul>
                <p>50 ≈ expected, 100 = extremely lucky, 0 = extremely unlucky. Players with fewer than 15 rated games are shown struck-through — the sample is too small to be reliable.</p>
                ${luckBellCurveSvg()}
            </div>
            <div class="achv-table-wrapper">
                <table class="achv-table achv-luck-table font-small" data-mf-table-id="A3">
                    <thead>
                        <tr>
                            <th scope="col">#</th>
                            <th scope="col">Player</th>
                            <th scope="col">Games</th>
                            <th scope="col">Luck %ile</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml || '<tr><td colspan="4">No data</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
}

/* ── PR Leaders (Total PR + Last 300 PR) ───────────── */

const PR_METRICS = [
    { key: 'totalPR',   label: 'Total PR' },
    { key: 'last300PR', label: 'Last 300 PR' }
];

function renderPRLeadersSection(container, presentTypes) {
    // Only league types with PR (doubling, ubc).
    const types = sortPresentTypes(presentTypes).filter(t => t === 'doubling' || t === 'ubc');
    if (types.length === 0) return;

    const section = document.createElement('div');
    section.className = 'dash-section pr-leaders-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">PR Leaders</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
        });
    });

    container.appendChild(section);

    types.forEach(async (t) => {
        const panel = section.querySelector(`.achv-panel[data-type="${t}"]`);
        try {
            const data = await buildAllTimeRankings(t);
            panel.innerHTML = renderPRTables(data);
            panel.querySelectorAll('.achv-table').forEach(t => applyShowTopN(t));
            panel.querySelectorAll('.pr-leaders-table').forEach(tbl => {
                const wrap = tbl.closest('.achv-table-wrapper');
                if (wrap) attachStickyShadow(wrap);
            });
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderPRTables(data) {
    return `<div class="achv-tables-grid pr-leaders-grid">${PR_METRICS.map(m => {
        const rows = (data.rankings[m.key] || []).filter(r => !_playersMeta[r.name]?.hidden);
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td><img class="flag" src="${flagUrl(getFlagCode(r.name, data.customFlags))}" alt="flag"> ${playerNameLink(r.name, _playersMeta[r.name])}</td>
                <td>${formatNumber(r.value)}</td>
                <td>${getLevel(r.value)}</td>
            </tr>
        `).join('');
        return `
            <div class="achv-table-card">
                <h3>${m.label}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table pr-leaders-table font-small" data-mf-table-id="A4">
                        <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">PR</th><th scope="col">Level</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="4">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('')}</div>`;
}

/* ── Match Records (per-match highlights) ───────────── */

function renderMatchRecordsSection(container, allLeagues, presentTypes) {
    const types = sortPresentTypes(presentTypes).filter(t => t === 'doubling' || t === 'ubc');
    if (types.length === 0) return;

    const leaguesByType = {};
    for (const t of types) {
        leaguesByType[t] = allLeagues.filter(l => l.leagueType === t);
    }

    const section = document.createElement('div');
    section.className = 'dash-section match-records-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => {
        const luck = topLuckiestMatches(collectLuckMatches(leaguesByType[t]));
        const pr   = topBestPRMatches(collectPRMatches(leaguesByType[t]));
        return `
            <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
                ${renderMatchRecordsTables(luck, pr)}
            </div>`;
    }).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">Match Records</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
            requestAnimationFrame(() => applyMatchRecordsStickyOffsets(section));
        });
    });

    container.appendChild(section);

    section.querySelectorAll('.achv-table').forEach(t => applyShowTopN(t));
    section.querySelectorAll('.match-records-table').forEach(tbl => {
        const wrap = tbl.closest('.achv-table-wrapper');
        if (wrap) attachStickyShadow(wrap);
    });

    requestAnimationFrame(() => applyMatchRecordsStickyOffsets(section));

    let _mrRafId;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(_mrRafId);
        _mrRafId = requestAnimationFrame(() => applyMatchRecordsStickyOffsets(section));
    });
}

function applyMatchRecordsStickyOffsets(root) {
    root.querySelectorAll('.match-records-table').forEach(table => {
        const th1 = table.querySelector('thead th:nth-child(1)');
        const th2 = table.querySelector('thead th:nth-child(2)');
        if (!th1 || !th2) return;
        const w1 = th1.getBoundingClientRect().width;
        const w2 = th2.getBoundingClientRect().width;
        if (w1 > 0) table.style.setProperty('--mr-col1-w', w1 + 'px');
        if (w2 > 0) table.style.setProperty('--mr-col2-w', w2 + 'px');
    });
}

function renderMatchRecordsTables(luckRows, prRows) {
    const notHidden = r => !_playersMeta[r.player]?.hidden && !_playersMeta[r.opponent]?.hidden;
    const luckHtml = luckRows.filter(notHidden).map((r, i) => matchRecordRow(i + 1, r, formatNumber(r.luckGap))).join('');
    const prHtml   = prRows.filter(notHidden).map((r, i)   => matchRecordRow(i + 1, r, formatNumber(r.pr))).join('');
    return `
        <div class="match-records-stack">
            <div class="achv-table-card">
                <h3>Best PR Matches</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table match-records-table font-small" data-mf-table-id="A5">
                        <thead><tr>
                            <th scope="col">#</th><th scope="col">Player</th><th scope="col">PR</th><th scope="col">Opponent</th>
                            <th scope="col">Score</th><th scope="col">Result</th><th scope="col">League</th><th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${prHtml || '<tr><td colspan="8">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="achv-table-card">
                <h3>Luckiest Matches</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table match-records-table font-small" data-mf-table-id="A5">
                        <thead><tr>
                            <th scope="col">#</th><th scope="col">Player</th><th scope="col">Luck Gap</th><th scope="col">Opponent</th>
                            <th scope="col">Score</th><th scope="col">Result</th><th scope="col">League</th><th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${luckHtml || '<tr><td colspan="8">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

function matchRecordRow(rank, r, metricCell) {
    const playerFlag   = flagUrl(getFlagCode(r.player, r.customFlags));
    const opponentFlag = flagUrl(getFlagCode(r.opponent, r.customFlags));
    const resultClass = r.result === 'W' ? 'result-win'
                      : r.result === 'L' ? 'result-loss'
                      : 'result-draw';
    return `
        <tr>
            <td>${rank}</td>
            <td><img class="flag" src="${playerFlag}" alt="flag"> ${playerNameLink(r.player, _playersMeta[r.player])}</td>
            <td>${metricCell}</td>
            <td><img class="flag" src="${opponentFlag}" alt="flag"> ${playerNameLink(r.opponent, _playersMeta[r.opponent])}</td>
            <td>${r.scoreSelf}-${r.scoreOpp}</td>
            <td><span class="${resultClass}">${r.result}</span></td>
            <td><a class="league-link" href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}

function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MONTH_SHORT[d.getUTCMonth()];
    const yr  = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
}

/* ── League Records (A6): top 100 appearances by Mean PR ───── */

function collectLeagueRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        const goldCount   = league.params.GoldCount   ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const customFlags = league.params.CustomFlags || {};

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            const stats = league.statsMap.get(r.player);
            if (!stats || stats.meanPR == null) return;
            if (_playersMeta[r.player]?.hidden) return;
            rows.push({
                player: r.player,
                meanPR: stats.meanPR,
                level: getLevel(stats.meanPR),
                playerRank: idx + 1,
                totalPlayers,
                goldCount,
                silverCount,
                bronzeCount,
                leagueId: league.id,
                leagueTitle: league.title,
                date: league.params.IssueDate || '',
                customFlags
            });
        });
    }
    rows.sort((a, b) => a.meanPR - b.meanPR);
    return rows.slice(0, 100);
}

function collectLeagueWinRateRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        const goldCount   = league.params.GoldCount   ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const customFlags = league.params.CustomFlags || {};

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            const stats = league.statsMap.get(r.player);
            if (!stats || stats.winRate == null) return;
            if (_playersMeta[r.player]?.hidden) return;
            rows.push({
                player: r.player,
                winRate: stats.winRate,
                playerRank: idx + 1,
                totalPlayers,
                goldCount,
                silverCount,
                bronzeCount,
                leagueId: league.id,
                leagueTitle: league.title,
                date: league.params.IssueDate || '',
                customFlags
            });
        });
    }
    rows.sort((a, b) => b.winRate - a.winRate);
    return rows.slice(0, 100);
}

function renderLeagueRecordsSection(container, allLeagues, presentTypes) {
    const types = sortPresentTypes(presentTypes).filter(t => t === 'doubling' || t === 'ubc');
    if (types.length === 0) return;

    const leaguesByType = {};
    for (const t of types) {
        leaguesByType[t] = allLeagues.filter(l => l.leagueType === t);
    }

    const hasData = types.some(t =>
        leaguesByType[t].some(l => l.params.Running !== true)
    );
    if (!hasData) return;

    const section = document.createElement('div');
    section.className = 'dash-section league-records-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => {
        const winRateRows  = collectLeagueWinRateRecords(leaguesByType[t]);
        const prRows       = collectLeagueRecords(leaguesByType[t]);
        const luckRows     = collectLeagueLuckRecords(leaguesByType[t]);
        const worstRows    = collectLeagueWorstLuckRecords(leaguesByType[t]);
        return `
            <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
                ${renderLeagueRecordsPanel(winRateRows, prRows, luckRows, worstRows)}
            </div>`;
    }).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">League Records</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
            requestAnimationFrame(() => applyLeagueRecordsStickyOffsets(section));
        });
    });

    container.appendChild(section);

    section.querySelectorAll('.achv-table').forEach(t => applyShowTopN(t));
    section.querySelectorAll('.league-records-table').forEach(tbl => {
        const wrap = tbl.closest('.achv-table-wrapper');
        if (wrap) attachStickyShadow(wrap);
    });

    requestAnimationFrame(() => applyLeagueRecordsStickyOffsets(section));

    let _lrRafId;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(_lrRafId);
        _lrRafId = requestAnimationFrame(() => applyLeagueRecordsStickyOffsets(section));
    });
}

function applyLeagueRecordsStickyOffsets(root) {
    root.querySelectorAll('.league-records-table').forEach(table => {
        const th1 = table.querySelector('thead th:nth-child(1)');
        const th2 = table.querySelector('thead th:nth-child(2)');
        if (!th1 || !th2) return;
        const w1 = th1.getBoundingClientRect().width;
        const w2 = th2.getBoundingClientRect().width;
        if (w1 > 0) table.style.setProperty('--lr-col1-w', w1 + 'px');
        if (w2 > 0) table.style.setProperty('--lr-col2-w', w2 + 'px');
    });
}

function collectLeagueLuckRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        const goldCount   = league.params.GoldCount   ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const customFlags = league.params.CustomFlags || {};
        const matchLength = league.params.MatchLength ?? 7;

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            if (_playersMeta[r.player]?.hidden) return;
            const matchRefs = league.matches
                .filter(m => m.playerA === r.player || m.playerB === r.player)
                .map(m => ({ m, matchLength }));
            const lp = luckPercentileStats({ matchRefs, playerName: r.player });
            if (lp.percentile == null) return;
            rows.push({
                player: r.player,
                percentile: lp.percentile,
                unstable: lp.unstableSample,
                playerRank: idx + 1,
                totalPlayers,
                goldCount,
                silverCount,
                bronzeCount,
                leagueId: league.id,
                leagueTitle: league.title,
                date: league.params.IssueDate || '',
                customFlags
            });
        });
    }
    rows.sort((a, b) => b.percentile - a.percentile);
    return rows.slice(0, 100);
}

function collectLeagueWorstLuckRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        const goldCount   = league.params.GoldCount   ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const customFlags = league.params.CustomFlags || {};
        const matchLength = league.params.MatchLength ?? 7;

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            if (_playersMeta[r.player]?.hidden) return;
            const matchRefs = league.matches
                .filter(m => m.playerA === r.player || m.playerB === r.player)
                .map(m => ({ m, matchLength }));
            const lp = luckPercentileStats({ matchRefs, playerName: r.player });
            if (lp.percentile == null) return;
            rows.push({
                player: r.player,
                percentile: lp.percentile,
                unstable: lp.unstableSample,
                playerRank: idx + 1,
                totalPlayers,
                goldCount,
                silverCount,
                bronzeCount,
                leagueId: league.id,
                leagueTitle: league.title,
                date: league.params.IssueDate || '',
                customFlags
            });
        });
    }
    rows.sort((a, b) => a.percentile - b.percentile); // lowest first = unluckiest
    return rows.slice(0, 100);
}

function renderLeagueRecordsPanel(winRateRows, prRows, luckRows, worstRows) {
    const winRateHtml = winRateRows.map((r, i) => leagueWinRateRecordRow(i + 1, r)).join('');
    const prHtml    = prRows.map((r, i)    => leaguePRRecordRow(i + 1, r)).join('');
    const luckHtml  = luckRows.map((r, i)  => leagueLuckRecordRow(i + 1, r)).join('');
    const worstHtml = worstRows.map((r, i) => leagueLuckRecordRow(i + 1, r)).join('');
    return `
        <div class="match-records-stack">
            <div class="achv-table-card">
                <h3>Best Win Rate Appearances</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table league-records-table font-small" data-mf-table-id="A6">
                        <thead><tr>
                            <th scope="col">#</th>
                            <th scope="col">Player</th>
                            <th scope="col">Win%</th>
                            <th scope="col">Rank</th>
                            <th scope="col">League</th>
                            <th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${winRateHtml || '<tr><td colspan="6">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="achv-table-card">
                <h3>Best PR Appearances</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table league-records-table font-small" data-mf-table-id="A6">
                        <thead><tr>
                            <th scope="col">#</th>
                            <th scope="col">Player</th>
                            <th scope="col">PR</th>
                            <th scope="col">Level</th>
                            <th scope="col">Rank</th>
                            <th scope="col">League</th>
                            <th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${prHtml || '<tr><td colspan="7">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="achv-table-card">
                <h3>Best Luck Appearances</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table league-records-table font-small" data-mf-table-id="A6">
                        <thead><tr>
                            <th scope="col">#</th>
                            <th scope="col">Player</th>
                            <th scope="col">Luck %ile</th>
                            <th scope="col">Rank</th>
                            <th scope="col">League</th>
                            <th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${luckHtml || '<tr><td colspan="6">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="achv-table-card">
                <h3>Worst Luck Appearances</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table league-records-table font-small" data-mf-table-id="A6">
                        <thead><tr>
                            <th scope="col">#</th>
                            <th scope="col">Player</th>
                            <th scope="col">Luck %ile</th>
                            <th scope="col">Rank</th>
                            <th scope="col">League</th>
                            <th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${worstHtml || '<tr><td colspan="6">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

function leagueRankCell(r) {
    const cls = r.playerRank <= r.goldCount                                 ? 'lr-rank-gold'
              : r.playerRank <= r.goldCount + r.silverCount                 ? 'lr-rank-silver'
              : r.playerRank <= r.goldCount + r.silverCount + r.bronzeCount ? 'lr-rank-bronze'
              : '';
    return `<td class="${cls}">${r.playerRank} / ${r.totalPlayers}</td>`;
}

function leaguePRRecordRow(rowRank, r) {
    const playerFlag = flagUrl(getFlagCode(r.player, r.customFlags));
    return `
        <tr>
            <td>${rowRank}</td>
            <td><img class="flag" src="${playerFlag}" alt="flag"> ${playerNameLink(r.player, _playersMeta[r.player])}</td>
            <td>${formatNumber(r.meanPR)}</td>
            <td>${escapeHtml(r.level)}</td>
            ${leagueRankCell(r)}
            <td><a class="league-link" href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}

function leagueWinRateRecordRow(rowRank, r) {
    const playerFlag = flagUrl(getFlagCode(r.player, r.customFlags));
    const color = colorForValue(r.winRate, 0, 1);
    return `
        <tr>
            <td>${rowRank}</td>
            <td><img class="flag" src="${playerFlag}" alt="flag"> ${playerNameLink(r.player, _playersMeta[r.player])}</td>
            <td style="color:${color};font-weight:600;">${formatPercent(r.winRate)}</td>
            ${leagueRankCell(r)}
            <td><a class="league-link" href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}

function leagueLuckRecordRow(rowRank, r) {
    const playerFlag = flagUrl(getFlagCode(r.player, r.customFlags));
    const color = colorForValue(r.percentile, 0, 100);
    const unstableCls = r.unstable ? 'unstable-sample' : '';
    return `
        <tr class="${unstableCls}">
            <td>${rowRank}</td>
            <td><img class="flag" src="${playerFlag}" alt="flag"> ${playerNameLink(r.player, _playersMeta[r.player])}</td>
            <td style="color:${color};font-weight:600;">${r.percentile}</td>
            ${leagueRankCell(r)}
            <td><a class="league-link" href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}
