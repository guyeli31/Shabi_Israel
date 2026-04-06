/**
 * playerPage.js — Render player match history table on player.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { getPlayerMatches } from '../data/csvParser.js';
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
        const { params, matches } = await loadLeague(leagueId);
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

        const playerMatches = getPlayerMatches(matches, playerName);
        renderMatchTable(container, playerMatches, params, leagueId, playerName);
        setupSorting(playerMatches, params, leagueId, playerName);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load player data: ${err.message}</div>`;
    }
}

function renderMatchTable(container, playerMatches, params, leagueId, playerName) {
    let html = `
    <div class="table-wrapper">
        <div class="table-scroll">
            <table id="playerTable">
                <thead>
                    <tr>
                        <th data-col="0">Opponent <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="1">Score <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="2">Opp Score <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="3">PR <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="4">Opp PR <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="5">Luck <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="6">Opp Luck <span class="sort-icon">&#x25B2;</span></th>
                        <th data-col="7">Result <span class="sort-icon">&#x25B2;</span></th>
                    </tr>
                </thead>
                <tbody id="playerBody">`;

    html += renderMatchRows(playerMatches, params, leagueId);
    html += renderPlayerAverages(playerMatches);

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}

function renderMatchRows(playerMatches, params, leagueId) {
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
                        </td>
                        <td></td><td></td><td></td><td></td><td></td><td></td>
                        <td>Not played</td>
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

        // Bold the better value in head-to-head
        const boldScore = (v, other) => v > other ? `<b>${v}</b>` : v;
        const boldPR = (v, other) => v < other ? `<b>${formatNumber(v)}</b>` : formatNumber(v);
        const boldLuck = (v, other) => v > other ? `<b>${formatNumber(v)}</b>` : formatNumber(v);

        html += `
                    <tr>
                        <td class="player-cell">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            <a href="${oppUrl}">${m.opponent}</a>
                        </td>
                        <td>${boldScore(m.scoreSelf, m.scoreOpp)}</td>
                        <td>${boldScore(m.scoreOpp, m.scoreSelf)}</td>
                        <td>${boldPR(m.prSelf, m.prOpp)}</td>
                        <td>${boldPR(m.prOpp, m.prSelf)}</td>
                        <td>${boldLuck(m.luckSelf, m.luckOpp)}</td>
                        <td>${boldLuck(m.luckOpp, m.luckSelf)}</td>
                        <td class="${resultClass}">${resultText}</td>
                    </tr>`;
    }

    return html;
}

function renderPlayerAverages(playerMatches) {
    const played = playerMatches.filter(m => m.played);
    if (played.length === 0) return '';

    const n = played.length;
    const avgPR = played.reduce((s, m) => s + m.prSelf, 0) / n;
    const avgOppPR = played.reduce((s, m) => s + m.prOpp, 0) / n;
    const avgLuck = played.reduce((s, m) => s + m.luckSelf, 0) / n;
    const avgOppLuck = played.reduce((s, m) => s + m.luckOpp, 0) / n;
    const wins = played.filter(m => m.scoreSelf > m.scoreOpp).length;
    const winRate = ((wins / n) * 100).toFixed(1);

    return `
                    <tr class="avg-row">
                        <td><b>AVERAGES</b></td>
                        <td colspan="2">${winRate}% wins</td>
                        <td>${formatNumber(avgPR)}</td>
                        <td>${formatNumber(avgOppPR)}</td>
                        <td>${formatNumber(avgLuck)}</td>
                        <td>${formatNumber(avgOppLuck)}</td>
                        <td>${played.length} games</td>
                    </tr>`;
}

// ---- Sorting ----

function setupSorting(playerMatches, params, leagueId, playerName) {
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
            sortAndRerender(playerMatches, params, leagueId, col, currentSortDir);
        });
    });
}

function sortAndRerender(playerMatches, params, leagueId, col, dir) {
    const keys = ['opponent', 'scoreSelf', 'scoreOpp', 'prSelf', 'prOpp', 'luckSelf', 'luckOpp', 'result'];

    const sorted = [...playerMatches].sort((a, b) => {
        // Unplayed always at bottom
        if (!a.played && !b.played) return 0;
        if (!a.played) return 1;
        if (!b.played) return -1;

        if (col === 7) {
            // Sort by result: WIN > DRAW > LOSS
            const resultOrder = m => m.scoreSelf > m.scoreOpp ? 2 : m.scoreSelf === m.scoreOpp ? 1 : 0;
            const va = resultOrder(a), vb = resultOrder(b);
            return dir === 'asc' ? va - vb : vb - va;
        }

        const key = keys[col];
        let va = a[key], vb = b[key];

        if (typeof va === 'string') {
            return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return dir === 'asc' ? va - vb : vb - va;
    });

    const body = document.getElementById('playerBody');
    body.innerHTML = renderMatchRows(sorted, params, leagueId) + renderPlayerAverages(sorted);
}
