/**
 * navigation.js — Site-wide navigation: nav bar, breadcrumbs, player search,
 * keyboard shortcuts, and cross-league player index.
 */

import { loadLeagueOrder, loadAllLeagueParams, loadLeagueMatches } from '../data/leagueLoader.js';
import { dashboardUrl, playerUrl, playerGeneralUrl, parseLeagueDate } from '../utils/helpers.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getInitials } from './playerHeader.js';
import { isLoggedIn, getUsername } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';

const CURRENT_YEAR = new Date().getFullYear();
// League-type badge: single-letter icon + full label tooltip (colours via CSS).
const LEAGUE_TYPE_BADGE = {
    doubling: { letter: 'D', label: 'Doubling' },
    regular:  { letter: 'R', label: 'Regular' },
    ubc:      { letter: 'U', label: 'UBC' },
};
// Status-dot tooltips — mirror the player-card header in playerGeneralPage.js.
const STATUS_TITLE = {
    green: 'Active in a running league',
    orange: `Played this year (${CURRENT_YEAR})`,
    gray: `Inactive in ${CURRENT_YEAR}`,
};

// ---- Breadcrumbs ----

/**
 * Render breadcrumb navigation at the top of .page-container.
 * @param {Array<{label: string, url?: string}>} crumbs — last item has no url (current page)
 */
export function renderBreadcrumbs(crumbs) {
    if (!crumbs || crumbs.length === 0) return;

    const container = document.querySelector('.page-container');
    if (!container) return;

    // Remove existing breadcrumbs if any
    const existing = container.querySelector('.breadcrumbs');
    if (existing) existing.remove();

    const nav = document.createElement('nav');
    nav.className = 'breadcrumbs';
    nav.setAttribute('aria-label', 'Breadcrumb');

    const ol = document.createElement('ol');
    crumbs.forEach((crumb, i) => {
        const li = document.createElement('li');
        if (i === crumbs.length - 1) {
            // Current page — no link
            li.className = 'current';
            li.setAttribute('aria-current', 'page');
            li.textContent = crumb.label;
        } else {
            const a = document.createElement('a');
            a.href = crumb.url || '#';
            a.textContent = crumb.label;
            li.appendChild(a);
        }
        ol.appendChild(li);

        // Add separator after each item except last
        if (i < crumbs.length - 1) {
            const sep = document.createElement('li');
            sep.className = 'sep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '\u203A'; // ›
            ol.appendChild(sep);
        }
    });

    nav.appendChild(ol);
    container.insertBefore(nav, container.firstChild);
}

// ---- Nav Bar ----

let navBarInstalled = false;
let leagueIndex = []; // [{id, title, running, hidden}]

/**
 * Initialize the persistent nav bar. Safe to call multiple times.
 */
export async function initNavBar() {
    if (navBarInstalled) return;
    navBarInstalled = true;

    try {
        const displayOrder = await loadLeagueOrder();
        const folderNames = displayOrder.map(t => t.replace(' - ', ' '));
        const allParams = await loadAllLeagueParams(folderNames);

        leagueIndex = allParams.map((lp, i) => ({
            id: lp.id,
            title: lp.params?.LeagueTitle || displayOrder[i],
            running: lp.params?.Running === true,
            hidden: lp.params?.Hidden === true,
            leagueType: lp.params?.LeagueType || 'doubling'
        }));
    } catch {
        leagueIndex = [];
    }

    const adminBadge = isLoggedIn()
        ? `<div class="nav-admin-user">
               <img class="nav-admin-logo" src="assets/logo/logo.png" alt="">
               <div class="nav-admin-avatar">${getUsername().charAt(0).toUpperCase()}</div>
               <span class="nav-admin-name">${getUsername()}</span>
           </div>`
        : '';

    const nav = document.createElement('nav');
    nav.className = 'site-nav';
    nav.innerHTML = `
        <div class="site-nav-inner">
            <a href="index.html" class="nav-home">Shabi Israel</a>
            <div class="nav-leagues">
                <button class="nav-leagues-btn" aria-expanded="false">Leagues \u25BE</button>
                <ul class="nav-leagues-dropdown" hidden></ul>
            </div>
            <div class="nav-search">
                <input type="text" placeholder="Search" autocomplete="off" aria-label="Search players and leagues">
                <ul class="nav-search-results" hidden role="listbox"></ul>
            </div>
            ${adminBadge}
        </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);

    // Skip-to-main-content link (must be first focusable element)
    if (!document.querySelector('.skip-link')) {
        const skip = document.createElement('a');
        skip.className = 'skip-link';
        skip.href = '#main';
        skip.textContent = 'Skip to content';
        document.body.insertBefore(skip, document.body.firstChild);
    }

    populateLeagueDropdown(nav);
    setupLeagueDropdown(nav);
    setupPlayerSearch(nav);
}

function populateLeagueDropdown(nav) {
    const dropdown = nav.querySelector('.nav-leagues-dropdown');
    const visible = leagueIndex.filter(l => !l.hidden);
    const running = visible.filter(l => l.running);
    const completed = visible.filter(l => !l.running);

    let html = '';
    if (running.length > 0) {
        html += '<li class="dropdown-section">Running</li>';
        for (const l of running) {
            html += `<li><a href="${dashboardUrl(l.id)}"><span class="status-dot running"></span>${escapeHtml(l.title)}</a></li>`;
        }
    }
    if (completed.length > 0) {
        html += '<li class="dropdown-section">Completed</li>';
        for (const l of completed) {
            html += `<li><a href="${dashboardUrl(l.id)}"><span class="status-dot completed"></span>${escapeHtml(l.title)}</a></li>`;
        }
    }
    dropdown.innerHTML = html;
}

function setupLeagueDropdown(nav) {
    const btn = nav.querySelector('.nav-leagues-btn');
    const dropdown = nav.querySelector('.nav-leagues-dropdown');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dropdown.hidden;
        closeAllDropdowns(nav);
        if (!open) {
            dropdown.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        }
    });

    document.addEventListener('click', () => closeAllDropdowns(nav));
}

function closeAllDropdowns(nav) {
    const dropdown = nav.querySelector('.nav-leagues-dropdown');
    const btn = nav.querySelector('.nav-leagues-btn');
    if (dropdown) dropdown.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');

    const searchResults = nav.querySelector('.nav-search-results');
    if (searchResults) searchResults.hidden = true;
}

// ---- Player Search ----

let playerIndexPromise = null;
let playerIndex = null; // Map<playerName, [{leagueId, title}]>

/**
 * Build and return the cross-league player index (memoized).
 * @returns {Promise<Map<string, Array<{leagueId: string, title: string}>>>}
 */
export function ensurePlayerIndex() {
    if (!playerIndexPromise) {
        playerIndexPromise = buildPlayerIndex();
    }
    return playerIndexPromise;
}

async function buildPlayerIndex() {
    const map = new Map();

    // Use leagueIndex if available, otherwise load fresh
    let leagues = leagueIndex;
    if (leagues.length === 0) {
        try {
            const displayOrder = await loadLeagueOrder();
            const folderNames = displayOrder.map(t => t.replace(' - ', ' '));
            const allParams = await loadAllLeagueParams(folderNames);
            leagues = allParams
                .map((lp, i) => ({
                    id: lp.id,
                    title: lp.params?.LeagueTitle || displayOrder[i],
                    running: lp.params?.Running === true,
                    hidden: lp.params?.Hidden === true
                }))
                .filter(l => !l.hidden);
        } catch {
            return map;
        }
    } else {
        leagues = leagues.filter(l => !l.hidden);
    }

    // Load all CSVs and metadata in parallel
    const [results, meta] = await Promise.all([
        Promise.allSettled(
            leagues.map(async l => {
                const { allPlayers } = await loadLeagueMatches(l.id);
                return {
                    leagueId: l.id,
                    title: l.title,
                    running: l.running === true,
                    year: parseLeagueDate(l.id).year,
                    players: allPlayers,
                };
            })
        ),
        loadPlayersMetadata()
    ]);

    for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { leagueId, title, running, year, players } = r.value;
        for (const name of players) {
            if (!map.has(name)) map.set(name, []);
            map.get(name).push({ leagueId, title, running, year });
        }
    }

    // Attach fullName + photo from metadata and remove hidden players
    for (const [name, entries] of map) {
        if (meta[name]?.hidden) { map.delete(name); continue; }
        const { fullName, photoPath } = meta[name] || {};
        if (fullName || photoPath) {
            for (const entry of entries) {
                if (fullName) entry.fullName = fullName;
                if (photoPath) entry.photoPath = photoPath;
            }
        }
    }

    // In preview mode, also include pre-registered inactive players (not in any CSV yet)
    if (isPreviewMode()) {
        for (const [name, m] of Object.entries(meta)) {
            if (!m || m.hidden || map.has(name)) continue;
            if (m.inactive) {
                map.set(name, [{ fullName: m.fullName, photoPath: m.photoPath }]);
            }
        }
    }

    playerIndex = map;
    return map;
}

/**
 * Get leagues a player participates in (sync, after index is built).
 */
export function getPlayerLeagues(playerName) {
    return playerIndex?.get(playerName) || [];
}

function setupPlayerSearch(nav) {
    const input = nav.querySelector('.nav-search input');
    const results = nav.querySelector('.nav-search-results');

    // Lazy-load player index on first focus
    input.addEventListener('focus', () => {
        ensurePlayerIndex();
    }, { once: true });

    input.addEventListener('input', async () => {
        const query = input.value.trim().toLowerCase();
        if (query.length < 1) {
            results.hidden = true;
            return;
        }

        // ── Match leagues (top-level entities) ──
        const leagueMatches = leagueIndex
            .filter(l => !l.hidden && l.title.toLowerCase().includes(query))
            .slice(0, 5);

        // ── Match players (cross-league index) ──
        const index = await ensurePlayerIndex();
        // Bail if the query changed while the index was loading.
        if (input.value.trim().toLowerCase() !== query) return;

        const playerMatches = [];
        for (const [name, leagues] of index) {
            const fullName = leagues[0]?.fullName || '';
            if (name.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                playerMatches.push({ name, leagues, fullName });
                if (playerMatches.length >= 6) break;
            }
        }

        if (leagueMatches.length === 0 && playerMatches.length === 0) {
            results.innerHTML = '<li class="search-empty">No matches found</li>';
            results.hidden = false;
            return;
        }

        const isEmbedded = window.self !== window.top;
        const targetAttr = isEmbedded ? ' target="_top"' : '';
        const preview = isPreviewMode();
        let html = '';

        // ── Leagues group ──
        if (leagueMatches.length > 0) {
            html += '<li class="search-group-header" role="presentation">Leagues</li>';
            html += leagueMatches.map(l => {
                const status = l.running ? 'running' : 'completed';
                const statusLabel = l.running ? 'Running' : 'Completed';
                const href = preview ? `${dashboardUrl(l.id)}&preview=true` : dashboardUrl(l.id);
                const type = LEAGUE_TYPE_BADGE[l.leagueType] || LEAGUE_TYPE_BADGE.doubling;
                const typeBadge = `<span class="search-type-badge type-${escapeHtml(l.leagueType)}" title="${escapeHtml(type.label)} league">${escapeHtml(type.label)}</span>`;
                return `<li role="option"><a href="${href}"${targetAttr}>
                    <span class="search-icon search-icon--league" aria-hidden="true">
                        <svg class="search-league-glyph" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                            <rect x="2" y="3" width="12" height="10" rx="1.5"/>
                            <line x1="2" y1="6.5" x2="14" y2="6.5"/>
                            <line x1="8" y1="6.5" x2="8" y2="13"/>
                        </svg>
                        <span class="status-dot ${status}"></span>
                    </span>
                    <span class="search-player-info">
                        <span class="search-player-name">${escapeHtml(l.title)}</span>
                    </span>
                    ${typeBadge}
                    <span class="search-type-pill ${status}">${statusLabel}</span>
                </a></li>`;
            }).join('');
        }

        // ── Players group ──
        if (playerMatches.length > 0) {
            html += '<li class="search-group-header" role="presentation">Players</li>';
            html += playerMatches.map(m => {
                const firstLeague = m.leagues[0];
                const leagueCount = m.leagues.filter(l => l.leagueId).length;
                const hint = leagueCount === 0 ? 'inactive' : leagueCount === 1 ? firstLeague.title : `${leagueCount} leagues`;
                const nameHtml = m.fullName
                    ? `<span class="search-player-name">${escapeHtml(m.name)}</span><span class="search-player-realname">${escapeHtml(m.fullName)}</span>`
                    : `<span class="search-player-name">${escapeHtml(m.name)}</span>`;
                const href = preview ? `${playerGeneralUrl(m.name)}&preview=true` : playerGeneralUrl(m.name);

                // Status dot — same logic as the player-card header
                // (green = running league, orange = played this year, gray = inactive).
                const inRunning = m.leagues.some(l => l.running);
                const inCurrentYear = m.leagues.some(l => l.year === CURRENT_YEAR);
                const status = inRunning ? 'green' : inCurrentYear ? 'orange' : 'gray';

                // Avatar — the same photo-or-initials the header shows.
                const photoPath = m.leagues.find(l => l.photoPath)?.photoPath;
                const avatarInner = photoPath
                    ? `<img class="search-avatar-img" src="${escapeHtml(photoPath)}" alt="">`
                    : escapeHtml(getInitials(m.name, m.fullName) || (m.name.trim()[0] || '?').toUpperCase());

                return `<li role="option"><a href="${href}"${targetAttr}>
                    <span class="search-icon search-icon--player${photoPath ? ' has-photo' : ''}" aria-hidden="true">
                        ${avatarInner}
                        <span class="search-status-dot ${status}" title="${escapeHtml(STATUS_TITLE[status])}"></span>
                    </span>
                    <span class="search-player-info">${nameHtml}</span>
                    <span class="search-league-hint">${escapeHtml(hint)}</span>
                </a></li>`;
            }).join('');
        }

        results.innerHTML = html;
        results.hidden = false;
    });

    // Close results on click outside
    document.addEventListener('click', (e) => {
        if (!nav.querySelector('.nav-search').contains(e.target)) {
            results.hidden = true;
        }
    });

    // Close on Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            results.hidden = true;
            input.blur();
        }
    });
}

// ---- Keyboard Shortcuts ----

/**
 * Install global keyboard shortcuts.
 */
export function initKeyboardShortcuts() {
    let focusedRow = -1;

    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        // Escape — close menus or go back
        if (e.key === 'Escape') {
            // Close context menu if open
            const ctx = document.querySelector('.player-context-menu');
            if (ctx) { ctx.remove(); return; }

            // Close nav dropdowns if open
            const navDd = document.querySelector('.nav-leagues-dropdown:not([hidden])');
            if (navDd) { navDd.hidden = true; return; }

            history.back();
            return;
        }

        // Arrow navigation in tables
        const table = document.querySelector('#leagueTable tbody, #playerTable tbody');
        if (!table) return;
        const rows = Array.from(table.querySelectorAll('tr:not(.summary-row):not(.avg-row)'));
        if (rows.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusedRow = Math.min(focusedRow + 1, rows.length - 1);
            updateRowFocus(rows, focusedRow);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusedRow = Math.max(focusedRow - 1, 0);
            updateRowFocus(rows, focusedRow);
        } else if (e.key === 'Enter' && focusedRow >= 0) {
            const link = rows[focusedRow]?.querySelector('.player-cell a');
            if (link) link.click();
        }
    });
}

function updateRowFocus(rows, idx) {
    rows.forEach(r => r.classList.remove('kb-focused'));
    if (idx >= 0 && idx < rows.length) {
        rows[idx].classList.add('kb-focused');
        rows[idx].scrollIntoView({ block: 'nearest' });
    }
}

// ---- Helpers ----

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
}
