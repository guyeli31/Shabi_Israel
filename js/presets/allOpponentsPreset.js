/**
 * allOpponentsPreset.js — C4 preset for the player.html H2H tab.
 *
 * Aggregates every match the player has played (across ALL league types) into
 * one row per opponent, showing averages. Left column (Opponent) is sticky and
 * clickable — clicking opens the C3 head-to-head detail above. Win% is tinted
 * with the shared red→green scale on a fixed 0–1 range, identical to the
 * landing page's "Best Win Rate Appearances" column.
 */

import { colorForValue } from '../compute/colorScale.js';
import { displayPlayerName } from '../utils/nameDisplay.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const num2 = v => (typeof v === 'number' && !isNaN(v)) ? v.toFixed(2) : '<span class="na">N/A</span>';

/**
 * Collapse flattenAllMatches() rows into per-opponent aggregates.
 * Technical results are excluded from PR/Luck means (no real game played),
 * but still count toward Matches and Win%.
 *
 * Luck is a differential: the player's mean luck MINUS the opponent's mean luck
 * (positive ⇒ the player ran luckier than the opponent across their matches).
 *
 * @returns {object[]} one row per opponent: { opponent, matches, pr, oppPr, luck, winRate }
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
                  luckSum: 0, luckN: 0, luckOppSum: 0, luckOppN: 0 };
            map.set(name, a);
        }
        a.matches++;
        if (r.scoreSelf > r.scoreOpp) a.wins++;
        if (!r._technical) {
            if (typeof r.prSelf   === 'number') { a.prSum      += r.prSelf;   a.prN++; }
            if (typeof r.prOpp    === 'number') { a.oppPrSum    += r.prOpp;    a.oppPrN++; }
            if (typeof r.luckSelf === 'number') { a.luckSum     += r.luckSelf; a.luckN++; }
            if (typeof r.luckOpp  === 'number') { a.luckOppSum  += r.luckOpp;  a.luckOppN++; }
        }
    }
    return [...map.values()].map(a => {
        const selfLuck = a.luckN    ? a.luckSum    / a.luckN    : null;
        const oppLuck  = a.luckOppN ? a.luckOppSum / a.luckOppN : null;
        const luck = (selfLuck != null && oppLuck != null) ? selfLuck - oppLuck
                   : (selfLuck != null ? selfLuck : null);
        return {
            opponent: a.opponent,
            matches:  a.matches,
            pr:       a.prN     ? a.prSum   / a.prN     : null,
            oppPr:    a.oppPrN  ? a.oppPrSum / a.oppPrN : null,
            luck,
            winRate:  a.matches ? a.wins    / a.matches : 0,
        };
    });
}

/**
 * @param {object} input
 *   opponents — aggregateOpponents() output
 *   enrich    — { flagFor(name) => html }  (flag <img> placed left of the name)
 */
export function buildAllOpponentsPreset({ opponents, enrich = {} }) {
    const cols = [
        { key: 'opponent', label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'c4-opp-cell',
          format: v => {
              const flag = enrich.flagFor ? enrich.flagFor(v) : '';
              return `<button type="button" class="c4-opp-link" data-name="${esc(v)}">${flag}<span class="c4-opp-name">${esc(displayPlayerName(v))}</span></button>`;
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
        { key: 'luck',     label: 'Luck',     type: 'number', sortable: true, colorFn: null,
          format: num2 },
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
