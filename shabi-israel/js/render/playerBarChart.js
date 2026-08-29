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

/**
 * Bin grid for the value-sorted (histogram) view.
 *
 * **The bin is always exactly 1 wide, and it is named by its lower edge.** Bin
 * "0" is every match played at 0.00–0.99, bin "4" is 4.00–4.99, and so on for
 * both metrics. That is the whole reason the width is fixed rather than derived
 * from the sample's spread: an axis label has to mean the same thing on every
 * player's page, and a width that shifts with the data makes "my 4s" a different
 * quantity per player. Integer edges also guarantee no bin straddles 0 — which
 * matters for Luck, where negative and positive are the whole point.
 *
 * The DOMAIN is a fixed frame, not the sample's own range, for the same
 * comparability reason:
 *
 *   PR   → 0 … 30, extended upward only if someone actually played worse.
 *   Luck → symmetric ±10, widened symmetrically if a match runs past it. A luck
 *          distribution read against an off-centre frame lies about which way it
 *          leans, so the frame is centred on 0 by construction and never
 *          self-centres on the data.
 *
 * The extension is `floor(max) + 1`, not `ceil(max)`: bins are half-open, so the
 * top value must land INSIDE the last bin rather than on its closing edge.
 *
 * @returns {{lo:number, hi:number, width:number, n:number}}
 */
const PR_MIN_MAX = 30;
const LUCK_MIN_MAG = 10;

export function computeHistogramBins(values, metric) {
    const width = 1;
    let min = 0, max = 0;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    let lo, hi;
    if (metric === 'luck') {
        const mag = Math.max(LUCK_MIN_MAG, Math.floor(Math.max(-min, max)) + 1);
        lo = -mag;
        hi = mag;
    } else {
        // PR is a non-negative rating, but the floor stays honest to the data:
        // were a negative ever to arrive, dropping it silently would be worse
        // than a slightly wider axis.
        lo = Math.min(0, Math.floor(min));
        hi = Math.max(PR_MIN_MAX, Math.floor(max) + 1);
    }
    return { lo, hi, width, n: Math.max(1, Math.round((hi - lo) / width)) };
}

/** Trim float noise off a bin edge without forcing decimals on whole numbers. */
function fmtEdge(v) {
    return String(Number(v.toFixed(2)));
}

/**
 * Value-sorted view of the same matches: a distribution of the selected metric
 * instead of a timeline of it. X = metric bins, Y = number of matches, and each
 * bar is stacked win / draw / loss in the SAME colours the chronological chart
 * uses for its bars — so the two views are one visual language, and "my losses
 * cluster in the high-PR bins" is readable at a glance.
 *
 * Matches with no value for the metric (REGULAR-league rows carry neither PR nor
 * Luck) are dropped rather than binned: a distribution has no slot for "didn't
 * happen", unlike the chronological chart where the empty slot preserves the
 * match numbering.
 */
export function drawPlayerHistogram(host, matches, metric) {
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
    let W = 900;
    const H = 320;
    const padL = 55, padR = 20, padT = 20, padB = 50;

    const valueOf = (m) => (metric === 'luck' ? m.luckSelf : m.prSelf);
    const rated = matches.filter(m => m && valueOf(m) != null);
    const values = rated.map(valueOf);
    const { lo, width, n } = computeHistogramBins(values, metric);

    const bins = Array.from({ length: n }, (_, i) => ({
        x0: lo + i * width,
        x1: lo + (i + 1) * width,
        matches: [], wins: 0, draws: 0, losses: 0,
    }));
    for (const m of rated) {
        const i = Math.min(n - 1, Math.max(0, Math.floor((valueOf(m) - lo) / width)));
        const b = bins[i];
        b.matches.push(m);
        if (m.scoreSelf === m.scoreOpp) b.draws++;
        else if (m.scoreSelf > m.scoreOpp) b.wins++;
        else b.losses++;
    }

    const total = rated.length;
    const mean = total ? values.reduce((s, v) => s + v, 0) / total : 0;
    const maxCount = Math.max(1, ...bins.map(b => b.matches.length));
    // Y is a match COUNT, so the ladder is whole numbers only; the top gridline
    // sits one step above the tallest bar's step so no bar touches the ceiling.
    const yStep = [1, 2, 5, 10, 20, 50, 100].find(iv => Math.ceil(maxCount / iv) <= 8) ?? 100;
    const yMax = Math.ceil(maxCount / yStep) * yStep;

    let hoverIndex = -1;
    let pinnedIndex = -1;

    function themeColors() {
        const cs = getComputedStyle(canvas);
        const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
        return {
            grid:         v('--chart-grid',          'rgba(0,0,0,0.18)'),
            axis:         v('--chart-axis',          'rgba(0,0,0,0.35)'),
            label:        v('--chart-label',         'rgba(0,0,0,0.6)'),
            hoverOutline: v('--chart-hover-outline', '#000'),
            win:          v('--color-win',           '#3a8f3a'),
            loss:         v('--color-loss',          '#c44'),
            draw:         v('--color-draw',          '#888'),
            accent:       v('--color-accent',        '#1c4e80'),
            fontFamily:   v('--font-main',           'sans-serif'),
        };
    }

    const geom = () => {
        const plotW = W - padL - padR;
        return { plotW, plotH: H - padT - padB, step: plotW / n };
    };
    const yPx = (plotH, c) => padT + plotH - (c / yMax) * plotH;

    function drawAll() {
        const C = themeColors();
        const dpr = window.devicePixelRatio || 1;
        const cssW = host.clientWidth || W;
        W = cssW;
        canvas.style.width = cssW + 'px';
        canvas.style.height = H + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const { plotW, plotH, step } = geom();

        // Y gridlines + tick labels
        ctx.lineWidth = 1;
        ctx.font = `12px ${C.fontFamily}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let c = 0; c <= yMax; c += yStep) {
            const y = yPx(plotH, c);
            ctx.strokeStyle = C.grid;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
            ctx.stroke();
            ctx.fillStyle = C.label;
            ctx.fillText(String(c), padL - 6, y);
        }

        // Axes
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Y-axis legend (rotated)
        ctx.save();
        ctx.translate(16, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 13px ${C.fontFamily}`;
        ctx.fillStyle = C.label;
        ctx.fillText('MATCHES', 0, 0);
        ctx.restore();

        // Stacked bars — wins at the base, draws, then losses on top.
        // Wider than the chronological chart's 0.7: bars that nearly touch read
        // as one continuous distribution, which is what a histogram is.
        const barW = Math.max(2, step * 0.92);
        const activeIdx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        const zeroY = padT + plotH;
        bins.forEach((b, i) => {
            const count = b.matches.length;
            if (!count) return;
            const x = padL + step * i + (step - barW) / 2;
            let bottom = zeroY;
            for (const [num, color] of [[b.wins, C.win], [b.draws, C.draw], [b.losses, C.loss]]) {
                if (!num) continue;
                const h = (num / yMax) * plotH;
                ctx.fillStyle = color;
                ctx.fillRect(x, bottom - h, barW, h);
                bottom -= h;
            }
            if (i === activeIdx) {
                const h = (count / yMax) * plotH;
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = i === pinnedIndex ? 2.5 : 2;
                ctx.strokeRect(x - 1, zeroY - h - 1, barW + 2, h + 2);
            }
        });

        // Mean marker — the distribution's counterpart to the chronological
        // view's moving-average line: one accent stroke saying "here is the
        // centre of all this".
        if (total > 0) {
            const mx = padL + ((mean - lo) / (n * width)) * plotW;
            if (mx >= padL && mx <= padL + plotW) {
                ctx.save();
                ctx.strokeStyle = C.accent;
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(mx, padT);
                ctx.lineTo(mx, padT + plotH);
                ctx.stroke();
                ctx.restore();
                ctx.fillStyle = C.accent;
                ctx.font = `600 11px ${C.fontFamily}`;
                ctx.textBaseline = 'top';
                // The label flips to the left of the line near the right edge so
                // it never runs off the plot.
                const near = mx > padL + plotW - 60;
                ctx.textAlign = near ? 'right' : 'left';
                ctx.fillText(`avg ${mean.toFixed(2)}`, mx + (near ? -4 : 4), padT + 2);
            }
        }

        // X-axis: one label per BIN, centred under that bin's bar and reading
        // its lower edge — the tick names the bar it sits under ("4" = the bar
        // holding 4.00–4.99), rather than the boundary between two bars, which
        // is what an edge tick would say while LOOKING like a bar label.
        //
        // Thinned by a whole-number stride to whatever the CURRENT plot width
        // can hold at ~34px a label (recomputed per draw, so a phone gets a
        // sparser axis than a desktop instead of an overlapping one), and
        // anchored on the bin containing 0 rather than on bin index 0, so a
        // stride of 2 or 5 always lands ON zero — the reference point of the
        // Luck axis must never be the one value that got thinned away.
        const maxLabels = Math.max(4, Math.floor(plotW / 34));
        const labelStride = [1, 2, 5, 10, 20].find(s => Math.ceil(n / s) <= maxLabels) ?? 20;
        const zeroBin = Math.round(-lo / width);
        ctx.font = `11px ${C.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = zeroBin % labelStride; i < n; i += labelStride) {
            if (i < 0) continue;
            const x = padL + step * i + step / 2;
            ctx.strokeStyle = C.axis;
            ctx.beginPath();
            ctx.moveTo(x, padT + plotH);
            ctx.lineTo(x, padT + plotH + 5);
            ctx.stroke();
            ctx.fillStyle = C.label;
            ctx.fillText(fmtEdge(lo + i * width), x, padT + plotH + 8);
        }

        // X-axis legend
        ctx.font = `600 13px ${C.fontFamily}`;
        ctx.fillStyle = C.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(metric.toUpperCase(), padL + plotW / 2, H - 4);
    }

    function placeholderHtml() {
        return '<span class="chart-info-placeholder">Hover or click a bar to see its matches</span>';
    }

    function binInfoHtml(idx) {
        const b = bins[idx];
        if (!b || !b.matches.length) return placeholderHtml();
        const count = b.matches.length;
        const share = total ? (count / total * 100).toFixed(1) : '0.0';
        const avg = b.matches.reduce((s, m) => s + valueOf(m), 0) / count;
        return `
            <div class="cip-row cip-title">${fmtEdge(b.x0)} &le; ${metric.toUpperCase()} &lt; ${fmtEdge(b.x1)}</div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">Matches</span><span class="cip-v">${count}</span></span>
                <span class="cip-item"><span class="cip-k">Share</span><span class="cip-v">${share}%</span></span>
                <span class="cip-item"><span class="cip-k">W-D-L</span><span class="cip-v">${b.wins}-${b.draws}-${b.losses}</span></span>
                <span class="cip-item"><span class="cip-k">Bin avg</span><span class="cip-v">${avg.toFixed(2)}</span></span>
            </div>
        `;
    }

    function updateInfoPanel() {
        const idx = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        infoPanel.innerHTML = idx >= 0 ? binInfoHtml(idx) : placeholderHtml();
    }

    function hitTest(clientX) {
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const { plotW, step } = geom();
        if (mx < padL || mx > padL + plotW) return -1;
        const i = Math.floor((mx - padL) / step);
        return (i >= 0 && i < n && bins[i].matches.length) ? i : -1;
    }

    updateInfoPanel();
    drawAll();

    const onThemeChange = () => drawAll();
    window.addEventListener('themechange', onThemeChange);

    const ro = new ResizeObserver(() => drawAll());
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
        drawAll();
    });

    canvas.addEventListener('mouseleave', () => {
        hoverIndex = -1;
        canvas.style.cursor = 'default';
        updateInfoPanel();
        drawAll();
    });

    canvas.addEventListener('click', (e) => {
        const hit = hitTest(e.clientX);
        pinnedIndex = (hit !== -1 && pinnedIndex === hit) ? -1 : hit;
        updateInfoPanel();
        drawAll();
    });
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

    /**
     * The charted metric for one match, or null when the match logs no such rate.
     * REGULAR-league matches record neither PR nor Luck — on the cross-league
     * player page they share the chart with doubling/UBC matches, so they keep
     * their slot (and their place in the match numbering) but draw no bar and
     * never enter the moving average. Treating them as 0 would drag the average
     * toward a value nobody played.
     */
    function metricValue(m) {
        if (!m) return null;
        const v = metric === 'luck' ? m.luckSelf : m.prSelf;
        return v == null ? null : v;
    }

    // Y range — default 0..20 for PR, ±5 for Luck; bumps in multiples of 5 to
    // contain any out-of-range bar. A scaleOverride (from the dashboard) keeps
    // every chart on a shared, identical Y scale.
    let minV, maxV;
    if (scaleOverride && Number.isFinite(scaleOverride.min) && Number.isFinite(scaleOverride.max)) {
        minV = scaleOverride.min;
        maxV = scaleOverride.max;
    } else {
        const values = matches.map(metricValue).filter(v => v != null);
        ({ min: minV, max: maxV } = computeNiceRange(metric, values));
    }
    const range = (maxV - minV) || 1;

    // Pre-compute the running mean over RATED slots only (independent of
    // geometry). Each point carries the slot index it sits above, so unrated
    // slots are stepped over rather than renumbering the line. With no rated
    // slots at all the array is empty and no average is drawn.
    const maPoints = [];
    {
        let sum = 0, n = 0;
        slots.forEach((m, i) => {
            const v = metricValue(m);
            if (v == null) return;
            sum += v;
            n += 1;
            maPoints.push({ slot: i, value: sum / n });
        });
    }

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

        // Resize canvas to host width (CSS px). Height fixed at H. No artificial
        // minimum — on narrow phones the host can be under 320px, and forcing a
        // floor there would overflow past the host/info-panel (iron rule 1).
        const cssW = host.clientWidth || W;
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
            const v = metricValue(m);
            if (v == null) return; // unrated match (REGULAR league) — slot stays empty
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
        if (maPoints.length > 1) {
            ctx.strokeStyle = C.accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            maPoints.forEach((p, i) => {
                const x = padL + step * p.slot + step / 2;
                const y = yPx(plotH, p.value);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            const activeMA = pinnedMA >= 0 ? pinnedMA : hoverMA;
            if (activeMA >= 0 && activeMA < maPoints.length) {
                const p = maPoints[activeMA];
                const x = padL + step * p.slot + step / 2;
                const y = yPx(plotH, p.value);
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
        // matchDate is the cross-league page's date (falls back to the league's
        // start date for pre-database leagues); single-league callers pass rows
        // that only carry updatedAt.
        const dateISO = m.matchDate ?? m.updatedAt ?? null;
        const dateStr = dateISO
            ? new Date(dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
        const p = maPoints[idx];
        if (!p) return placeholderHtml();
        return `
            <div class="cip-row cip-title">Moving average through match #${p.slot + 1}</div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">${metric.toUpperCase()} avg</span><span class="cip-v">${p.value.toFixed(2)}</span></span>
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

        // maHit indexes maPoints, not slots — unrated slots carry no MA point.
        let maHit = -1;
        if (maPoints.length > 1) {
            const pi = maPoints.findIndex(p => p.slot === idx);
            if (pi >= 0) {
                const x = padL + step * idx + step / 2;
                const y = yPx(plotH, maPoints[pi].value);
                if (Math.hypot(mx - x, my - y) < 8) maHit = pi;
            }
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
