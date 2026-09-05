/**
 * topXTimeline.js — "what were everyone's odds, at every point in the season?"
 *
 * Replays the league one update point at a time and, at each of them, runs the
 * championship projection over the matches that were still unplayed then. The
 * result is one finish-rank distribution per point, which is what turns a single
 * projection into a TREND: the same question the Predictor answers for today,
 * asked again for every match that has ever been recorded.
 *
 * Pure (no DOM, no fetch, no Supabase) for one specific reason: it runs inside a
 * Web Worker. See topXTimelineWorker.js — the whole league is ~90 projections,
 * and on the main thread that is a minute-long freeze.
 *
 * ── Why finishRankCounts and not a percentage ───────────────────────────────
 * One run produces the FULL n×n distribution "player i finished in place r".
 * Every "top X" question is a prefix sum over it (computeTopXPct), so the Show
 * control switches between top-1, top-3 and top-10 with no recomputation at all.
 * Storing a single percentage would have forced a rerun per X — 90 more
 * projections for a dropdown change.
 *
 * ── Iterations ─────────────────────────────────────────────────────────────
 * The Predictor's own default is 50 000 iterations, ~1.1 s per point: 98 s for
 * this league. Measured against that baseline on July 2026 (25 players, 89
 * points), the trade is:
 *
 *     50 000 → 1106 ms/point   (98 s)   baseline
 *     10 000 →  195 ms/point (17.4 s)   within 1.11%
 *      5 000 →   90 ms/point  (8.0 s)   within 0.93%   ← DEFAULT
 *      2 000 →   35 ms/point  (3.1 s)   within 1.53%
 *      1 000 →   18 ms/point  (1.6 s)   within 2.83%
 *
 * 5 000 keeps every plotted value within about one percentage point of the full
 * run — invisible in the shape of a line — for a twelfth of the cost. The
 * headline Predictor table keeps its 50 000: a number read to one decimal beside
 * a margin of error is a different promise from a point on a trend line.
 */

import { predictChampionship, computeTopXPct } from './championshipPredictor.js';
import { computeAllStats } from './stats.js';
import { getMatchesAsOf, matchKey } from './matchHistory.js';

export const TIMELINE_ITERATIONS = 5_000;

/**
 * The state of the league as of one update point: what had been played, and
 * what was still to come. Mirrors the What-If baseline rule exactly — every
 * scheduled fixture not yet played at that moment counts as remaining,
 * regardless of whether it has since been played — so the chart and the
 * simulator answer from the same past.
 */
export function baselineAt(timeline, allMatchesIncUnplayed, pointValue) {
    const played = getMatchesAsOf(timeline, pointValue);
    const playedKeys = new Set(played.map(m => matchKey(m.playerA, m.playerB)));
    const remaining = allMatchesIncUnplayed
        .filter(m => !playedKeys.has(matchKey(m.playerA, m.playerB)))
        .map(m => ({ ...m, played: false, scoreA: null, scoreB: null, prA: null, prB: null, luckA: null, luckB: null }));
    return { played, remaining };
}

/**
 * One point's projection.
 * @returns {{ finishRankCounts: Float64Array, n: number, totalWeight: number,
 *             players: string[], remaining: number }}
 */
export function projectAt({ timeline, allMatchesIncUnplayed, pointValue, allPlayers,
                            matchLength, leagueConfig, last300Map, iterations = TIMELINE_ITERATIONS }) {
    const { played, remaining } = baselineAt(timeline, allMatchesIncUnplayed, pointValue);
    const statsMap = computeAllStats(played, allPlayers);
    const result = predictChampionship({
        statsMap,
        remainingMatches: remaining,
        matchLength,
        leagueConfig,
        last300Map,
        allPlayers,
        playedMatches: played,
        simOpts: { iterationsOverride: iterations },
    });
    // `rankings` carries each player's index into the finishRankCounts grid;
    // the caller needs that mapping to read a specific player's odds later.
    const idxByPlayer = {};
    for (const r of result.rankings) idxByPlayer[r.player] = r.playerIdx;
    return {
        finishRankCounts: result.finishRankCounts,
        n: result.n,
        totalWeight: result.totalWeight,
        idxByPlayer,
        remaining: remaining.length,
    };
}

/** A player's top-X probability (0–100) from a stored point projection. */
export function topXAt(point, player, X) {
    if (!point) return null;
    const idx = point.idxByPlayer[player];
    if (idx == null) return null;
    return computeTopXPct(point.finishRankCounts, idx, point.n, point.totalWeight, X);
}

/* ── The fingerprint ────────────────────────────────────────────────────────
 *
 * A stored projection is valid only while the data it was computed from is
 * unchanged. Rather than have the writer set a flag — which someone forgets, or
 * a failed job leaves lying — each point carries a hash of ITS OWN inputs, and
 * the reader recomputes it from data it already holds. Staleness becomes a
 * property of the data, checkable without trusting anyone's bookkeeping.
 *
 * These functions therefore MUST produce byte-identical output in Node and in
 * the browser, which is why they live in this shared, pure module and use no
 * platform APIs (no crypto, no TextEncoder) — only string arithmetic.
 */

/** FNV-1a, 32-bit, hex. Not cryptographic: this detects change, not tampering. */
function fnv1a(str, seed = 0x811c9dc5) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** The one canonical text for a played match: pairing (order-free) + result. */
function canonMatch(m) {
    const [a, b] = [m.playerA, m.playerB].sort();
    const flip = a !== m.playerA;
    const sa = flip ? m.scoreB : m.scoreA;
    const sb = flip ? m.scoreA : m.scoreB;
    return `${a}${b}${sa}${sb}`;
}

/**
 * The schedule's contribution. It is an input at EVERY point — the projection
 * runs over the fixtures still unplayed — so adding or removing a fixture
 * invalidates the whole league, and the hash has to say so.
 */
export function scheduleFingerprint(allMatchesIncUnplayed) {
    const keys = (allMatchesIncUnplayed || [])
        .map(m => matchKey(m.playerA, m.playerB))
        .sort();
    return fnv1a(keys.join('')).toString(16);
}

/**
 * One hash per point, in timeline order, folded forward: a point's inputs are
 * every match played up to and including it, so hash(i) = mix(hash(i-1), match i).
 * O(n) for the whole league, and — the property that matters — a change to match
 * 30 changes every hash from 30 onward and none before it.
 *
 * @param {object[]} orderedTimeline  oldest → newest (getUpdatePoints reversed)
 * @param {string}   scheduleFp       from scheduleFingerprint()
 * @returns {string[]} hex hashes, index-aligned with orderedTimeline
 */
export function pointFingerprints(orderedTimeline, scheduleFp) {
    const out = [];
    let acc = fnv1a(scheduleFp);
    for (const m of orderedTimeline) {
        acc = fnv1a(canonMatch(m), acc);
        out.push(acc.toString(16));
    }
    return out;
}

/**
 * Build a whole league's stored projection — the exact shape written to
 * `public.league_projections`.
 *
 * Runs in Node (the sync job) and in the browser (the fallback), which is the
 * point of keeping it here: one implementation, so the stored numbers and the
 * locally-computed ones cannot be produced by two subtly different codes.
 *
 * `roster` is APPEND-ONLY across calls: a previous roster is passed in and kept
 * as a prefix, with new players appended. Position i must mean the same player
 * for the life of the league, or every stored point silently re-points to the
 * wrong people.
 *
 * @param {object}   args
 * @param {object[]} args.orderedPoints  getUpdatePoints() reversed (oldest first)
 * @param {object[]} args.timeline
 * @param {object[]} args.allMatchesIncUnplayed
 * @param {Set}      args.allPlayers
 * @param {string[]} [args.previousRoster]
 * @param {number}   [args.depth]        places stored per player (default 10)
 * @param {function} [args.onPoint]      (index, total) — progress, for logging
 * @returns {{roster:string[], points:object[], iterations:number}}
 */
export function buildLeagueProjection({
    orderedPoints, timeline, allMatchesIncUnplayed, allPlayers,
    matchLength, leagueConfig, last300Map,
    previousRoster = [], depth = 10, iterations = 50_000, onPoint = null,
}) {
    const roster = [...previousRoster];
    const seen = new Set(roster);
    for (const p of [...allPlayers].filter(p => p !== 'Bye').sort()) {
        if (!seen.has(p)) { roster.push(p); seen.add(p); }
    }

    const scheduleFp = scheduleFingerprint(allMatchesIncUnplayed);
    const hashes = pointFingerprints(orderedPoints.map(p => p.match), scheduleFp);

    const points = orderedPoints.map((p, i) => {
        const proj = projectAt({
            timeline, allMatchesIncUnplayed, pointValue: p.value, allPlayers,
            matchLength, leagueConfig, last300Map, iterations,
        });
        // Cumulative top-X per roster position, ×1000 and rounded: the chart
        // renders one decimal, so three significant digits is the whole of what
        // is knowable here — and integers are what compress.
        const r = roster.map((player) => {
            const idx = proj.idxByPlayer[player];
            if (idx == null) return [];
            const row = new Array(Math.min(depth, proj.n));
            for (let x = 1; x <= row.length; x++) {
                row[x - 1] = Math.round(computeTopXPct(proj.finishRankCounts, idx, proj.n, proj.totalWeight, x) * 10);
            }
            return row;
        });
        if (onPoint) onPoint(i + 1, orderedPoints.length);
        return { at: p.match.updatedAt, ord: pointOrdinal(p.value), hash: hashes[i], r };
    });

    return { roster, points, iterations };
}

/** The `#n` suffix of a point value, or 1 when the instant holds one match. */
function pointOrdinal(value) {
    const hash = String(value).lastIndexOf('#');
    if (hash === -1) return 1;
    const n = Number(String(value).slice(hash + 1));
    return Number.isInteger(n) && n >= 1 ? n : 1;
}
