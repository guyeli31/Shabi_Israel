/**
 * tiebreaks.js — THE tiebreak policy. One home, both runtimes.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * A league's ranking is decided in two halves. The sort settles the first half
 * (Win Rate, Avg Points, Wins…). Everyone still tied after it is separated by a
 * CASCADE of further criteria, applied one at a time to the still-tied subgroup.
 *
 * That cascade used to be written TWICE — once over Maps of row objects for the
 * displayed table (rankings.js), once over flat typed arrays inside the
 * championship Monte Carlo's 50 000-iteration loop (championshipPredictor.js).
 * Same rule, two spellings, two places to forget. Change the policy in one and
 * the predictor projects a champion the table would never crown.
 *
 * The two implementations were never really about the RULE — they were about
 * the DATA SHAPE. A hot loop cannot afford Maps of strings; a render path
 * should not deal in array offsets. So this module splits the two concerns:
 *
 *   • The rule        — WHICH criteria, in WHICH order  → data, here, once.
 *   • The lookup      — how to read one number for one player → per runtime.
 *
 * A rule never touches a Map or an Int32Array. It asks its `tables` argument
 * for a value and stays ignorant of where that value lived. So both runtimes
 * execute literally the same policy code at their own native speed.
 *
 * ── Changing the policy ─────────────────────────────────────────────────────
 * To reorder, add or drop a criterion for ANY league type, edit that type's
 * `ranking.tiebreaks` array in leagueTypes.js. Nothing else. Both the table and
 * the predictor pick it up, because neither of them knows the policy — they
 * only know how to look values up.
 *
 * To introduce a criterion that does not exist yet, add ONE entry to
 * TIEBREAK_RULES below, declaring which lookup it needs. Every runtime already
 * provides the four lookups; a rule needing a fifth is the only case that
 * requires touching the runtimes, and `assertTablesFor()` will name it loudly
 * rather than let a lookup silently return undefined.
 *
 * ── The `tables` contract ───────────────────────────────────────────────────
 * A runtime supplies whichever of these its policy needs. `member` is whatever
 * that runtime calls a player — a row object, an array index — and is passed
 * back untouched:
 *
 *   pairWins(a, b)  → # matches a beat b
 *   pairDiff(a, b)  → Σ (a's score − b's score) over a-vs-b matches
 *   totalDiff(a)    → Σ (a's score − opponent's score) over ALL of a's matches
 *   name(a)         → display name, for the deterministic final fallback
 */

/**
 * The criteria a league type may cascade through. `value` returns "higher is
 * better" for numeric rules; `kind: 'name'` sorts ascending as text.
 *
 * `needs` is the lookup the rule calls — declared, not inferred, so a policy
 * can be validated against a runtime's tables BEFORE the first comparison.
 *
 * NAMING — every rule id is prefixed `tb`, and the ones about results between
 * tied players are "tiebreak H2H", never bare "H2H". The app already has an
 * unrelated H2H: the cross-league Head-to-Head tab on player.html, which shows
 * one player's record against one opponent over their whole history. That is a
 * BROWSING feature and has nothing to do with ranking. Calling both "H2H" cost
 * a full round of misunderstanding, so the prefix is load-bearing: a grep for
 * `tbH2h` finds the ranking rule and nothing else.
 */
export const TIEBREAK_RULES = {
    // Step 1 — who beat whom, counting only matches between the tied players.
    tbH2hWins: {
        label: 'Tiebreak H2H — wins between the tied players',
        kind: 'numeric',
        needs: 'pairWins',
        value: (m, group, t) => {
            let s = 0;
            for (const o of group) if (o !== m) s += t.pairWins(m, o);
            return s;
        }
    },
    // Step 2 — the follow-up to step 1, not a separate idea: when the tied
    // players split their matches evenly (in a three-way tie each can win one
    // and lose one), nobody leads on wins, so the MARGINS of those same matches
    // decide. Winning 5-2 contributes +3, losing 5-4 contributes −1 — so the
    // player who won big and lost narrowly comes out ahead of the player who
    // won narrowly and lost big, even though both are 1-1.
    tbH2hDiff: {
        label: 'Tiebreak H2H — points difference between the tied players',
        kind: 'numeric',
        needs: 'pairDiff',
        value: (m, group, t) => {
            let s = 0;
            for (const o of group) if (o !== m) s += t.pairDiff(m, o);
            return s;
        }
    },
    // Step 3 — only reached when steps 1 AND 2 leave players level: widen from
    // the tied group to the whole league, summing every match's margin.
    tbLeagueDiff: {
        label: 'Points difference across the whole league',
        kind: 'numeric',
        needs: 'totalDiff',
        value: (m, _group, t) => t.totalDiff(m)
    },
    tbAlphabetical: {
        label: 'Alphabetical (deterministic final fallback)',
        kind: 'name',
        needs: 'name',
        // TOTAL: no two players share a name, so this criterion can never leave
        // two members level. A policy that ends here always yields ONE order.
        total: true,
        value: (m, _group, t) => t.name(m)
    }
};

/**
 * Every league type's policy must END in a total order.
 *
 * A policy that can run out while players are still level does not mean "they
 * are equal" — it means each engine falls back to its own storage order, and
 * the table's Map order is not the Monte Carlo's array order. That is the
 * ORIGINAL BUG in a new costume: two answers, no rule to choose between them.
 * So an empty or open-ended list is rejected at import time, where it is a
 * typo, rather than at render time, where it is a wrong champion.
 */
export function assertPolicy(steps, where) {
    const last = TIEBREAK_RULES[steps?.[steps.length - 1]];
    if (!last?.total) {
        throw new Error(
            `tiebreaks (${where}): policy [${(steps || []).join(', ')}] does not end in a ` +
            `total order. Append a total rule (e.g. 'tbAlphabetical') so tied players get ONE agreed order.`
        );
    }
}

/** Which lookups a policy will actually call. */
export function tiebreakNeeds(steps) {
    const needs = new Set();
    for (const id of steps || []) {
        const rule = TIEBREAK_RULES[id];
        if (!rule) throw new Error(`tiebreaks: unknown rule "${id}"`);
        needs.add(rule.needs);
    }
    return needs;
}

/** True when the policy needs match data (i.e. anything beyond the name). */
export function needsMatchData(steps) {
    const needs = tiebreakNeeds(steps);
    needs.delete('name');
    return needs.size > 0;
}

/**
 * Fail loudly, at wiring time, if a runtime's `tables` cannot serve its policy.
 * Without this a missing lookup throws deep inside a comparator — or worse,
 * a partially-built table returns 0 for everyone and the tie resolves by
 * accident. `where` names the runtime in the message.
 */
export function assertTablesFor(steps, tables, where) {
    for (const need of tiebreakNeeds(steps)) {
        if (typeof tables?.[need] !== 'function') {
            throw new Error(`tiebreaks (${where}): policy needs table "${need}", which was not supplied`);
        }
    }
}

/**
 * Resolve one tied group by the cascade, narrowing at each step.
 *
 * Each step is applied to the STILL-TIED subgroup, not to the original group —
 * that is the whole point of a cascade and the part hand-rolled copies get
 * subtly wrong. Members that separate at a step are emitted in place; the ones
 * that remain level go on to the next step together.
 *
 * @param {Array} members  runtime-native members, all tied so far
 * @param {string[]} steps ordered rule ids (a league type's ranking.tiebreaks)
 * @param {object} tables  the lookup contract described at the top of this file
 * @param {number} level   step index (internal recursion)
 * @returns {Array} members in resolved order
 */
export function resolveTie(members, steps, tables, level = 0) {
    if (members.length <= 1) return members;

    // Policy exhausted: every criterion the league defines says these players
    // are equal. Return them untouched rather than inventing an order — the
    // caller's sort is stable, so this is the one honest answer.
    const rule = TIEBREAK_RULES[steps?.[level]];
    if (!rule) return members;

    if (rule.kind === 'name') {
        return [...members].sort((a, b) =>
            String(rule.value(a, members, tables)).localeCompare(String(rule.value(b, members, tables))));
    }

    const value = (m) => rule.value(m, members, tables);
    const sorted = [...members].sort((a, b) => value(b) - value(a));

    const out = [];
    let i = 0;
    while (i < sorted.length) {
        let j = i + 1;
        const vi = value(sorted[i]);
        while (j < sorted.length && value(sorted[j]) === vi) j++;
        const sub = sorted.slice(i, j);
        if (sub.length === 1) out.push(sub[0]);
        else out.push(...resolveTie(sub, steps, tables, level + 1));
        i = j;
    }
    return out;
}
