/**
 * verify-csv-parity.mjs — CSV ↔ Supabase parity verification.
 * Spec: docs/data-architecture/03-csv-parity-plan.md
 *
 * Compares the frozen static leagues/** CSVs against Supabase, using the
 * app's own pure modules (csvParser.js, leagueLoader.js's applyOverrides,
 * matchHistory.js, stats.js) so verification exercises the same logic that
 * renders pages — not a re-implementation of it.
 *
 * Phase-0 note: get_site_bundle() (docs/data-architecture/01-architecture.md
 * §A5) does not exist yet — that's Phase 1. Until then this script fetches
 * the DB side via plain paginated REST against each table directly, and
 * mirrors js/data/supabaseLoader.js's mapping conventions inline. Once the
 * bundle RPC lands, swap the DB-fetch section for a single RPC call and
 * drop the pagination helper — no other part of this script changes.
 *
 * Usage:
 *   node scripts/verify-csv-parity.mjs [--target=local|cloud] [--json] [--out=<path>]
 *
 * local  → http://127.0.0.1:54321 (default; requires `supabase start`)
 * cloud  → requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCSVAllWithRounds, getAllPlayersFromCSV } from '../js/data/csvParser.js';
import { applyOverrides } from '../js/data/leagueLoader.js';
import { mergeHistoryIntoMatches, matchKey } from '../js/compute/matchHistory.js';
import { computeAllStats } from '../js/compute/stats.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUES_ROOT = join(REPO_ROOT, 'leagues');

const args = process.argv.slice(2);
const target = (args.find((a) => a.startsWith('--target=')) || '--target=local').split('=')[1];
const asJson = args.includes('--json');
const outArg = args.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.split('=')[1] : null;

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let SUPABASE_URL, SUPABASE_KEY;
if (target === 'local') {
  SUPABASE_URL = LOCAL_URL;
  SUPABASE_KEY = LOCAL_SERVICE_ROLE_KEY;
} else if (target === 'cloud') {
  SUPABASE_URL = process.env.SUPABASE_URL;
  SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('cloud target requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
  }
} else {
  console.error(`Unknown --target=${target} (expected local|cloud)`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- pagination helper (mirrors supabaseLoader.js's fetchAllRows) ----
const PAGE_SIZE = 1000;
async function fetchAllRows(table, buildQuery) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(supabase.from(table).select('*')).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// ---- DB → domain mapping (mirrors js/data/supabaseLoader.js mappers) ----
function mapDbMatch(row) {
  return {
    playerA: row.player_a,
    prA: row.pr_a,
    luckA: row.luck_a,
    scoreA: row.score_a,
    playerB: row.player_b,
    prB: row.pr_b,
    luckB: row.luck_b,
    scoreB: row.score_b,
    round: row.round,
    played: row.played,
  };
}

async function loadDbLeague(leagueId) {
  const [leagueRows, matchRows, overrideRows, historyRows] = await Promise.all([
    fetchAllRows('leagues', (q) => q.eq('id', leagueId)),
    fetchAllRows('matches', (q) => q.eq('league_id', leagueId).order('round', { ascending: true }).order('id', { ascending: true })),
    fetchAllRows('manual_overrides', (q) => q.eq('league_id', leagueId)),
    fetchAllRows('match_history', (q) => q.eq('league_id', leagueId)),
  ]);
  const allPlayersRaw = new Set();
  for (const row of matchRows) {
    allPlayersRaw.add(row.player_a);
    allPlayersRaw.add(row.player_b);
  }

  return {
    params: leagueRows[0] || null,
    matches: matchRows.map(mapDbMatch),
    allPlayersRaw,
    overrides: overrideRows.map((o) => ({
      playerA: o.player_a,
      playerB: o.player_b,
      type: o.type,
      winner: o.winner,
      scoreA: o.score_a,
      scoreB: o.score_b,
      prA: o.pr_a,
      prB: o.pr_b,
      luckA: o.luck_a,
      luckB: o.luck_b,
      reason: o.reason,
    })),
    history: historyRows.map((h) => ({
      playerA: h.player_a,
      playerB: h.player_b,
      scoreA: h.score_a,
      scoreB: h.score_b,
      prA: h.pr_a,
      prB: h.pr_b,
      luckA: h.luck_a,
      luckB: h.luck_b,
      round: h.round,
      updatedAt: h.updated_at,
      source: h.source,
    })),
  };
}

async function loadDbPlayersMetadata() {
  const rows = await fetchAllRows('players_metadata', (q) => q);
  const map = {};
  for (const r of rows) {
    map[r.id] = {
      fullName: r.full_name,
      bmabTitle: r.bmab_title,
      championshipTitles: r.championship_titles,
      hidden: r.hidden,
      inactive: r.inactive,
    };
  }
  return map;
}

async function loadDbLandingSettings() {
  const { data, error } = await supabase.from('landing_settings').select('*').eq('id', 1).single();
  if (error) throw new Error(`landing_settings fetch failed: ${error.message}`);
  return {
    title: data.title,
    subtitle: data.subtitle,
    logoPath: data.logo_path,
    displayOrder: data.display_order || [],
  };
}

// ---- normalization (docs/data-architecture/03-csv-parity-plan.md table) ----
function normalizePR(v, isTechnical) {
  if (isTechnical) return null; // rule 2: null vs 0 on technical rows treated as equal
  return v;
}

// Stable JSON for deep-equal of jsonb/object fields (Prizes/CustomFlags/RetiredPlayers).
function stableJson(v) {
  if (v == null) return 'null';
  if (Array.isArray(v)) return '[' + [...v].map(stableJson).sort().join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

// Compare league_params scalar/object fields (static PascalCase JSON vs the
// mapped DB row). This is the L2 layer that was documented but not implemented
// originally — its absence let the GoldCount/SilverCount migration bug pass as
// "PASS" (see docs/data-architecture/README.md scope note). RULE: the medal
// COUNTS are compared STRICTLY, treating absent(undefined/null) as distinct
// from 0 — because the render code reads a missing count as `?? 1` but a stored
// 0 as 0, so 0-vs-absent is a real, visible divergence that must NOT be
// normalized away. Other scalars normalize absent using the same default both
// loaders apply, to avoid false positives.
function compareParams(folder, sp, dp) {
  const out = [];
  if (!sp || !dp) return out; // no static params file (e.g. a DB-only league) — nothing to compare
  const absent = (v) => (v === undefined ? null : v); // undefined -> null so null !== 0 stays true

  // medal counts: STRICT (the bug class)
  const strict = [
    ['GoldCount', absent(sp.GoldCount), dp.gold_count],
    ['SilverCount', absent(sp.SilverCount), dp.silver_count],
    ['BronzeCount', absent(sp.BronzeCount), dp.bronze_count],
  ];
  for (const [field, s, d] of strict) {
    if (s !== d) out.push({ league: folder, level: 'L2', matchKey: '(params)', field, csv: s, db: d });
  }

  // scalars: normalize absent using each field's shared default
  const scalar = [
    ['LeagueType', sp.LeagueType || 'doubling', dp.league_type || 'doubling'],
    ['MatchLength', sp.MatchLength ?? null, dp.match_length ?? null],
    ['IssueDate', sp.IssueDate ?? null, dp.issue_date ?? null],
    ['EntryFee', sp.EntryFee ?? 0, dp.entry_fee ?? 0],
    ['Running', sp.Running === true, dp.running === true],
    ['Hidden', sp.Hidden === true, dp.hidden === true],
  ];
  for (const [field, s, d] of scalar) {
    if (s !== d) out.push({ league: folder, level: 'L2', matchKey: '(params)', field, csv: s, db: d });
  }

  // objects/arrays: stable deep-equal, absent normalized to the mapper's default
  const deep = [
    ['Prizes', sp.Prizes ?? { Gold: 0, Silver: 0, Bronze: 0 }, dp.prizes ?? { Gold: 0, Silver: 0, Bronze: 0 }],
    ['CustomFlags', sp.CustomFlags ?? {}, dp.custom_flags ?? {}],
    ['RetiredPlayers', sp.RetiredPlayers ?? [], dp.retired_players ?? []],
  ];
  for (const [field, s, d] of deep) {
    if (stableJson(s) !== stableJson(d)) out.push({ league: folder, level: 'L2', matchKey: '(params)', field, csv: stableJson(s), db: stableJson(d) });
  }
  return out;
}

// Identity = player-pair only, matching the app's own model: applyOverrides()
// and mergeHistoryIntoMatches() both key exclusively on matchKey(playerA,
// playerB), because the league format is round-robin (each pair meets at
// most once per season). `round` is descriptive metadata on a match, not
// part of its identity, and a history record can legitimately carry a
// different `round` value than the original CSV row for the same pair.
function buildMatchIndex(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = matchKey(m.playerA, m.playerB);
    map.set(key, m);
  }
  return map;
}

// ---- CSV side, per league ----
async function loadCsvLeague(folder) {
  const csvPath = join(LEAGUES_ROOT, folder, 'leaguedata.csv');
  const csvText = await readFile(csvPath, 'utf8');
  const { matches: rawMatches } = parseCSVAllWithRounds(csvText);
  const allPlayers = getAllPlayersFromCSV(csvText);

  const overridesFile = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'manual_overrides.json'));
  const overrides = overridesFile?.overrides || [];
  const withOverrides = applyOverrides(
    rawMatches.filter((m) => m.played),
    overrides
  );

  const historyFile = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'match_history.json'));
  const historyMatches = historyFile?.matches || [];
  const merged = mergeHistoryIntoMatches(withOverrides, historyMatches);

  const paramsFile = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'league_params.json'));

  return { matches: merged, allPlayers, params: paramsFile };
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---- comparison levels ----
function compareLeague(folder, csv, db, isRunning, dbOverrides) {
  const diffs = [];
  const infoDiffs = []; // running-league expected extras/legitimate-override cases, informational only

  const notPlayedOverrides = new Map(
    (dbOverrides || [])
      .filter((o) => o.type === 'not_played')
      .map((o) => [matchKey(o.playerA, o.playerB), o])
  );

  // For the running league, a known not_played override is a legitimate,
  // explained divergence (see the L1 presence check below) — apply it to
  // the CSV match set too before L3 stats, so its downstream effect on a
  // player's games/winRate/meanPR doesn't surface as a spurious diff on
  // top of the already-reported, already-explained L1 case.
  const csvMatchesForComparison = isRunning && notPlayedOverrides.size > 0
    ? csv.matches.filter((m) => !notPlayedOverrides.has(matchKey(m.playerA, m.playerB)))
    : csv.matches;

  // Record known not_played overrides as informational up front — they are
  // excluded from csvMatchesForComparison below, so the L1 loop will never
  // see them as a diff; this is what makes that exclusion visible in the report.
  if (isRunning && notPlayedOverrides.size > 0) {
    const fullCsvIndex = buildMatchIndex(csv.matches);
    for (const [key, override] of notPlayedOverrides) {
      if (fullCsvIndex.has(key)) {
        infoDiffs.push({
          league: folder, level: 'L1', matchKey: key, field: 'presence',
          csv: 'present', db: `removed via manual_overrides (not_played): "${override.reason || 'no reason given'}"`,
        });
      }
    }
  }

  const csvIndex = buildMatchIndex(csvMatchesForComparison);
  const dbIndex = buildMatchIndex(db.matches.filter((m) => m.played !== false));

  const allKeys = new Set([...csvIndex.keys(), ...dbIndex.keys()]);
  for (const key of allKeys) {
    const c = csvIndex.get(key);
    const d = dbIndex.get(key);

    if (c && !d) {
      diffs.push({ league: folder, level: 'L1', matchKey: key, field: 'presence', csv: 'present', db: 'MISSING' });
      continue;
    }
    if (!c && d) {
      if (isRunning) {
        infoDiffs.push({ league: folder, level: 'L1', matchKey: key, field: 'presence', csv: 'MISSING (new since cutover)', db: 'present' });
      } else {
        diffs.push({ league: folder, level: 'L1', matchKey: key, field: 'presence', csv: 'MISSING', db: 'present' });
      }
      continue;
    }

    const isTechnical = c._technical || d.prA === null || d.prB === null || c.prA === null || c.prB === null;
    const fields = [
      ['round', c.round, d.round],
      ['scoreA', c.scoreA, d.scoreA],
      ['scoreB', c.scoreB, d.scoreB],
      ['prA', normalizePR(c.prA, isTechnical), normalizePR(d.prA, isTechnical)],
      ['prB', normalizePR(c.prB, isTechnical), normalizePR(d.prB, isTechnical)],
      ['luckA', normalizePR(c.luckA, isTechnical), normalizePR(d.luckA, isTechnical)],
      ['luckB', normalizePR(c.luckB, isTechnical), normalizePR(d.luckB, isTechnical)],
    ];
    for (const [field, cv, dv] of fields) {
      if (cv !== dv && !(cv == null && dv == null)) {
        diffs.push({ league: folder, level: 'L1', matchKey: key, field, csv: cv, db: dv });
      }
    }
  }

  // L2 — player set. Computed from db.allPlayersRaw (unfiltered: played +
  // unplayed rows, mirroring how csv.allPlayers is derived from the raw CSV
  // text via getAllPlayersFromCSV, not from the played-only merged match
  // set) — otherwise a player with only unplayed fixtures would falsely
  // read as "missing" on the DB side.
  const csvPlayers = csv.allPlayers;
  const dbPlayers = db.allPlayersRaw;
  for (const p of csvPlayers) {
    if (!dbPlayers.has(p)) diffs.push({ league: folder, level: 'L2', matchKey: p, field: 'allPlayers', csv: 'present', db: 'MISSING' });
  }
  for (const p of dbPlayers) {
    if (!csvPlayers.has(p) && !isRunning) diffs.push({ league: folder, level: 'L2', matchKey: p, field: 'allPlayers', csv: 'MISSING', db: 'present' });
  }

  // L2 — league_params fields (medal counts, match length, prizes, flags, ...)
  diffs.push(...compareParams(folder, csv.params, db.params));

  // L3 — computed stats (winRate, meanPR)
  const csvStats = computeAllStats(csvMatchesForComparison, csvPlayers);
  const dbStats = computeAllStats(db.matches.filter((m) => m.played !== false), dbPlayers);
  for (const [player, cs] of csvStats) {
    const ds = dbStats.get(player);
    if (!ds) continue; // already reported as L2 missing
    for (const field of ['games', 'winRate', 'meanPR', 'luck']) {
      const cv = cs[field];
      const dv = ds[field];
      const close = typeof cv === 'number' && typeof dv === 'number' ? Math.abs(cv - dv) < 1e-9 : cv === dv;
      if (!close && !(cv == null && dv == null)) {
        diffs.push({ league: folder, level: 'L3', matchKey: player, field, csv: cv, db: dv });
      }
    }
  }

  return { diffs, infoDiffs };
}

// ---- main ----
async function main() {
  const entries = await readdir(LEAGUES_ROOT, { withFileTypes: true });
  const leagueFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const results = [];
  let anyClosedFailure = false;

  console.log(`Target: ${target} (${SUPABASE_URL})`);
  console.log(`Leagues found: ${leagueFolders.length}\n`);

  for (const folder of leagueFolders) {
    const csv = await loadCsvLeague(folder);
    const dbRaw = await loadDbLeague(folder);
    const isRunning = dbRaw.params?.running === true;

    // Apply the SAME override + history merge to the DB's raw matches that
    // loadCsvLeague already applied to the CSV's raw matches, so both sides
    // represent "current state" rather than comparing raw vs. post-merge.
    const dbWithOverrides = applyOverrides(
      dbRaw.matches.filter((m) => m.played !== false),
      dbRaw.overrides
    );
    const dbMerged = mergeHistoryIntoMatches(dbWithOverrides, dbRaw.history);
    const db = { ...dbRaw, matches: dbMerged };

    const { diffs, infoDiffs } = compareLeague(folder, csv, db, isRunning, dbRaw.overrides);
    const pass = diffs.length === 0;
    if (!pass) anyClosedFailure = true;

    results.push({ league: folder, running: isRunning, pass, diffs, infoDiffs });

    const status = pass ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${folder}${isRunning ? ' (running — subset check)' : ''} — ${diffs.length} diff(s), ${infoDiffs.length} informational`);
  }

  // players_metadata + landing_settings (whole-site, not per-league)
  const csvMeta = await readJsonIfExists(join(LEAGUES_ROOT, 'players_metadata.json')) || {};
  const dbMeta = await loadDbPlayersMetadata();
  const metaDiffs = [];
  for (const [id, m] of Object.entries(csvMeta)) {
    const d = dbMeta[id];
    if (!d) { metaDiffs.push({ league: '(players_metadata)', level: 'L2', matchKey: id, field: 'presence', csv: 'present', db: 'MISSING' }); continue; }
    if ((m.bmabTitle || null) !== (d.bmabTitle || null)) {
      metaDiffs.push({ league: '(players_metadata)', level: 'L2', matchKey: id, field: 'bmabTitle', csv: m.bmabTitle || null, db: d.bmabTitle || null });
    }
  }
  if (metaDiffs.length > 0) anyClosedFailure = true;
  console.log(`[${metaDiffs.length === 0 ? 'PASS' : 'FAIL'}] players_metadata — ${metaDiffs.length} diff(s)`);

  const csvLanding = await readJsonIfExists(join(LEAGUES_ROOT, 'landing_settings.json'));
  const dbLanding = await loadDbLandingSettings();
  const landingDiffs = [];
  if (csvLanding) {
    if ((csvLanding.title || null) !== (dbLanding.title || null)) landingDiffs.push({ league: '(landing_settings)', level: 'L2', matchKey: '-', field: 'title', csv: csvLanding.title, db: dbLanding.title });
    const csvOrder = JSON.stringify(csvLanding.DisplayOrder || []);
    const dbOrder = JSON.stringify(dbLanding.displayOrder || []);
    if (csvOrder !== dbOrder) landingDiffs.push({ league: '(landing_settings)', level: 'L2', matchKey: '-', field: 'displayOrder', csv: csvOrder, db: dbOrder });
  }
  if (landingDiffs.length > 0) anyClosedFailure = true;
  console.log(`[${landingDiffs.length === 0 ? 'PASS' : 'FAIL'}] landing_settings — ${landingDiffs.length} diff(s)\n`);

  const allDiffs = [
    ...results.flatMap((r) => r.diffs),
    ...metaDiffs,
    ...landingDiffs,
  ];
  const allInfo = results.flatMap((r) => r.infoDiffs);

  if (allDiffs.length > 0) {
    console.log('--- Diffs ---');
    for (const d of allDiffs) {
      console.log(`${d.league} | ${d.level} | ${d.matchKey} | ${d.field} | csv=${JSON.stringify(d.csv)} db=${JSON.stringify(d.db)}`);
    }
    console.log();
  }
  if (allInfo.length > 0) {
    console.log(`--- Informational (running league, DB rows added since cutover): ${allInfo.length} ---`);
  }

  const summary = {
    target,
    generatedAt: new Date().toISOString(),
    leagues: results.map((r) => ({ league: r.league, running: r.running, pass: r.pass, diffCount: r.diffs.length, infoCount: r.infoDiffs.length })),
    playersMetadataDiffs: metaDiffs.length,
    landingSettingsDiffs: landingDiffs.length,
    overallPass: !anyClosedFailure,
    diffs: allDiffs,
    informationalDiffs: allInfo,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  }
  if (outPath) {
    await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`Written: ${outPath}`);
  }

  console.log(anyClosedFailure ? '\nFAIL — closed-league or metadata mismatch found.' : '\nPASS — all closed leagues + metadata match; running league is a superset as expected.');
  process.exit(anyClosedFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
