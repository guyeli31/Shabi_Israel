// components/MedalRow/medalRow.js — given a 1-based rank, return the
// tinted-row className (or "" for rank > 3). Used by table renderers to
// decorate a <tr> for top-3 finishers.

/** @param {number} rank — 1-based finishing position. */
export function classNameForRank(rank) {
    if (rank === 1) return "row-medal-gold";
    if (rank === 2) return "row-medal-silver";
    if (rank === 3) return "row-medal-bronze";
    return "";
}

/**
 * Apply the medal class to a <tr> element, if any.
 * @param {HTMLTableRowElement} tr
 * @param {number} rank — 1-based.
 */
export function apply(tr, rank) {
    const cls = classNameForRank(rank);
    if (cls) tr.classList.add(cls);
}
