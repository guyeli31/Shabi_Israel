/**
 * prCorrelationChart.js — Interactive Canvas one-dimensional dot-strip chart
 * for PR-advantage vs match result.
 *
 * Each row is a single X axis (no Y encoding). Every dot = one match:
 *   Player row:   x = PR_opponent - PR_self   (positive = self played better)
 *                 green = win, red = loss.
 *   General row:  x = PR_loser - PR_winner    (one dot per league match, always green —
 *                 every dot is that match's winner, so there's no loss side to colour)
 *
 * All rows share the same symmetric X domain (passed in via opts.xMin/xMax) so
 * the dots line up vertically across stacked rows.
 *
 * Interaction mirrors playerBarChart.js: hover/click updates a .chart-info-panel
 * below the row using the same .cip-row/.cip-title/.cip-item/.cip-k/.cip-v markup.
 */

const DOT_RADIUS = 5;
const MIN_DIST = DOT_RADIUS * 2 + 1.5;

/**
 * Beeswarm layout: points are sorted by X and each is nudged vertically away
 * from the row's centerline until it no longer overlaps an already-placed
 * dot. X stays the true data value (only Y is adjusted for legibility), so
 * the chart is still read purely off the X axis.
 */
function computeBeeswarm(points, plotW, xToPx, midY, band) {
    const order = points.map((_, i) => i).sort((a, b) => points[a].x - points[b].x);
    const placed = [];
    const layout = new Array(points.length);
    const minY = midY - band, maxY = midY + band;

    for (const i of order) {
        const px = xToPx(points[i].x, plotW);
        let bestY = midY;
        for (let k = 0; k < 80; k++) {
            const mag = Math.ceil(k / 2) * MIN_DIST;
            const candY = k === 0 ? midY : midY + (k % 2 === 1 ? mag : -mag);
            if (candY < minY || candY > maxY) continue;
            const collides = placed.some(q => Math.hypot(px - q.px, candY - q.py) < MIN_DIST);
            if (!collides) { bestY = candY; break; }
        }
        placed.push({ px, py: bestY });
        layout[i] = { px, py: bestY };
    }
    return layout;
}

export function drawCorrelationRow(host, points, opts) {
    host.innerHTML = '';
    host.style.position = 'relative';

    const { xMin, xMax, showAxis = false, buildInfoHtml, placeholderText = 'Hover or click a match to see details' } = opts;

    const canvas = document.createElement('canvas');
    canvas.className = 'corr-row-canvas';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'manipulation';
    host.appendChild(canvas);

    const infoPanel = document.createElement('div');
    infoPanel.className = 'chart-info-panel';
    host.appendChild(infoPanel);

    const ctx = canvas.getContext('2d');
    const ROW_H = 76;
    const AXIS_H = 52;
    const H = showAxis ? ROW_H + AXIS_H : ROW_H;
    const padL = 16, padR = 16;

    let W = 900;
    let hoverIndex = -1;
    let pinnedIndex = -1;
    let lastLayout = [];

    function themeColors() {
        const cs = getComputedStyle(canvas);
        const v = (name, fallback) => {
            const val = cs.getPropertyValue(name).trim();
            return val || fallback;
        };
        return {
            grid:         v('--chart-grid',  'rgba(0,0,0,0.18)'),
            axis:         v('--chart-axis',  'rgba(0,0,0,0.35)'),
            label:        v('--chart-label', 'rgba(0,0,0,0.6)'),
            hoverOutline: v('--chart-hover-outline', '#000'),
            win:          v('--color-win',   '#3a8f3a'),
            loss:         v('--color-loss',  '#c44'),
            fontFamily:   v('--font-main', 'sans-serif'),
        };
    }

    function xToPx(x, plotW) {
        return padL + (plotW) * (x - xMin) / (xMax - xMin);
    }

    function tickStep() {
        const span = xMax - xMin;
        const intervals = [1, 2, 5, 10, 20, 50];
        for (const iv of intervals) {
            if (Math.ceil(span / iv) <= 40) return iv;
        }
        return 50;
    }

    function drawRow() {
        const C = themeColors();
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.max(host.clientWidth || W, 280);
        W = cssW;

        canvas.style.width = cssW + 'px';
        canvas.style.height = H + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const plotW = W - padL - padR;
        const midY = ROW_H / 2;
        const step = tickStep();

        // Gridlines at fixed resolution, zero line emphasised.
        ctx.lineWidth = 1;
        for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
            const px = xToPx(x, plotW);
            ctx.strokeStyle = C.grid;
            ctx.beginPath();
            ctx.moveTo(px, 3);
            ctx.lineTo(px, ROW_H - 3);
            ctx.stroke();
        }
        const zeroPx = xToPx(0, plotW);
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(zeroPx, 2);
        ctx.lineTo(zeroPx, ROW_H - 2);
        ctx.stroke();

        const band = ROW_H / 2 - DOT_RADIUS - 3;
        lastLayout = computeBeeswarm(points, plotW, xToPx, midY, band);

        const activeIdx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        points.forEach((p, i) => {
            const { px, py } = lastLayout[i];
            ctx.beginPath();
            ctx.arc(px, py, DOT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = p.win ? C.win : C.loss;
            ctx.globalAlpha = 0.85;
            ctx.fill();
            ctx.globalAlpha = 1;
            if (i === activeIdx) {
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = i === pinnedIndex ? 2.5 : 2;
                ctx.beginPath();
                ctx.arc(px, py, DOT_RADIUS + 2, 0, Math.PI * 2);
                ctx.stroke();
            }
        });

        if (showAxis) drawAxis(C, plotW, step);
    }

    // Axis drawn into the same canvas, below the dot band (offset by ROW_H) —
    // one canvas per row, no separate glued-on element.
    function drawAxis(C, plotW, step) {
        const axisTop = ROW_H;
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(padL, axisTop + 4);
        ctx.lineTo(W - padR, axisTop + 4);
        ctx.stroke();

        ctx.font = `10px ${C.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = C.label;
        const majorEvery = step * 5;
        for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
            const px = xToPx(x, plotW);
            const major = Math.abs(x % majorEvery) < 1e-9;
            ctx.strokeStyle = major ? C.axis : C.grid;
            ctx.beginPath();
            ctx.moveTo(px, axisTop + 4);
            ctx.lineTo(px, axisTop + (major ? 11 : 8));
            ctx.stroke();
            if (major) ctx.fillText(String(Math.round(x)), px, axisTop + 22);
        }
        ctx.font = `600 11px ${C.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText('← PR disadvantage        PR advantage →', W / 2, axisTop + AXIS_H - 14);
    }

    function placeholderHtml() {
        return `<span class="chart-info-placeholder">${placeholderText}</span>`;
    }

    function updateInfoPanel() {
        const idx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        infoPanel.innerHTML = idx >= 0 ? buildInfoHtml(points[idx], idx) : placeholderHtml();
    }

    function hitTest(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        let best = -1, bestDist = DOT_RADIUS + 3;
        lastLayout.forEach((pos, i) => {
            if (!pos) return;
            const d = Math.hypot(pos.px - mx, pos.py - my);
            if (d < bestDist) { bestDist = d; best = i; }
        });
        return best;
    }

    updateInfoPanel();
    drawRow();

    const onThemeChange = () => drawRow();
    window.addEventListener('themechange', onThemeChange);

    const ro = new ResizeObserver(() => drawRow());
    ro.observe(host);

    const mo = new MutationObserver(() => {
        if (!document.body.contains(canvas)) {
            window.removeEventListener('themechange', onThemeChange);
            ro.disconnect();
            mo.disconnect();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    canvas.addEventListener('mousemove', (e) => {
        hoverIndex = hitTest(e.clientX, e.clientY);
        canvas.style.cursor = hoverIndex >= 0 ? 'pointer' : 'default';
        updateInfoPanel();
        drawRow();
    });

    canvas.addEventListener('mouseleave', () => {
        hoverIndex = -1;
        canvas.style.cursor = 'default';
        updateInfoPanel();
        drawRow();
    });

    canvas.addEventListener('click', (e) => {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit !== -1) {
            pinnedIndex = pinnedIndex === hit ? -1 : hit;
        } else {
            pinnedIndex = -1;
        }
        updateInfoPanel();
        drawRow();
    });
}

/**
 * Brier score: mean squared error between the site's own PR-based win
 * probability model and the actual outcome, evaluated from the actual
 * winner's side of each match (outcome is always 1, pWin is the model's
 * probability that this winner would win). Unlike a Z-score/percentile
 * against expected wins, this needs no variance in outcome — a player row
 * (real win/loss variation) and the general row (every entry trivially a
 * "win") are equally well-defined, so it never breaks down the way a
 * correlation or Z-score does when one side of the data is degenerate.
 *   0    = the model was 100% sure the actual winner would win every time
 *          (results perfectly match PR-gap theory)
 *   0.25 = the model was on average no more sure than a coin flip
 *   1    = the model was confidently wrong every time (constant upsets)
 * items: [{ pWin, outcome }] — outcome is 1/0 for the side pWin was computed for.
 */
export function brierScore(items) {
    if (!items.length) return null;
    const sum = items.reduce((s, it) => s + (it.outcome - it.pWin) ** 2, 0);
    return sum / items.length;
}

/**
 * Signed-luck score: same per-match building block as Brier (r = outcome -
 * pWin), but kept SIGNED instead of squared away — r*|r| rather than r².
 * A win always yields r >= 0 (win contributes >= 0: (1-pWin)², small if
 * expected, large if the player was an underdog); a loss always yields r <= 0
 * (loss contributes <= 0: -(pWin)², small if the player was expected to lose,
 * large-negative if they were heavily favoured and still lost). Averaged over
 * matches this gives a value in [-1, +1]: +1 = maximally lucky (always an
 * underdog, always won), -1 = maximally unlucky (always favoured, always
 * lost), 0 = results tracked the PR model exactly.
 *
 * |signedLuckScore per-match term| === brierScore per-match term — the two
 * are the same magnitude, this one just keeps the sign. Only meaningful for
 * a genuine win/loss row (a player); the league-wide general row is, by
 * construction, ALWAYS "the winner's own perspective" (outcome=1 for every
 * entry), which would make this score tautologically non-negative there —
 * do not call this for the general row, use brierScore only.
 * items: [{ pWin, outcome }] — outcome is 1/0 for the side pWin was computed for.
 */
export function signedLuckScore(items) {
    if (!items.length) return null;
    const sum = items.reduce((s, it) => {
        const r = it.outcome - it.pWin;
        return s + r * Math.abs(r);
    }, 0);
    return sum / items.length;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// getComputedStyle always resolves colour custom properties to "rgb(r, g, b)"
// (or "rgba(r, g, b, a)"), so parsing is just pulling out the three numbers.
function parseRgb(str, fallback) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(str || '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

// Brier is bounded [0, 1]; colour interpolated --brier-good -> --brier-mid ->
// --brier-bad across that range, pivoting at the 0.25 coin-flip baseline
// (matches the visual scale shown in the "?" popup). These three tokens are
// theme-aware (see variables.css), so no colours are hardcoded here.
function brierColor(brier, el) {
    const cs = getComputedStyle(el || document.documentElement);
    const good = parseRgb(cs.getPropertyValue('--brier-good'), [58, 143, 58]);
    const mid  = parseRgb(cs.getPropertyValue('--brier-mid'),  [217, 119, 6]);
    const bad  = parseRgb(cs.getPropertyValue('--brier-bad'),  [204, 68, 68]);

    const b = Math.max(0, Math.min(1, brier));
    const [lo, hi, span] = b <= 0.25 ? [good, mid, 0.25] : [mid, bad, 0.75];
    const t = b <= 0.25 ? b / span : (b - 0.25) / span;
    const rgb = lo.map((c, i) => Math.round(lerp(c, hi[i], t)));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

const BRIER_LABELS = [
    { max: 0.05, text: 'Excellent fit' },
    { max: 0.15, text: 'Strong fit' },
    { max: 0.22, text: 'Good fit' },
    { max: 0.28, text: 'Coin-flip' },
    { max: 0.45, text: 'Weak fit' },
    { max: Infinity, text: 'Mostly upsets' },
];

/**
 * Short word label + colour for a Brier value, for display next to the
 * number. `el` should be an element inside the themed subtree (its computed
 * style is used to resolve --brier-good/mid/bad for the active theme).
 */
export function brierAssessment(brier, el) {
    if (brier == null) return { text: '', color: null };
    const band = BRIER_LABELS.find(b => brier <= b.max);
    return { text: band.text, color: brierColor(brier, el) };
}

// Signed-luck is bounded [-1, +1]; reuses the same --brier-good/mid/bad
// tokens as the Brier scale (bad = unlucky, mid = balanced, good = lucky),
// just pivoting at 0 instead of Brier's 0.25 coin-flip point.
function luckColor(score, el) {
    const cs = getComputedStyle(el || document.documentElement);
    const good = parseRgb(cs.getPropertyValue('--brier-good'), [58, 143, 58]);
    const mid  = parseRgb(cs.getPropertyValue('--brier-mid'),  [217, 119, 6]);
    const bad  = parseRgb(cs.getPropertyValue('--brier-bad'),  [204, 68, 68]);

    const s = Math.max(-1, Math.min(1, score));
    const [lo, hi, t] = s <= 0 ? [bad, mid, s + 1] : [mid, good, s];
    const rgb = lo.map((c, i) => Math.round(lerp(c, hi[i], t)));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

const LUCK_ABS_LABELS = [
    { max: 0.08, text: 'Balanced' },
    { max: 0.25, text: 'Slightly {dir}' },
    { max: 0.5,  text: '{Dir}' },
    { max: Infinity, text: 'Very {dir}' },
];

/**
 * Short word label + colour for a signed-luck value, for display next to the
 * number. `el` should be an element inside the themed subtree (its computed
 * style is used to resolve --brier-good/mid/bad for the active theme).
 */
export function luckAssessment(score, el) {
    if (score == null) return { text: '', color: null };
    const abs = Math.abs(score);
    const band = LUCK_ABS_LABELS.find(b => abs <= b.max);
    const dir = score >= 0 ? 'lucky' : 'unlucky';
    const text = band.text
        .replace('{dir}', dir)
        .replace('{Dir}', dir[0].toUpperCase() + dir.slice(1));
    return { text, color: luckColor(score, el) };
}
