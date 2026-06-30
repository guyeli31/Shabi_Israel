/**
 * playerBarChart.js — Interactive Canvas bar chart for a player's match history.
 *
 * Each bar slot = one expected match (X axis length = totalMatchesPerPlayer).
 * Played matches are placed in chronological order; remaining slots are empty.
 * Bar color: green=win, red=loss, gray=draw/technical.
 * Bar height: PR or Luck (selectable).
 * Overlay: simple moving average (window grows from 1), stops at last played match.
 *
 * Interaction:
 *   Hover over a bar → info panel below the chart updates (does not overlay chart).
 *   Click a bar → pins that bar; further hovers ignored until click again to release.
 *   Hover near MA marker → info panel shows MA value.
 *
 * Crisp rendering:
 *   Canvas is sized to host width in CSS pixels and scaled by devicePixelRatio.
 *   ResizeObserver redraws on host width change. Fonts pulled from --font-main.
 */

/**
 * Nice Y range for the player charts.
 *   PR:   0 .. max(20, ceil(maxValue/5)*5)   — default 0..20, bumps in steps of 5.
 *   Luck: ±max(5, ceil(maxAbs/5)*5)          — default ±5, symmetric, steps of 5.
 * Passing the same range to several charts keeps them on one shared Y scale.
 */
import { displayPlayerName } from '../utils/nameDisplay.js';

export function computeNiceRange(metric, values) {
    if (metric === 'luck') {
        let maxAbs = 0;
        for (const v of values) maxAbs = Math.max(maxAbs, Math.abs(v));
        const mag = Math.max(5, Math.ceil(maxAbs / 5) * 5);
        return { min: -mag, max: mag };
    }
    let maxV = 0;
    for (const v of values) maxV = Math.max(maxV, v);
    const max = Math.max(20, Math.ceil(maxV / 5) * 5);
    return { min: 0, max };
}

export function drawPlayerBarChart(host, matches, metric, totalMatchesPerPlayer, scaleOverride) {
    host.innerHTML = '';
    host.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.className = 'bar-chart-canvas';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'manipulation';
    host.appendChild(canvas);

    const infoPanel = document.createElement('div');
    infoPanel.className = 'chart-info-panel';
    host.appendChild(infoPanel);

    const ctx = canvas.getContext('2d');

    // Logical (CSS px) dimensions — set per draw.
    let W = 900, H = 320;

    function themeColors() {
        const cs = getComputedStyle(canvas);
        const v = (name, fallback) => {
            const val = cs.getPropertyValue(name).trim();
            return val || fallback;
        };
        return {
            grid:         v('--chart-grid',         'rgba(0,0,0,0.18)'),
            axis:         v('--chart-axis',         'rgba(0,0,0,0.35)'),
            label:        v('--chart-label',        'rgba(0,0,0,0.6)'),
            hoverOutline: v('--chart-hover-outline','#000'),
            win:          v('--color-win',          '#3a8f3a'),
            loss:         v('--color-loss',         '#c44'),
            draw:         v('--color-draw',         '#888'),
            accent:       v('--color-accent',       '#1c4e80'),
            fontFamily:   v('--font-main',          'sans-serif'),
        };
    }

    const padL = 55, padR = 20, padT = 20, padB = 50;
    const N = Math.max(totalMatchesPerPlayer, 1);

    // Per slot: either a played match or null
    const slots = new Array(N).fill(null);
    matches.slice(0, N).forEach((m, i) => slots[i] = m);

    // Y range — default 0..20 for PR, ±5 for Luck; bumps in multiples of 5 to
    // contain any out-of-range bar. A scaleOverride (from the dashboard) keeps
    // every chart on a shared, identical Y scale.
    let minV, maxV;
    if (scaleOverride && Number.isFinite(scaleOverride.min) && Number.isFinite(scaleOverride.max)) {
        minV = scaleOverride.min;
        maxV = scaleOverride.max;
    } else {
        const values = matches
            .map(m => (metric === 'luck' ? m.luckSelf : m.prSelf))
            .filter(v => v != null);
        ({ min: minV, max: maxV } = computeNiceRange(metric, values));
    }
    const range = (maxV - minV) || 1;

    // Pre-compute MA over played slots (independent of geometry).
    const playedValues = [];
    for (const m of slots) {
        if (m) playedValues.push(metric === 'luck' ? (m.luckSelf ?? 0) : (m.prSelf ?? 0));
        else break;
    }
    const maCache = playedValues.map((_, i) => {
        const slice = playedValues.slice(0, i + 1);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
    });

    // Interaction state
    let hoverIndex = -1;
    let hoverMA = -1;
    let pinnedIndex = -1;
    let pinnedMA = -1;

    function yPx(plotH, v) {
        return padT + plotH - ((v - minV) / range) * plotH;
    }

    function drawAll() {
        const C = themeColors();
        const dpr = window.devicePixelRatio || 1;

        // Resize canvas to host width (CSS px). Height fixed at H.
        const cssW = Math.max(host.clientWidth || W, 320);
        W = cssW;
        canvas.style.width = cssW + 'px';
        canvas.style.height = H + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const zeroY = yPx(plotH, 0);

        ctx.clearRect(0, 0, W, H);

        // Adaptive Y grid spacing
        const yIntervals = [1, 2, 5, 10, 20, 50, 100];
        let yStep = 1;
        for (const iv of yIntervals) {
            if (Math.ceil((maxV - minV) / iv) <= 10) { yStep = iv; break; }
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.grid;
        for (let g = Math.ceil(minV / yStep) * yStep; g <= maxV; g += yStep) {
            const y = yPx(plotH, g);
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
            ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Y-axis tick labels
        ctx.fillStyle = C.label;
        ctx.font = `12px ${C.fontFamily}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let g = Math.ceil(minV / yStep) * yStep; g <= maxV; g += yStep) {
            const y = yPx(plotH, g);
            ctx.fillText(g.toString(), padL - 6, y);
            ctx.beginPath();
            ctx.moveTo(padL - 3, y);
            ctx.lineTo(padL, y);
            ctx.strokeStyle = C.axis;
            ctx.stroke();
        }

        // Y-axis legend (rotated)
        ctx.save();
        ctx.translate(16, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 13px ${C.fontFamily}`;
        ctx.fillStyle = C.label;
        ctx.fillText(metric.toUpperCase(), 0, 0);
        ctx.restore();

        // Bars
        const step = plotW / N;
        const barW = Math.max(2, step * 0.7);
        const activeIdx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        slots.forEach((m, i) => {
            if (!m) return;
            const v = metric === 'luck' ? (m.luckSelf ?? 0) : (m.prSelf ?? 0);
            const x = padL + step * i + (step - barW) / 2;
            const y = yPx(plotH, v);
            const top = v >= 0 ? y : zeroY;
            const h = Math.abs(yPx(plotH, v) - zeroY) || 1;

            let color;
            if (m.scoreSelf === m.scoreOpp) color = C.draw;
            else if (m.scoreSelf > m.scoreOpp) color = C.win;
            else color = C.loss;

            ctx.fillStyle = color;
            ctx.fillRect(x, top, barW, h);

            if (i === activeIdx) {
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = i === pinnedIndex ? 2.5 : 2;
                ctx.strokeRect(x - 1, top - 1, barW + 2, h + 2);
            }
        });

        // Moving average line
        if (maCache.length > 1) {
            ctx.strokeStyle = C.accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            maCache.forEach((v, i) => {
                const x = padL + step * i + step / 2;
                const y = yPx(plotH, v);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            const activeMA = pinnedMA >= 0 ? pinnedMA : hoverMA;
            if (activeMA >= 0 && activeMA < maCache.length) {
                const x = padL + step * activeMA + step / 2;
                const y = yPx(plotH, maCache[activeMA]);
                ctx.fillStyle = C.accent;
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // X-axis tick marks with adaptive spacing
        const xIntervals = [1, 2, 5, 10, 20, 50, 100];
        let xStep = 1;
        for (const iv of xIntervals) {
            if (Math.ceil(N / iv) <= 15) { xStep = iv; break; }
        }
        ctx.fillStyle = C.label;
        ctx.font = `11px ${C.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = xStep; i <= N; i += xStep) {
            const x = padL + step * (i - 1) + step / 2;
            ctx.beginPath();
            ctx.strokeStyle = C.axis;
            ctx.moveTo(x, padT + plotH);
            ctx.lineTo(x, padT + plotH + 5);
            ctx.stroke();
            ctx.fillText(i.toString(), x, padT + plotH + 8);
        }

        // X-axis legend
        ctx.font = `600 13px ${C.fontFamily}`;
        ctx.fillStyle = C.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('MATCH #', padL + plotW / 2, H - 4);
    }

    function placeholderHtml() {
        return '<span class="chart-info-placeholder">Hover or click a match to see details</span>';
    }

    function matchInfoHtml(idx) {
        const m = slots[idx];
        if (!m) return placeholderHtml();
        const dateStr = m.updatedAt
            ? new Date(m.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : '—';
        const prStr   = m.prSelf   != null ? m.prSelf.toFixed(2)   : '—';
        const luckStr = m.luckSelf != null ? m.luckSelf.toFixed(2) : '—';
        return `
            <div class="cip-row cip-title">#${idx + 1} vs <b>${displayPlayerName(m.opponent)}</b></div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">Score</span><span class="cip-v">${m.scoreSelf} - ${m.scoreOpp}</span></span>
                <span class="cip-item"><span class="cip-k">PR</span><span class="cip-v">${prStr}</span></span>
                <span class="cip-item"><span class="cip-k">Luck</span><span class="cip-v">${luckStr}</span></span>
                <span class="cip-item"><span class="cip-k">Date</span><span class="cip-v">${dateStr}</span></span>
            </div>
        `;
    }

    function maInfoHtml(idx) {
        return `
            <div class="cip-row cip-title">Moving average through match #${idx + 1}</div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">${metric.toUpperCase()} avg</span><span class="cip-v">${maCache[idx].toFixed(2)}</span></span>
            </div>
        `;
    }

    function updateInfoPanel() {
        if (pinnedMA >= 0)        infoPanel.innerHTML = maInfoHtml(pinnedMA);
        else if (pinnedIndex >= 0) infoPanel.innerHTML = matchInfoHtml(pinnedIndex);
        else if (hoverMA >= 0)    infoPanel.innerHTML = maInfoHtml(hoverMA);
        else if (hoverIndex >= 0) infoPanel.innerHTML = matchInfoHtml(hoverIndex);
        else                      infoPanel.innerHTML = placeholderHtml();
    }

    updateInfoPanel();
    drawAll();

    // Redraw on theme change
    const onThemeChange = () => drawAll();
    window.addEventListener('themechange', onThemeChange);

    // Redraw on host resize
    const ro = new ResizeObserver(() => drawAll());
    ro.observe(host);

    // Cleanup when host is detached
    const mo = new MutationObserver(() => {
        if (!document.body.contains(canvas)) {
            window.removeEventListener('themechange', onThemeChange);
            ro.disconnect();
            mo.disconnect();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // ---- Hit testing helpers ----
    function hitTest(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const step = plotW / N;
        const idx = Math.floor((mx - padL) / step);

        let maHit = -1;
        if (idx >= 0 && idx < maCache.length) {
            const x = padL + step * idx + step / 2;
            const y = yPx(plotH, maCache[idx]);
            if (Math.hypot(mx - x, my - y) < 8) maHit = idx;
        }
        const barHit = (idx >= 0 && idx < N && slots[idx]) ? idx : -1;
        return { barHit, maHit };
    }

    // ---- Mouse interactions ----
    canvas.addEventListener('mousemove', (e) => {
        const { barHit, maHit } = hitTest(e.clientX, e.clientY);
        hoverMA = maHit;
        hoverIndex = maHit === -1 ? barHit : -1;
        canvas.style.cursor = (barHit >= 0 || maHit >= 0) ? 'pointer' : 'default';
        updateInfoPanel();
        drawAll();
    });

    canvas.addEventListener('mouseleave', () => {
        hoverIndex = -1;
        hoverMA = -1;
        canvas.style.cursor = 'default';
        updateInfoPanel();
        drawAll();
    });

    canvas.addEventListener('click', (e) => {
        const { barHit, maHit } = hitTest(e.clientX, e.clientY);
        if (maHit !== -1) {
            // Toggle MA pin
            if (pinnedMA === maHit) { pinnedMA = -1; }
            else { pinnedMA = maHit; pinnedIndex = -1; }
        } else if (barHit !== -1) {
            if (pinnedIndex === barHit) { pinnedIndex = -1; }
            else { pinnedIndex = barHit; pinnedMA = -1; }
        } else {
            // Click on empty area releases pin
            pinnedIndex = -1;
            pinnedMA = -1;
        }
        updateInfoPanel();
        drawAll();
    });
}
