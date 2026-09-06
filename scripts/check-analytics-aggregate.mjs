#!/usr/bin/env node
/**
 * check-analytics-aggregate.mjs — proves js/data/analyticsAggregate.js's
 * computeSummary() matches sql/analytics_poc.sql's analytics_summary() on the same
 * data, so the client-side aggregation (which powers the instant audience filter)
 * cannot silently drift from the server's definition.
 *
 * Fetches BOTH the RPC summary and the raw rows from the LOCAL Docker Postgres
 * (superuser psql — no auth dance), runs computeSummary over the raw rows with all
 * three audiences included (= the RPC's unfiltered case), and compares key-for-key.
 *
 * Ordering-only and precision-only differences are NOT failures, because the SQL
 * itself is non-deterministic there: `order by count desc` breaks ties arbitrarily
 * (so which tied row lands at a top-N boundary is undefined), dwell_buckets has no
 * ORDER BY at all, and a session's wall-clock span differs by ≤1ms because Postgres
 * keeps microseconds while JS Date is millisecond. Everything else must match.
 *
 * Run:  node scripts/check-analytics-aggregate.mjs
 * Needs the local Docker Supabase up (see CLAUDE.md). Exit 1 on any real mismatch.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = 'supabase_db_supabase-migration';
const RANGE = ["1970-01-01", "2027-01-01"];

function psqlJson(sql) {
    const out = execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out.trim());
}

let summary, raw;
try {
    summary = psqlJson(`select analytics_summary('${RANGE[0]}','${RANGE[1]}', false, 'new', false, null)`);
    raw = psqlJson(`select analytics_events_raw('${RANGE[0]}','${RANGE[1]}','new', 50000)`);
} catch (e) {
    console.error('Could not reach the local Docker DB (is it up?):', e.message);
    process.exit(2);
}

const { computeSummary } = await import(new URL('../shabi-israel/js/data/analyticsAggregate.js', import.meta.url));
const got = computeSummary(raw, { self: true, other: true, visitor: true, viewer: null });

const canon = (x) => Array.isArray(x) ? x.map(canon)
    : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
const cj = (x) => JSON.stringify(canon(x));

let fails = 0;
const fail = (name, msg) => { fails++; console.log(`FAIL ${name}${msg ? ' — ' + msg : ''}`); };
const exact = (name, a, b) => { if (cj(a) === cj(b)) console.log(`PASS ${name}`); else fail(name, `\n  rpc=${cj(a)}\n  got=${cj(b)}`); };

// Truncated-with-ties arrays: the multiset of counts must match, and every item
// ABOVE the boundary count (strictly greater than the smallest count in the slice)
// must be the same set — only the tied items straddling the cut may differ.
function tolerantTopN(name, a, b, countKey) {
    const counts = (arr) => arr.map((r) => r[countKey]).sort((x, y) => x - y);
    if (cj(counts(a)) !== cj(counts(b))) return fail(name, 'count multiset differs');
    const boundary = a.length ? Math.min(...a.map((r) => r[countKey])) : 0;
    const above = (arr) => new Set(arr.filter((r) => r[countKey] > boundary).map(cj));
    const [sa, sb] = [above(a), above(b)];
    if (sa.size !== sb.size || [...sa].some((x) => !sb.has(x))) return fail(name, 'items above the tie boundary differ');
    console.log(`PASS ${name} (ties at boundary ignored)`);
}

exact('traffic_mix', summary.traffic_mix, got.traffic_mix);
for (const k of ['total_pageviews', 'total_sessions', 'avg_dwell_ms', 'bounce_pct', 'last_event_at']) exact(k, summary[k], got[k]);
for (const k of ['top_pages', 'top_leagues', 'top_players']) tolerantTopN(k, summary[k], got[k], 'views');
for (const k of ['by_device', 'by_region', 'by_referrer', 'timeseries', 'by_hour_day', 'by_hour_month', 'transitions_log', 'clicks_log']) exact(k, summary[k], got[k]);
tolerantTopN('transitions', summary.transitions, got.transitions, 'n');
exact('dwell_buckets(set)', [...summary.dwell_buckets].map(cj).sort(), [...got.dwell_buckets].map(cj).sort());

exact('sessions.length', summary.sessions.length, got.sessions.length);
const head = (s) => ({ id: s.session_id, st: s.started_at, en: s.ended_at, ec: s.event_count, pc: s.pageview_count, cc: s.click_count, dev: s.device_type, au: s.admin_user, er: s.entry_referrer, ep: s.entry_page, epl: s.entry_player, el: s.entry_league_id, et: s.entry_tab, emb: s.entry_moved_banner, xp: s.exit_page, xpl: s.exit_player, tl: s.timeline.length });
exact('sessions.head', summary.sessions.map(head), got.sessions.map(head));
let durBad = 0;
for (let i = 0; i < summary.sessions.length; i++) if (Math.abs(summary.sessions[i].duration_ms - got.sessions[i].duration_ms) > 2) durBad++;
if (durBad) fail('sessions.duration_ms', `${durBad} off by >2ms`); else console.log('PASS sessions.duration_ms (±2ms)');

console.log(fails ? `\n${fails} MISMATCH(es)` : '\nALL MATCH ✓');
process.exit(fails ? 1 : 0);
