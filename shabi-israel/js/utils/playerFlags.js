/**
 * playerFlags.js — the one place that answers "which flag does this name wear".
 *
 * There are exactly TWO questions, and they have different answers:
 *
 *   • CONTEXT-FREE — "this player, in general" → the flag they LAST played
 *     under: the newest league they appear in, read through that league's own
 *     CustomFlags. Card headers, smart search, all-time tables, opponent
 *     aggregates.
 *
 *   • CONTEXT-BOUND — "this player, in THIS league / THIS match" → that
 *     league's CustomFlags, full stop. Match history, per-match records,
 *     league tables. A player who changed flag mid-league is shown with that
 *     league's stored flag, which is by definition the last one they played
 *     under there — CustomFlags holds one entry per player per league, so the
 *     league IS the granularity, and there is no per-round flag to chase.
 *
 * Both questions used to be answered by one flat `Object.assign` merge of every
 * league's CustomFlags, and that is wrong in both directions:
 *
 *   1. The winner was whichever league came last in DisplayOrder — in practice
 *      the OLDEST — so "in general" showed the FIRST flag, not the last.
 *   2. A per-match row got that same single answer regardless of which league
 *      the match belonged to, so a flag change rewrote history backwards.
 *   3. A merge cannot express a player who went BACK to the default. IL is an
 *      ABSENCE from CustomFlags, not a value, so an older custom flag outlives
 *      it forever. Resolving through the newest league the player actually
 *      appears in is the only shape that can return IL again.
 *
 * `leaguesNewestFirst` = DisplayOrder, index 0 = most recent. That IS the
 * site's own recency ordering (the landing page renders leagues in it, the
 * admin controls it), so it stays right for a league whose IssueDate was never
 * filled in. It is the same rule `resolveDefaultFlags()` in
 * admin/leagueManager.js already uses to pick the flag a player joins a NEW
 * league with — this module makes the read path agree with the write path.
 */

import { getFlagCode } from './helpers.js';

/**
 * @param {Array} leaguesNewestFirst — [{ id, params, allPlayers }] in
 *   DisplayOrder (newest first). `allPlayers` may be a Set, an array, or
 *   omitted — a league with no roster still contributes its CustomFlags to
 *   `inLeague()`, it just can't answer `latest()` for anyone.
 */
export function buildPlayerFlagIndex(leaguesNewestFirst) {
    const byLeague = new Map();  // leagueId → CustomFlags
    const rank = new Map();      // leagueId → recency index (0 = newest)
    const newestOf = new Map();  // player → id of the newest league they appear in

    (leaguesNewestFirst || []).forEach((l, i) => {
        if (!l || !l.id) return;
        byLeague.set(l.id, l.params?.CustomFlags || {});
        rank.set(l.id, i);
        for (const name of (l.allPlayers || [])) {
            // Newest first, so the first league to claim a name is theirs.
            if (!newestOf.has(name)) newestOf.set(name, l.id);
        }
    });

    return {
        /** CONTEXT-BOUND: the flag this player wore in THIS league. */
        inLeague(name, leagueId) {
            return getFlagCode(name, byLeague.get(leagueId) || {});
        },

        /** CONTEXT-FREE: the flag this player LAST played under, site-wide. */
        latest(name) {
            const id = newestOf.get(name);
            return id ? getFlagCode(name, byLeague.get(id)) : 'IL';
        },

        /**
         * CONTEXT-FREE, restricted: the flag from the newest league among
         * `leagueIds`. For callers that hold their own roster (the smart
         * search's player index) rather than the leagues' own.
         */
        latestAmong(name, leagueIds) {
            let bestId = null;
            let best = Infinity;
            for (const id of (leagueIds || [])) {
                const r = rank.get(id);
                if (r != null && r < best) { best = r; bestId = id; }
            }
            return bestId ? getFlagCode(name, byLeague.get(bestId)) : 'IL';
        },

        /** Raw CustomFlags for one league — for call sites that pass a map on. */
        flagsOf(leagueId) { return byLeague.get(leagueId) || {}; },
    };
}
