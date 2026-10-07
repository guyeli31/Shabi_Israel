/**
 * matchValueEquality.js — the ONE answer to "is this the same result?".
 *
 * Every write path that meets an already-stored match has to decide whether the
 * incoming numbers are a CHANGE or the same match seen again. A "change"
 * rewrites the row, fires the audit trigger and — in match_history — restamps
 * `updated_at`, which is the moment the match was played. So a false "changed"
 * is not a wasted write; it destroys a date.
 *
 * ── THE TWO PRECISIONS ─────────────────────────────────────────────────────
 * One match reaches the database from two sources that disagree about decimals:
 *
 *   • a mail report      pr 8.054   luck 1.355   (three decimals, + played_at)
 *   • the External Source pr 8.05    luck 1.36    (two decimals, no time)
 *
 * Compared exactly, 8.054 ≠ 8.05 — so the first sync after a mail report read
 * every mail-recorded match as a new result, overwrote the finer figures with
 * the coarser ones and moved each match's time to the sync's own clock. A league
 * whose results had all arrived by mail lost every played-at moment at once
 * (7 Oct 2026, all three October leagues; and 16–18 Aug 2026, unnoticed, a few
 * rows per run). Repair: sql/repair_sync_redated_match_times_2026-10-07.sql.
 *
 * So a PR or Luck figure is the same when one value is simply the other one
 * rounded to the External Source's precision. The stored, finer value is then
 * left exactly as it is — the sync must not edit a match it has nothing new to
 * say about.
 *
 * ── WHY IT IS NOT A PLAIN TOLERANCE ────────────────────────────────────────
 * `|a − b| < 0.01` would also swallow 8.05 → 8.06, a real correction by the
 * source (and in floating point 8.06 − 8.05 is 0.00999…, so even `<` would not
 * save it). The rounding rule therefore applies ONLY across precisions: one
 * value carries more decimals than the source serves, the other does not. Two
 * values at the same precision are compared exactly, as before.
 *
 * The precision cannot be read off the coarse value (a JS number has no
 * trailing zeros: the source's "8.70" arrives as 8.7), which is why it is a
 * stated constant rather than something inferred per value.
 *
 * ── THE THREE CALLERS ──────────────────────────────────────────────────────
 * This used to be three hand-copied `numEq` functions, one per write path, and
 * the bug lived in all three:
 *   - scripts/sync-source.js          writeMatchesToSupabase  (the sync)
 *   - js/admin/supabaseAdmin.js       bulkImportCSV           (admin CSV import)
 *   - js/data/matchHistoryReconcile.js                        (both of the above)
 * Keep the rule here; a fourth write path imports it rather than growing a
 * fourth copy.
 *
 * Pure — no Supabase, no DOM — so the browser and the Node job share it.
 * Verify: node scripts/check-match-history-reconcile.mjs
 */

/** Decimals the External Source serves for PR and Luck. */
export const SOURCE_DECIMALS = 2;

// Half a unit of the last source decimal, plus slack for binary floats:
// 17.83 − 17.825 evaluates to 0.005000000000002558, not 0.005.
const HALF_UNIT = 0.5 * 10 ** -SOURCE_DECIMALS + 1e-9;

/** How many decimals a number is written with ("8.054" → 3, "8.7" → 1). */
function decimalsOf(n) {
    let s = String(n);
    if (/e/i.test(s)) s = n.toFixed(12).replace(/0+$/, '');
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Exact numeric equality — for scores, and for anything an admin typed.
 *
 * Postgres `numeric` round-trips through PostgREST as a string while parsed CSV
 * and staged JSON carry JS numbers, so a strict === would read "0" !== 0 as a
 * change. null/undefined equal each other only.
 */
export function numEq(x, y) {
    if (x === null || x === undefined) return y === null || y === undefined;
    if (y === null || y === undefined) return false;
    return Number(x) === Number(y);
}

/**
 * Equality for a PR or Luck figure that may be meeting itself at another
 * precision — see the header. Symmetric: it does not matter which side is the
 * stored value.
 */
export function statEq(x, y) {
    if (numEq(x, y)) return true;
    if (x === null || x === undefined || y === null || y === undefined) return false;
    const a = Number(x), b = Number(y);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const fineA = decimalsOf(a) > SOURCE_DECIMALS;
    const fineB = decimalsOf(b) > SOURCE_DECIMALS;
    // Same precision on both sides and not equal → a real difference.
    if (fineA === fineB) return false;
    return Math.abs(a - b) <= HALF_UNIT;
}

/**
 * Is `b` the same recorded result as `a`? Scores exactly; PR and Luck allowing
 * for the precision step. Both arguments use the camelCase match shape
 * ({scoreA, scoreB, prA, prB, luckA, luckB}).
 *
 * Use this where a SOURCE restates a match. Where an admin authored the value
 * (a manual override), compare with sameExactValues — a figure typed on purpose
 * is never "just a rounding" of what was there.
 */
export function sameSourceValues(a, b) {
    return numEq(a.scoreA, b.scoreA) && numEq(a.scoreB, b.scoreB)
        && statEq(a.prA, b.prA) && statEq(a.prB, b.prB)
        && statEq(a.luckA, b.luckA) && statEq(a.luckB, b.luckB);
}

/** Every field exactly — see sameSourceValues for when to use which. */
export function sameExactValues(a, b) {
    return numEq(a.scoreA, b.scoreA) && numEq(a.scoreB, b.scoreB)
        && numEq(a.prA, b.prA) && numEq(a.prB, b.prB)
        && numEq(a.luckA, b.luckA) && numEq(a.luckB, b.luckB);
}

/** A raw snake_case `matches` / `match_history` row → the camelCase value shape. */
export function valuesOfRow(row) {
    return {
        scoreA: row.score_a, scoreB: row.score_b,
        prA: row.pr_a, prB: row.pr_b, luckA: row.luck_a, luckB: row.luck_b,
    };
}
