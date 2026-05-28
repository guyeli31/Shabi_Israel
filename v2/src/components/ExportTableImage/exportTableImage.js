// components/ExportTableImage/exportTableImage.js — render a table (or
// any HTML node) to a PNG download. Replaces v1's three near-duplicate
// exporters (leaguePage:exportLeagueTableImage + dashboardPage:export
// RemainingMatchesImage / exportB6bImage / exportB6cImage) with one
// reusable function.
//
// html2canvas is loaded on demand via dynamic ESM import to keep the
// production bundle slim — pages that never export pay nothing.

let _html2canvasPromise = null;
function loadHtml2Canvas() {
    if (!_html2canvasPromise) {
        _html2canvasPromise = import("html2canvas").then((m) => m.default ?? m);
    }
    return _html2canvasPromise;
}

const CREDIT_TEXT = "Built by Guy Eliyahu  ·  v2";

function parseRgb(str) {
    const m = String(str).match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
}
function mixRgb(a, b, t) {
    return [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
}

function appendCredit(wrap, text = CREDIT_TEXT) {
    const credit = document.createElement("div");
    const bg = parseRgb(getComputedStyle(wrap).backgroundColor) || [255, 255, 255];
    const fg = parseRgb(getComputedStyle(wrap).color) || [0, 0, 0];
    const mixed = mixRgb(bg, fg, 0.06);
    credit.style.cssText =
        "margin-top:18px;padding-top:8px;text-align:center;" +
        "font-size:8px;font-weight:300;letter-spacing:0.12em;" +
        `color:rgb(${mixed.join(",")});user-select:none;`;
    credit.textContent = text;
    wrap.appendChild(credit);
}

/**
 * Export a table (or arbitrary HTML node) as a PNG download.
 *
 * @param {object} props
 * @param {HTMLElement} props.source           — node to capture (often a <table>).
 * @param {string} props.filename              — base filename (without extension).
 * @param {string} [props.title]               — heading prepended to the capture.
 * @param {string} [props.subtitle]            — secondary line under the heading.
 * @param {boolean} [props.includeCredit=true]
 * @param {number} [props.scale=2]             — html2canvas pixel ratio.
 * @returns {Promise<void>}
 */
export async function exportToImage({
    source,
    filename,
    title,
    subtitle,
    includeCredit = true,
    scale = 2,
}) {
    if (!source) throw new Error("exportToImage: source element required");
    const html2canvas = await loadHtml2Canvas();

    const bodyStyle = getComputedStyle(document.body);
    const wrap = document.createElement("div");
    wrap.style.cssText =
        `position:fixed;left:-10000px;top:0;padding:24px;` +
        `background:${bodyStyle.backgroundColor};color:${bodyStyle.color};` +
        `font-family:${bodyStyle.fontFamily};box-sizing:border-box;direction:ltr;`;

    if (title) {
        const h = document.createElement("h3");
        h.style.cssText = "margin:0 0 4px 0;font-size:20px;";
        h.textContent = title;
        wrap.appendChild(h);
    }
    if (subtitle) {
        const s = document.createElement("div");
        s.style.cssText = "margin:0 0 12px 0;font-size:13px;opacity:0.75";
        s.textContent = subtitle;
        wrap.appendChild(s);
    }

    // Clone the source so we can strip sticky positioning that breaks
    // capture (matches v1's behaviour for league/player tables).
    const clone = source.cloneNode(true);
    clone.querySelectorAll("tr").forEach((tr) => {
        tr.style.position = "static";
        tr.style.bottom = "auto";
    });
    clone.querySelectorAll("th, td").forEach((cell) => {
        cell.style.position = "static";
        cell.style.left = "auto";
    });
    if (source.tagName === "TABLE") {
        clone.style.width = source.offsetWidth + "px";
        wrap.style.width = source.offsetWidth + 48 + "px";
    }

    const scroll = document.createElement("div");
    scroll.style.cssText = "max-height:none;overflow:visible;";
    scroll.appendChild(clone);
    wrap.appendChild(scroll);

    document.body.appendChild(wrap);
    if (includeCredit) appendCredit(wrap);

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale, backgroundColor: null, useCORS: true });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename.replace(/\s+/g, "_")}.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}
