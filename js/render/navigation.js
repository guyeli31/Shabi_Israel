/**
 * navigation.js — Site-wide navigation: nav bar, breadcrumbs, player search,
 * keyboard shortcuts, and cross-league player index.
 */

import { loadLeagueOrder, loadAllLeagueParams, loadLeagueMatches } from '../data/leagueLoader.js';
import { dashboardUrl, playerUrl } from '../utils/helpers.js';

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
            title: displayOrder[i],
            running: lp.params?.Running === true,
            hidden: lp.params?.Hidden === true
        }));
    } catch {
        leagueIndex = [];
    }

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
                <input type="text" placeholder="Search player\u2026" autocomplete="off">
                <ul class="nav-search-results" hidden></ul>
            </div>
        </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);

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
            leagues = folderNames.map((id, i) => ({ id, title: displayOrder[i] }));
        } catch {
            return map;
        }
    }

    // Load all CSVs in parallel
    const results = await Promise.allSettled(
        leagues.map(async l => {
            const { allPlayers } = await loadLeagueMatches(l.id);
            return { leagueId: l.id, title: l.title, players: allPlayers };
        })
    );

    for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { leagueId, title, players } = r.value;
        for (const name of players) {
            if (!map.has(name)) map.set(name, []);
            map.get(name).push({ leagueId, title });
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
        if (query.length < 2) {
            results.hidden = true;
            return;
        }

        const index = await ensurePlayerIndex();
        const matches = [];
        for (const [name, leagues] of index) {
            if (name.toLowerCase().includes(query)) {
                matches.push({ name, leagues });
                if (matches.length >= 8) break;
            }
        }

        if (matches.length === 0) {
            results.innerHTML = '<li class="search-empty">No players found</li>';
            results.hidden = false;
            return;
        }

        results.innerHTML = matches.map(m => {
            const firstLeague = m.leagues[0];
            const leagueCount = m.leagues.length;
            const hint = leagueCount === 1 ? firstLeague.title : `${leagueCount} leagues`;
            return `<li><a href="${playerUrl(firstLeague.leagueId, m.name)}">
                <span class="search-player-name">${escapeHtml(m.name)}</span>
                <span class="search-league-hint">${escapeHtml(hint)}</span>
            </a></li>`;
        }).join('');
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
