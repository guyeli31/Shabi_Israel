#!/usr/bin/env node
/**
 * audit-retirement-data.mjs — a census of how retirement is actually recorded,
 * across EVERY league, before any of it is normalised.
 *
 * WHY A CENSUS AND NOT A FIX
 * Retirement was entered four different ways while the project was finding its
 * feet: `technical_win` overrides, hand-typed 1-0 history rows with no override
 * at all, deleted fixtures leaving orphan history rows, and real results played
 * before the player walked away. Each looks reasonable in isolation. A migration
 * written against the shape one league happens to have will silently mis-handle
 * the other three, so the shapes get counted first.
 *
 * WHAT COUNTS AS "TECHNICAL" HERE
 * Null PR on either side — the same test js/compute/stats.js applies when it
 * decides whether a match enters the PR and luck averages. Deliberately NOT the
 * presence of a `technical_win` override: July 2026 has 24 technical results and
 * zero override rows, so the override marker undercounts by a whole league.
 *
 * THE THREE QUESTIONS IT ANSWERS
 *   1. Per league: who is flagged retired, how many REAL matches they played,
 *      and how every other match of theirs is recorded.
 *   2. Which NOT-retired players carry technical results, and how many.
 *   3. Which NOT-retired players carry enough technical losses that the retired
 *      flag looks simply forgotten (default: 3 or more, --threshold to change).
 *
 * Writes nothing, anywhere.
 *
 * Usage:
 *   node scripts/audit-retirement-data.mjs
 *   node scripts/audit-retirement-data.mjs --local
 *   node scripts/audit-retirement-data.mjs --threshold 2
 */

import { createClient } from '@supabase/supabase-js';
import { applyOverrides } from '../shabi-israel/js/data/applyOverrides.js';
import { buildMatchTimeline, mergeHistoryIntoMatches, matchKey } from '../shabi-israel/js/compute/matchHistory.js';
import { stampFromHistoryRow } from '../shabi-israel/js/utils/matchTime.js';
import {
    SUPABASE_URL, SUPABASE_ANON_KEY,
    LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY,
} from '../shabi-israel/js/data/supabaseConfig.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const useLocal = flag('--local');
const url = useLocal ? LOCAL_SUPABASE_URL : SUPABASE_URL;
const key = useLocal ? LOCAL_SUPABASE_ANON_KEY : SUPABASE_ANON_KEY;
// "More than 2" in the brief — a player with three or more technical losses did
// not simply miss a night. One or two is an ordinary no-show and is reported
// separately rather than as a suspected missing flag.
const THRESHOLD = Number(value('--threshold') || 3);

const supabase = createClient(url, key, { auth: { persistSession: false } });

const mapMatchAll = (m) => ({
    id: m.id, playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
    prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b, round: m.round, played: m.played,
});
const mapHistory = (h) => ({
    playerA: h.player_a, playerB: h.player_b, scoreA: h.score_a, scoreB: h.score_b,
    prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b,
    round: h.round, updatedAt: stampFromHistoryRow(h), source: h.source,
});
const mapOverride = (o) => ({
    type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
    scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b,
    luckA: o.luck_a, luckB: o.luck_b, timestamp: o.edited_at || undefined,
});

async function readAll(table, columns) {
    const PAGE = 1000;
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(table).select(columns)
            .order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw new Error(`could not read ${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < PAGE) return out;
    }
}

const isTechnical = (m) => m._technical === true || m._draw === true
    || m.prA === null || m.prA === undefined || m.prB === null || m.prB === undefined;

const by = (arr, fn) => { const m = new Map(); for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

function auditLeague(leagueRow, rows) {
    const id = leagueRow.id;
    const retired = new Set(leagueRow.retired_players || []);

    const matchRows = rows.matches.filter(m => m.league_id === id).map(mapMatchAll);
    const overrides = rows.overrides.filter(o => o.league_id === id).map(mapOverride);
    const historyRows = rows.history.filter(h => h.league_id === id).map(mapHistory);

    // The site's own view, so the census counts what a visitor actually sees.
    const played = matchRows.filter(m => m.played);
    const timeline = buildMatchTimeline({ matches: historyRows }, overrides);
    const merged = mergeHistoryIntoMatches(applyOverrides(played, overrides), timeline);

    const fixtureByKey = new Map(matchRows.map(m => [matchKey(m.playerA, m.playerB), m]));
    const historyByKey = new Map(historyRows.map(h => [matchKey(h.playerA, h.playerB), h]));
    const overrideByKey = new Map(overrides.map(o => [matchKey(o.playerA, o.playerB), o]));

    // How is each technical result RECORDED? Four shapes seen in production.
    const provenance = (m) => {
        const k = matchKey(m.playerA, m.playerB);
        const o = overrideByKey.get(k);
        const fx = fixtureByKey.get(k);
        const h = historyByKey.get(k);
        if (o && (o.type === 'technical_win' || o.type === 'technical_draw')) {
            return fx ? 'override' : 'override, fixture DELETED';
        }
        if (!fx) return 'history row only, NO fixture';
        if (h && (h.prA === null || h.prB === null)) {
            // The fixture still carries numbers the history row has nulled out.
            const typed = fx.prA !== null && fx.prB !== null;
            return typed ? `typed into history (matches still holds pr=${fx.prA}/${fx.prB})` : 'typed into history';
        }
        return 'unclassified';
    };

    // Per-player tallies over the merged (rendered) view.
    const players = new Set();
    for (const m of matchRows) { players.add(m.playerA); players.add(m.playerB); }
    const tally = new Map([...players].map(p => [p, {
        player: p, retired: retired.has(p),
        real: 0, technical: 0, techLoss: 0, techWin: 0, techDraw: 0, fixtures: 0,
    }]));
    for (const m of matchRows) {
        for (const p of [m.playerA, m.playerB]) if (tally.has(p)) tally.get(p).fixtures++;
    }
    const shapes = new Map();
    for (const m of merged) {
        const tech = isTechnical(m);
        for (const p of [m.playerA, m.playerB]) {
            const t = tally.get(p);
            if (!t) continue;
            if (!tech) { t.real++; continue; }
            t.technical++;
            const self = m.playerA === p ? m.scoreA : m.scoreB;
            const opp = m.playerA === p ? m.scoreB : m.scoreA;
            if (m._draw || self === opp) t.techDraw++;
            else if (self > opp) t.techWin++;
            else t.techLoss++;
        }
        if (tech) { const s = provenance(m); shapes.set(s, (shapes.get(s) || 0) + 1); }
    }

    const orphanHistory = historyRows.filter(h => !fixtureByKey.has(matchKey(h.playerA, h.playerB)));
    // A fixture carrying pr=0 on BOTH sides is not a played game: PR 0.00 is a
    // perfect game, so this is "no data" written as a number.
    const zeroPrFixtures = matchRows.filter(m => m.played && m.prA === 0 && m.prB === 0);
    const flaggedButAbsent = [...retired].filter(p => !players.has(p));

    return {
        id, type: leagueRow.league_type || 'doubling',
        hidden: !!leagueRow.hidden, archived: !!leagueRow.archived,
        retired: [...retired],
        counts: {
            fixtures: matchRows.length, played: played.length,
            history: historyRows.length, orphanHistory: orphanHistory.length,
            zeroPrFixtures: zeroPrFixtures.length,
            overrides: overrides.length,
            overrideTypes: [...by(overrides, o => o.type)].map(([k, v]) => `${k}=${v.length}`).join(' '),
        },
        shapes: [...shapes].sort((a, b) => b[1] - a[1]),
        flaggedButAbsent,
        tally: [...tally.values()],
    };
}

function main2(results) {
    // ── 1. Leagues carrying a retired player ───────────────────────────────
    console.log('\n' + '='.repeat(100));
    console.log('1.  LEAGUES WITH A RETIRED PLAYER — real matches played, and how the rest is recorded');
    console.log('='.repeat(100));
    const withRetired = results.filter(r => r.retired.length);
    if (!withRetired.length) console.log('  none');
    for (const r of withRetired) {
        console.log(`\n${r.id}   [${r.type}]${r.hidden ? '  HIDDEN' : ''}${r.archived ? '  ARCHIVED' : ''}`);
        console.log(`  fixtures ${r.counts.fixtures} (played ${r.counts.played})   history ${r.counts.history}   ` +
            `orphan history ${r.counts.orphanHistory}   overrides: ${r.counts.overrideTypes || 'none'}`);
        for (const p of r.retired) {
            const t = r.tally.find(x => x.player === p);
            if (!t) { console.log(`  ${pad(p, 18)} FLAGGED RETIRED BUT HAS NO MATCH IN THIS LEAGUE`); continue; }
            console.log(`  ${pad(p, 18)} fixtures ${String(t.fixtures).padStart(2)}   ` +
                `REAL ${String(t.real).padStart(2)}   technical ${String(t.technical).padStart(2)} ` +
                `(losses ${t.techLoss}, wins ${t.techWin}, draws ${t.techDraw})`);
        }
        console.log(`  how the technical results are recorded:`);
        for (const [shape, n] of r.shapes) console.log(`     ${String(n).padStart(3)} × ${shape}`);
        if (r.counts.zeroPrFixtures) console.log(`  !! ${r.counts.zeroPrFixtures} fixture rows carry pr=0/0 in \`matches\` (0.00 is a PERFECT game, not "no data")`);
        if (r.flaggedButAbsent.length) console.log(`  !! flagged retired but never appears: ${r.flaggedButAbsent.join(', ')}`);
    }

    // ── 2. Technical results belonging to players NOT flagged retired ──────
    console.log('\n' + '='.repeat(100));
    console.log('2.  TECHNICAL RESULTS AGAINST PLAYERS WHO ARE *NOT* FLAGGED RETIRED');
    console.log('='.repeat(100));
    const strays = [];
    for (const r of results) {
        for (const t of r.tally) {
            if (t.retired || t.technical === 0) continue;
            strays.push({ league: r.id, ...t });
        }
    }
    if (!strays.length) console.log('  none');
    else {
        strays.sort((a, b) => b.techLoss - a.techLoss || a.league.localeCompare(b.league));
        console.log(`  ${pad('League', 22)} ${pad('Player', 18)} fixtures  real  tech  tLoss  tWin  tDraw`);
        for (const s of strays) {
            console.log(`  ${pad(s.league, 22)} ${pad(s.player, 18)} ${String(s.fixtures).padStart(6)} ` +
                `${String(s.real).padStart(6)} ${String(s.technical).padStart(5)} ` +
                `${String(s.techLoss).padStart(5)} ${String(s.techWin).padStart(5)} ${String(s.techDraw).padStart(6)}`);
        }
    }

    // ── 3. Suspected missing retired flag ──────────────────────────────────
    console.log('\n' + '='.repeat(100));
    console.log(`3.  SUSPECTED MISSING "RETIRED" FLAG — not flagged, but ${THRESHOLD}+ technical LOSSES in one league`);
    console.log('='.repeat(100));
    const suspects = strays.filter(s => s.techLoss >= THRESHOLD);
    if (!suspects.length) console.log(`  none — no unflagged player reaches ${THRESHOLD} technical losses.`);
    for (const s of suspects) {
        console.log(`  ${pad(s.league, 22)} ${pad(s.player, 18)} ${s.techLoss} technical losses out of ${s.fixtures} fixtures ` +
            `(${s.real} real) — retired flag likely missing`);
    }

    // ── 4. Data shapes worth knowing about, league-wide ────────────────────
    console.log('\n' + '='.repeat(100));
    console.log('4.  LEAGUE-WIDE INTEGRITY (all leagues, retirement or not)');
    console.log('='.repeat(100));
    console.log(`  ${pad('League', 22)} fixtures  history  orphan  pr=0 rows  retired`);
    for (const r of results) {
        const notable = r.counts.orphanHistory || r.counts.zeroPrFixtures || r.retired.length;
        if (!notable) continue;
        console.log(`  ${pad(r.id, 22)} ${String(r.counts.fixtures).padStart(8)} ${String(r.counts.history).padStart(8)} ` +
            `${String(r.counts.orphanHistory).padStart(7)} ${String(r.counts.zeroPrFixtures).padStart(10)}   ${r.retired.join(', ') || '—'}`);
    }
    const clean = results.filter(r => !r.counts.orphanHistory && !r.counts.zeroPrFixtures && !r.retired.length);
    console.log(`\n  ${clean.length} further league(s) with no retired player, no orphan history and no pr=0 rows:`);
    console.log(`  ${clean.map(r => r.id).join(', ') || '—'}`);
}

async function main() {
    console.log(`Reading ${useLocal ? 'LOCAL Docker Supabase' : 'CLOUD'} — ${url}`);
    console.log('This script writes nothing. It only reads and counts.');

    const { data: leagueRows, error } = await supabase
        .from('leagues').select('id, league_type, match_length, retired_players, hidden, archived');
    if (error) throw new Error(`could not read leagues: ${error.message}`);

    const [matches, overrides, history] = await Promise.all([
        readAll('matches', 'id, league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, played'),
        readAll('manual_overrides', 'id, league_id, type, player_a, player_b, winner, score_a, score_b, pr_a, pr_b, luck_a, luck_b, edited_at'),
        readAll('match_history', 'id, league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, updated_at, source'),
    ]);
    console.log(`${leagueRows.length} leagues · ${matches.length} fixtures · ${overrides.length} overrides · ${history.length} history rows`);

    const rows = { matches, overrides, history };
    const results = leagueRows
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map(l => auditLeague(l, rows));
    main2(results);
}

main().catch(err => { console.error(err); process.exit(1); });
