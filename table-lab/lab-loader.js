/**
 * lab-loader.js — Loads real project data for the MF Table Lab.
 * Imports from the project's actual data/compute modules so the lab
 * reflects exactly what the live app shows.
 */

import { setLeaguesBase, loadLandingSettings, loadLeague } from '../js/data/leagueLoader.js';
import { computeAllStats } from '../js/compute/stats.js';
import { buildRankings, computeAverages } from '../js/compute/rankings.js';
import { getLeagueConfig } from '../js/compute/leagueTypes.js';
import { getFlagCode } from '../js/utils/helpers.js';
import { getPlayerMatches } from '../js/data/csvParser.js';
import { colorForLevel } from '../js/compute/colorScale.js';
import { LEVELS } from '../js/compute/rankings.js';

// Lab pages sit one level deep — redirect fetches to the correct root
setLeaguesBase('../leagues');

// ─── Shared helpers ───────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_LABELS  = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

function playerCell(name, customFlags, opts = {}) {
    const code = getFlagCode(name, customFlags);
    const img  = `<img class="flag" src="../assets/flags/${code}.png" alt="${code}">`;
    const text = opts.italic
        ? `<i style="color:var(--color-text-muted)">${name}</i>`
        : name;
    return `${img}${text}`;
}

function rankBadge(rank, goldCount = 1, silverCount = 1, bronzeCount = 3) {
    if (rank <= goldCount)                              return `<span class="medal medal-gold">${rank}</span>`;
    if (rank <= goldCount + silverCount)                return `<span class="medal medal-silver">${rank}</span>`;
    if (rank <= goldCount + silverCount + bronzeCount)  return `<span class="medal medal-bronze">${rank}</span>`;
    return String(rank);
}

function formatIssueDate(isoDate) {
    if (!isoDate) return '—';
    const d = new Date(isoDate);
    return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatPercent2(v) {
    return (v * 100).toFixed(2) + '%';
}

function displayIdToFolderId(id) {
    return id.replace(' - ', ' ');
}

function buildGlobalFlags(leagues) {
    const flags = {};
    for (const l of leagues) {
        for (const [p, c] of Object.entries(l.params.CustomFlags || {})) {
            flags[p] = c;
        }
    }
    return flags;
}

// ─── A1: Completed Leagues ────────────────────────
// Matches real: League | Date | Type | Winner

function buildA1(completedResults, globalFlags) {
    const cols = [
        { key: 'league',  label: 'League',  type: 'string', sortable: true,  colorScale: null },
        { key: 'date',    label: 'Date',     type: 'string', sortable: true,  colorScale: null },
        { key: 'type',    label: 'Type',     type: 'string', sortable: true,  colorScale: null,
          format: v => v },  // pre-built HTML badge
        { key: 'winner',  label: 'Winner',   type: 'string', sortable: true,  colorScale: null,
          tdClass: 'player-cell', format: v => playerCell(v, globalFlags) },
    ];

    const data = completedResults.map(({ league, rankings }) => {
        const winner   = rankings[0];
        const type     = league.params.LeagueType || 'doubling';
        const typeLabel = TYPE_LABELS[type] || type;
        return {
            league: league.params.LeagueTitle || league.id,
            date:   formatIssueDate(league.params.IssueDate),
            type:   `<span class="league-type-pill type-${type}">${typeLabel}</span>`,
            winner: winner?.player ?? '—',
        };
    });

    return { data, cols, summary: null };
}

// ─── A2: Annual Leaderboard ───────────────────────
// Matches real: # | Player | [month cols...] | Tot | Win% | PR

function buildA2(allResults, globalFlags) {
    // Group by (year, leagueType) — same logic as real buildAnnualLeaderboard
    const groups = new Map(); // key "year|type" → { year, type, results[] }
    for (const result of allResults) {
        const iso  = result.league.params.IssueDate || '';
        const year = iso.slice(0, 4);
        if (!year) continue;
        const type = result.league.params.LeagueType || 'doubling';
        const key  = `${year}|${type}`;
        if (!groups.has(key)) groups.set(key, { year, type, results: [] });
        groups.get(key).results.push(result);
    }

    // Pick the most recent year's doubling group
    const sorted = [...groups.values()].sort((a, b) =>
        b.year !== a.year ? b.year.localeCompare(a.year) : 0
    );
    const group = sorted.find(g => g.type === 'doubling') || sorted[0];
    if (!group) return { data: [], cols: [], summary: null };

    // Sort leagues within group by month (ascending)
    group.results.sort((a, b) => {
        const ma = parseInt((a.league.params.IssueDate || '').slice(5, 7)) || 0;
        const mb = parseInt((b.league.params.IssueDate || '').slice(5, 7)) || 0;
        return ma - mb;
    });

    const monthEntries = group.results.map(r => {
        const m = parseInt((r.league.params.IssueDate || '').slice(5, 7)) - 1;
        return { abbr: MONTHS_SHORT[m] || '?', result: r };
    });

    // Aggregate per player
    const playerMap = new Map();
    for (const { abbr, result } of monthEntries) {
        const cf = result.league.params.CustomFlags || {};
        for (const row of result.rankings) {
            if (row.games === 0) continue;
            if (!playerMap.has(row.player)) {
                playerMap.set(row.player, {
                    monthly: {}, totalWins: 0, totalGames: 0,
                    prSum: 0, prCount: 0, customFlags: {}
                });
            }
            const pd = playerMap.get(row.player);
            pd.monthly[abbr]  = (pd.monthly[abbr] || 0) + row.wins;
            pd.totalWins      += row.wins;
            pd.totalGames     += row.games;
            if (row.meanPR != null) { pd.prSum += row.meanPR * row.games; pd.prCount += row.games; }
            Object.assign(pd.customFlags, cf);
        }
    }

    // Build + sort rows
    const rows = [...playerMap.entries()].map(([player, pd]) => ({
        player,
        winRate: pd.totalGames > 0 ? pd.totalWins / pd.totalGames : 0,
        meanPR:  pd.prCount > 0 ? pd.prSum / pd.prCount : null,
        total:   pd.totalWins,
        ...Object.fromEntries(monthEntries.map(({ abbr }) => [abbr.toLowerCase(), pd.monthly[abbr] ?? null])),
        _flags:  pd.customFlags,
    }));

    rows.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (a.meanPR != null && b.meanPR != null) return a.meanPR - b.meanPR;
        return 0;
    });
    rows.forEach((r, i) => { r.rank = i + 1; });

    const cols = [
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorScale: null,
          format: v => rankBadge(v) },
        { key: 'player', label: 'Player', type: 'string', sortable: true,  colorScale: null,
          tdClass: 'player-cell', format: (v, row) => playerCell(v, globalFlags) },
        ...monthEntries.map(({ abbr }) => ({
            key: abbr.toLowerCase(), label: abbr, type: 'number', sortable: true, colorScale: 'good-to-bad',
        })),
        { key: 'total',   label: 'Tot',   type: 'number', sortable: true,  colorScale: 'good-to-bad',
          tdClass: 'total-col' },
        { key: 'winRate', label: 'Win%',  type: 'number', sortable: true,  colorScale: 'good-to-bad',
          format: v => formatPercent2(v) },
        { key: 'meanPR',  label: 'PR',    type: 'number', sortable: true,  colorScale: 'bad-to-good',
          format: v => v.toFixed(2) },
    ];

    return { data: rows, cols, summary: null };
}

// ─── D: League Table ──────────────────────────────
// Matches real: # (badge) | Player | GP | W | L | Win% (2dp) | PR | Level | Luck

function buildD(allResults) {
    const result = allResults.find(r => r.league.params.Running)
                || allResults.find(r => !r.league.params.Running);
    if (!result) return { data: [], cols: [], summary: null, leagueTitle: '?' };

    const { league, config, rankings, avgRow } = result;
    const cf          = league.params.CustomFlags || {};
    const goldCount   = league.params.GoldCount   ?? 1;
    const silverCount = league.params.SilverCount ?? 1;
    const bronzeCount = league.params.BronzeCount ?? 3;

    const levelEdges = new Set([LEVELS[0].label, LEVELS[LEVELS.length - 1].label]);

    const cols = [
        { key: 'rank',    label: '#',      type: 'number', sortable: false, colorScale: null,
          format: v => rankBadge(v, goldCount, silverCount, bronzeCount) },
        { key: 'player',  label: 'Player', type: 'string', sortable: true,  colorScale: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'gp',      label: 'GP',     type: 'number', sortable: true,  colorScale: 'good-to-bad', boldExtreme: true },
        { key: 'wins',    label: 'W',      type: 'number', sortable: true,  colorScale: 'good-to-bad', boldExtreme: true },
        { key: 'losses',  label: 'L',      type: 'number', sortable: true,  colorScale: 'bad-to-good', boldExtreme: true },
        { key: 'winRate', label: 'Win%',   type: 'number', sortable: true,  colorScale: 'good-to-bad', boldExtreme: true,
          format: v => formatPercent2(v) },
        { key: 'meanPR',  label: 'PR',     type: 'number', sortable: true,  colorScale: 'bad-to-good', boldExtreme: true,
          format: v => v.toFixed(2) },
        { key: 'level',   label: 'Level',  type: 'string', sortable: true,  colorScale: null,
          format: v => {
              const color = colorForLevel(v);
              const text  = levelEdges.has(v) ? `<b>${v}</b>` : v;
              return color ? `<span style="color:${color}">${text}</span>` : text;
          } },
        { key: 'luck',    label: 'Luck',   type: 'number', sortable: true,  colorScale: 'good-to-bad', boldExtreme: true,
          format: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
    ];

    const data = rankings.map(row => ({
        rank:    row.rank,
        player:  row.player,
        gp:      row.games,
        wins:    row.wins,
        losses:  row.losses,
        winRate: row.winRate,
        meanPR:  row.meanPR,
        level:   row.level,
        luck:    row.luck,
    }));

    const summary = avgRow ? {
        rank:    '',
        player:  '<b>AVERAGES</b>',
        gp:      avgRow.games,
        wins:    avgRow.wins,
        losses:  avgRow.losses,
        winRate: avgRow.winRate  != null ? formatPercent2(avgRow.winRate) : null,
        meanPR:  avgRow.meanPR   != null ? avgRow.meanPR.toFixed(2) : null,
        level:   '',
        luck:    avgRow.luck     != null ? (avgRow.luck >= 0 ? '+' : '') + avgRow.luck.toFixed(2) : null,
    } : null;

    return { data, cols, summary, leagueTitle: league.params.LeagueTitle || league.id };
}

// ─── E: Player Match History ──────────────────────
// Matches real: Opponent | Date | Score | PR | Opp PR | Luck | Result
// Includes unplayed rows (tr.unplayed, Result = "Not played")

function buildE(allResults) {
    const result = allResults.find(r => r.league.params.Running)
                || allResults.find(r => !r.league.params.Running);
    if (!result) return { data: [], cols: [], summary: null, playerName: '?', leagueTitle: '?' };

    const { league, rankings } = result;
    const cf        = league.params.CustomFlags || {};
    const topPlayer = rankings[0]?.player;
    if (!topPlayer) return { data: [], cols: [], summary: null, playerName: '?', leagueTitle: '?' };

    // Include ALL matches — played and unplayed
    const allMatches = getPlayerMatches(league.matches, topPlayer, league.allPlayers);

    const cols = [
        { key: 'opponent', label: 'Opponent', type: 'string', sortable: true, colorScale: null,
          tdClass: 'player-cell',
          format: (v, row) => playerCell(v, cf, row._rowClass === 'unplayed' ? { italic: true } : {}) },
        { key: 'date',   label: 'Date',   type: 'string', sortable: true, colorScale: null },
        { key: 'score',  label: 'Score',  type: 'string', sortable: true, colorScale: null,
          format: (v, row) => row.result === 'WIN' ? `<b>${v}</b>` : v },
        { key: 'pr',     label: 'PR',     type: 'number', sortable: true, colorScale: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '—';
              return (typeof row.oppPR === 'number' && v < row.oppPR)
                  ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
          } },
        { key: 'oppPR',  label: 'Opp PR', type: 'number', sortable: true, colorScale: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '—';
              return (typeof row.pr === 'number' && v < row.pr)
                  ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
          } },
        { key: 'luck',   label: 'Luck',   type: 'number', sortable: true, colorScale: null,
          format: v => {
              if (typeof v !== 'number') return '—';
              const str = v.toFixed(2);
              return v > 0 ? `<b>${str}</b>` : str;
          } },
        { key: 'result', label: 'Result', type: 'string', sortable: true, colorScale: null,
          sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : 1,
          format: v => v === 'WIN'  ? `<b style="color:var(--color-win)">WIN</b>`
                     : v === 'LOSS' ? `<b style="color:var(--color-loss)">LOSS</b>`
                     : v },
    ];

    const data = allMatches.map(m => {
        if (!m.played) {
            return {
                opponent:  m.opponent,
                date:      '', score: '', pr: '', oppPR: '', luck: '',
                result:    'Not played',
                _rowClass: 'unplayed',
            };
        }
        return {
            opponent: m.opponent,
            date:     m.updatedAt ? m.updatedAt.slice(0, 10) : '—',
            score:    `${m.scoreSelf}-${m.scoreOpp}`,
            pr:       m.prSelf,
            oppPR:    m.prOpp,
            luck:     m.luckSelf - m.luckOpp,
            result:   m.scoreSelf > m.scoreOpp ? 'WIN' : 'LOSS',
        };
    });

    // Avg row — only from played matches with PR data
    const played      = data.filter(m => m.pr != null && m.pr !== '');
    const wins        = data.filter(m => m.result === 'WIN').length;
    const losses      = data.filter(m => m.result === 'LOSS').length;
    const n           = played.length;
    const avg         = (arr, key) => arr.reduce((s, m) => s + m[key], 0) / arr.length;
    const winPct      = played.length ? ((wins / played.length) * 100).toFixed(1) : '0.0';

    const summary = {
        opponent: '<b>AVERAGES</b>',
        date: '', score: '',
        pr:     n ? avg(played, 'pr').toFixed(2)    : null,
        oppPR:  n ? avg(played, 'oppPR').toFixed(2) : null,
        luck:   n ? avg(played, 'luck').toFixed(2)  : null,
        result: `${n} games<br>${winPct}% wins`,
    };

    return {
        data, cols, summary,
        playerName:  topPlayer,
        leagueTitle: league.params.LeagueTitle || league.id,
    };
}

// ─── Main export ──────────────────────────────────

export async function loadAllPresetData() {
    const settings  = await loadLandingSettings();
    const folderIds = settings.displayOrder.map(displayIdToFolderId);
    const leagues   = (await Promise.all(
        folderIds.map(id => loadLeague(id).catch(() => null))
    )).filter(Boolean);

    const globalFlags = buildGlobalFlags(leagues);

    const allResults = leagues.map(league => {
        const config   = getLeagueConfig(league.params);
        const stats    = computeAllStats(league.matches, league.allPlayers);
        const rankings = buildRankings(stats, config, league.matches);
        const avgRow   = computeAverages(rankings, config);
        return { league, config, rankings, avgRow };
    });

    const completedResults = allResults.filter(r => !r.league.params.Running);

    return {
        A1: buildA1(completedResults, globalFlags),
        A2: buildA2(allResults, globalFlags),
        D:  buildD(allResults),
        E:  buildE(allResults),
    };
}
