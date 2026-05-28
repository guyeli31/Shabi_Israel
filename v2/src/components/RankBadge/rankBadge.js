// components/RankBadge/rankBadge.js — circular medal badge for 1/2/3,
// or a plain numeric for higher ranks. Composes primitive Badge with
// the right gold/silver/bronze variant.

import { render as Badge } from "../../primitives/Badge/badge.js";

/**
 * @param {object} props
 * @param {number} props.rank — 1-based visual position.
 * @param {"sm"|"md"|"lg"} [props.size]
 * @returns {HTMLSpanElement}
 */
export function render({ rank, size = "md" } = {}) {
    if (rank === 1) return Badge({ text: 1, variant: "gold",   circle: true, size });
    if (rank === 2) return Badge({ text: 2, variant: "silver", circle: true, size });
    if (rank === 3) return Badge({ text: 3, variant: "bronze", circle: true, size });
    const span = document.createElement("span");
    span.className = "rank-badge rank-badge--plain";
    span.textContent = String(rank ?? "");
    return span;
}
