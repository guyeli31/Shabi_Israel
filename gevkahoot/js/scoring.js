/**
 * scoring.js — the points formula, for the demo quiz.
 *
 *     points = round( weight × 1000 × (1 − 0.5 × t/T) )      (a correct answer)
 *
 * A live quiz is scored by the database (_gk_points in sql/gevkahoot.sql) and
 * the browser is never asked; this copy exists only because the demo has no
 * server. The two must agree — a player should score in the demo exactly what
 * the same answer would earn live.
 */
export function points(correct, weight, ms, limitSeconds) {
    if (!correct) return 0;
    const limit = limitSeconds * 1000;
    return Math.round(weight * 1000 * (1 - 0.5 * Math.min(Math.max(ms, 0), limit) / limit));
}

/**
 * The slider question. Its answer is a position, 0-1000 (sent as the
 * "option"), and the position sets the AREA of the object on the picture,
 * linearly: at 0 it is `min` of the real area, at the `target` position
 * exactly the real one — both the AUTHOR's, per question (gk_items.slider_min
 * and correct[0], published as item.slider; a third and 700 by default). So
 *
 *     area(v) / real area = min + (1 − min) × v / target
 *     deviation           = area ratio − 1 = (1 − min) × (v − target) / target
 *
 * Points are the ordinary time-based points scaled by accuracy — the
 * deviation as a fraction, so a 100% deviation would score nothing:
 *
 *     points = round( timePoints × max(0, 1 − |deviation|) )
 *
 * In the matrix the cell is coloured by that same factor, linearly from red
 * (100% off) to green (exact). An answer within 5% of the real area counts as
 * "correct" for the fastest five and the table's tie-break. Mirrored by _gk_slider_dev and
 * _gk_score in sql/gevkahoot.sql — change both or neither.
 */
export const SLIDER = { target: 700, max: 1000, start: 500, minArea: 1 / 3, good: 0.05 };

/** An item's slider scale, { min, target }: its published `slider`, else the defaults. */
export const sliderScale = (s) => ({
    min: Number.isFinite(+s?.min) ? +s.min : SLIDER.minArea,
    target: Number.isFinite(+s?.target) && +s.target > 0 ? +s.target : SLIDER.target,
});
/** Area of the object at position `v`, relative to its real area. */
export const sliderArea = (v, s) => { const { min, target } = sliderScale(s); return min + (1 - min) * v / target; };
/** Signed: +0.12 = 12% too big, −0.3 = 30% too small. */
export const sliderDeviation = (v, s) => { const { min, target } = sliderScale(s); return (1 - min) * (v - target) / target; };
export const sliderCorrect = (v, s) => Math.abs(sliderDeviation(v, s)) <= SLIDER.good + 1e-9;

/** The accuracy factor for a deviation: 1 when exact, 0 at 100% off. */
export const sliderAccuracy = (dev) => Math.max(0, 1 - Math.abs(dev));

export function sliderPoints(v, weight, ms, limitSeconds, s) {
    return Math.round(points(true, weight, ms, limitSeconds) * sliderAccuracy(sliderDeviation(v, s)));
}

/**
 * The ranking question. The answer is a whole ORDER — option indexes from the
 * top place to the bottom one — packed into the one integer every answer is
 * sent as: base-5 digits, the top place in the lowest digit.
 *     [2, 0, 3, 1]  →  2 + 0·5 + 3·25 + 1·125 = 202
 * Five options fit in 0-3124. Mirrored by _gk_rank_order in sql/gevkahoot.sql.
 * Only the exact order scores (time points, as in any question).
 */
export const encodeRank = (order) => order.reduce((code, opt, i) => code + opt * 5 ** i, 0);

/** The order a code stands for, or null if it is not a full order of n options. */
export function decodeRank(code, n) {
    if (!Number.isInteger(code) || code < 0 || code >= 5 ** n) return null;
    const order = Array.from({ length: n }, (_, i) => Math.floor(code / 5 ** i) % 5);
    return new Set(order).size === n && order.every((o) => o < n) ? order : null;
}

/**
 * The order the options are STORED (and so first shown) in: by a hash of
 * their text, which has nothing to do with the ranking — not the author's
 * order, which IS the answer, and not alphabetical, which for years or
 * numbers would be the answer too. If the scramble happens to be the right
 * order it is rotated by one. Returns the stored options and `correct` (the
 * stored indexes from the top place down).
 */
export function scrambleRank(inOrder) {
    const hash = (s) => [...s].reduce((a, c) => (Math.imul(a ^ c.codePointAt(0), 16777619) >>> 0), 2166136261);
    let stored = inOrder.map((text, rank) => ({ text, rank })).sort((a, b) => hash(a.text) - hash(b.text) || a.rank - b.rank);
    if (stored.length > 1 && stored.every((s, i) => s.rank === i)) stored = [...stored.slice(1), stored[0]];
    const correct = inOrder.map((_, rank) => stored.findIndex((s) => s.rank === rank));
    return { options: stored.map((s) => s.text), correct };
}

/**
 * The action round (free throws). The answer is how many baskets a player
 * made in the time limit, and the points are RELATIVE to the room: linear
 * between its fewest (0 points, as if wrong) and its most (weight × 1000, as
 * if answered at once). Everyone level: full points if they scored at all.
 *
 *     share  = (hits − fewest) / (most − fewest)
 *     points = round( weight × 1000 × share )
 *
 * Mirrored by _gk_action_factor / _gk_action_score in sql/gevkahoot.sql.
 */
export function actionFactor(hits, lo, hi) {
    if (hi > lo) return (hits - lo) / (hi - lo);
    return hits > 0 ? 1 : 0;
}
export const actionPoints = (hits, lo, hi, weight) => Math.round(weight * 1000 * actionFactor(hits, lo, hi));

/**
 * What makes a throw a basket — the three windows a throw must fall in.
 *   aim    left/right: the drag's sideways slope |dx / dy| — 0.0525 lands the
 *          ball within ±2.6% of the court's width of the rim's centre (the
 *          rim is ±6.7% wide); up to `rim` it hits the rim and falls out.
 *   power  the drag's length upwards as a fraction of the court's height:
 *          inside the window it reaches the rim; below it falls short, above
 *          it hits the backboard and bounces out.
 *   ms     the drag's duration: a throw is ONE movement — longer than `slow`
 *          is a push, not a throw, and dies on the way.
 * Both windows were halved at the host's request (they were aim 0.1 and
 * power 0.25-0.4): the round was too easy; then made 10% likelier again —
 * each window 5% wider, since a basket needs both (1.05² ≈ 1.10).
 * The server cannot see a throw; it holds the count to one basket a second.
 */
export const THROW = {
    aim: 0.0525, rim: 0.12,
    power: [0.285625, 0.364375], ideal: 0.325,
    slow: 1200,
};

/** "12% גדול מדי" — the deviation as a player reads it. */
export function sliderVerdict(v, s) {
    const d = sliderDeviation(v, s);
    const pct = Math.round(Math.abs(d) * 100);
    if (pct === 0) return 'בול! סטייה 0%';
    return `סטייה של ${pct}% (${d > 0 ? 'גדול מדי' : 'קטן מדי'})`;
}
