/**
 * playerGeneralPage.js — Phase G: cross-league general player profile.
 *
 * URL: player_general.html?player=<name>
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
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { colorForLevel } from '../compute/colorScale.js';
import {
    getQueryParam, flagUrl, getFlagCode,
    formatNumber, dashboardUrl, playerGeneralUrl, getLeagueYear, leagueUrl, thLabel,
    parseLeagueDate
} from '../utils/helpers.js';
import {
    collectPlayerBestPR,
    collectPlayerBestLuckFor,
    collectPlayerWorstLuckAgainst
} from '../compute/matchRecords.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { renderBreadcrumbs } from './navigation.js';
import { getTitleBadgesHtml, getTitleAbbreviationsHtml, getHighestTier } from '../data/titleConstants.js';
import { renderV12Header, buildHeaderTitles, formatJoinedShort } from './playerHeader.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { buildPlayerLeaguesPreset } from '../presets/playerLeaguesPreset.js';
import { buildPlayerAllMatchesPreset } from '../presets/playerAllMatchesPreset.js';
import { buildMatchupPreset } from '../presets/matchupPreset.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';

const CURRENT_YEAR = new Date().getFullYear();
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

let _allMeta = {};
let _mergedCustomFlags = {};

export async function renderPlayerGeneralPage() {
    const container = document.getElementById('content');
    const playerName = getQueryParam('player');

    if (!playerName) {
        container.innerHTML = '<div class="error">Missing player parameter.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading cross-league data…</div>';
    document.title = `${playerName} — Shabi Israel`;

    try {
        const [perLeague, allMeta] = await Promise.all([
            loadPlayerAcrossLeagues(playerName),
            loadPlayersMetadata()
        ]);
        const meta = allMeta[playerName] || {};
        _allMeta = allMeta;

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
            { label: playerName }
        ]);

        container.innerHTML = '';

        // G3 — PR stats per league type (only types with showPR)
        const prSection = document.createElement('section');
        prSection.className = 'pg-section pg-pr-section';
        prSection.innerHTML = '<h2>PR Statistics</h2>';
        container.appendChild(prSection);
        await renderPRStats(prSection, playerName, perLeague);

        // G6 — Achievements strip (tabbed by league type)
        const achSection = document.createElement('section');
        achSection.className = 'pg-section pg-achievements';
        achSection.innerHTML = '<h2>Achievements</h2>';
        container.appendChild(achSection);
        await renderAchievements(achSection, playerName, perLeague);

        // G4 — League history table
        const leaguesSection = document.createElement('section');
        leaguesSection.className = 'pg-section pg-leagues';
        leaguesSection.innerHTML = '<h2>Leagues</h2>';
        container.appendChild(leaguesSection);
        renderLeaguesTable(leaguesSection, perLeague);

        // G5 — Match history table + filters + chart
        const matchesSection = document.createElement('section');
        matchesSection.className = 'pg-section pg-matches';
        matchesSection.innerHTML = '<h2>Match History</h2>';
        container.appendChild(matchesSection);
        renderMatchHistory(matchesSection, playerName, perLeague);

        // Match Records — per-player best PR + luck highlights
        renderPlayerMatchRecords(container, perLeague);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="error">Failed to load data: ${escapeHtml(err.message)}</div>`;
    }
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

    const tabs = document.createElement('div');
    tabs.className = 'pg-tabs';
    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(tabs);
    section.appendChild(body);

    typesWithPR.forEach((type, i) => {
        const btn = document.createElement('button');
        btn.className = 'pg-tab' + (i === 0 ? ' active' : '');
        btn.textContent = type.toUpperCase();
        btn.addEventListener('click', () => {
            tabs.querySelectorAll('.pg-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showPRType(body, playerName, perLeague, type);
        });
        tabs.appendChild(btn);
    });

    await showPRType(body, playerName, perLeague, typesWithPR[0]);
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
        <div class="pg-rank-expanded" hidden></div>
    `;
    grid.appendChild(card);

    body.innerHTML = '';
    body.appendChild(grid);
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
        const card = btn.closest('.pg-pr-card, .pg-tile-block');
        if (!card) return;
        let expanded;
        if (card.classList.contains('pg-tile-block')) {
            // Achievement tile: shared expanded panel is sibling of .pg-tiles
            const tilesGrid = card.closest('.pg-tiles');
            expanded = tilesGrid?.nextElementSibling;
            if (!expanded || !expanded.classList.contains('pg-rank-expanded')) return;
        } else {
            // PR card: expanded is inside the card
            expanded = card.querySelector(':scope > .pg-rank-expanded');
        }
        if (!expanded) return;

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
        } catch (err) {
            expanded.innerHTML = `<div class="pg-note">Failed to load ranking: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderRankTable(rows, playerName, meta) {
    if (!rows.length) return '<div class="pg-note">No data.</div>';
    const valueLabel = meta.kind === 'pr'
        ? (meta.metric === 'totalPR' ? 'Total PR' : 'Last 300 PR')
        : (meta.metric === 'gold' ? 'Gold' : meta.metric === 'silver' ? 'Silver' : meta.metric === 'bronze' ? 'Bronze' : meta.metric === 'avgRank' ? 'Avg Rank' : meta.metric === 'winRate' ? 'Win%' : 'Value');
    const showLeagues = meta.kind === 'medal';
    let html = `<div class="pg-rank-table-wrap"><table class="pg-rank-table font-small" data-mf-table-id="C0"><thead><tr><th scope="col">#</th><th scope="col">Player</th>${showLeagues ? `<th scope="col">Leagues</th>` : ''}<th scope="col">${escapeHtml(valueLabel)}</th></tr></thead><tbody>`;
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
        html += `<tr class="${isSelf ? 'pg-rank-self' : ''}"><td>${r.rank}</td><td>${flagHtml} ${nameHtml}</td>${showLeagues ? `<td>${r.leagues}</td>` : ''}<td>${valFmt}</td></tr>`;
    }
    html += '</tbody></table></div>';
    return html;
}

function levelBadge(level) {
    const color = colorForLevel(level);
    return `<span class="pg-level-badge" style="background:${color}">${escapeHtml(level)}</span>`;
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

    const tabs = document.createElement('div');
    tabs.className = 'pg-tabs';
    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(tabs);
    section.appendChild(body);

    types.forEach((type, i) => {
        const btn = document.createElement('button');
        btn.className = 'pg-tab' + (i === 0 ? ' active' : '');
        btn.textContent = type.toUpperCase();
        btn.addEventListener('click', () => {
            tabs.querySelectorAll('.pg-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showAchievementType(body, playerName, type);
        });
        tabs.appendChild(btn);
    });

    showAchievementType(body, playerName, types[0]);
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
    section.appendChild(mountPoint);

    const preset = buildPlayerLeaguesPreset({
        perLeague,
        parseLeagueDate,
        enrich: {
            leagueLink: (id, title) => `<a href="${dashboardUrl(id)}">${escapeHtml(title)}</a>`,
        },
    });
    mountMFTable(mountPoint, preset);
}

// ---- G5: Match history ----

function renderMatchHistory(section, playerName, perLeague) {
    const allRows = flattenAllMatches(perLeague);
    if (allRows.length === 0) {
        section.innerHTML += '<div class="pg-note">No matches played yet.</div>';
        return;
    }

    const years = [...new Set(allRows.map(r => r.year).filter(y => y != null))].sort((a, b) => b - a);
    const leagueTypes = [...new Set(allRows.map(r => r.leagueType))];

    const controls = document.createElement('div');
    controls.className = 'dash-controls';

    const yearSel = document.createElement('select');
    yearSel.innerHTML =
        '<option value="all">All years</option>' +
        years.map(y => `<option value="${y}"${y === CURRENT_YEAR ? ' selected' : ''}>${y}</option>`).join('');
    if (!years.includes(CURRENT_YEAR)) yearSel.value = 'all';

    const typeSel = document.createElement('select');
    typeSel.innerHTML =
        '<option value="all">All types</option>' +
        leagueTypes.map(t => `<option value="${t}">${t.toUpperCase()}</option>`).join('');

    const countSel = document.createElement('select');
    countSel.innerHTML =
        '<option value="all">All</option>' +
        [5, 10, 20, 50].map(n => `<option value="${n}">Last ${n}</option>`).join('');

    const metricSel = document.createElement('select');
    metricSel.innerHTML = '<option value="pr">PR</option><option value="luck">Luck</option>';

    function inlineLbl(text) {
        const l = document.createElement('label');
        l.textContent = text;
        return l;
    }
    controls.appendChild(inlineLbl('Year:'));
    controls.appendChild(yearSel);
    controls.appendChild(inlineLbl('Type:'));
    controls.appendChild(typeSel);
    controls.appendChild(inlineLbl('Games:'));
    controls.appendChild(countSel);
    controls.appendChild(inlineLbl('Metric:'));
    controls.appendChild(metricSel);

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
        const tv = typeSel.value;
        const cv = countSel.value;
        let filtered = allRows.filter(r => {
            if (yv !== 'all' && r.year !== parseInt(yv, 10)) return false;
            if (tv !== 'all' && r.leagueType !== tv) return false;
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

        // Bar chart — include only non-technical played matches, chronological asc
        const chartMatches = rows
            .filter(r => !r._technical && r.prSelf != null)
            .sort((a, b) => {
                const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                if (at !== bt) return at - bt;
                return b.leagueOrderIdx - a.leagueOrderIdx;
            });
        if (chartMatches.length > 0) {
            drawPlayerBarChart(chartHost, chartMatches, metricSel.value, Math.max(chartMatches.length, 1));
        } else {
            chartHost.innerHTML = '<div class="pg-note">No PR data for current filters.</div>';
        }
    }

    function renderTable(host, rows) {
        const preset = buildPlayerAllMatchesPreset({
            rows,
            enrich: {
                leagueLink: (id, title) => `<a href="${dashboardUrl(id)}">${escapeHtml(title)}</a>`,
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
    typeSel.addEventListener('change', renderAll);
    countSel.addEventListener('change', renderAll);
    metricSel.addEventListener('change', renderAll);
    renderAll();

    renderMatchup(section, playerName, allRows);
}

// ---- G5b: Matchup sub-section ----

function renderMatchup(section, playerName, allRows) {
    const LIMIT = 10;

    // Header (collapsible, like Remaining Matches in dashboard)
    const header = document.createElement('div');
    header.className = 'matchup-header';
    header.innerHTML =
        `<span class="matchup-arrow open" id="mu-arrow">&#x25B8;</span>` +
        `<span class="matchup-title">Head to Head</span>`;

    const body = document.createElement('div');
    body.className = 'matchup-body';

    section.appendChild(header);
    section.appendChild(body);

    let initialized = false;

    // Initialize immediately (open by default)
    initialized = true;
    _initMatchupBody(body, playerName, allRows, LIMIT);

    header.addEventListener('click', async () => {
        const opening = body.hidden;
        body.hidden = !opening;
        header.querySelector('#mu-arrow').classList.toggle('open', opening);
        if (opening && !initialized) {
            initialized = true;
            await _initMatchupBody(body, playerName, allRows, LIMIT);
        }
    });
}

async function _initMatchupBody(body, playerName, allRows, LIMIT) {
    body.innerHTML = '<div class="pg-note">Loading players…</div>';

    let allOpponents;
    try {
        const leagues = await loadAllLeagues();
        const playerSet = new Set();
        for (const l of leagues) {
            for (const p of l.allPlayers) {
                if (p !== playerName) playerSet.add(p);
            }
        }
        allOpponents = [...playerSet].sort((a, b) => a.localeCompare(b));
    } catch (err) {
        body.innerHTML = `<div class="pg-note">Failed to load players: ${escapeHtml(err.message)}</div>`;
        return;
    }

    // Selector row
    const selectorRow = document.createElement('div');
    selectorRow.className = 'matchup-selector-row';

    const label = document.createElement('span');
    label.className = 'matchup-selector-label';
    label.textContent = 'vs.';

    // Typeahead search input
    const inputWrap = document.createElement('div');
    inputWrap.className = 'matchup-search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'matchup-search-input';
    input.placeholder = 'Search opponent…';
    input.autocomplete = 'off';

    const dropdown = document.createElement('ul');
    dropdown.className = 'matchup-search-dropdown';
    dropdown.hidden = true;

    inputWrap.appendChild(input);
    inputWrap.appendChild(dropdown);

    const badge = document.createElement('span');
    badge.className = 'matchup-count-badge';
    badge.hidden = true;

    selectorRow.appendChild(label);
    selectorRow.appendChild(inputWrap);

    const resultsArea = document.createElement('div');

    body.innerHTML = '';
    body.appendChild(selectorRow);
    body.appendChild(badge);
    body.appendChild(resultsArea);

    function filterDropdown(query) {
        const q = query.trim().toLowerCase();
        if (q.length < 1) { dropdown.hidden = true; return; }
        const matches = allOpponents.filter(p => {
            const full = _allMeta[p]?.fullName || '';
            return p.toLowerCase().includes(q) || full.toLowerCase().includes(q);
        }).slice(0, 8);
        if (matches.length === 0) {
            dropdown.innerHTML = '<li class="matchup-search-empty">No players found</li>';
        } else {
            dropdown.innerHTML = matches.map(p => {
                const fullName = _allMeta[p]?.fullName;
                const nameHtml = fullName
                    ? `<span class="search-player-name">${escapeHtml(p)}</span><span class="search-player-realname">${escapeHtml(fullName)}</span>`
                    : `<span class="search-player-name">${escapeHtml(p)}</span>`;
                return `<li><button class="matchup-search-option" type="button" data-name="${escapeHtml(p)}"><span class="search-player-info">${nameHtml}</span></button></li>`;
            }).join('');
            for (const btn of dropdown.querySelectorAll('.matchup-search-option')) {
                btn.addEventListener('mousedown', e => {
                    e.preventDefault();
                    selectOpponent(btn.dataset.name);
                });
            }
        }
        dropdown.hidden = false;
    }

    function selectOpponent(name) {
        input.value = name;
        dropdown.hidden = true;
        renderResults(name);
    }

    input.addEventListener('input', () => filterDropdown(input.value));
    input.addEventListener('blur', () => { dropdown.hidden = true; });
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { dropdown.hidden = true; input.blur(); }
        if (e.key === 'Enter') {
            const first = dropdown.querySelector('.matchup-search-option');
            if (first) { e.preventDefault(); selectOpponent(first.textContent); }
        }
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
                leagueLink: (id, title) => `<a href="${dashboardUrl(id)}">${escapeHtml(title)}</a>`,
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

    const section = document.createElement('section');
    section.className = 'pg-section pg-match-records';
    section.innerHTML = '<h2>Match Records</h2>';
    container.appendChild(section);

    const tabs = document.createElement('div');
    tabs.className = 'pg-tabs';
    const body = document.createElement('div');
    body.className = 'pg-tabs-body';
    section.appendChild(tabs);
    section.appendChild(body);

    types.forEach((type, i) => {
        const btn = document.createElement('button');
        btn.className = 'pg-tab' + (i === 0 ? ' active' : '');
        btn.textContent = MR_TYPE_LABELS[type] || type.toUpperCase();
        btn.addEventListener('click', () => {
            tabs.querySelectorAll('.pg-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showMatchRecordsType(body, perLeague, type);
        });
        tabs.appendChild(btn);
    });

    showMatchRecordsType(body, perLeague, types[0]);

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

    body.innerHTML = `
        <div class="match-records-stack">
            ${renderPlayerRecordTable('Best PR', 'PR', bestPR)}
            ${renderPlayerRecordTable('Best Luck For', 'Luck Gap', bestLuck)}
            ${renderPlayerRecordTable('Worst Luck Against', 'Luck Gap', worstLuck)}
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
                <table class="achv-table pg-mr-table" data-mf-table-id="C4">
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
            <td><a class="league-link" href="${dashboardUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
            <td>${formatShortDate(r.date)}</td>
        </tr>`;
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
