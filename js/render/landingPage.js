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
import { loadLandingSettings } from '../data/leagueLoader.js';
import { dashboardUrl, flagUrl, getFlagCode, formatPercent, formatNumber } from '../utils/helpers.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { isLoggedIn } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';
import { addChange, getChangeCount } from '../admin/stagingStore.js';
import { mountAdminSidebar, unmountAdminSidebar, refreshBadge as refreshSidebarBadge } from '../admin/render/adminSidebar.js';

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

/**
 * Extract year and month from a league folder id.
 * "Shabi Israel April 2026" → { year: 2026, monthIndex: 3, monthShort: "Apr" }
 */
function parseLeagueDate(folderId) {
    const parts = folderId.split(' ');
    const year = parseInt(parts[parts.length - 1], 10);
    const monthName = parts[parts.length - 2];
    const monthIndex = MONTHS.indexOf(monthName);
    return { year, monthIndex, monthShort: MONTH_SHORT[monthIndex] || monthName };
}

/* ── Main entry ──────────────────────────────────────── */

/** Landing settings loaded once, shared with edit mode. */
let _landingSettings = null;

export async function renderLandingPage() {
    const container = document.getElementById('content');
    container.innerHTML = '<div class="loading">Loading leagues...</div>';

    try {
        // Load landing settings and populate header
        _landingSettings = await loadLandingSettings();
        populateHeader(_landingSettings);

        const allLeagues = await loadAllLeagues();

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

        renderInfoCards(container, activePlayers.size, allPlayers.size, leagues.length, latestModified);
        renderActiveLeagues(container, running);
        if (completed.length > 0) renderCompletedLeagues(container, completed);
        renderLeaderboards(container, leaderboards);

        // Discover league types present in the dataset for Achievements + PR Leaders.
        const presentTypes = [...new Set(leagues.map(l => l.leagueType))];
        renderAchievementsSection(container, presentTypes);
        renderPRLeadersSection(container, presentTypes);

        // Auto-enter edit mode if admin and ?edit=1 in URL
        if (adminLoggedIn && new URLSearchParams(location.search).get('edit') === '1') {
            enterEditMode(_landingSettings);
        }
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load leagues: ${err.message}</div>`;
    }
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
    // links (which live outside .page-container) should remain functional.
    const pc = document.querySelector('.page-container');
    const guard = (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        if (!pc.contains(a)) return;
        e.preventDefault();
        e.stopPropagation();
    };
    pc.addEventListener('click', guard, true);
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

    unmountAdminSidebar();

    // Restore search hidden during edit mode
    document.querySelectorAll('.nav-search, .nav-search-wrapper').forEach(el => el.style.display = '');

    if (_editState && _editState._clickGuard) {
        const pc = document.querySelector('.page-container');
        if (pc) pc.removeEventListener('click', _editState._clickGuard, true);
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

    // Also keep leagues_order.json in sync for backwards compatibility
    addChange({
        type: 'update',
        path: 'leagues/leagues_order.json',
        content: JSON.stringify({ DisplayOrder: _editState.displayOrder }, null, 2),
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
        <div class="dash-card">
            <div class="dash-card-label">Last Updated</div>
            <div class="dash-card-value" style="font-size:1.1rem">${lastUpdatedStr}</div>
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
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(l.leader.player)}`;
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

    let rowsHtml = '';
    for (const l of withDates) {
        const dateStr = l.params.IssueDate
            ? `${l.day} ${l.monthShort} ${l.year}`
            : `${l.monthShort} ${l.year}`;
        let leaderHtml = '—';
        if (l.leader) {
            const flagCode = getFlagCode(l.leader.player, l.params.CustomFlags);
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(l.leader.player)}`;
        }
        const typeLabel = TYPE_LABELS[l.leagueType] || l.leagueType;
        const typeCell = `<span class="league-type-pill type-${l.leagueType}">${typeLabel}</span>`;
        rowsHtml += `
            <tr class="row-type-${l.leagueType}" data-league-id="${escapeHtml(l.id)}">
                <td>${dateStr}</td>
                <td><a href="${dashboardUrl(l.id)}">${escapeHtml(l.title)}</a></td>
                <td>${typeCell}</td>
                <td>${leaderHtml}</td>
            </tr>`;
    }

    section.innerHTML = `
        <div class="collapsible-section${collapsed}">
            <h2 class="collapsible-header">Completed Leagues</h2>
            <div class="collapsible-body">
                <div class="completed-table-wrapper">
                    <table class="completed-leagues-table">
                        <thead><tr><th>Date</th><th>League</th><th>Type</th><th>Winner</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    // Attach collapsible toggle
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    // Attach context menu to winner player links
    for (const l of withDates) {
        if (l.leader) {
            const row = section.querySelector(`tr[data-league-id="${CSS.escape(l.id)}"]`);
            if (row) attachPlayerNameInteractions(row, l.id);
        }
    }

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

        const metricLabel = lb.isUBC ? 'Points' : 'Wins';
        const showWinRate = !lb.isUBC;
        const showAvgPoints = lb.isUBC;
        const collapsed = lb.year >= currentYear ? '' : ' collapsed';

        // Header row
        let thMonths = lb.months.map(m => `<th class="month-col">${m}</th>`).join('');
        let thExtra = `<th class="total-col">Total</th>`;
        if (showWinRate) thExtra += `<th>Win Rate</th>`;
        if (showAvgPoints) thExtra += `<th>Avg Pts</th>`;
        thExtra += `<th>Mean PR</th>`;

        // Data rows
        let rowsHtml = '';
        for (const row of lb.rows) {
            let rankClass = '';
            if (row.rank === 1) rankClass = 'rank-gold';
            else if (row.rank === 2) rankClass = 'rank-silver';
            else if (row.rank === 3) rankClass = 'rank-bronze';

            const monthCells = lb.months.map(m => {
                const val = row.monthly[m];
                return `<td class="month-col">${val != null ? val : '–'}</td>`;
            }).join('');

            let extraCells = `<td class="total-col">${row.total}</td>`;
            if (showWinRate) extraCells += `<td>${formatPercent(row.winRate)}</td>`;
            if (showAvgPoints) extraCells += `<td>${formatNumber(row.avgPoints)}</td>`;
            extraCells += `<td>${row.meanPR !== null ? formatNumber(row.meanPR) : 'N/A'}</td>`;

            rowsHtml += `
                <tr class="${rankClass}">
                    <td>${row.rank}</td>
                    <td class="player-cell">
                        <img class="flag" src="${flagUrl(row.flagCode)}" alt="${row.flagCode}">
                        ${playerNameLink(row.player)}
                    </td>
                    ${monthCells}
                    ${extraCells}
                </tr>`;
        }

        const title = `${lb.year} ${lb.typeName} Leaderboard`;

        const defaultRows = Math.min(10, lb.rows.length);
        section.innerHTML = `
            <div class="collapsible-section${collapsed}">
                <div class="leaderboard-header-row">
                    <h2 class="collapsible-header">${title}</h2>
                    <div class="img-export-group">
                        <label class="img-export-label">Top
                            <input class="img-export-rows" type="number"
                                   min="1" max="${lb.rows.length}" value="${defaultRows}">
                        </label>
                        <button class="img-export-btn">Export Image</button>
                    </div>
                </div>
                <div class="collapsible-body">
                    <div class="leaderboard-table-wrapper">
                        <table class="leaderboard-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th class="player-col">Player</th>
                                    ${thMonths}
                                    ${thExtra}
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;

        // Collapsible toggle
        const header = section.querySelector('.collapsible-header');
        header.addEventListener('click', () => {
            header.closest('.collapsible-section').classList.toggle('collapsed');
        });

        // Image export
        const exportBtn = section.querySelector('.img-export-btn');
        const rowsInput = section.querySelector('.img-export-rows');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let maxRows = parseInt(rowsInput.value, 10);
            if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;
            if (maxRows > lb.rows.length) maxRows = lb.rows.length;
            exportLeaderboardImage(lb, title, maxRows);
        });
        // Don't toggle collapsible when interacting with the export controls.
        section.querySelector('.img-export-group').addEventListener('click', e => e.stopPropagation());

        container.appendChild(section);
    }
}

async function exportLeaderboardImage(lb, title, maxRows) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }

    const showWinRate = !lb.isUBC;
    const showAvgPoints = lb.isUBC;

    // Build header
    let thMonths = lb.months.map(m => `<th class="month-col">${m}</th>`).join('');
    let thExtra = `<th class="total-col">Total</th>`;
    if (showWinRate) thExtra += `<th>Win Rate</th>`;
    if (showAvgPoints) thExtra += `<th>Avg Pts</th>`;
    thExtra += `<th>Mean PR</th>`;

    // Build body
    let bodyHtml = '';
    const rows = lb.rows.slice(0, maxRows);
    for (const row of rows) {
        let rankClass = '';
        if (row.rank === 1) rankClass = 'rank-gold';
        else if (row.rank === 2) rankClass = 'rank-silver';
        else if (row.rank === 3) rankClass = 'rank-bronze';

        const monthCells = lb.months.map(m => {
            const val = row.monthly[m];
            return `<td class="month-col">${val != null ? val : '–'}</td>`;
        }).join('');

        let extraCells = `<td class="total-col">${row.total}</td>`;
        if (showWinRate) extraCells += `<td>${formatPercent(row.winRate)}</td>`;
        if (showAvgPoints) extraCells += `<td>${formatNumber(row.avgPoints)}</td>`;
        extraCells += `<td>${row.meanPR !== null ? formatNumber(row.meanPR) : 'N/A'}</td>`;

        bodyHtml += `
            <tr class="${rankClass}">
                <td>${row.rank}</td>
                <td class="player-cell">
                    <img class="flag" src="${flagUrl(row.flagCode)}" alt="${row.flagCode}">
                    ${escapeHtml(row.player)}
                </td>
                ${monthCells}
                ${extraCells}
            </tr>`;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-10000px;top:0;background:#ffffff;padding:24px;font-family:sans-serif;';
    wrap.innerHTML = `
        <h3 style="margin:0 0 12px 0;font-size:20px;color:#1e293b;">${escapeHtml(title)}</h3>
        <div class="leaderboard-table-wrapper">
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th class="player-col">Player</th>
                        ${thMonths}
                        ${thExtra}
                    </tr>
                </thead>
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>`;
    document.body.appendChild(wrap);

    try {
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Top${maxRows}.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}

/* ── Achievements (all-time per league type) ─────────── */

const TYPE_ORDER = ['doubling', 'regular', 'ubc'];
const ACHIEVEMENT_METRICS = [
    { key: 'gold',    label: 'Gold',     fmt: v => v },
    { key: 'silver',  label: 'Silver',   fmt: v => v },
    { key: 'bronze',  label: 'Bronze',   fmt: v => v },
    { key: 'avgRank', label: 'Avg Rank', fmt: v => formatNumber(v) },
    { key: 'winRate', label: 'Avg Win Rate', fmt: v => formatPercent(v) }
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
            panel.innerHTML = renderAchievementTables(data);
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderAchievementTables(data) {
    return `<div class="achv-tables-grid">${ACHIEVEMENT_METRICS.map(m => {
        const rows = data.rankings[m.key] || [];
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td><img class="flag" src="${flagUrl(getFlagCode(r.name, data.customFlags))}" alt="flag"> ${playerNameLink(r.name)}</td>
                <td>${m.fmt(r.value)}</td>
            </tr>
        `).join('');
        return `
            <div class="achv-table-card">
                <h3>${m.label}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table">
                        <thead><tr><th>#</th><th>Player</th><th>${m.label}</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="3">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('')}</div>`;
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
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderPRTables(data) {
    return `<div class="achv-tables-grid">${PR_METRICS.map(m => {
        const rows = data.rankings[m.key] || [];
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td><img class="flag" src="${flagUrl(getFlagCode(r.name, data.customFlags))}" alt="flag"> ${playerNameLink(r.name)}</td>
                <td>${formatNumber(r.value)}</td>
            </tr>
        `).join('');
        return `
            <div class="achv-table-card">
                <h3>${m.label}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table">
                        <thead><tr><th>#</th><th>Player</th><th>PR</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="3">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('')}</div>`;
}
