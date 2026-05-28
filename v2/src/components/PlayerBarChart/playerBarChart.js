// components/PlayerBarChart/playerBarChart.js — Canvas bar chart for a
// player's match history. Direct port of v1 js/render/playerBarChart.js
// with two changes: (a) chart-info-panel is now the ChartTooltip
// component (cip-* classes renamed under the chart-info BEM scope),
// and (b) the host element is created here so callers can just pass a
// parent + the data and get a fully wired chart.

import { render as ChartTooltip } from "../ChartTooltip/chartTooltip.js";

/**
 * @param {object} props
 * @param {Array} props.matches            — chronological match list.
 * @param {"pr"|"luck"} props.metric
 * @param {number} props.totalMatchesPerPlayer
 * @returns {{ el: HTMLDivElement, destroy: () => void }}
 */
export function render({ matches, metric, totalMatchesPerPlayer }) {
    const host = document.createElement("div");
    host.className = "chart-host";

    const canvas = document.createElement("canvas");
    canvas.className = "chart-canvas";
    canvas.style.display = "block";
    canvas.style.touchAction = "manipulation";
    host.appendChild(canvas);

    const info = ChartTooltip({ placeholder: "Hover or click a bar to see details" });
    host.appendChild(info.el);

    const ctx = canvas.getContext("2d");
    let W = 900, H = 320;
    const padL = 55, padR = 20, padT = 20, padB = 50;
    const N = Math.max(totalMatchesPerPlayer, 1);

    const slots = new Array(N).fill(null);
    matches.slice(0, N).forEach((m, i) => (slots[i] = m));

    const values = matches.map((m) => {
        const v = metric === "luck" ? m.luckSelf : m.prSelf;
        return v == null ? 0 : v;
    });
    let minV = 0, maxV = 0;
    if (values.length) {
        minV = Math.min(0, ...values);
        maxV = Math.max(0, ...values);
        if (metric === "pr" && maxV < 5) maxV = 5;
    } else maxV = 5;
    const range = (maxV - minV) || 1;

    const playedValues = [];
    for (const m of slots) {
        if (m) playedValues.push(metric === "luck" ? (m.luckSelf ?? 0) : (m.prSelf ?? 0));
        else break;
    }
    const maCache = playedValues.map((_, i) => {
        const s = playedValues.slice(0, i + 1);
        return s.reduce((a, b) => a + b, 0) / s.length;
    });

    let hoverIndex = -1, hoverMA = -1;
    let pinnedIndex = -1, pinnedMA = -1;

    function themeColors() {
        const cs = getComputedStyle(canvas);
        const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
        return {
            grid:         v("--chart-grid",         "rgba(0,0,0,0.18)"),
            axis:         v("--chart-axis",         "rgba(0,0,0,0.35)"),
            label:        v("--chart-label",        "rgba(0,0,0,0.6)"),
            hoverOutline: v("--chart-hover-outline","#000"),
            win:          v("--color-win",          "#3a8f3a"),
            loss:         v("--color-loss",         "#c44"),
            draw:         v("--color-draw",         "#888"),
            accent:       v("--color-accent",       "#1c4e80"),
            fontFamily:   v("--font-main",          "sans-serif"),
        };
    }

    function yPx(plotH, v) {
        return padT + plotH - ((v - minV) / range) * plotH;
    }

    function drawAll() {
        const C = themeColors();
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.max(host.clientWidth || W, 320);
        W = cssW;
        canvas.style.width = cssW + "px";
        canvas.style.height = H + "px";
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const zeroY = yPx(plotH, 0);
        ctx.clearRect(0, 0, W, H);

        // Y grid
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
            ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
            ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Y labels
        ctx.fillStyle = C.label;
        ctx.font = `12px ${C.fontFamily}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let g = Math.ceil(minV / yStep) * yStep; g <= maxV; g += yStep) {
            const y = yPx(plotH, g);
            ctx.fillText(String(g), padL - 6, y);
            ctx.beginPath();
            ctx.moveTo(padL - 3, y); ctx.lineTo(padL, y);
            ctx.strokeStyle = C.axis; ctx.stroke();
        }

        // Y legend
        ctx.save();
        ctx.translate(16, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
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
            const v = metric === "luck" ? (m.luckSelf ?? 0) : (m.prSelf ?? 0);
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

        // MA line
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

        // X ticks
        const xIntervals = [1, 2, 5, 10, 20, 50, 100];
        let xStep = 1;
        for (const iv of xIntervals) {
            if (Math.ceil(N / iv) <= 15) { xStep = iv; break; }
        }
        ctx.fillStyle = C.label;
        ctx.font = `11px ${C.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let i = xStep; i <= N; i += xStep) {
            const x = padL + step * (i - 1) + step / 2;
            ctx.beginPath();
            ctx.strokeStyle = C.axis;
            ctx.moveTo(x, padT + plotH); ctx.lineTo(x, padT + plotH + 5);
            ctx.stroke();
            ctx.fillText(String(i), x, padT + plotH + 8);
        }

        ctx.font = `600 13px ${C.fontFamily}`;
        ctx.fillStyle = C.label;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("MATCH #", padL + plotW / 2, H - 4);
    }

    function updateInfo() {
        if (pinnedMA >= 0)         setMA(pinnedMA);
        else if (pinnedIndex >= 0) setMatch(pinnedIndex);
        else if (hoverMA >= 0)     setMA(hoverMA);
        else if (hoverIndex >= 0)  setMatch(hoverIndex);
        else                       info.clear();
    }

    function setMatch(idx) {
        const m = slots[idx];
        if (!m) return info.clear();
        const date = m.updatedAt
            ? new Date(m.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—";
        const pr   = m.prSelf   != null ? m.prSelf.toFixed(2)   : "—";
        const luck = m.luckSelf != null ? m.luckSelf.toFixed(2) : "—";
        info.setItems(`#${idx + 1} vs <b>${m.opponent}</b>`, [
            { k: "Score", v: `${m.scoreSelf} - ${m.scoreOpp}` },
            { k: "PR",    v: pr },
            { k: "Luck",  v: luck },
            { k: "Date",  v: date },
        ]);
    }

    function setMA(idx) {
        info.setItems(`Moving average through match #${idx + 1}`, [
            { k: `${metric.toUpperCase()} avg`, v: maCache[idx].toFixed(2) },
        ]);
    }

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

    canvas.addEventListener("mousemove", (e) => {
        const { barHit, maHit } = hitTest(e.clientX, e.clientY);
        hoverMA = maHit;
        hoverIndex = maHit === -1 ? barHit : -1;
        canvas.style.cursor = (barHit >= 0 || maHit >= 0) ? "pointer" : "default";
        updateInfo(); drawAll();
    });
    canvas.addEventListener("mouseleave", () => {
        hoverIndex = -1; hoverMA = -1;
        canvas.style.cursor = "default";
        updateInfo(); drawAll();
    });
    canvas.addEventListener("click", (e) => {
        const { barHit, maHit } = hitTest(e.clientX, e.clientY);
        if (maHit !== -1)        pinnedMA    = pinnedMA === maHit  ? -1 : (pinnedIndex = -1, maHit);
        else if (barHit !== -1)  pinnedIndex = pinnedIndex === barHit ? -1 : (pinnedMA = -1, barHit);
        else { pinnedIndex = -1; pinnedMA = -1; }
        updateInfo(); drawAll();
    });

    const onThemeChange = () => drawAll();
    window.addEventListener("themechange", onThemeChange);
    const ro = new ResizeObserver(() => drawAll());
    ro.observe(host);

    function destroy() {
        window.removeEventListener("themechange", onThemeChange);
        ro.disconnect();
    }

    // Initial paint
    updateInfo();
    drawAll();

    return { el: host, destroy };
}
