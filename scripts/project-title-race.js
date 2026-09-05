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
import { buildLeagueProjection } from '../shabi-israel/js/compute/topXTimeline.js';
import { getLeagueConfig } from '../shabi-israel/js/compute/leagueTypes.js';
import { applyOverrides } from '../shabi-israel/js/data/applyOverrides.js';

const ITERATIONS = 50_000;
const DEPTH = 10;

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
 * The Last-300 PR window the simulator draws player strength from.
 *
 * Deliberately computed here from every non-REGULAR league rather than imported
 * from js/compute/crossLeague.js: that module is built around the browser's
 * cached site bundle. The RULE it implements is what matters and is reproduced —
 * the most recent 300 rated matches per player, pooled across doubling + UBC.
 */
async function buildLast300Map() {
    const { data: leagues, error: le } = await supabase.from('leagues').select('id, league_type');
    if (le) throw new Error(`could not read leagues: ${le.message}`);
    const rated = new Set(leagues.filter(l => (l.league_type || 'doubling') !== 'regular').map(l => l.id));

    const { data: rows, error } = await supabase
        .from('match_history')
        .select('league_id, player_a, player_b, pr_a, pr_b, updated_at')
        .order('updated_at', { ascending: false });
    if (error) throw new Error(`could not read match_history: ${error.message}`);

    const byPlayer = new Map();
    for (const r of rows || []) {
        if (!rated.has(r.league_id)) continue;
        for (const [name, pr] of [[r.player_a, r.pr_a], [r.player_b, r.pr_b]]) {
            if (pr == null) continue;
            if (!byPlayer.has(name)) byPlayer.set(name, []);
            const arr = byPlayer.get(name);
            if (arr.length < 300) arr.push(Number(pr));
        }
    }
    const out = new Map();
    for (const [name, prs] of byPlayer) {
        if (prs.length === 0) continue;
        const mean = prs.reduce((a, b) => a + b, 0) / prs.length;
        const varc = prs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, prs.length - 1);
        out.set(name, { mean, std: Math.sqrt(varc) });
    }
    return out;
}

async function projectLeague(leagueId, last300Map) {
    const [{ data: leagueRow }, { data: matchRows }, { data: overrideRows }, { data: historyRows }, { data: prev }] =
        await Promise.all([
            supabase.from('leagues').select('*').eq('id', leagueId).single(),
            supabase.from('matches').select('*').eq('league_id', leagueId),
            supabase.from('manual_overrides').select('*').eq('league_id', leagueId),
            supabase.from('match_history').select('*').eq('league_id', leagueId),
            supabase.from('league_projections').select('roster').eq('league_id', leagueId).maybeSingle(),
        ]);

    if (!leagueRow) { console.log(`  ! ${leagueId}: no such league, skipping`); return null; }

    const overrides = (overrideRows || []).map(mapOverride);
    const allMatchesIncUnplayed = applyOverridesToAll((matchRows || []).map(mapMatch), overrides);
    const history = { matches: (historyRows || []).map(mapHistory) };
    const timeline = buildMatchTimeline(history, overrides, allMatchesIncUnplayed);
    const orderedPoints = [...getUpdatePoints(timeline)].reverse();

    if (orderedPoints.length === 0) {
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
        previousRoster: prev?.roster || [],
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
        const { data } = await supabase.from('leagues').select('id').order('id');
        leagues = (data || []).map(r => r.id);
    } else {
        const { data, error } = await supabase.rpc('claim_projection_work', { p_limit: 10 });
        if (error) throw new Error(`claim_projection_work failed: ${error.message}`);
        leagues = (data || []).map(r => r.out_league_id || r.league_id || r);
    }

    if (leagues.length === 0) { console.log('Nothing queued — done.'); return; }
    console.log(`→ Projecting ${leagues.length} league(s): ${leagues.join(', ')}`);
    console.log(`  iterations=${ITERATIONS}  depth=${DEPTH}${DRY_RUN ? '  (DRY RUN)' : ''}`);

    const last300Map = await buildLast300Map();
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
        console.log(`  ✓ ${leagueId}: ${res.points.length} points, ${res.roster.length} players, ${Math.round(bytes / 1024)} KB raw, ${res.seconds}s`);
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
