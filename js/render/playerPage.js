/**
 * playerPage.js — Render player match history table on player.html.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { getPlayerMatches } from '../data/csvParser.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatNumber, flagUrl, getFlagCode, playerUrl, dashboardUrl, playerGeneralUrl, getLeagueYear, thLabel } from '../utils/helpers.js';
import { renderBreadcrumbs, ensurePlayerIndex } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleBadgesHtml, getHighestTier } from '../data/titleConstants.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';

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
        const [{ params, matches, allPlayers }, allMeta] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata()
        ]);
        const leagueConfig = getLeagueConfig(params);
        const title = params.LeagueTitle || leagueId;
        const flagCode = getFlagCode(playerName, params.CustomFlags);
        const meta = allMeta[playerName] || {};

        // Check if player is retired
        const retiredPlayers = params.RetiredPlayers || [];
        const isRetired = retiredPlayers.includes(playerName);
        const retiredBadge = isRetired ? ' <span class="retired-badge">Retired</span>' : '';

        // Activity dot (league-context: green=running, orange=current year completed, gray=old)
        const running = params.Running === true;
        const CURRENT_YEAR = new Date().getFullYear();
        const leagueYear = getLeagueYear({ params, id: leagueId });
        let dotClass, dotTitle;
        if (running) {
            dotClass = 'pg-dot pg-dot-green';
            dotTitle = 'Active in this running league';
        } else if (leagueYear === CURRENT_YEAR) {
            dotClass = 'pg-dot pg-dot-orange';
            dotTitle = `League from ${CURRENT_YEAR}, now completed`;
        } else {
            dotClass = 'pg-dot pg-dot-gray';
            dotTitle = 'Completed league';
        }
        const dotHtml = `<span class="pg-dot-wrap" tabindex="0" data-tip="${escapeHtml(dotTitle)}"><span class="${dotClass}" aria-label="${escapeHtml(dotTitle)}"></span></span>`;

        // Optional avatar
        const avatarHtml = meta.photoPath
            ? `<img class="pg-avatar" src="${escapeHtml(meta.photoPath)}" alt="${escapeHtml(playerName)}">`
            : '';

        // Flag
        const flagHtml = `<img class="flag-title" src="${flagUrl(flagCode)}" alt="${flagCode}" title="${flagCode}">`;

        // Title badges (BMAB + championship) — RIGHT of name
        const titleBadgesHtml = getTitleBadgesHtml(meta);

        // Full name alias
        const aliasHtml = meta.fullName
            ? `<div class="pg-player-alias">${escapeHtml(meta.fullName)}</div>`
            : '';

        // Highest tier for name color
        const highestTier = getHighestTier(meta);

        // Build header matching general card style
        const badgesHtml = (titleBadgesHtml || retiredBadge)
            ? `<div class="pg-badges-line">${titleBadgesHtml}${retiredBadge}</div>`
            : '';
        const pageTitle = document.getElementById('page-title');
        pageTitle.innerHTML = `
            <div class="pg-header-row">
                ${avatarHtml}
                <div class="pg-header-text">
                    <div class="pg-name-line">
                        ${flagHtml} ${dotHtml}
                        <a class="player-name-link pg-player-name" href="${playerGeneralUrl(playerName)}" title="Open general player card">${escapeHtml(playerName)}</a>
                    </div>
                    ${badgesHtml}
                    ${aliasHtml}
                </div>
            </div>
        `;
        pageTitle.classList.remove('pg-titled-gold', 'pg-titled-silver', 'pg-titled-bronze', 'pg-titled-white');
        if (highestTier) pageTitle.classList.add(`pg-titled-${highestTier}`);

        document.getElementById('league-subtitle').textContent = title;
        document.title = `${playerName} — ${title}`;

        // Breadcrumbs
        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: dashboardUrl(leagueId) },
            { label: playerName }
        ]);

        const playerMatches = getPlayerMatches(matches, playerName, allPlayers);
        renderMatchTable(container, playerMatches, params, leagueId, playerName, leagueConfig, allMeta);
        setupSorting(playerMatches, params, leagueId, playerName, leagueConfig);

        // "Also plays in" — load cross-league index
        renderAlsoPlaysIn(container, playerName, leagueId);
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
        { key: 'opponent', label: 'Opponent', abbr: 'Opp' },
        { key: 'date', label: 'Date', abbr: 'Date' },
        { key: 'scoreSelf', label: 'Score', abbr: 'Sc' },
    ];
    if (config.showPR) {
        cols.push({ key: 'prSelf', label: 'PR', abbr: 'PR' });
        cols.push({ key: 'prOpp', label: 'Opp PR', abbr: 'oPR' });
    }
    if (config.showLuck) {
        cols.push({ key: 'luckDiff', label: 'Luck', abbr: 'Lk' });
    }
    if (config.playerResultMode === 'points') {
        cols.push({ key: 'matchPoints', label: 'Points', abbr: 'Pts' });
    } else {
        cols.push({ key: 'result', label: 'Result', abbr: 'Res' });
    }
    return cols;
}

function renderMatchTable(container, playerMatches, params, leagueId, playerName, leagueConfig, allMeta) {
    const columns = getPlayerColumns(leagueConfig);

    const headerCells = columns.map((col, i) =>
        `<th scope="col" data-col="${i}">${thLabel(col.label, col.abbr)} <span class="sort-icon">&#x25B2;</span></th>`
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

    html += renderMatchRows(playerMatches, params, leagueId, leagueConfig, columns, allMeta);
    html += renderPlayerAverages(playerMatches, leagueConfig, columns);

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
    attachPlayerNameInteractions(container, leagueId);
}

function renderMatchRows(playerMatches, params, leagueId, leagueConfig, columns, allMeta = {}) {
    let html = '';

    for (const m of playerMatches) {
        const flagCode = getFlagCode(m.opponent, params.CustomFlags);
        const oppUrl = playerUrl(leagueId, m.opponent);

        if (!m.played) {
            html += `<tr class="unplayed">`;
            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                const lbl = col.label;
                if (col.key === 'opponent') {
                    html += `<td class="player-cell" data-label="${lbl}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            ${playerNameLink(m.opponent, allMeta[m.opponent])}
                        </td>`;
                } else if (i === columns.length - 1) {
                    html += `<td data-label="${lbl}">Not played</td>`;
                } else {
                    html += `<td data-label="${lbl}"></td>`;
                }
            }
            html += `</tr>`;
            continue;
        }

        // Determine result
        const isTechnical = m._technical || false;
        let resultClass, resultText;
        if (m._draw) {
            resultClass = 'result-draw'; resultText = 'DRAW';
        } else if (m.scoreSelf > m.scoreOpp) {
            resultClass = 'result-win'; resultText = 'WIN';
        } else if (m.scoreSelf < m.scoreOpp) {
            resultClass = 'result-loss'; resultText = 'LOSS';
        } else {
            resultClass = 'result-draw'; resultText = 'DRAW';
        }

        // Compute match points for UBC mode
        const matchWin = m.scoreSelf > m.scoreOpp ? 1 : 0;
        const prWin = (!isTechnical && m.prSelf < m.prOpp) ? 1 : 0;
        const matchPoints = matchWin + prWin;

        // Bold the better value in head-to-head
        const boldScore = (v, other) => v > other ? `<b>${v}</b>` : v;
        const boldPR = (v, other) => v < other ? `<b>${formatNumber(v)}</b>` : formatNumber(v);

        const luckDiff = isTechnical ? 0 : (m.luckSelf - m.luckOpp);
        const luckHtml = isTechnical ? '—' : (luckDiff > 0 ? `<b>${formatNumber(luckDiff)}</b>` : formatNumber(luckDiff));

        html += `
                    <tr>`;
        for (const col of columns) {
            const lbl = col.label;
            switch (col.key) {
                case 'date': {
                    const dateStr = m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-GB') : '—';
                    html += `<td data-label="${lbl}">${dateStr}</td>`;
                    break;
                }
                case 'opponent':
                    html += `<td class="player-cell" data-label="${lbl}">
                            <img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}">
                            ${playerNameLink(m.opponent, allMeta[m.opponent])}
                        </td>`;
                    break;
                case 'scoreSelf': {
                    if (isTechnical) {
                        html += `<td data-label="${lbl}">—</td>`;
                    } else {
                        const scoreStr = `${m.scoreSelf}-${m.scoreOpp}`;
                        const won = m.scoreSelf > m.scoreOpp;
                        html += `<td data-label="${lbl}">${won ? `<b>${scoreStr}</b>` : scoreStr}</td>`;
                    }
                    break;
                }
                case 'prSelf':
                    html += `<td data-label="${lbl}">${isTechnical ? '—' : boldPR(m.prSelf, m.prOpp)}</td>`;
                    break;
                case 'prOpp':
                    html += `<td data-label="${lbl}">${isTechnical ? '—' : boldPR(m.prOpp, m.prSelf)}</td>`;
                    break;
                case 'luckDiff':
                    html += `<td data-label="${lbl}">${luckHtml}</td>`;
                    break;
                case 'result':
                    html += `<td class="${resultClass}" data-label="${lbl}">${resultText}${isTechnical ? ' <small>(T)</small>' : ''}</td>`;
                    break;
                case 'matchPoints': {
                    const ptClass = matchPoints === 2 ? 'result-win' : matchPoints === 0 ? 'result-loss' : '';
                    html += `<td class="${ptClass}" data-label="${lbl}">${matchPoints}</td>`;
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

    // PR/Luck averages — exclude technical matches (null PR/Luck values)
    const nonTechnical = played.filter(m => !m._technical);
    const nt = nonTechnical.length;
    const avgPR = nt > 0 ? nonTechnical.reduce((s, m) => s + m.prSelf, 0) / nt : null;
    const avgOppPR = nt > 0 ? nonTechnical.reduce((s, m) => s + m.prOpp, 0) / nt : null;
    const avgLuckDiff = nt > 0 ? nonTechnical.reduce((s, m) => s + (m.luckSelf - m.luckOpp), 0) / nt : null;

    // UBC points
    const totalPoints = played.reduce((s, m) => {
        const matchWin = m.scoreSelf > m.scoreOpp ? 1 : 0;
        const prWin = (!m._technical && m.prSelf < m.prOpp) ? 1 : 0;
        return s + matchWin + prWin;
    }, 0);
    const avgPointsVal = (totalPoints / n).toFixed(2);

    // Build stat line for the last column: "X games" + stat value
    const statLine = leagueConfig.playerResultMode === 'points'
        ? `${n} games<br>${avgPointsVal} avg pts`
        : `${n} games<br>${winRate}% wins`;

    let html = `<tr class="avg-row">`;
    for (const col of columns) {
        const lbl = col.label;
        switch (col.key) {
            case 'date':
                html += `<td data-label="${lbl}"></td>`;
                break;
            case 'opponent':
                html += `<td data-label="Summary"><b>AVERAGES</b></td>`;
                break;
            case 'scoreSelf':
                html += `<td data-label="${lbl}"></td>`;
                break;
            case 'prSelf':
                html += `<td data-label="${lbl}">${avgPR !== null ? formatNumber(avgPR) : '—'}</td>`;
                break;
            case 'prOpp':
                html += `<td data-label="${lbl}">${avgOppPR !== null ? formatNumber(avgOppPR) : '—'}</td>`;
                break;
            case 'luckDiff':
                html += `<td data-label="${lbl}">${avgLuckDiff !== null ? formatNumber(avgLuckDiff) : '—'}</td>`;
                break;
            case 'result':
            case 'matchPoints':
                html += `<td data-label="${lbl}">${statLine}</td>`;
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

        if (key === 'date') {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return dir === 'asc' ? at - bt : bt - at;
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

// ---- E6: Also plays in ----

async function renderAlsoPlaysIn(container, playerName, currentLeagueId) {
    try {
        const index = await ensurePlayerIndex();
        const leagues = index.get(playerName) || [];
        const otherLeagues = leagues.filter(l => l.leagueId !== currentLeagueId);

        if (otherLeagues.length === 0) return;

        const div = document.createElement('div');
        div.className = 'also-plays-in';
        div.innerHTML = `
            <h3>Also plays in</h3>
            <div class="also-plays-links">
                ${otherLeagues.map(l =>
                    `<a href="${playerUrl(l.leagueId, playerName)}">${escapeHtml(l.title)}</a>`
                ).join('')}
            </div>
        `;
        container.appendChild(div);
    } catch {
        // Silently fail — non-critical feature
    }
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
}
