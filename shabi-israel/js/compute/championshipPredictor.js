/**
 * championshipPredictor.js — Monte Carlo / Exact simulation engine
 * for predicting championship win probabilities.
 *
 * Simulation strategy by league type:
 *   - Doubling / Regular: Exact enumeration (≤20 matches) or Monte Carlo (>20).
 *     PR win points are deterministic (not used in scoring).
 *   - UBC: Always Monte Carlo. PR win points are probabilistic — each player's
 *     per-match PR is modeled as N(mean, std) and the PR win outcome is sampled
 *     via the normal CDF: P(A wins PR) = Φ((μB−μA) / √(σA²+σB²)).
 *
 * Pure compute module: no DOM, no async — except prProbabilityTableHtml(),
 * which builds a static HTML string and reads the active theme (via
 * colorScale.js) to color its cells, same as the render layer does elsewhere.
 */

import { colorForValue } from './colorScale.js';
import { pmTableHtml } from '../../table-lab/formats/pm/mount.js';
import { resolveTie, needsMatchData, assertTablesFor } from './tiebreaks.js';

// ── Probability lookup table ────────────────────────────────────────
// Win probability (%) for the better (lower PR) player, indexed by
// PR difference (rows 0-10) and match length (columns).
const PR_PROBABILITY_TABLE = {
    matchLengths: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25],
    probabilitiesByPrDiff: {
        0:  [50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0],
        1:  [50.9, 51.6, 52.1, 52.5, 52.8, 53.1, 53.4, 53.7, 53.9, 54.1, 54.3, 54.5, 54.7],
        2:  [51.9, 53.3, 54.2, 55.0, 55.7, 56.3, 56.8, 57.3, 57.8, 58.2, 58.6, 59.0, 59.4],
        3:  [52.8, 54.9, 56.3, 57.5, 58.5, 59.3, 60.1, 60.9, 61.5, 62.2, 62.8, 63.3, 63.9],
        4:  [53.8, 56.5, 58.4, 59.9, 61.2, 62.3, 63.4, 64.3, 65.2, 66.0, 66.7, 67.5, 68.1],
        5:  [54.7, 58.2, 60.5, 62.3, 63.9, 65.2, 66.5, 67.6, 68.6, 69.6, 70.5, 71.3, 72.1],
        6:  [55.7, 59.7, 62.5, 64.6, 66.5, 68.0, 69.5, 70.7, 71.9, 73.0, 74.0, 74.9, 75.8],
        7:  [56.6, 61.3, 64.4, 66.9, 69.0, 70.7, 72.3, 73.7, 75.0, 76.1, 77.2, 78.2, 79.1],
        8:  [57.5, 62.9, 66.4, 69.1, 71.3, 73.3, 74.9, 76.4, 77.8, 79.0, 80.1, 81.1, 82.0],
        9:  [58.5, 64.4, 68.2, 71.2, 73.6, 75.7, 77.4, 79.0, 80.4, 81.6, 82.7, 83.8, 84.7],
        10: [59.4, 65.9, 70.0, 73.2, 75.8, 77.9, 79.7, 81.3, 82.7, 84.0, 85.1, 86.1, 87.0]
    }
};

/**
 * Build an HTML table of the win-probability calibration data, indexed by
 * PR difference (rows) and match length (columns). Generated from
 * PR_PROBABILITY_TABLE so the displayed figures never drift from the engine.
 */
export function prProbabilityTableHtml(lang = 'en') {
    const lens = PR_PROBABILITY_TABLE.matchLengths;
    const rows = PR_PROBABILITY_TABLE.probabilitiesByPrDiff;
    const allValues = Object.values(rows).flat();
    const minV = Math.min(...allValues);
    const maxV = Math.max(...allValues);
    const gapLabel = lang === 'he' ? 'הפרש&nbsp;PR' : 'PR&nbsp;gap';
    const lenLabel = lang === 'he' ? 'אורך הדו קרב' : 'Match length';
    const title = lang === 'he' ? 'טבלת סיכויי הניצחון לפי PR' : 'PR Win-Probability Table';
    const note = lang === 'he'
        ? 'רק דו קרבות עם קוביית הכפלה (Doubling).'
        : 'Doubling-cube matches only.';
    return pmTableHtml({
        variant: 'matrix',
        caption: title,
        note,
        rowHeader: { label: gapLabel },
        colGroup: { label: lenLabel },
        cols: lens.map(l => ({ label: String(l) })),
        rows: Object.keys(rows).map(diff => ({
            header: diff,
            cells: rows[diff].map(v => ({ html: v.toFixed(1), color: colorForValue(v, minV, maxV) })),
        })),
    });
}

/**
 * The actual table match-length (e.g. 7) for a given column index, the
 * inverse of nearestMatchLengthIdx.
 */
export function matchLengthForIdx(mlIdx) {
    return PR_PROBABILITY_TABLE.matchLengths[mlIdx];
}

/**
 * Find the nearest index in matchLengths for a given match length.
 */
export function nearestMatchLengthIdx(matchLength) {
    const lens = PR_PROBABILITY_TABLE.matchLengths;
    let bestIdx = 0;
    let bestDist = Math.abs(lens[0] - matchLength);
    for (let i = 1; i < lens.length; i++) {
        const d = Math.abs(lens[i] - matchLength);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
}

/**
 * Get win probability (0-1) for playerA given both players' PRs and match length.
 * Lower PR = stronger player. Used for every league type's per-match outcome.
 * The PR difference is treated as continuous: the win % is linearly interpolated
 * between the two adjacent integer rows of the table (so a diff of 3.4 sits 40%
 * of the way from row 3 to row 4). For diffs > 10 the table is linearly
 * extrapolated from rows 9 & 10, clamped to [50, 99.9].
 */
export function getWinProbability(prA, prB, mlIdx) {
    const diff = Math.abs(prA - prB);
    const table = PR_PROBABILITY_TABLE.probabilitiesByPrDiff;

    let pctBetter; // win % for the better (lower PR) player
    if (diff <= 10) {
        const lo = Math.floor(diff);
        if (lo >= 10) {
            pctBetter = table[10][mlIdx];
        } else {
            const frac = diff - lo;
            const vLo = table[lo][mlIdx];
            const vHi = table[lo + 1][mlIdx];
            pctBetter = vLo + frac * (vHi - vLo);
        }
    } else {
        // Extrapolate linearly from rows 9 and 10 using the exact diff
        const v9 = table[9][mlIdx];
        const v10 = table[10][mlIdx];
        const slope = v10 - v9;
        pctBetter = v10 + (diff - 10) * slope;
        pctBetter = Math.min(Math.max(pctBetter, 50), 99.9);
    }

    // Lower PR = better player gets pctBetter
    if (prA <= prB) {
        return pctBetter / 100;
    } else {
        return (100 - pctBetter) / 100;
    }
}

// ── Normal CDF & PR-win probability ────────────────────────────────
// Abramowitz & Stegun rational approximation of the standard normal CDF.
const A1 = 0.254829592, A2 = -0.284496736, A3 = 1.421413741;
const A4 = -1.453152027, A5 = 1.061405429, P_COEFF = 0.3275911;

export function normalCDF(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + P_COEFF * ax);
    const y = 1 - ((((A5 * t + A4) * t + A3) * t + A2) * t + A1) * t * Math.exp(-ax * ax / 2);
    return 0.5 * (1 + sign * y);
}

const DEFAULT_PR_STD = 2.0;

// ── Gaussian sampler (Marsaglia polar) ─────────────────────────────
// Each remaining match draws both players' "PR on the night" from
// N(last300 mean, last300 std), independently and freshly per iteration.
let _gaussSpare = null;
function gaussian(mean, std) {
    if (_gaussSpare !== null) {
        const v = _gaussSpare;
        _gaussSpare = null;
        return mean + std * v;
    }
    let u, v, s;
    do {
        u = Math.random() * 2 - 1;
        v = Math.random() * 2 - 1;
        s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    _gaussSpare = v * mul;
    return mean + std * (u * mul);
}

// ── Optional inverse-CDF LUT sampler (A/B alternative to polar) ─────
// Builds a probit table once (Acklam approximation) and samples via one
// uniform draw + linear interpolation — ~2× faster than polar, at the cost
// of clipped tails. Selected per-run via simOpts.useLUT (default off).
let _lut = null;
function probitApprox(p) {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p <= ph) { q = p - 0.5; r = q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
    q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}
function gaussianLUT(mean, std) {
    if (_lut === null) {
        const K = 4096;
        const t = new Float64Array(K + 1);
        for (let i = 0; i <= K; i++) t[i] = probitApprox(Math.min(Math.max((i + 0.5) / K, 1e-7), 1 - 1e-7));
        _lut = { K, t };
    }
    const x = Math.random() * _lut.K;
    const i = x | 0;
    const f = x - i;
    return mean + std * (_lut.t[i] + f * (_lut.t[i + 1] - _lut.t[i]));
}

/**
 * Round-to-nearest-row table lookup (pre-interpolation behaviour), kept as the
 * A/B alternative selected per-run via simOpts.useInterp = false.
 */
function getWinProbabilityRound(prA, prB, mlIdx) {
    const diff = Math.abs(prA - prB);
    const r = Math.round(diff);
    const table = PR_PROBABILITY_TABLE.probabilitiesByPrDiff;
    let pctBetter;
    if (r <= 10) {
        pctBetter = table[r][mlIdx];
    } else {
        const v9 = table[9][mlIdx], v10 = table[10][mlIdx], slope = v10 - v9;
        pctBetter = Math.min(Math.max(v10 + (r - 10) * slope, 50), 99.9);
    }
    return prA <= prB ? pctBetter / 100 : (100 - pctBetter) / 100;
}

/**
 * Rank all players from best (index 0) to worst, for league types whose policy
 * needs no tiebreak-H2H tables. Primary: winRate | avgPoints | wins.
 * Secondary: meanPR | wins. Whoever is still level after both goes through the
 * SAME shared cascade — a type declaring e.g. ['tbAlphabetical'] is honoured here too,
 * so "the policy lives in one place" holds on every path, not just the fast one.
 * Returns an array of player indices in rank order.
 */
function rankAllPlayers(wins, games, points, tiebreakerPR, rankingConfig, n, tables = null) {
    const steps = rankingConfig.tiebreaks || [];
    const primary = rankingConfig.primary;
    const primaryDesc = rankingConfig.primaryDir === 'desc';
    const secondary = rankingConfig.secondary;
    const secondaryAsc = rankingConfig.secondaryDir === 'asc';

    function getPrimary(i) {
        if (primary === 'winRate') return games[i] > 0 ? wins[i] / games[i] : 0;
        if (primary === 'avgPoints') return games[i] > 0 ? points[i] / games[i] : 0;
        return wins[i];
    }
    function getSecondary(i) {
        if (secondary === 'meanPR') return tiebreakerPR[i];
        if (secondary === 'wins') return wins[i];
        return 0;
    }

    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => {
        const pa = getPrimary(a), pb = getPrimary(b);
        if (pa !== pb) return primaryDesc ? pb - pa : pa - pb;
        const sa = getSecondary(a), sb = getSecondary(b);
        return secondaryAsc ? sa - sb : sb - sa;
    });
    if (!steps.length) return indices;

    assertTablesFor(steps, tables, 'championshipPredictor.js (exact path)');
    const out = [];
    let i = 0;
    while (i < n) {
        let j = i + 1;
        const pv = getPrimary(indices[i]), sv = getSecondary(indices[i]);
        while (j < n && getPrimary(indices[j]) === pv && getSecondary(indices[j]) === sv) j++;
        if (j - i === 1) out.push(indices[i]);
        else out.push(...resolveTie(indices.slice(i, j), steps, tables));
        i = j;
    }
    return out;
}

// ── Tiebreak cascade — POLICY LIVES IN leagueTypes.js ──────────────────
// This file owns no tiebreak rule. It owns the LOOKUP: the Monte Carlo keeps
// its tables as flat typed arrays (pairWins[i*n+j], pairDiff[i*n+j],
// totalDiff[i]) because a 50 000-iteration loop cannot afford Maps of strings,
// and members are plain indices. Wrapping those in the tiebreaks.js contract
// lets the shared resolveTie() run the exact same cascade the rendered table
// runs — at typed-array speed, with zero copy of the rule.
function makeIndexTables(pairWins, pairDiff, totalDiff, names, n) {
    return {
        pairWins:  (a, b) => pairWins[a * n + b],
        pairDiff:  (a, b) => pairDiff[a * n + b],
        totalDiff: (a)    => totalDiff[a],
        name:      (a)    => names[a]
    };
}

/**
 * Rank by WinRate DESC, then hand every still-tied group to the shared cascade.
 * `steps` is the league type's ranking.tiebreaks, passed straight through.
 */
function rankRegular(wins, games, tables, steps, n) {
    const winRate = (i) => (games[i] > 0 ? wins[i] / games[i] : 0);
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => winRate(b) - winRate(a));

    const out = [];
    let i = 0;
    while (i < n) {
        let j = i + 1;
        const wr = winRate(indices[i]);
        while (j < n && winRate(indices[j]) === wr) j++;
        const group = indices.slice(i, j);
        if (group.length === 1) out.push(group[0]);
        else out.push(...resolveTie(group, steps, tables));
        i = j;
    }
    return out;
}

/**
 * Monte Carlo simulation.
 * Returns { champWins, finishRankCounts } where finishRankCounts is a
 * Float64Array of size n*n: finishRankCounts[playerIdx * n + rank] = # simulations
 * where that player finished at that rank (0 = 1st).
 */
// Benchmarks 1 000 iterations to calibrate how many fit within targetMs on this machine.
// STEP is both the rounding granularity and the floor: large leagues (where the
// 500ms budget would buy fewer than STEP iterations) pin to STEP. At 50k the
// floor run on a JUNE-sized league (~25 players, ~220 remaining) is ~0.75s with
// MoE ≈ ±0.42%, while small leagues stay time-bound above the floor.
function estimateIterations(setup, targetMs = 500) {
    const WARMUP = 1_000;
    const STEP = 50_000;
    const t0 = performance.now();
    simulateMonteCarlo(setup, WARMUP);
    const msPerIter = (performance.now() - t0) / WARMUP;
    const raw = Math.round(targetMs / msPerIter);
    return Math.max(Math.round(raw / STEP) * STEP, STEP);
}

function simulateMonteCarlo(setup, N) {
    const { n, currentWins, currentGames, currentPoints,
            remainingA, remainingB, effectivePR, effectiveSTD, mlIdx,
            rankingConfig, isUBC, usesPairTables, steps, names, winMargin,
            basePairWins, basePairDiff, baseTotalDiff,
            playedPRSum, finalGames, useLUT, useInterp } = setup;
    const X = remainingA.length;

    // Per-run sampler / table-lookup selection (A/B switches; defaults match
    // production: polar draws + interpolated table).
    const sample = useLUT ? gaussianLUT : gaussian;
    const winProb = useInterp ? getWinProbability : getWinProbabilityRound;
    const champWins = new Float64Array(n);
    const finishRankCounts = new Float64Array(n * n);

    const simWins = new Int32Array(n);
    const simGames = new Int32Array(n);
    const simPoints = new Int32Array(n);

    // Per-run Mean PR tiebreak (PR-based leagues only). prSum starts each
    // iteration at the player's real played-PR sum; drawn PRs are added as
    // remaining matches are simulated, then divided by finalGames.
    const usesMeanPR = !usesPairTables && rankingConfig.secondary === 'meanPR';
    const prSum = usesMeanPR ? new Float64Array(n) : null;
    const meanPRIter = usesMeanPR ? new Float64Array(n) : null;

    // Tiebreak-H2H bookkeeping: persistent working copies of the base
    // (played-match) tables. Each iteration applies the simulated results, ranks,
    // then undoes them — avoids re-copying the n×n matrices every iteration.
    const pairWins = usesPairTables ? Int32Array.from(basePairWins) : null;
    const pairDiff = usesPairTables ? Int32Array.from(basePairDiff) : null;
    const totalDiff = usesPairTables ? Int32Array.from(baseTotalDiff) : null;
    const touchedW = usesPairTables ? new Int32Array(X) : null;
    const touchedL = usesPairTables ? new Int32Array(X) : null;

    // Built ONCE, outside the loop: the lookup wrapper is bound to the working
    // arrays, which are mutated in place, so the same object serves all N
    // iterations at zero per-iteration cost.
    const tables = steps.length
        ? makeIndexTables(pairWins, pairDiff, totalDiff, names, n)
        : null;
    if (tables) assertTablesFor(steps, tables, 'championshipPredictor.js');

    // Hoisted outside loop — avoids per-iteration Array allocation + GC pressure
    const indices = Array.from({ length: n }, (_, i) => i);
    const primary = rankingConfig.primary;
    const primaryDesc = rankingConfig.primaryDir === 'desc';
    const secondary = rankingConfig.secondary;
    const secondaryAsc = rankingConfig.secondaryDir === 'asc';

    // This run's sort keys, materialised once per iteration into hoisted
    // buffers. The comparator used to recompute both keys on every comparison
    // (~n log n times) and the tiebreak scan would have recomputed them again;
    // filling them n times instead serves both and is cheaper than either.
    const keyP = new Float64Array(n);
    const keyS = new Float64Array(n);
    const primaryIsWinRate = primary === 'winRate';
    const primaryIsAvgPoints = primary === 'avgPoints';
    const secondaryIsMeanPR = secondary === 'meanPR';
    const secondaryIsWins = secondary === 'wins';

    for (let iter = 0; iter < N; iter++) {
        // Reset to current standings
        for (let i = 0; i < n; i++) {
            simWins[i] = currentWins[i];
            simGames[i] = currentGames[i];
            simPoints[i] = currentPoints[i];
        }
        if (usesMeanPR) {
            for (let i = 0; i < n; i++) prSum[i] = playedPRSum[i];
        }
        let tc = 0;

        // Simulate each remaining match
        for (let m = 0; m < X; m++) {
            const a = remainingA[m];
            const b = remainingB[m];
            simGames[a]++;
            simGames[b]++;

            // Draw each player's PR-on-the-night, then look up the table.
            const drawA = sample(effectivePR[a], effectiveSTD[a]);
            const drawB = sample(effectivePR[b], effectiveSTD[b]);
            const probA = winProb(drawA, drawB, mlIdx);

            // The same draws feed this run's Mean PR tiebreak.
            if (usesMeanPR) { prSum[a] += drawA; prSum[b] += drawB; }

            let winner, loser;
            if (Math.random() < probA) { winner = a; loser = b; }
            else { winner = b; loser = a; }
            simWins[winner]++;

            if (isUBC) {
                simPoints[winner] += 1; // match win point
                // PR win point — lower drawn PR earns it
                if (drawA <= drawB) simPoints[a] += 1;
                else simPoints[b] += 1;
            }

            if (usesPairTables) {
                pairWins[winner * n + loser]++;
                pairDiff[winner * n + loser] += winMargin;
                pairDiff[loser * n + winner] -= winMargin;
                totalDiff[winner] += winMargin;
                totalDiff[loser] -= winMargin;
                touchedW[tc] = winner;
                touchedL[tc] = loser;
                tc++;
            }
        }

        let order;
        if (usesPairTables) {
            order = rankRegular(simWins, simGames, tables, steps, n);
        } else {
            // Finalize this run's Mean PR from the played sum + drawn PRs.
            if (usesMeanPR) {
                for (let i = 0; i < n; i++) {
                    meanPRIter[i] = finalGames[i] > 0 ? prSum[i] / finalGames[i] : 0;
                }
            }
            // Materialise this run's sort keys, then reset indices in-place
            // (avoids Array.from allocation each iteration)
            for (let i = 0; i < n; i++) {
                keyP[i] = primaryIsWinRate ? (simGames[i] > 0 ? simWins[i] / simGames[i] : 0)
                        : primaryIsAvgPoints ? (simGames[i] > 0 ? simPoints[i] / simGames[i] : 0)
                        : simWins[i];
                keyS[i] = secondaryIsMeanPR ? meanPRIter[i] : secondaryIsWins ? simWins[i] : 0;
                indices[i] = i;
            }
            indices.sort((a, b) => {
                if (keyP[a] !== keyP[b]) return primaryDesc ? keyP[b] - keyP[a] : keyP[a] - keyP[b];
                return secondaryAsc ? keyS[a] - keyS[b] : keyS[b] - keyS[a];
            });
            order = indices;

            // A type needing no tiebreak-H2H tables still has a policy (today
            // ['tbAlphabetical']), and it is applied HERE, so "change the list in
            // leagueTypes.js and both engines follow" holds for every league
            // type — not only the one whose policy happens to need tables.
            // Players separated by the sort skip the cascade entirely; only a
            // genuinely level run pays for it.
            const resolved = [];
            let i = 0;
            while (i < n) {
                let j = i + 1;
                const pv = keyP[order[i]], sv = keyS[order[i]];
                while (j < n && keyP[order[j]] === pv && keyS[order[j]] === sv) j++;
                if (j - i === 1) resolved.push(order[i]);
                else resolved.push(...resolveTie(order.slice(i, j), steps, tables));
                i = j;
            }
            order = resolved;
        }

        champWins[order[0]]++;
        for (let r = 0; r < n; r++) finishRankCounts[order[r] * n + r]++;

        // Undo this iteration's regular-tiebreak deltas, restoring the base tables
        if (usesPairTables) {
            for (let t = 0; t < tc; t++) {
                const w = touchedW[t], l = touchedL[t];
                pairWins[w * n + l]--;
                pairDiff[w * n + l] -= winMargin;
                pairDiff[l * n + w] += winMargin;
                totalDiff[w] -= winMargin;
                totalDiff[l] += winMargin;
            }
        }
    }

    return { champWins, finishRankCounts };
}

/**
 * Main entry point: predict championship probabilities.
 *
 * @param {Object} params
 * @param {Map} params.statsMap          - Map<player, stats> from computeAllStats
 * @param {Array} params.remainingMatches - Unplayed match objects [{playerA, playerB, ...}]
 * @param {number} params.matchLength     - Target score (e.g. 7)
 * @param {Object} params.leagueConfig    - From getLeagueConfig
 * @param {Map} params.last300Map         - Map<player, {mean, std}> from batchLast300PRForSimulator
 * @param {Set} params.allPlayers         - Set of all player names
 * @param {Array} params.playedMatches    - Played match objects (with scoreA/scoreB), REGULAR tiebreak only
 * @param {Object} [params.simOpts]        - { iterationsOverride?, useLUT?, useInterp? } — A/B / fixed-N controls
 * @returns {Object} { rankings, moe, method, iterations }
 */
export function predictChampionship({ statsMap, remainingMatches, matchLength, leagueConfig, last300Map, allPlayers, playedMatches = [], simOpts = {} }) {
    // Production default: inverse-CDF LUT sampler + interpolated table lookup.
    // (polar / round remain reachable via simOpts for A/B testing.)
    const { iterationsOverride = null, useLUT = true, useInterp = true } = simOpts;
    const players = [...allPlayers].filter(p => p !== 'Bye');
    const n = players.length;
    const playerIdx = new Map();
    players.forEach((p, i) => playerIdx.set(p, i));

    const mlIdx = nearestMatchLengthIdx(matchLength);
    const isUBC = leagueConfig.type === 'ubc';
    // The tiebreak POLICY, read (never redefined) from the league type. Whether
    // the n×n tiebreak-H2H tables must be built and maintained per iteration
    // follows from the policy itself, not from a league-type name: add a
    // pair-based criterion to any type in leagueTypes.js and the Monte Carlo
    // starts carrying the tables for it, with nothing here to update.
    const steps = leagueConfig.ranking.tiebreaks || [];
    const usesPairTables = needsMatchData(steps);
    // Synthesized unplayed-match score: winner = matchLength, loser = ⌈matchLength/2⌉,
    // so the points-difference contribution of one simulated game is winMargin.
    const winMargin = matchLength - Math.ceil(matchLength / 2);

    // Build current standings arrays
    const currentWins = new Int32Array(n);
    const currentGames = new Int32Array(n);
    const currentPoints = new Int32Array(n);
    const leagueMeanPR = new Float64Array(n);
    const leaguePRStd = new Float64Array(n);

    for (let i = 0; i < n; i++) {
        const stats = statsMap.get(players[i]);
        if (stats) {
            currentWins[i] = stats.wins || 0;
            currentGames[i] = stats.games || 0;
            currentPoints[i] = stats.points || 0;
            leagueMeanPR[i] = stats.meanPR || 0;
            leaguePRStd[i] = stats.prStd || 0;
        }
    }

    // Extract mean and std from last300Map entries.
    // last300Map values are {mean, std} objects.
    function getLast300(playerName) {
        if (!last300Map.has(playerName)) return null;
        const entry = last300Map.get(playerName);
        if (entry == null) return null;
        // Backward compat: plain number → treat as mean-only
        if (typeof entry === 'number') return { mean: entry, std: DEFAULT_PR_STD };
        return entry;
    }

    // Effective PR for win-probability lookup: Last-300 PR represents the
    // player's true strength, so it drives per-match probabilities regardless
    // of current-league form.
    const effectivePR = new Float64Array(n);
    const effectiveSTD = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const entry = getLast300(players[i]);
        if (entry) {
            effectivePR[i] = entry.mean;
            effectiveSTD[i] = entry.std || DEFAULT_PR_STD;
        } else if (leagueMeanPR[i] > 0) {
            effectivePR[i] = leagueMeanPR[i];
            effectiveSTD[i] = leaguePRStd[i] || DEFAULT_PR_STD;
        } else {
            effectivePR[i] = 10.0;
            effectiveSTD[i] = DEFAULT_PR_STD;
        }
    }

    // Tiebreaker PR: weighted avg of league meanPR (played) + last300PR (for remaining)
    // Count remaining matches per player
    const remainingCount = new Int32Array(n);
    for (let m = 0; m < remainingMatches.length; m++) {
        const ai = playerIdx.get(remainingMatches[m].playerA);
        const bi = playerIdx.get(remainingMatches[m].playerB);
        if (ai !== undefined) remainingCount[ai]++;
        if (bi !== undefined) remainingCount[bi]++;
    }

    // Tiebreaker PR for the season-complete (X=0) path: with no remaining games
    // this is simply the player's real recorded league Mean PR (falls back to
    // Last-300 mean for a player who has not played at all).
    const tiebreakerPR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const entry = getLast300(players[i]);
        const last300Mean = entry ? entry.mean : effectivePR[i];
        tiebreakerPR[i] = currentGames[i] > 0 ? leagueMeanPR[i] : last300Mean;
    }

    // Per-run Mean PR tiebreak inputs (PR-based leagues). Each MC iteration draws
    // a PR for every remaining match; a player's final league Mean PR for that run
    // is (real PRs played so far + PRs drawn for this run) ÷ total games. We
    // precompute the constant played-PR sum and the final game count here.
    const playedPRSum = new Float64Array(n);
    const finalGames = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        playedPRSum[i] = leagueMeanPR[i] * currentGames[i];
        finalGames[i] = currentGames[i] + remainingCount[i];
    }

    // Build remaining matches arrays. Per-match win probability is no longer
    // precomputed — each iteration draws fresh PRs and looks up the table.
    const X = remainingMatches.length;
    const remainingA = new Int32Array(X);
    const remainingB = new Int32Array(X);
    for (let m = 0; m < X; m++) {
        const match = remainingMatches[m];
        const ai = playerIdx.get(match.playerA);
        const bi = playerIdx.get(match.playerB);
        if (ai === undefined || bi === undefined) continue;
        remainingA[m] = ai;
        remainingB[m] = bi;
    }

    // REGULAR tiebreak base tables, built once from played matches (constant
    // across simulations). pairWins/pairDiff are n×n flat arrays; totalDiff is n.
    const basePairWins = usesPairTables ? new Int32Array(n * n) : null;
    const basePairDiff = usesPairTables ? new Int32Array(n * n) : null;
    const baseTotalDiff = usesPairTables ? new Int32Array(n) : null;
    if (usesPairTables) {
        for (const match of playedMatches) {
            const ai = playerIdx.get(match.playerA);
            const bi = playerIdx.get(match.playerB);
            if (ai === undefined || bi === undefined) continue;
            const sa = match.scoreA || 0;
            const sb = match.scoreB || 0;
            const diff = sa - sb;
            basePairDiff[ai * n + bi] += diff;
            basePairDiff[bi * n + ai] -= diff;
            baseTotalDiff[ai] += diff;
            baseTotalDiff[bi] -= diff;
            if (sa > sb) basePairWins[ai * n + bi]++;
            else if (sb > sa) basePairWins[bi * n + ai]++;
        }
    }

    const setup = {
        n, currentWins, currentGames, currentPoints,
        remainingA, remainingB, effectivePR, effectiveSTD, mlIdx,
        rankingConfig: leagueConfig.ranking, isUBC, usesPairTables, steps,
        names: players, winMargin, basePairWins, basePairDiff, baseTotalDiff,
        playedPRSum, finalGames, useLUT, useInterp
    };

    // Always Monte Carlo (every league type now draws PRs per match). Iteration
    // count is auto-calibrated, independent of how many matches remain.
    let champWins;
    let finishRankCounts;
    let method;
    let iterations;

    if (X > 0) {
        iterations = iterationsOverride || estimateIterations(setup);
        method = 'montecarlo';
        ({ champWins, finishRankCounts } = simulateMonteCarlo(setup, iterations));
    } else {
        // No remaining matches — current standings are final
        iterations = 0;
        method = 'exact';
        champWins = new Float64Array(n);
        finishRankCounts = new Float64Array(n * n);
        const finalRanks = usesPairTables
            ? rankRegular(currentWins, currentGames,
                          makeIndexTables(basePairWins, basePairDiff, baseTotalDiff, players, n), steps, n)
            : rankAllPlayers(currentWins, currentGames, currentPoints, tiebreakerPR, leagueConfig.ranking, n,
                             makeIndexTables(basePairWins, basePairDiff, baseTotalDiff, players, n));
        champWins[finalRanks[0]] = 1;
        for (let r = 0; r < n; r++) finishRankCounts[finalRanks[r] * n + r] = 1;
    }

    // Normalize to percentages
    const total = method === 'montecarlo' ? iterations : champWins.reduce((s, v) => s + v, 0);
    const rankings = players.map((player, i) => {
        const stats = statsMap.get(player);
        const pct = total > 0 ? (champWins[i] / total) * 100 : 0;
        return {
            player,
            playerIdx: i,
            championshipPct: pct,
            games: stats ? stats.games : 0,
            wins: stats ? stats.wins : 0,
            losses: stats ? stats.losses : 0,
            meanPR: stats ? stats.meanPR : null,
            winRate: stats ? stats.winRate : null,
            points: stats ? (stats.points || 0) : 0,
            avgPoints: stats ? stats.avgPoints : null
        };
    });

    // Sort by championship % DESC
    rankings.sort((a, b) => b.championshipPct - a.championshipPct);

    // Compute Margin of Error for leading player (MC only)
    let moe = 0;
    if (method === 'montecarlo' && rankings.length > 0) {
        const p = rankings[0].championshipPct / 100;
        moe = 1.96 * Math.sqrt(p * (1 - p) / iterations) * 100;
    }

    return { rankings, moe, method, iterations, finishRankCounts, n, totalWeight: total };
}

/**
 * Compute the probability (0–100) of a player finishing in the top X positions.
 * @param {Float64Array} finishRankCounts  flat n×n array from predictChampionship
 * @param {number} playerIdx              the player's original index in the players array
 * @param {number} n                      total number of players
 * @param {number} totalWeight            iterations (MC) or sum of weights (exact)
 * @param {number} X                      top-X threshold (1 = championship only)
 */
export function computeTopXPct(finishRankCounts, playerIdx, n, totalWeight, X) {
    let count = 0;
    const base = playerIdx * n;
    const limit = Math.min(X, n);
    for (let r = 0; r < limit; r++) count += finishRankCounts[base + r];
    return totalWeight > 0 ? (count / totalWeight) * 100 : 0;
}
