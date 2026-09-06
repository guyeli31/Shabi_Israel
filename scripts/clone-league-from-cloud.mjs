#!/usr/bin/env node
/**
 * clone-league-from-cloud.mjs — copy ONE league from cloud production into the
 * local Docker Supabase, so a feature can be tested against real, COMPLETE data.
 *
 * WHY THIS EXISTS
 * The local database is a partial snapshot: July 2026 has 111 played matches but
 * only 89 `match_history` rows, so anything driven by the timeline (the Title
 * Race chart, What If, Historical) is computed there from a set that is 20%
 * short. That is not a bug in those features — it is a bug in the test fixture,
 * and it is indistinguishable from a real defect until you go and count. A
 * league that is 1:1 between `matches` and `match_history` is the only fixture
 * that can tell those two apart.
 *
 * DIRECTION IS ONE-WAY AND ENFORCED
 * Cloud is READ-ONLY here, with the public anon key — the same read any
 * visitor's browser performs. Writes go only to a host that resolves to
 * localhost, checked before the first write and again before each one. A script
 * that can copy data between two databases must not be one typo away from
 * pointing the wrong direction.
 *
 * NO ANALYTICS ARE TOUCHED: this is HTTP against PostgREST, not a browser, so
 * it emits no pageview. (See CLAUDE.md § "Automated browsing must never reach
 * the live analytics" — that rule is about driving a real browser; this is not
 * one.)
 *
 * Usage:
 *   node scripts/clone-league-from-cloud.mjs "August 2026"
 *   node scripts/clone-league-from-cloud.mjs "August 2026" --dry-run
 *   node scripts/clone-league-from-cloud.mjs --list
 *
 * Re-running is safe: the league's local rows are deleted first, so a clone is
 * a replace, never a merge.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, LOCAL_SUPABASE_URL } from '../shabi-israel/js/data/supabaseConfig.js';

/** Local service_role. Not a secret: it is the fixed key the Supabase CLI ships
 *  for every local stack, and it is worthless against anything but localhost. */
const LOCAL_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST = args.includes('--list');
const leagueId = args.find(a => !a.startsWith('--'));

/**
 * The write guard. `URL.hostname` is used rather than a substring test on the
 * whole string, because "https://evil.example/?x=127.0.0.1" contains the digits
 * and a substring check would wave it through.
 */
function assertLocal(url) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        throw new Error(`REFUSING TO WRITE: ${url} is not localhost. This script only ever writes to the local Docker stack.`);
    }
}

const headers = (key) => ({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
});

/** Read every row of a table for one league, paged — never assume it fits. */
async function readAll(table, query) {
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
            headers: { ...headers(SUPABASE_ANON_KEY), Range: `${from}-${from + PAGE - 1}` },
        });
        if (!res.ok) throw new Error(`cloud read ${table} failed: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

async function localWrite(method, path, body) {
    assertLocal(LOCAL_SUPABASE_URL);
    const res = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: { ...headers(LOCAL_SERVICE_KEY), Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`local ${method} ${path} failed: ${res.status} ${await res.text()}`);
}

/** Insert in chunks — one 300-row body is fine, 5 000 is not. */
async function insertRows(table, rows, { stripId = true } = {}) {
    if (rows.length === 0) return;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK).map(r => {
            if (!stripId) return r;
            // Local sequences own their own ids; carrying the cloud's would
            // collide with rows that are already here.
            const { id, ...rest } = r;
            return rest;
        });
        await localWrite('POST', table, slice);
    }
}

async function main() {
    if (LIST || !leagueId) {
        const leagues = await readAll('leagues', 'select=id,league_type,match_length&order=id');
        console.log('Leagues in cloud production:\n');
        for (const l of leagues) console.log(`  ${l.id}  (${l.league_type}, ${l.match_length}pt)`);
        if (!leagueId) console.log('\nPass one of these as the argument.');
        return;
    }

    const enc = encodeURIComponent(leagueId);
    console.log(`→ Cloud read: ${leagueId}`);

    const [leagueRows, matches, history, overrides] = await Promise.all([
        readAll('leagues', `select=*&id=eq.${enc}`),
        readAll('matches', `select=*&league_id=eq.${enc}&order=id`),
        readAll('match_history', `select=*&league_id=eq.${enc}&order=id`),
        readAll('manual_overrides', `select=*&league_id=eq.${enc}&order=id`),
    ]);

    if (leagueRows.length === 0) {
        console.error(`No such league in cloud: "${leagueId}". Run with --list to see the names.`);
        process.exit(1);
    }

    const played = matches.filter(m => m.played).length;
    console.log(`  leagues           1`);
    console.log(`  matches           ${matches.length} (${played} played)`);
    console.log(`  match_history     ${history.length}`);
    console.log(`  manual_overrides  ${overrides.length}`);

    // The property this whole exercise is about. A league where these disagree
    // is exactly the fixture that produced the false alarm; say so loudly rather
    // than cloning a second broken one silently.
    if (history.length !== played) {
        console.log(`\n  ⚠ ${played} played matches but ${history.length} history rows — this league's timeline`);
        console.log(`    is incomplete IN THE CLOUD too, so it will not settle the question.`);
    } else {
        console.log(`\n  ✓ ${played} played = ${history.length} history rows — timeline is complete.`);
    }

    // Players this league needs whose metadata the local stack may not have.
    const names = [...new Set(matches.flatMap(m => [m.player_a, m.player_b]))].filter(n => n && n !== 'Bye');
    let meta = [];
    try {
        const inList = names.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',');
        meta = await readAll('players_metadata', `select=*&id=in.(${encodeURIComponent(inList)})`);
        console.log(`  players_metadata  ${meta.length} of ${names.length} players`);
    } catch (err) {
        // Decoration only (flag, title, photo) — a missing row costs the chip,
        // not the numbers, so this must not abort a clone.
        console.log(`  players_metadata  skipped (${err.message.slice(0, 60)})`);
    }

    if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); return; }

    assertLocal(LOCAL_SUPABASE_URL);
    console.log(`\n→ Local write: ${LOCAL_SUPABASE_URL}`);

    // Replace, not merge: delete children first, then the league row itself, so
    // a re-run cannot leave a half-old league behind.
    for (const t of ['match_history', 'manual_overrides', 'matches']) {
        await localWrite('DELETE', `${t}?league_id=eq.${enc}`);
    }
    await localWrite('DELETE', `leagues?id=eq.${enc}`);

    await insertRows('leagues', leagueRows, { stripId: false });   // id IS the name
    await insertRows('matches', matches);
    await insertRows('match_history', history);
    await insertRows('manual_overrides', overrides);
    if (meta.length) await insertRows('players_metadata', meta, { stripId: false });

    console.log(`  ✓ done — "${leagueId}" is now in local Docker.`);
    console.log(`\n  http://localhost:8090/shabi-israel/league.html?league=${enc}&tab=predictor`);
}

main().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
