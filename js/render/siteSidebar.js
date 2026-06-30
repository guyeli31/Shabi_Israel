/**
 * siteSidebar.js — Persistent left-side navigation for public pages.
 *
 *  Header        — round logo + "Shabi Israel" (links to index.html);
 *                  matches the brand row of the (removed) top nav.
 *  Players ▸     — flag · name · ACTIVE pill (sorted titled→A-Z, like A7).
 *  Leagues ▸
 *      Dashboard ▸ — chronological list of every league.
 *      Table ▸     — chronological list of every league.
 *  Records       — links to index.html?tab=records (page jumps to tab section).
 *  Leaders       — links to index.html?tab=leaderboard (page jumps to tab section).
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

import { loadLandingSettings, loadAllLeagueParams, loadLeagueMatches } from '../data/leagueLoader.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { hasTitles } from '../data/titleConstants.js';
import { leagueUrl, leagueTableUrl, playerUrl, flagUrl, getFlagCode, parseLeagueDate } from '../utils/helpers.js';
import { displayPlayerName, getNameDisplayMode, setNameDisplayMode } from '../utils/nameDisplay.js';
import { isLoggedIn, login, logout, getUsername } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';
import { buildThemePickerPanel } from './themePicker.js';
import { TAB_ICONS } from './tabIcons.js';
import { mountSearchInto, ensureLeagueIndex, searchEntities } from './navigation.js';
import { mountSidebarToggle, closeSidebar, isMobile as sharedIsMobile } from './sidebarToggle.js';
import { installSearchOverlay, registerSearchAdapter } from './searchOverlay.js';


/* ── Icon palette — pulls from TAB_ICONS where the concept matches, falls
   back to glyphs from the same emoji family for new sidebar-only items. ── */

const ICON = {
    players:     TAB_ICONS.players,                 // 👥
    leagues:     TAB_ICONS.leagues,                 // table/grid SVG
    dashboard:   TAB_ICONS.standings,               // 📊
    table:       TAB_ICONS.leagues,                 // same SVG, scoped to inner row
    records:     TAB_ICONS.records,                 // 📜
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
            <div class="site-nav-flyout-host" data-flyout="players">
                <button class="site-nav-item site-nav-group" data-group="players">
                    <span class="site-nav-icon" aria-hidden="true">${ICON.players}</span>
                    <span class="site-nav-label">Players</span>
                    ${ICON.chevron}
                </button>
                <div class="site-nav-flyout" data-submenu="players" role="menu">
                    <div class="site-nav-flyout-loading">Loading…</div>
                </div>
            </div>

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

            <a class="site-nav-item" href="index.html?tab=records#sections" data-view="records">
                <span class="site-nav-icon" aria-hidden="true">${ICON.records}</span>
                <span class="site-nav-label">Records</span>
            </a>

            <a class="site-nav-item" href="index.html?tab=leaderboard#sections" data-view="leaderboard">
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
                date,
            };
        })
        .filter(l => adminLoggedIn || !l.hidden)
        .sort((a, b) => b.date - a.date);

    populateLeaguesSubmenu(_sidebarEl.querySelector('[data-submenu="leagues-dashboard"]'),
        leaguesAll, leagueUrl, opts.activeView === 'league' ? opts.leagueId : null);
    populateLeaguesSubmenu(_sidebarEl.querySelector('[data-submenu="leagues-table"]'),
        leaguesAll, leagueTableUrl, opts.activeView === 'leagueTable' ? opts.leagueId : null);

    const [meta, allCsvResults] = await Promise.all([
        loadPlayersMetadata().catch(() => ({})),
        Promise.allSettled(leaguesAll.map(l => loadLeagueMatches(l.id))),
    ]);

    const allPlayers = new Set(Object.keys(meta || {}));
    const activeSet = new Set();
    const lastLeagueDate = new Map();   // player → Date of latest league they appeared in
    const playerFlags = {};
    allCsvResults.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return;
        const l = leaguesAll[idx];
        const customFlags = allParams.find(p => p.id === l.id)?.params?.CustomFlags;
        for (const p of r.value.allPlayers) {
            allPlayers.add(p);
            if (l.running) activeSet.add(p);
            if (!playerFlags[p]) playerFlags[p] = getFlagCode(p, customFlags);
            const prev = lastLeagueDate.get(p);
            if (!prev || l.date > prev) lastLeagueDate.set(p, l.date);
        }
    });

    // Three-state status mirrors the landing page's A7 directory: active =
    // playing in a Running league NOW; this-year = appeared in any league this
    // calendar year; inactive = neither. Same labels + colors as .lp-status.
    const currentYear = new Date().getUTCFullYear();
    function statusFor(name) {
        if (activeSet.has(name)) return 'active';
        const last = lastLeagueDate.get(name);
        if (last && last.getUTCFullYear() === currentYear) return 'this-year';
        return 'inactive';
    }

    const rows = [...allPlayers]
        .filter(name => !(meta?.[name]?.hidden))
        .map(name => ({
            name,
            meta: meta?.[name] || {},
            flag: playerFlags[name] || 'IL',
            status: statusFor(name),
            titled: hasTitles(meta?.[name] || {}),
        }))
        .sort((a, b) => {
            if (a.titled !== b.titled) return a.titled ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

    const activePlayerName = (opts.activeView === 'player' || opts.activeView === 'playerLeague') ? opts.playerName : null;
    populatePlayersSubmenu(_sidebarEl.querySelector('[data-submenu="players"]'), rows, activePlayerName);
}

function populateLeaguesSubmenu(container, leagues, urlFn, activeId) {
    if (!container) return;
    if (leagues.length === 0) {
        container.innerHTML = `<div class="site-nav-flyout-loading">No leagues</div>`;
        return;
    }
    container.innerHTML = leagues.map(l => {
        const cls = (l.id === activeId) ? ' active' : '';
        return `<a class="site-nav-flyout-item${cls}" href="${urlFn(l.id)}">
            <span class="site-nav-status-dot ${l.running ? 'running' : 'completed'}" aria-hidden="true"></span>
            <span class="site-nav-flyout-label">${escapeHtml(l.title)}</span>
        </a>`;
    }).join('');
}

function populatePlayersSubmenu(container, rows, activeName) {
    if (!container) return;
    if (rows.length === 0) {
        container.innerHTML = `<div class="site-nav-flyout-loading">No players</div>`;
        return;
    }
    const STATUS_LABEL = { active: 'Active', 'this-year': 'This Year', inactive: 'Inactive' };
    container.innerHTML = rows.map(r => {
        const shown = displayPlayerName(r.name, r.meta);
        const cls = (r.name === activeName) ? ' active' : '';
        const s = r.status || 'inactive';
        const pill = `<span class="lp-status lp-status-${s}"><span class="lp-status-dot"></span>${STATUS_LABEL[s]}</span>`;
        return `<a class="site-nav-flyout-item${cls}" href="${playerUrl(r.name)}" data-player="${escapeAttr(r.name)}">
            <img class="flag" src="${flagUrl(r.flag)}" alt="${escapeAttr(r.flag)}">
            <span class="site-nav-flyout-label">${escapeHtml(shown)}</span>
            ${pill}
        </a>`;
    }).join('');
}

/* ── Interactions: flyout hover + click-pin ──────────────────────────── */

function wireInteractions(sidebar, opts) {
    // CLICK on any flyout-host's trigger pins it open.
    // CLICK outside (anywhere not inside a pinned host) unpins everything.
    sidebar.addEventListener('click', e => {
        const trigger = e.target.closest('.site-nav-group, .site-sidebar-search-trigger');
        if (trigger && sidebar.contains(trigger)) {
            const host = trigger.closest('.site-nav-flyout-host');
            if (host) {
                const wasPinned = host.classList.contains('pinned');
                // Unpin all hosts at the same level first.
                const parent = host.parentElement;
                parent.querySelectorAll(':scope > .site-nav-flyout-host.pinned').forEach(p => p.classList.remove('pinned'));
                if (!wasPinned) host.classList.add('pinned');
                e.preventDefault();
                return;
            }
        }

        // Leaf link tap on mobile closes the drawer.
        const leaf = e.target.closest('a.site-nav-item, a.site-nav-flyout-item');
        if (leaf && isMobile()) closeDrawer();

        // Mobile rail-mode exit: a tap on blank sidebar space (not an
        // interactive control) unpins everything in the nav tree and the
        // sidebar springs back from rail → full width. This is how the
        // user dismisses an open submenu without picking an item.
        //
        // `.site-nav-flyout` is included so ANY click landing inside an open
        // flyout (e.g. theme picker swatches, the Customize button, color
        // inputs, reset) counts as interactive — otherwise interacting with
        // embedded controls that don't carry the standard nav-item classes
        // would collapse the whole pin chain mid-interaction.
        if (isMobile()) {
            const onInteractive = e.target.closest(
                '.site-nav-item, .site-nav-flyout-item, .site-nav-flyout, ' +
                '.site-sidebar-brand, .site-sidebar-search, .site-sidebar-logout, ' +
                '.sidebar-admin-banner'
            );
            if (!onInteractive) {
                sidebar.querySelectorAll('.site-nav-tree .site-nav-flyout-host.pinned')
                    .forEach(p => p.classList.remove('pinned'));
            }
        }
    });

    // Click anywhere outside a pinned host closes the pin.
    document.addEventListener('click', e => {
        if (!sidebar.contains(e.target)) {
            sidebar.querySelectorAll('.site-nav-flyout-host.pinned').forEach(p => p.classList.remove('pinned'));
        }
    });

    // Settings → Theme Customize: mount the picker as a nested flyout's
    // content so it opens like any other sidebar sub-menu (cascade right,
    // hover-or-click-to-pin) instead of as a centered modal. Sibling pinned
    // sub-menus stay open since no JS unpinning runs here.
    const themeFlyout = sidebar.querySelector('[data-submenu="settings-theme"]');
    if (themeFlyout) {
        themeFlyout.replaceChildren(buildThemePickerPanel());
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
    // iOS search-sheet: intercepts taps on any .app-search-input on this page
    // (sidebar search, matchup, What-If). No-op on non-iOS. Idempotent.
    installSearchOverlay();

    const searchHost = sidebar.querySelector('.site-sidebar-search');
    if (searchHost) {
        // The legacy mountSearchInto expects the input + results both inside
        // the same root, which they are (root = .site-sidebar-search).
        mountSearchInto(searchHost);

        // iOS search-sheet adapter: same matcher (searchEntities) as the flyout
        // above, but feeds the 16px overlay. Picking navigates to the entity.
        const sidebarInput = searchHost.querySelector('.site-sidebar-search-input');
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
                        href: preview ? `${leagueUrl(l.id)}&preview=true` : leagueUrl(l.id),
                    });
                }
                for (const p of players) {
                    const leagueCount = p.leagues.filter(l => l.leagueId).length;
                    const hint = leagueCount === 0 ? 'inactive'
                        : leagueCount === 1 ? p.leagues[0].title
                        : `${leagueCount} leagues`;
                    const sub = (p.fullName && p.fullName !== p.name) ? p.fullName : hint;
                    items.push({
                        label: p.name,
                        sublabel: sub,
                        key: 'P:' + p.name,
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
        case 'player':
        case 'playerLeague': return 'players';
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
            <label for="admin-modal-user">Username</label>
            <input type="text" id="admin-modal-user" autocomplete="username">
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
        if (!user || !pass) return showMsg('Please enter username and password.', 'error');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in…';
        const ok = await login(user, pass);
        if (ok) location.href = 'admin.html';
        else { loginBtn.disabled = false; loginBtn.textContent = 'Login'; showMsg('Invalid username or password.', 'error'); }
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
