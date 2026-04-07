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
import { buildAllTimeRankings } from '../compute/allTimeRankings.js';
import { dashboardUrl, flagUrl, getFlagCode, formatPercent, formatNumber } from '../utils/helpers.js';
import { playerNameLink, attachPlayerNameInteractions } from './playerNameInteraction.js';
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
        renderActiveLeagues(container, running);
        if (completed.length > 0) renderCompletedLeagues(container, completed);
        renderLeaderboards(container, leaderboards);

        // Discover league types present in the dataset for Achievements + PR Leaders.
        const presentTypes = [...new Set(leagues.map(l => l.leagueType))];
        renderAchievementsSection(container, presentTypes);
        renderPRLeadersSection(container, presentTypes);
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

    // Parse dates and sort chronologically (newest first).
    // Prefer explicit IssueDate from params; fall back to folder-name parsing.
    const withDates = completed.map(l => {
        let year, monthIndex, monthShort, day;
        if (l.params.IssueDate) {
            const d = new Date(l.params.IssueDate);
            year = d.getUTCFullYear();
            monthIndex = d.getUTCMonth();
            monthShort = MONTH_SHORT[monthIndex];
            day = d.getUTCDate();
        } else {
            ({ year, monthIndex, monthShort } = parseLeagueDate(l.id));
            day = 1;
        }
        return { ...l, year, monthIndex, monthShort, day };
    });
    withDates.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.monthIndex !== b.monthIndex) return b.monthIndex - a.monthIndex;
        return b.day - a.day;
    });

    // Determine default open state: open if any league is from current year (2026+)
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = withDates.some(l => l.year >= currentYear);
    const collapsed = hasCurrentYear ? '' : ' collapsed';

    let rowsHtml = '';
    for (const l of withDates) {
        const dateStr = l.params.IssueDate
            ? `${l.day} ${l.monthShort} ${l.year}`
            : `${l.monthShort} ${l.year}`;
        let leaderHtml = '—';
        if (l.leader) {
            const flagCode = getFlagCode(l.leader.player, l.params.CustomFlags);
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${playerNameLink(l.leader.player)}`;
        }
        const typeLabel = TYPE_LABELS[l.leagueType] || l.leagueType;
        const typeCell = `<span class="league-type-pill type-${l.leagueType}">${typeLabel}</span>`;
        rowsHtml += `
            <tr class="row-type-${l.leagueType}" data-league-id="${escapeHtml(l.id)}">
                <td>${dateStr}</td>
                <td><a href="${dashboardUrl(l.id)}">${escapeHtml(l.title)}</a></td>
                <td>${typeCell}</td>
                <td>${leaderHtml}</td>
            </tr>`;
    }

    section.innerHTML = `
        <div class="collapsible-section${collapsed}">
            <h2 class="collapsible-header">Completed Leagues</h2>
            <div class="collapsible-body">
                <div class="completed-table-wrapper">
                    <table class="completed-leagues-table">
                        <thead><tr><th>Date</th><th>League</th><th>Type</th><th>Winner</th></tr></thead>
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

        const defaultRows = Math.min(10, lb.rows.length);
        section.innerHTML = `
            <div class="collapsible-section${collapsed}">
                <div class="leaderboard-header-row">
                    <h2 class="collapsible-header">${title}</h2>
                    <div class="img-export-group">
                        <label class="img-export-label">Top
                            <input class="img-export-rows" type="number"
                                   min="1" max="${lb.rows.length}" value="${defaultRows}">
                        </label>
                        <button class="img-export-btn">Export Image</button>
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

        // Image export
        const exportBtn = section.querySelector('.img-export-btn');
        const rowsInput = section.querySelector('.img-export-rows');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let maxRows = parseInt(rowsInput.value, 10);
            if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;
            if (maxRows > lb.rows.length) maxRows = lb.rows.length;
            exportLeaderboardImage(lb, title, maxRows);
        });
        // Don't toggle collapsible when interacting with the export controls.
        section.querySelector('.img-export-group').addEventListener('click', e => e.stopPropagation());

        container.appendChild(section);
    }
}

async function exportLeaderboardImage(lb, title, maxRows) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }

    const showWinRate = !lb.isUBC;
    const showAvgPoints = lb.isUBC;

    // Build header
    let thMonths = lb.months.map(m => `<th class="month-col">${m}</th>`).join('');
    let thExtra = `<th class="total-col">Total</th>`;
    if (showWinRate) thExtra += `<th>Win Rate</th>`;
    if (showAvgPoints) thExtra += `<th>Avg Pts</th>`;
    thExtra += `<th>Mean PR</th>`;

    // Build body
    let bodyHtml = '';
    const rows = lb.rows.slice(0, maxRows);
    for (const row of rows) {
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

        bodyHtml += `
            <tr class="${rankClass}">
                <td>${row.rank}</td>
                <td class="player-cell">
                    <img class="flag" src="${flagUrl(row.flagCode)}" alt="${row.flagCode}">
                    ${escapeHtml(row.player)}
                </td>
                ${monthCells}
                ${extraCells}
            </tr>`;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-10000px;top:0;background:#ffffff;padding:24px;font-family:sans-serif;';
    wrap.innerHTML = `
        <h3 style="margin:0 0 12px 0;font-size:20px;color:#1e293b;">${escapeHtml(title)}</h3>
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
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>`;
    document.body.appendChild(wrap);

    try {
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Top${maxRows}.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}

/* ── Achievements (all-time per league type) ─────────── */

const TYPE_ORDER = ['doubling', 'regular', 'ubc'];
const ACHIEVEMENT_METRICS = [
    { key: 'gold',    label: 'Gold',     fmt: v => v },
    { key: 'silver',  label: 'Silver',   fmt: v => v },
    { key: 'bronze',  label: 'Bronze',   fmt: v => v },
    { key: 'avgRank', label: 'Avg Rank', fmt: v => formatNumber(v) }
];

function sortPresentTypes(types) {
    return [...types].sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a);
        const bi = TYPE_ORDER.indexOf(b);
        return (ai < 0 ? 9 : ai) - (bi < 0 ? 9 : bi);
    });
}

function renderAchievementsSection(container, presentTypes) {
    const types = sortPresentTypes(presentTypes);
    if (types.length === 0) return;

    const section = document.createElement('div');
    section.className = 'dash-section achievements-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">Achievements</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    // Collapsible toggle
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    // Tab switching
    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
        });
    });

    container.appendChild(section);

    // Populate panels lazily — fire all in parallel.
    types.forEach(async (t) => {
        const panel = section.querySelector(`.achv-panel[data-type="${t}"]`);
        try {
            const data = await buildAllTimeRankings(t);
            panel.innerHTML = renderAchievementTables(data);
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderAchievementTables(data) {
    return `<div class="achv-tables-grid">${ACHIEVEMENT_METRICS.map(m => {
        const rows = data.rankings[m.key] || [];
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td>${playerNameLink(r.name)}</td>
                <td>${m.fmt(r.value)}</td>
            </tr>
        `).join('');
        return `
            <div class="achv-table-card">
                <h3>${m.label}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table">
                        <thead><tr><th>#</th><th>Player</th><th>${m.label}</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="3">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('')}</div>`;
}

/* ── PR Leaders (Total PR + Last 300 PR) ───────────── */

const PR_METRICS = [
    { key: 'totalPR',   label: 'Total PR' },
    { key: 'last300PR', label: 'Last 300 PR' }
];

function renderPRLeadersSection(container, presentTypes) {
    // Only league types with PR (doubling, ubc).
    const types = sortPresentTypes(presentTypes).filter(t => t === 'doubling' || t === 'ubc');
    if (types.length === 0) return;

    const section = document.createElement('div');
    section.className = 'dash-section pr-leaders-section';

    const tabsHtml = types.map((t, i) => {
        const label = TYPE_LABELS[t] || t;
        return `<button class="achv-tab${i === 0 ? ' active' : ''}" data-type="${t}">${label}</button>`;
    }).join('');

    const panelsHtml = types.map((t, i) => `
        <div class="achv-panel${i === 0 ? '' : ' hidden'}" data-type="${t}">
            <div class="achv-tables-loading">Loading…</div>
        </div>
    `).join('');

    section.innerHTML = `
        <div class="collapsible-section">
            <h2 class="collapsible-header">PR Leaders</h2>
            <div class="collapsible-body">
                <div class="achv-tabs">${tabsHtml}</div>
                <div class="achv-panels">${panelsHtml}</div>
            </div>
        </div>`;

    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
        header.closest('.collapsible-section').classList.toggle('collapsed');
    });

    section.querySelectorAll('.achv-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.stopPropagation();
            const type = tab.dataset.type;
            section.querySelectorAll('.achv-tab').forEach(b => b.classList.toggle('active', b === tab));
            section.querySelectorAll('.achv-panel').forEach(p => {
                p.classList.toggle('hidden', p.dataset.type !== type);
            });
        });
    });

    container.appendChild(section);

    types.forEach(async (t) => {
        const panel = section.querySelector(`.achv-panel[data-type="${t}"]`);
        try {
            const data = await buildAllTimeRankings(t);
            panel.innerHTML = renderPRTables(data);
        } catch (err) {
            panel.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    });
}

function renderPRTables(data) {
    return `<div class="achv-tables-grid">${PR_METRICS.map(m => {
        const rows = data.rankings[m.key] || [];
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${r.rank}</td>
                <td>${playerNameLink(r.name)}</td>
                <td>${formatNumber(r.value)}</td>
            </tr>
        `).join('');
        return `
            <div class="achv-table-card">
                <h3>${m.label}</h3>
                <div class="achv-table-wrapper">
                    <table class="achv-table">
                        <thead><tr><th>#</th><th>Player</th><th>PR</th></tr></thead>
                        <tbody>${rowsHtml || '<tr><td colspan="3">No data</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('')}</div>`;
}
