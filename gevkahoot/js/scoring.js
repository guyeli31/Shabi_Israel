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
