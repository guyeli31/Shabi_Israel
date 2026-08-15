/**
 * luckContribCurve.js — Static, theme-aware SVG of a single match's
 * contribution curve contribᵢ(θ) for the Bayesian "Luck Confidence" explainer.
 *
 * For one match with model win-chance p and a known outcome, the curve shows how
 * that match re-weights the luck shift θ (log-odds):
 *
 *   qᵢ(θ) = σ(logit(p) + θ),   contribᵢ(θ) = qᵢ(θ) on a win, 1 − qᵢ(θ) on a loss.
 *
 * A win pushes weight toward θ > 0 (the player ran hot); a loss toward θ < 0.
 * The steepness/offset of the S-curve is set by logit(p): the more of a
 * favourite/underdog the player was, the further the curve slides.
 *
 * Colours use CSS custom properties with hard hex fallbacks, and axis/labels use
 * currentColor, so the same markup renders correctly in the live dashboard, the
 * landing page, and the standalone "Explanation and Maths" tool without needing
 * a shared stylesheet. Pure string builder — no DOM.
 */

import { luckConfidenceFromItems, luckConfidenceLabel, luckConfidenceBand } from '../compute/luckConfidence.js';

const W = 300, H = 176;
const L = 46, R = 288, T = 30, B = 134;   // plot rect
const TMIN = -6, TMAX = 6;

const sigmoid = z => 1 / (1 + Math.exp(-z));
const xFor = th => L + ((th - TMIN) / (TMAX - TMIN)) * (R - L);
const yFor = c => B - c * (B - T);          // contrib 0..1 → bottom..top

/**
 * @param {Object} o
 * @param {number} o.p        model win-chance for the player, 0..1
 * @param {'win'|'loss'} o.outcome
 * @param {string} [o.title]  caption drawn above the plot
 */
export function luckContribCurveSvg({ p, outcome, title = '' }) {
    const isWin = outcome === 'win';
    const logit = Math.log(p / (1 - p));
    const contrib = th => {
        const q = sigmoid(logit + th);
        return isWin ? q : 1 - q;
    };

    // Sampled curve.
    const N = 90;
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const th = TMIN + (TMAX - TMIN) * (i / N);
        pts.push([xFor(th), yFor(contrib(th))]);
    }
    const curve = pts.map((pt, i) =>
        (i === 0 ? 'M' : 'L') + pt[0].toFixed(2) + ',' + pt[1].toFixed(2)
    ).join(' ');
    const fill = curve + ` L${xFor(TMAX).toFixed(2)},${B} L${xFor(TMIN).toFixed(2)},${B} Z`;

    const col = isWin
        ? 'var(--color-win, #2e9e5b)'
        : 'var(--color-loss, #d64545)';

    // Horizontal contrib gridlines + labels.
    const hGrid = [0, 0.5, 1].map(c => {
        const y = yFor(c).toFixed(2);
        return `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity="0.14"/>`
             + `<text x="${L - 6}" y="${(+y + 3).toFixed(2)}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.7">${c.toFixed(1)}</text>`;
    }).join('');

    // θ ticks.
    const xTicks = [-4, -2, 0, 2, 4].map(th => {
        const x = xFor(th).toFixed(2);
        return `<line x1="${x}" x2="${x}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.5"/>`
             + `<text x="${x}" y="${B + 15}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${th}</text>`;
    }).join('');

    // θ = 0 reference (the "no luck" line).
    const x0 = xFor(0).toFixed(2);
    const zeroLine = `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 3"/>`
        + `<text x="${x0}" y="${T - 4}" text-anchor="middle" font-size="8.5" fill="currentColor" fill-opacity="0.6">θ=0 (no luck)</text>`;

    const caption = title
        ? `<text x="${W / 2}" y="14" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">${title}</text>`
        : '';

    return `
        <svg class="luck-contrib-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title || 'match contribution curve'}" xmlns="http://www.w3.org/2000/svg" style="max-width:340px;width:100%;height:auto;color:inherit;direction:ltr">
            ${caption}
            ${hGrid}
            ${zeroLine}
            <path d="${fill}" fill="${col}" fill-opacity="0.13"/>
            <path d="${curve}" fill="none" stroke="${col}" stroke-width="2"/>
            <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            <line x1="${L}" x2="${L}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            ${xTicks}
            <text x="${(L + R) / 2}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">θ — luck shift (log-odds)</text>
            <text x="12" y="${(T + B) / 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85" transform="rotate(-90 12 ${((T + B) / 2).toFixed(1)})">contribᵢ(θ) — probability weight (0–1)</text>
        </svg>
    `;
}

// --- Shared plot helpers for the prior / posterior figures ---------------
const P_TMIN = -6, P_TMAX = 6;
const priorDensity = (th, s) => Math.exp(-th * th / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

/**
 * The Gaussian prior on the luck shift θ, drawn for three widths s so the
 * effect of the calibration constant is visible: s = 1 (the default) is a solid
 * line, the other two are dashed, and a legend maps each colour to its s.
 * Narrower s ⇒ taller, tighter bell (more shrinkage toward "on-model");
 * wider s ⇒ flatter (the data is trusted to move θ further).
 */
export function luckPriorCurveSvg() {
    const W = 320, H = 178, L = 46, R = 306, T = 16, B = 132;
    const YMAX = 0.85;   // covers the s=0.5 peak ≈ 0.798
    const xFor = th => L + ((th - P_TMIN) / (P_TMAX - P_TMIN)) * (R - L);
    const yFor = d => B - (d / YMAX) * (B - T);

    const series = [
        { s: 0.5, color: '#a855f7', dash: '5 3' },
        { s: 1.0, color: 'currentColor', dash: null },
        { s: 2.0, color: '#14b8a6', dash: '5 3' },
    ];
    const curves = series.map(se => {
        const N = 120;
        let d = '';
        for (let i = 0; i <= N; i++) {
            const th = P_TMIN + (P_TMAX - P_TMIN) * (i / N);
            d += (i ? 'L' : 'M') + xFor(th).toFixed(2) + ',' + yFor(priorDensity(th, se.s)).toFixed(2) + ' ';
        }
        const w = se.dash ? 1.6 : 2.4;
        const dash = se.dash ? ` stroke-dasharray="${se.dash}"` : '';
        return `<path d="${d.trim()}" fill="none" stroke="${se.color}" stroke-width="${w}"${dash}/>`;
    }).join('');

    const yTicks = [0, 0.4, 0.8].map(v => {
        const y = yFor(v).toFixed(2);
        return `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity="0.12"/>`
             + `<text x="${L - 6}" y="${(+y + 3).toFixed(2)}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.7">${v.toFixed(1)}</text>`;
    }).join('');
    const xTicks = [-4, -2, 0, 2, 4].map(th => {
        const x = xFor(th).toFixed(2);
        return `<line x1="${x}" x2="${x}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.5"/>`
             + `<text x="${x}" y="${B + 15}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${th}</text>`;
    }).join('');

    const legend = series.map((se, i) => {
        const ly = T + 8 + i * 14, lx = R - 96;
        const w = se.dash ? 1.6 : 2.4;
        const dash = se.dash ? ` stroke-dasharray="${se.dash}"` : '';
        const label = `s = ${se.s}${se.s === 1 ? ' (default)' : ''}`;
        return `<line x1="${lx}" x2="${lx + 20}" y1="${ly}" y2="${ly}" stroke="${se.color}" stroke-width="${w}"${dash}/>`
             + `<text x="${lx + 25}" y="${ly + 3}" font-size="9" fill="currentColor" fill-opacity="0.9">${label}</text>`;
    }).join('');

    return `
        <svg class="luck-prior-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gaussian prior on the luck shift for three widths s" xmlns="http://www.w3.org/2000/svg" style="max-width:360px;width:100%;height:auto;color:inherit;direction:ltr">
            ${yTicks}
            ${curves}
            ${legend}
            <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            <line x1="${L}" x2="${L}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            ${xTicks}
            <text x="${(L + R) / 2}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">θ — luck shift (log-odds units)</text>
            <text x="12" y="${(T + B) / 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85" transform="rotate(-90 12 ${((T + B) / 2).toFixed(1)})">prior density</text>
        </svg>
    `;
}

/**
 * The posterior over θ for a small worked record, with the area to the right of
 * θ=0 (lucky) and to the left (unlucky) shaded, plus the normalised prior drawn
 * faintly behind it. D is the right-hand share of the area, printed on the plot.
 *
 * @param {Object} o
 * @param {{p:number, outcome:'win'|'loss'}[]} o.items  the worked matches
 * @param {number} [o.s=1]     prior width
 * @param {string} [o.title]   caption above the plot
 * @param {string} [o.subtitle] second caption line (e.g. the record in words)
 */
export function luckPosteriorDSvg({ items, s = 1, title = '', subtitle = '' }) {
    const W = 320, H = 190, L = 46, R = 306, T = 34, B = 140;
    const xFor = th => L + ((th - P_TMIN) / (P_TMAX - P_TMIN)) * (R - L);

    const logits = items.map(it => {
        const p = Math.min(0.99, Math.max(0.01, it.p));
        return { logit: Math.log(p / (1 - p)), win: it.outcome === 'win' };
    });
    const post = th => {
        let v = priorDensity(th, s);
        for (const m of logits) {
            const q = sigmoid(m.logit + th);
            v *= m.win ? q : (1 - q);
        }
        return v;
    };

    // Dense sampling → curve points, area split at θ=0, and D.
    const N = 240;
    const pts = [];
    let peak = 0, areaTot = 0, areaR = 0;
    for (let i = 0; i <= N; i++) {
        const th = P_TMIN + (P_TMAX - P_TMIN) * (i / N);
        const v = post(th);
        pts.push({ th, v });
        if (v > peak) peak = v;
    }
    const dth = (P_TMAX - P_TMIN) / N;
    for (let i = 0; i <= N; i++) {
        const w = (i === 0 || i === N) ? 0.5 : 1;           // trapezoid weights
        areaTot += w * pts[i].v * dth;
        if (pts[i].th > 1e-9) areaR += w * pts[i].v * dth;
        else if (Math.abs(pts[i].th) <= 1e-9) areaR += 0.5 * w * pts[i].v * dth;
    }
    const D = areaTot > 0 ? 100 * areaR / areaTot : 50;

    // Y scale: prior peak (= priorDensity(0,s)) sits at ~0.82 height; the
    // posterior shares that scale so its smaller area is honestly visible.
    const priorPeak = priorDensity(0, s);
    const yRef = Math.max(peak, priorPeak);
    const yFor = v => B - (v / (yRef * 1.12)) * (B - T);

    const curvePath = pts.map((pt, i) => (i ? 'L' : 'M') + xFor(pt.th).toFixed(2) + ',' + yFor(pt.v).toFixed(2)).join(' ');

    // Left / right area fills, split exactly at θ=0.
    function sideFill(pred) {
        const seg = pts.filter(pt => pred(pt.th));
        if (!seg.length) return '';
        // Ensure the segment reaches θ=0 for a clean split.
        let d = 'M' + xFor(seg[0].th).toFixed(2) + ',' + B;
        for (const pt of seg) d += ' L' + xFor(pt.th).toFixed(2) + ',' + yFor(pt.v).toFixed(2);
        d += ' L' + xFor(seg[seg.length - 1].th).toFixed(2) + ',' + B + ' Z';
        return d;
    }
    const leftFill = sideFill(th => th <= 1e-9);
    const rightFill = sideFill(th => th >= -1e-9);

    // Faint normalised prior behind everything.
    let priorPath = '';
    for (let i = 0; i <= 120; i++) {
        const th = P_TMIN + (P_TMAX - P_TMIN) * (i / 120);
        priorPath += (i ? 'L' : 'M') + xFor(th).toFixed(2) + ',' + yFor(priorDensity(th, s)).toFixed(2) + ' ';
    }

    const win = 'var(--color-win, #2e9e5b)', loss = 'var(--color-loss, #d64545)';
    const x0 = xFor(0).toFixed(2);
    const xTicks = [-4, -2, 0, 2, 4].map(th => {
        const x = xFor(th).toFixed(2);
        return `<line x1="${x}" x2="${x}" y1="${B}" y2="${B + 4}" stroke="currentColor" stroke-opacity="0.5"/>`
             + `<text x="${x}" y="${B + 15}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.7">${th}</text>`;
    }).join('');

    const cap = title
        ? `<text x="${W / 2}" y="13" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">${title}</text>` : '';
    const sub = subtitle
        ? `<text x="${W / 2}" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.8">${subtitle}</text>` : '';

    // D read-out — a small pill in the upper corner on the SAME side the
    // posterior mass leans to (lucky → right, unlucky → left), coloured toward
    // that side. The peak is central, so the far tail there is empty and the
    // pill never sits on the curve or the shaded area.
    const dCol = D >= 50 ? win : loss;
    const pillW = 56, pillH = 18, pillY = T + 4;
    const pillX = (D >= 50) ? (R - 5 - pillW) : (L + 5);   // lucky → right, unlucky → left
    const dPill = `
            <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="5"
                  fill="currentColor" fill-opacity="0.05" stroke="${dCol}" stroke-opacity="0.55"/>
            <text x="${(pillX + pillW / 2).toFixed(1)}" y="${pillY + 13}" text-anchor="middle" font-size="12" font-weight="700" fill="${dCol}">D = ${D.toFixed(0)}</text>`;

    return `
        <svg class="luck-posterior-d" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title || 'posterior with D area split'}" xmlns="http://www.w3.org/2000/svg" style="max-width:360px;width:100%;height:auto;color:inherit;direction:ltr">
            ${cap}${sub}
            <path d="${leftFill}" fill="${loss}" fill-opacity="0.16"/>
            <path d="${rightFill}" fill="${win}" fill-opacity="0.16"/>
            <path d="${priorPath.trim()}" fill="none" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.3" stroke-dasharray="4 3"/>
            <path d="${curvePath}" fill="none" stroke="currentColor" stroke-width="2"/>
            <line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.5" stroke-dasharray="3 3"/>
            ${dPill}
            <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            <line x1="${L}" x2="${L}" y1="${T}" y2="${B}" stroke="currentColor" stroke-opacity="0.55"/>
            ${xTicks}
            <text x="${(L + R) / 2}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">θ — luck shift (log-odds units)</text>
            <text x="12" y="${(T + B) / 2}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85" transform="rotate(-90 12 ${((T + B) / 2).toFixed(1)})">posterior weight (unnormalised)</text>
        </svg>
    `;
}

// A worked example of one player's PR-difference row (2 dots) plus the Luck
// metric exactly as the dashboard shows it, so the reader has a live reference.
let _exGradN = 0;

/**
 * @param {Object} o
 * @param {{adv:number, pWin:number, win:boolean}[]} o.dots  one entry per match:
 *        adv = PR advantage (opponent PR − own; the x position), pWin = the
 *        model win-chance from that match, win = did the player win.
 * @param {'he'|'en'} [o.lang]
 */
export function luckExampleRowSvg({ dots }) {
    // Text is always English — this reproduces the dashboard's own scatter row +
    // Luck pill, and the live components render in English regardless of the
    // popup's language. The Luck pill sits ABOVE the row, as on the dashboard.
    const items = dots.map(d => ({ pWin: d.pWin, outcome: d.win ? 1 : 0 }));
    const D = Math.round(luckConfidenceFromItems(items));
    const band = luckConfidenceBand(D);
    const label = luckConfidenceLabel(D, 'en');

    const win = 'var(--color-win, #2e9e5b)', loss = 'var(--color-loss, #d64545)';
    const midCol = 'var(--brier-mid, #d97706)';
    const pillCol = band === 0 ? midCol : (D >= 50 ? win : loss);

    const Wp = 340, Hp = 126;
    const Lp = 30, Rp = 312, XMIN = -6, XMAX = 6;
    const xa = a => Lp + ((a - XMIN) / (XMAX - XMIN)) * (Rp - Lp);

    // --- Luck pill (top) — the dashboard component, drawn in SVG so it needs no shared CSS ---
    const gid = 'luckExGrad' + (++_exGradN);
    const barL = 76, barR = 250, barY = 16, barH = 9;
    const markX = barL + (Math.max(0, Math.min(100, D)) / 100) * (barR - barL);

    // --- Scatter row (below) ---
    const gTop = 40, gBot = 84, rowY = 62;
    const grid = [-4, -2, 2, 4].map(a => `<line x1="${xa(a).toFixed(1)}" x2="${xa(a).toFixed(1)}" y1="${gTop}" y2="${gBot}" stroke="currentColor" stroke-opacity="0.12"/>`).join('');
    const x0 = xa(0).toFixed(1);
    const zero = `<line x1="${x0}" x2="${x0}" y1="${gTop - 2}" y2="${gBot + 2}" stroke="currentColor" stroke-opacity="0.4"/>`;
    const ticks = [-4, -2, 0, 2, 4].map(a => `<text x="${xa(a).toFixed(1)}" y="${gBot + 14}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.65">${a > 0 ? '+' + a : a}</text>`).join('');
    const dotsSvg = dots.map(d => `<circle cx="${xa(d.adv).toFixed(1)}" cy="${rowY}" r="6" fill="${d.win ? win : loss}" fill-opacity="0.85"/>`).join('');

    return `
      <svg class="luck-example-row" viewBox="0 0 ${Wp} ${Hp}" role="img" aria-label="example luck row" xmlns="http://www.w3.org/2000/svg" style="max-width:380px;width:100%;height:auto;color:inherit;direction:ltr">
        <defs><linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="${loss}"/><stop offset="0.5" stop-color="${midCol}"/><stop offset="1" stop-color="${win}"/>
        </linearGradient></defs>
        <text x="${Lp}" y="${barY + barH}" font-size="10" font-weight="600" fill="currentColor">Luck</text>
        <rect x="${barL}" y="${barY}" width="${barR - barL}" height="${barH}" rx="${barH / 2}" fill="url(#${gid})"/>
        <line x1="${markX.toFixed(1)}" x2="${markX.toFixed(1)}" y1="${barY - 3}" y2="${barY + barH + 3}" stroke="currentColor" stroke-width="2"/>
        <text x="${markX.toFixed(1)}" y="${barY - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${D}</text>
        <text x="${barR + 8}" y="${barY + barH}" font-size="10.5" font-weight="600" fill="${pillCol}">${label}</text>
        ${grid}${zero}
        <line x1="${Lp}" x2="${Rp}" y1="${gBot}" y2="${gBot}" stroke="currentColor" stroke-opacity="0.5"/>
        ${dotsSvg}
        ${ticks}
        <text x="${(Lp + Rp) / 2}" y="${Hp - 5}" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity="0.85">PR advantage</text>
      </svg>`;
}
