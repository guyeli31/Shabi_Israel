/**
 * migrate-to-supabase.mjs — one-time seed script.
 *
 * Reads the existing static leagues/** + assets/** state and loads it into
 * Supabase (DB rows + Storage binaries) before Admin cuts over to writing
 * Supabase directly. Idempotent (safe to re-run while iterating), but not a
 * recurring job — after cutover, Supabase is the sole source of truth and
 * this script's job is done. Keep it around only for disaster-recovery re-seeding.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node migrate-to-supabase.mjs
 * — or create supabase-migration/.env (gitignored) with those two vars and
 *   just run `node migrate-to-supabase.mjs`.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCSVAllWithRounds } from '../js/data/csvParser.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUES_ROOT = join(REPO_ROOT, 'leagues');
const FLAGS_DIR = join(REPO_ROOT, 'assets', 'flags');
const PLAYERS_DIR = join(REPO_ROOT, 'assets', 'players');

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function migrateLandingSettings() {
  const settings = await readJsonIfExists(join(LEAGUES_ROOT, 'landing_settings.json'));
  if (!settings) {
    console.warn('  ⚠ landing_settings.json not found — skipping');
    return;
  }
  const { error } = await supabase.from('landing_settings').upsert({
    id: 1,
    title: settings.title || 'Shabi Israel',
    subtitle: settings.subtitle || null,
    logo_path: settings.logoPath || null,
    display_order: settings.DisplayOrder || [],
  });
  if (error) throw new Error(`landing_settings upsert failed: ${error.message}`);
  console.log('  ✓ landing_settings');
}

async function migratePlayersMetadata() {
  const meta = (await readJsonIfExists(join(LEAGUES_ROOT, 'players_metadata.json'))) || {};
  const rows = Object.entries(meta).map(([id, m]) => ({
    id,
    full_name: m.fullName || null,
    bmab_title: m.bmabTitle || null,
    championship_titles: m.championshipTitles || [],
    hidden: m.hidden === true,
    photo_path: m.photoPath || null,
    inactive: m.inactive === true,
    joined: m.joined || null,
  }));
  if (rows.length === 0) {
    console.log('  ✓ players_metadata (nothing to migrate)');
    return;
  }
  const { error } = await supabase.from('players_metadata').upsert(rows);
  if (error) throw new Error(`players_metadata upsert failed: ${error.message}`);
  console.log(`  ✓ players_metadata (${rows.length} players)`);
}

function mapParamsToLeagueRow(folder, p) {
  return {
    id: folder,
    title: p.LeagueTitle || folder,
    league_type: p.LeagueType || 'doubling',
    running: p.Running === true,
    hidden: p.Hidden === true,
    // Defaults MUST match the app's read/admin-write path (1/1/4), NOT 0 —
    // the render code treats a missing count as `?? 1` (gold/silver) / `?? 4`
    // (admin), so seeding a legacy file that omits GoldCount/SilverCount as 0
    // would award 0 medals where the app intends 1, silently changing medal
    // standings. This is the exact bug that hit the Sept 2025–Mar 2026 leagues
    // (see docs/data-architecture/README.md scope note). `?? 0` here is a
    // consensus break with js/admin/supabaseAdmin.js mapParamsToLeagueRow.
    gold_count: p.GoldCount ?? 1,
    silver_count: p.SilverCount ?? 1,
    bronze_count: p.BronzeCount ?? 4,
    match_length: p.MatchLength ?? null,
    issue_date: p.IssueDate || null,
    entry_fee: p.EntryFee ?? 0,
    prizes: p.Prizes || { Gold: 0, Silver: 0, Bronze: 0 },
    custom_flags: p.CustomFlags || {},
    retired_players: p.RetiredPlayers || [],
    external_source_sync: p.ExternalSourceSync || null,
    last_updated: p.LastUpdated || null,
  };
}

/** Delete-stale-then-upsert: fetch existing keys for this league, diff against
 *  the fresh set, delete rows no longer present, upsert the rest. True
 *  idempotent sync rather than append-only. */
async function syncMatches(folder, matches) {
  const { data: existing, error: fetchErr } = await supabase
    .from('matches')
    .select('id, round, player_a, player_b')
    .eq('league_id', folder);
  if (fetchErr) throw new Error(`matches fetch failed for ${folder}: ${fetchErr.message}`);

  const freshKeys = new Set(matches.map((m) => `${m.round}|${m.playerA}|${m.playerB}`));
  const staleIds = (existing || [])
    .filter((row) => !freshKeys.has(`${row.round}|${row.player_a}|${row.player_b}`))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('matches').delete().in('id', staleIds);
    if (error) throw new Error(`matches stale-delete failed for ${folder}: ${error.message}`);
  }

  if (matches.length === 0) return;
  const rows = matches.map((m) => ({
    league_id: folder,
    round: m.round,
    player_a: m.playerA,
    player_b: m.playerB,
    pr_a: m.prA,
    luck_a: m.luckA,
    score_a: m.scoreA,
    pr_b: m.prB,
    luck_b: m.luckB,
    score_b: m.scoreB,
    played: m.played,
  }));
  const { error } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'league_id,round,player_a,player_b' });
  if (error) throw new Error(`matches upsert failed for ${folder}: ${error.message}`);
}

async function syncOverrides(folder, overrides) {
  const { data: existing, error: fetchErr } = await supabase
    .from('manual_overrides')
    .select('id, player_a, player_b')
    .eq('league_id', folder);
  if (fetchErr) throw new Error(`overrides fetch failed for ${folder}: ${fetchErr.message}`);

  const freshKeys = new Set(overrides.map((o) => `${o.playerA}|${o.playerB}`));
  const staleIds = (existing || [])
    .filter((row) => !freshKeys.has(`${row.player_a}|${row.player_b}`))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('manual_overrides').delete().in('id', staleIds);
    if (error) throw new Error(`overrides stale-delete failed for ${folder}: ${error.message}`);
  }

  if (overrides.length === 0) return;
  const rows = overrides.map((o) => ({
    league_id: folder,
    player_a: o.playerA,
    player_b: o.playerB,
    type: o.type,
    winner: o.winner || null,
    score_a: o.scoreA ?? null,
    score_b: o.scoreB ?? null,
    pr_a: o.prA ?? null,
    pr_b: o.prB ?? null,
    luck_a: o.luckA ?? null,
    luck_b: o.luckB ?? null,
    reason: o.reason || null,
  }));
  const { error } = await supabase
    .from('manual_overrides')
    .upsert(rows, { onConflict: 'league_id,player_a,player_b' });
  if (error) throw new Error(`overrides upsert failed for ${folder}: ${error.message}`);
}

async function syncMatchHistory(folder, historyMatches) {
  if (!historyMatches || historyMatches.length === 0) return;
  const rows = historyMatches.map((h) => ({
    league_id: folder,
    player_a: h.playerA,
    player_b: h.playerB,
    score_a: h.scoreA ?? null,
    score_b: h.scoreB ?? null,
    pr_a: h.prA ?? null,
    pr_b: h.prB ?? null,
    luck_a: h.luckA ?? null,
    luck_b: h.luckB ?? null,
    round: h.round ?? null,
    source: h.source || 'csv',
    updated_at: h.updatedAt || new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('match_history')
    .upsert(rows, { onConflict: 'league_id,player_a,player_b' });
  if (error) throw new Error(`match_history upsert failed for ${folder}: ${error.message}`);
}

async function migrateSnapshots(folder) {
  const historyDir = join(LEAGUES_ROOT, folder, 'history');
  if (!existsSync(historyDir)) return;
  const files = (await readdir(historyDir)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return;

  // Insert-only: snapshots are inherently timestamped and never go stale.
  // Skip files whose created_at already exists for this league (idempotent re-run).
  const { data: existing } = await supabase
    .from('league_snapshots')
    .select('created_at')
    .eq('league_id', folder);
  const existingTimes = new Set((existing || []).map((r) => new Date(r.created_at).getTime()));

  for (const file of files) {
    const snapshot = await readJsonIfExists(join(historyDir, file));
    if (!snapshot) continue;
    const ts = file.replace(/\.json$/, '');
    const createdAt = new Date(Number(ts) || ts).toISOString();
    if (existingTimes.has(new Date(createdAt).getTime())) continue;
    const { error } = await supabase.from('league_snapshots').insert({
      league_id: folder,
      created_at: createdAt,
      csv_content: snapshot.csvContent || null,
      overrides: snapshot.overrides || [],
    });
    if (error) console.warn(`  ⚠ snapshot ${file} insert failed for ${folder}: ${error.message}`);
  }
}

async function migrateLeague(folder) {
  const params = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'league_params.json'));
  if (!params) {
    console.warn(`  ⚠ ${folder}: no league_params.json — skipping`);
    return;
  }

  const { error: leagueErr } = await supabase.from('leagues').upsert(mapParamsToLeagueRow(folder, params));
  if (leagueErr) throw new Error(`leagues upsert failed for ${folder}: ${leagueErr.message}`);

  const csv = await readFile(join(LEAGUES_ROOT, folder, 'leaguedata.csv'), 'utf8').catch(() => null);
  if (csv) {
    const { matches } = parseCSVAllWithRounds(csv);
    await syncMatches(folder, matches);
  }

  const overridesFile = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'manual_overrides.json'));
  await syncOverrides(folder, overridesFile?.overrides || []);

  const historyFile = await readJsonIfExists(join(LEAGUES_ROOT, folder, 'match_history.json'));
  await syncMatchHistory(folder, historyFile?.matches || []);

  await migrateSnapshots(folder);

  console.log(`  ✓ ${folder}`);
}

async function migrateStorageAssets() {
  if (existsSync(FLAGS_DIR)) {
    const files = (await readdir(FLAGS_DIR)).filter((f) => f.toLowerCase().endsWith('.png'));
    for (const f of files) {
      const buf = await readFile(join(FLAGS_DIR, f));
      const { error } = await supabase.storage.from('flags').upload(f, buf, {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) console.warn(`  ⚠ flag upload failed (${f}): ${error.message}`);
    }
    console.log(`  ✓ flags bucket (${files.length} files)`);
  }

  if (existsSync(PLAYERS_DIR)) {
    const files = await readdir(PLAYERS_DIR);
    for (const f of files) {
      const buf = await readFile(join(PLAYERS_DIR, f));
      const ext = extname(f).slice(1).toLowerCase();
      const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const { error } = await supabase.storage.from('player-photos').upload(f, buf, {
        contentType,
        upsert: true,
      });
      if (error) console.warn(`  ⚠ photo upload failed (${f}): ${error.message}`);
    }
    console.log(`  ✓ player-photos bucket (${files.length} files)`);
  }
}

async function main() {
  console.log('→ Migrating landing_settings + players_metadata');
  await migrateLandingSettings();
  await migratePlayersMetadata();

  console.log('→ Migrating leagues');
  const entries = await readdir(LEAGUES_ROOT, { withFileTypes: true });
  const leagueFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  for (const folder of leagueFolders) {
    await migrateLeague(folder);
  }

  console.log('→ Migrating Storage assets (flags + player photos)');
  await migrateStorageAssets();

  console.log('✓ Migration complete.');
}

main().catch((err) => {
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
});
