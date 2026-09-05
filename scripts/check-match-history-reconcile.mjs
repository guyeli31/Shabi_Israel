#!/usr/bin/env node
/**
 * check-match-history-reconcile.mjs — the rules `match_history` must never lose.
 *
 * WHY THIS EXISTS
 * `js/data/matchHistoryReconcile.js` decides, for every pairing, whether history
 * keeps its stored row and its date or gets a new one. Every rule in it was
 * added after a data-corruption bug, and none of them fails loudly when broken:
 * the reconcile keeps returning a plausible set of rows, and the damage shows up
 * later as a wrong date in Played Matches, a snapshot missing a match, or a
 * cancelled edit that quietly refuses to be cancelled. It is also the one module
 * with two callers on two runtimes — the admin publish in the browser and the
 * sync job in Node — so a regression here lands in both at once.
 *
 * These are the invariants, as executable cases:
 *
 *   1. A LIVE override is untouchable — its authored date is domain data, and
 *      re-upserting a no-op fires the audit trigger across the league.
 *   2. A CANCELLED override reverts: the pairing goes back to what the source
 *      says. History outranks the source in the read-side merge, so a manual row
 *      that outlives its override keeps showing a result the admin deleted.
 *   3. A revert whose values did not actually change keeps its date — nothing
 *      about the result moved, so nothing may move in B5 or the update points.
 *   4. A cancelled technical result on a match nobody played leaves history
 *      entirely (there is no played row to revert to).
 *   5. A live `not_played` override erases the pairing — otherwise the merge
 *      resurrects the very match the admin said never happened.
 *   6. The wipe-guard holds: 0 played matches against a non-empty history is a
 *      transient upstream glitch, not a reset.
 *   7. An unchanged CSV row is never rewritten and never redated.
 *
 * Run: node scripts/check-match-history-reconcile.mjs
 */

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, '../shabi-israel/js/data/matchHistoryReconcile.js');
const { computeMatchHistoryReconcile } = await import(pathToFileURL(modulePath).href);

const NOW = '2026-09-04T10:00:00.000Z';
const OLD = '2026-07-01T08:00:00.000Z';
const L = 'League';

const match = (a, b, scoreA, scoreB) => ({
    league_id: L, player_a: a, player_b: b, score_a: scoreA, score_b: scoreB,
    pr_a: null, pr_b: null, luck_a: null, luck_b: null, round: 1, played: true,
});
const historyRow = (a, b, scoreA, scoreB, source, updatedAt) => ({
    id: `${a}|${b}`, league_id: L, player_a: a, player_b: b, score_a: scoreA, score_b: scoreB,
    pr_a: null, pr_b: null, luck_a: null, luck_b: null, round: 1, source, updated_at: updatedAt,
});
const resultOverride = (a, b, scoreA, scoreB, editedAt) => ({
    league_id: L, type: 'result', player_a: a, player_b: b, score_a: scoreA, score_b: scoreB,
    pr_a: null, pr_b: null, luck_a: null, luck_b: null, edited_at: editedAt,
});

const run = (matchRows, overrideRows, historyRows) =>
    computeMatchHistoryReconcile({ matchRows, overrideRows, historyRows, leagueId: L, now: NOW });

let failures = 0;
function check(name, passed, detail) {
    if (passed) { console.log(`  ok   ${name}`); return; }
    failures++;
    console.log(`  FAIL ${name}\n       ${JSON.stringify(detail)}`);
}

// 1 — a live override is left exactly as stored.
{
    const r = run([match('A', 'B', 7, 3)], [resultOverride('A', 'B', 5, 7, OLD)],
        [historyRow('A', 'B', 5, 7, 'manual', OLD)]);
    check('live override is never rewritten', r.upsertRows.length === 0 && r.staleIds.length === 0, r);
}

// 2 — cancelling an override restores the source result.
{
    const r = run([match('A', 'B', 7, 3)], [], [historyRow('A', 'B', 5, 7, 'manual', OLD)]);
    const row = r.upsertRows[0];
    check('cancelled override reverts to the source result',
        r.upsertRows.length === 1 && row.score_a === 7 && row.score_b === 3 && row.source === 'csv', r);
    check('cancelled override is dated now (the original date was overwritten)',
        !!row && row.updated_at === NOW, row);
}

// 3 — a revert that changes nothing must not move the date.
{
    const r = run([match('A', 'B', 5, 7)], [], [historyRow('A', 'B', 5, 7, 'manual', OLD)]);
    const row = r.upsertRows[0];
    check('cancelled override with an identical result keeps its date',
        !!row && row.updated_at === OLD && row.source === 'csv', r);
}

// 4 — a cancelled technical result on an unplayed match leaves history.
{
    const r = run([match('A', 'B', 7, 3)], [],
        [historyRow('A', 'B', 7, 3, 'csv', OLD), historyRow('C', 'D', 1, 0, 'manual', OLD)]);
    check('cancelled technical on an unplayed match is deleted',
        r.staleIds.length === 1 && r.staleIds[0] === 'C|D' && r.upsertRows.length === 0, r);
}

// 5 — a live not_played override erases the pairing.
{
    const r = run([match('A', 'B', 7, 3)],
        [{ league_id: L, type: 'not_played', player_a: 'A', player_b: 'B' }],
        [historyRow('A', 'B', 7, 3, 'csv', OLD)]);
    check('live not_played deletes the history row', r.staleIds.length === 1, r);
}

// 6 — the wipe-guard.
{
    const r = run([], [], [historyRow('A', 'B', 7, 3, 'csv', OLD)]);
    check('wipe-guard refuses to empty a non-empty history', r.skipped === true, r);
}

// 7 — an unchanged CSV row is not touched.
{
    const r = run([match('A', 'B', 7, 3)], [], [historyRow('A', 'B', 7, 3, 'csv', OLD)]);
    check('unchanged csv row is not re-upserted', r.upsertRows.length === 0, r);
}

if (failures > 0) {
    console.error(`\n✗ ${failures} match_history reconcile invariant(s) broken.`);
    process.exit(1);
}
console.log('\n✓ match_history reconcile invariants hold.');
