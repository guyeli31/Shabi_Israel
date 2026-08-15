/**
 * playerGeneralPage.js — Phase G: cross-league general player profile.
 *
 * URL: player.html?player=<name>
 *
 * Sections:
 *   G2 — Header: name, green-dot (active in Running league), flags
 *   G3 — PR stats (per league type): Total PR + Last 300 PR with year ranking
 *   G6 — Achievements (per league type, tabbed)
 *   G4 — League history table
 *   G5 — Full match history table + filters + PR bar chart
 */

import {
    loadPlayerAcrossLeagues,
    aggregatePR,
    rankAllTime,
    listAllTimeRanking,
    collectMedalsByType,
    listMedalRanking,
    flattenAllMatches,
    loadAllLeagues
} from '../compute/crossLeague.js';
import { loadPlayersMetadata } from '../data/store.js';
import { startSplash, splashStage, endSplash } from '../utils/splash.js';
import { renderErrorScreen, explainError } from '../utils/errorScreen.js';
import { displayPlayerName, alternateName } from '../utils/nameDisplay.js';
import { colorForLevel } from '../compute/colorScale.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import {
    getQueryParam, flagUrl, getFlagCode,
    formatNumber, leagueUrl, playerUrl, getLeagueYear, leagueTableUrl, thLabel,
    parseLeagueDate
} from '../utils/helpers.js';
import {
    collectPlayerBestPR,
    collectPlayerBestLuckFor,
    collectPlayerWorstLuckAgainst,
    collectPlayerBestOpponentPR
} from '../compute/matchRecords.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { drawMultiHistogramRow } from './prCorrelationChart.js';
import { applyLuckPill } from './luckPill.js';
import { luckConfidenceFromItems } from '../compute/luckConfidence.js';
import { getWinProbability, nearestMatchLengthIdx } from '../compute/championshipPredictor.js';
import { renderBreadcrumbs } from './navigation.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountPillTabs, mountLengthSelector, ALL_TYPES_TAB, ALL_TYPES_ID } from './subTabs.js';
import { langFlagsHtml, wireLangPopup, wireDynamicLangPopup } from '../utils/popupLang.js';
import { getPopup, playerGaussianSeriesHtml } from '../data/popupContent.js';
import { getTitleBadgesHtml, getTitleAbbreviationsHtml, getHighestTier } from '../data/titleConstants.js';
import { renderV12Header, buildHeaderTitles, formatJoinedShort } from './playerHeader.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { buildPlayerLeaguesPreset } from '../presets/playerLeaguesPreset.js';
import { buildPlayerTotalLuckPreset, collectPlayerLeagueLuck } from '../presets/playerTotalLuckPreset.js';
import { buildPlayerAllMatchesPreset } from '../presets/playerAllMatchesPreset.js';
import { buildMatchupPreset } from '../presets/matchupPreset.js';
import { buildAllOpponentsPreset, aggregateOpponents } from '../presets/allOpponentsPreset.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { mountSearchField, playerIdentityHtml } from '../utils/combobox.js';
import { createAllTimeLuckSource } from '../utils/playerLuckBadge.js';
import { scrollToClearingTopbar } from '../utils/scrollOffset.js';

const CURRENT_YEAR = new Date().getFullYear();
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

let _allMeta = {};
let _mergedCustomFlags = {};

export async function renderPlayerGeneralPage() {
    const container = document.getElementById('content');
    const playerName = getQueryParam('player');

    if (!playerName) {
        renderErrorScreen(container, {
            title: 'No player selected',
            message: 'This page needs a player name in its address.',
            actions: [{ label: 'Browse players', href: 'index.html?tab=players', primary: true }]
        });
        return;
    }

    startSplash();
    try {
        const [perLeague, allMeta] = await Promise.all([
            loadPlayerAcrossLeagues(playerName).then(r => { splashStage('matches'); return r; }),
            loadPlayersMetadata().then(r => { splashStage('players'); return r; })
        ]);
        splashStage('ranking');
        const meta = allMeta[playerName] || {};
        _allMeta = allMeta;
        const displayName = displayPlayerName(playerName, meta);
        document.title = `${displayName} — Shabi Israel`;

        // Build merged custom flags from all leagues
        _mergedCustomFlags = {};
        for (const e of perLeague) {
            const cf = e.league.params?.CustomFlags;
            if (cf) Object.assign(_mergedCustomFlags, cf);
        }

        // Header (render even with no leagues — inactive player)
        renderHeader(playerName, perLeague, meta);
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: displayName }
        ]);

        splashStage('render');
        container.innerHTML = '';

        // Progressive-disclosure tabs (same chrome as HOME / dashboard via mountAppTabs).
        const shell = mountAppTabs({
            tabs: [
                { id: 'stats',   label: 'Stats',   icon: TAB_ICONS.stats },
                { id: 'leagues', label: 'Leagues', icon: TAB_ICONS.leagues },
                { id: 'matches', label: 'Matches', icon: TAB_ICONS.matches },
                { id: 'h2h',     label: 'H2H',     icon: TAB_ICONS.h2h },
                { id: 'records', label: 'Records', icon: TAB_ICONS.records }
            ],
            urlKey: 'tab',
            // Retired 2026-08 (?tab=statistics opened a tab labelled "Stats").
            aliases: { statistics: 'stats' },
            ariaLabel: 'Player sections',
            shellClass: 'pg-tabs-shell',
            panelClass: 'pg-tab-panel'
        });
        container.appendChild(shell.root);

        // Tab 1 — Statistics: PR stats (G3) + Achievements (G6), both always open.
        const prSection = makePgSection('pg-pr-section', 'PR Statistics');
        shell.panels.stats.appendChild(prSection);
        await renderPRStats(prSection, playerName, perLeague);

        const achSection = makePgSection('pg-achievements', 'Achievements');
        shell.panels.stats.appendChild(achSection);
        await renderAchievements(achSection, playerName, perLeague);

        // Tab 2 — Leagues (G4): single section with a league-type filter, always open.
        const leaguesSection = makePgSection('pg-leagues', 'Leagues');
        shell.panels.leagues.appendChild(leaguesSection);
        renderLeaguesTable(leaguesSection, perLeague);

        // Tab 3 — Matches (G5): Match History (chart + table), open + collapsible.
        const matchesSection = makePgSection('pg-matches', 'Match History', { collapsible: true });
        shell.panels.matches.appendChild(matchesSection);
        renderMatchHistory(matchesSection, playerName, perLeague);

        // Tab 4 — H2H (G5b): two always-open sections —
        //   top = smart search + C3 head-to-head detail,
        //   bottom = "All Opponents (x)" aggregate table (C4).
        const allRows = flattenAllMatches(perLeague);
        if (allRows.length === 0) {
            const empty = makePgSection('pg-h2h-empty', null);
            empty.innerHTML = '<div class="pg-note">No matches played yet.</div>';
            shell.panels.h2h.appendChild(empty);
        } else {
            renderMatchup(shell.panels.h2h, playerName, allRows);
        }

        // Tab 5 — Records: three stacked sections, all collapsible and open by
        // default — Match Records, Total Luck (per completed league), and
        // Total PR ↔ Result (cross-league PR-gap histogram).
        renderPlayerMatchRecords(shell.panels.records, perLeague);
        renderTotalLuckSection(shell.panels.records, playerName, perLeague);
        renderTotalPrResultSection(shell.panels.records, playerName, perLeague);

    } catch (err) {
        console.error(err);
        renderErrorScreen(container, { ...explainError(err, { playerName }), error: err });
    } finally {
        endSplash();
    }
}

/**
 * Build a `.pg-section` for a tab panel. `title` → an <h2> heading (omit for
 * a heading-less section). `collapsible` makes the heading toggle the section
 * open/closed (open by default); hiding is driven by the `.pg-collapsed` class.
 * `headerHtml` is appended inside the heading BEFORE collapse is wired, so a
 * "?" info button in it is picked up by sectionCollapse's info-button rule
 * (click opens the section, never collapses it) instead of toggling it.
 */
function makePgSection(extraClass, title, { collapsible = false, defaultOpen = true, headerHtml = '' } = {}) {
    const section = document.createElement('section');
    // .app-section(+--card) = shared section chrome (css/sections.css);
    // .pg-section + extraClass = page/content-specific styling only.
    section.className = 'app-section app-section--card pg-section ' + extraClass;
    if (title) {
        const h2 = document.createElement('h2');
        h2.className = 'app-section-h2';
        h2.textContent = title;
        if (headerHtml) h2.insertAdjacentHTML('beforeend', headerHtml);
        section.appendChild(h2);
        if (collapsible) wireSectionCollapse(section, { defaultOpen });
    }
    return section;
}

// ---- G2: Header ----

function renderHeader(playerName, perLeague, meta = {}) {
    const title = document.getElementById('page-title');
    if (!title) return;

    // ── Status dot (Active / This year / Inactive) ──
    const inRunning = perLeague.some(e => e.league.params?.Running === true);
    let playedThisYear = false;
    for (const e of perLeague) {
        for (const m of e.playerMatches) {
            const y = m.updatedAt ? new Date(m.updatedAt).getFullYear() : null;
            if (y === CURRENT_YEAR) { playedThisYear = true; break; }
        }
        if (playedThisYear) break;
    }
    const inCurrentYearLeague = perLeague.some(e => getLeagueYear(e.league) === CURRENT_YEAR);
    let statusDotClass, statusDotTitle;
    if (inRunning) {
        statusDotClass = 'pg-dot pg-dot-green';
        statusDotTitle = 'Active in a running league';
    } else if (playedThisYear || inCurrentYearLeague) {
        statusDotClass = 'pg-dot pg-dot-orange';
        statusDotTitle = `Played this year (${CURRENT_YEAR}), not in a running league`;
    } else {
        statusDotClass = 'pg-dot pg-dot-gray';
        statusDotTitle = `Inactive in ${CURRENT_YEAR}`;
    }

    // ── Flag: running league wins; otherwise latest league the player
    //    appeared in (by date). Falls back to default for inactive players. ──
    const dated = perLeague
        .map(e => {
            const d = parseLeagueDate(e.league.id);
            return { e, year: d.year, monthIndex: d.monthIndex };
        })
        .filter(x => x.year != null && x.monthIndex >= 0)
        .sort((a, b) => (a.year - b.year) || (a.monthIndex - b.monthIndex));
    const runningEntry = perLeague.find(e => e.league.params?.Running === true);
    const latestEntry  = dated.length ? dated[dated.length - 1].e : null;
    const flagSourceEntry = runningEntry || latestEntry;
    const flagCode = flagSourceEntry
        ? getFlagCode(playerName, flagSourceEntry.league.params?.CustomFlags)
        : getFlagCode(playerName, {});

    // ── Joined: meta override, else earliest league's month + year ──
    const joinedFormatted = (meta.joined
        ? (() => {
            const [y, m] = String(meta.joined).split('-').map(x => parseInt(x, 10));
            return formatJoinedShort(y, m - 1);
        })()
        : (dated.length ? formatJoinedShort(dated[0].year, dated[0].monthIndex) : '')
    );

    renderV12Header(title, {
        name: playerName,
        fullName: meta.fullName,
        photoPath: meta.photoPath,
        flagCode,
        statusDotClass,
        statusDotTitle,
        titles: buildHeaderTitles(meta),
        joinedFormatted,
        leagueCount: perLeague.length,
    });

    // Tier-based name colour toggles via the h1's class (rules in CSS).
    title.classList.remove('pg-titled', 'pg-titled-gold', 'pg-titled-silver', 'pg-titled-bronze', 'pg-titled-white');
    const highestTier = getHighestTier(meta);
    if (highestTier) title.classList.add(`pg-titled-${highestTier}`);

    // V7 surfaces league count inside the card meta; clear the legacy subtitle.
    const subtitle = document.getElementById('league-subtitle');
    if (subtitle) subtitle.textContent = '';
}

// ---- G3: PR stats ----

async function renderPRStats(section, playerName, perLeague) {
    const PR_TYPE_ORDER = ['doubling', 'regular', 'ubc'];
    const typesWithPR = PR_TYPE_ORDER.filter(t =>
        perLeague.some(e => e.league.config.showPR && e.league.leagueType === t)
    );

    if (typesWithPR.length === 0) {
        section.innerHTML += '<div class="pg-note">No leagues with PR tracking.</div>';
        return;
    }

    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(body);
    const { bar } = mountPillTabs(section, {
        tabs: typesWithPR.map(t => ({ id: t, label: t.toUpperCase() })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => showPRType(body, playerName, perLeague, t),
    });
    section.insertBefore(bar, body);   // bar above body; body already in DOM for the initial render
    wireRankToggles(body, playerName);
}

async function showPRType(body, playerName, perLeague, type) {
    body.innerHTML = '<div class="loading">Loading…</div>';

    const agg = aggregatePR(perLeague, type);
    if (!agg) {
        body.innerHTML = '<div class="pg-note">No data.</div>';
        return;
    }

    const [totalRank, last300Rank] = await Promise.all([
        rankAllTime(playerName, type, 'totalPR'),
        rankAllTime(playerName, type, 'last300PR')
    ]);

    const grid = document.createElement('div');
    grid.className = 'pg-pr-grid';

    const card = document.createElement('div');
    card.className = 'pg-pr-card';
    card.innerHTML = `
        <div class="pg-pr-row">
            <div class="pg-pr-metric">
                <div class="pg-pr-label">Total PR</div>
                <div class="pg-pr-value">${formatNumber(agg.totalPR)}</div>
                ${levelBadge(agg.totalLevel)}
                <div class="pg-pr-rank">${rankToggleHtml(totalRank, { kind: 'pr', type, metric: 'totalPR' })}</div>
            </div>
            <div class="pg-pr-metric">
                <div class="pg-pr-label">Last 300 PR</div>
                <div class="pg-pr-value">${formatNumber(agg.last300PR)}</div>
                ${levelBadge(agg.last300Level)}
                <div class="pg-pr-rank">${rankToggleHtml(last300Rank, { kind: 'pr', type, metric: 'last300PR' })}</div>
            </div>
        </div>
    `;
    grid.appendChild(card);

    const expanded = document.createElement('div');
    expanded.className = 'pg-rank-expanded';
    expanded.hidden = true;

    body.innerHTML = '';
    body.appendChild(grid);
    body.appendChild(expanded);
    wireRankToggles(body, playerName);
}

/**
 * Render either a clickable rank toggle or a dim "no data" placeholder.
 * `meta` describes the underlying ranking source so the click handler can
 * lazily fetch the full ordered list.
 */
function rankToggleHtml(r, meta) {
    const isPR = meta.kind === 'pr';
    const label = 'All-time';
    if (!r) return `<span class="pg-rank-dim">No data</span>`;
    const data = encodeURIComponent(JSON.stringify(meta));
    return `<button type="button" class="pg-rank-toggle" data-rank="${data}">${label}: <b>${ordinal(r.rank)}</b> / ${r.total}</button>`;
}

function wireRankToggles(section, playerName) {
    if (section._rankWired) return;
    section._rankWired = true;
    section.addEventListener('click', async (e) => {
        const btn = e.target.closest('.pg-rank-toggle');
        if (!btn) return;
        // Unified: PR + Achv both expose a shared .pg-rank-expanded as the
        // sibling of their containing grid (.pg-pr-grid / .pg-tiles).
        const grid = btn.closest('.pg-pr-grid, .pg-tiles');
        const expanded = grid?.nextElementSibling;
        if (!expanded || !expanded.classList.contains('pg-rank-expanded')) return;

        // Toggle off if same button already open
        if (!expanded.hidden && expanded.dataset.openBtn === btn.dataset.rank) {
            expanded.hidden = true;
            expanded.dataset.openBtn = '';
            btn.classList.remove('pg-rank-toggle-open');
            return;
        }

        // Close ALL other expanded panels across the entire page (global accordion)
        document.querySelectorAll('.pg-rank-expanded:not([hidden])').forEach(other => {
            if (other !== expanded) {
                other.hidden = true;
                other.dataset.openBtn = '';
            }
        });
        document.querySelectorAll('.pg-rank-toggle-open').forEach(b => {
            if (b !== btn) b.classList.remove('pg-rank-toggle-open');
        });

        btn.classList.add('pg-rank-toggle-open');
        expanded.dataset.openBtn = btn.dataset.rank;
        expanded.hidden = false;
        expanded.innerHTML = '<div class="loading">Loading…</div>';

        const meta = JSON.parse(decodeURIComponent(btn.dataset.rank));
        try {
            let rows;
            if (meta.kind === 'pr') {
                rows = await listAllTimeRanking(meta.type, meta.metric);
            } else if (meta.kind === 'medal') {
                rows = await listMedalRanking(meta.type, meta.metric);
            }
            expanded.innerHTML = renderRankTable(rows || [], playerName, meta);
            attachPlayerNameInteractions(expanded, null);
            applyC0StickyAndScroll(expanded);
        } catch (err) {
            expanded.innerHTML = `<div class="pg-note">Failed to load ranking: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function applyC0StickyAndScroll(expanded) {
    const wrap  = expanded.querySelector('.pg-rank-table-wrap');
    const table = expanded.querySelector('.pg-rank-table');
    if (!wrap || !table) return;
    requestAnimationFrame(() => {
        const th1 = table.querySelector('thead th:nth-child(1)');
        if (th1) {
            const w1 = th1.getBoundingClientRect().width;
            if (w1 > 0) table.style.setProperty('--c0-col1-w', w1 + 'px');
        }
        attachStickyShadow(wrap);
        const selfRow = table.querySelector('tr.pg-rank-self');
        if (selfRow) {
            const rowTop    = selfRow.offsetTop;
            const rowHeight = selfRow.offsetHeight;
            const targetTop = rowTop - (wrap.clientHeight - rowHeight) / 2;
            wrap.scrollTop = Math.max(0, targetTop);
        }
    });
}

function renderRankTable(rows, playerName, meta) {
    if (!rows.length) return '<div class="pg-note">No data.</div>';
    const valueLabel = meta.kind === 'pr'
        ? (meta.metric === 'totalPR' ? 'Total PR' : 'Last 300 PR')
        : (meta.metric === 'gold' ? 'Gold' : meta.metric === 'silver' ? 'Silver' : meta.metric === 'bronze' ? 'Bronze' : meta.metric === 'avgRank' ? 'Avg Rank' : meta.metric === 'winRate' ? 'Win%' : 'Value');
    let html = `<div class="pg-rank-table-wrap"><table class="pg-rank-table font-small" data-mf-table-id="C0"><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Leagues</th><th scope="col">${escapeHtml(valueLabel)}</th></tr></thead><tbody>`;
    for (const r of rows.filter(r => !_allMeta[r.name]?.hidden)) {
        const isSelf = r.name === playerName;
        const valFmt = (meta.kind === 'pr')
            ? formatNumber(r.value)
            : (meta.metric === 'avgRank' ? r.value.toFixed(1)
              : meta.metric === 'winRate' ? (r.value * 100).toFixed(1) + '%'
              : String(r.value));
        const flagCode = getFlagCode(r.name, _mergedCustomFlags);
        const flagHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`;
        const nameHtml = playerNameLink(r.name, _allMeta[r.name]);
        html += `<tr class="${isSelf ? 'pg-rank-self' : ''}"><td>${r.rank}</td><td>${flagHtml} ${nameHtml}</td><td>${r.leagues ?? ''}</td><td>${valFmt}</td></tr>`;
    }
    html += '</tbody></table></div>';
    return html;
}

function levelBadge(level) {
    // Pill convention (like status/league-type pills): tinted fill + the level
    // colour as TEXT. The old solid-fill + white text failed contrast in dark
    // themes, where colorForLevel returns LIGHT colours (tuned for foreground
    // use). Driving both fill and text off the same colour stays readable in
    // every theme/mode since the colour is already light/dark-aware.
    const color = colorForLevel(level);
    return `<span class="pg-level-badge" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">${escapeHtml(level)}</span>`;
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- G6: Achievements ----

async function renderAchievements(section, playerName, perLeague) {
    // League types the player has actually participated in, ordered by participation count
    const typeCounts = {};
    for (const e of perLeague) {
        typeCounts[e.league.leagueType] = (typeCounts[e.league.leagueType] || 0) + 1;
    }
    const types = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);

    if (types.length === 0) {
        section.innerHTML += '<div class="pg-note">No league participation.</div>';
        return;
    }

    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(body);
    const { bar } = mountPillTabs(section, {
        tabs: types.map(t => ({ id: t, label: t.toUpperCase() })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => showAchievementType(body, playerName, t),
    });
    section.insertBefore(bar, body);
}

async function showAchievementType(body, playerName, type) {
    body.innerHTML = '<div class="loading">Loading…</div>';
    const m = await collectMedalsByType(playerName, type);
    if (!m) {
        body.innerHTML = '<div class="pg-note">No data.</div>';
        return;
    }
    const total = m.totalPlayers;
    const tile = (icon, label, rank, valueHtml, subHtml, metric) => `
        <div class="pg-tile-block">
            <div class="pg-tile">
                <div class="pg-tile-title">${icon} ${label} <span class="pg-tile-rank">${rankToggleHtml({ rank, total }, { kind: 'medal', type, metric })}</span></div>
                <div class="pg-tile-value">${valueHtml}</div>
                ${subHtml}
            </div>
        </div>`;
    body.innerHTML = `
        <div class="pg-tiles">
            ${tile('🥇', 'Gold', m.goldRank, m.self.gold, '<div class="pg-tile-sub">&nbsp;</div>', 'gold')}
            ${tile('🥈', 'Silver', m.silverRank, m.self.silver, '<div class="pg-tile-sub">&nbsp;</div>', 'silver')}
            ${tile('🥉', 'Bronze', m.bronzeRank, m.self.bronze, '<div class="pg-tile-sub">&nbsp;</div>', 'bronze')}
            ${tile('🏆', 'Win Rate', m.winRateRank, (m.self.winRate * 100).toFixed(1) + '%', `<div class="pg-tile-sub">${m.self.totalWins}W / ${m.self.totalGames}G</div>`, 'winRate')}
            ${tile('📊', 'Avg Rank', m.avgRankRank, isFinite(m.self.avgRank) ? m.self.avgRank.toFixed(1) : '—', `<div class="pg-tile-sub">${m.self.participations} league${m.self.participations === 1 ? '' : 's'}</div>`, 'avgRank')}
        </div>
        <div class="pg-rank-expanded" hidden></div>
    `;
    wireRankToggles(body, playerName);
}

// ---- G4: League history table ----

function renderLeaguesTable(section, perLeague) {
    if (perLeague.length === 0) {
        section.innerHTML += '<div class="pg-note">No data</div>';
        return;
    }
    const mountPoint = document.createElement('div');
    mountPoint.className = 'pg-leagues-table-wrapper';

    function renderTable(typeId) {
        const shown = typeId === ALL_TYPES_ID
            ? perLeague
            : perLeague.filter(e => e.league.leagueType === typeId);
        mountMFTable(mountPoint, buildPlayerLeaguesPreset({
            perLeague: shown,
            parseLeagueDate,
            enrich: {
                leagueLink: (id, title) => `<a href="${leagueUrl(id)}">${escapeHtml(title)}</a>`,
            },
        }));
    }

    // League-type filter (shared pill sub-tabs) — ALL is leftmost and the
    // default; only the types the player actually played get a pill. Under ALL
    // the PR column shows "—" for REGULAR rows, which record no PR at all.
    const presentTypes = [...new Set(perLeague.map(e => e.league.leagueType))];
    const filterHost = document.createElement('div');
    filterHost.className = 'pg-leagues-filter';
    section.appendChild(filterHost);
    section.appendChild(mountPoint);

    mountPillTabs(filterHost, {
        tabs: [ALL_TYPES_TAB, ...presentTypes.map(t => ({ id: t, label: LEAGUE_TYPE_LABELS[t] || t.toUpperCase() }))],
        defaultId: ALL_TYPES_ID,
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: renderTable,
    });
}

// ---- G5: Match history ----

/**
 * Does this league type record a PR at all? REGULAR leagues log none — that's a
 * property of the league, not a missing value — so PR is not a metric one can
 * even ask for in a REGULAR-only view. Read from the league config so the answer
 * has a single source (compute/leagueTypes.js), not a second hardcoded list.
 */
function typeHasPR(type) {
    return getLeagueConfig({ LeagueType: type }).showPR === true;
}

function renderMatchHistory(section, playerName, perLeague) {
    const allRows = flattenAllMatches(perLeague);
    if (allRows.length === 0) {
        section.innerHTML += '<div class="pg-note">No matches played yet.</div>';
        return;
    }

    const years = [...new Set(allRows.map(r => r.year).filter(y => y != null))].sort((a, b) => b - a);
    const presentTypes = [...new Set(allRows.map(r => r.leagueType))];

    // League-type filter — the shared pill sub-tabs, identical to the Leagues
    // tab (G4). It governs the WHOLE section (chart and table alike), so it sits
    // above the chart card rather than inside its control row. Mounted at the
    // end of this function (selecting fires a render immediately), but appended
    // here so the DOM order is filter → chart → table.
    const filterHost = document.createElement('div');
    filterHost.className = 'pg-matches-filter';
    section.appendChild(filterHost);

    let typeFilter = ALL_TYPES_ID;

    const controls = document.createElement('div');
    controls.className = 'dash-controls';

    const yearSel = document.createElement('select');
    yearSel.innerHTML =
        '<option value="all">All years</option>' +
        years.map(y => `<option value="${y}"${y === CURRENT_YEAR ? ' selected' : ''}>${y}</option>`).join('');
    if (!years.includes(CURRENT_YEAR)) yearSel.value = 'all';

    const countSel = document.createElement('select');
    countSel.innerHTML =
        '<option value="all">All</option>' +
        [5, 10, 20, 50].map(n => `<option value="${n}">Last ${n}</option>`).join('');

    const metricSel = document.createElement('select');
    metricSel.innerHTML = '<option value="pr">PR</option><option value="luck">Luck</option>';
    const prOption = metricSel.querySelector('option[value="pr"]');

    function inlineLbl(text) {
        const l = document.createElement('label');
        l.textContent = text;
        return l;
    }
    // Metric label + select travel together: when PR drops out of the view the
    // pair is hidden as one.
    const metricCtl = document.createElement('span');
    metricCtl.className = 'pg-metric-ctl';
    metricCtl.appendChild(inlineLbl('Metric:'));
    metricCtl.appendChild(metricSel);

    controls.appendChild(inlineLbl('Year:'));
    controls.appendChild(yearSel);
    controls.appendChild(inlineLbl('Games:'));
    controls.appendChild(countSel);
    controls.appendChild(metricCtl);

    // What the player last picked for themselves — restored whenever PR becomes
    // available again (see syncMetricControl).
    let preferredMetric = metricSel.value;

    /** The league types the current pill selection actually puts on screen. */
    function typesInView() {
        return typeFilter === ALL_TYPES_ID ? presentTypes : [typeFilter];
    }

    /**
     * PR is offerable only while the view still contains a PR-recording league
     * type — so a REGULAR-only player (whose ALL is REGULAR) and a mixed player
     * filtered down to REGULAR both lose it. Luck is then the only metric left,
     * and a one-option select isn't a choice, so the control steps aside whole.
     */
    function syncMetricControl() {
        const hasPR = typesInView().some(typeHasPR);
        prOption.hidden = !hasPR;
        prOption.disabled = !hasPR;
        // Luck is forced while PR is unavailable, but the player's own last
        // choice comes back the moment a PR-recording type is in view again —
        // a filter detour shouldn't quietly change what they were looking at.
        metricSel.value = hasPR ? preferredMetric : 'luck';
        metricCtl.hidden = !hasPR;
    }

    const chartCard = document.createElement('div');
    chartCard.className = 'chart-panel';
    chartCard.appendChild(controls);

    const chartHost = document.createElement('div');
    chartHost.className = 'pg-chart-host';
    chartCard.appendChild(chartHost);
    section.appendChild(chartCard);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'pg-matches-table-wrapper';
    section.appendChild(tableWrap);

    function applyFilters() {
        const yv = yearSel.value;
        const cv = countSel.value;
        let filtered = allRows.filter(r => {
            if (yv !== 'all' && r.year !== parseInt(yv, 10)) return false;
            if (typeFilter !== ALL_TYPES_ID && r.leagueType !== typeFilter) return false;
            return true;
        });
        // Apply game count limit (data is already sorted by date desc)
        if (cv !== 'all') {
            const limit = parseInt(cv, 10);
            filtered = filtered.slice(0, limit);
        }
        return filtered;
    }

    function renderAll() {
        const rows = applyFilters();
        renderTable(tableWrap, rows);

        // Bar chart — every non-technical played match gets a slot, chronological
        // asc. REGULAR matches are kept (the player did play them, and dropping
        // them would silently renumber the X axis), but they carry no PR/Luck, so
        // their slot stays empty and they're excluded from the moving average —
        // drawPlayerBarChart handles both from the null values.
        const chartMatches = rows
            .filter(r => !r._technical)
            .sort((a, b) => {
                const at = a.matchDate ? new Date(a.matchDate).getTime() : 0;
                const bt = b.matchDate ? new Date(b.matchDate).getTime() : 0;
                if (at !== bt) return at - bt;
                return b.leagueOrderIdx - a.leagueOrderIdx;
            })
            // A PR that reached us on a REGULAR-league row is not a rating this
            // league keeps (the table prints "—" for exactly that reason), so
            // the chart must not draw it either — under ALL it would otherwise
            // sneak into the bars and the moving average.
            .map(r => typeHasPR(r.leagueType) ? r : { ...r, prSelf: null, prOpp: null });
        // With nothing rated in view every slot would be blank, so fall back to a
        // note rather than an empty grid (e.g. filtering down to REGULAR only).
        const metricKey = metricSel.value === 'luck' ? 'luckSelf' : 'prSelf';
        const ratedCount = chartMatches.filter(r => r[metricKey] != null).length;
        if (chartMatches.length > 0 && ratedCount > 0) {
            drawPlayerBarChart(chartHost, chartMatches, metricSel.value, Math.max(chartMatches.length, 1));
        } else {
            chartHost.innerHTML = `<div class="pg-note">No ${metricSel.value === 'luck' ? 'Luck' : 'PR'} data for current filters.</div>`;
        }
    }

    function renderTable(host, rows) {
        const preset = buildPlayerAllMatchesPreset({
            rows,
            enrich: {
                leagueLink: (id, title) => `<a href="${leagueUrl(id)}">${escapeHtml(title)}</a>`,
                opponentCell: (name) => {
                    const flagHtml = _allMeta[name]?.hidden
                        ? ''
                        : `<img class="flag" src="${flagUrl(getFlagCode(name, _mergedCustomFlags))}" alt="flag">`;
                    return `${flagHtml} ${playerNameLink(name, _allMeta[name])}`;
                },
            },
        });
        mountMFTable(host, preset);
        attachPlayerNameInteractions(host, null);
    }

    yearSel.addEventListener('change', renderAll);
    countSel.addEventListener('change', renderAll);
    metricSel.addEventListener('change', () => {
        preferredMetric = metricSel.value;
        renderAll();
    });

    // ALL is leftmost and the default; only the types the player actually played
    // get a pill. Selecting fires onSelect once on mount, which does the first
    // render — hence no separate renderAll() call here.
    mountPillTabs(filterHost, {
        tabs: [ALL_TYPES_TAB, ...presentTypes.map(t => ({ id: t, label: LEAGUE_TYPE_LABELS[t] || t.toUpperCase() }))],
        defaultId: ALL_TYPES_ID,
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (id) => {
            typeFilter = id;
            syncMetricControl();
            renderAll();
        },
    });
}

// ---- G5b: H2H tab — smart search + C3 detail (top) and C4 all-opponents (bottom) ----

function renderMatchup(panel, playerName, allRows) {
    const LIMIT = 10;

    // ── Top section: smart search + C3 head-to-head detail (always open) ──
    const topSection = makePgSection('pg-h2h-search', 'Head-to-Head Lookup');
    const body = document.createElement('div');
    body.className = 'matchup-body';
    topSection.appendChild(body);
    panel.appendChild(topSection);

    // ── Bottom section: All Opponents (x) aggregate table (C4, always open) ──
    const opponents = aggregateOpponents(allRows);
    const bottomSection = makePgSection('pg-h2h-all', `All Opponents (${opponents.length})`, {
        headerHtml: ' <span class="predictor-tooltip" id="pg-h2h-luck-info-btn">?</span>',
    });
    // The table's Luck column is the Luck Confidence percentile D, so the "?"
    // carries the SAME explanation as everywhere else that metric appears —
    // the landing page's Best/Worst Luck records and the Records tab's Total
    // Luck section. Single source: the 'luck-percentile' popup in
    // popupContent.js; both language blocks ship inline and the flag bar only
    // flips which one is visible.
    bottomSection.insertAdjacentHTML('beforeend', `
        <div class="predictor-info-popup" id="pg-h2h-luck-info-popup" hidden>
            <button class="predictor-info-close" id="pg-h2h-luck-info-close">&times;</button>
            <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
            <div class="popup-lang-en" data-lang="en">${getPopup('luck-percentile').render('en')}</div>
            <div class="popup-lang-he" data-lang="he">${getPopup('luck-percentile').render('he')}</div>
        </div>`);
    const h2hLuckPopup = bottomSection.querySelector('#pg-h2h-luck-info-popup');
    wireLangPopup(h2hLuckPopup, {
        btn: bottomSection.querySelector('#pg-h2h-luck-info-btn'),
        popup: h2hLuckPopup,
        close: bottomSection.querySelector('#pg-h2h-luck-info-close'),
    });
    const c4Mount = document.createElement('div');
    c4Mount.className = 'c4-table-wrapper';
    bottomSection.appendChild(c4Mount);
    panel.appendChild(bottomSection);

    // Selector row (smart search — no "vs." label anymore)
    const selectorRow = document.createElement('div');
    selectorRow.className = 'matchup-selector-row';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'matchup-search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'matchup-search-input app-search-input';
    input.placeholder = 'Search opponent…';
    input.autocomplete = 'off';

    inputWrap.appendChild(input);   // mountSearchField wraps it + owns the list

    const badge = document.createElement('span');
    badge.className = 'matchup-count-badge';
    badge.hidden = true;

    selectorRow.appendChild(inputWrap);

    const resultsArea = document.createElement('div');   // C3 mounts here

    body.appendChild(selectorRow);
    body.appendChild(badge);
    body.appendChild(resultsArea);

    // Mount C4 immediately — it's built synchronously from allRows.
    const flagFor = (name) => _allMeta[name]?.hidden
        ? ''
        : `<img class="flag" src="${flagUrl(getFlagCode(name, _mergedCustomFlags))}" alt="flag">`;
    const opponentSuffix = (name) => _allMeta[name]?.hidden
        ? ''
        : getTitleAbbreviationsHtml(_allMeta[name]);
    mountMFTable(c4Mount, buildAllOpponentsPreset({ opponents, enrich: { flagFor, opponentSuffix } }));

    // Clicking an opponent in C4 opens the C3 detail above it and jumps
    // straight to that lookup section — NOT the page top (window.scrollTo
    // top:0 landed at the page header/hero above it, one section too high,
    // and ignored the fixed topbar besides).
    c4Mount.addEventListener('click', (e) => {
        const link = e.target.closest('.c4-opp-link');
        if (!link) return;
        const name = link.dataset.name;
        input.value = name;
        combo.close();
        renderResults(name);
        requestAnimationFrame(() => scrollToClearingTopbar(topSection, { behavior: 'smooth' }));
    });

    // Smart-search opponent list spans every league (lets you search anyone).
    // Sort by the DISPLAYED name (displayPlayerName), not the raw username key:
    // in "full name" mode the dropdown shows full names, so a key-order sort read
    // as unsorted. Same fix as the What-If picker (dashboardPage.js).
    const byOpponentDisplay = (a, b) =>
        displayPlayerName(a, _allMeta[a]).localeCompare(displayPlayerName(b, _allMeta[b]));
    let allOpponents = opponents.map(o => o.opponent).sort(byOpponentDisplay);
    loadAllLeagues().then(leagues => {
        const playerSet = new Set();
        for (const l of leagues) {
            for (const p of l.allPlayers) {
                if (p !== playerName) playerSet.add(p);
            }
        }
        allOpponents = [...playerSet].sort(byOpponentDisplay);
    }).catch(() => { /* keep the faced-opponents fallback */ });

    function selectOpponent(name) {
        // The DISPLAY name, not the raw key: the row you clicked showed the
        // full name when the "Show name as" toggle is on, and the field snapping
        // back to the username read as the pick having silently changed.
        input.value = displayPlayerName(name, _allMeta[name]);
        combo.close();
        // Analytics: the H2H opponent picker is an in-place update (not a link
        // navigation), and this is the single chokepoint for desktop dropdown,
        // mobile sheet and Enter-key selection alike — so track the chosen
        // opponent here (🆚 icon). Public league data, same as "Player link:".
        window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `H2H: vs ${name}` } }));
        renderResults(name);
    }

    // The opponent picker runs on the ONE canonical search field
    // (mountSearchField) like every other player search in the project, instead
    // of the hand-rolled list it used to carry: flags + title badges on each
    // row, the full opponent list browsable on focus (no "type ≥1 char first"),
    // keyboard nav, and the mobile 16px sheet all come from the shared base.
    const combo = mountSearchField(input, {
        getOptions: () => allOpponents,
        labelFor: (p) => displayPlayerName(p, _allMeta[p]),
        // The second name — shown beside the primary one and matched by the
        // filter. This search used to compute it locally as a `sublabel`; it is
        // canonical now, so every picker gets the same two-name behaviour.
        altFor: (p) => alternateName(p, _allMeta[p]),
        // Hidden players carry neither flag nor title anywhere else on this
        // page (see the C4 table's flagFor/opponentSuffix) — same here.
        decorate: (p) => (_allMeta[p]?.hidden
            ? {}
            : {
                flagCode: getFlagCode(p, _mergedCustomFlags),
                titleHtml: getTitleAbbreviationsHtml(_allMeta[p]),
            }),
        // The chosen opponent stays in the field while their results render
        // below, so the field keeps their flag + titles.
        identity: true,
        // …and re-entering the field browses all 55 opponents again rather than
        // filtering to the one already chosen.
        browseOnOpen: true,
        onPick: (name) => selectOpponent(name),
    });

    function renderResults(opponent) {
        if (!opponent) {
            resultsArea.innerHTML = '';
            badge.hidden = true;
            return;
        }

        const rows = allRows.filter(r => r.opponent === opponent);
        const count = rows.length;

        // W-L summary
        const selfWins = rows.filter(r => r.scoreSelf > r.scoreOpp).length;
        const oppWins  = rows.filter(r => r.scoreOpp  > r.scoreSelf).length;
        let headToHead = '';
        if (count > 0) {
            if (selfWins === oppWins)      headToHead = `Tied ${selfWins}–${oppWins}`;
            else if (selfWins > oppWins)   headToHead = `${playerName} leads ${selfWins}–${oppWins}`;
            else                           headToHead = `${opponent} leads ${oppWins}–${selfWins}`;
        }

        const matchText   = count === 0 ? '0 matches' : `${count} match${count === 1 ? '' : 'es'}`;
        const summaryText = headToHead ? ` · ${headToHead}` : '';
        badge.textContent = matchText + summaryText;
        badge.hidden = false;

        if (count === 0) {
            resultsArea.innerHTML =
                `<div class="matchup-empty">` +
                `<strong>${escapeHtml(playerName)} &amp; ${escapeHtml(opponent)} haven't faced each other yet</strong>` +
                `They appear in different leagues but have never been scheduled against each other.` +
                `</div>`;
            return;
        }

        // Sort newest first
        const sorted = [...rows].sort((a, b) => {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bt - at;
        });

        resultsArea.innerHTML = '';
        const mountPoint = document.createElement('div');
        mountPoint.className = 'matchup-table-wrapper';
        resultsArea.appendChild(mountPoint);

        const preset = buildMatchupPreset({
            rows: sorted,
            playerName,
            opponent,
            enrich: {
                leagueLink: (id, title) => `<a href="${leagueUrl(id)}">${escapeHtml(title)}</a>`,
                // Winner cell identity — the canonical chip, so the name in the
                // table reads like the row you picked it from. Hidden players
                // carry neither flag nor title here either (same rule as the
                // picker and the C4 opponents table above).
                playerIdentity: (name) => {
                    const meta = _allMeta[name];
                    const hidden = !!meta?.hidden;
                    return playerIdentityHtml({
                        name: displayPlayerName(name, meta),
                        flagCode: hidden ? '' : getFlagCode(name, _mergedCustomFlags),
                        titleHtml: hidden ? '' : getTitleAbbreviationsHtml(meta),
                    });
                },
            },
        });
        mountMFTable(mountPoint, preset);
    }
}

// ---- helpers ----

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ---- Match Records (per-player best PR + luck highlights) ----

const MR_TYPE_LABELS = { doubling: 'Doubling', ubc: 'UBC' };
const MR_MONTH_SHORT = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
];

function renderPlayerMatchRecords(container, perLeague) {
    // Only league types with PR/Luck: doubling, ubc.
    const typeCounts = {};
    for (const e of perLeague) {
        const t = e.league.leagueType;
        if (t === 'doubling' || t === 'ubc') {
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
    }
    const types = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
    if (types.length === 0) return;

    const section = makePgSection('pg-match-records', 'Match Records', { collapsible: true });
    container.appendChild(section);

    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(body);
    const { bar } = mountPillTabs(section, {
        tabs: types.map(t => ({ id: t, label: MR_TYPE_LABELS[t] || t.toUpperCase() })),
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: (t) => showMatchRecordsType(body, perLeague, t),
    });
    section.insertBefore(bar, body);

    let _pgMrRafId;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(_pgMrRafId);
        _pgMrRafId = requestAnimationFrame(() => applyPgMrTableStickyOffsets(body));
    });
}

function showMatchRecordsType(body, perLeague, type) {
    const bestPR   = collectPlayerBestPR(perLeague, type);
    const bestLuck = collectPlayerBestLuckFor(perLeague, type);
    const worstLuck = collectPlayerWorstLuckAgainst(perLeague, type);
    const bestOppPR = collectPlayerBestOpponentPR(perLeague, type);

    body.innerHTML = `
        <div class="match-records-stack">
            ${renderPlayerRecordTable('Best PR', 'PR', bestPR)}
            ${renderPlayerRecordTable('Best Luck For', 'Luck Gap', bestLuck)}
            ${renderPlayerRecordTable('Worst Luck Against', 'Luck Gap', worstLuck)}
            ${renderPlayerRecordTable('Best Opponent PR', 'Opp PR', bestOppPR)}
        </div>`;

    body.querySelectorAll('table.pg-mr-table').forEach(t => applyShowTopN(t, 5));
    body.querySelectorAll('.pg-mr-table').forEach(tbl => {
        const wrap = tbl.closest('.achv-table-wrapper');
        if (wrap) attachStickyShadow(wrap);
    });
    requestAnimationFrame(() => applyPgMrTableStickyOffsets(body));
}

function applyPgMrTableStickyOffsets(root) {
    root.querySelectorAll('.pg-mr-table').forEach(table => {
        const th1 = table.querySelector('thead th:nth-child(1)');
        if (!th1) return;
        const w1 = th1.getBoundingClientRect().width;
        if (w1 > 0) table.style.setProperty('--pg-col1-w', w1 + 'px');
    });
}

/* Show-top-N: hide rows beyond N and add a Show all / Show top N toggle.
   Mirrors the helper in landingPage.js. CSS classes (.show-more-btn, .table-row-hidden) are
   defined locally in player-general.css since this page does not load index-dashboard.css. */
function applyShowTopN(tableEl, defaultN = 5) {
    const tbody = tableEl.querySelector('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= defaultN) return;

    rows.forEach((row, i) => {
        if (i >= defaultN) row.classList.add('table-row-hidden');
    });

    const wrapper = tableEl.closest('.pg-matches-table-wrapper, .achv-table-wrapper, .table-wrapper');
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
        if (wrapper) wrapper.style.maxHeight = isCollapsed ? 'none' : savedMaxH;
    });

    // Remove any stale button from a previous render of the same table FIRST,
    // so the captured `insertBefore` reference is still a live child of the parent.
    const anchor = wrapper || tableEl;
    const stale = anchor.nextElementSibling;
    if (stale && stale.classList.contains('show-more-btn')) stale.remove();

    const insertParent = wrapper ? wrapper.parentNode : tableEl.parentNode;
    const insertBefore = wrapper ? wrapper.nextSibling : tableEl.nextSibling;

    if (insertParent) insertParent.insertBefore(btn, insertBefore);
}

function renderPlayerRecordTable(title, metricLabel, rows) {
    const bodyHtml = rows.map((r, i) => playerMatchRecordRow(i + 1, r)).join('');
    return `
        <div class="achv-table-card">
            <h3>${title}</h3>
            <div class="achv-table-wrapper">
                <table class="achv-table pg-mr-table" data-mf-table-id="C5">
                    <thead><tr>
                        <th scope="col">#</th><th scope="col">${metricLabel}</th><th scope="col">Opponent</th>
                        <th scope="col">Score</th><th scope="col">Result</th><th scope="col">League</th><th scope="col">Date</th>
                    </tr></thead>
                    <tbody>${bodyHtml || '<tr><td colspan="7" class="na">No data</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
}

function playerMatchRecordRow(rank, r) {
    const opponentFlag = _allMeta[r.opponent]?.hidden ? null : flagUrl(getFlagCode(r.opponent, r.customFlags));
    const resultClass = r.result === 'W' ? 'result-win'
                      : r.result === 'L' ? 'result-loss'
                      : 'result-draw';
    return `
        <tr>
            <td>${rank}</td>
            <td>${formatNumber(r.metric)}</td>
            <td>${opponentFlag ? `<img class="flag" src="${opponentFlag}" alt="flag">` : ''} ${playerNameLink(r.opponent, _allMeta[r.opponent])}</td>
            <td>${r.scoreSelf}-${r.scoreOpp}</td>
            <td><span class="${resultClass}">${r.result}</span></td>
            <td><a class="league-link" href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
}

// ---- Total Luck (C6) — one row per completed league, cross-league ----

/**
 * "Total Luck": the player's Luck Confidence percentile in every COMPLETED
 * league they finished, in the same MF shape as C1 (Leagues). Pills narrow to
 * one PR-tracking league type; ALL pools them. Regular leagues never appear —
 * they record no PR, so there is no model to be lucky against.
 */
function renderTotalLuckSection(container, playerName, perLeague) {
    const rows = collectPlayerLeagueLuck(perLeague, playerName);
    if (rows.length === 0) return;

    const section = makePgSection('pg-total-luck', 'Total Luck', {
        collapsible: true,
        headerHtml: ' <span class="predictor-tooltip" id="pg-luck-info-btn">?</span>',
    });
    // Same luck-metric explanation as the landing "Luck Percentile" card and the
    // Records tab's Best/Worst Luck records — single source: the 'luck-percentile'
    // popup in popupContent.js. Both language blocks ship inline; the flag bar
    // only flips which is visible.
    section.insertAdjacentHTML('beforeend', `
        <div class="predictor-info-popup" id="pg-luck-info-popup" hidden>
            <button class="predictor-info-close" id="pg-luck-info-close">&times;</button>
            <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
            <div class="popup-lang-en" data-lang="en">${getPopup('luck-percentile').render('en')}</div>
            <div class="popup-lang-he" data-lang="he">${getPopup('luck-percentile').render('he')}</div>
        </div>`);
    container.appendChild(section);

    const infoPopup = section.querySelector('#pg-luck-info-popup');
    wireLangPopup(infoPopup, {
        btn: section.querySelector('#pg-luck-info-btn'),
        popup: infoPopup,
        close: section.querySelector('#pg-luck-info-close'),
    });

    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(body);

    const mountPoint = document.createElement('div');
    mountPoint.className = 'pg-leagues-table-wrapper';
    body.appendChild(mountPoint);

    function showType(typeId) {
        const shown = typeId === ALL_TYPES_ID ? rows : rows.filter(r => r._type === typeId);
        if (shown.length === 0) {
            mountPoint.innerHTML = '<div class="pg-note">No completed leagues of this type.</div>';
            return;
        }
        mountMFTable(mountPoint, buildPlayerTotalLuckPreset({
            rows: shown,
            enrich: {
                leagueLink: (id, title) => `<a href="${leagueUrl(id)}">${escapeHtml(title)}</a>`,
            },
        }));
    }

    const presentTypes = [...new Set(rows.map(r => r._type))];
    const { bar } = mountPillTabs(section, {
        tabs: [ALL_TYPES_TAB, ...presentTypes.map(t => ({ id: t, label: LEAGUE_TYPE_LABELS[t] || t.toUpperCase() }))],
        defaultId: ALL_TYPES_ID,
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: showType,
    });
    section.insertBefore(bar, body);
}

// ---- Total PR ↔ Result — cross-league PR-gap histogram, split by result ----

// Below this many matches a sample mean/std isn't a meaningful summary — the
// Gaussian-fit toggle is disabled and says so instead of fitting a curve to
// one or two points. Same threshold as the dashboard's correlation rows.
const PG_MIN_GAUSSIAN_N = 5;

const PR_RESULT_SERIES = [
    { key: 'wins',   label: 'Wins',   color: '--color-win',   pick: r => r.win === true },
    { key: 'losses', label: 'Losses', color: '--color-loss',  pick: r => r.win === false },
    { key: 'all',    label: 'All',    color: '--color-series-all', pick: () => true },
];

function pgMeanStd(values) {
    const n = values.length;
    const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
    const variance = n ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
    return { mean, std: Math.sqrt(variance) };
}

/**
 * Fixed-width (1 PR point) bins over [lo, hi), sharing one grid across every
 * series so the multi-series row can draw bin i of each series side by side.
 * `pct` is the bin's share of THIS series' own matches — see the section's "?"
 * popup for why each series carries its own denominator.
 */
function pgBuildBuckets(values, lo, hi, dropOutOfRange = false) {
    const counts = new Map();
    for (const v of values) {
        if (dropOutOfRange && (v < lo || v >= hi)) continue;
        const bx = Math.max(lo, Math.min(hi - 1, Math.floor(v)));
        counts.set(bx, (counts.get(bx) || 0) + 1);
    }
    const total = values.length;
    const buckets = [];
    for (let x = lo; x < hi; x++) {
        const count = counts.get(x) || 0;
        buckets.push({ x0: x, x1: x + 1, count, pct: total > 0 ? (count / total * 100) : 0 });
    }
    return buckets;
}

/**
 * Every rated, non-technical match of the given league types, as the PR gap
 * from THIS player's point of view (opponent's PR minus their own, so positive
 * = the player played the better match) plus whether they won it. Draws are
 * dropped: a PR gap "vs result" split needs a result to sort the match into.
 */
function collectPlayerPrGaps(perLeague, typeId) {
    const out = [];
    for (const e of perLeague) {
        if (!e.league.config?.showPR) continue;
        if (typeId !== ALL_TYPES_ID && e.league.leagueType !== typeId) continue;
        const matchLength = e.league.params?.MatchLength ?? 7;
        for (const m of e.playerMatches) {
            if (m._technical || m._draw) continue;
            if (m.prSelf == null || m.prOpp == null) continue;
            if (!(m.prSelf > 0) || !(m.prOpp > 0)) continue;
            if (m.scoreSelf === m.scoreOpp) continue;
            out.push({ gap: m.prOpp - m.prSelf, win: m.scoreSelf > m.scoreOpp, matchLength });
        }
    }
    return out;
}

/**
 * One series' μ/σ explainer block, both languages inline (the popup's flag bar
 * flips which is visible). The wording itself lives in popupContent.js — the
 * single source the Explanation-and-Maths lab also renders — so this only wraps
 * it in the two `.popup-lang-*` blocks the live popup chrome expects.
 */
function buildPgGaussianExplainerHtml(displayName, seriesLabel, values) {
    const { mean, std } = pgMeanStd(values);
    const args = { displayName, seriesLabel, mean, std, games: values.length };
    return `
        <div class="pg-gauss-block">
        <div class="popup-lang-en" data-lang="en">${playerGaussianSeriesHtml('en', args)}</div>
        <div class="popup-lang-he" data-lang="he">${playerGaussianSeriesHtml('he', args)}</div>
        </div>
    `;
}

function renderTotalPrResultSection(container, playerName, perLeague) {
    // Only PR-tracking league types the player actually appears in.
    const presentTypes = [...new Set(
        perLeague.filter(e => e.league.config?.showPR).map(e => e.league.leagueType)
    )];
    if (presentTypes.length === 0) return;
    if (collectPlayerPrGaps(perLeague, ALL_TYPES_ID).length === 0) return;

    const section = makePgSection('pg-pr-result', 'Total PR difference ↔ Result ↔ Luck', {
        collapsible: true,
        headerHtml: ' <span class="predictor-tooltip" id="pg-prres-info-btn">?</span>',
    });
    // The "?" popup carries its own flag bar (same shape as the landing page's
    // Luck Percentile card), so both language blocks ship inline and the flags
    // only ever flip which one is visible.
    section.insertAdjacentHTML('beforeend', `
        <div class="predictor-info-popup" id="pg-prres-info-popup" hidden>
            <button class="predictor-info-close" id="pg-prres-info-close">&times;</button>
            <div class="popup-lang-flags-bar">${langFlagsHtml()}</div>
            <div class="popup-lang-en" data-lang="en">${getPopup('player-pr-result').render('en')}</div>
            <div class="popup-lang-he" data-lang="he">${getPopup('player-pr-result').render('he')}</div>
        </div>`);
    container.appendChild(section);

    const infoPopup = section.querySelector('#pg-prres-info-popup');
    wireLangPopup(infoPopup, {
        btn: section.querySelector('#pg-prres-info-btn'),
        popup: infoPopup,
        close: section.querySelector('#pg-prres-info-close'),
    });

    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(body);

    // The legend / Gaussian / Trim controls sit ONCE above the rows, not on
    // each row: they are what makes the rows comparable. Per-row copies would
    // let two players end up on different series, different fits and different
    // X domains, at which point stacking them says nothing.
    const controls = document.createElement('div');
    controls.className = 'chart-panel corr-panel pg-prres-controls';
    controls.innerHTML = `
        <div class="dash-controls corr-controls">
            <div class="corr-controls-top">
                <label class="pg-prres-count"></label>
                <div class="corr-shift-group">
                    <button class="corr-gaussian-toggle" type="button" data-track="Chart tool: Gaussian fit">Gaussian fit</button>
                    <button class="corr-trim-toggle" type="button" data-track="Chart tool: Trim to 99%">Trim to 99%</button>
                </div>
            </div>
            <div class="pg-prres-legend" role="group" aria-label="Series"></div>
        </div>
        <div class="predictor-info-popup pg-prres-gauss-popup" hidden></div>
    `;
    body.appendChild(controls);

    const panelsHost = document.createElement('div');
    panelsHost.className = 'pg-prres-panels';
    body.appendChild(panelsHost);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-chart-btn pg-prres-add';
    addBtn.dataset.track = 'Compare: add player chart';
    addBtn.textContent = '+ Add player chart';
    addBtn.title = 'Add another player\'s PR-gap distribution below, on the same axis, to compare against';
    body.appendChild(addBtn);

    const legendEl   = controls.querySelector('.pg-prres-legend');
    const countEl    = controls.querySelector('.pg-prres-count');
    const gaussBtn   = controls.querySelector('.corr-gaussian-toggle');
    const trimBtn    = controls.querySelector('.corr-trim-toggle');
    const gaussPopup = controls.querySelector('.pg-prres-gauss-popup');

    // Wins + Losses on by default: the split is the point of the section, and
    // "All" is exactly their sum, so showing all three at once would just add a
    // third line that carries no new information until you ask for it.
    const visible = new Set(['wins', 'losses']);
    let showGaussian = false;
    // Starts on the full range, same as the dashboard's correlation rows — a
    // chart should open showing all of its data, and trimming is the reader's
    // choice. Trim to 99% helps here (one blow-out match can stretch the axis
    // to ±70 and squeeze the real distribution toward the centre), but it is
    // display-only: the fit and the μ/σ readout always use the FULL data.
    let trimmed = false;
    let typeId = ALL_TYPES_ID;
    // null = all match lengths pooled (default); a number narrows to that length.
    // The selector below only appears once the selected type spans >1 length.
    let lengthFilter = null;

    // Luck percentile shown beside each candidate in the comparison-row picker.
    // Keyed to the section's league-type pill, so the number a candidate shows
    // is the number their own Luck bar will read once their chart is stacked —
    // not a career figure that disagrees with the row it produced. (Match
    // length is left pooled: the picker is about who to compare, and rebuilding
    // per length would make the same player show different numbers mid-search.)
    let prresLuck = createAllTimeLuckSource();

    // One entry per row. entries[0] is ALWAYS this page's player and can be
    // neither re-pointed nor removed — the whole section is their profile, and
    // the added rows exist to be compared against them.
    const entries = [{ name: playerName, perLeague, loadedFor: playerName, rows: [], counts: { rated: 0, total: 0 }, el: null }];
    let allPlayers = [playerName];

    for (const s of PR_RESULT_SERIES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pg-prres-legend-item';
        btn.dataset.key = s.key;
        // Analytics: a legend toggle is a statistical chart control (∑ icon).
        // The stable series key, never the visible label (translation-proof).
        btn.dataset.track = `Chart tool: Series ${s.key}`;
        btn.innerHTML = `<span class="pg-prres-swatch" style="background:var(${s.color})"></span>${s.label}<span class="pg-prres-legend-n"></span>`;
        btn.addEventListener('click', () => {
            if (visible.has(s.key)) {
                // Never let the legend empty the chart entirely.
                if (visible.size > 1) visible.delete(s.key);
            } else {
                visible.add(s.key);
            }
            redrawAll();
        });
        legendEl.appendChild(btn);
    }

    /**
     * Flag + title badges beside a row's player name — the same identity chrome
     * every other player reference on the site carries (search results, the C4
     * opponents table, the league table), so a chart row doesn't read as a
     * different kind of "player" than the rest of the page. Hidden players get
     * neither, exactly as in the opponents table above.
     */
    function paintIdentity(entry) {
        // Only the MAIN row owns its chip: it has no picker, just this page's
        // own player. Comparison rows carry a canonical search field, and the
        // field's `identity: true` paints the very same flag + badges from the
        // very same decorate() — so painting them here too would double them.
        if (!entry.flagEl) return;
        const meta = _allMeta[entry.name];
        const hidden = !!meta?.hidden;
        const code = getFlagCode(entry.name, _mergedCustomFlags);
        entry.flagEl.innerHTML = hidden
            ? ''
            : `<img class="flag" src="${flagUrl(code)}" alt="${escapeHtml(code)}">`;
        entry.titlesEl.innerHTML = hidden ? '' : getTitleAbbreviationsHtml(meta);
    }

    /** Build (once) the row chrome for an entry: player identity + count + chart. */
    function buildEntryEl(entry, index) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel corr-panel pg-prres-panel';
        const isMain = index === 0;
        panel.innerHTML = `
            <div class="dash-controls corr-controls">
                <div class="corr-controls-top">
                    <label>Player:</label>
                    <span class="pg-prres-who">
                        ${isMain
                            ? `<span class="pg-prres-flag"></span>`
                              + `<b class="pg-prres-self">${escapeHtml(displayPlayerName(entry.name, _allMeta[entry.name]))}</b>`
                              + `<span class="pg-prres-titles"></span>`
                            : `<input type="text" class="player-pick app-search-input" placeholder="Search player…" autocomplete="off">`}
                    </span>
                    <span class="corr-games-count"></span>
                    ${isMain ? '' : '<button class="remove-chart" type="button" title="Remove this chart" data-track="Compare: remove player chart">&times;</button>'}
                </div>
                <span class="corr-metric-pill corr-luck-pill"></span>
            </div>
            <div class="chart-host corr-host"></div>
        `;
        entry.el = panel;
        entry.host = panel.querySelector('.corr-host');
        entry.countEl = panel.querySelector('.corr-games-count');
        entry.luckPill = panel.querySelector('.corr-luck-pill');
        entry.flagEl = panel.querySelector('.pg-prres-flag');
        entry.titlesEl = panel.querySelector('.pg-prres-titles');
        paintIdentity(entry);

        // The comparison-row picker runs on the project's ONE canonical search
        // field, like every other player picker on the site. It replaces a bare
        // <select>, which could not carry the thing this section is about: a
        // native <option> strips markup and tints its whole row, so the luck
        // figure could neither sit beside the name nor keep its own colour
        // while the name kept the text colour. The list now shows flag, name,
        // title badges and the candidate's LUCK PERCENTILE — the number you are
        // about to stack a chart against, readable before you pick.
        const pick = panel.querySelector('.player-pick');
        if (pick) {
            pick.value = displayPlayerName(entry.name, _allMeta[entry.name]);
            const combo = mountSearchField(pick, {
                getOptions: () => allPlayers,
                labelFor: (p) => displayPlayerName(p, _allMeta[p]),
                altFor: (p) => alternateName(p, _allMeta[p]),
                decorate: (p) => (_allMeta[p]?.hidden
                    ? {}
                    : {
                        flagCode: getFlagCode(p, _mergedCustomFlags),
                        titleHtml: getTitleAbbreviationsHtml(_allMeta[p]),
                        luckHtml: prresLuck.htmlFor(p),
                    }),
                identity: true,
                // Entering the field browses the full roster; leaving without
                // picking puts the name back. Owned by the base.
                browseOnOpen: true,
                onPick: async (name) => {
                    pick.value = displayPlayerName(name, _allMeta[name]);
                    entry.name = name;
                    // Analytics: a picker choice is not a DOM click the delegated
                    // listener can catch, so announce it as an interaction (👤 icon).
                    // The chosen player is named — public league data, already stored
                    // freely as "Player link: <name>" elsewhere in this file.
                    window.dispatchEvent(new CustomEvent('shabi:interaction', { detail: { target: `Compare: change player: ${name}` } }));
                    paintIdentity(entry);
                    await loadEntry(entry);
                    redrawAll();
                },
            });
            combo.setIdentity(entry.name);
        }
        const removeBtn = panel.querySelector('.remove-chart');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                panel.remove();
                entries.splice(entries.indexOf(entry), 1);
                redrawAll();
            });
        }
        panelsHost.appendChild(panel);
    }

    /**
     * Load one entry's cross-league data (the underlying league bundle is
     * memoized, so this is a re-filter, not a re-fetch) and derive its rows.
     * Keyed on `loadedFor`, NOT on "is perLeague set" — re-pointing a row at
     * another player leaves the previous player's data in place, and a
     * truthiness check would silently keep showing it.
     */
    async function loadEntry(entry) {
        if (entry.loadedFor !== entry.name) {
            entry.perLeague = await loadPlayerAcrossLeagues(entry.name);
            entry.loadedFor = entry.name;
        }
        recomputeEntry(entry);
    }

    function recomputeEntry(entry) {
        // rowsAll = every rated match for the selected type (used to discover
        // which match lengths exist); rows = those narrowed to the chosen length
        // (null = all lengths pooled, the default).
        entry.rowsAll = collectPlayerPrGaps(entry.perLeague || [], typeId);
        entry.rows = lengthFilter == null
            ? entry.rowsAll
            : entry.rowsAll.filter(r => r.matchLength === lengthFilter);
        entry.counts = countPlayerRatedMatches(entry.perLeague || [], typeId, entry.rows.length, lengthFilter);
    }

    function redrawAll() {
        const active = PR_RESULT_SERIES.filter(s => visible.has(s.key));

        // The legend counts describe the page's own player (row 0) — the row
        // every other one is being compared against.
        const mainSeries = PR_RESULT_SERIES.map(s => ({ s, values: entries[0].rows.filter(s.pick).map(r => r.gap) }));
        legendEl.querySelectorAll('.pg-prres-legend-item').forEach(btn => {
            const found = mainSeries.find(p => p.s.key === btn.dataset.key);
            btn.classList.toggle('is-active', visible.has(btn.dataset.key));
            btn.querySelector('.pg-prres-legend-n').textContent = ` (${found.values.length})`;
            btn.disabled = found.values.length === 0;
        });

        const totalRows = entries.reduce((n, e) => n + e.rows.length, 0);
        countEl.textContent = entries.length === 1
            ? `PR gap by result (${entries[0].rows.length} match${entries[0].rows.length === 1 ? '' : 'es'})`
            : `PR gap by result — ${entries.length} players (${totalRows} matches)`;

        // ONE symmetric domain across every row, so a position means the same
        // thing in all of them — that is the whole point of stacking them.
        // Trimmed = the middle 99% of the pooled gaps; out-of-range matches are
        // dropped from the marks (not folded into the edge), display-only.
        const allGaps = entries.flatMap(e => e.rows.map(r => Math.abs(r.gap)));
        const fullBound = Math.max(1, Math.ceil(Math.max(0, ...allGaps)));
        let bound = fullBound;
        if (trimmed && allGaps.length) {
            const sorted = [...allGaps].sort((a, b) => a - b);
            const idx = Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length));
            bound = Math.min(fullBound, Math.max(1, Math.ceil(sorted[idx])));
        }
        const lo = -bound, hi = bound;

        trimBtn.textContent = trimmed ? 'Show full range' : 'Trim to 99%';
        trimBtn.classList.toggle('is-active', trimmed);
        trimBtn.title = 'Zooms the X-axis in to the middle 99% of the displayed matches (symmetric around 0), hiding the outlier bins. Display only — the Gaussian fit always uses the full, untrimmed data.';

        // A fit needs enough matches in EVERY displayed series of EVERY row,
        // since each one gets its own μ/σ.
        const enough = entries.length > 0 && active.length > 0 && entries.every(e =>
            active.every(s => e.rows.filter(s.pick).length >= PG_MIN_GAUSSIAN_N));
        gaussBtn.disabled = !enough;
        gaussBtn.textContent = enough ? 'Gaussian fit' : 'Gaussian fit (not enough data)';
        gaussBtn.title = enough
            ? 'Fits a normal (Gaussian) curve to each displayed series, using that series\' own mean and standard deviation — a visual reference only, not a claim that the data is actually normally distributed.'
            : `Needs at least ${PG_MIN_GAUSSIAN_N} matches in every displayed series of every chart before a mean/standard deviation is meaningful.`;
        if (!enough) showGaussian = false;
        gaussBtn.classList.toggle('is-active', showGaussian);

        // Build every row's series first, so the Y scale can be pinned to the
        // tallest mark ACROSS rows. Left to self-scale, a flat distribution and
        // a sharply peaked one would draw the same height and the comparison
        // would be worse than useless.
        const built = entries.map(entry => active.map(s => {
            const values = entry.rows.filter(s.pick).map(r => r.gap);
            return {
                key: s.key,
                label: s.label,
                color: s.color,
                total: values.length,
                buckets: pgBuildBuckets(values, lo, hi, trimmed),
                gaussian: showGaussian ? pgMeanStd(values) : null,
            };
        }));
        let yMax = 0;
        for (const series of built) {
            for (const s of series) {
                for (const b of s.buckets) yMax = Math.max(yMax, b.pct);
                if (s.gaussian && s.gaussian.std > 0) {
                    yMax = Math.max(yMax, 100 / (s.gaussian.std * Math.sqrt(2 * Math.PI)));
                }
            }
        }

        entries.forEach((entry, i) => {
            entry.countEl.textContent = `(${entry.counts.rated}/${entry.counts.total} matches)`;
            // Luck pill — same component as the league dashboard's PR ↔ Result
            // rows (js/render/luckPill.js). It describes exactly the matches
            // charted below it: entry.rows is already narrowed to the selected
            // league type and match length, so switching either re-reads the
            // metric rather than leaving a stale number over a changed chart.
            applyLuckPill(entry.luckPill, luckConfidenceFromItems(entry.rows.map(r => ({
                // The win-probability table is a function of the PR GAP alone,
                // so (0, gap) is the same lookup the dashboard makes with
                // (prSelf, prOpp) — and gap here is already prOpp − prSelf.
                pWin: getWinProbability(0, r.gap, nearestMatchLengthIdx(r.matchLength)),
                outcome: r.win ? 1 : 0,
            }))));
            const series = built[i];
            if (!series.length || !entry.rows.length) {
                entry.host.innerHTML = '<div class="pg-note">No rated matches for this filter.</div>';
                return;
            }
            // Double the shared 76px row: this section is read for the SHAPE of
            // the distributions (and for the fitted bells once Gaussian fit is
            // on), and at the default height a normal curve flattens to an arc.
            // Every row draws its own axis — the rows are separate cards with a
            // hover panel between them, so a single shared ruler at the bottom
            // would be too far from the rows above to read against.
            drawMultiHistogramRow(entry.host, series, {
                xMin: lo, xMax: hi, showAxis: true, rowHeight: 152, yMax,
            });
        });

        // One μ/σ summary per charted player, in row order — the same sequence
        // as the stack above it, so the popup reads as a walk down the charts
        // rather than a pile of numbers. The player name only heads each group
        // when there is more than one; with a single chart it would just repeat
        // the sentence beneath it.
        if (showGaussian) {
            const groups = entries.map(entry => {
                const name = displayPlayerName(entry.name, _allMeta[entry.name]);
                const valuesFor = (s) => entry.rows.filter(s.pick).map(r => r.gap);
                const stats = active.map(s => {
                    const { mean, std } = pgMeanStd(valuesFor(s));
                    return `<span class="pg-prres-stat" style="color:var(${s.color})">${s.label}: μ = ${mean.toFixed(2)}   σ = ${std.toFixed(2)}</span>`;
                }).join('');
                return `<div class="pg-gauss-player">` +
                    (entries.length > 1 ? `<div class="pg-gauss-player-name">${escapeHtml(name)}</div>` : '') +
                    `<div class="pg-prres-stats">${stats}</div>` +
                    active.map(s => buildPgGaussianExplainerHtml(name, s.label, valuesFor(s))).join('') +
                    `</div>`;
            }).join('');
            gaussPopup.innerHTML =
                `<button class="predictor-info-close pg-prres-gauss-close" aria-label="Close">&times;</button>` +
                `<div class="popup-lang-flags-bar">${langFlagsHtml()}</div>` +
                groups;
            gaussPopup.hidden = false;
            wireDynamicLangPopup(gaussPopup);
            gaussPopup.querySelector('.pg-prres-gauss-close').addEventListener('click', () => {
                showGaussian = false;
                redrawAll();
            });
        } else {
            gaussPopup.hidden = true;
            gaussPopup.innerHTML = '';
        }
    }

    gaussBtn.addEventListener('click', () => { showGaussian = !showGaussian; redrawAll(); });
    trimBtn.addEventListener('click', () => { trimmed = !trimmed; redrawAll(); });

    addBtn.addEventListener('click', async () => {
        const taken = new Set(entries.map(e => e.name));
        const next = allPlayers.find(p => !taken.has(p)) || allPlayers[0];
        if (!next) return;
        const entry = { name: next, perLeague: null, loadedFor: null, rows: [], counts: { rated: 0, total: 0 } };
        entries.push(entry);
        buildEntryEl(entry, entries.length - 1);
        await loadEntry(entry);
        redrawAll();
    });

    const lengthHost = document.createElement('div');
    lengthHost.className = 'pg-prres-length';

    // (Re)build the match-length sub-selector for the current type. It appears
    // only when the selected type spans more than one match length — a different
    // length is a different win-probability model, so this lets the reader look
    // at one length at a time instead of the pooled mix (the "All lengths" default).
    function rebuildLengthSelector() {
        lengthHost.innerHTML = '';
        const lengths = [...new Set(entries.flatMap(e => (e.rowsAll || []).map(r => r.matchLength)))];
        mountLengthSelector(lengthHost, {
            lengths,
            defaultLen: lengthFilter,
            onSelect: (len) => {
                lengthFilter = len;
                for (const e of entries) recomputeEntry(e);
                redrawAll();
            },
        });
    }

    function showType(id) {
        typeId = id;
        lengthFilter = null;              // a new type may span different lengths
        prresLuck = createAllTimeLuckSource({ leagueType: id === ALL_TYPES_ID ? null : id });
        for (const e of entries) recomputeEntry(e);
        rebuildLengthSelector();
        redrawAll();
    }

    // Row 0's chrome must exist before the pill bar mounts: mountPillTabs fires
    // its initial onSelect synchronously, and that already runs a full redraw.
    buildEntryEl(entries[0], 0);

    const { bar } = mountPillTabs(section, {
        tabs: [ALL_TYPES_TAB, ...presentTypes.map(t => ({ id: t, label: LEAGUE_TYPE_LABELS[t] || t.toUpperCase() }))],
        defaultId: ALL_TYPES_ID,
        pillClassFor: (t) => 'league-type-pill type-' + t,
        onSelect: showType,
    });
    section.insertBefore(bar, body);
    section.insertBefore(lengthHost, body);

    // Comparison roster — every player in any visible league, sorted by the
    // DISPLAYED name (the dropdown shows those, so a raw-key sort reads as
    // unsorted). Async: until it lands, the add button just has this player.
    loadAllLeagues().then(leagues => {
        const set = new Set();
        for (const l of leagues) {
            if (l.params?.Hidden) continue;
            for (const p of l.allPlayers) {
                if (!_allMeta[p]?.hidden) set.add(p);
            }
        }
        allPlayers = [...set].sort((a, b) =>
            displayPlayerName(a, _allMeta[a]).localeCompare(displayPlayerName(b, _allMeta[b])));
        // Nothing to re-fill: the picker reads `allPlayers` live through its
        // getOptions hook, so the widened roster is simply there on the next
        // open. (The old <select> had to be rebuilt here.)
    }).catch(() => { /* add button stays limited to the current player */ });
}

/**
 * How many of a player's matches in the given league scope actually carry a
 * rated PR gap, against how many they played there at all — the "21/24
 * matches" sample-size readout above each chart. `rated` is passed in rather
 * than recomputed so it can never disagree with the marks being drawn.
 */
function countPlayerRatedMatches(perLeague, typeId, rated, lengthFilter = null) {
    let total = 0;
    for (const e of perLeague) {
        if (!e.league.config?.showPR) continue;
        if (typeId !== ALL_TYPES_ID && e.league.leagueType !== typeId) continue;
        if (lengthFilter != null && (e.league.params?.MatchLength ?? 7) !== lengthFilter) continue;
        total += e.playerMatches.length;
    }
    return { rated, total };
}

function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MR_MONTH_SHORT[d.getUTCMonth()];
    const yr  = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
}
