// components/TypePill/typePill.js — league-type label (Doubling / Regular
// / UBC). Thin wrapper over primitive Pill that owns the type→label map
// so callers can pass the raw type string from league_params.json.

import { render as Pill } from "../../primitives/Pill/pill.js";

const LABELS = {
    doubling: "Doubling",
    regular:  "Regular",
    ubc:      "UBC",
};

/**
 * @param {object} props
 * @param {"doubling"|"regular"|"ubc"} props.type
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {boolean} [props.uppercase=true] — v1 default.
 * @returns {HTMLSpanElement}
 */
export function render({ type = "doubling", size, uppercase = true } = {}) {
    return Pill({
        text: LABELS[type] ?? type,
        variant: type,
        size,
        uppercase,
    });
}
