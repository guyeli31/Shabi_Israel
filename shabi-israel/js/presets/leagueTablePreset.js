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
import { displayPlayerName } from '../utils/nameDisplay.js';
import { getMedalPlaces } from '../compute/prizeRows.js';
import { isRetired, RETIRED_ROW_CLASS } from '../render/retirementMarks.js';

const LEVEL_EDGES = new Set([LEVELS[0].label, LEVELS[LEVELS.length - 1].label]);

function pct(v) { return (v * 100).toFixed(2) + '%'; }

function defaultPlayerCell(name, customFlags, flagUrl, enrich) {
    const code = getFlagCode(name, customFlags);
    const img  = `<img class="flag" src="${flagUrl(code)}" alt="${code}">`;
    const linkOpen  = enrich?.playerLink   ? enrich.playerLink(name)   : { open: '', close: '' };
    const suffixHtml = enrich?.playerSuffix ? enrich.playerSuffix(name) : '';
    // Honor the global "Show name as" preference. displayPlayerName falls
    // back to the username when no full-name metadata is available.
    return `${img}${linkOpen.open}${displayPlayerName(name)}${linkOpen.close}${suffixHtml}`;
}

/**
 * SHOWING THE TIEBREAK INSTEAD OF ASSERTING IT.
 *
 * Mean PR prints to two decimals and is compared raw, so a tie broken by PR can
 * be invisible: September 2026 showed two players on 58.33% and 4.91 each, one
 * ranked above the other, and the only honest reading of that table was "the
 * order here is arbitrary". It was not — 4.91204167 beat 4.91233333.
 *
 * Where PR actually decided the order, this opens the column just far enough to
 * show WHERE, and nowhere else. The result is a table that explains its own
 * ranking rather than asking to be trusted.
 *
 * THE THREE CONDITIONS, all required:
 *   1. The league ranks on Mean PR as its secondary (doubling, UBC — never
 *      REGULAR, which has no PR and cascades through head-to-head instead).
 *   2. The group is level on the PRIMARY key, so PR is what separates them.
 *   3. NOBODY in the group has a match left. PR moves with every match played,
 *      so until a player is done, the decimals on display would be a ranking
 *      that silently rewrites itself — precision implying a finality the data
 *      does not have. A league mid-season simply shows 4.91, as before.
 *
 * A group whose PRs are equal bit-for-bit is left alone too: there the alphabet
 * decides, and extra zeros would dress up a coin toss as a measurement.
 *
 * @param {object[]} active       ranked rows, retired already removed
 * @param {object}   leagueConfig getLeagueConfig output
 * @param {(name:string)=>boolean} [hasRemaining] omitted (historical views, the
 *        lab) disables the feature rather than guessing who is finished
 * @returns {Map<string,number>} player → decimals, only where > 2
 */
const PR_TIEBREAK_MAX_DIGITS = 8;
function prTiebreakDigits(active, leagueConfig, hasRemaining) {
    const out = new Map();
    const ranking = leagueConfig && leagueConfig.ranking;
    if (!ranking || ranking.secondary !== 'meanPR' || leagueConfig.showPR === false) return out;
    if (typeof hasRemaining !== 'function') return out;

    const primary = ranking.primary;
    let i = 0;
    while (i < active.length) {
        let j = i + 1;
        while (j < active.length && active[j][primary] === active[i][primary]) j++;
        const group = active.slice(i, j);
        i = j;

        if (group.length < 2) continue;
        if (group.some(g => typeof g.meanPR !== 'number')) continue;

        // Being level on the primary is not enough to earn extra digits: in a
        // five-way Win% tie on 4.06 / 4.91 / 4.91 / 8.42 / 11.69, the column
        // already separates everyone except the 4.91 pair. Opening the whole
        // group would print 4.0600 and 11.6900 — noise that buries the one
        // place a reader needs to look. So the unit is the set of players the
        // PRINTED column cannot tell apart, and each such set opens on its own.
        const byPrinted = new Map();
        for (const g of group) {
            const k = g.meanPR.toFixed(2);
            if (!byPrinted.has(k)) byPrinted.set(k, []);
            byPrinted.get(k).push(g);
        }

        for (const cluster of byPrinted.values()) {
            if (cluster.length < 2) continue;
            // "Finished" is asked of the players actually in this contest, not
            // of the whole Win% group. A fifth player elsewhere in the group
            // who still has a fixture cannot change the order between two
            // players who are both done, so he must not suppress their
            // explanation.
            if (cluster.some(g => hasRemaining(g.player))) continue;
            const vals = cluster.map(g => g.meanPR);
            // Identical to the last bit: PR did not decide this, the alphabet
            // did, and trailing zeros would dress up a coin toss as a
            // measurement. (Checked first — with no differing pair to find,
            // the search below would happily "separate" them at 3 digits.)
            if (new Set(vals).size === 1) continue;

            // Every pair that genuinely differs must print differently; pairs
            // that are equal stay equal at any precision and must not drag the
            // search out to 8 digits on their behalf.
            const separates = (d) => {
                for (let a = 0; a < vals.length; a++) {
                    for (let b = a + 1; b < vals.length; b++) {
                        if (vals[a] !== vals[b] && vals[a].toFixed(d) === vals[b].toFixed(d)) return false;
                    }
                }
                return true;
            };

            let digits = PR_TIEBREAK_MAX_DIGITS;
            for (let d = 3; d < PR_TIEBREAK_MAX_DIGITS; d++) {
                if (separates(d)) { digits = d; break; }
            }
            for (const g of cluster) out.set(g.player, digits);
        }
    }
    return out;
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
export function buildLeagueTablePreset({ rankings, averages, params, leagueConfig, flagUrl, enrich = {}, hasRemaining }) {
    const customFlags = params.CustomFlags || {};
    // Places per tier INCLUDING the tier's extra prize rows — two Gold rows of
    // one place each are two gold medals, and the badges have to agree with B1.
    const { gold: goldCount, silver: silverCount, bronze: bronzeCount } =
        getMedalPlaces(params, { gold: 1, silver: 1, bronze: 3 });

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
            // x̄ notation: a bar over "Pts" reads as the average, at the width of "Pts".
            { key: 'avgPoints', label: '<span class="th-mean" title="Average points per match">Pts</span>', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValue(v, min, max), boldExtreme: true,
              format: v => v.toFixed(2) },
        ] : []),
        ...(leagueConfig.showPR ? [
            { key: 'meanPR', label: 'PR', type: 'number', sortable: true,
              colorFn: (v, min, max) => colorForValueInverted(v, min, max), boldExtreme: true,
              // The two decimals everyone reads, plus — only for a group PR
              // actually separated (see prTiebreakDigits) — the digits that did
              // the separating, dimmed so the column still scans as 4.91.
              format: (v, row) => {
                  const d = row && row._prDigits;
                  if (!d) return v.toFixed(2);
                  const s = v.toFixed(d);
                  const head = s.slice(0, s.indexOf('.') + 3);
                  const tail = s.slice(s.indexOf('.') + 3);
                  return `<span title="Tied on the main score — this is where Mean PR separates them">`
                       + `${head}<span class="pr-tiebreak-digits">${tail}</span></span>`;
              } },
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

    // D is the one table that still shows a retired player — he was in this
    // league and the table says so — but he is not IN the competition: every
    // one of his fixtures is cancelled, so he has nothing to be ranked on.
    //
    // He therefore sits BELOW everyone, including players who simply have not
    // played yet, and carries no rank number at all. Leaving him in the normal
    // sort would have put him among the 0-game players, where a reader can only
    // read his position as "last place" — a competitive claim about someone who
    // never competed. An empty rank cell makes no claim.
    // See docs/RETIREMENT-POLICY.md §3.
    const retiredOf = (row) => isRetired(params, row.player);
    const active = rankings.filter(r => !retiredOf(r));
    const retired = rankings.filter(retiredOf);

    const prDigits = prTiebreakDigits(active, leagueConfig, hasRemaining);

    const data = [
        ...active.map((row, i) => ({
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
            _retired:  false,
            _prDigits: prDigits.get(row.player),
        })),
        // Every numeric is null on purpose — the mount renders null as "—", and
        // a dash is the honest reading. A 0 would be a result he achieved.
        ...retired.map((row) => ({
            _origRank: null,
            rank:      '',
            player:    row.player,
            gp:        null, wins: null, losses: null, winRate: null,
            prWins:    null, points: null, avgPoints: null,
            meanPR:    null, level: '', luck: null,
            _unplayed: false,
            _retired:  true,
        })),
    ];

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
        if (row._retired)  parts.push('retired', RETIRED_ROW_CLASS);
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
