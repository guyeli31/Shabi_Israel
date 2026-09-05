/**
 * topXTimelineWorker.js — the season-long projection, off the main thread.
 *
 * ~90 Monte Carlo projections is ~8 seconds of solid CPU. Run inline, that is a
 * frozen tab: no scrolling, no tab switching, no cancelling. Run here, the page
 * stays live and the chart fills in as the results arrive, oldest point first,
 * so the line grows in front of the user instead of appearing after a stall.
 *
 * The compute lives in topXTimeline.js, which this file only drives — the same
 * module the main thread falls back to if a Worker cannot be created. Nothing in
 * the chain touches the DOM, which is what makes both hosts possible.
 *
 * Protocol:
 *   → { type: 'run', runId, points: string[], ...projectAt inputs }
 *   ← { type: 'point', runId, index, value, topX }   one per point, in order
 *   ← { type: 'done',  runId }
 *   ← { type: 'error', runId, message }
 * A newer 'run' supersedes an older one: the loop checks runId between points
 * and abandons a superseded pass, so switching leagues mid-computation does not
 * leave two passes racing to fill one chart.
 *
 * `topX` is the full n-wide prefix-sum row per player rather than the raw n×n
 * grid: the chart only ever asks "top X", the answer for every X is one cheap
 * cumulative array, and it keeps the message small (players × n numbers instead
 * of n × n).
 */

import { projectAt } from './topXTimeline.js';
import { computeTopXPct } from './championshipPredictor.js';

let currentRunId = 0;

self.onmessage = (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'run') return;
    const runId = msg.runId;
    currentRunId = runId;

    try {
        const allPlayers = new Set(msg.allPlayers);
        // Maps do not survive structuredClone as Maps when built from entries on
        // the sender side, so last300Map crosses as entry pairs and is rebuilt.
        const last300Map = new Map(msg.last300Map);

        for (let i = 0; i < msg.points.length; i++) {
            if (currentRunId !== runId) return;   // superseded — drop this pass
            const value = msg.points[i];
            const point = projectAt({
                timeline: msg.timeline,
                allMatchesIncUnplayed: msg.allMatchesIncUnplayed,
                pointValue: value,
                allPlayers,
                matchLength: msg.matchLength,
                leagueConfig: msg.leagueConfig,
                last300Map,
                iterations: msg.iterations,
            });

            // Cumulative top-X per player: topX[player][X-1] = P(finish ≤ X).
            const topX = {};
            for (const [player, idx] of Object.entries(point.idxByPlayer)) {
                const row = new Float32Array(point.n);
                for (let x = 1; x <= point.n; x++) {
                    row[x - 1] = computeTopXPct(point.finishRankCounts, idx, point.n, point.totalWeight, x);
                }
                topX[player] = row;
            }
            self.postMessage({ type: 'point', runId, index: i, value, topX, n: point.n, remaining: point.remaining });
        }
        self.postMessage({ type: 'done', runId });
    } catch (err) {
        self.postMessage({ type: 'error', runId, message: err && err.message ? err.message : String(err) });
    }
};
