/**
 * last300.js — THE definition of the Last-300 PR window. There is no other.
 *
 * "Last 300" is 300 units of EXPERIENCE, not 300 matches. A match contributes
 * its own length: an 11-point match is 11 units, a 5-point one is 5. So the
 * window reaches back over however many matches it takes to accumulate 300 —
 * about 43 in a 7-point league, about 28 in an 11-point one — and comparing two
 * players always compares the same amount of play.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * This rule used to be written in FOUR places, each by hand:
 *
 *   crossLeague.js  computeLast300Map   the loop
 *   crossLeague.js  batchLast300PR      re-derived the weight
 *   allTimeRankings.js                  re-derived the weight AND the loop
 *   scripts/project-title-race.js       a different rule entirely — 300 MATCHES
 *
 * They agree today only by accident: every doubling league in the database is
 * 7 points, so a hard-coded 7 and "the league's own length" are the same number.
 * The day one 11-point league is created, three of them keep saying 7 and one
 * says 300 matches, and NONE of them errors — the player card, the Title Race
 * chart and the Predictor simply start showing three different PRs for the same
 * person, each plausible on its own. That is the exact failure mode CLAUDE.md
 * records for the player registry, and the fix is the same: one implementation,
 * called with arguments, never copied.
 *
 * ── THE BOUNDARY MATCH IS CLIPPED ───────────────────────────────────────────
 * The window is EXACTLY 300 units. A match that would overshoot enters at only
 * the weight still available: with 298 units accumulated, a 7-point match enters
 * at 2, contributing 2/300 of the mean rather than 7/307.
 *
 * The old loop added the whole match and then stopped, so "Last 300" was really
 * "the first total ≥ 300" — 301 in a 7-point league, 308 in an 11-point one, and
 * the divisor changed with the length of whichever match happened to land last.
 * Clipping makes the denominator a constant, which is what lets two players'
 * numbers actually be compared.
 *
 * Pure: no DOM, no fetch. It runs in the browser and in the Node projection job,
 * which is the point — those two must not be able to disagree.
 */

/** Units of experience in the window. The "300" in the name. */
export const WINDOW = 300;

/** Fallback spread when a player has too few matches to measure one. */
export const DEFAULT_PR_STD = 2.0;

/** Below this many matches in the window, a measured std is noise, so use the default. */
const MIN_MATCHES_FOR_STD = 3;

/**
 * Newest first. `updatedAt` decides; a match without one falls back to the order
 * its league was listed in (leagues arrive newest-first), so an undated match
 * still lands in a defensible place instead of at whatever index it was pushed.
 */
function newestFirst(a, b) {
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
    if (at != null && bt != null) return bt - at;
    if (at != null) return -1;
    if (bt != null) return 1;
    return a.leagueOrderIdx - b.leagueOrderIdx;
}

/**
 * One player's window, from their matches newest-first.
 *
 * @param {{prSelf:number, weight:number, updatedAt:?string, leagueOrderIdx:number}[]} matches
 * @returns {{mean:number, std:number, weight:number, matches:number}|null}
 *          `weight` is how much experience was actually found — less than 300
 *          for a player who has not played that much, which is the honest
 *          answer rather than a padded one. null when there is nothing at all.
 */
export function last300For(matches) {
    if (!matches || matches.length === 0) return null;
    const sorted = [...matches].sort(newestFirst);

    let wsum = 0, vsum = 0;
    const vals = [];
    for (const m of sorted) {
        const room = WINDOW - wsum;
        if (room <= 0) break;
        // The clip. A match longer than the space left enters at the space left.
        const w = Math.min(m.weight, room);
        if (w <= 0) continue;
        vsum += m.prSelf * w;
        wsum += w;
        vals.push(m.prSelf);
    }
    if (wsum <= 0) return null;

    // std is UNWEIGHTED on purpose: it describes how much a player's PR varies
    // from night to night, and a long match is not a more variable night — it is
    // more evidence about the same night. Weighting it would conflate the two.
    let std = DEFAULT_PR_STD;
    if (vals.length >= MIN_MATCHES_FOR_STD) {
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length;
        std = Math.sqrt(variance) || DEFAULT_PR_STD;
    }
    return { mean: vsum / wsum, std, weight: wsum, matches: vals.length };
}

/**
 * Build the window for many players in one pass over a set of leagues.
 *
 * @param {Iterable<string>} playerNames  who to compute for
 * @param {object[]} leagues  ALREADY FILTERED to the pool this answer is about —
 *        one type for a player card, doubling+UBC pooled for the simulator.
 *        Order matters: newest league first (it is the tiebreak for undated
 *        matches). Each needs `.matches` and a length, read via `lengthOf`.
 * @param {(league:object) => number} [lengthOf]  the league's match length, which
 *        is each of its matches' weight. Defaults to `params.MatchLength ?? 7`.
 * @returns {Map<string, {mean:number, std:number, weight:number, matches:number}>}
 *          A player with no rated match is ABSENT, not zero — the predictor
 *          distinguishes "no data" (fall back to 10.0) from "measured", and a
 *          zero entry would silently become a PR of 0, the strongest possible.
 */
export function buildLast300Map(playerNames, leagues, lengthOf = defaultLengthOf) {
    const byPlayer = new Map();
    for (const name of playerNames) byPlayer.set(name, []);

    for (let li = 0; li < leagues.length; li++) {
        const league = leagues[li];
        const weight = lengthOf(league);
        for (const m of league.matches || []) {
            // A technical result records no play: nobody sat at a board, so it
            // is not experience and carries no PR to average.
            if (m._technical) continue;
            for (const [name, prSelf] of [[m.playerA, m.prA], [m.playerB, m.prB]]) {
                if (prSelf == null) continue;
                const arr = byPlayer.get(name);
                if (!arr) continue;
                arr.push({ prSelf, weight, updatedAt: m.updatedAt || null, leagueOrderIdx: li });
            }
        }
    }

    const out = new Map();
    for (const [name, matches] of byPlayer) {
        const r = last300For(matches);
        if (r) out.set(name, r);
    }
    return out;
}

function defaultLengthOf(league) {
    return league?.params?.MatchLength ?? league?.matchLength ?? 7;
}
