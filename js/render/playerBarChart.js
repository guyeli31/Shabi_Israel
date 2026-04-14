/**
 * playerBarChart.js — Interactive Canvas bar chart for a player's match history.
 *
 * Each bar slot = one expected match (X axis length = totalMatchesPerPlayer).
 * Played matches are placed in chronological order; remaining slots are empty.
 * Bar color: green=win, red=loss, gray=draw/technical.
 * Bar height: PR or Luck (selectable).
 * Overlay: simple moving average (window 5), stops at last played match.
 * Hover: bar highlights, tooltip with opponent / PR / Luck / date.
 *        Hover near MA line: tooltip with MA value.
 * Grid: major every 5 units, minor every 1 unit.
 *
 * Renders into a host element which receives a canvas + tooltip div.
 */

export function drawPlayerBarChart(host, matches, metric, totalMatchesPerPlayer) {
    // Build/reuse canvas + tooltip
    host.innerHTML = '';
    host.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 320;
    canvas.className = 'bar-chart-canvas';
    host.appendChild(canvas);

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.style.display = 'none';
    host.appendChild(tooltip);

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Read theme-aware colors from CSS custom properties (re-read per draw
    // so theme switches apply on next redraw).
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
        };
    }

    const padL = 55, padR = 20, padT = 20, padB = 50;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const N = Math.max(totalMatchesPerPlayer, 1);

    // Per slot: either a played match or null
    const slots = new Array(N).fill(null);
    matches.slice(0, N).forEach((m, i) => slots[i] = m);

    // Y range
    const values = matches.map(m => {
        const v = metric === 'luck' ? m.luckSelf : m.prSelf;
        return v == null ? 0 : v;
    });
    let minV = 0, maxV = 0;
    if (values.length) {
        minV = Math.min(0, ...values);
        maxV = Math.max(0, ...values);
        if (metric === 'pr' && maxV < 5) maxV = 5;
    } else {
        maxV = 5;
    }
    const range = (maxV - minV) || 1;

    function yPx(v) { return padT + plotH - ((v - minV) / range) * plotH; }
    const zeroY = yPx(0);

    function drawAll(hoverIndex = -1, hoverMA = -1) {
        const C = themeColors();
        ctx.clearRect(0, 0, W, H);

        // Y-axis adaptive grid spacing
        const yIntervals = [1, 2, 5, 10, 20, 50, 100];
        let yStep = 1;
        for (const iv of yIntervals) {
            if (Math.ceil((maxV - minV) / iv) <= 10) { yStep = iv; break; }
        }
        ctx.lineWidth = 1;
        for (let g = Math.ceil(minV / yStep) * yStep; g <= maxV; g += yStep) {
            const y = yPx(g);
            ctx.strokeStyle = C.grid;
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

        // Y-axis tick labels (same adaptive spacing as grid)
        ctx.fillStyle = C.label;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        for (let g = Math.ceil(minV / yStep) * yStep; g <= maxV; g += yStep) {
            const y = yPx(g);
            ctx.fillText(g.toString(), padL - 6, y + 4);
            // Small tick mark on axis
            ctx.beginPath();
            ctx.moveTo(padL - 3, y);
            ctx.lineTo(padL, y);
            ctx.strokeStyle = C.axis;
            ctx.stroke();
        }

        // Y-axis legend (rotated)
        ctx.save();
        ctx.translate(14, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = C.label;
        ctx.fillText(metric.toUpperCase(), 0, 0);
        ctx.restore();

        // Bars
        const step = plotW / N;
        const barW = Math.max(2, step * 0.7);
        slots.forEach((m, i) => {
            if (!m) return;
            const v = metric === 'luck' ? (m.luckSelf ?? 0) : (m.prSelf ?? 0);
            const x = padL + step * i + (step - barW) / 2;
            const y = yPx(v);
            const top = v >= 0 ? y : zeroY;
            const h = Math.abs(yPx(v) - zeroY) || 1;

            let color;
            if (m.scoreSelf === m.scoreOpp) color = C.draw;
            else if (m.scoreSelf > m.scoreOpp) color = C.win;
            else color = C.loss;

            ctx.fillStyle = color;
            ctx.fillRect(x, top, barW, h);

            if (i === hoverIndex) {
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = 2;
                ctx.strokeRect(x - 1, top - 1, barW + 2, h + 2);
            }
        });

        // Moving average — only over played slots, stops at last played
        const playedValues = [];
        for (const m of slots) {
            if (m) playedValues.push(metric === 'luck' ? (m.luckSelf ?? 0) : (m.prSelf ?? 0));
            else break;
        }
        const ma = playedValues.map((_, i) => {
            const slice = playedValues.slice(0, i + 1);
            return slice.reduce((s, v) => s + v, 0) / slice.length;
        });

        if (ma.length > 1) {
            ctx.strokeStyle = C.accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ma.forEach((v, i) => {
                const x = padL + step * i + step / 2;
                const y = yPx(v);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // MA hover marker
            if (hoverMA >= 0 && hoverMA < ma.length) {
                const x = padL + step * hoverMA + step / 2;
                const y = yPx(ma[hoverMA]);
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
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let i = xStep; i <= N; i += xStep) {
            const x = padL + step * (i - 1) + step / 2;
            // Tick line
            ctx.beginPath();
            ctx.strokeStyle = C.axis;
            ctx.moveTo(x, padT + plotH);
            ctx.lineTo(x, padT + plotH + 5);
            ctx.stroke();
            // Label
            ctx.fillText(i.toString(), x, padT + plotH + 16);
        }

        // X-axis legend
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = C.label;
        ctx.textAlign = 'center';
        ctx.fillText('MATCH #', padL + plotW / 2, H - 4);
    }

    // Pre-compute MA for hover
    function computeMA() {
        const playedVals = [];
        for (const m of slots) {
            if (m) playedVals.push(metric === 'luck' ? (m.luckSelf ?? 0) : (m.prSelf ?? 0));
            else break;
        }
        return playedVals.map((_, i) => {
            const slice = playedVals.slice(0, i + 1);
            return slice.reduce((s, v) => s + v, 0) / slice.length;
        });
    }
    const maCache = computeMA();

    drawAll();

    // Redraw on theme change so canvas colors pick up new CSS vars
    const onThemeChange = () => drawAll();
    window.addEventListener('themechange', onThemeChange);
    // Best-effort cleanup if host is removed
    const mo = new MutationObserver(() => {
        if (!document.body.contains(canvas)) {
            window.removeEventListener('themechange', onThemeChange);
            mo.disconnect();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Interaction
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;

        const step = plotW / N;
        const idx = Math.floor((mx - padL) / step);

        // Check MA proximity first
        let maHit = -1;
        if (idx >= 0 && idx < maCache.length) {
            const x = padL + step * idx + step / 2;
            const y = yPx(maCache[idx]);
            if (Math.hypot(mx - x, my - y) < 8) maHit = idx;
        }

        if (maHit !== -1) {
            drawAll(-1, maHit);
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
            tooltip.innerHTML = `<b>Moving avg #${maHit + 1}</b><br>${maCache[maHit].toFixed(2)}`;
            return;
        }

        if (idx >= 0 && idx < N && slots[idx]) {
            const m = slots[idx];
            drawAll(idx, -1);
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
            const dateStr = m.updatedAt
                ? new Date(m.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';
            tooltip.innerHTML = `<b>#${idx + 1} vs ${m.opponent}</b><br>`
                + `Score: ${m.scoreSelf} - ${m.scoreOpp}<br>`
                + `PR: ${m.prSelf != null ? m.prSelf.toFixed(2) : '—'}<br>`
                + `Luck: ${m.luckSelf != null ? m.luckSelf.toFixed(2) : '—'}<br>`
                + `Date: ${dateStr}`;
        } else {
            drawAll();
            tooltip.style.display = 'none';
        }
    });
    canvas.addEventListener('mouseleave', () => {
        drawAll();
        tooltip.style.display = 'none';
    });
}
