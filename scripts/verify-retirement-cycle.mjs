#!/usr/bin/env node
/**
 * retire-cycle.mjs — retire a player who has already PLAYED X matches, measure
 * every derivative, then un-retire and check what actually comes back.
 *
 * Runs against the LOCAL Docker Supabase only. Takes a full backup of the
 * league's three tables first and restores it at the end, so the local snapshot
 * is left exactly as it was found whatever the experiment shows.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { applyOverrides } from '../shabi-israel/js/data/applyOverrides.js';
import { buildMatchTimeline, mergeHistoryIntoMatches, getUpdatePoints, matchKey }
    from '../shabi-israel/js/compute/matchHistory.js';
import { scheduleFingerprint } from '../shabi-israel/js/compute/topXTimeline.js';
import { rankLeague } from '../shabi-israel/js/compute/rankings.js';
import { getLeagueConfig } from '../shabi-israel/js/compute/leagueTypes.js';
import { computeMatchHistoryReconcile } from '../shabi-israel/js/data/matchHistoryReconcile.js';
import { stampFromHistoryRow } from '../shabi-israel/js/utils/matchTime.js';

const LEAGUE = 'September 2026';
const PLAYER = 'YossiEliezer23';
const DB = 'supabase_db_supabase-migration';
const URL = 'http://127.0.0.1:54321';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const BACKUP_PATH = process.env.SCRATCH ? process.env.SCRATCH + '/retirement-cycle-backup.json' : 'retirement-cycle-backup.json';
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const q = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], { encoding: 'utf8' });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function load() {
    const [{ data: mr }, { data: or }, { data: hr }, { data: lr }] = await Promise.all([
        supabase.from('matches').select('*').eq('league_id', LEAGUE),
        supabase.from('manual_overrides').select('*').eq('league_id', LEAGUE),
        supabase.from('match_history').select('*').eq('league_id', LEAGUE),
        supabase.from('leagues').select('*').eq('id', LEAGUE).single(),
    ]);
    const raw = mr.map(m => ({
        id: m.id, playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
        prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b, round: m.round, played: m.played,
    }));
    const ov = or.map(o => ({
        type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
        scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b,
        luckA: o.luck_a, luckB: o.luck_b, timestamp: o.edited_at || undefined,
    }));
    const hist = { matches: hr.map(h => ({
        playerA: h.player_a, playerB: h.player_b, scoreA: h.score_a, scoreB: h.score_b,
        prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b,
        round: h.round, updatedAt: stampFromHistoryRow(h), source: h.source,
    })) };
    return { raw, ov, hist, rawRows: { mr, or, hr }, leagueRow: lr };
}

/** Every derivative the question is about, from the real modules. */
function derive({ raw, ov, hist, leagueRow }) {
    const allInc = raw.map(m => {
        const o = ov.find(x => matchKey(x.playerA, x.playerB) === matchKey(m.playerA, m.playerB));
        if (o && (o.type === 'cancelled' || o.type === 'not_played')) {
            return { ...m, played: false, scoreA: null, scoreB: null, prA: null, prB: null,
                     luckA: null, luckB: null, _overridden: true,
                     _cancelled: o.type === 'cancelled' || undefined };
        }
        return m;
    });
    const timeline = buildMatchTimeline(hist, ov, allInc);
    const live = mergeHistoryIntoMatches(applyOverrides(raw.filter(m => m.played), ov), timeline);
    const points = getUpdatePoints(timeline);
    const roster = new Set();
    for (const m of allInc) { if (m._cancelled) continue; roster.add(m.playerA); roster.add(m.playerB); }
    const config = getLeagueConfig({ LeagueType: leagueRow.league_type || 'doubling',
                                     MatchLength: leagueRow.match_length || 7 });
    const { rankings } = rankLeague({ matches: live, allPlayers: roster, config });
    return {
        fixtures: raw.length,
        history: hist.matches.length,
        cancelled: ov.filter(o => o.type === 'cancelled').length,
        timeline: timeline.length,
        points: points.length,
        remaining: allInc.filter(m => !m.played && !m._cancelled).length,
        roster: roster.size,
        fingerprint: scheduleFingerprint(allInc, {
            matchLength: leagueRow.match_length || 7,
            leagueType: leagueRow.league_type || 'doubling' }),
        wins: new Map(rankings.map(r => [r.player, `${r.games}/${r.wins}`])),
        // the identity of every point, in order — what Title Race plots along X
        pointValues: points.map(p => p.value),
    };
}

const fmt = (s) => `fixtures ${s.fixtures}  history ${String(s.history).padStart(3)}  cancelled ${String(s.cancelled).padStart(2)}  ` +
    `timeline ${String(s.timeline).padStart(3)}  points ${String(s.points).padStart(3)}  remaining ${String(s.remaining).padStart(3)}  ` +
    `roster ${s.roster}  fp ${s.fingerprint}`;

async function main() {
    // ── Backup ──────────────────────────────────────────────────────────────
    const backup = await load();
    writeFileSync(BACKUP_PATH, JSON.stringify(backup.rawRows), 'utf8');
    console.log(`Backed up ${LEAGUE}: ${backup.rawRows.mr.length} fixtures, ` +
        `${backup.rawRows.hr.length} history rows, ${backup.rawRows.or.length} overrides.\n`);

    const before = derive(backup);
    const myFixtures = backup.raw.filter(m => m.playerA === PLAYER || m.playerB === PLAYER);
    const myPlayed = myFixtures.filter(m => m.played);
    const myHistory = backup.hist.matches.filter(h => h.playerA === PLAYER || h.playerB === PLAYER);
    console.log(`${PLAYER}: ${myFixtures.length} fixtures, X = ${myPlayed.length} PLAYED, ` +
        `${myFixtures.length - myPlayed.length} still ahead, ${myHistory.length} history rows.`);
    console.log(`  their recorded dates: ${myHistory.map(h => String(h.updatedAt).slice(0, 10)).sort()
        .filter((v, i, a) => a.indexOf(v) === i).join(', ')}\n`);

    console.log('── BEFORE ──────────────────────────────────────────────────────────');
    console.log(fmt(before));

    // ── RETIRE ──────────────────────────────────────────────────────────────
    q(`begin;
       update leagues set retired_players = coalesce(retired_players,'[]'::jsonb) || ${lit(JSON.stringify([PLAYER]))}::jsonb
        where id = ${lit(LEAGUE)} and not jsonb_exists(coalesce(retired_players,'[]'::jsonb), ${lit(PLAYER)});
       insert into manual_overrides (league_id, player_a, player_b, type, reason, edited_at)
       select ${lit(LEAGUE)}, m.player_a, m.player_b, 'cancelled', ${lit('Cancelled — retired: ' + PLAYER)}, now()
         from matches m where m.league_id = ${lit(LEAGUE)}
          and (m.player_a = ${lit(PLAYER)} or m.player_b = ${lit(PLAYER)})
       on conflict (league_id, player_a, player_b) do update
          set type='cancelled', winner=null, score_a=null, score_b=null,
              pr_a=null, pr_b=null, luck_a=null, luck_b=null;
       delete from match_history h using manual_overrides o
        where o.league_id=h.league_id and o.type='cancelled' and o.league_id=${lit(LEAGUE)}
          and least(h.player_a,h.player_b)=least(o.player_a,o.player_b)
          and greatest(h.player_a,h.player_b)=greatest(o.player_a,o.player_b);
       commit;`);

    const afterRetire = derive(await load());
    console.log('\n── AFTER RETIRE ────────────────────────────────────────────────────');
    console.log(fmt(afterRetire));
    console.log(`  Δ history  ${before.history} → ${afterRetire.history}   (${afterRetire.history - before.history})`);
    console.log(`  Δ points   ${before.points} → ${afterRetire.points}   (${afterRetire.points - before.points})`);
    console.log(`  Δ remaining ${before.remaining} → ${afterRetire.remaining}  (${afterRetire.remaining - before.remaining})`);
    console.log(`  Δ roster   ${before.roster} → ${afterRetire.roster}`);
    console.log(`  fingerprint changed: ${before.fingerprint !== afterRetire.fingerprint}`);
    const stillPointsForPlayer = afterRetire.pointValues.length;
    console.log(`  ${PLAYER} present in the ranking after retiring: ${afterRetire.wins.has(PLAYER)}`);
    let lostWins = 0;
    for (const [p, v] of before.wins) {
        const a = afterRetire.wins.get(p);
        if (a && a !== v) lostWins++;
    }
    console.log(`  opponents whose record changed: ${lostWins}`);

    // ── UN-RETIRE — exactly what deleting the overrides does ────────────────
    q(`begin;
       delete from manual_overrides where league_id=${lit(LEAGUE)} and type='cancelled';
       update leagues set retired_players = coalesce(retired_players,'[]'::jsonb) - ${lit(PLAYER)}
        where id = ${lit(LEAGUE)};
       commit;`);

    // The admin publish would now reconcile match_history. Run the REAL module.
    const mid = await load();
    const rec = computeMatchHistoryReconcile({
        matchRows: mid.rawRows.mr.filter(m => m.played),
        overrideRows: mid.rawRows.or,
        historyRows: mid.rawRows.hr,
        leagueId: LEAGUE,
        now: new Date().toISOString(),
    });
    console.log(`\n  reconcile: ${rec.upsertRows.length} upserts, ${rec.staleIds.length} deletes` +
        `${rec.skipped ? ` (SKIPPED: ${rec.reason})` : ''}`);
    for (const r of rec.upsertRows) {
        q(`insert into match_history (league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, source, updated_at)
           values (${lit(LEAGUE)}, ${lit(r.player_a)}, ${lit(r.player_b)},
                   ${r.score_a ?? 'null'}, ${r.score_b ?? 'null'}, ${r.pr_a ?? 'null'}, ${r.pr_b ?? 'null'},
                   ${r.luck_a ?? 'null'}, ${r.luck_b ?? 'null'}, ${r.round ?? 'null'},
                   ${lit(r.source)}, ${lit(r.updated_at)})
           on conflict (league_id, player_a, player_b) do update
              set score_a=excluded.score_a, score_b=excluded.score_b,
                  pr_a=excluded.pr_a, pr_b=excluded.pr_b,
                  luck_a=excluded.luck_a, luck_b=excluded.luck_b,
                  round=excluded.round, source=excluded.source, updated_at=excluded.updated_at;`);
    }

    const restored = await load();
    const after = derive(restored);
    console.log('\n── AFTER UN-RETIRE ─────────────────────────────────────────────────');
    console.log(fmt(after));

    // ── The comparison that matters ─────────────────────────────────────────
    console.log('\n── RESTORATION CHECK ───────────────────────────────────────────────');
    const cmp = (label, a, b) => console.log(`  ${a === b ? 'OK  ' : 'DIFF'}  ${label.padEnd(26)} ${a}  vs  ${b}`);
    cmp('history rows', before.history, after.history);
    cmp('timeline rows', before.timeline, after.timeline);
    cmp('update points', before.points, after.points);
    cmp('remaining fixtures', before.remaining, after.remaining);
    cmp('roster', before.roster, after.roster);
    cmp('schedule fingerprint', before.fingerprint, after.fingerprint);

    let recordsDiff = 0;
    for (const [p, v] of before.wins) if (after.wins.get(p) !== v) recordsDiff++;
    cmp('player records restored', 0, recordsDiff);

    // Results vs dates, separately — this is the whole question.
    const beforeByKey = new Map(backup.hist.matches.map(h => [matchKey(h.playerA, h.playerB), h]));
    const afterByKey = new Map(restored.hist.matches.map(h => [matchKey(h.playerA, h.playerB), h]));
    let resultsSame = 0, resultsDiff = 0, datesSame = 0, datesDiff = 0;
    const dateExamples = [];
    for (const [k, b] of beforeByKey) {
        const a = afterByKey.get(k);
        if (!a) { resultsDiff++; datesDiff++; continue; }
        if (Number(a.scoreA) === Number(b.scoreA) && Number(a.scoreB) === Number(b.scoreB)
            && Number(a.prA) === Number(b.prA) && Number(a.prB) === Number(b.prB)) resultsSame++; else resultsDiff++;
        if (String(a.updatedAt) === String(b.updatedAt)) datesSame++;
        else { datesDiff++; if (dateExamples.length < 4) dateExamples.push(
            `${b.playerA} v ${b.playerB}:  ${String(b.updatedAt).slice(0,19)}  →  ${String(a.updatedAt).slice(0,19)}`); }
    }
    console.log(`\n  RESULTS (score + PR):  ${resultsSame} identical, ${resultsDiff} changed`);
    console.log(`  DATES  (updated_at) :  ${datesSame} identical, ${datesDiff} changed`);
    if (dateExamples.length) { console.log('  changed dates, examples:'); dateExamples.forEach(e => console.log('    ' + e)); }

    const pv = JSON.stringify(before.pointValues) === JSON.stringify(after.pointValues);
    console.log(`\n  Title Race X axis (the ordered point list) identical: ${pv}`);

    // ── Restore the snapshot exactly ────────────────────────────────────────
    const b = JSON.parse(readFileSync(BACKUP_PATH, 'utf8'));
    q(`begin;
       delete from match_history where league_id=${lit(LEAGUE)};
       delete from manual_overrides where league_id=${lit(LEAGUE)};
       update leagues set retired_players='[]'::jsonb where id=${lit(LEAGUE)};
       commit;`);
    for (const h of b.hr) {
        q(`insert into match_history (league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, source, updated_at)
           values (${lit(LEAGUE)}, ${lit(h.player_a)}, ${lit(h.player_b)}, ${h.score_a ?? 'null'}, ${h.score_b ?? 'null'},
                   ${h.pr_a ?? 'null'}, ${h.pr_b ?? 'null'}, ${h.luck_a ?? 'null'}, ${h.luck_b ?? 'null'},
                   ${h.round ?? 'null'}, ${lit(h.source)}, ${lit(h.updated_at)});`);
    }
    const final = derive(await load());
    console.log(`\n  snapshot restored: history ${final.history}, points ${final.points}, fp ${final.fingerprint} ` +
        `(matches original: ${final.fingerprint === before.fingerprint && final.points === before.points})`);
}

main().catch(e => { console.error(e); process.exit(1); });
