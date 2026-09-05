#!/usr/bin/env node
/**
 * check-players-registry.mjs — rule 13 of docs/data-architecture/02-query-standards.md.
 *
 * WHY THIS EXISTS
 * A league is an entity: a row in public.leagues, able to exist before its first
 * fixture. A player is not — a person exists only by appearing in a match's
 * player_a/player_b. With no entity there was no authoritative answer to "does
 * this name exist", so five call sites each derived their own: the Players tab
 * and three pickers counted any non-hidden league, mail_orphan_reason counted
 * only RUNNING ones.
 *
 * None of those copies fails loudly when it drifts. Each keeps returning a
 * plausible list, and the disagreement surfaces somewhere else entirely, wearing
 * the costume of a data problem — which is how a five-season regular came to be
 * reported to the admin as "Unknown player: fridlich".
 *
 * A rule in a document does not survive that: the next person needing a player
 * list will write the loop again, because writing five lines is easier than
 * finding the function. This is the thing that says no.
 *
 * WHAT IT LOOKS FOR
 * The shape of the hand-rolled roster: iterating leagues and harvesting
 * `allPlayers` into a collection, outside the files allowed to do so. An
 * in-LEAGUE list is legitimate and common (a round view, a league picker), so
 * the pattern is only flagged when it walks a COLLECTION of leagues.
 *
 * Exit 1 and a file:line list on any violation.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'shabi-israel', 'js');

// The files that are ALLOWED to derive the roster:
//   store.js            — owns loadVisiblePlayerNames(), the one definition.
//   navigation.js       — builds the search index's per-league detail, then
//                         defers to the registry for membership (see the file).
//   playerGeneralPage.js / landingPage.js
//                       — keep their original loop as the documented fallback
//                         for a database predating sql/players_registry.sql.
// Anything else adding this loop is copy #6.
const ALLOWED = new Set([
    'data/store.js',
    'render/navigation.js',
    'render/playerGeneralPage.js',
    'render/landingPage.js',
    // compute/allTimeRankings.js — not a roster at all. It walks the leagues of
    // ONE league type to build that table's flag map; the question is "who
    // played in these leagues", which is a context, not the site's player list.
    'compute/allTimeRankings.js',
]);

// admin/** is deliberately out of scope: admin autocomplete must also offer
// staged and pre-registered players, who do not exist in the registry yet.
// That is a different question, not a drifted copy of this one.
const SKIP_DIRS = new Set(['admin', 'vendor']);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (!SKIP_DIRS.has(entry)) walk(full, out);
        } else if (entry.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

// ── Part 2: lastFlag is the CONTEXT-FREE answer, and only that ─────────────
// `players_registry.last_flag` is the flag a player LAST played under, site-wide.
// It is correct for a card header, a cross-league search row, an all-time table.
// It is WRONG for anything belonging to one league or one match: a per-match row
// must show the flag that player wore IN THAT LEAGUE (playerFlags.js's
// `inLeague()`), or a flag change rewrites history backwards — every past match
// of a player who switched countries would suddenly show the new flag.
//
// That bug already happened once, before playerFlags.js split the two questions.
// Putting last_flag on every registry row makes it convenient again, which is
// exactly why reaching for it now needs a deliberate, listed decision.
//
// Nothing consumes it yet, so the allowlist is just the mapper that produces it.
// Adding a file here is the decision; the comment beside it is the reasoning.
const LAST_FLAG_ALLOWED = new Set([
    'data/bundleMapper.js',   // produces the field
    'data/store.js',          // passes the mapped rows through
]);

const violations = [];
const flagViolations = [];

for (const file of walk(JS_DIR)) {
    const rel = relative(JS_DIR, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    if (!LAST_FLAG_ALLOWED.has(rel)) {
        lines.forEach((line, i) => {
            if (!/\blastFlag\b|\blast_flag\b/.test(line)) return;
            if (/^\s*(\/\/|\*)/.test(line)) return;   // a comment discussing it is fine
            flagViolations.push({ file: `shabi-israel/js/${rel}`, line: i + 1, text: line.trim() });
        });
    }

    if (ALLOWED.has(rel)) continue;

    lines.forEach((line, i) => {
        // `for (const X of <something plural>.allPlayers)` on its own is an
        // in-league list. The violation is harvesting allPlayers while walking a
        // COLLECTION of leagues — so look for the inner loop and confirm an
        // enclosing leagues loop within a short window above it.
        if (!/\.allPlayers\b/.test(line)) return;
        if (!/\bfor\s*\(/.test(line) && !/\bfor\b/.test(line)) return;

        const before = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
        const walksLeagues = /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+[\w.]*(leagues|allLeagues|visibleLeagues)\b/i.test(before);
        if (!walksLeagues) return;

        violations.push({
            file: `shabi-israel/js/${rel}`,
            line: i + 1,
            text: line.trim(),
        });
    });
}

if (flagViolations.length > 0) {
    console.error("✗ players_registry's last_flag used outside the context-FREE question (rule 13).\n");
    for (const v of flagViolations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.text}`);
    }
    console.error(`
  last_flag is the flag a player LAST played under, site-wide. Correct for a card
  header, a cross-league search row, an all-time table.

  WRONG for anything belonging to one league or one match — those must use that
  league's own flag (buildPlayerFlagIndex().inLeague(name, leagueId) in
  js/utils/playerFlags.js). Otherwise a player who changes country has every past
  match redrawn under the new flag, which is the exact bug playerFlags.js was
  written to fix. Verified live: Moriarty renders TZ in April 2026 and GE in
  June 2026, in the same tables.

  If this really is the context-free question, add the file to LAST_FLAG_ALLOWED
  in this script with a comment saying so.
`);
    process.exit(1);
}

if (violations.length > 0) {
    console.error('✗ Site-wide player roster rebuilt by hand (query-standards rule 13).\n');
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.text}`);
    }
    console.error(`
  The site's player roster has ONE definition: loadVisiblePlayerNames() in
  js/data/store.js, backed by the players_registry view (sql/players_registry.sql,
  carried inside get_site_bundle — no extra round trip).

  Use it instead of rebuilding the list from the leagues. If the list you need is
  a CONTEXT's roster — one league, one round, one staged edit — it is not this
  rule's business: read it from that context and add the file to ALLOWED here
  with a comment saying which context it serves.
`);
    process.exit(1);
}

console.log(`OK — no hand-rolled rosters, and last_flag stays context-free (rule 13). Checked ${walk(JS_DIR).length} files under js/.`);
