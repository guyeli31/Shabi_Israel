#!/usr/bin/env node
/**
 * report-retirement-impact.mjs — a DRY report: what changes if a retired
 * player's matches are CANCELLED rather than recorded as technical wins.
 *
 * WHY THIS EXISTS
 * The agreed retirement policy ("a retired player's matches are cancelled — not
 * a technical loss, they do not exist") is not a display change. Today those
 * fixtures are `technical_win` overrides, i.e. wins already counted for 24
 * opponents; in July 2026 they are not even technical, they are 24 results
 * really played at the board. Cancelling them removes W/L and win rate from
 * everyone the retired player ever faced, and can change a finished league's
 * champion retroactively.
 *
 * So the price is measured BEFORE it is paid. This writes nothing, anywhere.
 *
 * HOW "BEFORE" IS COMPUTED
 * By calling the SAME functions the site calls — js/data/store.js → loadLeague()
 * reproduced step for step (played rows → applyOverrides → buildMatchTimeline →
 * mergeHistoryIntoMatches), then js/compute/rankings.js → rankLeague(). A report
 * that re-implemented the ranking would eventually disagree with the page and
 * nobody would know which half was wrong.
 *
 * HOW "AFTER" IS COMPUTED
 * rankLeague()'s own contract: "every view of a league is just a different match
 * list". The after-view is the same list minus every match involving a retired
 * player, over a roster minus the retired players. Nothing else differs.
 *
 * Usage:
 *   node scripts/report-retirement-impact.mjs              # cloud (anon, read-only)
 *   node scripts/report-retirement-impact.mjs --local      # Docker Supabase
 *   node scripts/report-retirement-impact.mjs --league "April 2026"
 *   node scripts/report-retirement-impact.mjs --md out.md  # also write Markdown
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { applyOverrides } from '../shabi-israel/js/data/applyOverrides.js';
import { buildMatchTimeline, mergeHistoryIntoMatches, matchKey } from '../shabi-israel/js/compute/matchHistory.js';
import { rankLeague } from '../shabi-israel/js/compute/rankings.js';
import { getLeagueConfig } from '../shabi-israel/js/compute/leagueTypes.js';
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
const onlyLeague = value('--league');
const mdPath = value('--md');

const supabase = createClient(url, key, { auth: { persistSession: false } });

// The same row→object readers the browser uses (js/data/bundleMapper.js). The
// history mapper in particular must go through stampFromHistoryRow, or a
// date-only placeholder arrives here as a full instant and the timeline this
// report replays is not the timeline the page replays.
const mapMatchAll = (m) => ({
    id: m.id,
    playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
    prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b,
    round: m.round, played: m.played,
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

/** PostgREST caps a response; page until the table is exhausted. */
async function readAll(table, columns, leagueIds) {
    const PAGE = 1000;
    const out = [];
    for (let from = 0; ; from += PAGE) {
        let q = supabase.from(table).select(columns).order('id', { ascending: true });
        if (leagueIds) q = q.in('league_id', leagueIds);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw new Error(`could not read ${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < PAGE) return out;
    }
}

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const fmtPR = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));

/**
 * Is this match a technical result — i.e. does cancelling it take a REAL win
 * away from someone?
 *
 * The test is NULL PR, not the presence of a `technical_win` override, because
 * the two disagree in production. July 2026's retirement was entered by hand as
 * 7-0 scores with no override row at all: `_technical` is false on every one of
 * them, yet `js/compute/stats.js` — the code that actually builds the table —
 * calls a match technical when either side's PR is null, and keeps those 23 out
 * of every PR and luck average. Classifying by the override marker reported
 * "24 really played results would be cancelled" for a league where the true
 * figure is one.
 */
const isTechnical = (m) => m._technical === true || m.prA === null || m.prA === undefined
    || m.prB === null || m.prB === undefined;

function rankMap(rankings) {
    const m = new Map();
    for (const r of rankings) m.set(r.player, r);
    return m;
}

async function analyseLeague(leagueRow, allRows) {
    const leagueId = leagueRow.id;
    const retired = new Set(leagueRow.retired_players || []);

    const matchRows = allRows.matches.filter(m => m.league_id === leagueId).map(mapMatchAll);
    const overrides = allRows.overrides.filter(o => o.league_id === leagueId).map(mapOverride);
    const historyRows = allRows.history.filter(h => h.league_id === leagueId).map(mapHistory);

    // ── BEFORE: store.js → loadLeague(), step for step ─────────────────────
    const allPlayers = new Set();
    for (const m of matchRows) { allPlayers.add(m.playerA); allPlayers.add(m.playerB); }
    const played = matchRows.filter(m => m.played);
    const withOverrides = applyOverrides(played, overrides);
    const timeline = buildMatchTimeline({ matches: historyRows }, overrides);
    const beforeMatches = mergeHistoryIntoMatches(withOverrides, timeline);

    const config = getLeagueConfig({
        LeagueType: leagueRow.league_type || 'doubling',
        MatchLength: leagueRow.match_length || 7,
    });
    const before = rankLeague({ matches: beforeMatches, allPlayers, config });

    // ── AFTER: the same view, minus every match a retired player is in ─────
    const involvesRetired = (m) => retired.has(m.playerA) || retired.has(m.playerB);
    const cancelled = beforeMatches.filter(involvesRetired);
    const afterMatches = beforeMatches.filter(m => !involvesRetired(m));
    const afterPlayers = new Set([...allPlayers].filter(p => !retired.has(p)));
    const after = rankLeague({ matches: afterMatches, allPlayers: afterPlayers, config });

    // ── Data-integrity diagnostics, independent of the ranking ─────────────
    // The invariant that decides whether the league computes its Predictor in
    // the browser forever: one history row per played fixture, no orphans.
    // See js/render/dashboardPage.js → storedPointPrediction.
    const fixtureKeys = new Set(matchRows.map(m => matchKey(m.playerA, m.playerB)));
    const orphanHistory = historyRows.filter(h => !fixtureKeys.has(matchKey(h.playerA, h.playerB)));
    const retiredFixtures = matchRows.filter(involvesRetired);
    const overrideTypes = {};
    for (const o of overrides) {
        if (!retired.has(o.playerA) && !retired.has(o.playerB)) continue;
        overrideTypes[o.type] = (overrideTypes[o.type] || 0) + 1;
    }

    // ── The delta ──────────────────────────────────────────────────────────
    const beforeBy = rankMap(before.rankings);
    const afterBy = rankMap(after.rankings);
    const rows = [];
    for (const r of after.rankings) {
        const b = beforeBy.get(r.player);
        rows.push({
            player: r.player,
            rankBefore: b ? b.rank : null, rankAfter: r.rank,
            gamesBefore: b ? b.games : 0, gamesAfter: r.games,
            winsBefore: b ? b.wins : 0, winsAfter: r.wins,
            wrBefore: b ? b.winRate : null, wrAfter: r.winRate,
            prBefore: b ? b.meanPR : null, prAfter: r.meanPR,
        });
    }
    rows.sort((a, b) => (a.rankAfter - b.rankAfter));

    const champBefore = before.rankings[0] ? before.rankings[0].player : null;
    const champAfter = after.rankings[0] ? after.rankings[0].player : null;

    return {
        leagueId,
        type: config.type,
        retired: [...retired],
        hidden: !!leagueRow.hidden,
        counts: {
            fixtures: matchRows.length,
            fixturesPlayed: played.length,
            history: historyRows.length,
            orphanHistory: orphanHistory.length,
            retiredFixtures: retiredFixtures.length,
            overrideTypes,
            cancelled: cancelled.length,
            cancelledTechnical: cancelled.filter(isTechnical).length,
            cancelledReal: cancelled.filter(m => !isTechnical(m)).length,
        },
        // Named, because these are the only results anyone actually loses.
        realCancelled: cancelled.filter(m => !isTechnical(m)).map(m => ({
            playerA: m.playerA, playerB: m.playerB, scoreA: m.scoreA, scoreB: m.scoreB,
            prA: m.prA, prB: m.prB, round: m.round,
        })),
        champBefore, champAfter,
        champChanged: champBefore !== champAfter,
        rows,
        movedRank: rows.filter(r => r.rankBefore !== null && r.rankBefore !== r.rankAfter),
        // A player whose own record changes at all — the people who actually
        // lose something. Rank can stay put while the record underneath moves.
        recordChanged: rows.filter(r => r.gamesBefore !== r.gamesAfter),
    };
}

function printLeague(a) {
    const c = a.counts;
    console.log(`\n${'='.repeat(78)}`);
    console.log(`${a.leagueId}   [${a.type}]${a.hidden ? '  (hidden)' : ''}`);
    console.log(`retired: ${a.retired.join(', ') || '—'}`);
    console.log('-'.repeat(78));
    console.log(`fixtures ${c.fixtures} (played ${c.fixturesPlayed})   match_history ${c.history}   orphan history rows ${c.orphanHistory}`);
    console.log(`retired player's fixtures ${c.retiredFixtures}   overrides on them: ${
        Object.keys(c.overrideTypes).length ? Object.entries(c.overrideTypes).map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
    console.log(`to be cancelled: ${c.cancelled}  (technical ${c.cancelledTechnical}, REALLY PLAYED ${c.cancelledReal})`);
    if (a.realCancelled.length) {
        console.log('  the REAL results lost (a genuine win taken off an opponent):');
        for (const m of a.realCancelled) {
            console.log(`    r${String(m.round).padStart(2)}  ${m.playerA} ${m.scoreA}-${m.scoreB} ${m.playerB}` +
                `   PR ${fmtPR(m.prA)} / ${fmtPR(m.prB)}`);
        }
    }
    console.log('-'.repeat(78));
    console.log(`champion  before: ${a.champBefore}   after: ${a.champAfter}   ${a.champChanged ? '***  CHAMPION CHANGES  ***' : '(unchanged)'}`);
    console.log(`players whose record changes: ${a.recordChanged.length}   players whose rank moves: ${a.movedRank.length}`);

    if (a.recordChanged.length) {
        console.log('');
        console.log('  rank        player                games      wins       win rate         mean PR');
        for (const r of a.rows) {
            const moved = r.rankBefore !== r.rankAfter;
            const changed = r.gamesBefore !== r.gamesAfter;
            if (!moved && !changed) continue;
            const rank = `${String(r.rankBefore).padStart(2)} → ${String(r.rankAfter).padStart(2)}${moved ? (r.rankAfter < r.rankBefore ? ' ▲' : ' ▼') : '  '}`;
            console.log(
                `  ${rank}  ${r.player.padEnd(20).slice(0, 20)}  ` +
                `${String(r.gamesBefore).padStart(2)}→${String(r.gamesAfter).padStart(2)}  ` +
                `${String(r.winsBefore).padStart(2)}→${String(r.winsAfter).padStart(2)}   ` +
                `${fmtPct(r.wrBefore).padStart(6)}→${fmtPct(r.wrAfter).padStart(6)}   ` +
                `${fmtPR(r.prBefore).padStart(6)}→${fmtPR(r.prAfter).padStart(6)}`
            );
        }
    }
}

function toMarkdown(results) {
    const out = [];
    out.push('# Retirement policy — impact report (dry run)');
    out.push('');
    out.push(`Source: \`${url}\` · generated ${new Date().toISOString()}`);
    out.push('');
    out.push('"After" = every match involving a retired player cancelled, the retired player off the roster.');
    out.push('');
    out.push('| League | Type | Retired | Cancelled (technical / real) | Orphan history | Champion before → after | Records changed | Ranks moved |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const a of results) {
        out.push(`| ${a.leagueId} | ${a.type} | ${a.retired.join(', ')} | ${a.counts.cancelled} (${a.counts.cancelledTechnical} / **${a.counts.cancelledReal}**) | ${a.counts.orphanHistory} | ${a.champBefore} → ${a.champAfter}${a.champChanged ? ' **⚠ CHANGES**' : ''} | ${a.recordChanged.length} | ${a.movedRank.length} |`);
    }
    for (const a of results) {
        out.push('');
        out.push(`## ${a.leagueId}`);
        out.push('');
        out.push(`fixtures ${a.counts.fixtures} (played ${a.counts.fixturesPlayed}) · match_history ${a.counts.history} · orphan history rows ${a.counts.orphanHistory}`);
        out.push('');
        if (!a.recordChanged.length && !a.movedRank.length) { out.push('_No player’s record or rank changes._'); continue; }
        out.push('| Rank before → after | Player | Games | Wins | Win rate | Mean PR |');
        out.push('|---|---|---|---|---|---|');
        for (const r of a.rows) {
            if (r.rankBefore === r.rankAfter && r.gamesBefore === r.gamesAfter) continue;
            const arrow = r.rankBefore === r.rankAfter ? '' : (r.rankAfter < r.rankBefore ? ' ▲' : ' ▼');
            out.push(`| ${r.rankBefore} → ${r.rankAfter}${arrow} | ${r.player} | ${r.gamesBefore} → ${r.gamesAfter} | ${r.winsBefore} → ${r.winsAfter} | ${fmtPct(r.wrBefore)} → ${fmtPct(r.wrAfter)} | ${fmtPR(r.prBefore)} → ${fmtPR(r.prAfter)} |`);
        }
    }
    return out.join('\n');
}

async function main() {
    console.log(`Reading ${useLocal ? 'LOCAL Docker Supabase' : 'CLOUD'} — ${url}`);
    console.log('This script writes nothing. It only reads and compares.\n');

    const { data: leagueRows, error } = await supabase
        .from('leagues')
        .select('id, league_type, match_length, retired_players, hidden, archived');
    if (error) throw new Error(`could not read leagues: ${error.message}`);

    let targets = (leagueRows || []).filter(l => (l.retired_players || []).length > 0);
    if (onlyLeague) targets = targets.filter(l => l.id === onlyLeague);
    if (!targets.length) { console.log('No league carries a retired player.'); return; }

    const ids = targets.map(l => l.id);
    const [matches, overrides, history] = await Promise.all([
        readAll('matches', 'id, league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, played', ids),
        readAll('manual_overrides', 'id, league_id, type, player_a, player_b, winner, score_a, score_b, pr_a, pr_b, luck_a, luck_b, edited_at', ids),
        readAll('match_history', 'id, league_id, player_a, player_b, score_a, score_b, pr_a, pr_b, luck_a, luck_b, round, updated_at, source', ids),
    ]);
    const allRows = { matches, overrides, history };

    const results = [];
    for (const l of targets.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        results.push(await analyseLeague(l, allRows));
    }
    results.forEach(printLeague);

    console.log(`\n${'='.repeat(78)}`);
    console.log('SUMMARY');
    console.log('='.repeat(78));
    let totalReal = 0, totalTech = 0, champs = 0, people = 0;
    for (const a of results) {
        totalReal += a.counts.cancelledReal;
        totalTech += a.counts.cancelledTechnical;
        people += a.recordChanged.length;
        if (a.champChanged) champs++;
        console.log(`${a.leagueId.padEnd(26)} cancel ${String(a.counts.cancelled).padStart(3)} ` +
            `(tech ${String(a.counts.cancelledTechnical).padStart(3)}, real ${String(a.counts.cancelledReal).padStart(3)})  ` +
            `records ${String(a.recordChanged.length).padStart(3)}  ranks ${String(a.movedRank.length).padStart(3)}  ` +
            `${a.champChanged ? `CHAMPION: ${a.champBefore} → ${a.champAfter}` : ''}`);
    }
    console.log('-'.repeat(78));
    console.log(`${totalTech} technical results and ${totalReal} REALLY PLAYED results would be cancelled.`);
    console.log(`${people} player-records change across ${results.length} leagues. ${champs} league(s) change champion.`);

    if (mdPath) { writeFileSync(mdPath, toMarkdown(results), 'utf8'); console.log(`\nMarkdown written to ${mdPath}`); }
}

main().catch(err => { console.error(err); process.exit(1); });
