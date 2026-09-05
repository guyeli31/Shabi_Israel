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
import { buildPlayerFlagIndex } from '../utils/playerFlags.js';
import { buildAllTimeRankings } from '../compute/allTimeRankings.js';
import { colorForValue } from '../compute/colorScale.js';
import { prProbabilityTableHtml } from '../compute/championshipPredictor.js';
import { loadLandingSettings } from '../data/store.js';
import { loadBannerConfig, renderHeroBanner } from './heroBanner.js';
import './privacyNotice.js'; // passive Privacy modal — wires the delegated [data-action="privacy"] trigger + styles
import { leagueUrl, flagUrl, getFlagCode, formatPercent, formatNumber, parseLeagueDate, leagueTableUrl, thLabel,
         leagueLeaderboardSlot, leagueJoinsLeaderboard } from '../utils/helpers.js';
import { exportTableImage } from '../utils/exportTableImage.js';
import { collectLuckMatches, collectPRMatches, topLuckiestMatches, topBestPRMatches } from '../compute/matchRecords.js';
import { luckConfidenceStats } from '../compute/luckConfidence.js';
import { getPopup } from '../data/popupContent.js';
import { getLevel } from '../compute/rankings.js';
import { leagueTypeRank } from '../compute/leagueTypes.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { pinStickyCols, pinStickyColsAll } from '../utils/stickyCols.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { mountSFTable } from '../../table-lab/formats/sf/mount.js';
import { buildCompletedLeaguesPreset } from '../presets/completedLeaguesPreset.js';
import { buildAnnualLeaderboardPreset } from '../presets/annualLeaderboardPreset.js';
import { isLoggedIn } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';
import { addChange, getChangeCount, T } from '../admin/stagingStore.js';
import { landingSettingsPayload } from '../admin/landingSettingsPayload.js';
import { mountAdminSidebar, refreshBadge as refreshSidebarBadge } from '../admin/render/adminSidebar.js';
import { loadPlayersMetadata, loadPlayersRegistry } from '../data/store.js';
import { escapeHtml } from '../utils/sanitize.js';
import { hasTitles, compareTitlePriority, getTitleDescriptionParts } from '../data/titleConstants.js';
import { displayPlayerName, alternateName } from '../utils/nameDisplay.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountPillTabs, ALL_TYPES_ID, ALL_TYPES_TAB } from './subTabs.js';
import { mountSearchField } from '../utils/combobox.js';
import { scrollToClearingTopbarSettled } from '../utils/scrollOffset.js';
import { langFlagsHtml, wireLangPopup } from '../utils/popupLang.js';
import { startSplash, splashStage, endSplash } from '../utils/splash.js';
import { renderErrorScreen, explainError, inlineErrorHtml } from '../utils/errorScreen.js';
import { spliceQueryParam, hasUrlFlag } from '../utils/queryString.js';
import { getMedalPlaces } from '../compute/prizeRows.js';

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

/* ── Main entry ──────────────────────────────────────── */

/** Landing settings loaded once, shared with edit mode. */
let _landingSettings = null;
/** Players metadata loaded once, shared across renderers. */
let _playersMeta = {};
let _playersRegistry = null;
let _flags = buildPlayerFlagIndex([]);
/** Completed-leagues league-type filter (mountPillTabs handle), or null when
 *  only one type exists. Edit mode forces it back to ALL — drag-reorder saves
 *  the order of the VISIBLE rows, so a filtered table would drop leagues. */
let _completedFilter = null;

export async function renderLandingPage() {
    const container = document.getElementById('content');
    startSplash();

    const headerEl = document.getElementById('page-header');
    let heroBanner = null;

    // The hero banner IS the landing header, but it fetches its OWN config over
    // the network and is purely decorative — it must never gate the league list.
    // It used to share a Promise.all with landingSettings, so a slow or stuck
    // banner-config fetch (no-store) froze the ENTIRE page on "Loading leagues…".
    // Now it runs independently: the league list renders from the (instant,
    // cached) landing settings while the banner fills in whenever it resolves.
    // Its loading shimmer plays until the league data is ready (dataReady),
    // regardless of which of the two finishes first — #page-header stays hidden
    // until either the banner resolves or the finally reveals it.
    let resolveDataReady;
    const dataReady = new Promise((r) => { resolveDataReady = r; });
    applyHeroBanner().then((heroBannerEl) => {
        heroBanner = heroBannerEl;
        if (headerEl) headerEl.style.visibility = 'visible';
        if (!heroBanner) return;
        const anim = heroBanner.dataset.loadanim;
        if (anim && anim !== 'none') heroBanner.classList.add('is-loading', 'load-' + anim);
        dataReady.then(() => heroBanner.classList.remove('is-loading'));
    }).catch(() => {
        if (headerEl) headerEl.style.visibility = 'visible';
    });

    try {
        const landingSettings = await loadLandingSettings();
        _landingSettings = landingSettings;
        splashStage('settings');

        // The registry rides in the SAME bundle as the leagues and the metadata
        // (sql/players_registry.sql adds one key to get_site_bundle), so this
        // third entry costs no third round trip — ready() resolves once and all
        // three read from it.
        const [allLeagues, playersMeta, playersRegistry] = await Promise.all([
            loadAllLeagues().then(r => { splashStage('matches'); return r; }),
            loadPlayersMetadata().then(r => { splashStage('players'); return r; }),
            loadPlayersRegistry()
        ]);
        _playersMeta = playersMeta;
        _playersRegistry = playersRegistry;
        // Flag resolver for this page's context-free tables (annual leaderboard,
        // all-time). The per-match record cards (A5 and friends) stay bound to
        // their own league — see utils/playerFlags.js for why the two differ.
        _flags = buildPlayerFlagIndex(allLeagues.filter(l => !l.params.Hidden));
        splashStage('ranking');

        // A hidden league is hidden from EVERYONE on the public site, a logged-in
        // admin included: the admin session is for editing, not for a private
        // preview, and a card that looked identical to a visible one (no "Hidden"
        // marker anywhere on it) made the admin's own view disagree with the
        // public one on the league list AND on every count derived from it —
        // "15 leagues / 25 active players" against the public "14 / 0".
        // The evidence a hidden league exists lives in admin.html (Edit Leagues
        // lists it with a "(Hidden)" badge); `?preview` is no longer the only way
        // to see what the public sees, because this IS what the public sees.
        // `adminLoggedIn` is still read below — edit mode is a genuine admin
        // affordance, unlike seeing the data.
        const adminLoggedIn = isLoggedIn() && !isPreviewMode();
        const leagues = allLeagues.filter(l => !l.params.Hidden);

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
        splashStage('render');
        container.innerHTML = '';

        // Info cards belong with the hero (right under the subtitle), not inside a tab panel.
        renderInfoCards(container, activePlayers.size, allPlayers.size, leagues.length, latestModified);

        // Tabs shell — groups the existing sections into 4 mental buckets.
        const presentTypes = [...new Set(leagues.map(l => l.leagueType))];
        const shell = buildTabsShell();
        shell.root.id = 'sections';
        // Stable per-tab anchors for the sidebar's Leaders / Players links —
        // landing on the PANEL (not shell.root) so the tab strip itself stays
        // scrolled out of view above, same as jumping straight to a specific
        // Records sub-section (see records-* ids below).
        shell.panels.leaders.id = 'leaders-panel';
        shell.panels.players.id = 'players-panel';
        container.appendChild(shell.root);

        // If the URL carries `?tab=` (deep link from the sidebar), scroll
        // the tabs section into view after first paint so the user lands
        // at the section title rather than at the page header. When the URL
        // also carries a section hash (e.g. #records-pr from the Records
        // sub-menu), land that specific section's title at the top instead.
        if (new URLSearchParams(location.search).get('tab')) {
            const hashId = decodeURIComponent(location.hash.replace(/^#/, ''));
            // Strip the hash from the URL bar right away — the browser's own
            // native "scroll to fragment" retry keeps re-firing (with NO
            // awareness of the fixed topbar) for as long as this page keeps
            // loading resources, which can be several seconds after our own
            // corrected scroll already ran, silently overriding it. With no
            // hash left to chase, only our own scrollTo below ever runs.
            if (hashId) history.replaceState(history.state, '', location.pathname + location.search);
            // Achievements / PR Leaders / Match / League records build their
            // tables in a later microtask than the data promise they await
            // (renderAchievementsSection etc. below), so ANY section above the
            // target can still grow taller after we first scroll — a one-shot
            // scroll would land right and then get pushed down. scrollTo…Settled
            // re-asserts until the document height stops changing, so we don't
            // have to predict exactly when every section above finished growing.
            requestAnimationFrame(() => {
                const target = (hashId && document.getElementById(hashId)) || shell.root;
                scrollToClearingTopbarSettled(target);
            });
        }

        // Route renderers to their tab panel — each renderer keeps its existing signature.
        renderActiveLeagues(shell.panels.leagues, running);
        if (completed.length > 0) renderCompletedLeagues(shell.panels.leagues, completed);

        renderLeaderboards(shell.panels.leaders, leaderboards);

        renderAchievementsSection(shell.panels.records, presentTypes);
        renderPRLeadersSection(shell.panels.records, presentTypes);
        renderMatchRecordsSection(shell.panels.records, leagues, presentTypes);
        renderLeagueRecordsSection(shell.panels.records, leagues, presentTypes);

        // Players tab — a single combined SF table (A7): Player / Status /
        // Last Active / Title, sticky Player column. Titled players sort to the
        // top, then alphabetical — "notable" is just a sort key, not a section.
        renderPlayersTab(shell.panels.players, _playersMeta, leagues, _playersRegistry);

        // Themed footer bar (chess.com-style link row): a clickable
        // "Privacy & Analytics" transparency link (opens the modal only on
        // click — see js/render/privacyNotice.js) and a non-interactive
        // "© Built by Guy Eliyahu" credit (© is the all-rights-reserved mark;
        // the separate "All Rights Reserved" text line was removed).
        const footer = document.createElement('footer');
        footer.className = 'site-platform-footer';
        footer.innerHTML = `
            <button type="button" class="site-footer-link" data-action="privacy">Privacy &amp; Analytics</button>
            <span class="site-footer-sep" aria-hidden="true">·</span>
            <span class="site-footer-credit">© Built by Guy Eliyahu - 2026</span>
        `;
        container.appendChild(footer);

        // Auto-enter edit mode if admin and ?edit in URL
        if (adminLoggedIn && hasUrlFlag('edit')) {
            enterEditMode(_landingSettings);
        }
    } catch (err) {
        console.error(err);
        renderErrorScreen(container, {
            ...explainError(err),
            error: err,
            // No "back to leagues" here — this IS the league list.
            actions: [{ label: 'Try again', primary: true, onClick: () => location.reload() }]
        });
    } finally {
        // Signal the banner's loading shimmer to stop (its .then above waits on
        // dataReady, so this works whether the banner resolved before or after
        // the league data), and guarantee the header is visible even if the
        // banner fetch failed or returned null.
        resolveDataReady();
        if (headerEl) headerEl.style.visibility = 'visible';
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
            { id: 'leagues', label: 'Leagues', icon: TAB_ICONS.leagues },
            { id: 'leaders', label: 'Leaders', icon: TAB_ICONS.leaders },
            { id: 'records', label: 'Records', icon: TAB_ICONS.records },
            { id: 'players', label: 'Players', icon: TAB_ICONS.players }
        ],
        urlKey: 'tab',
        // Retired 2026-08 (?tab=leaderboard opened a tab labelled "Leaders").
        aliases: { leaderboard: 'leaders' },
        ariaLabel: 'Home sections',
        shellClass: 'lp-tabs-shell',
        panelClass: 'lp-tab-panel'
    });
}

/* ── Players tab — single combined SF table (titled players sort first) ── */

function renderPlayersTab(container, allMeta, leagues, registry) {
    const allRows = computePlayerRows(allMeta, leagues, registry);
    // One combined table: titled players first, untitled below — each subgroup A→Z.
    const rows = sortPlayerRows(allRows);

    const cols = buildPlayerCols();

    const section = document.createElement('div');
    section.className = 'app-section app-section--card lp-players-section';
    section.innerHTML = `
        <h2 class="app-section-h2">Players</h2>
        <div class="collapsible-body"></div>`;
    container.appendChild(section);
    wireSectionCollapse(section, { defaultOpen: true });

    const body = section.querySelector('.collapsible-body');

    const searchWrap = document.createElement('div');
    searchWrap.className = 'lp-players-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'lp-players-search-input app-search-input';
    searchInput.placeholder = 'Search player…';
    searchInput.autocomplete = 'off';
    searchWrap.appendChild(searchInput);
    body.appendChild(searchWrap);

    const mount = document.createElement('div');
    body.appendChild(mount);

    // Live filter-as-you-type — no dropdown/selection step. While a query is
    // active, showTopN is dropped so every match is visible (the "Show all"
    // toggle only makes sense against the unfiltered default view).
    //
    // Matching is on BOTH names, the canonical rule (see altFor in
    // combobox.js): every row shows the username and the full name side by
    // side, so both must be typeable. Here the pair is already on the row, so
    // the test reads off `name`/`fullName` rather than the display mode — which
    // way round they are RENDERED is a separate decision, made in the Player
    // column below.
    function renderTable(query) {
        const q = query.trim().toLowerCase();
        const filtered = q
            ? rows.filter(r => r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q))
            : rows;

        const { table } = mountSFTable(mount, {
            tableId:   'A7',
            title:     null,
            data:      filtered,
            cols,
            fontClass: 'font-small',
            stickyCols: 1,
            showTopN:  q ? null : 50
        });
        table.classList.add('sf-sticky-1');

        // Right-click context menu on every player-name link (no leagueId → general profile).
        attachPlayerNameInteractions(mount, null);
    }

    // A7 runs on the canonical search field in 'inplace' mode: the RESULTS ARE
    // THE TABLE. There is no dropdown on desktop and no search sheet on touch —
    // every keystroke filters A7 live (onChange), identically on both. The
    // player list this field used to open on touch was a second list of the same
    // players stacked over the one already on screen, and it forced a pick where
    // desktop only ever narrowed the rows.
    //
    // That means this call site passes no suggest/decorate/labelFor: with no
    // list to render, nothing would consume them. The flag, title badges and
    // full name the sheet used to draw are all in the Player column already.
    mountSearchField(searchInput, {
        resultTarget: 'inplace',
        onChange: (value) => renderTable(value),
    });

    renderTable('');
}

/** 3-state player status → label/color map.
 *  active   → currently playing in a Running league         (green)
 *  this-year → played in any league this calendar year       (orange / bronze)
 *  inactive → none of the above                              (gray)
 */
const PLAYER_STATUS_LABEL = { active: 'Active', 'this-year': 'This Year', inactive: 'Inactive' };

function computePlayerRows(allMeta, leagues, registry) {
    // The roster comes from public.players_registry when the database has it
    // (sql/players_registry.sql) — the SAME list mail_orphan_reason consults, so
    // "does this name exist" cannot have two answers. A player is an implied
    // entity here (no players table; a person exists by appearing in a fixture),
    // and while that definition lived in two places they disagreed: this tab
    // counted any league, the mail diagnostics counted only running ones, and a
    // player between seasons was reported to the admin as an unrecognised name.
    //
    // `visibleLeagues` is the site's own rule — a hidden league is hidden from
    // everyone — and metadata-only players stay listed, matching the fallback
    // below exactly. Null registry = a database predating the view; the original
    // client-side derivation then still runs.
    const allNames = new Set(Object.keys(allMeta || {}));
    if (registry) {
        for (const p of registry) if (p.visibleLeagues > 0) allNames.add(p.id);
    } else {
        for (const l of leagues) for (const p of l.allPlayers) allNames.add(p);
    }

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
                titleDescParts: getTitleDescriptionParts(meta),
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
        // Within each subgroup, alphabetical A→Z by the name actually SHOWN —
        // sorting by the username while displaying full names reads as unsorted.
        return displayPlayerName(a.name, a.meta)
            .localeCompare(displayPlayerName(b.name, b.meta), undefined, { sensitivity: 'base' });
    });
}

function buildPlayerCols() {
    return [
        {
            key: 'name',
            label: 'Player',
            tdClass: 'player-cell',
            format: (_, row) => {
                // Both names, in the canonical order: the one "Show name as"
                // asks for is the link, the other is the dim secondary. A7 used
                // to force the username into the link on the grounds that it is
                // the row's identity — but that made the directory the one place
                // on the site where the toggle did nothing, and it is precisely
                // the place a user goes to look someone up by the name they know.
                // The identity is not lost: the link's `data-player` carries the
                // username key either way, so the href and the right-click menu
                // are unaffected by which name is on top.
                const alt = alternateName(row.name, row.meta);
                const altHtml = alt ? ` <span class="lp-realname">${escapeHtml(alt)}</span>` : '';
                // The title description is a SECOND LINE of this cell, not a
                // column of its own (A7's one deliberate departure from the SF
                // canon — see docs/TABLE-DESIGN.md). As a column it was the
                // widest thing in the table, 46% of the width on a 430px phone,
                // while reading "—" on 53 of 56 rows: it forced the horizontal
                // scroll that the shrunken font and the hidden real-name were
                // both working around. As a line under the name it costs zero
                // width on the rows that have no title.
                // One line per title, championships first — a player with both a
                // championship and a BMAB tier reads as two facts, not as one
                // comma-spliced sentence.
                const titleHtml = row.titleDescParts
                    .map(t => `<em class="lp-titledesc">${escapeHtml(t)}</em>`)
                    .join('');
                return `<img class="flag" src="${flagUrl(row.flag)}" alt="${row.flag}">` +
                       `${playerNameLink(row.name, row.meta)}${altHtml}${titleHtml}`;
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
                const href = row.lastActiveLeagueId ? leagueUrl(row.lastActiveLeagueId) : null;
                return href
                    ? `<a class="league-link" href="${href}">${label}</a>`
                    : label;
            },
        },
    ];
}

/* ── Hero banner ──────────────────────────────────────── */

/**
 * Render the designed hero banner into #page-header. The banner is the landing
 * header on every load (public and admin edit mode alike); there is no classic
 * logo/title header any more. Returns the banner element, or null if the config
 * is missing/empty.
 */
let _bannerResizeBound = false;
async function applyHeroBanner() {
    const header = document.getElementById('page-header');
    if (!header) return null;

    const cfg = await loadBannerConfig();
    if (!cfg || !Array.isArray(cfg.els) || cfg.els.length === 0) return null;

    header.classList.add('page-header--banner');
    document.querySelector('.page-container')?.classList.add('has-hero-banner');
    let banner = header.querySelector('.hero-banner');
    if (!banner) {
        header.innerHTML = '';
        banner = document.createElement('div');
        banner.className = 'hero-banner';
        header.appendChild(banner);
    }
    banner.dataset.loadanim = cfg.loadingAnim || 'none';
    renderHeroBanner(banner, cfg);

    if (!_bannerResizeBound) {
        window.addEventListener('resize', () => {
            const b = document.querySelector('#page-header .hero-banner');
            if (b) renderHeroBanner(b, cfg);
        });
        _bannerResizeBound = true;
    }
    return banner;
}

/* ── Admin Edit Mode ──────────────────────────────────── */

let _editModeActive = false;
let _editState = null; // tracks dirty values during edit

function enterEditMode(settings) {
    _editModeActive = true;
    _editState = {
        displayOrder: [...settings.displayOrder],
        // Pending value of A1's order mode. Dragging a completed row turns it
        // on (the drag would otherwise be saved and then discarded by the date
        // sort on the next load); the edit bar's "Sort by date" turns it off.
        completedCustomOrder: settings.completedCustomOrder === true,
        dirty: false
    };

    document.querySelector('.page-container').classList.add('edit-mode');

    // Mount admin sidebar so navigation + Pending badge stay visible while editing
    mountAdminSidebar({ activeView: 'dashboard' });

    // The header is the hero banner (not editable here) — edit mode only
    // reorders leagues. Add drag handles to the league cards + completed table.
    addDragHandles();

    // Show save/cancel bar
    showEditBar();

    // Hide search during edit mode — admin button is not created in edit mode, theme picker stays visible
    document.querySelectorAll('.nav-search, .nav-search-wrapper').forEach(el => el.style.display = 'none');

    // Block in-page navigation while editing — only embedded admin sidebar
    // links should remain functional. Covers .page-container AND .site-nav
    // (whose "Shabi Israel" home link + league dropdown would otherwise
    // navigate away and drop ?edit, exiting edit mode).
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

    // Remove drag handles
    removeDragHandles();

    // Remove save/cancel bar
    const bar = document.querySelector('.edit-bar');
    if (bar) bar.remove();

    // Keep admin sidebar mounted so the admin can navigate back to admin.html.
    // Strip ?edit so a refresh returns to view mode instead of re-entering edit
    // mode — and strip ONLY that. This used to rebuild the URL as pathname+hash,
    // which threw away every other param: `?edit&tab=records` is reachable, so
    // leaving edit mode also silently dropped you back to the first tab.
    if (new URLSearchParams(location.search).has('edit')) {
        history.replaceState(history.state, '', spliceQueryParam('edit', null));
    }

    // Restore search hidden during edit mode
    document.querySelectorAll('.nav-search, .nav-search-wrapper').forEach(el => el.style.display = '');

    if (_editState && _editState._clickGuard) {
        document.removeEventListener('click', _editState._clickGuard, true);
    }

    _editState = null;
}

/**
 * Is the pending edit actually different from what is published?
 *
 * DERIVED, never latched. This used to be `markDirty()`, a one-way switch: any
 * action turned Save on and nothing could turn it off, so an edit that undid
 * itself still offered to save — drag a league and drag it back, or drag one
 * and then press "Sort completed by date", and Save stayed lit over a queue
 * with nothing in it. Comparing against `_landingSettings` (which is itself
 * updated on save) means the button answers the only question it can honestly
 * answer: does anything here differ from the published state?
 *
 * Same two comparisons saveEditChanges() makes, so the button and the save path
 * cannot disagree about whether there is work to do.
 */
function refreshDirty() {
    if (!_editState) return;
    _editState.dirty = landingEditIsDirty(_editState, _landingSettings);
    const saveBtn = document.querySelector('.edit-bar-save');
    if (saveBtn) saveBtn.disabled = !_editState.dirty;
}

/**
 * `order` with every COMPLETED league put back where the published settings had
 * it, and the active-league entries left exactly as they are.
 *
 * DisplayOrder is one flat list of both kinds (active cards first, then the
 * completed table — see syncDisplayOrderFromDOM), and "Sort completed by date"
 * must undo only its own half: an admin who dragged active cards in the same
 * session did not ask for that work to be thrown away too. Which entries are
 * completed is read from the rendered A1 rows, the same source the sync uses.
 *
 * Anything the published order does not mention (a league staged for creation,
 * say) keeps its current position — this must never shorten the list, for the
 * reason syncDisplayOrderFromDOM spells out.
 */
function withPublishedCompletedOrder(order) {
    const completedIds = new Set(
        [...document.querySelectorAll('.completed-leagues-table tbody tr')]
            .map(r => r.dataset.leagueId)
            .filter(Boolean)
    );
    const isCompleted = (entry) => completedIds.has(entry.replace(' - ', ' '));

    // The published positions, restricted to entries this list actually holds.
    const present = new Set(order);
    const publishedCompleted = (_landingSettings?.displayOrder ?? [])
        .filter(e => present.has(e) && isCompleted(e));

    // Walk the current list and refill each completed slot in published order,
    // so the active entries keep their exact indices.
    const queue = [...publishedCompleted];
    const leftovers = order.filter(e => isCompleted(e) && !publishedCompleted.includes(e));
    return order.map(e => (isCompleted(e) ? (queue.shift() ?? leftovers.shift() ?? e) : e));
}

function landingEditIsDirty(edit, published) {
    const orderChanged = JSON.stringify(edit.displayOrder) !== JSON.stringify(published.displayOrder);
    // The order mode changes no title's position, so the order comparison alone
    // cannot see it.
    const modeChanged = edit.completedCustomOrder !== (published.completedCustomOrder === true);
    return orderChanged || modeChanged;
}

/* ── Drag-and-drop league reorder ─────────────────────── */

let _dragSrcRow = null;

function addDragHandles() {
    // Reordering saves the order of the rows on screen — show every league and
    // lock the filter for the duration of edit mode.
    if (_completedFilter) {
        _completedFilter.select(ALL_TYPES_ID);
        _completedFilter.bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
    }

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
    if (_completedFilter) {
        _completedFilter.bar.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
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

    // A completed row was moved by hand, so A1 must stop re-sorting itself by
    // date — otherwise this arrangement is written to the database and then
    // thrown away on the next load, which is what used to happen.
    if (_editState) _editState.completedCustomOrder = true;
    syncDisplayOrderFromDOM();
    refreshDirty();
    updateOrderModeBtn();
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
    refreshDirty();
}

function onCardDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragSrcCard = null;
}

/**
 * Read the current DOM order of league cards + table rows and rebuild _editState.displayOrder.
 * Titles in DisplayOrder use " - " (dash), folder IDs use " " (space).
 *
 * DisplayOrder is not merely an order — it is the landing page's league-DISCOVERY
 * list (loadLeagueOrder() → loadAllLeagueParams(ids)), so an entry dropped here
 * stops being fetched at all and the league disappears from the site while its
 * rows sit untouched in the database. A reorder is a permutation by definition:
 * it must never shorten the list. Anything the DOM sweep failed to identify is
 * therefore appended back in its original relative position rather than lost —
 * a rail against exactly the class of bug that a row losing its data-league-id
 * (the mountMFTable migration) already caused once.
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

    // Re-admit every entry the sweep did not account for, each at the index it
    // held before, so an unrendered/unidentified league keeps its place instead
    // of being deleted from the site.
    const seen = new Set(order);
    const previous = _editState.displayOrder || _landingSettings.displayOrder || [];
    previous.forEach((entry, i) => {
        if (seen.has(entry)) return;
        order.splice(Math.min(i, order.length), 0, entry);
        seen.add(entry);
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
        <button type="button" class="edit-bar-ghost edit-bar-order-mode" hidden>Sort completed by date</button>
        <button class="edit-bar-cancel">Cancel</button>
        <button class="edit-bar-save" disabled>Save Changes</button>`;

    bar.querySelector('.edit-bar-cancel').addEventListener('click', exitEditMode);
    bar.querySelector('.edit-bar-save').addEventListener('click', saveEditChanges);
    // The way BACK from a hand-made A1 order. Without it the first drag is a
    // one-way door: nothing else in the UI can clear completedCustomOrder, and
    // the admin would have to re-drag every completed league into date order to
    // undo one move.
    bar.querySelector('.edit-bar-order-mode').addEventListener('click', () => {
        if (!_editState || !_editState.completedCustomOrder) return;
        _editState.completedCustomOrder = false;
        // Give the completed leagues their PUBLISHED positions back, rather than
        // stamping the date order into DisplayOrder. Two reasons, and the first
        // is what makes Save behave: pressing this straight after a drag now
        // lands on exactly the published state, so Save switches itself back off
        // instead of offering to save a round trip. The second is that with the
        // mode off, the completed half of DisplayOrder is dormant — A1 sorts by
        // date and never reads it — so overwriting it would quietly destroy an
        // arrangement the admin can still get back by turning the mode on again.
        // Active-league cards are untouched: this button's scope is A1.
        _editState.displayOrder = withPublishedCompletedOrder(_editState.displayOrder);
        refreshDirty();
        updateOrderModeBtn();
        // Re-render A1 in date order, then re-attach the drag handles the
        // re-render just destroyed. Deliberately NO syncDisplayOrderFromDOM()
        // here — that would read the date order straight back out of the DOM and
        // undo the restore above.
        if (_completedRerender) {
            _completedRerender();
            removeDragHandles();
            addDragHandles();
        }
    });
    document.body.appendChild(bar);
    updateOrderModeBtn();
}

/** Show the reset button only while A1 is in hand-made order — in date order it
 *  would be a button that does nothing. */
function updateOrderModeBtn() {
    const btn = document.querySelector('.edit-bar-order-mode');
    if (btn) btn.hidden = !(_editState && _editState.completedCustomOrder);
}

async function saveEditChanges() {
    if (!_editState || !_editState.dirty) return;

    // Edit mode only reorders leagues now — title/subtitle/logo live in the banner.
    const orig = _landingSettings;

    // Same predicate the Save button enables itself from, so a click that got
    // through can never queue a write that changes nothing.
    if (!landingEditIsDirty(_editState, orig)) {
        exitEditMode();
        return;
    }

    // Build updated landing_settings.json — preserve title/subtitle/logo as-is,
    // only the league order and A1's order mode change here. Built through the
    // shared payload helper because publish upserts the WHOLE row.
    const newSettings = landingSettingsPayload(orig, {
        DisplayOrder:         _editState.displayOrder,
        CompletedCustomOrder: _editState.completedCustomOrder === true,
    });

    const groupDescription = 'Dashboard updated (order)';
    const groupId = 'dashboard-edit-' + Date.now();

    addChange({
        type: 'update',
        target: T.landingSettings(),
        content: JSON.stringify(newSettings, null, 2),
        description: groupDescription,
        group: groupId,
        groupDescription
    });

    // Update in-memory settings
    _landingSettings = {
        title: newSettings.title,
        subtitle: newSettings.subtitle,
        logoPath: newSettings.logoPath,
        displayOrder: newSettings.DisplayOrder,
        completedCustomOrder: newSettings.CompletedCustomOrder,
    };

    // Refresh admin sidebar badge
    refreshSidebarBadge();

    // Stay in edit mode after save — resync editState against the new published
    // baseline, then let refreshDirty() derive the button state from it rather
    // than switching it off by hand (the two could otherwise disagree).
    _editState.displayOrder = [..._landingSettings.displayOrder];
    _editState.completedCustomOrder = _landingSettings.completedCustomOrder;
    refreshDirty();

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

/** Card order within Active Leagues: Doubling → UBC → Regular — the app-wide
 *  canonical type order, now read from leagueTypeRank() rather than restated
 *  here, so H1 and A1 cannot drift apart.
 *  Stable, so DisplayOrder still decides the order inside each type group. */
function sortActiveLeagues(running) {
    return running
        .map((l, i) => ({ l, i }))
        .sort((a, b) => {
            const ta = leagueTypeRank(a.l.leagueType);
            const tb = leagueTypeRank(b.l.leagueType);
            return ta !== tb ? ta - tb : a.i - b.i;
        })
        .map(x => x.l);
}

function renderActiveLeagues(container, runningInput) {
    const running = sortActiveLeagues(runningInput);

    const section = document.createElement('div');
    section.className = 'app-section app-section--card dash-section';

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
                    <a href="${leagueUrl(l.id)}">${escapeHtml(l.title)}</a>
                </div>
                <div class="league-card-meta">
                    <span class="league-type-pill ${typeClass}">${typeLabel}</span>
                    <span class="status-pill status-running">Running</span>
                </div>
                <div class="league-card-leader">Leader: ${leaderHtml}</div>
            </div>`;
    }

    section.innerHTML = `
        <h2 class="app-section-h2">Active Leagues</h2>
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

/** Re-order + re-render A1 in place. Set by renderCompletedLeagues. */
let _completedRerender = null;

/** Is A1 currently showing the admin's hand-made order rather than the date sort?
 *  Edit mode's pending value wins while editing, so a drag takes effect at once
 *  instead of only after publishing. */
function completedIsCustomOrder() {
    if (_editState) return _editState.completedCustomOrder === true;
    return _landingSettings?.completedCustomOrder === true;
}

/**
 * Sort A1's league list IN PLACE.
 *
 * Default (completedCustomOrder = false): opening date, newest first; a tie on
 * the date falls back to the canonical league-type order (Doubling → UBC →
 * Regular) rather than to whatever order the leagues arrived in.
 *
 * Custom (true): DisplayOrder exactly as stored — the admin dragged these rows
 * and that arrangement is the answer. DisplayOrder holds display TITLES (" - ")
 * while a league is keyed by its folder id (" "), the same mapping
 * syncDisplayOrderFromDOM() does in the other direction. A league missing from
 * DisplayOrder sorts last (it cannot have been placed by hand), and ties inside
 * either bucket still fall through to the date sort, so the order is total.
 */
function sortCompleted(list) {
    const byDate = (a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.monthIndex !== b.monthIndex) return b.monthIndex - a.monthIndex;
        if (a.day !== b.day) return b.day - a.day;
        return leagueTypeRank(a.leagueType) - leagueTypeRank(b.leagueType);
    };

    if (!completedIsCustomOrder()) {
        list.sort(byDate);
        return;
    }

    const order = (_editState?.displayOrder ?? _landingSettings?.displayOrder ?? []);
    const rank = new Map();
    order.forEach((title, i) => rank.set(title.replace(' - ', ' '), i));
    list.sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        return ra !== rb ? ra - rb : byDate(a, b);
    });
}

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
    // Row order, by default: opening date, newest first, with the canonical
    // league-type order (Doubling → UBC → Regular) breaking a tie on the date
    // rather than leaving it to whatever order the leagues arrived in.
    //
    // The admin can override that by DRAGGING rows in edit mode, which is what
    // completedCustomOrder records — see sortCompleted() and
    // sql/landing_completed_custom_order.sql. Sorting happens on every render,
    // not once here, because the flag can flip mid-session (a drag turns it on,
    // "Sort by date" turns it off) and the table has to follow.
    sortCompleted(withDates);

    // Determine default open state: open if any league is from current year (2026+)
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = withDates.some(l => l.year >= currentYear);
    const collapsed = hasCurrentYear ? '' : ' collapsed';

    section.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">Completed Leagues</h2>
            <div class="collapsible-body">
                <div class="completed-leagues-filter"></div>
                <div class="completed-leagues-mount"></div>
            </div>
        </div>`;

    const mountPoint = section.querySelector('.completed-leagues-mount');
    const toRow = (l) => ({
        league:          l.title,
        dateStr:         l.params.IssueDate ? `${l.day} ${l.monthShort} ${l.year}` : `${l.monthShort} ${l.year}`,
        leagueType:      l.leagueType,
        leagueId:        l.id,
        leaderName:      l.leader?.player ?? null,
        leaderHidden:    !!_playersMeta[l.leader?.player]?.hidden,
        leaderFlagCode:  l.leader ? getFlagCode(l.leader.player, l.params.CustomFlags) : null,
        leaderMeta:      l.leader ? _playersMeta[l.leader.player] : null,
    });
    let rows = withDates.map(toRow);

    // Re-order and re-render in place — called when completedCustomOrder flips
    // (a drag turns it on, "Sort by date" turns it off). `withDates` is the one
    // source array; the display rows are rebuilt from it so the two can never
    // disagree about the order.
    _completedRerender = () => {
        sortCompleted(withDates);
        rows = withDates.map(toRow);
        renderTable(activeType);
    };

    // Render (or re-render) the table for one league-type filter. ALL = no filter.
    let activeType = ALL_TYPES_ID;
    function renderTable(typeId) {
        activeType = typeId;
        const shown = typeId === ALL_TYPES_ID ? rows : rows.filter(r => r.leagueType === typeId);
        mountPoint.innerHTML = '';
        const preset = buildCompletedLeaguesPreset({ rows: shown, flagUrl, leagueUrl });
        const { table } = mountMFTable(mountPoint, preset);
        // Preserve legacy class so existing CSS (.completed-leagues-table) continues to apply.
        table.classList.add('completed-leagues-table');

        // Wire context menu on each winner link, mapping row index → leagueId.
        // The same loop re-stamps data-league-id on the <tr>: mountMFTable emits
        // bare rows, and edit mode's syncDisplayOrderFromDOM() identifies a row
        // ONLY by that attribute — without it every completed league was dropped
        // from DisplayOrder on the first drag, which is the page's league-
        // discovery list, so the whole section vanished from the landing page.
        const dataRows = mountPoint.querySelectorAll('tbody tr:not(.avg-row)');
        dataRows.forEach((tr, i) => {
            const leagueId = shown[i]?.leagueId;
            if (leagueId) {
                tr.dataset.leagueId = leagueId;
                attachPlayerNameInteractions(tr, leagueId);
            }
        });
    }

    // League-type filter (shared pill sub-tabs) — ALL is leftmost and the
    // default; only the types actually present get a pill.
    const presentTypes = [...new Set(rows.map(r => r.leagueType))];
    _completedFilter = mountPillTabs(section.querySelector('.completed-leagues-filter'), {
        tabs: [ALL_TYPES_TAB, ...presentTypes.map(t => ({ id: t, label: TYPE_LABELS[t] || t }))],
        defaultId: ALL_TYPES_ID,
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: renderTable,
    });

    // Collapsible toggle (shared) — open when a current-year league exists.
    wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: hasCurrentYear });

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
        // Membership is an explicit per-league setting (Edit League → "Include
        // in Annual Leaderboard"), and the month column comes from IssueDate
        // alone — never from the league name. See leagueLeaderboardSlot() for
        // why the name and StartDate are both untrustworthy here.
        if (!leagueJoinsLeaderboard(l.params)) continue;
        const { year, monthIndex, monthShort } = leagueLeaderboardSlot(l.params);

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
    const playerData = new Map(); // name → { monthly, totalWins/totalPoints, totalGames, prSum, prCount }
    for (const entry of entries) {
        for (const [player, stats] of entry.statsMap) {
            if (!playerData.has(player)) {
                playerData.set(player, {
                    monthly: {},
                    totalWins: 0,
                    totalPoints: 0,
                    totalGames: 0,
                    prSum: 0,
                    prCount: 0
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
        // A leaderboard row is a player, not a match, so it carries the flag
        // they last played under site-wide — not the last one seen INSIDE this
        // year's leagues. A within-year merge could never let a flag lapse back
        // to IL either, since IL is an absence from CustomFlags.
        const flagCode = _flags.latest(player);

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

    // Regroup the (year × type) leaderboards by YEAR, preserving the incoming
    // sort (newest year first; doubling-first within a year). Each year becomes
    // ONE collapsible section whose heading is just the 4-digit year; the league
    // TYPES present that year become pill tabs (the Records league-type pills)
    // that switch the leaderboard table — and its Top-N/Export controls — shown.
    const byYear = new Map(); // year → lb[]
    for (const lb of leaderboards) {
        if (!byYear.has(lb.year)) byYear.set(lb.year, []);
        byYear.get(lb.year).push(lb);
    }

    for (const [year, yearLbs] of byYear) {
        const section = document.createElement('div');
        section.className = 'leaderboard-section';

        // One panel per type. Within a panel the pill-switch reveals: the
        // Top-N + Export controls (the pill sits ABOVE these, right under the
        // year heading), then the leaderboard table.
        const panelsHtml = yearLbs.map((lb, i) => {
            const defaultRows = Math.min(10, lb.rows.length);
            // The ceiling is the table itself — there is no flat cap on top of
            // it, so "Top N" can always reach the last player in the leaderboard.
            const maxAllowed = lb.rows.length;
            return `
                <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${lb.leagueType}">
                    <div class="leaderboard-header-row">
                        <div class="img-export-group">
                            <label class="img-export-label">Top
                                <input class="img-export-rows" type="number"
                                       min="1" max="${maxAllowed}" value="${defaultRows}">
                            </label>
                            <button class="img-export-btn">Export Image</button>
                        </div>
                    </div>
                    <div class="leaderboard-mount"></div>
                </div>`;
        }).join('');

        section.innerHTML = `
            <div class="app-section app-section--card">
                <h2 class="app-section-h2">${year}</h2>
                <div class="achv-tabs"></div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>`;

        // Collapsible toggle (shared) — all years open by default.
        wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: true });

        // Pill switching — shared sub-tabs; show the matching type panel.
        mountPillTabs(section.querySelector('.achv-tabs'), {
            tabs: yearLbs.map(lb => ({ id: lb.leagueType, label: lb.typeName })),
            pillClassFor: (t) => 'league-type-pill type-' + t,
            onSelect: (t) => section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== t);
            }),
        });

        // Build each type's table + wire its export, scoped to its own panel.
        for (const lb of yearLbs) {
            const panel = section.querySelector(`.achv-panel[data-type="${lb.leagueType}"]`);
            const mountPoint = panel.querySelector('.leaderboard-mount');
            // The league type is a pill in the exported header, not words in
            // the title — so the title itself carries only year + "Leaderboard".
            const title = `${lb.year} Leaderboard`;

            // Filter out hidden players up-front (live behaviour: skip entirely)
            const visibleRows = lb.rows
                .filter(row => !_playersMeta[row.player]?.hidden)
                .map(row => ({ ...row, meta: _playersMeta[row.player] }));

            const preset = buildAnnualLeaderboardPreset({
                rows:       visibleRows,
                months:     lb.months,
                isUBC:      lb.isUBC,
                leagueType: lb.leagueType,
                flagUrl,
            });
            const { table } = mountMFTable(mountPoint, preset);
            // Preserve legacy class so existing .leaderboard-table CSS still applies.
            table.classList.add('leaderboard-table');

            // Image export — scoped to this panel's input + table.
            // `max` on a number input only blocks the spinner, not typing, so
            // clamp the typed value back to the row count as it is entered.
            const rowsInput = panel.querySelector('.img-export-rows');
            rowsInput.addEventListener('input', () => {
                const typed = parseInt(rowsInput.value, 10);
                if (Number.isFinite(typed) && typed > lb.rows.length) {
                    rowsInput.value = String(lb.rows.length);
                }
            });
            const exportBtn = panel.querySelector('.img-export-btn');
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentInput = panel.querySelector('.img-export-rows');
                let maxRows = parseInt(currentInput.value, 10);
                if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;
                const cap = lb.rows.length;
                if (maxRows > cap) maxRows = cap;
                const sourceTable = mountPoint.querySelector('table');
                exportLeaderboardImage(sourceTable, title, maxRows, lb.leagueType, lb.typeName);
            });
            // Don't toggle collapsible when interacting with the export controls.
            panel.querySelector('.img-export-group').addEventListener('click', e => e.stopPropagation());

            // Wire context menu on each player name link (sortable table — re-attach after sort).
            attachPlayerNameInteractions(mountPoint);
            const tbody = table.querySelector('tbody');
            new MutationObserver(() => attachPlayerNameInteractions(mountPoint))
                .observe(tbody, { childList: true });
        }

        container.appendChild(section);
    }
}

/* Measure the rank column's rendered width and publish it as
   `--sticky-col-1-width` on the wrapper, so the player column's
   `left:` can lock to it without any hard-coded px (iron rule 12). */
function measureLeaderboardStickyCols(wrapper) {
    const table = wrapper.querySelector('.leaderboard-table');
    pinStickyCols(table, '--sticky-col-1-width', { target: wrapper });
}

// Thin wrapper around the shared exportTableImage() helper. A2 is the
// only caller that uses the maxRows option (the "Top N" numeric input).
function exportLeaderboardImage(sourceTable, title, maxRows, leagueType, typeName) {
    return exportTableImage({
        sourceTable,
        // The type left the title but must stay in the filename — two panels of
        // the same year would otherwise download over each other.
        filename: `${title}_${typeName}_Top${maxRows}`,
        title,
        leagueType,
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
    section.id = 'records-achievements';

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">Achievements</h2>
            <div class="collapsible-body">
                <div class="achv-tabs"></div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    // Collapsible toggle (shared)
    wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: true });

    // League-type switcher (shared pill sub-tabs) — show the matching panel.
    mountPillTabs(section.querySelector('.achv-tabs'), {
        tabs: types.map(t => ({ id: t, label: TYPE_LABELS[t] || t })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => section.querySelectorAll('.achv-panel').forEach(p => {
            p.classList.toggle('hidden', p.dataset.type !== t);
        }),
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
            console.error(err);
            panel.innerHTML = inlineErrorHtml("This achievements table couldn't be loaded", err);
        }
    });
}

function wireLuckInfoPopup(panel, leagueType) {
    wireLangPopup(panel, {
        btn: panel.querySelector(`#luck-info-btn-${leagueType}`),
        popup: panel.querySelector(`#luck-info-popup-${leagueType}`),
        close: panel.querySelector(`#luck-info-close-${leagueType}`),
    });
}

/* Generic wiring for a "?" info popup addressed by a shared id root
   (`<id>-btn` / `<id>-popup` / `<id>-close`). Used by the League Records
   Best/Worst Luck cards. */
function wireLuckInfoPopupById(root, id) {
    wireLangPopup(root, {
        btn: root.querySelector(`#${id}-btn`),
        popup: root.querySelector(`#${id}-popup`),
        close: root.querySelector(`#${id}-close`),
    });
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
                <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
                <div class="popup-lang-en" data-lang="en">${getPopup('luck-percentile').render('en')}</div>
                <div class="popup-lang-he" data-lang="he">${getPopup('luck-percentile').render('he')}</div>
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
    section.id = 'records-pr';

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">PR Leaders</h2>
            <div class="collapsible-body">
                <div class="achv-tabs"></div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: true });

    mountPillTabs(section.querySelector('.achv-tabs'), {
        tabs: types.map(t => ({ id: t, label: TYPE_LABELS[t] || t })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => section.querySelectorAll('.achv-panel').forEach(p => {
            p.classList.toggle('hidden', p.dataset.type !== t);
        }),
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
            console.error(err);
            panel.innerHTML = inlineErrorHtml("This leaders table couldn't be loaded", err);
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
    section.id = 'records-match';

    const panelsHtml = types.map((t, i) => {
        const luck = topLuckiestMatches(collectLuckMatches(leaguesByType[t]));
        const pr   = topBestPRMatches(collectPRMatches(leaguesByType[t]));
        return `
            <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
                ${renderMatchRecordsTables(luck, pr)}
            </div>`;
    }).join('');

    section.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">Match Records</h2>
            <div class="collapsible-body">
                <div class="achv-tabs"></div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: true });

    mountPillTabs(section.querySelector('.achv-tabs'), {
        tabs: types.map(t => ({ id: t, label: TYPE_LABELS[t] || t })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => {
            // No re-measure on switch: the revealed panel's header cells go
            // 0 → n, which is a ResizeObserver notification (stickyCols.js).
            section.querySelectorAll('.achv-panel').forEach(p => p.classList.toggle('hidden', p.dataset.type !== t));
        },
    });

    container.appendChild(section);

    section.querySelectorAll('.achv-table').forEach(t => applyShowTopN(t));
    section.querySelectorAll('.match-records-table').forEach(tbl => {
        const wrap = tbl.closest('.achv-table-wrapper');
        if (wrap) attachStickyShadow(wrap);
    });

    // 3 sticky cols → 2 measured offsets. The observer inside pinStickyCols
    // replaces the old rAF + `resize` pair, which missed both the flag-load
    // reflow and the pill-switch re-reveal (see stickyCols.js).
    pinStickyColsAll(section, '.match-records-table', ['--mr-col1-w', '--mr-col2-w']);
}

function renderMatchRecordsTables(luckRows, prRows) {
    const notHidden = r => !_playersMeta[r.player]?.hidden && !_playersMeta[r.opponent]?.hidden;
    const prCells = r => `<td>${r.prSelf == null ? '—' : formatNumber(r.prSelf)}</td><td>${r.prOpp == null ? '—' : formatNumber(r.prOpp)}</td>`;
    const luckHtml = luckRows.filter(notHidden).map((r, i) => matchRecordRow(i + 1, r, formatNumber(r.luckGap), prCells(r))).join('');
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
                            <th scope="col">Score</th><th scope="col">Result</th><th scope="col">Player PR</th><th scope="col">Opp PR</th>
                            <th scope="col">League</th><th scope="col">Date</th>
                        </tr></thead>
                        <tbody>${luckHtml || '<tr><td colspan="10">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

function matchRecordRow(rank, r, metricCell, extraCells = '') {
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
            ${extraCells}
            <td><a class="league-link" href="${leagueTableUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
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
        // Places per tier INCLUDING that tier's extra prize rows (prizeRows.js),
        // so a two-gold league tints two ranks gold here as it does on its own page.
        const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
            getMedalPlaces(league.params, { gold: 1, silver: 1, bronze: 1 });
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
        // Places per tier INCLUDING that tier's extra prize rows (prizeRows.js),
        // so a two-gold league tints two ranks gold here as it does on its own page.
        const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
            getMedalPlaces(league.params, { gold: 1, silver: 1, bronze: 1 });
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
    section.id = 'records-league';

    const panelsHtml = types.map((t, i) => {
        const winRateRows  = collectLeagueWinRateRecords(leaguesByType[t]);
        const prRows       = collectLeagueRecords(leaguesByType[t]);
        const luckRows     = collectLeagueLuckRecords(leaguesByType[t]);
        const worstRows    = collectLeagueWorstLuckRecords(leaguesByType[t]);
        return `
            <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
                ${renderLeagueRecordsPanel(winRateRows, prRows, luckRows, worstRows, t)}
            </div>`;
    }).join('');

    section.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">League Records</h2>
            <div class="collapsible-body">
                <div class="achv-tabs"></div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    wireSectionCollapse(section.querySelector('.app-section'), { defaultOpen: true });

    mountPillTabs(section.querySelector('.achv-tabs'), {
        tabs: types.map(t => ({ id: t, label: TYPE_LABELS[t] || t })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => {
            section.querySelectorAll('.achv-panel').forEach(p => p.classList.toggle('hidden', p.dataset.type !== t));
        },
    });

    container.appendChild(section);

    // Wire the "?" info popups on the Best/Worst Luck cards (one per league type).
    types.forEach(t => {
        [`lr-luck-best-${t}`, `lr-luck-worst-${t}`].forEach(id => {
            wireLuckInfoPopupById(section, id);
        });
    });

    section.querySelectorAll('.achv-table').forEach(t => applyShowTopN(t));
    section.querySelectorAll('.league-records-table').forEach(tbl => {
        const wrap = tbl.closest('.achv-table-wrapper');
        if (wrap) attachStickyShadow(wrap);
    });

    pinStickyColsAll(section, '.league-records-table', ['--lr-col1-w', '--lr-col2-w']);
}

function collectLeagueLuckRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        // Places per tier INCLUDING that tier's extra prize rows (prizeRows.js),
        // so a two-gold league tints two ranks gold here as it does on its own page.
        const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
            getMedalPlaces(league.params, { gold: 1, silver: 1, bronze: 1 });
        const customFlags = league.params.CustomFlags || {};
        const matchLength = league.params.MatchLength ?? 7;

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            if (_playersMeta[r.player]?.hidden) return;
            const matchRefs = league.matches
                .filter(m => m.playerA === r.player || m.playerB === r.player)
                .map(m => ({ m, matchLength }));
            const lp = luckConfidenceStats({ matchRefs, playerName: r.player });
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
        // Places per tier INCLUDING that tier's extra prize rows (prizeRows.js),
        // so a two-gold league tints two ranks gold here as it does on its own page.
        const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
            getMedalPlaces(league.params, { gold: 1, silver: 1, bronze: 1 });
        const customFlags = league.params.CustomFlags || {};
        const matchLength = league.params.MatchLength ?? 7;

        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;

        played.forEach((r, idx) => {
            if (_playersMeta[r.player]?.hidden) return;
            const matchRefs = league.matches
                .filter(m => m.playerA === r.player || m.playerB === r.player)
                .map(m => ({ m, matchLength }));
            const lp = luckConfidenceStats({ matchRefs, playerName: r.player });
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

/* Shared "?" info popup for the Best/Worst Luck record cards — reuses the exact
   same content as the Luck Percentile card ('luck-percentile' popup). */
function luckRecordInfoHtml(id) {
    return `
        <div class="predictor-info-popup luck-info-popup" id="${id}-popup" hidden>
            <button class="predictor-info-close" id="${id}-close">&times;</button>
            <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
            <div class="popup-lang-en" data-lang="en">${getPopup('luck-percentile').render('en')}</div>
            <div class="popup-lang-he" data-lang="he">${getPopup('luck-percentile').render('he')}</div>
        </div>`;
}

function renderLeagueRecordsPanel(winRateRows, prRows, luckRows, worstRows, type) {
    const winRateHtml = winRateRows.map((r, i) => leagueWinRateRecordRow(i + 1, r)).join('');
    const prHtml    = prRows.map((r, i)    => leaguePRRecordRow(i + 1, r)).join('');
    const luckHtml  = luckRows.map((r, i)  => leagueLuckRecordRow(i + 1, r)).join('');
    const worstHtml = worstRows.map((r, i) => leagueLuckRecordRow(i + 1, r)).join('');
    return `
        <div class="match-records-stack">
            <div class="achv-table-card">
                <h3>Best Win Rate</h3>
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
                <h3>Best PR</h3>
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
                <h3>Best Luck <span class="predictor-tooltip" id="lr-luck-best-${type}-btn">?</span></h3>
                ${luckRecordInfoHtml(`lr-luck-best-${type}`)}
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
                <h3>Worst Luck <span class="predictor-tooltip" id="lr-luck-worst-${type}-btn">?</span></h3>
                ${luckRecordInfoHtml(`lr-luck-worst-${type}`)}
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
            <td><a class="league-link" href="${leagueTableUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
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
            <td><a class="league-link" href="${leagueTableUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
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
            <td><a class="league-link" href="${leagueTableUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}
