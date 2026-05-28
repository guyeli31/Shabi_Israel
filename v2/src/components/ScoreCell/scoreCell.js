// components/ScoreCell/scoreCell.js — table cell with a value coloured
// by its position inside a [min, max] range. Used for WinRate / PR /
// Luck / Games-remaining cells across the league + dashboard tables.

import { colorForValue, colorForValueInverted } from "../ColorScale/colorScale.js";

/**
 * @param {object} props
 * @param {number} props.value
 * @param {number} props.min
 * @param {number} props.max
 * @param {boolean} [props.inverted=false] — flip scale (low=green).
 * @param {(v:number)=>string} [props.format] — custom formatter; default toFixed(2).
 * @param {"td"|"th"|"span"} [props.tag="td"]
 * @returns {HTMLElement}
 */
export function render({ value, min, max, inverted = false, format, tag = "td" } = {}) {
    const el = document.createElement(tag);
    el.className = "score-cell score-cell--scaled" + (inverted ? " score-cell--inverted" : "");
    const colour = inverted
        ? colorForValueInverted(value, min, max)
        : colorForValue(value, min, max);
    el.style.color = colour;
    const fmt = format ?? ((v) => (typeof v === "number" ? v.toFixed(2) : String(v ?? "")));
    el.textContent = fmt(value);
    return el;
}
