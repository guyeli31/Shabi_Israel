/**
 * netLuck.js — THE per-match Luck figure a player is shown: their own luck minus
 * the opponent's.
 *
 * The source records one luck number per SIDE, and the two are not zero-sum:
 * both players of a match can come out positive (GuyEliyahu +2.02 vs GS18671
 * +4.60, August 2026) or both negative. A player's own number alone therefore
 * says nothing about who the dice favoured — +2.02 reads as "lucky" in a match
 * where the opponent was luckier by 2.58. The difference is the figure that
 * answers the question, so it is the one every per-match surface displays.
 *
 * It lives here because it used to be written inline, per surface: the two
 * match tables and the Records tab subtracted, while the match-history charts
 * and their detail panels did not — so a red bar pointing UP sat directly above
 * a table row reading -2.58 for the same match.
 *
 * @param {{luckSelf:?number, luckOpp:?number}} m  a match from one player's side
 * @returns {?number} null when either side has no luck figure (a technical
 *          result, a match with no rates) — never 0, which would draw as a real
 *          "perfectly even" match.
 */
export function netLuck(m) {
    if (!m || m.luckSelf == null || m.luckOpp == null) return null;
    return m.luckSelf - m.luckOpp;
}
