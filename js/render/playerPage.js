/**
 * playerPage.js — Render player match history table on player.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { getPlayerMatches } from '../data/csvParser.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatNumber, flagUrl, getFlagCode, playerUrl } from '../utils/helpers.js';

let currentSortCol = -1;
let currentSortDir = 'asc';

export async function renderPlayerPage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');
    const playerName = getQueryParam('player');

    if (!leagueId || !playerName) {
        container.innerHTML = '<div class="error">Missing league or player parameter.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading player data...</div>';

    try {
        const { params, matches, allPlayers } = await loadLeague(leagueId);
        const leagueConfig = getLeagueConfig(params);
        const title = params.LeagueTitle || leagueId;
        const flagCode = getFlagCode(playerName, params.CustomFlags);

        // Update page header
        document.getElementById('page-title').innerHTML =
            `<img class="flag-title" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerName}`;
        document.getElementById('league-subtitle').textContent = title;
        document.title = `${playerName} — ${title}`;

        // Update back link
        document.getElementById('back-link').href =
            `league.html?league=${encodeURIComponent(leagueId)}`;

        const playerMatches = getPlayerMatches(matches, playerName, allPlayers);
        renderMatchTable(container, playerMatches, params, leagueId, playerName, leagueConfig);
        setupSorting(playerMatches, params, leagueId, playerName, leagueConfig);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load player data: ${err.message}</div>`;
    }
}

/**
 * Build ordered column list for player table based on config.
 * Each column: { key, label }
 */
function getPlayerColumns(config) {
    const cols = [
        { key: 'opponent', label: 'Opponent' },
        { key: 'scoreSelf', label: 'Score' },
        { key: 'scoreOpp', label: 'Opp Score' },
    ];
    if (config.showPR) {
        cols.push({ key: 'prSelf', label: 'PR' });
        cols.push({ key: 'prOpp', label: 'Opp PR' });
    }
    if (config.showLuck) {
        cols.push({ key: 'luckDiff', label: 'Luck' });
    }
    if (config.playerResultMode === 'points') {
        cols.push({ key: 'matchPoints', label: 'Points' });
    } else {
        cols.push({ key: 'result', label: 'Result' });
    }
    return cols;
}

function renderMatchTable(container, playerMatches, params, leagueId, playerName, leagueConfig) {
    const columns = getPlayerColumns(leagueConfig);

    const headerCells = columns.map((col, i) =>
        `<th data-col="${i}">${col.label} <span class="sort-icon">&#x25B2;</span></th>`
    ).join('\n                        ');

    let html = `
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="playerTable">
                <thead>
                    <tr>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody id="playerBody">`;

    html += renderMatchRows(playerMatches, params, leagueId, leagueConfig, columns);
    html += renderPlayerAverages(playerMatches, leagueConfig, columns);

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}

function renderMatchRows(playerMatches, params, leagueId, leagueConfig, columns) {
    let html = '';

    for (const m of playerMatches) {
        const flagCode = getFlagCode(m.opponent, params.CustomFlags);
        const oppUrl = playerUrl(leagueId, m.opponent);

        if (!m.played) {
            html += `
                    <tr class="unplayed">
                        <td class="player-cell">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${oppUrl}">${m.opponent}</a>
                        </td>`;
            // Empty cells for all columns except opponent and last (result/points)
            for (let i = 1; i < columns.length - 1; i++) {
                html += `<td></td>`;
            }
            html += `<td>Not played</td>
                    </tr>`;
            continue;
        }

        // Determine result
        let resultClass, resultText;
        if (m.scoreSelf > m.scoreOpp) {
            resultClass = 'result-win'; resultText = 'WIN';
        } else if (m.scoreSelf < m.scoreOpp) {
            resultClass = 'result-loss'; resultText = 'LOSS';
        } else {
            resultClass = 'result-draw'; resultText = 'DRAW';
        }

        // Compute match points for UBC mode
        const matchWin = m.scoreSelf > m.scoreOpp ? 1 : 0;
        const prWin = m.prSelf < m.prOpp ? 1 : 0;
        const matchPoints = matchWin + prWin;

        // Bold the better value in head-to-head
        const boldScore = (v, other) => v > other ? `<b>${v}</b>` : v;
        const boldPR = (v, other) => v < other ? `<b>${formatNumber(v)}</b>` : formatNumber(v);

        const luckDiff = m.luckSelf - m.luckOpp;
        const luckHtml = luckDiff > 0 ? `<b>${formatNumber(luckDiff)}</b>` : formatNumber(luckDiff);

        html += `
                    <tr>`;
        for (const col of columns) {
            switch (col.key) {
                case 'opponent':
                    html += `<td class="player-cell">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${oppUrl}">${m.opponent}</a>
                        </td>`;
                    break;
                case 'scoreSelf':
                    html += `<td>${boldScore(m.scoreSelf, m.scoreOpp)}</td>`;
                    break;
                case 'scoreOpp':
                    html += `<td>${boldScore(m.scoreOpp, m.scoreSelf)}</td>`;
                    break;
                case 'prSelf':
                    html += `<td>${boldPR(m.prSelf, m.prOpp)}</td>`;
                    break;
                case 'prOpp':
                    html += `<td>${boldPR(m.prOpp, m.prSelf)}</td>`;
                    break;
                case 'luckDiff':
                    html += `<td>${luckHtml}</td>`;
                    break;
                case 'result':
                    html += `<td class="${resultClass}">${resultText}</td>`;
                    break;
                case 'matchPoints': {
                    const ptClass = matchPoints === 2 ? 'result-win' : matchPoints === 0 ? 'result-loss' : '';
                    html += `<td class="${ptClass}">${matchPoints}</td>`;
                    break;
                }
            }
        }
        html += `</tr>`;
    }

    return html;
}

function renderPlayerAverages(playerMatches, leagueConfig, columns) {
    const played = playerMatches.filter(m => m.played);
    if (played.length === 0) return '';

    const n = played.length;
    const wins = played.filter(m => m.scoreSelf > m.scoreOpp).length;
    const winRate = ((wins / n) * 100).toFixed(1);

    // PR/Luck averages
    const avgPR = played.reduce((s, m) => s + m.prSelf, 0) / n;
    const avgOppPR = played.reduce((s, m) => s + m.prOpp, 0) / n;
    const avgLuckDiff = played.reduce((s, m) => s + (m.luckSelf - m.luckOpp), 0) / n;

    // UBC points
    const totalPoints = played.reduce((s, m) => {
        const matchWin = m.scoreSelf > m.scoreOpp ? 1 : 0;
        const prWin = m.prSelf < m.prOpp ? 1 : 0;
        return s + matchWin + prWin;
    }, 0);
    const avgPointsVal = (totalPoints / n).toFixed(2);

    let html = `<tr class="avg-row">`;
    for (const col of columns) {
        switch (col.key) {
            case 'opponent':
                html += `<td><b>AVERAGES</b></td>`;
                break;
            case 'scoreSelf':
                if (leagueConfig.playerResultMode === 'points') {
                    html += `<td colspan="2">${avgPointsVal} avg pts</td>`;
                } else {
                    html += `<td colspan="2">${winRate}% wins</td>`;
                }
                break;
            case 'scoreOpp':
                // Consumed by colspan above
                break;
            case 'prSelf':
                html += `<td>${formatNumber(avgPR)}</td>`;
                break;
            case 'prOpp':
                html += `<td>${formatNumber(avgOppPR)}</td>`;
                break;
            case 'luckDiff':
                html += `<td>${formatNumber(avgLuckDiff)}</td>`;
                break;
            case 'result':
                html += `<td>${played.length} games</td>`;
                break;
            case 'matchPoints':
                html += `<td>${played.length} games</td>`;
                break;
        }
    }
    html += `</tr>`;
    return html;
}

// ---- Sorting ----

function setupSorting(playerMatches, params, leagueId, playerName, leagueConfig) {
    const table = document.getElementById('playerTable');
    if (!table) return;

    table.querySelectorAll('thead th').forEach(th => {
        th.addEventListener('click', () => {
            const col = parseInt(th.dataset.col);
            if (col === currentSortCol) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = 'asc';
            }
            sortAndRerender(playerMatches, params, leagueId, col, currentSortDir, leagueConfig);
        });
    });
}

function sortAndRerender(playerMatches, params, leagueId, col, dir, leagueConfig) {
    const columns = getPlayerColumns(leagueConfig);
    const colDef = columns[col];
    if (!colDef) return;
    const key = colDef.key;

    const sorted = [...playerMatches].sort((a, b) => {
        // Unplayed always at bottom
        if (!a.played && !b.played) return 0;
        if (!a.played) return 1;
        if (!b.played) return -1;

        if (key === 'result') {
            const resultOrder = m => m.scoreSelf > m.scoreOpp ? 2 : m.scoreSelf === m.scoreOpp ? 1 : 0;
            const va = resultOrder(a), vb = resultOrder(b);
            return dir === 'asc' ? va - vb : vb - va;
        }

        if (key === 'matchPoints') {
            const pts = m => (m.scoreSelf > m.scoreOpp ? 1 : 0) + (m.prSelf < m.prOpp ? 1 : 0);
            const va = pts(a), vb = pts(b);
            return dir === 'asc' ? va - vb : vb - va;
        }

        if (key === 'luckDiff') {
            const va = a.luckSelf - a.luckOpp;
            const vb = b.luckSelf - b.luckOpp;
            return dir === 'asc' ? va - vb : vb - va;
        }

        if (key === 'opponent') {
            return dir === 'asc' ? a.opponent.localeCompare(b.opponent) : b.opponent.localeCompare(a.opponent);
        }

        const va = a[key];
        const vb = b[key];
        return dir === 'asc' ? va - vb : vb - va;
    });

    const body = document.getElementById('playerBody');
    body.innerHTML = renderMatchRows(sorted, params, leagueId, leagueConfig, columns)
        + renderPlayerAverages(sorted, leagueConfig, columns);
}
