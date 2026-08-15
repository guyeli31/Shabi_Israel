/**
 * luckConfidence.js — Bayesian "Luck Confidence" percentile (metric D).
 *
 * Replaces the older signed-luck score and z-score luck-percentile. For a set
 * of a player's rated matches it asks: given how strong each opponent was, how
 * confident are we that the player has been running above the model — as a
 * percentile 0–100.
 *
 * Model: a latent per-match luck shift θ (in log-odds), shared across the
 * player's matches, with a Gaussian prior θ ~ Normal(0, s²). Each match
 * multiplies the prior by contribᵢ(θ) = qᵢ(θ) on a win, 1−qᵢ(θ) on a loss,
 * where qᵢ(θ) = σ(logit(pᵢ) + θ). The posterior's mass above θ=0 is D/100.
 *
 *   D = 100 · P(θ > 0 | data)
 *
 * Because the prior keeps mass on both sides of 0, a small sample (even an
 * all-win or all-loss streak) is pulled off the 0/100 boundary instead of
 * pinning to it — the sample size is folded into the number itself, so no
 * separate "unstable" threshold is needed.
 *
 * The luck-level bands are bell-adapted: equal steps on z = Φ⁻¹(D/100), mapped
 * to |D−50|. Same five labels as the site's PR-Luck scale.
 *
 * Pure compute module — no DOM, no I/O.
 */

import { nearestMatchLengthIdx, getWinProbability } from './championshipPredictor.js';

// Calibration: prior width. Wider s => the data dominates and D can swing
// further from 50 on the same evidence; narrower s => more shrinkage toward
// "on-model". Tuned so D's spread across real players reads sensibly.
export const LUCK_PRIOR_S = 1.0;

// θ integration grid (matches the Luck Confidence Lab: [-6,6] step 0.02).
const TMIN = -6, TMAX = 6, STEP = 0.02;
const NT = Math.round((TMAX - TMIN) / STEP) + 1;

// --- Normal CDF (erf, Abramowitz-Stegun 7.1.26) + inverse CDF (Acklam) ---
function erf(x) {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
}
export const normalCDF = z => 0.5 * (1 + erf(z / Math.SQRT2));
export function probit(p) {
    p = Math.min(1 - 1e-9, Math.max(1e-9, p));
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
    const pl = 0.02425, ph = 1 - pl; let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Bell-adapted band cuts: equal-ish steps on z, expressed as |D−50| distance.
const Z_CUTS = [0.2, 0.55, 0.9, 1.5];
export const LUCK_DIST_CUTS = Z_CUTS.map(z => 100 * normalCDF(z) - 50); // ≈ [7.9, 20.9, 31.6, 43.3]

/** Band index 0..4 (Balanced → Extremely) for a given D. */
export function luckConfidenceBand(D) {
    const dist = Math.abs(D - 50);
    for (let i = 0; i < LUCK_DIST_CUTS.length; i++) if (dist <= LUCK_DIST_CUTS[i]) return i;
    return LUCK_DIST_CUTS.length;
}

/** Plain-language label for a D value, matching the site's PR-Luck vocabulary. */
export function luckConfidenceLabel(D, lang = 'en') {
    const idx = luckConfidenceBand(D);
    if (lang === 'he') {
        const dir = D >= 50 ? 'בר מזל' : 'חסר מזל';
        return ['מאוזן', dir + ' במעט', dir, dir + ' מאוד', dir + ' בקיצוניות'][idx];
    }
    const dir = D >= 50 ? 'lucky' : 'unlucky';
    const Dir = dir[0].toUpperCase() + dir.slice(1);
    return ['Balanced', 'Slightly ' + dir, Dir, 'Very ' + dir, 'Extremely ' + dir][idx];
}

/**
 * Compute Luck-Confidence stats for one player across a set of matches.
 * Drop-in compatible with luckPercentileStats: returns `.percentile` (= D),
 * `.games`, `.unstableSample` (always false — D self-regularizes) plus the
 * new `.D`, `.z`, `.band` fields.
 *
 * @param {Object} params
 * @param {Array}  params.matchRefs  [{ m, matchLength }, …]
 * @param {string} params.playerName
 * @param {number} [params.s]        prior width (defaults to LUCK_PRIOR_S)
 */
export function luckConfidenceStats({ matchRefs, playerName, s = LUCK_PRIOR_S }) {
    const logits = [];
    const outcomes = [];

    for (const { m, matchLength } of matchRefs) {
        // Technical results carry no evidence about luck: nobody was lucky or
        // unlucky in a match that wasn't decided over the board. A DRAW is one
        // of them — the score is an administrative outcome, not a result the
        // win-probability model has anything to say about. It used to fall
        // through to `scoreSelf > scoreOpp ? 1 : 0` below and get counted as a
        // LOSS, which put unearned unlucky evidence into the posterior. This
        // matches collectPlayerPrGaps (render/playerGeneralPage.js), which has
        // always dropped draws, so the Luck bar above the PR ↔ Result charts
        // and this metric now agree on which matches they are describing.
        if (m._technical || m._draw) continue;
        const isA = m.playerA === playerName;
        if (!isA && m.playerB !== playerName) continue;
        // PR of 0 is the sentinel for "missing" in this CSV format.
        if (!(m.prA > 0) || !(m.prB > 0)) continue;
        const scoreSelf = isA ? m.scoreA : m.scoreB;
        const scoreOpp = isA ? m.scoreB : m.scoreA;
        // Equal scores, drawn flag or not (0-0 included: an unplayed match).
        if (scoreSelf === scoreOpp) continue;

        const mlIdx = nearestMatchLengthIdx(matchLength || 7);
        const pA = getWinProbability(m.prA, m.prB, mlIdx);
        const pSelf = Math.min(0.99, Math.max(0.01, isA ? pA : (1 - pA)));
        logits.push(Math.log(pSelf / (1 - pSelf)));
        outcomes.push(scoreSelf > scoreOpp ? 1 : 0);
    }

    const games = logits.length;
    if (games === 0) {
        return { games: 0, percentile: null, D: null, z: null, band: null, unstableSample: true };
    }

    const D = computeD(logits, outcomes, s);
    return {
        games,
        percentile: Math.round(D),  // drop-in field for old luck-percentile consumers
        D,                          // full-precision value
        z: probit(D / 100),
        band: luckConfidenceBand(D),
        unstableSample: false,
    };
}

/**
 * Core grid integration: posterior mass above θ=0, as D∈[0,100].
 * @param {number[]} logits    per-match logit(pSelf)
 * @param {number[]} outcomes  per-match 1 (win) / 0 (loss)
 */
function computeD(logits, outcomes, s = LUCK_PRIOR_S) {
    const n = logits.length;
    if (n === 0) return 50;
    const inv2s2 = 1 / (2 * s * s);
    let total = 0, posSum = 0, zeroVal = 0;
    for (let k = 0; k < NT; k++) {
        const th = TMIN + k * STEP;
        const pr = Math.exp(-th * th * inv2s2);
        let lik = 1;
        for (let i = 0; i < n; i++) {
            const q = 1 / (1 + Math.exp(-(logits[i] + th)));
            lik *= outcomes[i] ? q : (1 - q);
        }
        const w = pr * lik;
        total += w;
        if (th > 1e-9) posSum += w;
        else if (Math.abs(th) <= 1e-9) zeroVal = w;
    }
    return total > 0 ? 100 * (posSum + 0.5 * zeroVal) / total : 50;
}

/**
 * Luck-Confidence D directly from per-match items (the shape the PR-Luck
 * correlation chart already builds). Returns D∈[0,100], or null if empty.
 * @param {Array<{pWin:number, outcome:number}>} items
 */
export function luckConfidenceFromItems(items, s = LUCK_PRIOR_S) {
    if (!items || !items.length) return null;
    const logits = items.map(it => {
        const p = Math.min(0.99, Math.max(0.01, it.pWin));
        return Math.log(p / (1 - p));
    });
    const outcomes = items.map(it => (it.outcome ? 1 : 0));
    return computeD(logits, outcomes, s);
}
