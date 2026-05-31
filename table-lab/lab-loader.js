/**
 * lab-loader.js — Loads real project data for the MF Table Lab.
 * Imports from the project's actual data/compute modules so the lab
 * reflects exactly what the live app shows.
 */

import { setLeaguesBase, loadLandingSettings, loadLeague } from '../js/data/leagueLoader.js';
import { computeAllStats } from '../js/compute/stats.js';
import { buildRankings, computeAverages, getLevel } from '../js/compute/rankings.js';
import { getLeagueConfig } from '../js/compute/leagueTypes.js';
import { getFlagCode, flagUrl, formatNumber, leagueUrl } from '../js/utils/helpers.js';
import { getPlayerMatches, parseCSVAllWithRounds } from '../js/data/csvParser.js';
import { colorForValue, colorForValueInverted, colorForLevel } from '../js/compute/colorScale.js';
import { LEVELS } from '../js/compute/rankings.js';
import { loadAllLeagues, loadPlayerAcrossLeagues, flattenAllMatches } from '../js/compute/crossLeague.js';
import { buildAllTimeRankings } from '../js/compute/allTimeRankings.js';
import { collectLuckMatches, collectPRMatches, topLuckiestMatches, topBestPRMatches,
         collectPlayerBestPR, collectPlayerBestLuckFor, collectPlayerWorstLuckAgainst } from '../js/compute/matchRecords.js';
import { luckPercentileStats } from '../js/compute/luckPercentile.js';
import { playerNameLink } from '../js/render/playerNameInteraction.js';

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

function rankBadge(rank, goldCount = 1, silverCount = 1, bronzeCount = 3, medalRank) {
    // medalRank: the rank used to pick the medal colour (defaults to rank).
    // Separating them lets callers show a positional number while keeping the
    // player's original medal colour when the table is re-sorted.
    const mr = medalRank ?? rank;
    if (mr <= goldCount)                              return `<span class="medal medal-gold">${rank}</span>`;
    if (mr <= goldCount + silverCount)                return `<span class="medal medal-silver">${rank}</span>`;
    if (mr <= goldCount + silverCount + bronzeCount)  return `<span class="medal medal-bronze">${rank}</span>`;
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

function avg(arr, key) {
    const vals = arr.filter(r => typeof r[key] === 'number');
    if (!vals.length) return null;
    return vals.reduce((s, r) => s + r[key], 0) / vals.length;
}

// ─── A1: Completed Leagues ────────────────────────
// Matches real: League | Date | Type | Winner

function buildA1(completedResults, globalFlags) {
    const cols = [
        { key: 'league', label: 'League', type: 'string', sortable: false, colorFn: null },
        { key: 'date',   label: 'Date',   type: 'string', sortable: false, colorFn: null },
        { key: 'type',   label: 'Type',   type: 'string', sortable: false, colorFn: null },
        { key: 'winner', label: 'Winner', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, globalFlags) },
    ];

    const data = completedResults.map(({ league, rankings }) => {
        const winner    = rankings[0];
        const type      = league.params.LeagueType || 'doubling';
        const typeLabel = TYPE_LABELS[type] || type;
        return {
            league: league.params.LeagueTitle || league.id,
            date:   formatIssueDate(league.params.IssueDate),
            type:   `<span class="league-type-pill type-${type}">${typeLabel}</span>`,
            winner: winner?.player ?? '—',
        };
    });

    return { data, cols };
}

// ─── A2: Annual Leaderboard ───────────────────────
// Matches real: # | Player | [month cols...] | Tot | Win% | PR

function buildA2(allResults, globalFlags) {
    // Group by (year, leagueType) — same logic as real buildAnnualLeaderboard
    const groups = new Map();
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
    if (!group) return { data: [], cols: [] };

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
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorFn: null,
          format: v => rankBadge(v, 1, 1, 1) },
        { key: 'player', label: 'Player', type: 'string', sortable: true,  colorFn: null,
          tdClass: 'player-cell', format: (v, row) => playerCell(v, globalFlags) },
        ...monthEntries.map(({ abbr }) => ({
            key: abbr.toLowerCase(), label: abbr, type: 'number', sortable: true,
            colorFn: null,
        })),
        { key: 'total',   label: '<b>Tot</b>', type: 'number', sortable: true,
          colorFn: null,
          tdClass: 'total-col' },
        { key: 'winRate', label: 'Win%',  type: 'number', sortable: true,
          colorFn: null,
          format: v => formatPercent2(v) },
        { key: 'meanPR',  label: 'PR',    type: 'number', sortable: true,
          colorFn: null,
          format: v => v.toFixed(2) },
    ];

    return { data: rows, cols, medalCounts: { gold: 1, silver: 1, bronze: 1 } };
}

// ─── D: League Table ──────────────────────────────
// Matches real: # (badge) | Player | GP | W | L | Win% | PR | Level | Luck

function buildD(allResults) {
    const result = allResults.find(r => r.league.params.Running)
                || allResults.find(r => !r.league.params.Running);
    if (!result) return { data: [], cols: [], leagueTitle: '?' };

    const { league, config, rankings, avgRow } = result;
    const cf          = league.params.CustomFlags || {};
    const goldCount   = league.params.GoldCount   ?? 1;
    const silverCount = league.params.SilverCount ?? 1;
    const bronzeCount = league.params.BronzeCount ?? 3;

    const levelEdges = new Set([LEVELS[0].label, LEVELS[LEVELS.length - 1].label]);

    const cols = [
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorFn: null,
          // idx+1 = visual position (always 1…N top-to-bottom); v = original rank (drives medal colour).
          format: (v, row, idx) => rankBadge(idx + 1, goldCount, silverCount, bronzeCount, v) },
        { key: 'player', label: 'Player', type: 'string', sortable: true,  colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'gp',     label: 'GP',     type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
        { key: 'wins',   label: 'W',      type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
        { key: 'losses', label: 'L',      type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValueInverted(v, min, max), boldExtreme: true },
        ...(config.showWinRate ? [
            { key: 'winRate', label: 'Win%', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => formatPercent2(v) },
        ] : []),
        ...(config.showPRWins ? [
            { key: 'prWins',    label: 'PRW',     type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
            { key: 'points',    label: 'Pts',     type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
            { key: 'avgPoints', label: 'Avg Pts', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
        ] : []),
        ...(config.showPR ? [
            { key: 'meanPR', label: 'PR',    type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValueInverted(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
            { key: 'level',  label: 'Level', type: 'string', sortable: true, colorFn: null,
              sortKey: row => row.meanPR,
              format: v => {
                  const color = colorForLevel(v);
                  const text  = levelEdges.has(v) ? `<b>${v}</b>` : v;
                  return color ? `<span style="color:${color}">${text}</span>` : text;
              } },
        ] : []),
        { key: 'luck', label: 'Luck', type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
          format: v => v.toFixed(2) },
    ];

    const data = rankings.map(row => ({
        rank:      row.rank,
        player:    row.player,
        gp:        row.games,
        wins:      row.wins,
        losses:    row.losses,
        winRate:   row.winRate,
        prWins:    row.prWins,
        points:    row.points,
        avgPoints: row.avgPoints,
        meanPR:    row.meanPR,
        level:     row.level,
        luck:      row.luck,
    }));

    // Summary row builder — closes over avgRow (pre-computed league averages)
    const buildSummaryRow = avgRow
        ? (_data) => ({
            rank:      '',
            player:    'AVERAGES',
            gp:        avgRow.games,
            wins:      avgRow.wins,
            losses:    avgRow.losses,
            winRate:   config.showWinRate && avgRow.winRate   != null ? formatPercent2(avgRow.winRate)    : null,
            prWins:    config.showPRWins  && avgRow.prWins    != null ? avgRow.prWins.toFixed(1)          : null,
            points:    config.showPRWins  && avgRow.points    != null ? avgRow.points.toFixed(1)          : null,
            avgPoints: config.showPRWins  && avgRow.avgPoints != null ? avgRow.avgPoints.toFixed(2)       : null,
            meanPR:    config.showPR      && avgRow.meanPR    != null ? avgRow.meanPR.toFixed(2)          : null,
            level:     '',
            luck:      avgRow.luck        != null ? avgRow.luck.toFixed(2) : null,
        })
        : null;

    return { data, cols, buildSummaryRow, leagueTitle: league.params.LeagueTitle || league.id,
             medalCounts: { gold: goldCount, silver: silverCount, bronze: bronzeCount } };
}

// ─── E: Player Match History ──────────────────────
// Matches real: Opponent | Date | Score | PR | Opp PR | Luck | Result

function buildE(allResults) {
    const result = allResults.find(r => r.league.params.Running)
                || allResults.find(r => !r.league.params.Running);
    if (!result) return { data: [], cols: [], playerName: '?', leagueTitle: '?' };

    const { league, config, rankings } = result;
    const cf        = league.params.CustomFlags || {};
    const topPlayer = rankings[0]?.player;
    if (!topPlayer) return { data: [], cols: [], playerName: '?', leagueTitle: '?' };

    const allMatches = getPlayerMatches(league.matches, topPlayer, league.allPlayers);

    const cols = [
        { key: 'opponent', label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => playerCell(v, cf, row.unplayed ? { italic: true } : {}) },
        { key: 'date',   label: 'Date',   type: 'string', sortable: true, colorFn: null },
        { key: 'score',  label: 'Score',  type: 'string', sortable: true, colorFn: null,
          format: (v, row) => row.result === 'WIN' ? `<b>${v}</b>` : v },
        ...(config.showPR ? [
            { key: 'pr',    label: 'PR',     type: 'number', sortable: true, colorFn: null,
              format: (v, row) => {
                  if (typeof v !== 'number') return '—';
                  return (typeof row.oppPR === 'number' && v < row.oppPR)
                      ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
              } },
            { key: 'oppPR', label: 'Opp PR', type: 'number', sortable: true, colorFn: null,
              format: (v, row) => {
                  if (typeof v !== 'number') return '—';
                  return (typeof row.pr === 'number' && v < row.pr)
                      ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
              } },
        ] : []),
        { key: 'luck',   label: 'Luck',   type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.luck === 'number' ? row.luck : null,
          format: v => {
              if (typeof v !== 'number') return '—';
              const str = v.toFixed(2);
              return v > 0 ? `<b>${str}</b>` : str;
          } },
        // UBC: replace Result with Points (matchWin + prWin); other modes: show WIN/LOSS/DRAW
        ...(config.playerResultMode === 'points' ? [
            { key: 'matchPoints', label: 'Points', type: 'number', sortable: true, colorFn: null,
              sortKey: row => typeof row.matchPoints === 'number' ? row.matchPoints : null,
              format: v => {
                  if (typeof v !== 'number') return '';
                  if (v === 2) return `<b style="color:var(--color-win)">${v}</b>`;
                  if (v === 0) return `<b style="color:var(--color-loss)">${v}</b>`;
                  return String(v);
              } },
        ] : [
            { key: 'result', label: 'Result', type: 'string', sortable: true, colorFn: null,
              sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : row.result === 'DRAW' ? 1 : -1,
              format: v => v === 'WIN'  ? `<b style="color:var(--color-win)">WIN</b>`
                         : v === 'LOSS' ? `<b style="color:var(--color-loss)">LOSS</b>`
                         : v === 'DRAW' ? `<b>DRAW</b>`
                         : v },
        ]),
    ];

    const data = allMatches.map(m => {
        if (!m.played) {
            return {
                opponent: m.opponent,
                date: '', score: '', pr: null, oppPR: null, luck: null,
                result: 'Not played', matchPoints: null,
                unplayed: true,
            };
        }
        const isTechnical = m._technical || false;
        const isDraw      = m._draw || false;
        const matchWin    = m.scoreSelf > m.scoreOpp ? 1 : 0;
        const prWin       = (!isTechnical && typeof m.prSelf === 'number' && typeof m.prOpp === 'number' && m.prSelf < m.prOpp) ? 1 : 0;
        const result      = isDraw ? 'DRAW' : matchWin ? 'WIN' : 'LOSS';
        return {
            opponent:    m.opponent,
            date:        m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-GB') : '—',
            score:       isTechnical ? '—' : `${m.scoreSelf}-${m.scoreOpp}`,
            pr:          isTechnical ? null : m.prSelf,
            oppPR:       isTechnical ? null : m.prOpp,
            luck:        isTechnical ? null : m.luckSelf - m.luckOpp,
            result,
            matchPoints: matchWin + prWin,
        };
    });

    // Row class — unplayed matches get the 'unplayed' class
    const getRowClass = (row) => row.unplayed ? 'unplayed' : null;

    // Summary row — mirrors renderPlayerAverages in playerPage.js
    const buildSummaryRow = (data) => {
        const played = data.filter(r => !r.unplayed);
        const n      = played.length;
        if (!n) return { opponent: 'AVERAGES', date: '', score: '', pr: null, oppPR: null, luck: null, result: '0 games', matchPoints: null };
        const nonTech = played.filter(r => r.pr !== null);
        const nt      = nonTech.length;
        const avgPR    = nt ? (nonTech.reduce((s, r) => s + r.pr,    0) / nt).toFixed(2) : null;
        const avgOppPR = nt ? (nonTech.reduce((s, r) => s + r.oppPR, 0) / nt).toFixed(2) : null;
        const avgLuck  = nt ? (nonTech.reduce((s, r) => s + r.luck,  0) / nt).toFixed(2) : null;
        const wins     = played.filter(r => r.result === 'WIN').length;
        const winPct   = ((wins / n) * 100).toFixed(1);
        const totalPts = played.reduce((s, r) => s + (r.matchPoints ?? 0), 0);
        const avgPts   = (totalPts / n).toFixed(2);
        const statLine = config.playerResultMode === 'points'
            ? `${n} games<br>${avgPts} avg pts`
            : `${n} games<br>${winPct}% wins`;
        return {
            opponent: 'AVERAGES',
            date: '', score: '',
            ...(config.showPR ? { pr: avgPR, oppPR: avgOppPR } : {}),
            luck: avgLuck,
            result:      statLine,
            matchPoints: statLine,
        };
    };

    return {
        data, cols, getRowClass, buildSummaryRow,
        playerName:  topPlayer,
        leagueTitle: league.params.LeagueTitle || league.id,
    };
}

// ─── B1: Prizes & Medals ──────────────────────────
// Matches real: medal | Tier | Places | Prize

function buildB1(runningResult) {
    if (!runningResult) return { data: [], cols: [] };
    const { params } = runningResult.league;
    const prizes = params.Prizes || {};
    const fmtPrize = v => (v == null || v === 0) ? '—' : `₪${Number(v).toLocaleString()}`;

    const rows = [];
    if (params.GoldCount)   rows.push({ medal: '🥇', tier: 'Gold',   count: params.GoldCount,   prize: prizes.Gold });
    if (params.SilverCount) rows.push({ medal: '🥈', tier: 'Silver', count: params.SilverCount, prize: prizes.Silver });
    if (params.BronzeCount) rows.push({ medal: '🥉', tier: 'Bronze', count: params.BronzeCount, prize: prizes.Bronze });

    const cols = [
        { key: 'medal', label: '',       type: 'string', sortable: false, colorFn: null },
        { key: 'tier',  label: 'Tier',   type: 'string', sortable: false, colorFn: null },
        { key: 'count', label: 'Places', type: 'number', sortable: false, colorFn: null },
        { key: 'prize', label: 'Prize',  type: 'number', sortable: false, colorFn: null, format: fmtPrize },
    ];

    // One row per medal tier — counts are 1/1/1 (or 0 if a tier is absent)
    const medalCounts = {
        gold:   params.GoldCount   ? 1 : 0,
        silver: params.SilverCount ? 1 : 0,
        bronze: params.BronzeCount ? 1 : 0,
    };

    return { data: rows, cols, medalCounts, leagueTitle: params.LeagueTitle || runningResult.league.id };
}

// ─── B2: Historical view (medal top) ──────────────
// Matches real: # | Player | GP | W | L | [Win%] | [PRW|Avg PTS] | [PR]

function buildB2(runningResult) {
    if (!runningResult) return { data: [], cols: [] };
    const { league, config, rankings } = runningResult;
    const cf          = league.params.CustomFlags || {};
    const goldCount   = league.params.GoldCount   ?? 1;
    const silverCount = league.params.SilverCount ?? 1;
    const bronzeCount = league.params.BronzeCount ?? 4;
    const medalLimit  = goldCount + silverCount + bronzeCount;
    const top         = rankings.filter(r => r.rank <= medalLimit && r.games > 0);

    const cols = [
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorFn: null },
        { key: 'player', label: 'Player', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'gp',     label: 'GP',     type: 'number', sortable: false, colorFn: null },
        { key: 'wins',   label: 'W',      type: 'number', sortable: false, colorFn: null },
        { key: 'losses', label: 'L',      type: 'number', sortable: false, colorFn: null },
        ...(config.showWinRate ? [
            { key: 'winRate', label: 'Win%', type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? formatPercent2(v) : '—' },
        ] : []),
        ...(config.showPRWins ? [
            { key: 'prWins',    label: 'PRW',     type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? v : '—' },
            { key: 'avgPoints', label: 'Avg PTS', type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? v.toFixed(2) : '—' },
        ] : []),
        ...(config.showPR ? [
            { key: 'meanPR', label: 'PR', type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? v.toFixed(2) : '—' },
        ] : []),
    ];

    const data = top.map(r => ({
        rank: r.rank, player: r.player, gp: r.games, wins: r.wins, losses: r.losses,
        winRate: r.winRate, prWins: r.prWins, avgPoints: r.avgPoints, meanPR: r.meanPR,
    }));

    return { data, cols, leagueTitle: league.params.LeagueTitle,
             medalCounts: { gold: goldCount, silver: silverCount, bronze: bronzeCount } };
}

// ─── B3 / B4 shared helper ────────────────────────
// Both tables share the same row shape (rank, player, GP, W, L, [PTS/AvgPTS], PR-or-Win%, pct bar).
// The lab can't run the real Monte-Carlo predictor / what-if simulator, so we fake a
// championship-style probability distribution over the current rankings. This is a
// visual snapshot, not real math — the point of the lab is to lock the table look.

function pctDistribution(n, topX) {
    // Geometric-ish decay over top players, peaking near `topX` finishers.
    // Sum of pct over players approximates topX * 100 (each finishing slot is one "share").
    const weights = Array.from({ length: n }, (_, i) => Math.exp(-i / Math.max(1, n / 4)));
    const total   = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => Math.min(100, (w / total) * topX * 100));
}

function buildB3orB4(runningResult, barClass, fixedX) {
    if (!runningResult) return { data: [], cols: [] };
    const { league, config, rankings } = runningResult;
    const cf       = league.params.CustomFlags || {};
    const showPR   = config.showPR;
    const showPRW  = config.showPRWins;
    const playing  = rankings.filter(r => r.games > 0);
    const pcts     = pctDistribution(playing.length, fixedX);

    const pctHeader = fixedX === 1 ? 'Ch%' : `T${fixedX}%`;
    const prHeader  = showPR ? 'PR' : 'Win%';

    const fmtPctBar = (pct) => {
        const barColor = pct > Math.min(20 * fixedX, 80) ? 'var(--color-success)'
                       : pct > Math.min(5  * fixedX, 30) ? 'var(--color-warning)'
                       : 'var(--color-text-muted)';
        return `<div class="${barClass}" style="--pct:${Math.min(pct, 100)}%;--bar-color:${barColor}">${pct.toFixed(1)}%</div>`;
    };

    const cols = [
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorFn: null },
        { key: 'player', label: 'Player', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'gp',     label: 'GP',     type: 'number', sortable: false, colorFn: null },
        { key: 'wins',   label: 'W',      type: 'number', sortable: false, colorFn: null },
        { key: 'losses', label: 'L',      type: 'number', sortable: false, colorFn: null },
        ...(showPRW ? [
            { key: 'prWins',    label: 'PTS',     type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? v : '—' },
            { key: 'avgPoints', label: 'Avg PTS', type: 'number', sortable: false, colorFn: null,
              format: v => v != null ? v.toFixed(2) : '—' },
        ] : []),
        { key: showPR ? 'meanPR' : 'winRate', label: prHeader, type: 'number', sortable: false, colorFn: null,
          format: v => v == null ? '—' : (showPR ? v.toFixed(2) : formatPercent2(v)) },
        { key: 'pct', label: pctHeader, type: 'number', sortable: false, colorFn: null,
          tdClass: barClass === 'predictor-pct-bar' ? 'predictor-pct-cell' : 'whatif-pct-cell',
          format: fmtPctBar },
    ];

    const data = playing.map((r, i) => ({
        rank: i + 1, player: r.player, gp: r.games, wins: r.wins, losses: r.losses,
        winRate: r.winRate, prWins: r.prWins, avgPoints: r.avgPoints, meanPR: r.meanPR,
        pct: pcts[i] ?? 0,
    }));

    return { data, cols, leagueTitle: league.params.LeagueTitle };
}

function buildB3(runningResult) { return buildB3orB4(runningResult, 'predictor-pct-bar', 1); }
function buildB4(runningResult) { return buildB3orB4(runningResult, 'whatif-pct-bar',    3); }

// ─── B5: Rounds — show round 1 of the running league ──
// Matches real: Player A | Player B | Score | [PR A | PR B] | Luck A | Luck B | Date

function buildB5(runningResult, allMatchesIncUnplayed) {
    if (!runningResult || !allMatchesIncUnplayed) return { data: [], cols: [] };
    const { league, config } = runningResult;
    const cf = league.params.CustomFlags || {};
    const round1 = allMatchesIncUnplayed.filter(m => m.round === 1);

    // Map from matchKey → updatedAt (from history.matches)
    const histMatches = league.history?.matches || [];
    const playedAt = new Map();
    for (const h of histMatches) {
        if (h.updatedAt) playedAt.set([h.playerA, h.playerB].sort().join('|'), h.updatedAt);
    }
    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : null;

    const cols = [
        { key: 'playerA', label: 'Player A', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'playerB', label: 'Player B', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'score', label: 'Score', type: 'string', sortable: false, colorFn: null },
        ...(config.showPR ? [
            { key: 'prA', label: 'PR A', type: 'number', sortable: true, colorFn: null,
              format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
            { key: 'prB', label: 'PR B', type: 'number', sortable: true, colorFn: null,
              format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
        ] : []),
        { key: 'luckA', label: 'Luck A', type: 'number', sortable: true, colorFn: null,
          format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
        { key: 'luckB', label: 'Luck B', type: 'number', sortable: true, colorFn: null,
          format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
        { key: 'date', label: 'Date', type: 'string', sortable: true, colorFn: null,
          format: v => v || '<span style="color:var(--color-text-muted)">unplayed</span>' },
    ];

    const data = round1.map(m => ({
        playerA: m.playerA, playerB: m.playerB,
        score: m.played ? `${m.scoreA} - ${m.scoreB}` : '—',
        prA:   m.played && m.prA != null ? m.prA : null,
        prB:   m.played && m.prB != null ? m.prB : null,
        luckA: m.played && m.luckA != null ? m.luckA : null,
        luckB: m.played && m.luckB != null ? m.luckB : null,
        date:  fmtDate(playedAt.get([m.playerA, m.playerB].sort().join('|'))),
        _unplayed: !m.played,
    }));

    const getRowClass = row => row._unplayed ? 'unplayed' : null;

    return { data, cols, getRowClass, leagueTitle: league.params.LeagueTitle };
}

// ─── B6a: All Remaining Matches ───────────────────
// Matches real: Round | Player A | Player B

function buildB6a(runningResult, allMatchesIncUnplayed) {
    if (!runningResult || !allMatchesIncUnplayed) return { data: [], cols: [] };
    const { league } = runningResult;
    const cf = league.params.CustomFlags || {};
    const remaining = allMatchesIncUnplayed
        .filter(m => !m.played)
        .slice()
        .sort((a, b) => (a.round - b.round) || a.playerA.localeCompare(b.playerA) || a.playerB.localeCompare(b.playerB));

    const cols = [
        { key: 'playerA', label: 'Player A', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'playerB', label: 'Player B', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
    ];

    const data = remaining.map(m => ({ round: m.round, playerA: m.playerA, playerB: m.playerB }));
    const getRowClass = () => 'unplayed';

    return { data, cols, getRowClass, leagueTitle: league.params.LeagueTitle };
}

// ─── B6b: Remaining Per Player ────────────────────
// Matches real: Player | Remaining (count / total)

function buildB6b(runningResult) {
    if (!runningResult) return { data: [], cols: [] };
    const { league, rankings } = runningResult;
    const cf = league.params.CustomFlags || {};
    const n  = league.allPlayers.size;
    const maxGames = n > 0 ? n - 1 : 0;
    const halfThreshold = maxGames / 2;

    const baseRows = rankings.map(r => ({
        player:    r.player,
        games:     r.games,
        remaining: Math.max(0, maxGames - r.games),
        total:     maxGames,
    })).sort((a, b) => b.remaining - a.remaining);

    const maxRem = baseRows.length ? baseRows[0].remaining : 0;
    const minRem = baseRows.length ? baseRows[baseRows.length - 1].remaining : 0;
    const hasAnyBelowHalf = baseRows.some(p => p.games <= halfThreshold);

    // Build data with the "played ≥ half" divider injected at the boundary
    const rows = [];
    let separatorInserted = false;
    for (const p of baseRows) {
        if (!separatorInserted && hasAnyBelowHalf && p.games > halfThreshold) {
            rows.push({ _divider: true, _dividerClass: 'player-remaining-divider player-remaining-divider--bold', _dividerText: '— played ≥ half —' });
            separatorInserted = true;
        }
        rows.push({ ...p, _bold: !separatorInserted });
    }

    const cols = [
        { key: 'player', label: 'Player', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
        { key: 'remaining', label: 'Remaining', type: 'number', sortable: false, colorFn: null,
          format: (v, row) => {
              const color = colorForValueInverted(v, minRem, maxRem);
              const weight = row._bold ? ';font-weight:700' : '';
              return `<span style="color:${color}${weight}">${v}</span> / ${row.total}`;
          } },
    ];

    const getRowClass = row => row._bold ? 'b6b-bold' : null;

    return { data: rows, cols, getRowClass, leagueTitle: league.params.LeagueTitle };
}

// ─── B6c: Unplayed Opponents (for the top player) ──
// Matches real: Unplayed Opponent

function buildB6c(runningResult, allMatchesIncUnplayed) {
    if (!runningResult || !allMatchesIncUnplayed) return { data: [], cols: [] };
    const { league, rankings } = runningResult;
    const cf        = league.params.CustomFlags || {};
    const topPlayer = rankings[0]?.player;
    if (!topPlayer) return { data: [], cols: [] };

    const remaining = allMatchesIncUnplayed.filter(m => !m.played);
    const opponents = [];
    for (const m of remaining) {
        if (m.playerA === topPlayer && m.playerB !== 'Bye') opponents.push(m.playerB);
        else if (m.playerB === topPlayer && m.playerA !== 'Bye') opponents.push(m.playerA);
    }
    opponents.sort();

    const cols = [
        { key: 'opponent', label: 'Unplayed Opponent', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, cf) },
    ];

    return { data: opponents.map(o => ({ opponent: o })), cols,
             playerName: topPlayer, leagueTitle: league.params.LeagueTitle };
}

// ─── C1: Player Leagues ───────────────────────────
// Matches real: League | Date | Type | Status | Rank | GP | W | L | Primary | PR

function buildC1(playerData, playerName) {
    if (!playerData || !playerData.length) return { data: [], cols: [] };

    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null },
        { key: 'date',        label: 'Date',   type: 'string', sortable: true, colorFn: null },
        { key: 'type',        label: 'Type',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._type,
          format: v => v },
        { key: 'status',      label: 'Status', type: 'string', sortable: true, colorFn: null,
          format: v => v === 'Running'
              ? '<span class="status-pill status-running">Running</span>'
              : '<span class="status-pill status-completed">Completed</span>' },
        { key: 'rank',        label: 'Rank',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._rank ?? 9999,
          format: (v, row) => {
              if (!row._rank) return v;
              const g = row._goldCount, s = row._silverCount, b = row._bronzeCount;
              let color = null;
              if      (row._rank <= g)             color = 'var(--color-gold)';
              else if (row._rank <= g + s)         color = 'var(--color-silver)';
              else if (row._rank <= g + s + b)     color = 'var(--color-bronze)';
              return color ? `<b style="color:${color}">${v}</b>` : v;
          } },
        { key: 'gp',          label: 'GP',     type: 'number', sortable: true, colorFn: null },
        { key: 'wins',        label: 'W',      type: 'number', sortable: true, colorFn: null },
        { key: 'losses',      label: 'L',      type: 'number', sortable: true, colorFn: null },
        { key: 'primary',     label: 'Primary',type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._primary ?? -1 },
        { key: 'pr',          label: 'PR',     type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._pr ?? 9999 },
    ];

    const data = playerData.map(e => {
        const s         = e.playerStats || {};
        const cfg       = e.league.config;
        const isUbc     = cfg.type === 'ubc';
        const primary   = isUbc
            ? (s.avgPoints != null ? s.avgPoints.toFixed(2) : '—')
            : (s.winRate   != null ? `${(s.winRate * 100).toFixed(1)}%` : '—');
        const meanPR    = (s.meanPR != null && cfg.showPR) ? s.meanPR.toFixed(2) : '—';
        const running   = e.league.params?.Running === true;
        const typeLabel = TYPE_LABELS[cfg.type] || cfg.type;
        return {
            leagueTitle: e.league.title,
            date:        formatIssueDate(e.league.params?.IssueDate),
            type:        `<span class="league-type-pill type-${cfg.type}">${typeLabel}</span>`,
            _type:       cfg.type,
            status:      running ? 'Running' : 'Completed',
            rank:        e.playerRank != null ? `${e.playerRank} / ${e.totalPlayers}` : '—',
            _rank:       e.playerRank,
            _goldCount:   e.league.params?.GoldCount   ?? 1,
            _silverCount: e.league.params?.SilverCount ?? 1,
            _bronzeCount: e.league.params?.BronzeCount ?? 3,
            gp:          s.games  || 0,
            wins:        s.wins   || 0,
            losses:      s.losses || 0,
            primary,
            _primary:    isUbc ? s.avgPoints : s.winRate,
            pr:          meanPR,
            _pr:         s.meanPR,
        };
    });

    return { data, cols, playerName };
}

// ─── C2: Player Match History (cross-league) ──────
// Matches real: League | Date | Type | Opponent | Score | PR | Opp PR | Luck | Result

function buildC2(playerData, playerName, globalFlags) {
    if (!playerData || !playerData.length) return { data: [], cols: [] };
    const allRows = flattenAllMatches(playerData);

    const cols = [
        { key: 'leagueTitle', label: 'League',   type: 'string', sortable: true, colorFn: null },
        { key: 'date',        label: 'Date',     type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0 },
        { key: 'leagueType',  label: 'Type',     type: 'string', sortable: true, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'opponent',    label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell', format: v => playerCell(v, globalFlags) },
        { key: 'score',       label: 'Score',    type: 'string', sortable: false, colorFn: null },
        { key: 'prSelf',      label: 'PR',       type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prSelf === 'number' ? row.prSelf : null,
          format: (v, row) => row._technical || v == null ? '<span style="color:var(--color-text-muted)">N/A</span>' : v.toFixed(2) },
        { key: 'prOpp',       label: 'Opp PR',   type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prOpp === 'number' ? row.prOpp : null,
          format: (v, row) => row._technical || v == null ? '<span style="color:var(--color-text-muted)">N/A</span>' : v.toFixed(2) },
        { key: 'luck',        label: 'Luck',     type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.luck === 'number' ? row.luck : null,
          format: (v, row) => row._technical || v == null ? '<span style="color:var(--color-text-muted)">N/A</span>' : v.toFixed(2) },
        { key: 'result',      label: 'Result',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : 1,
          format: (v, row) => v === 'WIN'  ? `<b style="color:var(--color-win)">WIN</b>${row._technical ? ' <small>(T)</small>' : ''}`
                            : v === 'LOSS' ? `<b style="color:var(--color-loss)">LOSS</b>${row._technical ? ' <small>(T)</small>' : ''}`
                            : v === 'DRAW' ? `<b>DRAW</b>` : v },
    ];

    const data = allRows.map(r => {
        const matchLen = r.matchLength ?? 7;
        const score = r._technical
            ? (r.scoreSelf > r.scoreOpp ? `${matchLen}–0` : `0–${matchLen}`)
            : `${r.scoreSelf}–${r.scoreOpp}`;
        return {
            leagueTitle: r.leagueTitle,
            leagueId:    r.leagueId,
            date:        r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
            _timestamp:  r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
            leagueType:  r.leagueType,
            opponent:    r.opponent,
            score,
            prSelf:      r._technical ? null : r.prSelf,
            prOpp:       r._technical ? null : r.prOpp,
            luck:        r._technical || r.luckSelf == null || r.luckOpp == null ? null : r.luckSelf - r.luckOpp,
            result:      r.result,
            _technical:  r._technical || false,
        };
    });

    return { data, cols, playerName, allRows };
}

// ─── C3: Matchup (head-to-head) ───────────────────
// Matches real: Date | League | Type | Winner | Score | PR A | PR B | Luck A | Luck B

function buildC3(playerData, playerName, globalFlags) {
    if (!playerData || !playerData.length) return { data: [], cols: [] };
    const allRows = flattenAllMatches(playerData);
    if (!allRows.length) return { data: [], cols: [] };

    // Pick the opponent with most matches
    const counts = new Map();
    for (const r of allRows) counts.set(r.opponent, (counts.get(r.opponent) || 0) + 1);
    const opponent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!opponent) return { data: [], cols: [] };

    const rows = allRows.filter(r => r.opponent === opponent)
        .sort((a, b) => (b.updatedAt ? new Date(b.updatedAt).getTime() : 0) - (a.updatedAt ? new Date(a.updatedAt).getTime() : 0));

    const cols = [
        { key: 'leagueTitle',label: 'League',  type: 'string', sortable: true, colorFn: null },
        { key: 'date',       label: 'Date',    type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0 },
        { key: 'leagueType', label: 'Type',    type: 'string', sortable: true, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'winner',     label: 'Winner',  type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => {
              const color = row._selfWon ? 'var(--color-win)' : 'var(--color-loss)';
              const t = row._technical ? ' <small>(T)</small>' : '';
              return `<b style="color:${color}">${v}</b>${t}`;
          } },
        { key: 'score', label: 'Score', type: 'string', sortable: false, colorFn: null },
        { key: 'prA',   label: 'PR A',  type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '—';
              const better = typeof row.prB === 'number' && v < row.prB;
              return better ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
          } },
        { key: 'prB',   label: 'PR B',  type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '—';
              const better = typeof row.prA === 'number' && v < row.prA;
              return better ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
          } },
        { key: 'luckA', label: 'Luck A', type: 'number', sortable: true, colorFn: null,
          format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
        { key: 'luckB', label: 'Luck B', type: 'number', sortable: true, colorFn: null,
          format: v => typeof v === 'number' ? v.toFixed(2) : '—' },
    ];

    const data = rows.map(r => {
        const matchLen = r.matchLength ?? 7;
        const won      = r.scoreSelf > r.scoreOpp;
        const winnerName = won ? playerName : opponent;
        const score    = r._technical
            ? (won ? `${matchLen}–0` : `0–${matchLen}`)
            : `${r.scoreSelf}–${r.scoreOpp}`;
        return {
            date:        r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
            _timestamp:  r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
            leagueTitle: r.leagueTitle,
            leagueType:  r.leagueType,
            winner:      winnerName,
            _selfWon:    won,
            _technical:  r._technical || false,
            score,
            prA: r._technical ? null : r.prSelf,
            prB: r._technical ? null : r.prOpp,
            luckA: r._technical || r.luckSelf == null ? null : r.luckSelf,
            luckB: r._technical || r.luckOpp  == null ? null : r.luckOpp,
        };
    });

    return { data, cols, playerName, opponent };
}

// ─── SF/exp player-cell helper (matches production: flag + linked name) ────

function sfPlayerCell(name, customFlags) {
    const code = getFlagCode(name, customFlags);
    return `<img class="flag" src="../assets/flags/${code}.png" alt="flag"> ${playerNameLink(name, null)}`;
}

function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MONTHS_SHORT[d.getUTCMonth()];
    const yr  = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
}

function resultClass(r) {
    return r === 'W' ? 'result-win' : r === 'L' ? 'result-loss' : 'result-draw';
}

// ─── A3: Achievements (SF) — Total PR ranking (doubling) ──────────
// Mirrors renderAchievementTables in landingPage.js (one card per metric).
// Lab shows the most representative metric — Total PR for doubling.

async function buildA3SF() {
    const data = await buildAllTimeRankings('doubling');
    const rows = (data.rankings.totalPR || []).slice(0, 50);
    if (!rows.length) return null;
    const cols = [
        { key: 'rank',   label: '#' },
        { key: 'player', label: 'Player', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.player, data.customFlags) },
        { key: 'value',  label: 'Total PR', format: v => formatNumber(v) },
    ];
    const out = rows.map(r => ({ rank: r.rank, player: r.name, value: r.value }));
    return { tableId: 'A3', data: out, cols, title: '🏆 Total PR', stickyCols: 0, showTopN: 5 };
}

// ─── A4: PR Leaders (SF) — Total PR + Level ───────────────────────
// Mirrors renderPRTables in landingPage.js.

async function buildA4SF() {
    const data = await buildAllTimeRankings('doubling');
    const rows = (data.rankings.totalPR || []).slice(0, 50);
    if (!rows.length) return null;
    const cols = [
        { key: 'rank',   label: '#' },
        { key: 'player', label: 'Player', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.player, data.customFlags) },
        { key: 'value',  label: 'PR',    format: v => formatNumber(v) },
        { key: 'level',  label: 'Level' },
    ];
    const out = rows.map(r => ({ rank: r.rank, player: r.name, value: r.value, level: getLevel(r.value) }));
    return { tableId: 'A4', data: out, cols, title: 'Total PR', stickyCols: 1, showTopN: 10 };
}

// ─── A5: Match Records (SF) — Best PR Matches ─────────────────────
// Mirrors renderMatchRecordsTables in landingPage.js (Best PR card).

async function buildA5SF() {
    const allLeagues = (await loadAllLeagues()).filter(l => l.leagueType === 'doubling' && !l.params.Hidden);
    if (!allLeagues.length) return null;
    const entries = topBestPRMatches(collectPRMatches(allLeagues), 50);
    if (!entries.length) return null;
    const cols = [
        { key: 'rank',     label: '#' },
        { key: 'player',   label: 'Player',  tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.player, r.customFlags) },
        { key: 'pr',       label: 'PR',      format: v => formatNumber(v) },
        { key: 'opponent', label: 'Opponent', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.opponent, r.customFlags) },
        { key: 'score',    label: 'Score',   format: (_, r) => `${r.scoreSelf}-${r.scoreOpp}` },
        { key: 'result',   label: 'Result',
          format: v => `<span class="${resultClass(v)}">${v}</span>` },
        { key: 'league',   label: 'League',
          format: (_, r) => `<a class="league-link" href="${leagueUrl(r.leagueId)}">${r.leagueTitle}</a>` },
        { key: 'date',     label: 'Date',    format: (_, r) => formatShortDate(r.date) },
    ];
    const out = entries.map((r, i) => ({
        rank: i + 1, player: r.player, pr: r.pr,
        opponent: r.opponent, scoreSelf: r.scoreSelf, scoreOpp: r.scoreOpp,
        result: r.result, leagueId: r.leagueId, leagueTitle: r.leagueTitle,
        date: r.date, customFlags: r.customFlags,
    }));
    return { tableId: 'A5', data: out, cols, title: 'Best PR Matches', stickyCols: 2, showTopN: 10 };
}

// ─── A6: League Records (SF) — Best PR Appearances ────────────────
// Reimplements the production collectLeagueRecords (landingPage.js) inline.

function _collectLeagueRecords(typeLeagues) {
    const rows = [];
    for (const league of typeLeagues) {
        if (league.params.Running === true) continue;
        const goldCount   = league.params.GoldCount   ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const customFlags = league.params.CustomFlags || {};
        const played = league.rankings.filter(r => r.games > 0);
        const totalPlayers = played.length;
        played.forEach((r, idx) => {
            const stats = league.statsMap.get(r.player);
            if (!stats || stats.meanPR == null) return;
            rows.push({
                player: r.player, meanPR: stats.meanPR, level: getLevel(stats.meanPR),
                playerRank: idx + 1, totalPlayers,
                goldCount, silverCount, bronzeCount,
                leagueId: league.id, leagueTitle: league.title,
                date: league.params.IssueDate || '', customFlags,
            });
        });
    }
    rows.sort((a, b) => a.meanPR - b.meanPR);
    return rows.slice(0, 100);
}

async function buildA6SF() {
    const allLeagues = (await loadAllLeagues()).filter(l => l.leagueType === 'doubling' && !l.params.Hidden);
    if (!allLeagues.length) return null;
    const entries = _collectLeagueRecords(allLeagues);
    if (!entries.length) return null;
    const rankCellHtml = (r) => {
        const cls = r.playerRank <= r.goldCount                                 ? 'lr-rank-gold'
                  : r.playerRank <= r.goldCount + r.silverCount                 ? 'lr-rank-silver'
                  : r.playerRank <= r.goldCount + r.silverCount + r.bronzeCount ? 'lr-rank-bronze'
                  : '';
        return `<span class="${cls}">${r.playerRank} / ${r.totalPlayers}</span>`;
    };
    const cols = [
        { key: 'rank',   label: '#' },
        { key: 'player', label: 'Player', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.player, r.customFlags) },
        { key: 'pr',     label: 'PR',    format: v => formatNumber(v) },
        { key: 'level',  label: 'Level' },
        { key: 'rankInLeague', label: 'Rank', format: (_, r) => rankCellHtml(r) },
        { key: 'league', label: 'League',
          format: (_, r) => `<a class="league-link" href="${leagueUrl(r.leagueId)}">${r.leagueTitle}</a>` },
        { key: 'date',   label: 'Date',  format: (_, r) => formatShortDate(r.date) },
    ];
    const out = entries.map((r, i) => ({
        rank: i + 1, player: r.player, pr: r.meanPR, level: r.level,
        playerRank: r.playerRank, totalPlayers: r.totalPlayers,
        goldCount: r.goldCount, silverCount: r.silverCount, bronzeCount: r.bronzeCount,
        leagueId: r.leagueId, leagueTitle: r.leagueTitle, date: r.date,
        customFlags: r.customFlags,
    }));
    return { tableId: 'A6', data: out, cols, title: 'Best PR Appearances', stickyCols: 2, showTopN: 10 };
}

// ─── C4: Player Match Records (SF) — Best PR for top player ────────
// Mirrors renderPlayerRecordTable in playerGeneralPage.js.

async function buildC4SF(playerData, playerName) {
    if (!playerData || !playerData.length) return null;
    const entries = collectPlayerBestPR(playerData, 'doubling', 50);
    if (!entries.length) return null;
    const cols = [
        { key: 'rank',     label: '#' },
        { key: 'metric',   label: 'PR',     format: v => formatNumber(v) },
        { key: 'opponent', label: 'Opponent', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.opponent, r.customFlags) },
        { key: 'score',    label: 'Score',  format: (_, r) => `${r.scoreSelf}-${r.scoreOpp}` },
        { key: 'result',   label: 'Result',
          format: v => `<span class="${resultClass(v)}">${v}</span>` },
        { key: 'league',   label: 'League',
          format: (_, r) => `<a class="league-link" href="${leagueUrl(r.leagueId)}">${r.leagueTitle}</a>` },
        { key: 'date',     label: 'Date',   format: (_, r) => formatShortDate(r.date) },
    ];
    const out = entries.map((r, i) => ({
        rank: i + 1, metric: r.metric,
        opponent: r.opponent, scoreSelf: r.scoreSelf, scoreOpp: r.scoreOpp,
        result: r.result, leagueId: r.leagueId, leagueTitle: r.leagueTitle,
        date: r.date, customFlags: r.customFlags,
    }));
    return { tableId: 'C4', data: out, cols, title: 'Best PR', stickyCols: 1, showTopN: 5, playerName };
}

// ─── C0: Expandable rank (exp) — Total PR all-time ────────────────
// Mirrors renderRankTable in playerGeneralPage.js (PR kind, totalPR metric).

async function buildC0Exp(playerName) {
    if (!playerName) return null;
    const data = await buildAllTimeRankings('doubling');
    const rows = data.rankings.totalPR || [];
    if (!rows.length) return null;
    const cols = [
        { key: 'rank',    label: '#' },
        { key: 'name',    label: 'Player', tdClass: 'player-cell',
          format: (_, r) => sfPlayerCell(r.name, data.customFlags) },
        { key: 'leagues', label: 'Leagues' },
        { key: 'value',   label: 'Total PR', format: v => formatNumber(v) },
    ];
    const out = rows.map(r => ({ rank: r.rank, name: r.name, leagues: r.leagues ?? '', value: r.value }));
    return { tableId: 'C0', data: out, cols, selfKey: 'name', selfValue: playerName, playerName };
}

// ─── Helper: load allMatchesIncUnplayed for one league ──

async function loadAllMatchesForLeague(leagueId) {
    try {
        const encoded = encodeURIComponent(leagueId);
        const resp = await fetch(`../leagues/${encoded}/leaguedata.csv`);
        if (!resp.ok) return null;
        const text = await resp.text();
        return parseCSVAllWithRounds(text).matches;
    } catch { return null; }
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
    const runningResult    = allResults.find(r => r.league.params.Running) || allResults[0] || null;

    // Load allMatchesIncUnplayed for the running league (needed for B5/B6a/B6c)
    const allMatchesIncUnplayed = runningResult
        ? await loadAllMatchesForLeague(runningResult.league.id)
        : null;

    // Top player of the running league — used for C tables
    const topPlayer = runningResult?.rankings?.[0]?.player || null;
    const playerAcrossLeagues = topPlayer ? await loadPlayerAcrossLeagues(topPlayer) : [];

    // SF/exp builders are async (they call loadAllLeagues + buildAllTimeRankings).
    // Resolve in parallel and silently drop any that fail (e.g. no doubling leagues).
    const sfExpKeys = ['A3', 'A4', 'A5', 'A6', 'C0', 'C4'];
    const sfExpResults = await Promise.all([
        buildA3SF().catch(() => null),
        buildA4SF().catch(() => null),
        buildA5SF().catch(() => null),
        buildA6SF().catch(() => null),
        buildC0Exp(topPlayer).catch(() => null),
        buildC4SF(playerAcrossLeagues, topPlayer).catch(() => null),
    ]);
    const sfExp = Object.fromEntries(sfExpKeys.map((k, i) => [k, sfExpResults[i]]));

    return {
        A1:  buildA1(completedResults, globalFlags),
        A2:  buildA2(allResults, globalFlags),
        A3:  sfExp.A3,
        A4:  sfExp.A4,
        A5:  sfExp.A5,
        A6:  sfExp.A6,
        B1:  buildB1(runningResult),
        B2:  buildB2(runningResult),
        B3:  buildB3(runningResult),
        B4:  buildB4(runningResult),
        B5:  buildB5(runningResult, allMatchesIncUnplayed),
        B6a: buildB6a(runningResult, allMatchesIncUnplayed),
        B6b: buildB6b(runningResult),
        B6c: buildB6c(runningResult, allMatchesIncUnplayed),
        C0:  sfExp.C0,
        C1:  buildC1(playerAcrossLeagues, topPlayer),
        C2:  buildC2(playerAcrossLeagues, topPlayer, globalFlags),
        C3:  buildC3(playerAcrossLeagues, topPlayer, globalFlags),
        C4:  sfExp.C4,
        D:   buildD(allResults),
        E:   buildE(allResults),
    };
}
