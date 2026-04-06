/**
 * leaguePage.js — Render league summary table on league.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
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
        const { params, matches, lastModified, totalPlayers, allPlayers } = await loadLeague(leagueId);
        const leagueConfig = getLeagueConfig(params);

        // Update page title
        const title = params.LeagueTitle || leagueId;
        document.getElementById('page-title').textContent = title;
        document.title = title + ' — Shabi Israel';

        // Show last updated below title
        renderLastUpdated(lastModified);

        const statsMap = computeAllStats(matches, allPlayers);
        const rankings = buildRankings(statsMap, leagueConfig);
        const averages = computeAverages(rankings, leagueConfig);
        const matchStats = computeMatchStats(rankings, totalPlayers);

        renderSummaryTable(container, rankings, averages, matchStats, params, leagueId, leagueConfig);
        setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load league: ${err.message}</div>`;
    }
}

function renderLastUpdated(lastModified) {
    if (!lastModified) return;
    const date = new Date(lastModified);
    const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = 'last-updated';
    el.textContent = `Last updated: ${formatted}`;
    document.querySelector('.page-header').appendChild(el);
}

/**
 * Build the ordered list of columns for the league table based on config.
 * Each column: { key, sortKey, label }
 */
function getColumns(config) {
    const cols = [
        { key: 'rank', sortKey: 'rank', label: 'Rank' },
        { key: 'player', sortKey: 'player', label: 'Player' },
        { key: 'games', sortKey: 'games', label: 'Games' },
        { key: 'wins', sortKey: 'wins', label: 'Wins' },
        { key: 'losses', sortKey: 'losses', label: 'Losses' },
    ];
    if (config.showWinRate) {
        cols.push({ key: 'winRate', sortKey: 'winRate', label: 'Win Rate' });
    }
    if (config.showPRWins) {
        cols.push({ key: 'prWins', sortKey: 'prWins', label: 'PR Wins' });
        cols.push({ key: 'points', sortKey: 'points', label: 'Points' });
        cols.push({ key: 'avgPoints', sortKey: 'avgPoints', label: 'Avg Points' });
    }
    if (config.showPR) {
        cols.push({ key: 'meanPR', sortKey: 'meanPR', label: 'Mean PR' });
        cols.push({ key: 'level', sortKey: 'meanPR', label: 'Level' });
    }
    if (config.showLuck) {
        cols.push({ key: 'luck', sortKey: 'luck', label: 'Luck' });
    }
    return cols;
}

function getColumnExtents(rankings, columns) {
    const numericKeys = ['games', 'wins', 'losses', 'winRate', 'meanPR', 'luck', 'prWins', 'points', 'avgPoints'];
    const extents = {};
    for (const col of columns) {
        if (!numericKeys.includes(col.key)) continue;
        const values = rankings.map(r => r[col.key]).filter(v => v !== null && v !== undefined);
        extents[col.key] = {
            min: values.length > 0 ? Math.min(...values) : 0,
            max: values.length > 0 ? Math.max(...values) : 0
        };
    }
    return extents;
}

function renderSummaryTable(container, rankings, averages, matchStats, params, leagueId, leagueConfig) {
    const columns = getColumns(leagueConfig);
    const extents = getColumnExtents(rankings, columns);
    const bronzeCount = params.BronzeCount || 4;

    const headerCells = columns.map((col, i) =>
        `<th data-col="${i}">${col.label} <span class="sort-icon">&#x25B2;</span></th>`
    ).join('\n                        ');

    let html = `
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="leagueTable">
                <thead>
                    <tr>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody id="leagueBody">`;

    html += renderDataRows(rankings, extents, params, leagueId, bronzeCount, columns, leagueConfig);
    html += renderAverageRow(averages, columns, leagueConfig);
    html += renderStatRow(matchStats, columns.length);

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

/**
 * Get color for a cell based on the column key.
 * Higher-is-better: games, wins, winRate, luck, prWins, points, avgPoints
 * Lower-is-better: losses, meanPR
 */
function getCellColor(key, value, extents) {
    if (!extents[key]) return '';
    const { min, max } = extents[key];
    switch (key) {
        case 'games': return colorForGames(value);
        case 'losses':
        case 'meanPR':
            return colorForValueInverted(value, min, max);
        default:
            return colorForValue(value, min, max);
    }
}

function formatCell(key, value) {
    switch (key) {
        case 'winRate': return formatPercent(value);
        case 'avgPoints': return formatNumber(value);
        case 'meanPR': return formatNumber(value);
        case 'luck': return formatNumber(value);
        default: return value;
    }
}

function renderDataRows(rankings, extents, params, leagueId, bronzeCount, columns, leagueConfig) {
    // Determine best/worst for bold highlighting
    const boldKeys = ['winRate', 'meanPR', 'luck', 'avgPoints'];
    const bestWorst = {};
    for (const key of boldKeys) {
        if (!extents[key]) continue;
        bestWorst[key] = { best: extents[key].max, worst: extents[key].min };
        if (key === 'meanPR') {
            bestWorst[key] = { best: extents[key].min, worst: extents[key].max };
        }
    }

    let html = '';
    for (const r of rankings) {
        const isUnplayed = r.winRate === null;
        const rankClass = isUnplayed ? 'unplayed' : getRankClass(r.originalRank, bronzeCount);
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        const pUrl = playerUrl(leagueId, r.player);

        if (isUnplayed) {
            html += `
                    <tr class="${rankClass}">`;
            for (const col of columns) {
                if (col.key === 'rank') {
                    html += `<td>${r.originalRank}</td>`;
                } else if (col.key === 'player') {
                    html += `<td class="player-cell" data-name="${r.player}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${pUrl}">${r.player}</a>
                        </td>`;
                } else if (col.key === 'games' || col.key === 'wins' || col.key === 'losses' || col.key === 'prWins') {
                    html += `<td>0</td>`;
                } else if (col.key === 'level') {
                    html += `<td class="level-cell">N/A</td>`;
                } else {
                    html += `<td>N/A</td>`;
                }
            }
            html += `</tr>`;
            continue;
        }

        html += `
                    <tr class="${rankClass}" data-wr="${r.winRate}" data-pr="${r.meanPR}">`;
        for (const col of columns) {
            if (col.key === 'rank') {
                html += `<td>${getMedalHtml(r.originalRank, bronzeCount)}</td>`;
            } else if (col.key === 'player') {
                html += `<td class="player-cell" data-name="${r.player}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${pUrl}">${r.player}</a>
                        </td>`;
            } else if (col.key === 'level') {
                const levelColor = colorForLevel(r.level);
                html += `<td class="level-cell color-scaled" style="color:${levelColor}" data-pr="${r.meanPR}">${r.level}</td>`;
            } else {
                const value = r[col.key];
                const color = getCellColor(col.key, value, extents);
                const formatted = formatCell(col.key, value);
                const bw = bestWorst[col.key];
                const isBold = bw && (value === bw.best || value === bw.worst);
                const content = isBold ? `<b>${formatted}</b>` : formatted;
                html += `<td class="color-scaled" style="color:${color}">${content}</td>`;
            }
        }
        html += `</tr>`;
    }
    return html;
}

function renderAverageRow(averages, columns, leagueConfig) {
    if (!averages) return '';
    let html = `<tr class="avg-row">`;
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col.key === 'rank') {
            // Rank + Player cells combined
            continue;
        }
        if (col.key === 'player') {
            html += `<td colspan="2"><b>AVERAGES</b></td>`;
            continue;
        }
        if (col.key === 'level') {
            html += `<td></td>`;
            continue;
        }
        const value = averages[col.key];
        if (value === undefined || value === null) {
            html += `<td></td>`;
        } else if (col.key === 'winRate') {
            html += `<td>${formatPercent(value)}</td>`;
        } else {
            html += `<td>${formatNumber(value)}</td>`;
        }
    }
    html += `</tr>`;
    return html;
}

function renderStatRow(matchStats, colCount) {
    const pct = formatPercent(matchStats.playedRatio);
    return `
                    <tr class="stat-row">
                        <td colspan="${colCount}">
                            Games Played: ${matchStats.playedMatches} / ${matchStats.totalMatches} (${pct})
                        </td>
                    </tr>`;
}

// ---- Sorting ----

function setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig) {
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
            sortAndRerender(rankings, averages, matchStats, params, leagueId, col, currentSortDir, leagueConfig);
        });
    });
}

function sortAndRerender(rankings, averages, matchStats, params, leagueId, col, dir, leagueConfig) {
    const columns = getColumns(leagueConfig);
    const key = columns[col] ? columns[col].sortKey : 'rank';

    const sorted = [...rankings].sort((a, b) => {
        let va = a[key], vb = b[key];
        // Null values (unplayed) always sort to bottom in user-triggered sorts
        if (va === null && vb === null) return a.player.localeCompare(b.player);
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === 'string') {
            return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return dir === 'asc' ? va - vb : vb - va;
    });

    // Reassign display ranks
    sorted.forEach((r, i) => r.rank = i + 1);

    const bronzeCount = params.BronzeCount || 4;
    const extents = getColumnExtents(sorted, columns);
    const body = document.getElementById('leagueBody');
    body.innerHTML = renderDataRows(sorted, extents, params, leagueId, bronzeCount, columns, leagueConfig)
        + renderAverageRow(averages, columns, leagueConfig)
        + renderStatRow(matchStats, columns.length);
}
