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
    rankWithinYear,
    collectMedalsByType,
    flattenAllMatches
} from '../compute/crossLeague.js';
import { colorForLevel } from '../compute/colorScale.js';
import {
    getQueryParam, flagUrl, getFlagCode,
    formatNumber, dashboardUrl
} from '../utils/helpers.js';
import { drawPlayerBarChart } from './playerBarChart.js';
import { renderBreadcrumbs } from './navigation.js';

const CURRENT_YEAR = new Date().getFullYear();

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
        const perLeague = await loadPlayerAcrossLeagues(playerName);

        if (perLeague.length === 0) {
            container.innerHTML = `<div class="error">No leagues found for player "${escapeHtml(playerName)}".</div>`;
            return;
        }

        // Header
        renderHeader(playerName, perLeague);
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

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="error">Failed to load data: ${escapeHtml(err.message)}</div>`;
    }
}

// ---- G2: Header ----

function renderHeader(playerName, perLeague) {
    const title = document.getElementById('page-title');
    if (!title) return;

    const isActive = perLeague.some(e => e.league.params?.Running === true);

    // Distinct flag codes from all leagues
    const flagSet = new Set();
    for (const e of perLeague) {
        flagSet.add(getFlagCode(playerName, e.league.params?.CustomFlags));
    }
    const flags = [...flagSet];

    const flagsHtml = flags
        .map(code => `<img class="flag-title" src="${flagUrl(code)}" alt="${code}" title="${code}">`)
        .join('');
    const dot = isActive
        ? '<span class="pg-active-dot" title="Active in a running league"></span>'
        : '';

    title.innerHTML = `${flagsHtml} ${dot} <span class="pg-player-name">${escapeHtml(playerName)}</span>`;

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

        // Year-scoped ranking (current calendar year)
        const [totalYearRank, last300YearRank] = await Promise.all([
            rankWithinYear(playerName, type, CURRENT_YEAR, 'totalPR'),
            rankWithinYear(playerName, type, CURRENT_YEAR, 'last300PR')
        ]);

        const card = document.createElement('div');
        card.className = 'pg-pr-card';
        card.innerHTML = `
            <div class="pg-pr-type">${escapeHtml(type.toUpperCase())}</div>
            <div class="pg-pr-row">
                <div class="pg-pr-metric">
                    <div class="pg-pr-label">Total PR</div>
                    <div class="pg-pr-value">${formatNumber(agg.totalPR)}</div>
                    ${levelBadge(agg.totalLevel)}
                    <div class="pg-pr-rank">${formatYearRank(totalYearRank)}</div>
                </div>
                <div class="pg-pr-metric">
                    <div class="pg-pr-label">Last 300 PR</div>
                    <div class="pg-pr-value">${formatNumber(agg.last300PR)}</div>
                    ${levelBadge(agg.last300Level)}
                    <div class="pg-pr-rank">${formatYearRank(last300YearRank)}</div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }
}

function levelBadge(level) {
    const color = colorForLevel(level);
    return `<span class="pg-level-badge" style="background:${color}">${escapeHtml(level)}</span>`;
}

function formatYearRank(r) {
    if (!r) return `<span class="pg-rank-dim">No ${CURRENT_YEAR} data</span>`;
    return `${CURRENT_YEAR}: <b>${ordinal(r.rank)}</b> / ${r.total}`;
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
    body.innerHTML = `
        <div class="pg-tiles">
            <div class="pg-tile">
                <div class="pg-tile-title">🥇 Gold <span class="pg-tile-rank">(${ordinal(m.goldRank)} / ${total})</span></div>
                <div class="pg-tile-value">${m.self.gold}</div>
            </div>
            <div class="pg-tile">
                <div class="pg-tile-title">🥈 Silver <span class="pg-tile-rank">(${ordinal(m.silverRank)} / ${total})</span></div>
                <div class="pg-tile-value">${m.self.silver}</div>
            </div>
            <div class="pg-tile">
                <div class="pg-tile-title">🥉 Bronze <span class="pg-tile-rank">(${ordinal(m.bronzeRank)} / ${total})</span></div>
                <div class="pg-tile-value">${m.self.bronze}</div>
            </div>
            <div class="pg-tile">
                <div class="pg-tile-title">📊 Avg Rank <span class="pg-tile-rank">(${ordinal(m.avgRankRank)} / ${total})</span></div>
                <div class="pg-tile-value">${isFinite(m.self.avgRank) ? m.self.avgRank.toFixed(1) : '—'}</div>
                <div class="pg-tile-sub">${m.self.participations} league${m.self.participations === 1 ? '' : 's'}</div>
            </div>
        </div>
    `;
}

// ---- G4: League history table ----

function renderLeaguesTable(section, perLeague) {
    let html = `
    <div class="table-wrapper">
        <table class="pg-leagues-table">
            <thead>
                <tr>
                    <th>League</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Games</th>
                    <th>W</th>
                    <th>L</th>
                    <th>Primary</th>
                    <th>Mean PR</th>
                    <th>Rank</th>
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
                <td>${escapeHtml(e.league.leagueType)}</td>
                <td>${running ? '<span class="status-pill running">Running</span>' : '<span class="status-pill completed">Completed</span>'}</td>
                <td>${s.games || 0}</td>
                <td>${s.wins || 0}</td>
                <td>${s.losses || 0}</td>
                <td title="${primaryLabel}">${primary}</td>
                <td>${meanPR}</td>
                <td>${e.playerRank != null ? `${e.playerRank} / ${e.totalPlayers}` : '—'}</td>
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

    controls.appendChild(labelWrap('Year', yearSel));
    controls.appendChild(labelWrap('Type', typeSel));
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
        return allRows.filter(r => {
            if (yv !== 'all' && r.year !== parseInt(yv, 10)) return false;
            if (tv !== 'all' && r.leagueType !== tv) return false;
            return true;
        });
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
            { key: 'updatedAt', label: 'Date' },
            { key: 'leagueTitle', label: 'League' },
            { key: 'leagueType', label: 'Type' },
            { key: 'opponent', label: 'Opponent' },
            { key: 'scoreSelf', label: 'Score' },
            { key: 'prSelf', label: 'PR' },
            { key: 'prOpp', label: 'Opp PR' },
            { key: 'luckSelf', label: 'Luck' },
            { key: 'result', label: 'Result' }
        ];
        let html = '<table class="pg-matches-table"><thead><tr>';
        for (const h of headers) {
            const arrow = sortKey === h.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            html += `<th data-key="${h.key}">${h.label}${arrow}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (const r of rows) {
            const date = r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB') : '—';
            const pr = (r.prSelf != null && !r._technical) ? formatNumber(r.prSelf) : '<span class="na">N/A</span>';
            const prOpp = (r.prOpp != null && !r._technical) ? formatNumber(r.prOpp) : '<span class="na">N/A</span>';
            const luck = (!r._technical && r.luckSelf != null && r.luckOpp != null)
                ? formatNumber(r.luckSelf - r.luckOpp)
                : '<span class="na">N/A</span>';
            const resultClass =
                r.result === 'WIN' ? 'result-win'
                : r.result === 'LOSS' ? 'result-loss'
                : 'result-draw';
            html += `
                <tr>
                    <td>${date}</td>
                    <td><a href="${dashboardUrl(r.leagueId)}">${escapeHtml(r.leagueTitle)}</a></td>
                    <td>${escapeHtml(r.leagueType)}</td>
                    <td>${escapeHtml(r.opponent)}</td>
                    <td>${r.scoreSelf}–${r.scoreOpp}</td>
                    <td>${pr}</td>
                    <td>${prOpp}</td>
                    <td>${luck}</td>
                    <td class="${resultClass}">${r.result}${r._technical ? ' <small>(T)</small>' : ''}</td>
                </tr>
            `;
        }
        html += '</tbody></table>';
        host.innerHTML = html;

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
