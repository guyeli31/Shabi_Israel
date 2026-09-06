/**
 * topXTimelineChart.js — one line per player: their odds of finishing in the
 * top X, at every update point of the season.
 *
 * The X axis is the league's own timeline (js/compute/matchHistory.js —
 * getUpdatePoints), so every step along it is one recorded match. That is what
 * makes the chart readable as a story rather than as a curve: a line moves
 * because a specific match was played, and the panel under the chart names it.
 *
 * Canvas, DPR-aware, theme colours read from CSS custom properties — same
 * conventions as playerBarChart.js / prCorrelationChart.js. The detail panel is
 * the shared `.chart-info-panel` with `.cip-row` / `.cip-title` / `.cip-item` /
 * `.cip-k` / `.cip-v` markup, and hover-or-click behaves as it does there:
 * hovering previews, clicking pins, clicking the pinned point releases it.
 */

import { playerIdentityHtml } from '../utils/combobox.js';

/**
 * Series colours. Deliberately a fixed list rather than the theme's semantic
 * tokens: --color-win / --color-loss / --color-warning MEAN win, loss and
 * caution, and a player's line means none of those. Chosen for separation from
 * each other and for legibility on both the light and dark grounds the site
 * ships (each is mid-luminance — none disappears into white or into near-black).
 */
export const SERIES_COLORS = [
    '#2563eb', // blue
    '#dc2626', // red
    '#059669', // green
    '#d97706', // amber
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#db2777', // pink
    '#65a30d', // olive
];

export function colorForIndex(i) {
    return SERIES_COLORS[i % SERIES_COLORS.length];
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {() => object} opts.model  reads { points, series, topX, pending }
 *        points  [{ dateLabel, dayLabel, match, label }]
 *        series  [{ player, color, identityHtml, values: (number|null)[],
 *                   record: {w,l,d} of Int16Arrays indexed like values, or null }]
 *        topX    the current Show-X, for the panel's wording
 *        pending how many points are still being computed (drawn as a note)
 * @param {(index:number) => void} [opts.onPick]  a point was pinned (index) or
 *        released (-1). Click only — hover is deliberately not reported.
 */
export function mountTopXTimelineChart(host, { model, onPick = null }) {
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
    const H = 300;
    const padL = 46, padR = 16, padT = 16, padB = 46;

    let W = 900;
    let hoverIndex = -1;
    let pinnedIndex = -1;
    let lastGeom = null;

    function themeColors() {
        const cs = getComputedStyle(canvas);
        const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
        return {
            grid: v('--chart-grid', 'rgba(0,0,0,0.18)'),
            axis: v('--chart-axis', 'rgba(0,0,0,0.35)'),
            label: v('--chart-label', 'rgba(0,0,0,0.65)'),
            hoverOutline: v('--chart-hover-outline', '#000'),
            // The canvas's own ground, used to ring a marker so it separates
            // from the line it sits on instead of merging into it.
            inset: v('--color-inset', '#fff'),
            fontFamily: v('--font-main', 'sans-serif'),
        };
    }

    /**
     * X labels: DATE ONLY, never the time — several matches share a day, and a
     * clock reading repeated across neighbouring ticks is noise on an axis whose
     * job is orientation. The step is chosen so labels never collide: the widest
     * label decides how many fit, so a narrow phone simply gets fewer of them
     * rather than an overlapping smear.
     */
    function labelStep(count, plotW, C) {
        ctx.font = `11px ${C.fontFamily}`;
        // "26 Sep" — no year. Every point on this axis belongs to one league,
        // and a league does not span a year boundary in a way the reader is in
        // doubt about; the year is the same on every tick, so printing it costs
        // width on every label and tells nobody anything. Dropping it roughly
        // halves the label, which is what buys the axis more dates.
        const widest = 44;
        const maxLabels = Math.max(2, Math.floor(plotW / widest));
        return Math.max(1, Math.ceil(count / maxLabels));
    }

    function xPx(i, count, plotW) {
        if (count <= 1) return padL + plotW / 2;
        return padL + (plotW * i) / (count - 1);
    }

    function yPx(pct, plotH) {
        return padT + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;
    }

    function draw() {
        const { points, series, pending } = model();
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

        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const count = points.length;
        lastGeom = { plotW, plotH, count };

        // Y grid + % labels every 20 points.
        ctx.font = `11px ${C.fontFamily}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let p = 0; p <= 100; p += 20) {
            const y = yPx(p, plotH);
            ctx.strokeStyle = C.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padL, Math.round(y) + 0.5);
            ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
            ctx.stroke();
            ctx.fillStyle = C.label;
            ctx.fillText(`${p}%`, padL - 8, y);
        }

        if (count === 0) return;

        // X axis line + date ticks.
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(padT + plotH) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
        ctx.stroke();

        const step = labelStep(count, plotW, C);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        let lastDrawnDay = null;
        for (let i = 0; i < count; i += step) {
            const x = xPx(i, count, plotW);
            ctx.strokeStyle = C.axis;
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, padT + plotH);
            ctx.lineTo(Math.round(x) + 0.5, padT + plotH + 4);
            ctx.stroke();
            // A repeated day adds nothing — the tick is still drawn, the text is
            // not, so a day that spans many points is labelled once.
            const day = points[i].dayLabel;
            if (day !== lastDrawnDay) {
                ctx.fillStyle = C.label;
                ctx.fillText(day, x, padT + plotH + 8);
                lastDrawnDay = day;
            }
        }

        // The highlighted point's rule, drawn under the lines.
        const active = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        if (active >= 0 && active < count) {
            const x = xPx(active, count, plotW);
            ctx.strokeStyle = C.hoverOutline;
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, padT);
            ctx.lineTo(Math.round(x) + 0.5, padT + plotH);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // One polyline per player. A gap (a point not computed yet, or a player
        // absent from that projection) breaks the line rather than interpolating
        // across it — a straight segment over missing data is a claim nobody
        // made.
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const s of series) {
            ctx.strokeStyle = s.color;
            ctx.beginPath();
            let drawing = false;
            for (let i = 0; i < count; i++) {
                const v = s.values[i];
                if (v == null) { drawing = false; continue; }
                const x = xPx(i, count, plotW);
                const y = yPx(v, plotH);
                if (drawing) ctx.lineTo(x, y);
                else { ctx.moveTo(x, y); drawing = true; }
            }
            ctx.stroke();
        }

        // A marker where THIS player played the match. Every point on the axis
        // is one match between two people, so most of a line is that player
        // waiting: their odds move because of results they had no part in. The
        // circles are the moments they were actually on the board, which is what
        // makes a line readable as a career rather than a curve — and they stay
        // sparse (about one in a dozen points) precisely because that is rare.
        for (const s of series) {
            ctx.fillStyle = s.color;
            ctx.strokeStyle = C.inset;
            ctx.lineWidth = 1.5;
            for (let i = 0; i < count; i++) {
                const v = s.values[i];
                if (v == null) continue;
                const who = points[i].players;
                if (!who || !who.includes(s.player)) continue;
                ctx.beginPath();
                ctx.arc(xPx(i, count, plotW), yPx(v, plotH), 3.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        // Dots only on the highlighted column — a dot per point per player would
        // bury the lines it is meant to annotate.
        if (active >= 0 && active < count) {
            for (const s of series) {
                const v = s.values[active];
                if (v == null) continue;
                ctx.fillStyle = s.color;
                ctx.strokeStyle = C.hoverOutline;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(xPx(active, count, plotW), yPx(v, plotH), 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        if (pending > 0) {
            ctx.fillStyle = C.label;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = `11px ${C.fontFamily}`;
            ctx.fillText(`computing… ${count - pending}/${count}`, padL + 4, padT + 2);
        }

        renderPanel();
    }

    function fmtPct(v) {
        if (v == null) return '—';
        return v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`;
    }

    /**
     * The player's record as of this point — what had already happened, beside
     * the odds for what had not. Drawn in --color-win / --color-loss, which here
     * genuinely DO mean win and loss (unlike the series colour, which means only
     * "this line"), so the two numbers separate without a legend.
     *
     * The span is emitted even when there is no record: it carries the row's
     * `margin-left:auto`, so omitting it would collapse the percentage column
     * for that one row.
     */
    function recordHtml(s, active) {
        const r = s.record;
        if (!r) return '<span class="tr-odds-rec">—</span>';
        const w = r.w[active], l = r.l[active], d = r.d[active];
        // Draws are rare (technical results only), so the D is shown only where
        // there is one rather than printing "0D" down the whole panel.
        return `<span class="tr-odds-rec">`
            + `<b class="tr-rec-w">${w}W</b> <b class="tr-rec-l">${l}L</b>`
            + (d ? ` <b class="tr-rec-d">${d}D</b>` : '')
            + `</span>`;
    }

    function renderPanel() {
        const { points, series, topX } = model();
        const active = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
        if (active < 0 || active >= points.length) {
            infoPanel.innerHTML = '<span class="chart-info-placeholder">Hover or click a point to see details</span>';
            return;
        }
        const p = points[active];
        const label = topX === 1 ? 'to win' : `top ${topX}`;
        // One player per ROW, ORDERED BY THE NUMBER. Packed onto a single line
        // they read as a run-on list — "Avi 9.1% bardak65 22% Hummus 60%" —
        // where the eye has to work out which number belongs to which name. A
        // row each makes the pairing structural; sorting makes the ranking
        // readable without comparing. Legend order stays the order they were
        // added, because that is what the colours are keyed to.
        const ordered = [...series].sort((a, b) => {
            const av = a.values[active], bv = b.values[active];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;   // not computed yet — always last
            if (bv == null) return -1;
            return bv - av;
        });
        const rows = ordered.map(s => `
            <div class="cip-row tr-odds-row">
                <span class="tr-swatch" style="background:${s.color}"></span>
                <span class="cip-k tr-odds-name">${s.identityHtml}</span>
                ${recordHtml(s, active)}
                <span class="cip-v tr-odds-val">${fmtPct(s.values[active])}</span>
            </div>`).join('');
        infoPanel.innerHTML = `
            <div class="cip-row cip-title">${p.resultHtml}</div>
            <div class="cip-row">
                <span class="cip-item"><span class="cip-k">Date</span><span class="cip-v">${p.dateLabel}</span></span>
                <span class="cip-item"><span class="cip-k">Score</span><span class="cip-v">${p.scoreLabel}</span></span>
                <span class="cip-item"><span class="cip-k">Match</span><span class="cip-v">${active + 1} / ${points.length}</span></span>
            </div>
            ${series.length ? `<div class="cip-row tr-odds-head">Odds ${label}</div>${rows}` : ''}
        `;
    }

    function indexAt(clientX) {
        if (!lastGeom || lastGeom.count === 0) return -1;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const { plotW, count } = lastGeom;
        if (count === 1) return 0;
        const i = Math.round(((x - padL) / plotW) * (count - 1));
        if (i < 0 || i > count - 1) return -1;
        return i;
    }

    canvas.addEventListener('mousemove', (e) => {
        const i = indexAt(e.clientX);
        if (i !== hoverIndex) { hoverIndex = i; draw(); }
    });
    canvas.addEventListener('mouseleave', () => {
        if (hoverIndex !== -1) { hoverIndex = -1; draw(); }
    });
    canvas.addEventListener('click', (e) => {
        const i = indexAt(e.clientX);
        pinnedIndex = (i === pinnedIndex) ? -1 : i;
        draw();
        // Reported, unlike hover: a click is a choice about WHICH moment of the
        // season to look at, and hover fires on every mousemove - hundreds of
        // events for one drag across the chart.
        if (onPick) onPick(pinnedIndex);
    });

    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => draw()).observe(host);

    /**
     * Pin a point from OUTSIDE the canvas - what the ‹ › stepper drives.
     *
     * Goes through the same `pinnedIndex` the click handler sets, so a stepped
     * point and a tapped one are the same state: the rule, the dots and the panel
     * all follow, and one can be released by tapping the other.
     *
     * -1 clears. Out-of-range is clamped rather than rejected, so a caller can
     * say "one more" without first checking the end.
     */
    function setPinned(i) {
        const count = lastGeom ? lastGeom.count : 0;
        pinnedIndex = i < 0 ? -1 : Math.min(Math.max(0, i), Math.max(0, count - 1));
        draw();
        return pinnedIndex;
    }

    /** The pinned index, or -1. The stepper reads it to know where "next" is. */
    function getPinned() {
        return pinnedIndex;
    }

    draw();
    return {
        draw, setPinned, getPinned,
        destroy: () => window.removeEventListener('resize', onResize),
    };
}

/** The identity chip used both in the legend and in the detail panel. */
export function seriesIdentityHtml({ name, flagCode, titleHtml }) {
    return playerIdentityHtml({ name, flagCode, titleHtml });
}
