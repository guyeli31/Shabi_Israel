/**
 * luckBellCurve.js — Render a static, theme-aware Normal distribution
 * bell curve for the Luck Percentile "How It Works" modal.
 *
 * Dual X-axis labels (σ and percentile) map Z-score → percentile visually:
 *   −2σ → 2nd, −1σ → 16th, 0 → 50th, +1σ → 84th, +2σ → 98th.
 *
 * Colors are applied via CSS classes (`.bc-fill-left`, `.bc-fill-right`,
 * `.bc-curve`, `.bc-axis`, `.bc-tick`, `.bc-label-sigma`, `.bc-label-pct`)
 * so the SVG inherits theme tokens from `css/index-dashboard.css`.
 */

const PLOT_LEFT = 20;
const PLOT_RIGHT = 300;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 128;

const Z_MIN = -3;
const Z_MAX = 3;
const PDF_PEAK = 1 / Math.sqrt(2 * Math.PI); // ≈ 0.3989

const TICKS = [
    { z: -2, sigma: '\u22122\u03c3', pct: '2nd' },
    { z: -1, sigma: '\u22121\u03c3', pct: '16th' },
    { z:  0, sigma: '0',              pct: '50th' },
    { z:  1, sigma: '+1\u03c3',       pct: '84th' },
    { z:  2, sigma: '+2\u03c3',       pct: '98th' }
];

function xFor(z) {
    return PLOT_LEFT + ((z - Z_MIN) / (Z_MAX - Z_MIN)) * (PLOT_RIGHT - PLOT_LEFT);
}
function yFor(pdf) {
    return PLOT_BOTTOM - (pdf / PDF_PEAK) * (PLOT_BOTTOM - PLOT_TOP);
}

function pathSegment(zStart, zEnd, nSamples = 40) {
    const pts = [];
    for (let i = 0; i <= nSamples; i++) {
        const z = zStart + (zEnd - zStart) * (i / nSamples);
        const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
        pts.push([xFor(z), yFor(pdf)]);
    }
    return pts;
}

function fillPath(zStart, zEnd) {
    const pts = pathSegment(zStart, zEnd);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const curve = pts.map((p, i) =>
        i === 0 ? `M${p[0].toFixed(2)},${p[1].toFixed(2)}`
                : `L${p[0].toFixed(2)},${p[1].toFixed(2)}`
    ).join(' ');
    return `${curve} L${last[0].toFixed(2)},${PLOT_BOTTOM} L${first[0].toFixed(2)},${PLOT_BOTTOM} Z`;
}

function strokePath() {
    const pts = pathSegment(Z_MIN, Z_MAX, 80);
    return pts.map((p, i) =>
        i === 0 ? `M${p[0].toFixed(2)},${p[1].toFixed(2)}`
                : `L${p[0].toFixed(2)},${p[1].toFixed(2)}`
    ).join(' ');
}

export function luckBellCurveSvg() {
    const leftFill = fillPath(Z_MIN, 0);
    const rightFill = fillPath(0, Z_MAX);
    const curve = strokePath();

    const ticks = TICKS.map(t => {
        const x = xFor(t.z);
        return `
            <line class="bc-tick" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${PLOT_BOTTOM}" y2="${PLOT_BOTTOM + 4}" />
            <text class="bc-label-sigma" x="${x.toFixed(2)}" y="${PLOT_BOTTOM + 16}" text-anchor="middle">${t.sigma}</text>
            <text class="bc-label-pct"   x="${x.toFixed(2)}" y="${PLOT_BOTTOM + 28}" text-anchor="middle">${t.pct}</text>
        `;
    }).join('');

    return `
        <svg class="luck-bell-curve" viewBox="0 0 320 160" role="img" aria-label="Normal distribution bell curve with sigma and percentile axis labels" xmlns="http://www.w3.org/2000/svg">
            <path class="bc-fill-left"  d="${leftFill}" />
            <path class="bc-fill-right" d="${rightFill}" />
            <path class="bc-curve"      d="${curve}" />
            <line class="bc-axis" x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${PLOT_BOTTOM}" y2="${PLOT_BOTTOM}" />
            ${ticks}
        </svg>
    `;
}
