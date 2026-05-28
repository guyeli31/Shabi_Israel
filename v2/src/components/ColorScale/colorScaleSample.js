// components/ColorScale/colorScaleSample.js — visual demo for the
// catalogue. The maths live in colorScale.js (importable by tables);
// this file only renders a strip of swatches that re-tints when the
// theme changes.

import { colorForValue } from "./colorScale.js";

/**
 * @param {object} [props]
 * @param {number} [props.steps=11]
 * @returns {HTMLDivElement}
 */
export function render({ steps = 11 } = {}) {
    const row = document.createElement("div");
    row.className = "color-scale";

    function repaint() {
        row.innerHTML = "";
        for (let i = 0; i < steps; i++) {
            const ratio = i / (steps - 1);
            const sw = document.createElement("div");
            sw.className = "color-scale__swatch";
            sw.style.background = colorForValue(ratio, 0, 1);
            sw.textContent = ratio.toFixed(1);
            row.appendChild(sw);
        }
    }
    repaint();
    window.addEventListener("themechange", repaint);
    return row;
}
