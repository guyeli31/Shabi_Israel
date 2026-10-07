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
 *   8. The source showing a match ROUNDED is not a change. A mail report records
 *      PR/Luck to three decimals with the moment the match was played; the
 *      External Source serves two. Compared exactly, the first sync redated
 *      every mail-recorded match to its own clock (7 Oct 2026). A real
 *      difference at the source's own precision must still register, and so
 *      must an admin's override.
 *
 * Run: node scripts/check-match-history-reconcile.mjs
 */

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, '../shabi-israel/js/data/matchHistoryReconcile.js');
const { computeMatchHistoryReconcile } = await import(pathToFileURL(modulePath).href);
const { statEq } = await import(pathToFileURL(
    resolve(here, '../shabi-israel/js/data/matchValueEquality.js')).href);

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

// 8 - the source's rounding is not a new result.
{
    const stats = (row, prA, luckA, prB, luckB) => ({ ...row, pr_a: prA, luck_a: luckA, pr_b: prB, luck_b: luckB });
    const MAIL = '2026-10-02T13:10:54.000Z';
    // The mail figures, exactly as recorded (audit_log, August 2026).
    const stored = stats(historyRow('A', 'B', 7, 4, 'csv', MAIL), 8.054, 1.355, 17.825, -2.036);

    const rounded = run([stats(match('A', 'B', 7, 4), 8.05, 1.36, 17.83, -2.04)], [], [stored]);
    check('a mail-recorded match shown rounded by the source is not rewritten or redated',
        rounded.upsertRows.length === 0 && rounded.staleIds.length === 0, rounded);

    // 8.695 is the float trap: x100 gives 869.4999..., which a naive round()
    // turns into 8.69 while the source shows 8.7.
    const half = run([stats(match('A', 'B', 7, 4), 8.7, 1.36, 17.83, -2.04)], [],
        [stats(historyRow('A', 'B', 7, 4, 'csv', MAIL), 8.695, 1.355, 17.825, -2.036)]);
    check('a half-way value (8.695 shown as 8.7) is still the same match',
        half.upsertRows.length === 0, half);

    const moved = run([stats(match('A', 'B', 7, 4), 8.06, 1.36, 17.83, -2.04)], [], [stored]);
    check('a PR that differs by more than rounding (8.054 -> 8.06) is a change, dated now',
        moved.upsertRows.length === 1 && moved.upsertRows[0].updated_at === NOW, moved);

    const samePrecision = run([stats(match('A', 'B', 7, 4), 8.06, 1.36, 17.83, -2.04)], [],
        [stats(historyRow('A', 'B', 7, 4, 'csv', MAIL), 8.05, 1.36, 17.83, -2.04)]);
    check('a 0.01 correction at the source precision (8.05 -> 8.06) is a change',
        samePrecision.upsertRows.length === 1 && samePrecision.upsertRows[0].updated_at === NOW, samePrecision);

    const score = run([stats(match('A', 'B', 7, 5), 8.05, 1.36, 17.83, -2.04)], [], [stored]);
    check('a changed score is a change even when the stats only rounded',
        score.upsertRows.length === 1 && score.upsertRows[0].updated_at === NOW, score);

    // An admin's override is authored, not restated: exact comparison.
    const override = { ...resultOverride('A', 'B', 7, 4, null), pr_a: 8.05, luck_a: 1.36, pr_b: 17.83, luck_b: -2.04 };
    const authored = run([stats(match('A', 'B', 7, 4), 8.05, 1.36, 17.83, -2.04)], [override],
        [stats(historyRow('A', 'B', 7, 4, 'manual', MAIL), 8.054, 1.355, 17.825, -2.036)]);
    check('an override that types a rounded figure over a finer one is written',
        authored.upsertRows.length === 1 && Number(authored.upsertRows[0].pr_a) === 8.05, authored);

    check('statEq: equal, rounded, string-typed and null cases',
        statEq(8.05, 8.05) && statEq('8.054', 8.05) && statEq(8.05, 8.054) && statEq(null, undefined)
        && statEq(-3.2, -3.2) && statEq(0, 0.004), {});
    check('statEq: real differences are not swallowed',
        !statEq(8.05, 8.06) && !statEq(8.054, 8.06) && !statEq(8.054, 8.057) && !statEq(8.74, 8.7)
        && !statEq(null, 0) && !statEq(8.054, null), {});
}

if (failures > 0) {
    console.error(`\n✗ ${failures} match_history reconcile invariant(s) broken.`);
    process.exit(1);
}
console.log('\n✓ match_history reconcile invariants hold.');
