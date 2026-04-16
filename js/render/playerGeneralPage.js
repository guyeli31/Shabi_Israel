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
    flattenAllMatches
} from '../compute/crossLeague.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { colorForLevel } from '../compute/colorScale.js';
import {
    getQueryParam, flagUrl, getFlagCode,
    formatNumber, dashboardUrl, playerGeneralUrl, getLeagueYear, leagueUrl, thLabel
} from '../utils/helpers.js';
import {
    collectPlayerBestPR,
    collectPlayerBestLuckFor,
    collectPlayerWorstLuckAgainst
} from '../compute/matchRecords.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { renderBreadcrumbs } from './navigation.js';
import { getTitleBadgesHtml, getTitleAbbreviationsHtml, getHighestTier } from '../data/titleConstants.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';

const CURRENT_YEAR = new Date().getFullYear();

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

        if (perLeague.length === 0) {
            container.innerHTML = `<div class="error">No leagues found for player "${escapeHtml(playerName)}".</div>`;
            return;
        }

        // Header
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

    // 3-state activity dot
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
    let dotClass, dotTitle;
    if (inRunning) {
        dotClass = 'pg-dot pg-dot-green';
        dotTitle = 'Active in a running league';
    } else if (playedThisYear || inCurrentYearLeague) {
        dotClass = 'pg-dot pg-dot-orange';
        dotTitle = `Played this year (${CURRENT_YEAR}), not in a running league`;
    } else {
        dotClass = 'pg-dot pg-dot-gray';
        dotTitle = `Inactive in ${CURRENT_YEAR}`;
    }
    const dot = `<span class="pg-dot-wrap" tabindex="0" data-tip="${escapeHtml(dotTitle)}"><span class="${dotClass}" aria-label="${escapeHtml(dotTitle)}"></span></span>`;

    // Distinct flag codes from all leagues
    const flagSet = new Set();
    for (const e of perLeague) {
        flagSet.add(getFlagCode(playerName, e.league.params?.CustomFlags));
    }
    const flagsHtml = [...flagSet]
        .map(code => `<img class="flag-title" src="${flagUrl(code)}" alt="${code}" title="${code}">`)
        .join('');

    // Optional avatar
    const avatarHtml = meta.photoPath
        ? `<img class="pg-avatar" src="${escapeHtml(meta.photoPath)}" alt="${escapeHtml(playerName)}">`
        : '';

    // Title badges (BMAB + championship) — appear RIGHT of name
    const titleBadgesHtml = getTitleBadgesHtml(meta);

    // Display name + full name beneath
    const displayName = playerName;
    const aliasHtml = meta.fullName
        ? `<div class="pg-player-alias">${escapeHtml(meta.fullName)}</div>`
        : '';

    // Highest tier for name color styling
    const highestTier = getHighestTier(meta);

    title.innerHTML = `
        <div class="pg-header-row">
            ${avatarHtml}
            <div class="pg-header-text">
                <div class="pg-name-line">
                    ${flagsHtml} ${dot}
                    <span class="pg-player-name">${escapeHtml(displayName)}</span>
                    ${titleBadgesHtml}
                </div>
                ${aliasHtml}
            </div>
        </div>
    `;
    // Apply tier-based name styling
    title.classList.remove('pg-titled', 'pg-titled-gold', 'pg-titled-silver', 'pg-titled-bronze', 'pg-titled-white');
    if (highestTier) title.classList.add(`pg-titled-${highestTier}`);

    const subtitle = document.getElementById('league-subtitle');
    if (subtitle) {
        subtitle.textContent = `Active in ${perLeague.length} league${perLeague.length === 1 ? '' : 's'}`;
    }
}

// ---- G3: PR stats ----

async function renderPRStats(section, playerName, perLeague) {
    const typesWithPR = [...new Set(
        perLeague
            .filter(e => e.league.config.showPR)
            .map(e => e.league.leagueType)
    )];

    if (typesWithPR.length === 0) {
        section.innerHTML += '<div class="pg-note">No leagues with PR tracking.</div>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'pg-pr-grid';
    section.appendChild(grid);

    for (const type of typesWithPR) {
        const agg = aggregatePR(perLeague, type);
        if (!agg) continue;

        // All-time ranking (across full history)
        const [totalRank, last300Rank] = await Promise.all([
            rankAllTime(playerName, type, 'totalPR'),
            rankAllTime(playerName, type, 'last300PR')
        ]);

        const card = document.createElement('div');
        card.className = 'pg-pr-card';
        card.innerHTML = `
            <div class="pg-pr-type pg-lt pg-lt-${escapeHtml(type)}">${escapeHtml(type.toUpperCase())}</div>
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
    }

    wireRankToggles(section, playerName);
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
        : (meta.metric === 'gold' ? 'Gold' : meta.metric === 'silver' ? 'Silver' : meta.metric === 'bronze' ? 'Bronze' : meta.metric === 'avgRank' ? 'Avg Rank' : meta.metric === 'winRate' ? 'Win Rate' : 'Value');
    const showLeagues = meta.kind === 'medal';
    let html = `<div class="pg-rank-table-wrap"><table class="pg-rank-table"><thead><tr><th scope="col">#</th><th scope="col">${thLabel('Player','Player')}</th>${showLeagues ? `<th scope="col">${thLabel('Leagues','Lg')}</th>` : ''}<th scope="col">${escapeHtml(valueLabel)}</th></tr></thead><tbody>`;
    for (const r of rows) {
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
            ${tile('🥇', 'Gold', m.goldRank, m.self.gold, '', 'gold')}
            ${tile('🥈', 'Silver', m.silverRank, m.self.silver, '', 'silver')}
            ${tile('🥉', 'Bronze', m.bronzeRank, m.self.bronze, '', 'bronze')}
            ${tile('🏆', 'Win Rate', m.winRateRank, (m.self.winRate * 100).toFixed(1) + '%', `<div class="pg-tile-sub">${m.self.totalWins}W / ${m.self.totalGames}G</div>`, 'winRate')}
            ${tile('📊', 'Avg Rank', m.avgRankRank, isFinite(m.self.avgRank) ? m.self.avgRank.toFixed(1) : '—', `<div class="pg-tile-sub">${m.self.participations} league${m.self.participations === 1 ? '' : 's'}</div>`, 'avgRank')}
        </div>
        <div class="pg-rank-expanded" hidden></div>
    `;
    wireRankToggles(body, playerName);
}

// ---- G4: League history table ----

function renderLeaguesTable(section, perLeague) {
    let html = `
    <div class="pg-leagues-table-wrapper">
        <table class="pg-leagues-table">
            <thead>
                <tr>
                    <th scope="col">${thLabel('League','League')}</th>
                    <th scope="col">${thLabel('Type','Type')}</th>
                    <th scope="col">${thLabel('Status','Stat')}</th>
                    <th scope="col">${thLabel('Rank','Rank')}</th>
                    <th scope="col">${thLabel('Games','G')}</th>
                    <th scope="col">${thLabel('W','W')}</th>
                    <th scope="col">${thLabel('L','L')}</th>
                    <th scope="col">${thLabel('Primary','Pri')}</th>
                    <th scope="col">${thLabel('Mean PR','PR')}</th>
                </tr>
            </thead>
            <tbody>
    `;
    for (const e of perLeague) {
        const s = e.playerStats || {};
        const cfg = e.league.config;
        const isUbc = cfg.type === 'ubc';
        const primary = isUbc
            ? (s.avgPoints != null ? formatNumber(s.avgPoints) : '—')
            : (s.winRate != null ? (s.winRate * 100).toFixed(1) + '%' : '—');
        const primaryLabel = isUbc ? 'Avg Points' : 'Win Rate';
        const meanPR = (s.meanPR != null && cfg.showPR) ? formatNumber(s.meanPR) : '—';
        const running = e.league.params?.Running === true;
        html += `
            <tr>
                <td><a href="${dashboardUrl(e.league.id)}">${escapeHtml(e.league.title)}</a></td>
                <td><span class="pg-lt pg-lt-${escapeHtml(e.league.leagueType)}">${escapeHtml(e.league.leagueType)}</span></td>
                <td>${running ? '<span class="status-pill status-running">Running</span>' : '<span class="status-pill status-completed">Completed</span>'}</td>
                <td class="${e.playerRank === 1 ? 'rank-cell-gold' : e.playerRank === 2 ? 'rank-cell-silver' : e.playerRank === 3 ? 'rank-cell-bronze' : ''}">${e.playerRank != null ? `${e.playerRank} / ${e.totalPlayers}` : '—'}</td>
                <td>${s.games || 0}</td>
                <td>${s.wins || 0}</td>
                <td>${s.losses || 0}</td>
                <td title="${primaryLabel}">${primary}</td>
                <td>${meanPR}</td>
            </tr>
        `;
    }
    html += '</tbody></table></div>';
    section.innerHTML += html;
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
    controls.className = 'pg-filters';

    // Year filter
    const yearSel = document.createElement('select');
    yearSel.innerHTML =
        '<option value="all">All years</option>' +
        years.map(y => `<option value="${y}"${y === CURRENT_YEAR ? ' selected' : ''}>${y}</option>`).join('');
    // If no years include CURRENT_YEAR, default to "all"
    if (!years.includes(CURRENT_YEAR)) yearSel.value = 'all';

    const typeSel = document.createElement('select');
    typeSel.innerHTML =
        '<option value="all">All types</option>' +
        leagueTypes.map(t => `<option value="${t}">${t}</option>`).join('');

    const countSel = document.createElement('select');
    countSel.innerHTML =
        '<option value="all">All</option>' +
        [5, 10, 20, 50].map(n => `<option value="${n}">Last ${n}</option>`).join('');

    controls.appendChild(labelWrap('Year', yearSel));
    controls.appendChild(labelWrap('Type', typeSel));
    controls.appendChild(labelWrap('Games', countSel));
    section.appendChild(controls);

    const chartHost = document.createElement('div');
    chartHost.className = 'pg-chart-host';
    section.appendChild(chartHost);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrapper';
    section.appendChild(tableWrap);

    let sortKey = 'updatedAt';
    let sortDir = 'desc';

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

        // Sort
        const sorted = [...rows].sort((a, b) => {
            let va = a[sortKey], vb = b[sortKey];
            if (sortKey === 'updatedAt') {
                va = va ? new Date(va).getTime() : 0;
                vb = vb ? new Date(vb).getTime() : 0;
            }
            if (va == null) va = '';
            if (vb == null) vb = '';
            if (typeof va === 'string') {
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return sortDir === 'asc' ? va - vb : vb - va;
        });

        renderTable(tableWrap, sorted);

        // Bar chart — include only non-technical played matches
        const chartMatches = sorted
            .filter(r => !r._technical && r.prSelf != null)
            // chart expects chronological ascending
            .sort((a, b) => {
                const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                if (at !== bt) return at - bt;
                return b.leagueOrderIdx - a.leagueOrderIdx;
            });
        if (chartMatches.length > 0) {
            drawPlayerBarChart(chartHost, chartMatches, 'pr', Math.max(chartMatches.length, 1));
        } else {
            chartHost.innerHTML = '<div class="pg-note">No PR data for current filters.</div>';
        }
    }

    function renderTable(host, rows) {
        const headers = [
            { key: 'updatedAt', label: 'Date', abbr: 'Date' },
            { key: 'leagueTitle', label: 'League', abbr: 'Lg' },
            { key: 'leagueType', label: 'Type', abbr: 'T' },
            { key: 'opponent', label: 'Opponent', abbr: 'Opp' },
            { key: 'scoreSelf', label: 'Score', abbr: 'Sc' },
            { key: 'prSelf', label: 'PR', abbr: 'PR' },
            { key: 'prOpp', label: 'Opp PR', abbr: 'oPR' },
            { key: 'luckSelf', label: 'Luck', abbr: 'Lk' },
            { key: 'result', label: 'Result', abbr: 'Res' }
        ];
        const MOBILE_CAP = 25;
        const needsExpand = rows.length > MOBILE_CAP;
        let html = '';
        if (needsExpand) {
            html += `<button type="button" class="pg-matches-expand" data-expanded="false">Show all ${rows.length} matches</button>`;
        }
        html += '<div class="pg-matches-scroll"><table class="pg-matches-table"><thead><tr>';
        for (const h of headers) {
            const arrow = sortKey === h.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            html += `<th scope="col" data-key="${h.key}">${thLabel(h.label, h.abbr)}${arrow}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (let idx = 0; idx < rows.length; idx++) {
            const r = rows[idx];
            const date = r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
            const pr = (r.prSelf != null && !r._technical) ? formatNumber(r.prSelf) : '<span class="na">N/A</span>';
            const prOpp = (r.prOpp != null && !r._technical) ? formatNumber(r.prOpp) : '<span class="na">N/A</span>';
            const luck = (!r._technical && r.luckSelf != null && r.luckOpp != null)
                ? formatNumber(r.luckSelf - r.luckOpp)
                : '<span class="na">N/A</span>';
            const resultClass =
                r.result === 'WIN' ? 'result-win'
                : r.result === 'LOSS' ? 'result-loss'
                : 'result-draw';
            const hiddenCls = idx >= MOBILE_CAP ? ' class="hidden-mobile"' : '';
            html += `
                <tr${hiddenCls}>
                    <td>${date}</td>
                    <td><a href="${dashboardUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
                    <td><span class="pg-lt pg-lt-${escapeHtml(r.leagueType)}">${escapeHtml(r.leagueType)}</span></td>
                    <td><img class="flag" src="${flagUrl(getFlagCode(r.opponent, _mergedCustomFlags))}" alt="flag"> ${playerNameLink(r.opponent, _allMeta[r.opponent])}</td>
                    <td>${r.scoreSelf}–${r.scoreOpp}</td>
                    <td>${pr}</td>
                    <td>${prOpp}</td>
                    <td>${luck}</td>
                    <td class="${resultClass}">${r.result}${r._technical ? ' <small>(T)</small>' : ''}</td>
                </tr>
            `;
        }
        html += '</tbody></table></div>';
        host.innerHTML = html;
        attachPlayerNameInteractions(host, null);

        const expandBtn = host.querySelector('.pg-matches-expand');
        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                const showAll = expandBtn.dataset.expanded === 'false';
                host.querySelectorAll('tr.hidden-mobile').forEach(tr => {
                    tr.classList.toggle('hidden-mobile-expanded', showAll);
                });
                expandBtn.dataset.expanded = showAll ? 'true' : 'false';
                expandBtn.textContent = showAll ? `Show only ${MOBILE_CAP}` : `Show all ${rows.length} matches`;
            });
        }

        host.querySelectorAll('th[data-key]').forEach(th => {
            th.addEventListener('click', () => {
                const k = th.dataset.key;
                if (k === sortKey) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortKey = k;
                    sortDir = 'asc';
                }
                renderAll();
            });
        });
    }

    yearSel.addEventListener('change', renderAll);
    typeSel.addEventListener('change', renderAll);
    countSel.addEventListener('change', renderAll);
    renderAll();
}

// ---- helpers ----

function labelWrap(label, el) {
    const w = document.createElement('label');
    w.className = 'pg-filter';
    w.innerHTML = `<span>${label}</span>`;
    w.appendChild(el);
    return w;
}

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
}

function showMatchRecordsType(body, perLeague, type) {
    const bestPR   = collectPlayerBestPR(perLeague, type);
    const bestLuck = collectPlayerBestLuckFor(perLeague, type);
    const worstLuck = collectPlayerWorstLuckAgainst(perLeague, type);

    body.innerHTML = `
        <div class="pg-mr-stack">
            ${renderPlayerRecordTable('Best PR', 'PR', bestPR)}
            ${renderPlayerRecordTable('Best Luck For', 'Luck Gap', bestLuck)}
            ${renderPlayerRecordTable('Worst Luck Against', 'Luck Gap', worstLuck)}
        </div>`;
}

function renderPlayerRecordTable(title, metricLabel, rows) {
    const bodyHtml = rows.map((r, i) => playerMatchRecordRow(i + 1, r)).join('');
    return `
        <div class="pg-mr-card">
            <h3>${title}</h3>
            <div class="table-wrapper">
                <table class="pg-matches-table pg-mr-table">
                    <thead><tr>
                        <th scope="col">#</th><th scope="col">${thLabel(metricLabel, metricLabel)}</th><th scope="col">${thLabel('Opponent','Opp')}</th>
                        <th scope="col">${thLabel('Score','Sc')}</th><th scope="col">${thLabel('Result','Res')}</th><th scope="col">${thLabel('League','Lg')}</th><th scope="col">${thLabel('Date','Date')}</th>
                    </tr></thead>
                    <tbody>${bodyHtml || '<tr><td colspan="7" class="na">No data</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
}

function playerMatchRecordRow(rank, r) {
    const opponentFlag = flagUrl(getFlagCode(r.opponent, r.customFlags));
    const resultClass = r.result === 'W' ? 'result-win'
                      : r.result === 'L' ? 'result-loss'
                      : 'result-draw';
    return `
        <tr>
            <td>${rank}</td>
            <td>${formatNumber(r.metric)}</td>
            <td><img class="flag" src="${opponentFlag}" alt="flag"> ${playerNameLink(r.opponent, _allMeta[r.opponent])}</td>
            <td>${r.scoreSelf}-${r.scoreOpp}</td>
            <td><span class="${resultClass}">${r.result}</span></td>
            <td><a href="${leagueUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
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
