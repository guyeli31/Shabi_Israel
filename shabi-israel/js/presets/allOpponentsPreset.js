/**
 * allOpponentsPreset.js — C4 preset for the player.html H2H tab.
 *
 * Aggregates every match the player has played (across ALL league types) into
 * one row per opponent, showing averages. Left column (Opponent) is sticky and
 * clickable — clicking opens the C3 head-to-head detail above. Win% is tinted
 * with the shared red→green scale on a fixed 0–1 range, identical to the
 * landing page's "Best Win Rate Appearances" column. Luck is the canonical Luck
 * Confidence percentile D per opponent, tinted on its own fixed 0–100 range.
 */

import { colorForValue } from '../compute/colorScale.js';
import { luckConfidenceFromItems } from '../compute/luckConfidence.js';
import { getWinProbability, nearestMatchLengthIdx } from '../compute/championshipPredictor.js';
import { displayPlayerName } from '../utils/nameDisplay.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const num2 = v => (typeof v === 'number' && !isNaN(v)) ? v.toFixed(2) : '<span class="na">N/A</span>';

/**
 * Collapse flattenAllMatches() rows into per-opponent aggregates.
 * Technical results are excluded from the PR means (no real game played),
 * but still count toward Matches and Win%.
 *
 * Luck is the site's canonical Luck Confidence percentile D (0–100, see
 * compute/luckConfidence.js), computed from ONLY the matches against that
 * opponent: given how strong each side played (PR), how confident are we that
 * the player has been running above the model in this particular matchup.
 * 50 = exactly on model. It replaces the old mean-luck differential, which was
 * a raw per-match luck average and did not agree with the number the rest of
 * the site prints under the name "Luck".
 *
 * The evidence filter matches luckConfidenceStats() exactly — technical
 * results, draws and unrated (PR ≤ 0) matches carry no information about luck.
 *
 * @returns {object[]} one row per opponent:
 *          { opponent, matches, pr, oppPr, luck, luckGames, winRate }
 */
export function aggregateOpponents(allRows) {
    const map = new Map();
    for (const r of allRows) {
        const name = r.opponent;
        if (!name) continue;
        let a = map.get(name);
        if (!a) {
            a = { opponent: name, matches: 0, wins: 0,
                  prSum: 0, prN: 0, oppPrSum: 0, oppPrN: 0,
                  luckItems: [] };
            map.set(name, a);
        }
        a.matches++;
        if (r.scoreSelf > r.scoreOpp) a.wins++;
        if (!r._technical) {
            if (typeof r.prSelf === 'number') { a.prSum    += r.prSelf; a.prN++; }
            if (typeof r.prOpp  === 'number') { a.oppPrSum += r.prOpp;  a.oppPrN++; }
        }
        if (!r._technical && !r._draw
            && r.prSelf > 0 && r.prOpp > 0
            && r.scoreSelf !== r.scoreOpp) {
            a.luckItems.push({
                pWin: getWinProbability(r.prSelf, r.prOpp, nearestMatchLengthIdx(r.matchLength || 7)),
                outcome: r.scoreSelf > r.scoreOpp ? 1 : 0,
            });
        }
    }
    return [...map.values()].map(a => ({
        opponent:  a.opponent,
        matches:   a.matches,
        pr:        a.prN    ? a.prSum    / a.prN    : null,
        oppPr:     a.oppPrN ? a.oppPrSum / a.oppPrN : null,
        luck:      a.luckItems.length ? luckConfidenceFromItems(a.luckItems) : null,
        luckGames: a.luckItems.length,
        winRate:   a.matches ? a.wins / a.matches : 0,
    }));
}

/**
 * @param {object} input
 *   opponents — aggregateOpponents() output
 *   enrich    — { flagFor(name) => html,          (flag <img> placed left of the name)
 *                 opponentSuffix(name) => html }  (title badges placed right of the name)
 */
export function buildAllOpponentsPreset({ opponents, enrich = {} }) {
    const cols = [
        { key: 'opponent', label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'c4-opp-cell',
          format: v => {
              const flag = enrich.flagFor ? enrich.flagFor(v) : '';
              // Suffix sits outside the button — the badge is decoration, not a click target.
              const suffix = enrich.opponentSuffix ? enrich.opponentSuffix(v) : '';
              return `<button type="button" class="c4-opp-link" data-name="${esc(v)}">${flag}<span class="c4-opp-name">${esc(displayPlayerName(v))}</span></button>${suffix}`;
          } },
        { key: 'winRate',  label: 'Win%',     type: 'number', sortable: true,
          tdClass: 'c4-winrate',
          // Fixed 0–1 range matches "Best Win Rate Appearances" on the landing page.
          colorFn: v => colorForValue(v, 0, 1),
          format: v => `${Math.round(v * 100)}%` },
        { key: 'matches',  label: 'MP',       type: 'number', sortable: true, colorFn: null,
          format: v => String(v) },
        { key: 'pr',       label: 'PR',       type: 'number', sortable: true, colorFn: null,
          format: num2 },
        { key: 'oppPr',    label: 'Opp PR',   type: 'number', sortable: true, colorFn: null,
          format: num2 },
        // Luck Confidence percentile D, tinted on the fixed 0–100 scale (NOT the
        // column's own min/max): 50 must always read as "on model", exactly as
        // the Total Luck table (C6) and the landing page's Best/Worst Luck
        // records print it. An opponent with no rated, decided match has no
        // model to be lucky against — the row's luck is null, which MF prints
        // as an em dash (format is never called for it), not a misleading 50.
        { key: 'luck',     label: 'Luck',     type: 'number', sortable: true, colorFn: null,
          tdClass: 'c4-luck',
          format: (v, row) => {
              const n = row.luckGames;
              const title = `Luck percentile ${Math.round(v)}/100 from ${n} rated match${n === 1 ? '' : 'es'} against this opponent. 50 = exactly on-model.`;
              return `<span style="color:${colorForValue(v, 0, 100)};font-weight:600" title="${esc(title)}">${Math.round(v)}</span>`;
          } },
    ];

    // Default sort: Win% descending — highest at the top.
    const data = [...opponents].sort((a, b) => b.winRate - a.winRate);

    return {
        tableId:   'C4',
        data,
        cols,
        fontClass: 'font-small',
        stickyCols: 1,
        medalRows: false,
        showTopN:  null,   // always fully open — every opponent shown
    };
}
