/**
 * leagueTablePreset.js — Single source of truth for the D (League Table)
 * preset consumed by mountMFTable.
 *
 * Both the live league.html page and the table-lab/D tab call this builder
 * so they always render the same shape. Page-specific enrichments
 * (player links, title abbreviations, retired marks) are injected via
 * optional `enrich` callbacks so the lab can stay dependency-free.
 */

import { LEVELS } from '../compute/rankings.js';
import { colorForValue, colorForValueInverted, colorForGames, colorForLevel } from '../compute/colorScale.js';
import { getFlagCode } from '../utils/helpers.js';

const LEVEL_EDGES = new Set([LEVELS[0].label, LEVELS[LEVELS.length - 1].label]);

function pct(v) { return (v * 100).toFixed(2) + '%'; }

function defaultPlayerCell(name, customFlags, flagUrl, enrich) {
    const code = getFlagCode(name, customFlags);
    const img  = `<img class="flag" src="${flagUrl(code)}" alt="${code}">`;
    const linkOpen  = enrich?.playerLink   ? enrich.playerLink(name)   : { open: '', close: '' };
    const suffixHtml = enrich?.playerSuffix ? enrich.playerSuffix(name) : '';
    return `${img}${linkOpen.open}${name}${linkOpen.close}${suffixHtml}`;
}

function rankBadge(rank, gold, silver, bronze, displayPos) {
    const show = displayPos !== undefined ? displayPos : rank;
    if (rank <= gold)                        return `<span class="medal medal-gold">${show}</span>`;
    if (rank <= gold + silver)               return `<span class="medal medal-silver">${show}</span>`;
    if (rank <= gold + silver + bronze)      return `<span class="medal medal-bronze">${show}</span>`;
    return String(show);
}

/**
 * Build a full mountMFTable args object for the D league table.
 *
 * @param {object} input
 *   rankings     — output of buildRankings()
 *   averages     — output of computeAverages() (or null)
 *   params       — league_params.json contents
 *   leagueConfig — output of getLeagueConfig(params)
 *   flagUrl      — (countryCode) => string  url to flag PNG, lets caller
 *                  control relative path (lab is one level deeper than root pages)
 *   enrich       — optional, page-specific player cell enrichments:
 *                    playerLink(name)   => { open, close }   (e.g. "<a href=...>" + "</a>")
 *                    playerSuffix(name) => html string       (titles, retired mark, etc)
 *                    isHidden(name)     => boolean           (hidden players show "N/A")
 */
export function buildLeagueTablePreset({ rankings, averages, params, leagueConfig, flagUrl, enrich = {} }) {
    const customFlags = params.CustomFlags || {};
    const goldCount   = params.GoldCount   ?? 1;
    const silverCount = params.SilverCount ?? 1;
    const bronzeCount = params.BronzeCount ?? 3;

    const cols = [
        { key: 'rank',   label: '#',      type: 'number', sortable: false, colorFn: null,
          format: (v, row, idx) => rankBadge(row._origRank ?? v, goldCount, silverCount, bronzeCount, idx + 1) },
        { key: 'player', label: 'Player', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => {
              if (enrich.isHidden && enrich.isHidden(v)) return `<i class="player-hidden">N/A</i>`;
              return defaultPlayerCell(v, customFlags, flagUrl, enrich);
          } },
        { key: 'gp',     label: 'MP', type: 'number', sortable: true,
          colorFn: (v, _min, _max) => colorForGames(v), boldExtreme: true },
        { key: 'wins',   label: 'W',  type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
        { key: 'losses', label: 'L',  type: 'number', sortable: true,
          colorFn: (v, min, max) => colorForValueInverted(v, min, max), boldExtreme: true },
        ...(leagueConfig.showWinRate ? [
            { key: 'winRate', label: 'Win%', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => pct(v) },
        ] : []),
        ...(leagueConfig.showPRWins ? [
            { key: 'prWins',    label: 'PRW',     type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
            { key: 'points',    label: 'Pts',     type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true },
            { key: 'avgPoints', label: 'Avg Pts', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
        ] : []),
        ...(leagueConfig.showPR ? [
            { key: 'meanPR', label: 'PR', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValueInverted(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
            { key: 'level',  label: 'Level', type: 'string', sortable: true, colorFn: null,
              sortKey: row => row.meanPR,
              format: v => {
                  if (!v) return '—';
                  const color = colorForLevel(v);
                  const text  = LEVEL_EDGES.has(v) ? `<b>${v}</b>` : v;
                  return color ? `<span style="color:${color}">${text}</span>` : text;
              } },
        ] : []),
        ...(leagueConfig.showLuck !== false ? [
            { key: 'luck', label: 'Luck', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
        ] : []),
    ];

    const data = rankings.map((row, i) => ({
        _origRank: row.originalRank ?? row.rank,
        rank:      i + 1,
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
        _unplayed: row.winRate === null,
        _retired:  (params.RetiredPlayers || []).includes(row.player),
    }));

    const buildSummaryRow = averages
        ? () => ({
            rank:      '',
            player:    'AVERAGES',
            gp:        averages.games != null ? averages.games.toFixed(2) : '',
            wins:      averages.wins != null ? averages.wins.toFixed(2) : '',
            losses:    averages.losses != null ? averages.losses.toFixed(2) : '',
            winRate:   leagueConfig.showWinRate && averages.winRate   != null ? pct(averages.winRate)        : null,
            prWins:    leagueConfig.showPRWins  && averages.prWins    != null ? averages.prWins.toFixed(1)   : null,
            points:    leagueConfig.showPRWins  && averages.points    != null ? averages.points.toFixed(1)   : null,
            avgPoints: leagueConfig.showPRWins  && averages.avgPoints != null ? averages.avgPoints.toFixed(2): null,
            meanPR:    leagueConfig.showPR      && averages.meanPR    != null ? averages.meanPR.toFixed(2)   : null,
            level:     '',
            luck:      averages.luck != null ? averages.luck.toFixed(2) : null,
        })
        : null;

    const getRowClass = (row) => {
        const parts = [];
        if (row._unplayed) parts.push('unplayed');
        if (row._retired)  parts.push('retired');
        return parts.length ? parts.join(' ') : null;
    };

    return {
        tableId:    'D',
        data,
        cols,
        fontClass:  'font-small',
        stickyCols: 2,
        medalRows:  true,
        medalCounts: { gold: goldCount, silver: silverCount, bronze: bronzeCount },
        showTopN:   null,
        getRowClass,
        buildSummaryRow,
    };
}
