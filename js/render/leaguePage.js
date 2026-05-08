/**
 * leaguePage.js — Render league summary table on league.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages, computeMatchStats, LEVELS } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { colorForValue, colorForValueInverted, colorForGames, colorForLevel } from '../compute/colorScale.js';
import { getQueryParam, formatPercent, formatNumber, flagUrl, getFlagCode, playerUrl, dashboardUrl, appendExportCredit } from '../utils/helpers.js';
import { renderBreadcrumbs } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { startSplash, endSplash } from '../utils/splash.js';

let currentSortCol = -1;
let currentSortDir = 'desc';
let stickyResizeObserver = null;
let stickyResizeListenerAttached = false;

function measureLeagueStickyCols() {
    const tbl = document.getElementById('leagueTable');
    const scroll = tbl?.closest('.table-scroll');
    if (!tbl || !scroll) return;
    const firstTh = tbl.querySelector('thead th:nth-child(1)');
    if (!firstTh) return;
    const w = firstTh.getBoundingClientRect().width;
    scroll.style.setProperty('--sticky-col-1-width', `${Math.ceil(w)}px`);
}

function bindStickyMeasurement() {
    measureLeagueStickyCols();
    const tbl = document.getElementById('leagueTable');
    if (tbl && typeof ResizeObserver !== 'undefined') {
        stickyResizeObserver?.disconnect();
        stickyResizeObserver = new ResizeObserver(measureLeagueStickyCols);
        stickyResizeObserver.observe(tbl);
    }
    if (!stickyResizeListenerAttached) {
        window.addEventListener('resize', measureLeagueStickyCols);
        stickyResizeListenerAttached = true;
    }
}


export async function renderLeaguePage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');

    if (!leagueId) {
        container.innerHTML = '<div class="error">No league specified.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading league data...</div>';

    startSplash();
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

        // Widen container for league types with many columns (e.g. UBC has 11)
        if (leagueConfig.type === 'ubc') {
            document.querySelector('.page-container').classList.add('wide-table');
        }

        const statsMap = computeAllStats(matches, allPlayers);
        const rankings = buildRankings(statsMap, leagueConfig, matches);
        const averages = computeAverages(rankings, leagueConfig);
        const matchStats = computeMatchStats(rankings, totalPlayers);

        // Header summary lines: Games Played first, then Last updated.
        renderGamesPlayed(matchStats);
        renderLastUpdated(lastModified);

        renderSummaryTable(container, rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta);
        setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta);
        bindStickyMeasurement();

        // Re-render table colors on theme change (colorScale reads isDarkTheme at render time)
        window.addEventListener('themechange', () => {
            sortAndRerender(rankings, averages, matchStats, params, leagueId,
                currentSortCol >= 0 ? currentSortCol : 0,
                currentSortCol >= 0 ? currentSortDir : 'asc',
                leagueConfig, playersMeta);
        });

        const exportBtn = document.getElementById('leagueExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => exportLeagueTableImage(title));
        }
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load league: ${err.message}</div>`;
    } finally {
        endSplash();
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

function renderGamesPlayed(matchStats) {
    if (!matchStats) return;
    const pct = formatPercent(matchStats.playedRatio);
    const el = document.createElement('div');
    el.className = 'games-played';
    el.textContent = `Games Played: ${matchStats.playedMatches} / ${matchStats.totalMatches} (${pct})`;
    document.querySelector('.page-header').appendChild(el);
}

/**
 * Build the ordered list of columns for the league table based on config.
 * Each column: { key, sortKey, label }
 */
function getColumns(config) {
    const cols = [
        { key: 'rank', sortKey: 'rank', label: '#', dataLabel: 'Rank' },
        { key: 'player', sortKey: 'player', label: 'Player', dataLabel: 'Player' },
        { key: 'games', sortKey: 'games', label: 'GP', dataLabel: 'Games' },
        { key: 'wins', sortKey: 'wins', label: 'W', dataLabel: 'Wins' },
        { key: 'losses', sortKey: 'losses', label: 'L', dataLabel: 'Losses' },
    ];
    if (config.showWinRate) {
        cols.push({ key: 'winRate', sortKey: 'winRate', label: 'Win%', dataLabel: 'Win Rate' });
    }
    if (config.showPRWins) {
        cols.push({ key: 'prWins', sortKey: 'prWins', label: 'PRW', dataLabel: 'PR Wins' });
        cols.push({ key: 'points', sortKey: 'points', label: 'PTS', dataLabel: 'Points' });
        cols.push({ key: 'avgPoints', sortKey: 'avgPoints', label: 'Avg PTS', dataLabel: 'Avg Points' });
    }
    if (config.showPR) {
        cols.push({ key: 'meanPR', sortKey: 'meanPR', label: 'PR', dataLabel: 'Mean PR' });
        cols.push({ key: 'level', sortKey: 'meanPR', label: 'Level', dataLabel: 'Level' });
    }
    if (config.showLuck) {
        cols.push({ key: 'luck', sortKey: 'luck', label: 'Luck', dataLabel: 'Luck' });
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

    const headerCells = columns.map((col, i) => {
        if (i === 0) return `<th scope="col" data-col="${i}" style="cursor:default">${col.label}</th>`;
        return `<th scope="col" data-col="${i}">${col.label} <span class="sort-icon">&#x25B2;</span></th>`;
    }).join('\n                        ');

    let html = `
    <div class="img-export-group" style="margin-bottom:var(--space-sm);text-align:right">
        <button class="img-export-btn" id="leagueExportBtn">Export Image</button>
    </div>
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="leagueTable" class="font-small" data-league-type="${leagueConfig.type}">
                <thead>
                    <tr>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody id="leagueBody">`;

    html += renderDataRows(rankings, extents, params, leagueId, goldCount, silverCount, bronzeCount, columns, leagueConfig, playersMeta);
    html += renderAverageRow(averages, columns, leagueConfig);

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

function getMedalHtml(rank, goldCount, silverCount, bronzeCount, displayPos) {
    const show = displayPos !== undefined ? displayPos : rank;
    if (rank >= 1 && rank <= goldCount) return `<span class="medal medal-gold">${show}</span>`;
    if (rank > goldCount && rank <= goldCount + silverCount) return `<span class="medal medal-silver">${show}</span>`;
    if (rank > goldCount + silverCount && rank <= goldCount + silverCount + bronzeCount) return `<span class="medal medal-bronze">${show}</span>`;
    return show;
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
    // Determine best/worst for bold highlighting — bold extremes in all
    // numeric stat columns (semantics of best/worst don't matter for bolding;
    // both min and max get emphasized so the eye catches the outliers).
    const boldKeys = ['games', 'wins', 'losses', 'winRate', 'meanPR', 'luck', 'prWins', 'avgPoints'];
    const bestWorst = {};
    for (const key of boldKeys) {
        if (!extents[key]) continue;
        bestWorst[key] = { best: extents[key].max, worst: extents[key].min };
    }

    // Level edges: bold only the two extreme level labels (best + worst in
    // the LEVELS ladder). If no player falls in either edge level, no cells
    // in the Level column are bolded.
    const levelEdges = new Set([LEVELS[0].label, LEVELS[LEVELS.length - 1].label]);

    let html = '';
    for (let i = 0; i < rankings.length; i++) {
        const r = rankings[i];
        const displayPos = i + 1;
        const isUnplayed = r.winRate === null;
        const isRetired = retiredPlayers.includes(r.player);
        const rankClass = (isUnplayed ? 'unplayed' : getRankClass(r.originalRank, goldCount, silverCount, bronzeCount))
            + (isRetired ? ' retired' : '');
        const flagCode = getFlagCode(r.player, params.CustomFlags);
        const pUrl = playerUrl(leagueId, r.player);

        const isHiddenPlayer = !!(playersMeta[r.player] && playersMeta[r.player].hidden);

        if (isUnplayed) {
            html += `
                    <tr class="${rankClass}">`;
            for (const col of columns) {
                const lbl = col.dataLabel;
                if (col.key === 'rank') {
                    html += `<td data-label="${lbl}">${displayPos}</td>`;
                } else if (col.key === 'player') {
                    const retiredMark = isRetired ? ' <span class="retired-mark" title="Retired">&#x1F6AA;</span>' : '';
                    const playerCell = isHiddenPlayer
                        ? `<i class="player-hidden">N/A</i>`
                        : `<a href="${pUrl}" title="Open ${r.player}'s card for this league">${r.player}</a>${getTitleAbbreviationsHtml(playersMeta[r.player])}${retiredMark}`;
                    html += `<td class="player-cell" data-label="${lbl}" data-name="${r.player}">
                            ${isHiddenPlayer ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`}
                            ${playerCell}
                        </td>`;
                } else if (col.key === 'games' || col.key === 'wins' || col.key === 'losses' || col.key === 'prWins') {
                    html += `<td data-label="${lbl}">0</td>`;
                } else if (col.key === 'level') {
                    html += `<td class="level-cell" data-label="${lbl}">N/A</td>`;
                } else {
                    html += `<td data-label="${lbl}">N/A</td>`;
                }
            }
            html += `</tr>`;
            continue;
        }

        html += `
                    <tr class="${rankClass}" data-wr="${r.winRate}" data-pr="${r.meanPR}">`;
        for (const col of columns) {
            const lbl = col.dataLabel;
            if (col.key === 'rank') {
                html += `<td data-label="${lbl}">${getMedalHtml(r.originalRank, goldCount, silverCount, bronzeCount, displayPos)}</td>`;
            } else if (col.key === 'player') {
                const retiredMark = isRetired ? ' <span class="retired-mark" title="Retired">&#x1F6AA;</span>' : '';
                const playerCell2 = isHiddenPlayer
                    ? `<i class="player-hidden">N/A</i>`
                    : `<a href="${pUrl}" title="Open ${r.player}'s card for this league">${r.player}</a>${getTitleAbbreviationsHtml(playersMeta[r.player])}${retiredMark}`;
                html += `<td class="player-cell" data-label="${lbl}" data-name="${r.player}">
                            ${isHiddenPlayer ? '' : `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">`}
                            ${playerCell2}
                        </td>`;
            } else if (col.key === 'level') {
                if (r.level == null) {
                    html += `<td class="level-cell" data-label="${lbl}">\u2014</td>`;
                } else {
                    const levelColor = colorForLevel(r.level);
                    const levelText = levelEdges.has(r.level) ? `<b>${r.level}</b>` : r.level;
                    html += `<td class="level-cell color-scaled" data-label="${lbl}" style="color:${levelColor}" data-pr="${r.meanPR}">${levelText}</td>`;
                }
            } else {
                const value = r[col.key];
                if (value === null || value === undefined) {
                    html += `<td data-label="${lbl}">\u2014</td>`;
                } else {
                    const color = getCellColor(col.key, value, extents);
                    const formatted = formatCell(col.key, value);
                    const bw = bestWorst[col.key];
                    const isBold = bw && (value === bw.best || value === bw.worst);
                    const content = isBold ? `<b>${formatted}</b>` : formatted;
                    html += `<td class="color-scaled" data-label="${lbl}" style="color:${color}">${content}</td>`;
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
        const lbl = col.label;
        if (col.key === 'rank') {
            html += `<td></td>`;
            continue;
        }
        if (col.key === 'player') {
            html += `<td data-label="Summary"><b>AVERAGES</b></td>`;
            continue;
        }
        if (col.key === 'level') {
            html += `<td data-label="${lbl}"></td>`;
            continue;
        }
        const value = averages[col.key];
        if (value === undefined || value === null) {
            html += `<td data-label="${lbl}"></td>`;
        } else if (col.key === 'winRate') {
            html += `<td data-label="${lbl}">${formatPercent(value)}</td>`;
        } else {
            html += `<td data-label="${lbl}">${formatNumber(value)}</td>`;
        }
    }
    html += `</tr>`;
    return html;
}

// ---- Sorting ----

function setupSorting(rankings, averages, matchStats, params, leagueId, leagueConfig, playersMeta = {}) {
    const table = document.getElementById('leagueTable');
    if (!table) return;

    table.querySelectorAll('thead th').forEach(th => {
        const col = parseInt(th.dataset.col);
        if (col === 0) return; // Rank column is not sortable
        th.addEventListener('click', () => {
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
        + renderAverageRow(averages, columns, leagueConfig);
    measureLeagueStickyCols();
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
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${themeBg};color:${themeColor};font-family:${themeFont};width:${tableWidth + 48}px;box-sizing:border-box;direction:ltr;`;
    const heading = document.createElement('h3');
    heading.style.cssText = 'margin:0 0 12px 0;font-size:20px;';
    heading.textContent = title;
    wrap.appendChild(heading);

    const tableClone = tableEl.cloneNode(true);
    tableClone.querySelectorAll('tr.avg-row, tr.stat-row').forEach(tr => {
        tr.style.position = 'static';
        tr.style.bottom = 'auto';
    });
    // Sticky cells (Rank/Player) pin to the viewport inside the offscreen
    // fixed wrapper, which visually scrambles the column order in the PNG.
    // Neutralize sticky positioning on the clone so the row flows naturally.
    tableClone.querySelectorAll('thead th, tbody td').forEach(cell => {
        cell.style.position = 'static';
        cell.style.left = 'auto';
    });
    tableClone.style.width = tableWidth + 'px';
    const scroll = document.createElement('div');
    scroll.style.cssText = 'max-height:none;overflow:visible;';
    scroll.appendChild(tableClone);
    wrap.appendChild(scroll);
    document.body.appendChild(wrap);
    appendExportCredit(wrap);

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
