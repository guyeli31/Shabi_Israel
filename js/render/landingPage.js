/**
 * landingPage.js — Render the index dashboard (Phase H).
 *
 * Sections:
 *   H4 — General info cards (total players, total leagues, last updated)
 *   H3 — Player search
 *   H1 — Active leagues (card grid) + completed leagues (compact table)
 *   H2 — Annual leaderboard tables (per year × league type)
 */

import { loadAllLeagues } from '../compute/crossLeague.js';
import { dashboardUrl, flagUrl, getFlagCode, playerGeneralUrl, formatPercent, formatNumber } from '../utils/helpers.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
import { ensurePlayerIndex } from './navigation.js';
import { isLoggedIn } from '../admin/auth.js';
import { isPreviewMode } from '../admin/previewMode.js';

/* ── Helpers ─────────────────────────────────────────── */

const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const MONTH_SHORT = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
];

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Extract year and month from a league folder id.
 * "Shabi Israel April 2026" → { year: 2026, monthIndex: 3, monthShort: "Apr" }
 */
function parseLeagueDate(folderId) {
    const parts = folderId.split(' ');
    const year = parseInt(parts[parts.length - 1], 10);
    const monthName = parts[parts.length - 2];
    const monthIndex = MONTHS.indexOf(monthName);
    return { year, monthIndex, monthShort: MONTH_SHORT[monthIndex] || monthName };
}

/* ── Main entry ──────────────────────────────────────── */

export async function renderLandingPage() {
    const container = document.getElementById('content');
    container.innerHTML = '<div class="loading">Loading leagues...</div>';

    try {
        const allLeagues = await loadAllLeagues();

        // Filter hidden leagues for non-admin users
        const adminLoggedIn = isLoggedIn() && !isPreviewMode();
        const leagues = adminLoggedIn
            ? allLeagues
            : allLeagues.filter(l => !l.params.Hidden);

        // Compute aggregate data
        const allPlayers = new Set();
        const activePlayers = new Set();
        let latestModified = null;

        for (const l of leagues) {
            for (const p of l.allPlayers) {
                allPlayers.add(p);
                if (l.params.Running === true) activePlayers.add(p);
            }
            if (l.lastModified) {
                const d = new Date(l.lastModified);
                if (!latestModified || d > latestModified) latestModified = d;
            }
        }

        // Extract leader per league
        const leaguesWithLeaders = leagues.map(l => {
            const leader = l.rankings.length > 0 && l.rankings[0].games > 0
                ? l.rankings[0] : null;
            return { ...l, leader };
        });

        const running = leaguesWithLeaders.filter(l => l.params.Running === true);
        const completed = leaguesWithLeaders.filter(l => l.params.Running !== true);

        // Build annual leaderboards
        const leaderboards = buildAllLeaderboards(leagues);

        // Render
        container.innerHTML = '';

        renderInfoCards(container, activePlayers.size, allPlayers.size, leagues.length, latestModified);
        renderPlayerSearch(container);
        renderActiveLeagues(container, running);
        if (completed.length > 0) renderCompletedLeagues(container, completed);
        renderLeaderboards(container, leaderboards);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load leagues: ${err.message}</div>`;
    }
}

/* ── H4 — Info cards ─────────────────────────────────── */

function renderInfoCards(container, activePlayers, totalPlayers, totalLeagues, lastUpdated) {
    const section = document.createElement('div');
    section.className = 'index-info-cards';

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          + ' ' + lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : 'N/A';

    section.innerHTML = `
        <div class="dash-card">
            <div class="dash-card-label">Active Players</div>
            <div class="dash-card-value">${activePlayers}</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-label">Total Players</div>
            <div class="dash-card-value">${totalPlayers}</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-label">Total Leagues</div>
            <div class="dash-card-value">${totalLeagues}</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-label">Last Updated</div>
            <div class="dash-card-value" style="font-size:1.1rem">${lastUpdatedStr}</div>
        </div>`;

    container.appendChild(section);
}

/* ── H3 — Player search ──────────────────────────────── */

function renderPlayerSearch(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'index-search';
    wrapper.innerHTML = `
        <span class="index-search-icon">&#128269;</span>
        <input class="index-search-input" type="text"
               placeholder="Search player..." autocomplete="off">
        <ul class="index-search-results" hidden></ul>`;

    container.appendChild(wrapper);

    const input = wrapper.querySelector('.index-search-input');
    const results = wrapper.querySelector('.index-search-results');

    input.addEventListener('focus', () => { ensurePlayerIndex(); }, { once: true });

    input.addEventListener('input', async () => {
        const query = input.value.trim().toLowerCase();
        if (query.length < 2) { results.hidden = true; return; }

        const index = await ensurePlayerIndex();
        const matches = [];
        for (const [name, leagues] of index) {
            if (name.toLowerCase().includes(query)) {
                matches.push({ name, leagues });
                if (matches.length >= 10) break;
            }
        }

        if (matches.length === 0) {
            results.innerHTML = '<li class="search-empty">No players found</li>';
            results.hidden = false;
            return;
        }

        results.innerHTML = matches.map(m => {
            const hint = m.leagues.length === 1 ? m.leagues[0].title : `${m.leagues.length} leagues`;
            return `<li><a href="${playerGeneralUrl(m.name)}">
                <span class="search-player-name">${escapeHtml(m.name)}</span>
                <span class="search-league-hint">${escapeHtml(hint)}</span>
            </a></li>`;
        }).join('');
        results.hidden = false;
    });

    // Close on click outside
    document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) results.hidden = true;
    });
}

/* ── H1 — Active leagues ─────────────────────────────── */

function renderActiveLeagues(container, running) {
    const section = document.createElement('div');
    section.className = 'dash-section';

    let cardsHtml = '';
    for (const l of running) {
        const typeLabel = TYPE_LABELS[l.leagueType] || l.leagueType;
        const typeClass = `type-${l.leagueType}`;

        let leaderHtml = '<span style="color:var(--color-text-muted)">—</span>';
        if (l.leader) {
            const flagCode = getFlagCode(l.leader.player, l.params.CustomFlags);
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(l.leader.player)}`;
        }

        cardsHtml += `
            <div class="league-card" data-league-id="${escapeHtml(l.id)}">
                <div class="league-card-title">
                    <a href="${dashboardUrl(l.id)}">${escapeHtml(l.title)}</a>
                </div>
                <div class="league-card-meta">
                    <span class="league-type-pill ${typeClass}">${typeLabel}</span>
                    <span class="status-pill status-running">Running</span>
                </div>
                <div class="league-card-leader">Leader: ${leaderHtml}</div>
            </div>`;
    }

    section.innerHTML = `
        <h2>Active Leagues</h2>
        <div class="active-leagues-wrapper">
            <button class="scroll-arrow scroll-arrow-left" hidden>&lsaquo;</button>
            <div class="active-leagues-grid">${cardsHtml || '<p style="color:var(--color-text-muted)">No active leagues</p>'}</div>
            <button class="scroll-arrow scroll-arrow-right" hidden>&rsaquo;</button>
        </div>`;

    // Attach context menus to leader player links in each card
    for (const l of running) {
        if (l.leader) {
            const card = section.querySelector(`.league-card[data-league-id="${CSS.escape(l.id)}"]`);
            if (card) attachPlayerNameInteractions(card, l.id);
        }
    }

    // Setup horizontal scroll arrows
    setupScrollArrows(section);

    container.appendChild(section);
}

function setupScrollArrows(section) {
    const wrapper = section.querySelector('.active-leagues-wrapper');
    if (!wrapper) return;
    const grid = wrapper.querySelector('.active-leagues-grid');
    const leftBtn = wrapper.querySelector('.scroll-arrow-left');
    const rightBtn = wrapper.querySelector('.scroll-arrow-right');

    function updateArrows() {
        const overflows = grid.scrollWidth > grid.clientWidth + 2;
        leftBtn.hidden = !overflows || grid.scrollLeft <= 0;
        rightBtn.hidden = !overflows || grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 2;
    }

    leftBtn.addEventListener('click', () => {
        grid.scrollBy({ left: -300, behavior: 'smooth' });
    });
    rightBtn.addEventListener('click', () => {
        grid.scrollBy({ left: 300, behavior: 'smooth' });
    });
    grid.addEventListener('scroll', updateArrows);

    // Check after render
    requestAnimationFrame(updateArrows);
    window.addEventListener('resize', updateArrows);
}

/* ── Completed leagues (compact table) ────────────────── */

function renderCompletedLeagues(container, completed) {
    const section = document.createElement('div');
    section.className = 'dash-section';

    // Parse dates and sort chronologically (newest first)
    const withDates = completed.map(l => {
        const { year, monthIndex, monthShort } = parseLeagueDate(l.id);
        return { ...l, year, monthIndex, monthShort };
    });
    withDates.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.monthIndex - a.monthIndex;
    });

    // Determine default open state: open if any league is from current year (2026+)
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = withDates.some(l => l.year >= currentYear);
    const collapsed = hasCurrentYear ? '' : ' collapsed';

    let rowsHtml = '';
    for (const l of withDates) {
        const dateStr = `${l.monthShort} ${l.year}`;
        let leaderHtml = '—';
        if (l.leader) {
            const flagCode = getFlagCode(l.leader.player, l.params.CustomFlags);
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(l.leader.player)}`;
        }
        rowsHtml += `
            <tr data-league-id="${escapeHtml(l.id)}">
                <td>${dateStr}</td>
                <td><a href="${dashboardUrl(l.id)}">${escapeHtml(l.title)}</a></td>
                <td>${leaderHtml}</td>
            </tr>`;
    }

    section.innerHTML = `
        <div class="collapsible-section${collapsed}">
            <h2 class="collapsible-header">Completed Leagues</h2>
            <div class="collapsible-body">
                <div class="completed-table-wrapper">
                    <table class="completed-leagues-table">
                        <thead><tr><th>Date</th><th>League</th><th>Winner</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    // Attach collapsible toggle
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    // Attach context menu to winner player links
    for (const l of withDates) {
        if (l.leader) {
            const row = section.querySelector(`tr[data-league-id="${CSS.escape(l.id)}"]`);
            if (row) attachPlayerNameInteractions(row, l.id);
        }
    }

    container.appendChild(section);
}

/* ── H2 — Annual leaderboards ─────────────────────────── */

/**
 * Group leagues by (year, leagueType) and aggregate per-player stats.
 */
function buildAllLeaderboards(leagues) {
    // Parse dates and group
    const groups = new Map(); // key: "year|type" → { year, leagueType, config, entries }
    for (const l of leagues) {
        const { year, monthIndex, monthShort } = parseLeagueDate(l.id);
        if (isNaN(year) || monthIndex < 0) continue;

        const key = `${year}|${l.leagueType}`;
        if (!groups.has(key)) {
            groups.set(key, {
                year,
                leagueType: l.leagueType,
                config: l.config,
                entries: []
            });
        }
        groups.get(key).entries.push({
            monthIndex,
            monthShort,
            statsMap: l.statsMap,
            params: l.params
        });
    }

    // Build leaderboard per group
    const leaderboards = [];
    for (const [, group] of groups) {
        leaderboards.push(buildAnnualLeaderboard(group));
    }

    // Sort: newest year first, then by type (doubling first)
    const typeOrder = { doubling: 0, regular: 1, ubc: 2 };
    leaderboards.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return (typeOrder[a.leagueType] || 9) - (typeOrder[b.leagueType] || 9);
    });

    return leaderboards;
}

function buildAnnualLeaderboard(group) {
    const { year, leagueType, config, entries } = group;
    const isUBC = leagueType === 'ubc';

    // Sort entries by month
    entries.sort((a, b) => a.monthIndex - b.monthIndex);
    const months = entries.map(e => e.monthShort);

    // Aggregate per player
    const playerData = new Map(); // name → { monthly, totalWins/totalPoints, totalGames, prSum, prCount, customFlags }
    for (const entry of entries) {
        for (const [player, stats] of entry.statsMap) {
            if (!playerData.has(player)) {
                playerData.set(player, {
                    monthly: {},
                    totalWins: 0,
                    totalPoints: 0,
                    totalGames: 0,
                    prSum: 0,
                    prCount: 0,
                    customFlags: {}
                });
            }
            const pd = playerData.get(player);

            if (stats.games > 0) {
                const val = isUBC ? stats.points : stats.wins;
                pd.monthly[entry.monthShort] = (pd.monthly[entry.monthShort] || 0) + val;
                pd.totalWins += stats.wins;
                pd.totalPoints += stats.points || 0;
                pd.totalGames += stats.games;
                if (stats.meanPR !== null) {
                    pd.prSum += stats.meanPR * stats.games;
                    pd.prCount += stats.games;
                }
            }

            // Capture custom flags
            if (entry.params.CustomFlags) {
                Object.assign(pd.customFlags, entry.params.CustomFlags);
            }
        }
    }

    // Build rows
    const rows = [];
    for (const [player, pd] of playerData) {
        if (pd.totalGames === 0) continue;
        const total = isUBC ? pd.totalPoints : pd.totalWins;
        const winRate = pd.totalGames > 0 ? pd.totalWins / pd.totalGames : 0;
        const meanPR = pd.prCount > 0 ? pd.prSum / pd.prCount : null;
        const avgPoints = pd.totalGames > 0 ? pd.totalPoints / pd.totalGames : 0;
        const flagCode = getFlagCode(player, pd.customFlags);

        rows.push({
            player,
            flagCode,
            monthly: pd.monthly,
            total,
            totalGames: pd.totalGames,
            winRate,
            meanPR,
            avgPoints
        });
    }

    // Sort
    if (isUBC) {
        rows.sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (a.meanPR !== null && b.meanPR !== null && a.meanPR !== b.meanPR)
                return a.meanPR - b.meanPR;
            return 0;
        });
    } else {
        rows.sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            if (a.meanPR !== null && b.meanPR !== null && a.meanPR !== b.meanPR)
                return a.meanPR - b.meanPR;
            return 0;
        });
    }

    // Assign ranks
    rows.forEach((r, i) => { r.rank = i + 1; });

    const typeName = TYPE_LABELS[leagueType] || leagueType;
    return { year, leagueType, typeName, months, rows, isUBC };
}

function renderLeaderboards(container, leaderboards) {
    const currentYear = new Date().getFullYear();

    for (const lb of leaderboards) {
        const section = document.createElement('div');
        section.className = 'leaderboard-section';

        const metricLabel = lb.isUBC ? 'Points' : 'Wins';
        const showWinRate = !lb.isUBC;
        const showAvgPoints = lb.isUBC;
        const collapsed = lb.year >= currentYear ? '' : ' collapsed';

        // Header row
        let thMonths = lb.months.map(m => `<th class="month-col">${m}</th>`).join('');
        let thExtra = `<th class="total-col">Total</th>`;
        if (showWinRate) thExtra += `<th>Win Rate</th>`;
        if (showAvgPoints) thExtra += `<th>Avg Pts</th>`;
        thExtra += `<th>Mean PR</th>`;

        // Data rows
        let rowsHtml = '';
        for (const row of lb.rows) {
            let rankClass = '';
            if (row.rank === 1) rankClass = 'rank-gold';
            else if (row.rank === 2) rankClass = 'rank-silver';
            else if (row.rank === 3) rankClass = 'rank-bronze';

            const monthCells = lb.months.map(m => {
                const val = row.monthly[m];
                return `<td class="month-col">${val != null ? val : '–'}</td>`;
            }).join('');

            let extraCells = `<td class="total-col">${row.total}</td>`;
            if (showWinRate) extraCells += `<td>${formatPercent(row.winRate)}</td>`;
            if (showAvgPoints) extraCells += `<td>${formatNumber(row.avgPoints)}</td>`;
            extraCells += `<td>${row.meanPR !== null ? formatNumber(row.meanPR) : 'N/A'}</td>`;

            rowsHtml += `
                <tr class="${rankClass}">
                    <td>${row.rank}</td>
                    <td class="player-cell">
                        <img class="flag" src="${flagUrl(row.flagCode)}" alt="${row.flagCode}">
                        ${playerNameLink(row.player)}
                    </td>
                    ${monthCells}
                    ${extraCells}
                </tr>`;
        }

        const title = `${lb.year} ${lb.typeName} Leaderboard`;

        section.innerHTML = `
            <div class="collapsible-section${collapsed}">
                <div class="leaderboard-header-row">
                    <h2 class="collapsible-header">${title}</h2>
                    <div class="pdf-export-group">
                        <button class="pdf-export-btn" data-mode="full">Export PDF</button>
                        <button class="pdf-export-btn pdf-export-top" data-mode="top10">Top 10</button>
                    </div>
                </div>
                <div class="collapsible-body">
                    <div class="leaderboard-table-wrapper">
                        <table class="leaderboard-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th class="player-col">Player</th>
                                    ${thMonths}
                                    ${thExtra}
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;

        // Collapsible toggle
        const header = section.querySelector('.collapsible-header');
        header.addEventListener('click', () => {
            header.closest('.collapsible-section').classList.toggle('collapsed');
        });

        // PDF export buttons
        section.querySelectorAll('.pdf-export-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = btn.dataset.mode;
                const maxRows = mode === 'top10' ? 10 : lb.rows.length;
                exportLeaderboardPDF(lb, title, maxRows);
            });
        });

        container.appendChild(section);
    }
}

function exportLeaderboardPDF(lb, title, maxRows) {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library not loaded. Please try again.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(14);
    doc.text(title, 14, 15);

    const showWinRate = !lb.isUBC;
    const showAvgPoints = lb.isUBC;

    // Build header
    const headers = ['#', 'Player', ...lb.months, 'Total'];
    if (showWinRate) headers.push('Win Rate');
    if (showAvgPoints) headers.push('Avg Pts');
    headers.push('Mean PR');

    // Build body
    const body = [];
    const rows = lb.rows.slice(0, maxRows);
    for (const row of rows) {
        const cells = [
            row.rank,
            row.player,
            ...lb.months.map(m => row.monthly[m] != null ? row.monthly[m] : '–'),
            row.total
        ];
        if (showWinRate) cells.push(formatPercent(row.winRate));
        if (showAvgPoints) cells.push(formatNumber(row.avgPoints));
        cells.push(row.meanPR !== null ? formatNumber(row.meanPR) : 'N/A');
        body.push(cells);
    }

    doc.autoTable({
        head: [headers],
        body,
        startY: 22,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 30 } }
    });

    const fileName = title.replace(/\s+/g, '_') + (maxRows < lb.rows.length ? `_Top${maxRows}` : '') + '.pdf';
    doc.save(fileName);
}
