/**
 * leaguePage.js — Render league summary table on league.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { colorForValue, colorForValueInverted, colorForGames, colorForLevel } from '../compute/colorScale.js';
import { getQueryParam, formatPercent, formatNumber, flagUrl, getFlagCode, playerUrl } from '../utils/helpers.js';

let currentSortCol = -1;
let currentSortDir = 'desc';

export async function renderLeaguePage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');

    if (!leagueId) {
        container.innerHTML = '<div class="error">No league specified.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading league data...</div>';

    try {
        const { params, matches } = await loadLeague(leagueId);

        // Update page title
        const title = params.LeagueTitle || leagueId;
        document.getElementById('page-title').textContent = title;
        document.title = title + ' — Shabi Israel';

        const statsMap = computeAllStats(matches);
        const rankings = buildRankings(statsMap);
        const averages = computeAverages(rankings);
        const matchStats = computeMatchStats(rankings);

        renderSummaryTable(container, rankings, averages, matchStats, params, leagueId);
        setupSorting(rankings, averages, matchStats, params, leagueId);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load league: ${err.message}</div>`;
    }
}

function getColumnExtents(rankings) {
    const cols = ['games', 'wins', 'losses', 'winRate', 'meanPR', 'luck'];
    const extents = {};
    for (const col of cols) {
        const values = rankings.map(r => r[col]);
        extents[col] = { min: Math.min(...values), max: Math.max(...values) };
    }
    return extents;
}

function renderSummaryTable(container, rankings, averages, matchStats, params, leagueId) {
    const extents = getColumnExtents(rankings);
    const bronzeCount = params.BronzeCount || 4;

    let html = `
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="leagueTable">
                <thead>
                    <tr>
                        <th data-col="0">Rank <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="1">Player <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="2">Games <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="3">Wins <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="4">Losses <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="5">Win Rate <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="6">Mean PR <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="7">Level <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="8">Luck <span class="sort-icon">&#x25B2;</span></th>
                    </tr>
                </thead>
                <tbody id="leagueBody">`;

    html += renderDataRows(rankings, extents, params, leagueId, bronzeCount);
    html += renderAverageRow(averages);
    html += renderStatRow(matchStats);

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}

function getRankClass(rank, bronzeCount) {
    if (rank === 1) return 'rank-gold';
    if (rank === 2) return 'rank-silver';
    if (rank >= 3 && rank <= 2 + bronzeCount) return 'rank-bronze';
    return '';
}

function getMedalHtml(rank, bronzeCount) {
    if (rank === 1) return `<span class="medal medal-gold">${rank}</span>`;
    if (rank === 2) return `<span class="medal medal-silver">${rank}</span>`;
    if (rank >= 3 && rank <= 2 + bronzeCount) return `<span class="medal medal-bronze">${rank}</span>`;
    return rank;
}

function renderDataRows(rankings, extents, params, leagueId, bronzeCount) {
    let html = '';
    for (const r of rankings) {
        const rankClass = getRankClass(r.rank, bronzeCount);
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        const pUrl = playerUrl(leagueId, r.player);

        const gamesColor = colorForGames(r.games);
        const winsColor = colorForValue(r.wins, extents.wins.min, extents.wins.max);
        const lossesColor = colorForValueInverted(r.losses, extents.losses.min, extents.losses.max);
        const winRateColor = colorForValue(r.winRate, extents.winRate.min, extents.winRate.max);
        const meanPRColor = colorForValueInverted(r.meanPR, extents.meanPR.min, extents.meanPR.max);
        const levelColor = colorForLevel(r.level);
        const luckColor = colorForValue(r.luck, extents.luck.min, extents.luck.max);

        // Bold best/worst
        const isBestWR = r.winRate === extents.winRate.max;
        const isBestPR = r.meanPR === extents.meanPR.min;
        const isBestLuck = r.luck === extents.luck.max;
        const isWorstWR = r.winRate === extents.winRate.min;
        const isWorstPR = r.meanPR === extents.meanPR.max;
        const isWorstLuck = r.luck === extents.luck.min;

        const b = (val, isBest, isWorst) => (isBest || isWorst) ? `<b>${val}</b>` : val;

        html += `
                    <tr class="${rankClass}" data-wr="${r.winRate}" data-pr="${r.meanPR}">
                        <td>${getMedalHtml(r.rank, bronzeCount)}</td>
                        <td class="player-cell" data-name="${r.player}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${pUrl}">${r.player}</a>
                        </td>
                        <td style="color:${gamesColor}">${r.games}</td>
                        <td style="color:${winsColor}">${r.wins}</td>
                        <td style="color:${lossesColor}">${r.losses}</td>
                        <td style="color:${winRateColor}">${b(formatPercent(r.winRate), isBestWR, isWorstWR)}</td>
                        <td style="color:${meanPRColor}">${b(formatNumber(r.meanPR), isBestPR, isWorstPR)}</td>
                        <td class="level-cell" style="color:${levelColor}" data-pr="${r.meanPR}">${r.level}</td>
                        <td style="color:${luckColor}">${b(formatNumber(r.luck), isBestLuck, isWorstLuck)}</td>
                    </tr>`;
    }
    return html;
}

function renderAverageRow(averages) {
    if (!averages) return '';
    return `
                    <tr class="avg-row">
                        <td colspan="2"><b>AVERAGES</b></td>
                        <td>${formatNumber(averages.games)}</td>
                        <td>${formatNumber(averages.wins)}</td>
                        <td>${formatNumber(averages.losses)}</td>
                        <td>${formatPercent(averages.winRate)}</td>
                        <td>${formatNumber(averages.meanPR)}</td>
                        <td></td>
                        <td>${formatNumber(averages.luck)}</td>
                    </tr>`;
}

function renderStatRow(matchStats) {
    const pct = formatPercent(matchStats.playedRatio);
    return `
                    <tr class="stat-row">
                        <td colspan="9">
                            Games Played: ${matchStats.playedMatches} / ${matchStats.totalMatches} (${pct})
                        </td>
                    </tr>`;
}

// ---- Sorting ----

function setupSorting(rankings, averages, matchStats, params, leagueId) {
    const table = document.getElementById('leagueTable');
    if (!table) return;

    table.querySelectorAll('thead th').forEach(th => {
        th.addEventListener('click', () => {
            const col = parseInt(th.dataset.col);
            if (col === currentSortCol) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = col <= 1 ? 'asc' : 'desc';
            }
            sortAndRerender(rankings, averages, matchStats, params, leagueId, col, currentSortDir);
        });
    });
}

function sortAndRerender(rankings, averages, matchStats, params, leagueId, col, dir) {
    const keys = ['rank', 'player', 'games', 'wins', 'losses', 'winRate', 'meanPR', 'meanPR', 'luck'];
    const key = keys[col];

    const sorted = [...rankings].sort((a, b) => {
        let va = a[key], vb = b[key];
        if (typeof va === 'string') {
            return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return dir === 'asc' ? va - vb : vb - va;
    });

    // Reassign display ranks
    sorted.forEach((r, i) => r.rank = i + 1);

    const bronzeCount = params.BronzeCount || 4;
    const extents = getColumnExtents(sorted);
    const body = document.getElementById('leagueBody');
    body.innerHTML = renderDataRows(sorted, extents, params, leagueId, bronzeCount)
        + renderAverageRow(averages)
        + renderStatRow(matchStats);
}
