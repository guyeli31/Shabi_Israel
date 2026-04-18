/**
 * luckPercentile.js — Z-score → percentile for "luckiness".
 *
 * For each of a player's historical PR matches, look up the a-priori win
 * probability (from PR diff + match length), then compare actual wins to
 * expected wins. Standardize into a Z-score and map to a percentile via
 * the standard normal CDF.
 *
 * Pure compute module — no DOM, no I/O.
 */

import {
    nearestMatchLengthIdx,
    getWinProbability,
    normalCDF
} from './championshipPredictor.js';

/**
 * Compute luck-percentile stats for a single player across a set of matches.
 *
 * @param {Object} params
 * @param {Array} params.matchRefs  — [{ m, matchLength }, …] where m has
 *     { playerA, prA, scoreA, playerB, prB, scoreB, _technical? }.
 * @param {string} params.playerName
 * @returns {{
 *     games: number,
 *     aw: number,          // actual wins
 *     ew: number,          // Σ p_i
 *     varSum: number,      // Σ p_i(1−p_i)
 *     z: number|null,
 *     percentile: number|null,
 *     unstableSample: boolean
 * }}
 */
export function luckPercentileStats({ matchRefs, playerName }) {
    let games = 0, aw = 0, ew = 0, varSum = 0;

    for (const { m, matchLength } of matchRefs) {
        if (m._technical) continue;

        const isA = m.playerA === playerName;
        if (!isA && m.playerB !== playerName) continue;

        // PR of 0 is the sentinel for "missing" in this CSV format.
        if (!(m.prA > 0) || !(m.prB > 0)) continue;

        const scoreSelf = isA ? m.scoreA : m.scoreB;
        const scoreOpp  = isA ? m.scoreB : m.scoreA;
        if (scoreSelf === 0 && scoreOpp === 0) continue;

        const mlIdx = nearestMatchLengthIdx(matchLength || 7);
        const pA = getWinProbability(m.prA, m.prB, mlIdx);
        const pSelf = isA ? pA : (1 - pA);

        ew += pSelf;
        varSum += pSelf * (1 - pSelf);
        if (scoreSelf > scoreOpp) aw += 1;
        games += 1;
    }

    if (games === 0) {
        return { games: 0, aw: 0, ew: 0, varSum: 0, z: null, percentile: null, unstableSample: true };
    }

    let z, percentile;
    if (varSum === 0) {
        z = 0;
        percentile = 50;
    } else {
        z = (aw - ew) / Math.sqrt(varSum);
        percentile = Math.round(normalCDF(z) * 100);
    }

    return {
        games,
        aw,
        ew,
        varSum,
        z,
        percentile,
        unstableSample: games < 15
    };
}
