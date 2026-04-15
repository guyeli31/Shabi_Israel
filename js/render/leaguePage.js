/**
 * leaguePage.js — Render league summary table on league.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { colorForValue, colorForValueInverted, colorForGames, colorForLevel } from '../compute/colorScale.js';
import { getQueryParam, formatPercent, formatNumber, flagUrl, getFlagCode, playerUrl, dashboardUrl } from '../utils/helpers.js';
import { renderBreadcrumbs } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';

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
        const [{ params, matches, lastModified, totalPlayers, allPlayers }, playersMeta] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata()
        ]);
        const leagueConfig = getLeagueConfig(params);

        // Update page title
        const title = params.LeagueTitle || leagueId;
        document.getElementById('page-title').textContent = title;
        document.title = title + ' — Shabi Israel';

        // Breadcrumbs
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: dashboardUrl(leagueId) },
            { label: 'League Table' }
        ]);

        // Show last updated below title
        renderLastUpdated(lastModified);

        // Widen container for league types with many columns (e.g. UBC has 11)
        if (leagueConfig.type === 'ubc') {
            document.querySelector('.page-container').classList.add('wide-table');
        }

        const statsMap = computeAllStats(matches, allPlayers);
        const rankings = buildRankings(statsMap, leagueConfig);
        const averages = computeAverages(rankings, leagueConfig);
        const matchStats = computeMatchStats(rankings, totalPlayers);

        renderSummaryTable(container, rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta);
        setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta);

        const exportBtn = document.getElementById('leagueExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => exportLeagueTableImage(title));
        }
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

function renderSummaryTable(container, rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta = {}) {
    const columns = getColumns(leagueConfig);
    const extents = getColumnExtents(rankings, columns);
    const goldCount = params.GoldCount || 1;
    const silverCount = params.SilverCount || 1;
    const bronzeCount = params.BronzeCount || 4;

    const headerCells = columns.map((col, i) =>
        `<th scope="col" data-col="${i}">${col.label} <span class="sort-icon">&#x25B2;</span></th>`
    ).join('\n                        ');

    let html = `
    <div class="img-export-group" style="margin-bottom:var(--space-sm);text-align:right">
        <button class="img-export-btn" id="leagueExportBtn">Export Image</button>
    </div>
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="leagueTable">
                <thead>
                    <tr>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody id="leagueBody">`;

    html += renderDataRows(rankings, extents, params, leagueId, goldCount, silverCount, bronzeCount, columns, leagueConfig, playersMeta);
    html += renderAverageRow(averages, columns, leagueConfig);
    html += renderStatRow(matchStats, columns.length);

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}

function getRankClass(rank, goldCount, silverCount, bronzeCount) {
    if (rank >= 1 && rank <= goldCount) return 'rank-gold';
    if (rank > goldCount && rank <= goldCount + silverCount) return 'rank-silver';
    if (rank > goldCount + silverCount && rank <= goldCount + silverCount + bronzeCount) return 'rank-bronze';
    return '';
}

function getMedalHtml(rank, goldCount, silverCount, bronzeCount) {
    if (rank >= 1 && rank <= goldCount) return `<span class="medal medal-gold">${rank}</span>`;
    if (rank > goldCount && rank <= goldCount + silverCount) return `<span class="medal medal-silver">${rank}</span>`;
    if (rank > goldCount + silverCount && rank <= goldCount + silverCount + bronzeCount) return `<span class="medal medal-bronze">${rank}</span>`;
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

function renderDataRows(rankings, extents, params, leagueId, goldCount, silverCount, bronzeCount, columns, leagueConfig, playersMeta = {}) {
    const retiredPlayers = params.RetiredPlayers || [];
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
        const isRetired = retiredPlayers.includes(r.player);
        const rankClass = (isUnplayed ? 'unplayed' : getRankClass(r.originalRank, goldCount, silverCount, bronzeCount))
            + (isRetired ? ' retired' : '');
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        const pUrl = playerUrl(leagueId, r.player);

        if (isUnplayed) {
            html += `
                    <tr class="${rankClass}">`;
            for (const col of columns) {
                if (col.key === 'rank') {
                    html += `<td>${r.originalRank}</td>`;
                } else if (col.key === 'player') {
                    const retiredMark = isRetired ? ' <span class="retired-mark" title="Retired">&#x1F6AA;</span>' : '';
                    const titleAbbrHtml = getTitleAbbreviationsHtml(playersMeta[r.player]);
                    html += `<td class="player-cell" data-name="${r.player}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${pUrl}" title="Open ${r.player}'s card for this league">${r.player}</a>${titleAbbrHtml}${retiredMark}
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
                html += `<td>${getMedalHtml(r.originalRank, goldCount, silverCount, bronzeCount)}</td>`;
            } else if (col.key === 'player') {
                const retiredMark = isRetired ? ' <span class="retired-mark" title="Retired">&#x1F6AA;</span>' : '';
                const titleAbbrHtml2 = getTitleAbbreviationsHtml(playersMeta[r.player]);
                html += `<td class="player-cell" data-name="${r.player}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${pUrl}" title="Open ${r.player}'s card for this league">${r.player}</a>${titleAbbrHtml2}${retiredMark}
                        </td>`;
            } else if (col.key === 'level') {
                if (r.level == null) {
                    html += `<td class="level-cell">\u2014</td>`;
                } else {
                    const levelColor = colorForLevel(r.level);
                    html += `<td class="level-cell color-scaled" style="color:${levelColor}" data-pr="${r.meanPR}">${r.level}</td>`;
                }
            } else {
                const value = r[col.key];
                if (value === null || value === undefined) {
                    html += `<td>\u2014</td>`;
                } else {
                    const color = getCellColor(col.key, value, extents);
                    const formatted = formatCell(col.key, value);
                    const bw = bestWorst[col.key];
                    const isBold = bw && (value === bw.best || value === bw.worst);
                    const content = isBold ? `<b>${formatted}</b>` : formatted;
                    html += `<td class="color-scaled" style="color:${color}">${content}</td>`;
                }
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

function setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta = {}) {
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
            sortAndRerender(rankings, averages, matchStats, params, leagueId, col, currentSortDir, leagueConfig, playersMeta);
        });
    });
}

function sortAndRerender(rankings, averages, matchStats, params, leagueId, col, dir, leagueConfig, playersMeta = {}) {
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

    const goldCount = params.GoldCount || 1;
    const silverCount = params.SilverCount || 1;
    const bronzeCount = params.BronzeCount || 4;
    const extents = getColumnExtents(sorted, columns);
    const body = document.getElementById('leagueBody');
    body.innerHTML = renderDataRows(sorted, extents, params, leagueId, goldCount, silverCount, bronzeCount, columns, leagueConfig, playersMeta)
        + renderAverageRow(averages, columns, leagueConfig)
        + renderStatRow(matchStats, columns.length);
}

// ---- Export Image ----

async function exportLeagueTableImage(title) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    const tableEl = document.getElementById('leagueTable');
    if (!tableEl) return;

    const bodyStyle = getComputedStyle(document.body);
    const themeBg = bodyStyle.backgroundColor;
    const themeColor = bodyStyle.color;
    const themeFont = bodyStyle.fontFamily;
    const tableWidth = tableEl.offsetWidth;

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${themeBg};color:${themeColor};font-family:${themeFont};width:${tableWidth + 48}px;box-sizing:border-box;`;
    const heading = document.createElement('h3');
    heading.style.cssText = 'margin:0 0 12px 0;font-size:20px;';
    heading.textContent = title;
    wrap.appendChild(heading);

    const tableClone = tableEl.cloneNode(true);
    tableClone.querySelectorAll('tr.avg-row, tr.stat-row').forEach(tr => {
        tr.style.position = 'static';
        tr.style.bottom = 'auto';
    });
    tableClone.style.width = tableWidth + 'px';
    const scroll = document.createElement('div');
    scroll.style.cssText = 'max-height:none;overflow:visible;';
    scroll.appendChild(tableClone);
    wrap.appendChild(scroll);
    document.body.appendChild(wrap);

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Table.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}
