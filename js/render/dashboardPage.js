/**
 * dashboardPage.js — League Dashboard (Phase F).
 * F1: summary cards (with leader flag)
 * F2: historical view — defaults to current state showing medal winners only
 * F3: rounds navigator — all matches incl. unplayed, with "played on" column
 * F4: player picker + interactive bar chart, with multi-chart compare
 * Plus: prev/next league navigation arrows in the header.
 */

import { loadLeagueParams, loadLeagueOrder, loadOverrides, loadAllLeagueParams } from '../data/leagueLoader.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { loadMatchHistory, getMatchesAsOf, getUpdateDates, mergeHistoryIntoMatches, matchKey } from '../compute/matchHistory.js';
import { parseCSVAllWithRounds, parseCSV, getAllPlayersFromCSV } from '../data/csvParser.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatPercent, formatNumber, leagueUrl, playerUrl, dashboardUrl, flagUrl, getFlagCode } from '../utils/helpers.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { renderBreadcrumbs } from './navigation.js';

export async function renderDashboardPage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');
    if (!leagueId) {
        container.innerHTML = '<div class="error">No league specified.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading dashboard...</div>';

    try {
        const encoded = encodeURIComponent(leagueId);
        const csvResp = await fetch(`leagues/${encoded}/leaguedata.csv`);
        const csvText = await csvResp.text();
        const lastModified = csvResp.headers.get('Last-Modified') || null;

        const [params, overrides, history, leagueOrder] = await Promise.all([
            loadLeagueParams(leagueId),
            loadOverrides(leagueId),
            loadMatchHistory(leagueId),
            loadLeagueOrder().catch(() => [])
        ]);

        // Per-type navigation requires params of all leagues
        const folderNamesAll = (leagueOrder || []).map(t => t.replace(' - ', ' '));
        let allParams = [];
        try {
            allParams = await loadAllLeagueParams(folderNamesAll);
        } catch { allParams = []; }

        const title = params.LeagueTitle || leagueId;
        document.getElementById('page-title').textContent = `${title}`;
        document.title = `${title} — Dashboard`;

        // Breadcrumbs
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title }
        ]);

        installLeagueNavArrows(leagueId, allParams, params.LeagueType || 'doubling');

        // Parse CSV — both with-unplayed and only-played variants
        const parsedAll = parseCSVAllWithRounds(csvText);
        const allMatchesIncUnplayed = parsedAll.matches;
        const playedMatches = parseCSV(csvText);
        const allPlayersSet = getAllPlayersFromCSV(csvText);

        const leagueConfig = getLeagueConfig(params);
        const liveMatches = mergeHistoryIntoMatches(playedMatches, history.matches);

        const ctx = {
            leagueId, params, leagueConfig, lastModified,
            allMatchesIncUnplayed, playedMatches, liveMatches, allPlayersSet,
            roundCount: parsedAll.roundCount,
            history
        };

        container.innerHTML = renderShell();
        renderSummaryCards(ctx);
        renderHistorical(ctx);
        renderRounds(ctx);
        renderPlayerSection(ctx);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load dashboard: ${err.message}</div>`;
        console.error(err);
    }
}

function installLeagueNavArrows(leagueId, allParams, currentType) {
    if (!allParams || allParams.length === 0) return;
    // Filter to same league type only — preserves chronological order from leagues_order.json
    const sameType = allParams.filter(({ params }) => (params.LeagueType || 'doubling') === currentType);
    const folders = sameType.map(({ id }) => id);
    const idx = folders.indexOf(leagueId);
    if (idx === -1) return;

    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.league-nav')) return;

    const prev = idx > 0 ? folders[idx - 1] : null;
    const next = idx < folders.length - 1 ? folders[idx + 1] : null;

    const nav = document.createElement('div');
    nav.className = 'league-nav';
    nav.innerHTML = `
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${dashboardUrl(prev)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${dashboardUrl(next)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    header.querySelector('h1').insertAdjacentElement('afterend', nav);
}

function renderShell() {
    return `
        <div class="dashboard-cards" id="dash-cards"></div>

        <section class="dash-section">
            <h2>Historical view</h2>
            <div class="dash-controls">
                <button id="hist-prev" title="Previous snapshot">&lsaquo;</button>
                <select id="hist-date" title="Select snapshot date"></select>
                <button id="hist-next" title="Next snapshot">&rsaquo;</button>
                <a id="hist-to-full" class="open-full-btn" href="#" title="Open the full league table for the current state">Open full table &rsaquo;</a>
            </div>
            <div id="hist-table"></div>
        </section>

        <section class="dash-section">
            <h2>Rounds</h2>
            <div class="dash-controls">
                <button id="round-prev" title="Previous round">&lsaquo;</button>
                <span class="round-label" id="round-label">Round 1 / 1</span>
                <button id="round-next" title="Next round">&rsaquo;</button>
                <button id="round-all" title="Show all rounds">All</button>
            </div>
            <div id="round-table"></div>
        </section>

        <section class="dash-section">
            <h2>Player insights</h2>
            <div id="charts-container"></div>
            <button id="add-chart" class="add-chart-btn" title="Add another chart for comparison">+ Add chart</button>
        </section>
    `;
}

// ---------- F1 ----------
function renderSummaryCards(ctx) {
    const { params, liveMatches, allPlayersSet, leagueConfig } = ctx;
    const statsMap = computeAllStats(liveMatches, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig);
    const averages = computeAverages(rankings, leagueConfig);
    const matchStats = computeMatchStats(rankings, allPlayersSet.size);

    const leader = rankings.find(r => r.games > 0);
    let leaderHtml = 'N/A';
    if (leader) {
        const flagCode = getFlagCode(leader.player, params.CustomFlags);
        leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}" style="vertical-align:middle"> ${leader.player}`;
    }
    const avgPR = averages && averages.meanPR != null ? formatNumber(averages.meanPR) : 'N/A';
    const startDate = params.StartDate
        ? new Date(params.StartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'N/A';

    const typeLabels = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
    const typeLabel = typeLabels[params.LeagueType] || (params.LeagueType || 'Doubling');

    const cards = [
        { label: 'League Type', value: typeLabel },
        { label: 'Games Played', value: `${matchStats.playedMatches} / ${matchStats.totalMatches}` },
        { label: 'Average PR', value: avgPR },
        { label: 'Leading Player', value: leaderHtml },
        { label: 'Start Date', value: startDate }
    ];

    document.getElementById('dash-cards').innerHTML = cards.map(c => `
        <div class="dash-card">
            <div class="dash-card-label">${c.label}</div>
            <div class="dash-card-value">${c.value}</div>
        </div>
    `).join('');
}

// ---------- F2 ----------
function renderHistorical(ctx) {
    const { history, lastModified, leagueId } = ctx;
    const select = document.getElementById('hist-date');
    const prevBtn = document.getElementById('hist-prev');
    const nextBtn = document.getElementById('hist-next');
    const fullLink = document.getElementById('hist-to-full');
    fullLink.href = leagueUrl(leagueId);

    const historyDates = getUpdateDates(history); // descending
    // Build options: "Current" first (always), then history dates
    const currentLabel = lastModified
        ? `Current (Last updated: ${formatLastModified(lastModified)})`
        : 'Current';
    const options = [{ value: '__current__', label: currentLabel }];
    for (const d of historyDates) options.push({ value: d, label: d });

    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    function update() {
        const idx = select.selectedIndex;
        prevBtn.disabled = idx <= 0;
        nextBtn.disabled = idx >= options.length - 1;
        drawHistTable(ctx, select.value);
    }

    select.addEventListener('change', update);
    prevBtn.addEventListener('click', () => {
        if (select.selectedIndex > 0) { select.selectedIndex--; update(); }
    });
    nextBtn.addEventListener('click', () => {
        if (select.selectedIndex < options.length - 1) { select.selectedIndex++; update(); }
    });

    update();
}

function formatLastModified(s) {
    const d = new Date(s);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function drawHistTable(ctx, dateValue) {
    const { history, allPlayersSet, leagueConfig, liveMatches, params } = ctx;

    let matchesForView;
    if (dateValue === '__current__') {
        matchesForView = liveMatches;
    } else {
        const cutoff = dateValue + 'T23:59:59Z';
        matchesForView = getMatchesAsOf(history, cutoff);
    }

    const statsMap = computeAllStats(matchesForView, allPlayersSet);
    const rankings = buildRankings(statsMap, leagueConfig);

    const goldCount = params.GoldCount || 1;
    const silverCount = params.SilverCount || 1;
    const bronzeCount = params.BronzeCount || 4;
    const medalLimit = goldCount + silverCount + bronzeCount;
    const top = rankings.filter(r => r.rank <= medalLimit && r.games > 0);

    function rankClass(rank) {
        if (rank <= goldCount) return 'rank-gold';
        if (rank <= goldCount + silverCount) return 'rank-silver';
        if (rank <= medalLimit) return 'rank-bronze';
        return '';
    }

    let html = '<table class="dash-table"><thead><tr><th>Rank</th><th class="player-col">Player</th><th>Games</th><th>Wins</th><th>Losses</th>';
    if (leagueConfig.showWinRate) html += '<th>Win Rate</th>';
    if (leagueConfig.showPR) html += '<th>Mean PR</th>';
    html += '</tr></thead><tbody>';
    if (top.length === 0) {
        html += `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">No matches played yet</td></tr>`;
    }
    for (const r of top) {
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        html += `<tr class="${rankClass(r.rank)}">
            <td>${r.rank}</td>
            <td class="player-cell"><img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(r.player)}</td>
            <td>${r.games}</td><td>${r.wins}</td><td>${r.losses}</td>`;
        if (leagueConfig.showWinRate) html += `<td>${r.winRate != null ? formatPercent(r.winRate) : 'N/A'}</td>`;
        if (leagueConfig.showPR) html += `<td>${r.meanPR != null ? formatNumber(r.meanPR) : 'N/A'}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    const host = document.getElementById('hist-table');
    host.innerHTML = html;
    attachPlayerNameInteractions(host, ctx.leagueId);
}

// ---------- F3 ----------
function renderRounds(ctx) {
    const { allMatchesIncUnplayed, roundCount, history, leagueId } = ctx;
    let current = 1;
    let showAll = false;

    // Build a map: matchKey -> updatedAt from history
    const playedAt = new Map();
    for (const h of history.matches) {
        if (h.updatedAt) playedAt.set(matchKey(h.playerA, h.playerB), h.updatedAt);
    }

    const label = document.getElementById('round-label');
    const prev = document.getElementById('round-prev');
    const next = document.getElementById('round-next');
    const all = document.getElementById('round-all');

    function paint() {
        let list;
        if (showAll) {
            label.textContent = `All rounds (${roundCount})`;
            list = allMatchesIncUnplayed;
        } else {
            label.textContent = `Round ${current} / ${roundCount}`;
            list = allMatchesIncUnplayed.filter(m => m.round === current);
        }
        drawRoundTable(list, playedAt, leagueId);
        prev.disabled = showAll || current <= 1;
        next.disabled = showAll || current >= roundCount;
    }

    prev.addEventListener('click', () => { if (current > 1) { current--; paint(); } });
    next.addEventListener('click', () => { if (current < roundCount) { current++; paint(); } });
    all.addEventListener('click', () => { showAll = !showAll; paint(); });

    paint();
}

function drawRoundTable(matches, playedAt, leagueId) {
    let html = '<table class="dash-table"><thead><tr><th class="player-col">Player A</th><th>Score</th><th class="player-col">Player B</th><th>PR A</th><th>PR B</th><th>Luck A</th><th>Luck B</th><th>Played</th></tr></thead><tbody>';
    for (const m of matches) {
        const isPlayed = m.played;
        const updated = playedAt.get(matchKey(m.playerA, m.playerB));
        const playedCell = updated
            ? new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
            : (isPlayed ? '—' : '<span style="color:var(--color-text-muted)">unplayed</span>');
        const rowClass = isPlayed ? '' : 'unplayed-row';
        html += `<tr class="${rowClass}"><td class="player-cell">${playerNameLink(m.playerA)}</td>`
            + `<td>${isPlayed ? m.scoreA + ' - ' + m.scoreB : '—'}</td>`
            + `<td class="player-cell">${playerNameLink(m.playerB)}</td>`
            + `<td>${isPlayed && m.prA != null ? formatNumber(m.prA) : '—'}</td>`
            + `<td>${isPlayed && m.prB != null ? formatNumber(m.prB) : '—'}</td>`
            + `<td>${isPlayed && m.luckA != null ? formatNumber(m.luckA) : '—'}</td>`
            + `<td>${isPlayed && m.luckB != null ? formatNumber(m.luckB) : '—'}</td>`
            + `<td>${playedCell}</td></tr>`;
    }
    if (matches.length === 0) html += '<tr><td colspan="8">No matches</td></tr>';
    html += '</tbody></table>';
    const host = document.getElementById('round-table');
    host.innerHTML = html;
    attachPlayerNameInteractions(host, leagueId);
}

// ---------- F4 ----------
function renderPlayerSection(ctx) {
    const { allPlayersSet, liveMatches, leagueId } = ctx;
    const players = [...allPlayersSet].sort();
    const totalMatchesPerPlayer = players.length - 1;

    const container = document.getElementById('charts-container');

    function buildPanel(initialPlayer) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel';
        panel.innerHTML = `
            <div class="dash-controls">
                <label>Player:</label>
                <select class="player-pick">${players.map(p => `<option value="${p}" ${p === initialPlayer ? 'selected' : ''}>${p}</option>`).join('')}</select>
                <label>Metric:</label>
                <select class="metric-pick">
                    <option value="pr">PR</option>
                    <option value="luck">Luck</option>
                </select>
                <a class="forward-link player-card-link" href="#" title="Open full player card">Open player card &rsaquo;</a>
                <button class="remove-chart" title="Remove this chart" style="margin-left:auto">&times;</button>
            </div>
            <div class="chart-host"></div>
        `;
        container.appendChild(panel);

        const playerSel = panel.querySelector('.player-pick');
        const metricSel = panel.querySelector('.metric-pick');
        const link = panel.querySelector('.player-card-link');
        const host = panel.querySelector('.chart-host');
        const removeBtn = panel.querySelector('.remove-chart');

        function update() {
            const player = playerSel.value;
            link.href = playerUrl(leagueId, player);
            const matches = buildPlayerSeries(liveMatches, player);
            drawPlayerBarChart(host, matches, metricSel.value, totalMatchesPerPlayer);
        }
        playerSel.addEventListener('change', update);
        metricSel.addEventListener('change', update);
        removeBtn.addEventListener('click', () => {
            if (container.children.length > 1) panel.remove();
        });
        update();
    }

    buildPanel(players[0]);

    document.getElementById('add-chart').addEventListener('click', () => {
        buildPanel(players[0]);
    });
}

function buildPlayerSeries(liveMatches, player) {
    return liveMatches
        .filter(m => m.playerA === player || m.playerB === player)
        .map(m => {
            const isA = m.playerA === player;
            return {
                opponent: isA ? m.playerB : m.playerA,
                scoreSelf: isA ? m.scoreA : m.scoreB,
                scoreOpp: isA ? m.scoreB : m.scoreA,
                prSelf: isA ? m.prA : m.prB,
                luckSelf: isA ? m.luckA : m.luckB,
                updatedAt: m.updatedAt || null
            };
        })
        .filter(m => m.scoreSelf != null && (m.scoreSelf > 0 || m.scoreOpp > 0))
        .sort((a, b) => {
            if (!a.updatedAt && !b.updatedAt) return 0;
            if (!a.updatedAt) return 1;
            if (!b.updatedAt) return -1;
            return new Date(a.updatedAt) - new Date(b.updatedAt);
        });
}
