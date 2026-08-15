/**
 * luckPill.js — the "Luck" metric pill that sits above a PR-difference /
 * result chart: caption on the left, the -1..+1 gradient bar in the middle
 * (marker + value), the plain-language verdict on the right.
 *
 * Extracted from dashboardPage.js so the league page's PR ↔ Result rows and
 * the player page's Total PR ↔ Result rows render the SAME component from one
 * source. The 27/46/27 column split, the ellipsis rules and the gradient all
 * live in css/dashboard.css (.corr-metric-pill and friends) — a copy of this
 * markup in a second file is how those two drift apart.
 */

import { luckConfidenceLabel, luckConfidenceBand } from '../compute/luckConfidence.js';

// Keeps a marker's/value's horizontal position a few points shy of the bar's
// own edges, so the value text (centred on that position) never overflows
// past the bar into the caption or label column at the extremes (0 or 1).
export function clampPct(pct) {
    return Math.max(8, Math.min(92, pct));
}

// Luck Confidence D (percentile 0–100): only meaningful for a player row (real
// win/loss variation) — never call this for the general row, which is all wins
// by construction.
export function applyLuckPill(pillEl, D) {
    if (D == null) {
        pillEl.innerHTML = `<span class="brier-caption">Luck</span><span class="luck-mini-scale"><span class="luck-mini-track"></span></span><span class="brier-label">&mdash;</span>`;
        pillEl.title = 'No rated matches yet.';
        return;
    }
    const label = luckConfidenceLabel(D);
    const band = luckConfidenceBand(D);
    const cs = getComputedStyle(pillEl);
    const good = cs.getPropertyValue('--brier-good').trim() || '#3a8f3a';
    const mid  = cs.getPropertyValue('--brier-mid').trim()  || '#d97706';
    const bad  = cs.getPropertyValue('--brier-bad').trim()  || '#cc4444';
    const color = band === 0 ? mid : (D >= 50 ? good : bad);
    const markerPct = Math.max(0, Math.min(100, D));
    const valuePct = clampPct(markerPct);
    pillEl.innerHTML = `
        <span class="brier-caption">Luck</span>
        <span class="luck-mini-scale">
            <span class="luck-mini-track"></span>
            <span class="brier-mini-marker" style="left:${markerPct}%"></span>
            <b class="brier-mini-value" style="left:${valuePct}%">${Math.round(D)}</b>
        </span>
        <span class="brier-label" style="color:${color}">${label}</span>
    `;
    pillEl.title = 'Luck Confidence (percentile): 100 = strong evidence of good luck, 0 = strong evidence of bad luck, 50 = on-model. Small samples stay near 50.';
}
