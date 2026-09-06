#!/usr/bin/env node
/**
 * project-title-race.js — recompute the Title Race projections for the leagues
 * the database has asked for.
 *
 * Spec: docs/data-architecture/05-projection-cache.md
 *
 * WHY THIS RUNS HERE AND NOT IN THE PAGE
 * The chart needs, for every update point of a league, a Monte Carlo projection
 * of the final standings — ~1.1 s per point at full accuracy, ~98 s for a
 * league. In a browser that is a frozen tab, paid by every visitor, for an
 * answer identical for all of them. Computed once here it is free to read, and
 * — because Monte Carlo is random — finally STABLE: without this, two people
 * looking at the same historical point see different numbers.
 *
 * WHY IT RUNS AT FULL 50 000 ITERATIONS
 * The browser fallback trades accuracy for time (5 000 iterations, within ~1 %).
 * A background job has no such pressure, so the stored numbers are the accurate
 * ones and the fallback is the approximation — the right way round.
 *
 * WORK SELECTION
 * `claim_projection_work()` returns leagues whose `match_history` changed since
 * the last run (queued by the trigger in sql/league_projections.sql, coalesced
 * to one entry per league). `--league <id>` overrides for a manual backfill;
 * `--all` takes every league.
 *
 * Usage:
 *   node scripts/project-title-race.js                 # whatever is queued
 *   node scripts/project-title-race.js --all           # backfill everything
 *   node scripts/project-title-race.js --league "July 2026"
 *   node scripts/project-title-race.js --dry-run       # compute, don't write
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { buildMatchTimeline, getUpdatePoints } from '../shabi-israel/js/compute/matchHistory.js';
import { buildLeagueProjection, withInitialPoint } from '../shabi-israel/js/compute/topXTimeline.js';
import { buildLast300Map } from '../shabi-israel/js/compute/last300.js';
import { getLeagueConfig } from '../shabi-israel/js/compute/leagueTypes.js';
import { applyOverrides } from '../shabi-israel/js/data/applyOverrides.js';

const ITERATIONS = 50_000;
// Every place, not the first ten. The chart's Show control offers each rank up
// to the roster size, and a shorter row was clamped silently rather than
// refused - "Top 15" drew the Top 10 curve. See buildLeagueProjection.
const DEPTH = Infinity;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * Retry a database call.
 *
 * Not defensive boilerplate — it fixes an observed failure. A league's
 * projection is ~80 seconds of SYNCHRONOUS Monte Carlo, during which Node's
 * event loop is blocked and every pooled HTTP socket to Supabase goes stale.
 * The first write after that compute reliably failed with a bare
 * `TypeError: fetch failed`, because undici tried to reuse a connection the
 * server had long since closed. A retry establishes a fresh one.
 *
 * It also covers what a CI runner throws at any long job: a transient DNS
 * hiccup, a brief 5xx from the API gateway.
 */
async function withRetry(label, fn, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            const res = await fn();
            if (res && res.error) throw new Error(res.error.message);
            return res;
        } catch (err) {
            lastErr = err;
            if (i < attempts) {
                const waitMs = 500 * i;
                console.log(`    ${label}: attempt ${i} failed (${err.message}); retrying in ${waitMs}ms`);
                await new Promise(r => setTimeout(r, waitMs));
            }
        }
    }
    throw new Error(`${label} failed after ${attempts} attempts: ${lastErr && lastErr.message}`);
}

/** Rows → the shapes the compute modules expect (they are written for the browser). */
const mapMatch = (m) => ({
    playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
    prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b, round: m.round, played: m.played,
});
const mapHistory = (h) => ({
    playerA: h.player_a, playerB: h.player_b, scoreA: h.score_a, scoreB: h.score_b,
    prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b,
    round: h.round, updatedAt: h.updated_at, source: h.source,
});
const mapOverride = (o) => ({
    type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
    scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b,
    luckA: o.luck_a, luckB: o.luck_b, timestamp: o.edited_at || undefined,
});

/**
 * The Last-300 PR window the simulator draws player strength from — pooled
 * across every cube-playing league (doubling + UBC), exactly as the browser
 * does, because it calls the same function the browser calls.
 *
 * This used to be re-implemented here, and got the rule WRONG in a way nothing
 * could catch: it took the last 300 MATCHES, where the window is 300 units of
 * EXPERIENCE — about 43 matches at 7 points each. Seven times too wide, so every
 * stored projection was built on a different notion of player strength from the
 * one the page would have computed. See js/compute/last300.js.
 *
 * Only the FETCHING is local: the browser has a cached site bundle, this has
 * PostgREST. What is assembled is the same shape `buildLast300Map` expects.
 */
async function loadLast300Map() {
    const { data: leagueRows, error: le } = await supabase
        .from('leagues').select('id, league_type, match_length, hidden, archived');
    if (le) throw new Error(`could not read leagues: ${le.message}`);

    // Hidden means hidden from everyone — a hidden league must not silently
    // change a visible league's numbers.
    const pool = (leagueRows || [])
        .filter(l => (l.league_type || 'doubling') !== 'regular')
        .filter(l => !l.hidden && !l.archived);
    const byId = new Map(pool.map(l => [l.id, l]));

    const rows = await readAllRows('match_history',
        'league_id, player_a, player_b, pr_a, pr_b, updated_at');

    // Newest league first — buildLast300Map uses list order as the tiebreak for
    // matches with no timestamp, and the browser's loadVisibleLeagues is
    // newest-first.
    const ordered = [...pool].sort((a, b) => String(b.id).localeCompare(String(a.id)));
    const matchesByLeague = new Map(ordered.map(l => [l.id, []]));
    for (const r of rows) {
        if (!byId.has(r.league_id)) continue;
        matchesByLeague.get(r.league_id).push({
            playerA: r.player_a, playerB: r.player_b,
            prA: r.pr_a, prB: r.pr_b, updatedAt: r.updated_at,
        });
    }

    const leagues = ordered.map(l => ({
        id: l.id,
        matches: matchesByLeague.get(l.id) || [],
        params: { MatchLength: l.match_length || 7 },
    }));

    // The window is defined over players who have a rated match, which is
    // exactly this row set — so the names come from it rather than from a
    // separately-built roster that could disagree with it.
    const names = new Set();
    for (const l of leagues) for (const m of l.matches) { names.add(m.playerA); names.add(m.playerB); }
    names.delete('Bye');
    return buildLast300Map(names, leagues);
}

/** PostgREST caps a response; page until the table is exhausted. */
async function readAllRows(table, columns) {
    const PAGE = 1000;
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from(table).select(columns)
            .order('league_id').order('player_a').order('player_b')
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`could not read ${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < PAGE) return out;
    }
}

async function projectLeague(leagueId, last300Map) {
    const [{ data: leagueRow }, { data: matchRows }, { data: overrideRows }, { data: historyRows }, { data: prev }] =
        await Promise.all([
            supabase.from('leagues').select('*').eq('id', leagueId).single(),
            supabase.from('matches').select('*').eq('league_id', leagueId),
            supabase.from('manual_overrides').select('*').eq('league_id', leagueId),
            supabase.from('match_history').select('*').eq('league_id', leagueId),
            supabase.from('league_projections').select('roster, points').eq('league_id', leagueId).maybeSingle(),
        ]);

    if (!leagueRow) { console.log(`  ! ${leagueId}: no such league, skipping`); return null; }

    const overrides = (overrideRows || []).map(mapOverride);
    const allMatchesIncUnplayed = applyOverridesToAll((matchRows || []).map(mapMatch), overrides);
    const history = { matches: (historyRows || []).map(mapHistory) };
    const timeline = buildMatchTimeline(history, overrides, allMatchesIncUnplayed);
    const orderedPoints = withInitialPoint([...getUpdatePoints(timeline, leagueRow.retired_players)].reverse());

    // Length 1 means INITIAL only — a league whose first match has not been
    // recorded. Nothing to plot, so nothing to store.
    if (orderedPoints.length <= 1) {
        console.log(`  · ${leagueId}: no update points, nothing to project`);
        return { leagueId, roster: [], points: [], skipped: true };
    }

    const allPlayers = new Set();
    for (const m of allMatchesIncUnplayed) { allPlayers.add(m.playerA); allPlayers.add(m.playerB); }

    const params = {
        MatchLength: leagueRow.match_length || 7,
        LeagueType: leagueRow.league_type || 'doubling',
    };
    const t0 = Date.now();
    let lastLog = 0;
    const result = buildLeagueProjection({
        orderedPoints, timeline, allMatchesIncUnplayed, allPlayers,
        matchLength: params.MatchLength,
        leagueConfig: getLeagueConfig(params),
        last300Map,
        settings: {
            matchLength: params.MatchLength,
            leagueType: params.LeagueType,
            retiredPlayers: leagueRow.retired_players || [],
        },
        previousRoster: prev?.roster || [],
        // Everything already computed, keyed by hash inside. Points whose inputs
        // have not changed are carried over untouched instead of re-simulated.
        previousPoints: prev?.points || [],
        depth: DEPTH,
        iterations: ITERATIONS,
        onPoint: (i, total) => {
            if (Date.now() - lastLog > 10_000 || i === total) {
                console.log(`    ${leagueId}: ${i}/${total} points (${Math.round((Date.now() - t0) / 1000)}s)`);
                lastLog = Date.now();
            }
        },
    });
    return { leagueId, ...result, seconds: Math.round((Date.now() - t0) / 1000) };
}

/** Mirrors js/render/dashboardPage.js applyOverridesToAll — overrides on the with-unplayed set. */
function applyOverridesToAll(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;
    const played = applyOverrides(matches.filter(m => m.played), overrides);
    const byKey = new Map(played.map(m => [[m.playerA, m.playerB].sort().join('|'), m]));
    const out = [];
    const seen = new Set();
    for (const m of matches) {
        const k = [m.playerA, m.playerB].sort().join('|');
        const ov = overrides.find(o => [o.playerA, o.playerB].sort().join('|') === k);
        if (ov && ov.type === 'not_played') { out.push({ ...m, played: false, scoreA: null, scoreB: null }); seen.add(k); continue; }
        const merged = byKey.get(k);
        out.push(merged ? { ...m, ...merged, played: true } : m);
        seen.add(k);
    }
    // A technical result on a fixture that has no matches row at all.
    for (const m of played) {
        const k = [m.playerA, m.playerB].sort().join('|');
        if (!seen.has(k)) out.push({ ...m, played: true, round: m.round || 1 });
    }
    return out;
}

async function main() {
    let leagues;
    if (value('--league')) {
        leagues = [value('--league')];
    } else if (flag('--all')) {
        // NEWEST LEAGUE FIRST. Each league is written the moment it finishes, so
        // this is not merely tidy - it decides who waits. A backfill takes the
        // better part of an hour, and for every minute of it the leagues already
        // done are serving instantly while the rest still compute in the
        // visitor's browser. The running season is what people open; it should
        // not be waiting behind September 2025.
        //
        // `issue_date`, not `id`: sorting the names alphabetically puts April
        // before August before December, which is not a chronology at all.
        const { data } = await supabase.from('leagues')
            .select('id').order('issue_date', { ascending: false }).order('id');
        leagues = (data || []).map(r => r.id);
    } else {
        const { data, error } = await supabase.rpc('claim_projection_work', { p_limit: 10 });
        if (error) throw new Error(`claim_projection_work failed: ${error.message}`);
        leagues = (data || []).map(r => r.out_league_id || r.league_id || r);
    }

    if (leagues.length === 0) { console.log('Nothing queued — done.'); return; }
    console.log(`→ Projecting ${leagues.length} league(s): ${leagues.join(', ')}`);
    console.log(`  iterations=${ITERATIONS}  depth=${DEPTH === Infinity ? 'full' : DEPTH}${DRY_RUN ? '  (DRY RUN)' : ''}`);

    const last300Map = await loadLast300Map();
    console.log(`  Last-300 PR window: ${last300Map.size} players`);

    for (const leagueId of leagues) {
        const res = await projectLeague(leagueId, last300Map);
        if (!res || res.skipped) continue;
        const payload = {
            league_id: leagueId,
            roster: res.roster,
            points: res.points,
            iterations: res.iterations,
            computed_at: new Date().toISOString(),
        };
        const bytes = JSON.stringify(payload.points).length;
        console.log(`  ✓ ${leagueId}: ${res.points.length} points (${res.computed} computed, ${res.reused} reused), `
            + `${res.roster.length} players, ${Math.round(bytes / 1024)} KB raw, ${res.seconds}s`);
        if (DRY_RUN) continue;
        await withRetry(`upsert ${leagueId}`, () =>
            supabase.from('league_projections').upsert(payload, { onConflict: 'league_id' }));
        // Only now is the work done. The queue entry survives a failed run on
        // purpose: a crash must leave the league outstanding, not silently
        // drop it. (A claim also expires after 30 minutes, so a job that dies
        // without reaching this line does not strand its league either.)
        await withRetry(`complete ${leagueId}`, () =>
            supabase.rpc('complete_projection_work', { p_league_id: leagueId }));
    }
    console.log('Done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
