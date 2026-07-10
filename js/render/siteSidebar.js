/**
 * siteSidebar.js — Persistent left-side navigation for public pages.
 *
 *  Header        — round logo + "Shabi Israel" (links to index.html);
 *                  matches the brand row of the (removed) top nav.
 *  Players       — links to index.html?tab=players#players-panel (jumps straight to the A7 directory panel, tab strip scrolled out of view).
 *  Leagues ▸
 *      Dashboard ▸ — chronological list of every league.
 *      Table ▸     — chronological list of every league.
 *  Records       — links to index.html?tab=records#records-* (jumps straight to that sub-section, tab strip scrolled out of view).
 *  Leaders       — links to index.html?tab=leaderboard#leaderboard-panel (jumps straight to the leaderboard panel, tab strip scrolled out of view).
 *  Settings ▸
 *      Theme Customize  — opens the existing theme-picker modal.
 *      Show name as     — Username | Full (persists in localStorage; reload).
 *  Admin Mode    — top-level (not nested in Settings). Opens login / admin.html.
 *  Search        — bottom block: label + ⋯ chip; on hover/click a flyout panel
 *                  appears to the right with the live search input + results.
 *
 *  Submenus are FLYOUTS that open to the right of the sidebar on hover
 *  AND on click (click pins; click elsewhere unpins). Nested submenus
 *  (Leagues → Dashboard → leagues list) cascade further right.
 *  Mobile collapses to an off-canvas drawer behind a hamburger.
 *
 *  Icons reuse the same emoji vocabulary as the page tabs (TAB_ICONS), so a
 *  concept ("Leagues" / "Records" / "Players") shows the same glyph in the
 *  sidebar as in the tab bar.
 */

import { loadLandingSettings, loadAllLeagueParams } from '../data/store.js';
import { leagueUrl, leagueTableUrl, playerUrl, parseLeagueDate } from '../utils/helpers.js';
import { getNameDisplayMode, setNameDisplayMode } from '../utils/nameDisplay.js';
import { isLoggedIn, login, logout, getUsername } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';
import { buildThemePickerPanel } from './themePicker.js';
import { TAB_ICONS } from './tabIcons.js';
import { mountSearchInto, ensureLeagueIndex, searchEntities } from './navigation.js';
import { mountSidebarToggle, closeSidebar, isMobile as sharedIsMobile } from './sidebarToggle.js';
import { wireNavFlyouts } from './navFlyout.js';
import { installSearchOverlay, registerSearchAdapter } from './searchOverlay.js';
import { getInitials } from './playerHeader.js';
import { mountTopbar, setTopbarBrand } from './topbar.js';


/* ── Icon palette — pulls from TAB_ICONS where the concept matches, falls
   back to glyphs from the same emoji family for new sidebar-only items. ── */

const ICON = {
    players:     TAB_ICONS.players,                 // 👥
    leagues:     TAB_ICONS.leagues,                 // table/grid SVG
    dashboard:   TAB_ICONS.standings,               // 📊
    table:       TAB_ICONS.leagues,                 // same SVG, scoped to inner row
    records:     TAB_ICONS.records,                 // 📜
    medal:       '🏅',                              // Records → Achievements
    brain:       '🧠',                              // Records → PR
    cube:        TAB_ICONS.matches,                 // 🎲 Records → Match
    leaders:     TAB_ICONS.leaderboard,             // 👑
    settings:    '⚙️',
    pencil:      '🎨',
    abc:         '🔤',
    admin:       '👷',
    search:      '🔍',
    dots:        '⋯',
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="site-nav-chevron"><polyline points="9 6 15 12 9 18"/></svg>`,
    hamburger:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
};

/* League-type pill labels — mirrors LEAGUE_TYPE_BADGE in navigation.js so the
   Dashboard/Table flyouts show the same D/R/UBC vocabulary as search results. */
const LEAGUE_TYPE_LABEL = {
    doubling: 'Doubling',
    regular:  'Regular',
    ubc:      'UBC',
};

/* ── Mount entry point ────────────────────────────────────────────────── */

let _layoutRoot = null;
let _sidebarEl = null;

/**
 * Mount the sidebar around the current page. Idempotent.
 * @param {object} opts
 * @param {string} opts.activeView — 'home' | 'league' | 'leagueTable' | 'player' | 'playerLeague'
 * @param {string} [opts.leagueId] — highlights the matching league submenu row.
 * @param {string} [opts.playerName] — highlights the matching player submenu row.
 * @param {string} [opts.topbarTitle] — short label for the mobile topbar.
 */
export function mountSiteSidebar(opts = {}) {
    if (_layoutRoot) return;
    document.body.classList.add('site-sidebar-mounted');

    const existing = [...document.body.childNodes];

    const layout = document.createElement('div');
    layout.className = 'site-layout';
    _layoutRoot = layout;

    const sidebar = document.createElement('aside');
    sidebar.className = 'site-sidebar';
    sidebar.id = 'site-sidebar';
    _sidebarEl = sidebar;

    const main = document.createElement('main');
    main.className = 'site-main';
    main.id = 'site-main';
    for (const node of existing) main.appendChild(node);

    layout.appendChild(sidebar);
    layout.appendChild(main);
    document.body.appendChild(layout);

    buildMobileChrome(opts.topbarTitle || labelForView(opts.activeView));
    mountTopbar();
    renderShell(sidebar, opts);

    // Warm the league index so search results are instant on first keystroke.
    ensureLeagueIndex();

    // Lazy-fill async data (leagues + players + flags).
    populateAsync(opts).catch(err => console.warn('[siteSidebar] data load failed:', err));

    wireInteractions(sidebar, opts);
}

function labelForView(view) {
    switch (view) {
        case 'home':        return 'Home';
        case 'league':      return 'Dashboard';
        case 'leagueTable': return 'League Table';
        case 'player':
        case 'playerLeague':return 'Player';
        default:            return 'Shabi Israel';
    }
}

/* ── Shell render ────────────────────────────────────────────────────── */

function renderShell(sidebar, opts) {
    const loggedIn = isLoggedIn() && !isPreviewMode();
    // Same shape & class as the admin sidebar's welcome banner — see
    // .sidebar-admin-banner in css/sidebar-shared.css. Rendered in the footer
    // slot of the sidebar (after the search block) only when logged in.
    const adminFooter = loggedIn
        ? `<div class="sidebar-admin-banner">
              <div class="sidebar-admin-avatar">${escapeHtml(getUsername().charAt(0).toUpperCase())}</div>
              <div class="sidebar-admin-body">
                  <div class="sidebar-admin-label">Welcome back</div>
                  <div class="sidebar-admin-name">${escapeHtml(getUsername())}</div>
                  <div class="sidebar-admin-status"><span class="sidebar-admin-dot"></span>Active</div>
              </div>
           </div>`
        : '';

    sidebar.innerHTML = `
        <a class="site-sidebar-brand" href="index.html" aria-label="Shabi Israel — home">
            <img class="site-sidebar-brand-logo" id="site-sidebar-logo" src="assets/favicon-round.png" alt="">
            <span class="site-sidebar-brand-text" id="site-sidebar-title">Shabi Israel</span>
        </a>
        ${adminFooter}

        <nav aria-label="Site sections" class="site-nav-tree">
            <a class="site-nav-item" href="index.html?tab=players#players-panel" data-view="players">
                <span class="site-nav-icon" aria-hidden="true">${ICON.players}</span>
                <span class="site-nav-label">Players</span>
            </a>

            <div class="site-nav-flyout-host" data-flyout="leagues">
                <button class="site-nav-item site-nav-group" data-group="leagues">
                    <span class="site-nav-icon" aria-hidden="true">${ICON.leagues}</span>
                    <span class="site-nav-label">Leagues</span>
                    ${ICON.chevron}
                </button>
                <div class="site-nav-flyout" data-submenu="leagues" role="menu">
                    <div class="site-nav-flyout-host site-nav-flyout-host--nested" data-flyout="leagues-dashboard">
                        <button class="site-nav-item site-nav-group" data-group="leagues-dashboard">
                            <span class="site-nav-icon" aria-hidden="true">${ICON.dashboard}</span>
                            <span class="site-nav-label">Dashboard</span>
                            ${ICON.chevron}
                        </button>
                        <div class="site-nav-flyout site-nav-flyout--nested" data-submenu="leagues-dashboard" role="menu">
                            <div class="site-nav-flyout-loading">Loading…</div>
                        </div>
                    </div>
                    <div class="site-nav-flyout-host site-nav-flyout-host--nested" data-flyout="leagues-table">
                        <button class="site-nav-item site-nav-group" data-group="leagues-table">
                            <span class="site-nav-icon" aria-hidden="true">${ICON.table}</span>
                            <span class="site-nav-label">Table</span>
                            ${ICON.chevron}
                        </button>
                        <div class="site-nav-flyout site-nav-flyout--nested" data-submenu="leagues-table" role="menu">
                            <div class="site-nav-flyout-loading">Loading…</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="site-nav-flyout-host" data-flyout="records">
                <button class="site-nav-item site-nav-group" data-group="records">
                    <span class="site-nav-icon" aria-hidden="true">${ICON.records}</span>
                    <span class="site-nav-label">Records</span>
                    ${ICON.chevron}
                </button>
                <div class="site-nav-flyout" data-submenu="records" role="menu">
                    <a class="site-nav-flyout-item" href="index.html?tab=records#records-achievements">
                        <span class="site-nav-icon" aria-hidden="true">${ICON.medal}</span>
                        <span class="site-nav-flyout-label">Achievements</span>
                    </a>
                    <a class="site-nav-flyout-item" href="index.html?tab=records#records-pr">
                        <span class="site-nav-icon" aria-hidden="true">${ICON.brain}</span>
                        <span class="site-nav-flyout-label">PR</span>
                    </a>
                    <a class="site-nav-flyout-item" href="index.html?tab=records#records-match">
                        <span class="site-nav-icon" aria-hidden="true">${ICON.cube}</span>
                        <span class="site-nav-flyout-label">Match</span>
                    </a>
                    <a class="site-nav-flyout-item" href="index.html?tab=records#records-league">
                        <span class="site-nav-icon" aria-hidden="true">${ICON.leagues}</span>
                        <span class="site-nav-flyout-label">League</span>
                    </a>
                </div>
            </div>

            <a class="site-nav-item" href="index.html?tab=leaderboard#leaderboard-panel" data-view="leaderboard">
                <span class="site-nav-icon" aria-hidden="true">${ICON.leaders}</span>
                <span class="site-nav-label">Leaders</span>
            </a>

            <div class="site-nav-flyout-host" data-flyout="settings">
                <button class="site-nav-item site-nav-group" data-group="settings">
                    <span class="site-nav-icon" aria-hidden="true">${ICON.settings}</span>
                    <span class="site-nav-label">Settings</span>
                    ${ICON.chevron}
                </button>
                <div class="site-nav-flyout" data-submenu="settings" role="menu">
                    <div class="site-nav-flyout-host site-nav-flyout-host--nested" data-flyout="settings-theme">
                        <button class="site-nav-flyout-item site-nav-group" data-group="settings-theme">
                            <span class="site-nav-icon" aria-hidden="true">${ICON.pencil}</span>
                            <span class="site-nav-label">Theme Customize</span>
                            ${ICON.chevron}
                        </button>
                        <div class="site-nav-flyout site-nav-flyout--nested site-nav-flyout--theme" data-submenu="settings-theme" role="menu">
                            <div class="site-nav-flyout-loading">Loading…</div>
                        </div>
                    </div>
                    <div class="site-nav-flyout-host site-nav-flyout-host--nested" data-flyout="settings-name">
                        <button class="site-nav-flyout-item site-nav-group" data-group="settings-name">
                            <span class="site-nav-icon" aria-hidden="true">${ICON.abc}</span>
                            <span class="site-nav-label">Show name as</span>
                            ${ICON.chevron}
                        </button>
                        <div class="site-nav-flyout site-nav-flyout--nested site-nav-flyout--name" data-submenu="settings-name" role="menu">
                            <button class="site-nav-flyout-item" data-name-mode="username">
                                <span class="site-nav-flyout-label">Username</span>
                                <span class="site-nav-flyout-check" aria-hidden="true">✓</span>
                            </button>
                            <button class="site-nav-flyout-item" data-name-mode="full">
                                <span class="site-nav-flyout-label">Full name</span>
                                <span class="site-nav-flyout-check" aria-hidden="true">✓</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <button class="site-nav-item" data-action="admin-mode">
                <span class="site-nav-icon" aria-hidden="true">${ICON.admin}</span>
                <span class="site-nav-label">${loggedIn ? 'Admin Mode' : 'Admin Login'}</span>
            </button>
        </nav>

        <div class="site-sidebar-search site-nav-flyout-host" data-flyout="search">
            <div class="site-sidebar-search-wrap">
                <span class="site-sidebar-search-icon" aria-hidden="true">${ICON.search}</span>
                <input class="site-sidebar-search-input app-search-input" type="text" placeholder="Search…" autocomplete="off" aria-label="Search players and leagues">
            </div>
            <div class="site-nav-flyout site-nav-flyout--search" data-submenu="search" role="menu">
                <ul class="nav-search-results" hidden role="listbox"></ul>
                <div class="site-nav-flyout--search-empty">Type to search</div>
            </div>
        </div>

        ${loggedIn ? `
        <button class="site-sidebar-logout" id="site-sidebar-logout" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            <span>Logout</span>
        </button>` : ''}
    `;

    if (opts.activeView === 'records') sidebar.querySelector('[data-view="records"]')?.classList.add('active');
    if (opts.activeView === 'leaderboard') sidebar.querySelector('[data-view="leaderboard"]')?.classList.add('active');
    if (opts.activeView === 'player' || opts.activeView === 'playerLeague') sidebar.querySelector('[data-view="players"]')?.classList.add('active');

    const select = sidebar.querySelector('#site-name-display-select');
    if (select) select.value = getNameDisplayMode();
}

/* ── Async population ────────────────────────────────────────────────── */

async function populateAsync(opts) {
    const settings = await loadLandingSettings();

    const logoEl = _sidebarEl.querySelector('#site-sidebar-logo');
    const titleEl = _sidebarEl.querySelector('#site-sidebar-title');
    if (logoEl && settings.logoPath) logoEl.src = settings.logoPath;
    if (titleEl && settings.title)  titleEl.textContent = settings.title;

    // Mirror into the top bar (shown while the sidebar is closed).
    setTopbarBrand({ logoPath: settings.logoPath, title: settings.title });

    const folderNames = settings.displayOrder.map(t => t.replace(' - ', ' '));
    const allParams = await loadAllLeagueParams(folderNames);
    const adminLoggedIn = isLoggedIn() && !isPreviewMode();

    const leaguesAll = allParams
        .map((lp, i) => {
            const folderId = lp.id || folderNames[i];
            const date = lp.params?.IssueDate
                ? new Date(lp.params.IssueDate)
                : (() => {
                      const d = parseLeagueDate(folderId);
                      return new Date(Date.UTC(d.year || 1970, d.monthIndex >= 0 ? d.monthIndex : 0, 1));
                  })();
            return {
                id: folderId,
                title: lp.params?.LeagueTitle || folderId,
                running: lp.params?.Running === true,
                hidden: lp.params?.Hidden === true,
                type: lp.params?.LeagueType || 'doubling',
                date,
            };
        })
        .filter(l => adminLoggedIn || !l.hidden)
        .sort((a, b) => b.date - a.date);

    populateLeaguesSubmenu(_sidebarEl.querySelector('[data-submenu="leagues-dashboard"]'),
        leaguesAll, leagueUrl, opts.activeView === 'league' ? opts.leagueId : null);
    populateLeaguesSubmenu(_sidebarEl.querySelector('[data-submenu="leagues-table"]'),
        leaguesAll, leagueTableUrl, opts.activeView === 'leagueTable' ? opts.leagueId : null);
}

function populateLeaguesSubmenu(container, leagues, urlFn, activeId) {
    if (!container) return;
    if (leagues.length === 0) {
        container.innerHTML = `<div class="site-nav-flyout-loading">No leagues</div>`;
        return;
    }
    container.innerHTML = leagues.map(l => {
        const cls = (l.id === activeId) ? ' active' : '';
        const type = l.type || 'doubling';
        const typeLabel = LEAGUE_TYPE_LABEL[type] || LEAGUE_TYPE_LABEL.doubling;
        const pill = `<span class="site-nav-type-pill site-nav-type-pill-${escapeAttr(type)}" title="${escapeAttr(typeLabel)} league">${escapeHtml(typeLabel)}</span>`;
        return `<a class="site-nav-flyout-item${cls}" href="${urlFn(l.id)}">
            <span class="site-nav-status-dot ${l.running ? 'running' : 'completed'}" aria-hidden="true"></span>
            <span class="site-nav-flyout-label">${escapeHtml(l.title)}</span>
            ${pill}
        </a>`;
    }).join('');
}

/* ── Interactions: flyout hover + click-pin ──────────────────────────── */

function wireInteractions(sidebar, opts) {
    // Click-to-pin / hover-to-open / outside-click-to-close — canonical
    // implementation shared with every admin sidebar surface (navFlyout.js).
    wireNavFlyouts(sidebar);

    // Settings → Theme Customize: mount the picker as a nested flyout's
    // content so it opens like any other sidebar sub-menu (cascade right,
    // hover-or-click-to-pin) instead of as a centered modal. Sibling pinned
    // sub-menus stay open since no JS unpinning runs here.
    const themeFlyout = sidebar.querySelector('[data-submenu="settings-theme"]');
    if (themeFlyout) {
        const themePanel = buildThemePickerPanel();
        themeFlyout.replaceChildren(themePanel);

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

    // Admin Mode (top-level)
    sidebar.querySelector('[data-action="admin-mode"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (isLoggedIn()) location.href = 'admin.html';
        else openLoginModal();
        if (isMobile()) closeDrawer();
    });

    // Logout (only present when logged in)
    sidebar.querySelector('#site-sidebar-logout')?.addEventListener('click', e => {
        e.stopPropagation();
        logout();
        location.reload();
    });

    // Name display preference — themed nested flyout (mirrors the
    // Theme Customize sub-menu). Mark the active mode with .active so the
    // sidebar's existing flyout-item active styling shows the current pick.
    const nameFlyout = sidebar.querySelector('[data-submenu="settings-name"]');
    if (nameFlyout) {
        const current = getNameDisplayMode();
        nameFlyout.querySelectorAll('[data-name-mode]').forEach(btn => {
            if (btn.dataset.nameMode === current) btn.classList.add('active');
        });
        nameFlyout.addEventListener('click', e => {
            const btn = e.target.closest('[data-name-mode]');
            if (!btn) return;
            setNameDisplayMode(btn.dataset.nameMode);
            location.reload();
        });
    }

    // Mount the search behaviour. The INPUT lives inside the sidebar and is
    // always visible; the RESULTS panel is a flyout that shows to the right
    // when the user has typed something. mountSearchInto handles the input
    // event wiring — we pin the flyout-host whenever there's typed content
    // so the results panel stays open while the user is reading them.
    // Mobile search-sheet: intercepts taps on any .app-search-input on this page
    // (sidebar search, matchup, What-If). No-op off touch devices. Idempotent.
    installSearchOverlay();

    const searchHost = sidebar.querySelector('.site-sidebar-search');
    if (searchHost) {
        // The legacy mountSearchInto expects the input + results both inside
        // the same root, which they are (root = .site-sidebar-search).
        mountSearchInto(searchHost);

        // Mobile search-sheet adapter: same matcher (searchEntities) as the flyout
        // above, but feeds the 16px overlay. Picking navigates to the entity.
        const sidebarInput = searchHost.querySelector('.site-sidebar-search-input');
        const esc = (s) => String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const SEARCH_YEAR = new Date().getFullYear();
        // League glyph + player avatar markup — identical to the flyout's
        // (navigation.js), reusing the shared .search-icon* CSS so the sheet
        // shows the same league icon / player photos as the inline results.
        const leagueIconHtml = (running) => `
            <span class="search-icon search-icon--league" aria-hidden="true">
                <svg class="search-league-glyph" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                    <rect x="2" y="3" width="12" height="10" rx="1.5"/>
                    <line x1="2" y1="6.5" x2="14" y2="6.5"/>
                    <line x1="8" y1="6.5" x2="8" y2="13"/>
                </svg>
                <span class="status-dot ${running ? 'running' : 'completed'}"></span>
            </span>`;
        const playerIconHtml = (p, status) => {
            const photoPath = p.leagues.find(l => l.photoPath)?.photoPath;
            const inner = photoPath
                ? `<img class="search-avatar-img" src="${esc(photoPath)}" alt="">`
                : esc(getInitials(p.name, p.fullName) || (p.name.trim()[0] || '?').toUpperCase());
            return `
                <span class="search-icon search-icon--player${photoPath ? ' has-photo' : ''}" aria-hidden="true">
                    ${inner}
                    <span class="search-status-dot ${status}"></span>
                </span>`;
        };

        registerSearchAdapter(sidebarInput, {
            async suggest(query) {
                const { leagues, players } = await searchEntities(query);
                const preview = isPreviewMode();
                const items = [];
                for (const l of leagues) {
                    items.push({
                        label: l.title,
                        sublabel: `League · ${l.running ? 'Running' : 'Completed'}`,
                        key: 'L:' + l.id,
                        iconHtml: leagueIconHtml(l.running),
                        href: preview ? `${leagueUrl(l.id)}&preview=true` : leagueUrl(l.id),
                    });
                }
                for (const p of players) {
                    const leagueCount = p.leagues.filter(l => l.leagueId).length;
                    const hint = leagueCount === 0 ? 'inactive'
                        : leagueCount === 1 ? p.leagues[0].title
                        : `${leagueCount} leagues`;
                    const sub = (p.fullName && p.fullName !== p.name) ? p.fullName : hint;
                    const status = p.leagues.some(l => l.running) ? 'green'
                        : p.leagues.some(l => l.year === SEARCH_YEAR) ? 'orange' : 'gray';
                    items.push({
                        label: p.name,
                        sublabel: sub,
                        key: 'P:' + p.name,
                        iconHtml: playerIconHtml(p, status),
                        href: preview ? `${playerUrl(p.name)}&preview=true` : playerUrl(p.name),
                    });
                }
                return items;
            },
            pick(item) { location.href = item.href; },
        });

        const input = searchHost.querySelector('.site-sidebar-search-input');
        const results = searchHost.querySelector('.nav-search-results');
        const empty = searchHost.querySelector('.site-nav-flyout--search-empty');

        function refreshSearchPin() {
            const hasQuery = input.value.trim().length > 0;
            searchHost.classList.toggle('pinned', hasQuery || document.activeElement === input);
            if (empty) empty.style.display = hasQuery ? 'none' : '';
        }
        input.addEventListener('input', refreshSearchPin);
        input.addEventListener('focus', refreshSearchPin);
        input.addEventListener('blur', () => {
            // Defer so a click on a result inside the flyout fires before
            // we unpin. The legacy results-hidden logic already closes the
            // results list on outside-click via mountSearchInto.
            setTimeout(() => {
                if (input.value.trim().length === 0) searchHost.classList.remove('pinned');
            }, 200);
        });
        // Keep flyout visible while typed content remains. The hover rule
        // would otherwise close it the moment the user moves the cursor away.
        const observer = new MutationObserver(refreshSearchPin);
        observer.observe(results, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    }

    // Auto-open the flyout matching the current view so it's clear which
    // section the user is on. Players auto-opens when on a player page, etc.
    const autoGroup = pickAutoGroup(opts);
    if (autoGroup) {
        const host = sidebar.querySelector(`.site-nav-flyout-host[data-flyout="${autoGroup}"]`);
        if (host) {
            // Don't pin — just style the trigger active so the user can see
            // where they are. The flyout still requires hover to open.
            host.querySelector('.site-nav-group')?.classList.add('current');
        }
    }
}

function pickAutoGroup(opts) {
    switch (opts.activeView) {
        case 'league':       return 'leagues';
        case 'leagueTable':  return 'leagues';
        default:             return null;
    }
}

/* ── Mobile chrome ───────────────────────────────────────────────────── */

/* The hamburger toggle implementation now lives in ./sidebarToggle.js so
   the admin panel can mount the exact same affordance. We just call into
   it here and re-export `closeDrawer` for inner click handlers that close
   on a leaf nav tap. */
function buildMobileChrome(_titleText /* legacy arg, ignored */) {
    mountSidebarToggle({ ariaControlsId: 'site-sidebar' });
}

const isMobile = sharedIsMobile;
function closeDrawer() { closeSidebar(); }

/* ── Admin login modal (same affordance the floating gear used to provide) */

function openLoginModal() {
    if (document.querySelector('.admin-login-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'admin-login-overlay';

    const modal = document.createElement('div');
    modal.className = 'admin-login-modal';
    modal.innerHTML = `
        <h2 class="admin-login-modal-title">Admin Login</h2>
        <div id="admin-modal-msg"></div>
        <div class="form-group">
            <label for="admin-modal-user">Email</label>
            <input type="email" id="admin-modal-user" autocomplete="username">
        </div>
        <div class="form-group">
            <label for="admin-modal-pass">Password</label>
            <input type="password" id="admin-modal-pass" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block" id="admin-modal-btn">Login</button>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const userInput = modal.querySelector('#admin-modal-user');
    const passInput = modal.querySelector('#admin-modal-pass');
    const loginBtn = modal.querySelector('#admin-modal-btn');
    userInput.focus();

    const onEsc = e => { if (e.key === 'Escape') closeModal(); };
    function closeModal() {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        document.removeEventListener('keydown', onEsc);
    }
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', onEsc);

    async function doLogin() {
        const user = userInput.value.trim();
        const pass = passInput.value;
        if (!user || !pass) return showMsg('Please enter email and password.', 'error');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in…';
        const ok = await login(user, pass);
        if (ok) location.href = 'admin.html';
        else { loginBtn.disabled = false; loginBtn.textContent = 'Login'; showMsg('Invalid email or password.', 'error'); }
    }
    function showMsg(msg, type) {
        const el = modal.querySelector('#admin-modal-msg');
        if (el) el.innerHTML = `<div class="admin-msg admin-msg-${type}">${msg}</div>`;
    }
    loginBtn.addEventListener('click', doLogin);
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    userInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

/* ── Misc ────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
