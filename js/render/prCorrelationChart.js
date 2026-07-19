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

// Tick spacing shared by every row's axis — picks the coarsest interval that
// still keeps at most 40 gridlines across the current domain.
function tickStep(xMin, xMax) {
    const span = xMax - xMin;
    const intervals = [1, 2, 5, 10, 20, 50];
    for (const iv of intervals) {
        if (Math.ceil(span / iv) <= 40) return iv;
    }
    return 50;
}

function xToPxAt(x, xMin, xMax, plotW, padL) {
    return padL + plotW * (x - xMin) / (xMax - xMin);
}

// One shared axis-tick renderer used by every row type (dot-strip and density
// heatmap alike) so the ruler is pixel-identical wherever it's drawn.
function drawAxisTicks(ctx, { xMin, xMax, W, padL, padR, axisTop, AXIS_H, plotW, step, C }) {
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
        const px = xToPxAt(x, xMin, xMax, plotW, padL);
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

function normalPdf(x, mean, std) {
    if (!(std > 0)) return 0;
    const z = (x - mean) / std;
    return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
}

// Overlays a fitted normal curve (scaled into the same "% of matches per
// 1-PR bin" units as the histogram bars) plus dashed reference lines at the
// mean and at +/-1 standard deviation, for the "Show Gaussian fit" toggle.
function drawGaussianOverlay(ctx, { mean, std }, { xMin, xMax, padL, plotW, plotTop, plotBottom, niceMax, C }) {
    const toY = (pct) => plotBottom - Math.min(pct, niceMax) / niceMax * (plotBottom - plotTop);

    ctx.save();
    ctx.strokeStyle = C.gaussian;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
        const x = xMin + (xMax - xMin) * i / steps;
        const px = xToPxAt(x, xMin, xMax, plotW, padL);
        const y = toY(normalPdf(x, mean, std) * 100);
        if (i === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();

    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    for (const x of [mean, mean - std, mean + std]) {
        if (x < xMin || x > xMax) continue;
        const px = xToPxAt(x, xMin, xMax, plotW, padL);
        ctx.beginPath();
        ctx.moveTo(px, plotTop - 2);
        ctx.lineTo(px, plotBottom + 2);
        ctx.stroke();
    }
    ctx.restore();
}

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
        const step = tickStep(xMin, xMax);

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
        drawAxisTicks(ctx, { xMin, xMax, W, padL, padR, axisTop: ROW_H, AXIS_H, plotW, step, C });
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
 * Histogram row — same 1-D X domain and axis geometry as drawCorrelationRow
 * (so PR-gap positions still line up vertically across the whole stack),
 * but Y now encodes each fixed-width PR-gap bin's share of all matches (%)
 * as a bar height, instead of colour intensity. Y gridlines at multiples of
 * 5%, scaled to a "nice" max just above the tallest bin; percent labels are
 * drawn INSIDE the plot (not a separate margin column) so padL/padR stay
 * identical to every other row type. buckets: [{ x0, x1, count, pct }]
 * sorted by x0 ascending (pct is 0-100, share of `opts.totalCount`).
 */
export function drawHistogramRow(host, buckets, opts) {
    host.innerHTML = '';
    host.style.position = 'relative';

    const { xMin, xMax, showAxis = false, totalCount = 0, placeholderText = 'Hover a bar to see details', gaussian = null } = opts;

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
    // plotTop leaves room for the topmost gridline's "%" label (drawn just
    // above its line, per the loop below) so it doesn't clip off the top of
    // the canvas.
    const plotTop = 16, plotBottom = ROW_H - 6;

    let W = 900;
    let hoverIndex = -1;
    let pinnedIndex = -1;
    let lastRects = [];
    // A normal curve scaled to the same "% of matches per 1-PR bin" units as
    // the bars (bin width is 1, so pdf(x) * 100 is directly comparable to a
    // bar's height) — its peak (at x = mean) is folded into the y-scale so
    // the curve never clips off the top of the plot.
    const gaussianPeakPct = gaussian ? normalPdf(gaussian.mean, gaussian.mean, gaussian.std) * 100 : 0;
    const maxPct = Math.max(0, gaussianPeakPct, ...buckets.map(b => b.pct));
    const niceMax = Math.max(5, Math.ceil(maxPct / 5) * 5);

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
            bar:          v('--density-hot', '#2563eb'),
            gaussian:     v('--color-warning', '#d97706'),
            fontFamily:   v('--font-main', 'sans-serif'),
        };
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
        const step = tickStep(xMin, xMax);

        // Y gridlines at multiples of 5%, value labelled inline (no separate
        // left-margin column, so X stays aligned with every other row type).
        ctx.font = `10px ${C.fontFamily}`;
        ctx.textAlign = 'left';
        for (let p = 0; p <= niceMax; p += 5) {
            const y = plotBottom - (p / niceMax) * (plotBottom - plotTop);
            ctx.strokeStyle = C.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(W - padR, y);
            ctx.stroke();
            if (p > 0) {
                ctx.fillStyle = C.label;
                ctx.fillText(`${p}%`, padL + 3, y - 2);
            }
        }

        lastRects = buckets.map(b => ({
            b,
            x0: xToPxAt(b.x0, xMin, xMax, plotW, padL),
            x1: xToPxAt(b.x1, xMin, xMax, plotW, padL)
        }));

        const activeIdx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        lastRects.forEach((r, i) => {
            const barH = (r.b.pct / niceMax) * (plotBottom - plotTop);
            const y = plotBottom - barH;
            ctx.fillStyle = C.bar;
            ctx.fillRect(r.x0 + 0.5, y, Math.max(0, r.x1 - r.x0 - 1), barH);
            if (i === activeIdx) {
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = i === pinnedIndex ? 2.5 : 2;
                ctx.strokeRect(r.x0 + 1, y, Math.max(1, r.x1 - r.x0 - 2), Math.max(1, barH));
            }
        });

        const zeroPx = xToPxAt(0, xMin, xMax, plotW, padL);
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(zeroPx, plotTop - 2);
        ctx.lineTo(zeroPx, plotBottom + 2);
        ctx.stroke();

        if (gaussian) drawGaussianOverlay(ctx, gaussian, { xMin, xMax, padL, plotW, plotTop, plotBottom, niceMax, C });

        if (showAxis) drawAxisTicks(ctx, { xMin, xMax, W, padL, padR, axisTop: ROW_H, AXIS_H, plotW, step, C });
    }

    function placeholderHtml() {
        return `<span class="chart-info-placeholder">${placeholderText}</span>`;
    }

    function bucketInfoHtml(b) {
        const pctOfTotal = totalCount > 0 ? (b.count / totalCount * 100) : 0;
        return `
            <div class="cip-row">
                <div class="cip-title">PR gap ${b.x0} to ${b.x1}</div>
                <span class="cip-item"><span class="cip-k">Matches</span><span class="cip-v">${b.count}</span></span>
                <span class="cip-item"><span class="cip-k">Share</span><span class="cip-v">${pctOfTotal.toFixed(1)}%</span></span>
            </div>
        `;
    }

    function updateInfoPanel() {
        const idx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        infoPanel.innerHTML = idx >= 0 ? bucketInfoHtml(buckets[idx]) : placeholderHtml();
    }

    function hitTest(clientX) {
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        return lastRects.findIndex(r => mx >= r.x0 && mx < r.x1);
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
        hoverIndex = hitTest(e.clientX);
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
        const hit = hitTest(e.clientX);
        pinnedIndex = pinnedIndex === hit ? -1 : hit;
        updateInfoPanel();
        drawRow();
    });
}

/**
 * Signed-luck score: a win always yields r >= 0 (win contributes >= 0:
 * (1-pWin)², small if expected, large if the player was an underdog); a loss
 * always yields r <= 0 (loss contributes <= 0: -(pWin)², small if the player
 * was expected to lose, large-negative if they were heavily favoured and
 * still lost), where r = outcome - pWin, kept SIGNED (r*|r|) rather than
 * squared away. Averaged over matches this gives a value in [-1, +1]: +1 =
 * maximally lucky (always an underdog, always won), -1 = maximally unlucky
 * (always favoured, always lost), 0 = results tracked the PR model exactly.
 *
 * Only meaningful for a genuine win/loss row (a player); the league-wide
 * general row is, by construction, ALWAYS "the winner's own perspective"
 * (outcome=1 for every entry), which would make this score tautologically
 * non-negative there — do not call this for the general row.
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

// Unlike a real CSS colour property, getComputedStyle() on a CUSTOM property
// (--foo) returns the value verbatim as authored — never normalised to
// rgb(...) — so every theme token here (--color-win, --color-accent, etc.,
// all declared as #rrggbb hex in variables.css/themes.css) comes back as hex,
// not rgb(). Must handle both forms, or every theme silently falls back to
// the hardcoded default and only "looks themed" by coincidence in whichever
// theme happens to match that default.
function parseRgb(str, fallback) {
    const s = (str || '').trim();
    const rgbMatch = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
    if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length <= 4) hex = hex.split('').map(c => c + c).join('');
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return fallback;
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
    { max: 0.05, text: 'Balanced' },
    { max: 0.15, text: 'Slightly {dir}' },
    { max: 0.3,  text: '{Dir}' },
    { max: 0.55, text: 'Very {dir}' },
    { max: Infinity, text: 'Extremely {dir}' },
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
