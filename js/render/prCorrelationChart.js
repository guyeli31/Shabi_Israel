/**
 * prCorrelationChart.js — Interactive Canvas one-dimensional dot-strip chart
 * for PR-advantage vs match result.
 *
 * Each row is a single X axis (no Y encoding). Every dot = one match:
 *   Player row:   x = PR_opponent - PR_self   (positive = self played better)
 *                 green = win, red = loss.
 *   General row:  x = PR_loser - PR_winner    (one dot per league match, uncoloured)
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

    let axisCanvas = null;
    if (showAxis) {
        axisCanvas = document.createElement('canvas');
        axisCanvas.className = 'corr-axis-canvas';
        axisCanvas.style.display = 'block';
        host.appendChild(axisCanvas);
    }

    const infoPanel = document.createElement('div');
    infoPanel.className = 'chart-info-panel';
    host.appendChild(infoPanel);

    const ctx = canvas.getContext('2d');
    const ROW_H = 76;
    const AXIS_H = 34;
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
            general:      v('--color-text-muted', '#888'),
            fontFamily:   v('--font-main', 'sans-serif'),
        };
    }

    function xToPx(x, plotW) {
        return padL + (plotW) * (x - xMin) / (xMax - xMin);
    }

    function pxToX(px, plotW) {
        return xMin + (px - padL) / plotW * (xMax - xMin);
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
        canvas.style.height = ROW_H + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(ROW_H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, ROW_H);

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
            ctx.fillStyle = p.win === undefined ? C.general : (p.win ? C.win : C.loss);
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

        if (axisCanvas) drawAxis(C, plotW, step);
    }

    function drawAxis(C, plotW, step) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = W;
        axisCanvas.style.width = cssW + 'px';
        axisCanvas.style.height = AXIS_H + 'px';
        axisCanvas.width = Math.round(cssW * dpr);
        axisCanvas.height = Math.round(AXIS_H * dpr);
        const actx = axisCanvas.getContext('2d');
        actx.setTransform(dpr, 0, 0, dpr, 0, 0);
        actx.clearRect(0, 0, cssW, AXIS_H);

        actx.strokeStyle = C.axis;
        actx.beginPath();
        actx.moveTo(padL, 4);
        actx.lineTo(cssW - padR, 4);
        actx.stroke();

        actx.font = `10px ${C.fontFamily}`;
        actx.textAlign = 'center';
        actx.fillStyle = C.label;
        const majorEvery = step * 5;
        for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
            const px = xToPx(x, plotW);
            const major = Math.abs(x % majorEvery) < 1e-9;
            actx.strokeStyle = major ? C.axis : C.grid;
            actx.beginPath();
            actx.moveTo(px, 4);
            actx.lineTo(px, major ? 11 : 8);
            actx.stroke();
            if (major) actx.fillText(String(Math.round(x)), px, 22);
        }
        actx.font = `600 11px ${C.fontFamily}`;
        actx.textAlign = 'center';
        actx.fillText('← PR disadvantage        PR advantage →', cssW / 2, AXIS_H - 2);
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
 * probability model and the actual outcome. Unlike a correlation, this
 * stays well-defined even when a player has zero variance in outcome (an
 * undefeated or winless record) — it doesn't need two classes, just a
 * predicted probability and an outcome for each match.
 *   0    = the model's predictions were perfect
 *   0.25 = the model did no better than a constant 50/50 guess
 *   1    = the model was maximally wrong every time
 * items: [{ pWin, outcome }] — outcome is 1/0 for the side pWin was computed for.
 */
export function brierScore(items) {
    if (!items.length) return null;
    const sum = items.reduce((s, it) => s + (it.outcome - it.pWin) ** 2, 0);
    return sum / items.length;
}
