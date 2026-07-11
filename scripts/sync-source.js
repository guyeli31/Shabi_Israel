import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

import { parseCSV, parseCSVAllWithRounds } from '../js/data/csvParser.js';
import { applyOverrides } from '../js/data/leagueLoader.js';

const DEFAULT_FLAG = 'IL';
const SITE_URL = process.env.SOURCE_URL;
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
const SESSION_PATH = resolve(OUT_DIR, 'session-state.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// GitHub sets GITHUB_RUN_ID automatically; fall back to a timestamp locally so
// each run's UI events are still grouped under one id.
const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
let eventRetentionDone = false;

/**
 * Stream one plain-language progress line to Supabase so the Admin UI's sync log
 * can show it live. This is the ONLY place user-facing sync messages are authored
 * (the job is the only layer that knows what actually happened inside the source
 * site). Best-effort by design: a telemetry failure must never break the actual
 * sync, so every error is swallowed with a warning.
 */
async function logEvent(leagueId, level, message) {
  console.log(`    [ui] ${message}`);
  if (!supabase || !leagueId) return;
  try {
    if (!eventRetentionDone) {
      eventRetentionDone = true;
      await supabase
        .from('external_source_sync_events')
        .delete()
        .lt('created_at', new Date(Date.now() - 14 * 864e5).toISOString());
    }
    const { error } = await supabase
      .from('external_source_sync_events')
      .insert({ league_id: leagueId, run_id: GITHUB_RUN_ID, level, message });
    if (error) console.warn(`    (ui event log insert rejected: ${error.message})`);
  } catch (e) {
    console.warn(`    (ui event log failed: ${e.message})`);
  }
}

/**
 * Stream one SITE-LEVEL progress line (league_id = null) — a message that belongs
 * to the whole run, not a single league (connecting / signing in / a login or
 * network failure). The Admin Run Now UI shows these once in its global log,
 * separate from each league's own card. Same best-effort contract as logEvent.
 */
async function logSiteEvent(level, message) {
  console.log(`    [ui:site] ${message}`);
  if (!supabase) return;
  try {
    if (!eventRetentionDone) {
      eventRetentionDone = true;
      await supabase
        .from('external_source_sync_events')
        .delete()
        .lt('created_at', new Date(Date.now() - 14 * 864e5).toISOString());
    }
    const { error } = await supabase
      .from('external_source_sync_events')
      .insert({ league_id: null, run_id: GITHUB_RUN_ID, level, message });
    if (error) console.warn(`    (ui site event log insert rejected: ${error.message})`);
  } catch (e) {
    console.warn(`    (ui site event log failed: ${e.message})`);
  }
}

/**
 * Map a SITE-level startup failure (before any league is opened — reaching the
 * site, the gateway, or signing in) to one specific, actionable sentence. Login
 * is a single shared step for the whole run, so this is reported ONCE at site
 * level, never duplicated per league.
 */
function friendlyStartupError(err) {
  const m = (err && err.message) || '';
  if (/Live matches/i.test(m)) {
    return `Couldn't sign in to the source site — the saved login may have expired, or the password or the site's login page changed. This usually needs attention, not just a retry (it could also be an anti-bot block).`;
  }
  if (/net::|ERR_|ERR_CONNECTION|ERR_NAME|Timeout.*(goto|navigat)/i.test(m)) {
    return `Couldn't reach the source site — it may be down or blocking the connection. Try again later.`;
  }
  return `The sync couldn't start (before opening any league). Try again; if it keeps happening, the source login or the site may have changed.`;
}

/**
 * Map a raw per-league failure (err.message) to ONE specific, actionable
 * user-facing sentence for the Admin sync log. The point is to tell the site
 * owner WHAT went wrong and whether retrying can even help — a bare "try again
 * later" is useless when the real problem is a mistyped Source League Name.
 * Every branch here corresponds to a concrete `throw` in the export path
 * (see clickLeagueByName / navigateToLeaguesList / exportLeagueTask /
 * getBaselinePlayedCount / writeMatchesToSupabase / reconcileMatchHistoryInSupabase).
 */
function friendlyLeagueError(err, sourceLeagueName) {
  const m = (err && err.message) || '';

  if (/League ".*" not found/i.test(m)) {
    return `Couldn't find a league named "${sourceLeagueName}" on the source site. Fix the Source League Name so it matches the source exactly — spaces and capitalization included. Retrying won't help until it does.`;
  }
  if (/Leagues list did not render/i.test(m)) {
    return `The source site never loaded its leagues list in time (it wasn't ready yet). This is usually temporary — try again in a few minutes.`;
  }
  if (/DL never (populated|repopulated)/i.test(m)) {
    return `The league opened but its players and rounds never finished loading. The source may be slow, or the league may have no data yet — try again in a few minutes.`;
  }
  if (/never produced CSV data/i.test(m)) {
    return `The league opened but the source returned nothing to export. If it has no played matches yet that's expected; otherwise the export timed out — try again.`;
  }
  if (/integrity check failed|under-delivering/i.test(m)) {
    return `The source sent back incomplete results (fewer matches than are already saved), so the sync was stopped to protect your data. This is almost always a temporary source glitch — try again in a few minutes.`;
  }
  if (/Supabase baseline/i.test(m)) {
    return `Couldn't read the league's current data from the database to compare against. This is a server-side issue, not the source — try again; if it persists, check the database connection.`;
  }
  if (/matches (fetch|stale-delete|upsert)|match_history (stale-delete|upsert)/i.test(m)) {
    return `Fetched the results, but saving them to the database failed. The source data was fine — this is a server/database issue. Try again; if it persists, check the database.`;
  }
  return `Sync failed while fetching data. This looks temporary — try again in a few minutes. If it keeps failing, double-check the Source League Name and that the league still exists on the source site.`;
}

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
];

const username = process.env.SOURCE_USER;
const password = process.env.SOURCE_PASS;
const SYNC_MODE = (process.env.SYNC_MODE || 'full').toLowerCase();

if (!SITE_URL || !username || !password) {
  console.error('Missing SOURCE_URL, SOURCE_USER or SOURCE_PASS env vars.');
  process.exit(1);
}
if (!['full', 'fast'].includes(SYNC_MODE)) {
  console.error(`Invalid SYNC_MODE="${SYNC_MODE}". Use "full" or "fast".`);
  process.exit(1);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function findActiveLeague(leaguesRoot) {
  const entries = await readdir(leaguesRoot, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const paramsPath = join(leaguesRoot, e.name, 'league_params.json');
    try {
      const params = JSON.parse(await readFile(paramsPath, 'utf8'));
      if (params.Running === true) return { folder: e.name, paramsPath, params };
    } catch {}
  }
  return null;
}

async function buildKnownPlayers(leaguesRoot) {
  const known = new Set();
  try {
    const meta = JSON.parse(await readFile(join(leaguesRoot, 'players_metadata.json'), 'utf8'));
    for (const u of Object.keys(meta)) known.add(u);
  } catch {}
  const entries = await readdir(leaguesRoot, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const csvPath = join(leaguesRoot, e.name, 'leaguedata.csv');
    try {
      const csv = await readFile(csvPath, 'utf8');
      const lines = csv.split(/\r?\n/).slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(',');
        const a = (cols[0] || '').trim();
        const b = (cols[4] || '').trim();
        if (a) known.add(a);
        if (b) known.add(b);
      }
    } catch {}
  }
  return known;
}

function computeCustomFlagsDiff(currentCustomFlags, players) {
  const desired = {};
  for (const p of players) {
    const code = (p.fl || '').toUpperCase();
    if (code && code !== DEFAULT_FLAG) desired[p.username] = code;
  }
  const current = currentCustomFlags || {};
  const added = [];
  const changed = [];
  const removed = [];
  for (const [u, c] of Object.entries(desired)) {
    if (!(u in current)) added.push({ username: u, to: c });
    else if (current[u] !== c) changed.push({ username: u, from: current[u], to: c });
  }
  for (const u of Object.keys(current)) {
    if (!(u in desired)) removed.push({ username: u, from: current[u] });
  }
  return { desired, added, changed, removed };
}

async function justIdle(page, durationS) {
  await page.waitForTimeout(durationS * 1000);
}

async function scrollPage(page, durationS) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < durationS) {
    const direction = Math.random() < 0.7 ? 1 : -1;
    const amount = randInt(150, 600) * direction;
    await page.mouse.wheel(0, amount);
    await page.waitForTimeout(randInt(500, 3000));
  }
}

async function browseTab(page, tabName, durationS) {
  const switched = await page.evaluate((name) => {
    const th = Array.from(document.querySelectorAll('th')).find(
      (el) => new RegExp(`^\\s*${name}\\s*$`).test(el.textContent || '') && el.offsetParent !== null,
    );
    const inner = th && th.querySelector('.TabButton');
    if (inner) { inner.click(); return true; }
    return false;
  }, tabName);
  if (!switched) throw new Error(`tab "${tabName}" not found or unreachable`);
  await page.waitForTimeout(randInt(1000, 3000));
  await scrollPage(page, Math.max(0, durationS - 3));
}

const STATUS_FLAGS = {
  friendReady: { code: 1, label: 'Friend ready' },
  tournamentReady: { code: 11, label: 'Tournament ready' },
  sourceReady: { code: 18, label: 'External Source ready' },
  busy: { code: 16, label: 'Busy' },
};

async function changeStatusTask(page, durationS) {
  const keys = Object.keys(STATUS_FLAGS);
  const pickCount = randInt(2, 3);
  const picks = shuffle(keys).slice(0, pickCount);
  const perStepMs = Math.max(2000, Math.floor((durationS * 1000) / picks.length));
  for (const key of picks) {
    const { code, label } = STATUS_FLAGS[key];
    const opened = await page.evaluate(() => {
      const own = Array.from(document.querySelectorAll('button')).find((b) => {
        if (b.offsetParent === null) return false;
        const oc = b.getAttribute('onclick') || '';
        if (!/^ca\(129,/.test(oc)) return false;
        const r = b.getBoundingClientRect();
        return r.left < 100 && r.top < 80;
      });
      if (!own) return false;
      own.click();
      return true;
    });
    if (!opened) throw new Error(`could not open status picker for "${label}"`);
    await page.waitForTimeout(500);
    const set = await page.evaluate(
      ({ code }) => {
        const opt = Array.from(document.querySelectorAll('button')).find(
          (b) => b.offsetParent !== null && b.getAttribute('onclick') === `ca(35,${code})`,
        );
        if (!opt) return false;
        opt.click();
        return true;
      },
      { code },
    );
    if (!set) throw new Error(`could not set status "${label}" (picker option not visible)`);
    console.log(`    status → ${label} (code ${code})`);
    await page.waitForTimeout(perStepMs);
  }
}

/**
 * Dismiss the "Export league" dialog (#d_exportleague) if it is lingering. After a
 * league's export this dialog stays open; in a multi-league run its overlay then
 * intercepts the click that opens the NEXT league (Playwright reports
 * "<div id=d_exportleague> subtree intercepts pointer events"). Prefer a real close
 * action (the dialog's close control, else Escape); JS-hide only as a last resort
 * so the run doesn't stall on an unknown close control.
 */
async function dismissExportDialog(page) {
  const dialog = page.locator('#d_exportleague');
  if (!(await dialog.count()) || !(await dialog.first().isVisible().catch(() => false))) return;
  console.log('  → Dismissing lingering Export dialog before opening the next league');
  const closeBtn = dialog.locator('button:has-text("Close"), .dialogclose, [onclick*="close" i]').first();
  if (await closeBtn.count().catch(() => 0)) await closeBtn.click({ timeout: 3000 }).catch(() => {});
  if (await dialog.first().isVisible().catch(() => false)) await page.keyboard.press('Escape').catch(() => {});
  const gone = await dialog.first().waitFor({ state: 'hidden', timeout: 4000 }).then(() => true).catch(() => false);
  if (!gone) {
    await page.evaluate(() => { const d = document.getElementById('d_exportleague'); if (d) d.style.display = 'none'; });
    console.log('    (close control/Escape did not dismiss it — used JS hide fallback)');
  }
}

async function navigateToLeaguesList(page) {
  await dismissExportDialog(page);
  await page.waitForTimeout(randInt(500, 2500));
  console.log('  → Navigating to Leagues list (s(113, "0") shortcut)');
  const deadline = Date.now() + 30000;
  const RENDER_WAIT_MS = 1200;
  let calls = 0;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      if (typeof s === 'function') {
        try { s(113, '0'); } catch {}
      }
    });
    calls++;
    await page.waitForTimeout(RENDER_WAIT_MS);
    const count = await page.locator('button.tablebutton[onclick^="lg(682,"]').count();
    if (count > 0) {
      console.log(`    Leagues list rendered after ${calls} s(113,'0') call(s)`);
      return;
    }
  }
  throw new Error(`Leagues list did not render within 30s (s(113,'0') called ${calls} times — External Source state not ready)`);
}

/**
 * Logout (ca(60)) + full login again. Used as the last-resort retry strategy when
 * even re-navigating the league panel didn't shake out a complete CSV — the WS
 * channel itself may be in a stuck state. A full disconnect + reconnect clears
 * the whole session, so the next Export results call starts from clean state.
 *
 * Leaves the page logged-in at the Live matches view. Caller is responsible for
 * navigating back to the leagues list and the target league.
 */
async function relogin(page) {
  console.log('  → Logging out (ca(60))');
  await page.evaluate(() => { try { ca(60); } catch {} });
  await page.waitForTimeout(2500);

  const enterClicked = await page.evaluate(() => {
    const enter = Array.from(document.querySelectorAll('button')).find(
      (b) => /^Enter$/.test((b.textContent || '').trim()) && b.offsetParent !== null,
    );
    if (!enter) return false;
    enter.click();
    return true;
  });
  if (enterClicked) {
    console.log('  → Clicked Enter (gateway page)');
    await page.waitForTimeout(1500);
  }

  console.log('  → Re-submitting login');
  await page.locator('button:has-text("Login"):not(.dialogbutton)').click();
  await page.locator('#username').click();
  await page.locator('#username').pressSequentially(username, { delay: randInt(80, 200) });
  await page.locator('#pass').click();
  await page.locator('#pass').pressSequentially(password, { delay: randInt(80, 200) });
  await page.locator('button.dialogbutton:has-text("Login")').click();
  await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });
  console.log('  ✓ Re-logged in successfully');
}

/**
 * Baseline "effective played count" for the league — the count the dashboard
 * shows in "Games Played X / Y", i.e. parseCSV → applyOverrides → length.
 *
 * Two source modes, selected by env vars:
 *
 *   Phase 1 (default — no Supabase configured): read CSV + manual_overrides.json
 *     from the repo working tree. Same logic the dashboard renders with.
 *   Phase 2 (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set): query the database
 *     for the effective played count + overrides. Repo files are ignored.
 *
 * Returns { baseline, overrides } so the caller can re-apply the same overrides
 * to the freshly-downloaded CSV (apples-to-apples comparison). Returns null when
 * no baseline is available (first-ever sync of a new league) — check is skipped.
 */
async function getBaselinePlayedCount(folder, repoRoot) {
  if (supabase) {
    const { data: overrideRows, error: ovErr } = await supabase
      .from('manual_overrides')
      .select('*')
      .eq('league_id', folder);
    if (ovErr) throw new Error(`Supabase baseline: manual_overrides query failed: ${ovErr.message}`);

    const { data: matchRows, error: mErr } = await supabase
      .from('matches')
      .select('*')
      .eq('league_id', folder)
      .eq('played', true);
    if (mErr) throw new Error(`Supabase baseline: matches query failed: ${mErr.message}`);

    const overrides = (overrideRows || []).map((o) => ({
      type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
      scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
    }));
    const matches = (matchRows || []).map((m) => ({
      playerA: m.player_a, prA: m.pr_a, luckA: m.luck_a, scoreA: m.score_a,
      playerB: m.player_b, prB: m.pr_b, luckB: m.luck_b, scoreB: m.score_b,
    }));
    if (matches.length === 0 && overrides.length === 0) return null; // first-ever sync
    const baseline = applyOverrides(matches, overrides).length;
    return { baseline, overrides };
  }
  try {
    const csv = await readFile(join(repoRoot, 'leagues', folder, 'leaguedata.csv'), 'utf8');
    const overridesRaw = await readFile(
      join(repoRoot, 'leagues', folder, 'manual_overrides.json'),
      'utf8',
    ).catch(() => '{"overrides":[]}');
    const overrides = JSON.parse(overridesRaw).overrides || [];
    const baseline = applyOverrides(parseCSV(csv), overrides).length;
    return { baseline, overrides };
  } catch {
    return null;
  }
}

async function clickLeagueByName(page, sourceLeagueName) {
  const MAX_PAGES = 10;
  const leagueRegex = new RegExp(`^\\s*${sourceLeagueName}\\s*$`);
  let prevFirstId = null;
  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
    await page.locator('button.tablebutton[onclick^="lg(682,"]').first().waitFor({ timeout: 10000 });
    const target = page.locator('button.tablebutton[onclick^="lg(682,"]').filter({ hasText: leagueRegex }).first();
    if ((await target.count()) > 0) {
      console.log(`    Found on page ${pageIdx + 1}`);
      await target.click({ timeout: 15000 });
      return;
    }
    const firstId = await page.evaluate(() => {
      const b = document.querySelector('button.tablebutton[onclick^="lg(682,"]');
      return b ? b.getAttribute('onclick') : null;
    });
    if (firstId === prevFirstId) {
      throw new Error(`League "${sourceLeagueName}" not found — Next button no longer advances at firstId=${firstId}`);
    }
    console.log(`    Not on page ${pageIdx + 1} (firstId=${firstId}) — clicking Next`);
    prevFirstId = firstId;
    await page.locator('button.tablebutton:has-text("Next")').first().click();
    await page.waitForTimeout(600);
  }
  throw new Error(`League "${sourceLeagueName}" not found within ${MAX_PAGES} pages`);
}

async function waitForRosterAndRounds(page) {
  return await page.evaluate(async () => {
    const HARD_TIMEOUT = 15000;
    const POST_DL_WAIT = 5000;
    const T0 = performance.now();
    const trace = [];
    let dlSince = null;
    while (performance.now() - T0 < HARD_TIMEOUT) {
      const dl = typeof DL !== 'undefined' && Array.isArray(DL) ? DL.length : 0;
      const rg = typeof FL !== 'undefined' && FL && typeof RG !== 'undefined' ? FL[RG] : null;
      const t = Math.round(performance.now() - T0);
      const last = trace[trace.length - 1];
      if (!last || last.dl !== dl || last.rg !== rg) trace.push({ t, dl, rg });
      if (dl > 0 && typeof rg === 'number' && rg > 0) return { ok: true, dl, rg, t, trace };
      if (dl > 0) {
        if (dlSince === null) dlSince = performance.now();
        if (performance.now() - dlSince >= POST_DL_WAIT) return { ok: true, dl, rg, t, trace };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, trace, t: HARD_TIMEOUT };
  });
}

async function triggerExportAndCollect(page) {
  await page.waitForTimeout(randInt(500, 2500));
  console.log('  → Triggering Export results (lg(622))');
  await page.locator('button:has-text("Export results")').click();

  console.log('  → Polling #lgexport textarea until data stabilises');
  const csv = await page.evaluate(async () => {
    const STABLE_MS = 1500;
    const MAX_MS = 30000;
    const POLL_MS = 200;
    const t0 = performance.now();
    let lastLen = -1;
    let stableSince = null;
    const trace = [];
    while (performance.now() - t0 < MAX_MS) {
      const ta = document.getElementById('lgexport');
      const len = ta ? (ta.value || '').length : 0;
      const elapsed = Math.round(performance.now() - t0);
      if (len !== lastLen) {
        trace.push({ t: elapsed, len });
        lastLen = len;
        stableSince = len > 0 ? performance.now() : null;
      } else if (len > 0 && stableSince !== null && performance.now() - stableSince >= STABLE_MS) {
        return { data: ta.value, trace, elapsed };
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return { data: null, trace, elapsed: Math.round(performance.now() - t0) };
  });

  console.log(`    Textarea growth trace: ${JSON.stringify(csv.trace)}`);
  console.log(`    Finished after ${csv.elapsed}ms`);
  return csv.data || null;
}

async function exportLeagueTask(page, sourceLeagueName, folder, repoRoot) {
  const outSubdir = resolve(dirname(fileURLToPath(import.meta.url)), 'out', folder);
  const csvOutputPath = join(outSubdir, 'leaguedata.csv');
  const playersOutputPath = join(outSubdir, 'players.json');
  const updatedParamsPath = join(outSubdir, 'league_params.json');
  const newFlagsDir = join(outSubdir, 'new_flags');

  await logEvent(folder, 'info', `Starting sync for "${sourceLeagueName}"…`);
  await page.waitForTimeout(randInt(500, 2500));
  console.log(`  → Opening league "${sourceLeagueName}" (with pagination)`);
  await clickLeagueByName(page, sourceLeagueName);

  await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });

  console.log('  → Waiting for league roster (DL) and round count (FL[RG]) to populate');
  const rosterReady = await waitForRosterAndRounds(page);
  console.log(`    Trace: ${JSON.stringify(rosterReady.trace)}`);
  if (!rosterReady.ok) {
    throw new Error('DL never populated within 15s after league click');
  }
  console.log(`    DL = ${rosterReady.dl} players, FL[RG] = ${rosterReady.rg} rounds played — ready after ${rosterReady.t}ms`);
  await logEvent(folder, 'info', `Opened the league — ${rosterReady.dl} players, ${rosterReady.rg} rounds so far.`);

  console.log('  → Extracting player roster (DL) for players.json');
  const players = await page.evaluate(() => {
    if (typeof DL === 'undefined' || !Array.isArray(DL)) return null;
    return DL.map((p) => ({ username: p.username, fl: p.fl, cname: p.cname }));
  });
  if (!players || players.length === 0) {
    console.warn('    DL not available or empty — skipping players.json');
  } else {
    await mkdir(outSubdir, { recursive: true });
    await writeFile(playersOutputPath, JSON.stringify(players, null, 2) + '\n', 'utf8');
    console.log(`  ✓ Wrote ${players.length} players to ${playersOutputPath}`);

    console.log('  → Player roster (alphabetical)');
    const sortedPlayers = [...players].sort((a, b) => a.username.localeCompare(b.username));
    const nameWidth = Math.max(...sortedPlayers.map((p) => p.username.length));
    for (const p of sortedPlayers) {
      const code = (p.fl || '').toUpperCase();
      console.log(`    ${p.username.padEnd(nameWidth)}  ${code}  ${p.cname || ''}`);
    }

    const leaguesRoot = join(repoRoot, 'leagues');
    let localParams = null;
    try {
      localParams = JSON.parse(await readFile(join(leaguesRoot, folder, 'league_params.json'), 'utf8'));
    } catch {
      console.warn(`  ⚠ Could not read leagues/${folder}/league_params.json — skipping league-config update`);
    }

    if (localParams) {
      const known = await buildKnownPlayers(leaguesRoot);
      const newPlayers = players.filter((p) => !known.has(p.username)).map((p) => p.username).sort();
      console.log('  → Player registry check (metadata.json + historical CSVs)');
      console.log(`    Registry size: ${known.size} known players`);
      console.log(`    ✓ Known players in roster: ${players.length - newPlayers.length}`);
      if (newPlayers.length === 0) {
        console.log('    ✓ No new players — all already in registry');
      } else {
        console.log(`    ⚠ ${newPlayers.length} NEW player(s) (never seen in any past league):`);
        for (const u of newPlayers) console.log(`      • ${u}`);
        await logEvent(folder, 'info', `${newPlayers.length} new player(s): ${newPlayers.join(', ')}`);
      }

      console.log('  → CustomFlags diff (External Source → local)');
      const diff = computeCustomFlagsDiff(localParams.CustomFlags, players);
      const noChanges = diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
      if (noChanges) {
        console.log('    ✓ No changes — local CustomFlags match External Source');
      } else {
        for (const a of diff.added) console.log(`    + ${a.username}: ${a.to} (new override)`);
        for (const c of diff.changed) console.log(`    ~ ${c.username}: ${c.from} → ${c.to}`);
        for (const r of diff.removed) console.log(`    - ${r.username}: ${r.from} (now uses default ${DEFAULT_FLAG})`);

        const updatedParams = { ...localParams, CustomFlags: diff.desired };
        await writeFile(updatedParamsPath, JSON.stringify(updatedParams, null, 2) + '\n', 'utf8');
        console.log(`  ✓ Updated config written to ${updatedParamsPath}`);
        console.log(`    (review and copy to leagues/${folder}/league_params.json when ready)`);
      }
    }

    const flagsDir = join(repoRoot, 'assets', 'flags');
    let existing = new Set();
    try {
      const entries = await readdir(flagsDir);
      existing = new Set(entries.filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/i, '').toUpperCase()));
    } catch {
      console.warn(`    assets/flags/ not readable — assuming empty`);
    }
    const needed = new Set(players.map((p) => (p.fl || '').toUpperCase()).filter(Boolean));
    const missing = [...needed].filter((code) => !existing.has(code)).sort();

    const flagUsage = {};
    for (const p of players) {
      const code = (p.fl || '').toUpperCase();
      if (!code) continue;
      if (!flagUsage[code]) flagUsage[code] = { cname: p.cname || code, users: [] };
      flagUsage[code].users.push(p.username);
    }

    console.log('  → Flag analysis');
    console.log(`    Total players: ${players.length}`);
    const usageLine = Object.entries(flagUsage)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, info]) => `${code} (${info.cname}) × ${info.users.length}`)
      .join(', ');
    console.log(`    Flags used: ${usageLine}`);
    console.log(`    Flags in repo (assets/flags/): ${[...existing].sort().join(', ') || '(none)'}`);

    if (missing.length === 0) {
      console.log('    ✓ No new flags needed — all player flags already in repo');
    } else {
      await logEvent(folder, 'info', `${missing.length} new flag(s): ${missing.join(', ')}`);
      console.log(`    ⚠ ${missing.length} new flag(s) detected:`);
      for (const code of missing) {
        const info = flagUsage[code];
        console.log(`      • ${code} (${info.cname}) — used by: ${info.users.join(', ')}`);
      }

      console.log('  → Fetching missing flags via fetch-flag.py');
      await mkdir(newFlagsDir, { recursive: true });
      const fetchScript = join(repoRoot, 'scripts', 'fetch-flag.py');
      let okCount = 0;
      const failed = [];
      for (const code of missing) {
        const res = spawnSync('python', [fetchScript, code, newFlagsDir], { encoding: 'utf8' });
        if (res.status === 0) {
          console.log(`    ✓ ${code} (${flagUsage[code].cname}): ${res.stdout.trim()}`);
          okCount++;
        } else {
          console.error(`    ✗ ${code} (${flagUsage[code].cname}) failed: ${res.stderr.trim() || res.stdout.trim()}`);
          failed.push(code);
        }
      }
      console.log(
        `  → Flag fetch summary: ${okCount}/${missing.length} downloaded to ${newFlagsDir}` +
          (failed.length ? ` (failed: ${failed.join(', ')})` : ''),
      );
    }
  }

  const baselineCtx = await getBaselinePlayedCount(folder, repoRoot);
  const baseline = baselineCtx?.baseline ?? null;
  const overridesForCheck = baselineCtx?.overrides ?? [];
  const baselineSource = process.env.SUPABASE_URL ? 'Supabase' : `leagues/${folder}/leaguedata.csv + overrides`;
  if (baseline === null) {
    console.log('  → CSV integrity baseline: none (first sync — check skipped)');
  } else {
    console.log(`  → CSV integrity baseline: ${baseline} played matches (post-overrides; source: ${baselineSource})`);
  }

  const MAX_EXPORT_ATTEMPTS = 3;
  let csvText = null;
  for (let attempt = 1; attempt <= MAX_EXPORT_ATTEMPTS; attempt++) {
    if (attempt === 2) {
      console.log(`  → Retry 2/${MAX_EXPORT_ATTEMPTS}: re-navigating to leagues list and re-opening "${sourceLeagueName}"`);
      await logEvent(folder, 'info', 'Reopening the league to fetch the data again…');
      await navigateToLeaguesList(page);
      await clickLeagueByName(page, sourceLeagueName);
      await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });
      const retryRoster = await waitForRosterAndRounds(page);
      console.log(`    Trace: ${JSON.stringify(retryRoster.trace)}`);
      if (!retryRoster.ok) throw new Error('DL never repopulated within 15s after retry re-entry');
    } else if (attempt === 3) {
      console.log(`  → Retry 3/${MAX_EXPORT_ATTEMPTS}: full disconnect + reconnect (logout, re-login, re-open "${sourceLeagueName}")`);
      await logEvent(folder, 'info', 'Signing in again to fetch the data…');
      await relogin(page);
      await navigateToLeaguesList(page);
      await clickLeagueByName(page, sourceLeagueName);
      await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });
      const retryRoster = await waitForRosterAndRounds(page);
      console.log(`    Trace: ${JSON.stringify(retryRoster.trace)}`);
      if (!retryRoster.ok) throw new Error('DL never repopulated within 15s after relogin re-entry');
    }

    const data = await triggerExportAndCollect(page);
    if (!data) {
      console.warn('    Textarea never populated within 30s — Export did not stream data.');
      if (attempt === MAX_EXPORT_ATTEMPTS) {
        throw new Error(`Export results popup never produced CSV data after ${MAX_EXPORT_ATTEMPTS} attempts`);
      }
      await logEvent(folder, 'info', "The site didn't return the data — retrying…");
      continue;
    }

    const newPlayed = applyOverrides(parseCSV(data), overridesForCheck).length;
    if (baseline === null || newPlayed >= baseline) {
      console.log(
        `  ✓ Integrity check passed: ${newPlayed} played (post-overrides)` +
          (baseline === null ? ' — first sync, no baseline' : ` ≥ baseline ${baseline}`),
      );
      const added = baseline === null ? null : newPlayed - baseline;
      await logEvent(folder, 'success',
        baseline === null
          ? `Data looks healthy — ${newPlayed} games (first sync).`
          : `Data looks healthy — ${newPlayed} games, none lost${added > 0 ? ` (+${added} new)` : ' (no new games)'}.`);
      csvText = data;
      break;
    }

    console.warn(
      `  ⚠ Integrity check FAILED on attempt ${attempt}/${MAX_EXPORT_ATTEMPTS}: ` +
        `effective played (after overrides) = ${newPlayed}, expected ≥ ${baseline} (matches don't disappear). ` +
        `Likely incomplete WS round delivery — will retry.`,
    );
    if (attempt < MAX_EXPORT_ATTEMPTS) {
      await logEvent(folder, 'info', 'Data looked incomplete — retrying…');
    }
    if (attempt === MAX_EXPORT_ATTEMPTS) {
      throw new Error(
        `External Source export integrity check failed after ${MAX_EXPORT_ATTEMPTS} attempts ` +
          `(attempt 1: in-place, attempt 2: re-nav, attempt 3: full relogin): ` +
          `last attempt yielded ${newPlayed} effective played, baseline ${baseline}. ` +
          `External Source is consistently under-delivering rounds — try again later or investigate.`,
      );
    }
  }

  const lines = csvText.split('\n').filter(Boolean).length;
  console.log(`  ✓ CSV: ${csvText.length} bytes, ${lines} lines`);
  await mkdir(outSubdir, { recursive: true });
  await writeFile(csvOutputPath, csvText, 'utf8');
  console.log(`  ✓ Saved to ${csvOutputPath}`);

  if (supabase) {
    console.log('  → Writing matches + match_history to Supabase');
    await writeMatchesToSupabase(folder, csvText);
    await reconcileMatchHistoryInSupabase(folder);
    console.log('  ✓ Supabase updated');
  }

  await logEvent(folder, 'success', `Sync complete — "${sourceLeagueName}" data updated.`);
}

/**
 * Upsert a league's matches table to match this CSV text (delete-stale + upsert,
 * keyed on league_id+round+player_a+player_b). Never touches admin-controlled
 * fields on the leagues row itself — only bumps last_updated, and only if the
 * row already exists (league creation stays an Admin operation).
 */
async function writeMatchesToSupabase(folder, csvText) {
  const { data: leagueRow } = await supabase.from('leagues').select('id').eq('id', folder).single();
  if (!leagueRow) {
    console.warn(`    ⚠ leagues row "${folder}" not found — skipping Supabase write (create the league via Admin first)`);
    return;
  }

  const { matches } = parseCSVAllWithRounds(csvText);

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

  if (matches.length > 0) {
    const rows = matches.map((m) => ({
      league_id: folder, round: m.round, player_a: m.playerA, player_b: m.playerB,
      pr_a: m.prA, luck_a: m.luckA, score_a: m.scoreA,
      pr_b: m.prB, luck_b: m.luckB, score_b: m.scoreB, played: m.played,
    }));
    const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'league_id,round,player_a,player_b' });
    if (error) throw new Error(`matches upsert failed for ${folder}: ${error.message}`);
  }

  await supabase.from('leagues').update({ last_updated: new Date().toISOString() }).eq('id', folder);
}

/**
 * Reconcile match_history for a league (same reconciliation rule as
 * js/admin/supabaseAdmin.js's reconcileMatchHistory — preserve existing
 * updated_at+source when numeric fields are unchanged and source isn't
 * 'manual', else stamp now()/source='csv'). Duplicated here rather than
 * shared, since this runs in Node against the service_role key while the
 * admin version runs in the browser against the anon+RLS session — two
 * legitimately different callers of the same rule.
 */
async function reconcileMatchHistoryInSupabase(folder) {
  const now = new Date().toISOString();

  const { data: matchRows, error: matchErr } = await supabase
    .from('matches').select('*').eq('league_id', folder).eq('played', true).order('round', { ascending: true });
  // A read failure must NOT be treated as "0 matches" — that would stale-delete
  // the whole history below. Abort the reconcile instead of wiping.
  if (matchErr) throw new Error(`match_history reconcile aborted for ${folder}: could not read matches — ${matchErr.message}`);
  const { data: overrideRows } = await supabase.from('manual_overrides').select('*').eq('league_id', folder);
  const { data: historyRows } = await supabase.from('match_history').select('*').eq('league_id', folder);

  // Refuse to reconcile a non-empty history down to nothing from an empty match
  // set. A league with existing history but suddenly 0 played matches is almost
  // certainly a transient/upstream glitch, not a real reset — skip rather than
  // wipe every pairing's history (the failure mode that collapsed B2 once).
  if ((matchRows || []).length === 0 && (historyRows || []).length > 0) {
    console.log(`  → Skipping match_history reconcile for ${folder}: 0 played matches but ${historyRows.length} existing history row(s) — refusing to wipe.`);
    return;
  }

  const key = (a, b) => [a, b].sort().join('|');
  const csvMatches = (matchRows || []).map((m) => ({
    playerA: m.player_a, playerB: m.player_b, scoreA: m.score_a, scoreB: m.score_b,
    prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b, round: m.round,
  }));
  const overrides = (overrideRows || []).map((o) => ({
    type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
    scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
  }));
  const previous = (historyRows || []).map((h) => ({
    playerA: h.player_a, playerB: h.player_b, scoreA: h.score_a, scoreB: h.score_b,
    prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b, round: h.round,
    updatedAt: h.updated_at, source: h.source,
  }));
  const prevByKey = new Map(previous.map((m) => [key(m.playerA, m.playerB), m]));

  const sameNumericFields = (a, b) =>
    a.scoreA === b.scoreA && a.scoreB === b.scoreB && a.prA === b.prA && a.prB === b.prB
    && a.luckA === b.luckA && a.luckB === b.luckB;

  const next = [];
  for (const m of csvMatches) {
    const k = key(m.playerA, m.playerB);
    const prev = prevByKey.get(k);
    if (prev && sameNumericFields(prev, m) && prev.source !== 'manual') {
      next.push({ ...prev, round: m.round });
    } else if (prev && prev.source === 'manual') {
      next.push({ ...prev, round: m.round });
    } else {
      next.push({
        playerA: m.playerA, playerB: m.playerB, scoreA: m.scoreA, scoreB: m.scoreB,
        prA: m.prA, prB: m.prB, luckA: m.luckA, luckB: m.luckB, round: m.round,
        updatedAt: now, source: 'csv',
      });
    }
  }

  for (const o of overrides) {
    const k = key(o.playerA, o.playerB);
    let record;
    if (o.type === 'result') {
      record = { playerA: o.playerA, playerB: o.playerB, scoreA: o.scoreA, scoreB: o.scoreB, prA: o.prA, prB: o.prB, luckA: o.luckA, luckB: o.luckB };
    } else if (o.type === 'technical_win') {
      const aWins = o.winner === o.playerA;
      record = { playerA: o.playerA, playerB: o.playerB, scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1, prA: null, prB: null, luckA: null, luckB: null };
    } else if (o.type === 'technical_draw') {
      record = { playerA: o.playerA, playerB: o.playerB, scoreA: 0, scoreB: 0, prA: null, prB: null, luckA: null, luckB: null };
    } else if (o.type === 'not_played') {
      record = { playerA: o.playerA, playerB: o.playerB, scoreA: 0, scoreB: 0, prA: 0, prB: 0, luckA: 0, luckB: 0 };
    } else continue;

    const idx = next.findIndex((x) => key(x.playerA, x.playerB) === k);
    const stamped = { ...record, round: idx >= 0 ? next[idx].round : null, updatedAt: now, source: 'manual' };
    if (idx >= 0) next[idx] = stamped;
    else next.push(stamped);
  }

  const freshKeys = new Set(next.map((m) => key(m.playerA, m.playerB)));
  const staleIds = (historyRows || [])
    .filter((row) => !freshKeys.has(key(row.player_a, row.player_b)))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('match_history').delete().in('id', staleIds);
    if (error) throw new Error(`match_history stale-delete failed for ${folder}: ${error.message}`);
  }
  if (next.length > 0) {
    const rows = next.map((m) => ({
      league_id: folder, player_a: m.playerA, player_b: m.playerB,
      score_a: m.scoreA, score_b: m.scoreB, pr_a: m.prA, pr_b: m.prB, luck_a: m.luckA, luck_b: m.luckB,
      round: m.round, source: m.source, updated_at: m.updatedAt,
    }));
    const { error } = await supabase.from('match_history').upsert(rows, { onConflict: 'league_id,player_a,player_b' });
    if (error) throw new Error(`match_history upsert failed for ${folder}: ${error.message}`);
  }
}

console.log(`→ Sync mode: ${SYNC_MODE}`);

const viewport = VIEWPORTS[randInt(0, VIEWPORTS.length - 1)];
console.log(`→ Viewport: ${viewport.width}×${viewport.height}`);

const hasSession = existsSync(SESSION_PATH);
console.log(`→ Saved session: ${hasSession ? 'found, will try to restore' : 'none, fresh login required'}`);

// Connection-phase events (browser / session / login) belong to the WHOLE run,
// not to any one league — logging into the site opens the menu of all leagues at
// once. So they are written ONCE as a site-level event (league_id = null) and
// shown once in the Admin Run Now global log, never duplicated per league.
async function logConnectionEvent(level, message) {
  await logSiteEvent(level, message);
}

await logConnectionEvent('info', 'Preparing a clean browser environment…');
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport,
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
  storageState: hasSession ? SESSION_PATH : undefined,
});
const page = await ctx.newPage();
if (hasSession) await logConnectionEvent('info', 'Restoring your saved session (cookies)…');

const sessionStartedAt = Date.now();
const taskResults = [];
let exportError = null;

let sessionDurationS = 0;
let sequence = [];

try {
  if (SYNC_MODE === 'full') {
    const preDelayMs = randInt(0, 59999);
    console.log(`→ Anti-bot pre-delay: ${preDelayMs}ms (~${(preDelayMs / 1000).toFixed(1)}s)`);
    await page.waitForTimeout(preDelayMs);

    sessionDurationS = randInt(60, 3600);
    console.log(`→ Planned session duration: ${sessionDurationS}s (~${(sessionDurationS / 60).toFixed(1)}min, uniform 1-60min)`);

    const sideTaskPool = [
      { kind: 'browseLiveMatches', label: 'browse Live matches', durationS: randInt(15, 90) },
      { kind: 'browseChampions', label: 'browse Champions', durationS: randInt(15, 60) },
      { kind: 'browseAchievements', label: 'browse Achievements', durationS: randInt(15, 45) },
      { kind: 'browsePractice', label: 'browse Practice', durationS: randInt(15, 45) },
      { kind: 'browsePrivateDB', label: 'browse Private DB', durationS: randInt(15, 45) },
      { kind: 'scrollHere', label: 'scroll current page', durationS: randInt(10, 30) },
      { kind: 'idle', label: 'idle pause', durationS: randInt(20, 60) },
      { kind: 'changeStatus', label: 'change status flag (2-3 toggles)', durationS: randInt(15, 40) },
    ];

    const sideCount = randInt(2, 4);
    const sideTasks = shuffle(sideTaskPool).slice(0, sideCount);

    const exportTask = { kind: 'EXPORT', label: '✦ Export league data (real task)', durationS: 30 };
    sequence = [...sideTasks];
    const exportPos = randInt(1, sequence.length);
    sequence.splice(exportPos, 0, exportTask);

    const plannedSum = sequence.reduce((s, t) => s + t.durationS, 0);
    const remaining = sessionDurationS - plannedSum;
    if (remaining > 10) {
      sequence.push({ kind: 'idle', label: 'wind-down idle', durationS: remaining });
    }

    console.log(`→ Planned action sequence:`);
    sequence.forEach((t, i) => {
      const marker = t.kind === 'EXPORT' ? '✦' : ' ';
      console.log(`  ${String(i + 1).padStart(2)}. ${marker} ${t.label} (~${t.durationS}s)`);
    });
    console.log(`  ${String(sequence.length + 1).padStart(2)}.   disconnect + save session cookie`);
  } else {
    console.log(`→ Fast mode: skipping pre-delay and side tasks — login + export only`);
  }

  console.log(`→ Opening ${SITE_URL}`);
  await logConnectionEvent('info', 'Connecting to the source site…');
  try {
  await page.goto(SITE_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.addStyleTag({
    content: '#introdialog, #myrooms, #newsdialog, #welcomedialog { display: none !important; }',
  });

  await page.waitForTimeout(2000);

  const enterClicked = await page.evaluate(() => {
    const enter = Array.from(document.querySelectorAll('button')).find(
      (b) => /^Enter$/.test((b.textContent || '').trim()) && b.offsetParent !== null,
    );
    if (!enter) return false;
    enter.click();
    return true;
  });
  if (enterClicked) {
    console.log('→ Clicked Enter (gateway page)');
    await page.waitForTimeout(1500);
  }

  const loginVisible = await page
    .locator('button:has-text("Login"):not(.dialogbutton)')
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (loginVisible) {
    console.log(hasSession ? '→ Saved session expired — running full login' : '→ No saved session — running full login');
    await logConnectionEvent('info', hasSession ? 'Saved session expired — signing in again…' : 'Signing in to the source site…');
    await page.locator('button:has-text("Login"):not(.dialogbutton)').click();

    console.log('→ Typing credentials (human-like delays, 80-200ms per keystroke)');
    await page.locator('#username').click();
    await page.locator('#username').pressSequentially(username, { delay: randInt(80, 200) });
    await page.locator('#pass').click();
    await page.locator('#pass').pressSequentially(password, { delay: randInt(80, 200) });

    console.log('→ Submitting login');
    await page.locator('button.dialogbutton:has-text("Login")').click();

    await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });
  } else {
    console.log('→ Session restored from cache, skipping login');
    await logConnectionEvent('info', 'Session restored — no login needed.');
    await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });
  }
  } catch (err) {
    // Reaching the site / gateway / signing in failed — a single shared failure
    // for the whole run. Report it ONCE at site level (not per league), then
    // rethrow so the outer handler still screenshots and fails the job.
    await logSiteEvent('error', friendlyStartupError(err));
    throw err;
  }

  await mkdir(dirname(SESSION_PATH), { recursive: true });
  await ctx.storageState({ path: SESSION_PATH });
  console.log(`✓ Saved session state to ${SESSION_PATH}`);

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  let targets;
  const LEAGUES_JSON = (process.env.LEAGUES || '').trim();
  if (LEAGUES_JSON) {
    try {
      targets = JSON.parse(LEAGUES_JSON);
    } catch (e) {
      throw new Error(`Invalid LEAGUES JSON: ${e.message}`);
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error('LEAGUES must be a non-empty array');
    }
    for (const t of targets) {
      if (!t.folder || !t.source_league_name) {
        throw new Error(`Each LEAGUES entry must have "folder" and "source_league_name" — got ${JSON.stringify(t)}`);
      }
    }
    console.log(`→ Sync targets (${targets.length}) from LEAGUES env:`);
    targets.forEach((t, i) => console.log(`  ${i + 1}. "${t.source_league_name}" → ${t.folder}`));
  } else {
    const leaguesRoot = join(repoRoot, 'leagues');
    const active = await findActiveLeague(leaguesRoot);
    if (!active) {
      throw new Error('No active league found (no league_params.json with "Running": true) and LEAGUES env not set');
    }
    targets = [{ folder: active.folder, source_league_name: 'Shabi Israel' }];
    console.log(`→ Sync target (auto-detected active): "${targets[0].source_league_name}" → ${targets[0].folder}`);
  }

  async function runAllExports() {
    const leagueResults = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      console.log(`  → League ${i + 1}/${targets.length}: "${target.source_league_name}" → ${target.folder}`);
      try {
        await navigateToLeaguesList(page);
        await exportLeagueTask(page, target.source_league_name, target.folder, repoRoot);
        leagueResults.push({ folder: target.folder, status: 'ok' });
      } catch (err) {
        console.error(`  ✗ League "${target.source_league_name}" failed after all retries: ${err.message}`);
        await logEvent(target.folder, 'error', friendlyLeagueError(err, target.source_league_name));
        leagueResults.push({ folder: target.folder, status: 'fail', error: err.message });
      }
    }
    const failed = leagueResults.filter((r) => r.status === 'fail');
    if (failed.length > 0) {
      console.warn(`  ⚠ ${failed.length}/${targets.length} league(s) failed: ${failed.map((r) => r.folder).join(', ')}`);
      if (failed.length === targets.length) {
        throw new Error(`All ${targets.length} leagues failed to sync`);
      }
    }
  }

  if (SYNC_MODE === 'fast') {
    const start = Date.now();
    try {
      await runAllExports();
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  ✓ Export done in ${elapsed}s (${targets.length} league${targets.length === 1 ? '' : 's'})`);
      taskResults.push({ kind: 'EXPORT', label: `✦ Export ${targets.length} league${targets.length === 1 ? '' : 's'} (fast mode)`, status: 'ok', elapsed });
    } catch (err) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.error(`  ✗ Export failed after ${elapsed}s: ${err.message}`);
      taskResults.push({ kind: 'EXPORT', label: `✦ Export ${targets.length} league${targets.length === 1 ? '' : 's'} (fast mode)`, status: 'fail', error: err.message, elapsed });
      exportError = err;
    }
  } else {
    for (let i = 0; i < sequence.length; i++) {
      const task = sequence[i];
      console.log(`→ [${i + 1}/${sequence.length}] ${task.label} (~${task.durationS}s)`);
      const start = Date.now();
      try {
        switch (task.kind) {
          case 'idle':
            await justIdle(page, task.durationS);
            break;
          case 'scrollHere':
            await scrollPage(page, task.durationS);
            break;
          case 'browseLiveMatches':
            await browseTab(page, 'Live matches', task.durationS);
            break;
          case 'browseChampions':
            await browseTab(page, 'Champions', task.durationS);
            break;
          case 'browseAchievements':
            await browseTab(page, 'Achievements', task.durationS);
            break;
          case 'browsePractice':
            await browseTab(page, 'Practice', task.durationS);
            break;
          case 'browsePrivateDB':
            await browseTab(page, 'Private DB', task.durationS);
            break;
          case 'changeStatus':
            await changeStatusTask(page, task.durationS);
            break;
          case 'EXPORT':
            await runAllExports();
            break;
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`  ✓ done in ${elapsed}s`);
        taskResults.push({ ...task, status: 'ok', elapsed });
      } catch (err) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.error(`  ✗ failed after ${elapsed}s: ${err.message}`);
        taskResults.push({ ...task, status: 'fail', error: err.message, elapsed });
        if (task.kind === 'EXPORT') {
          exportError = err;
          break;
        }
      }
    }
  }

  try {
    await ctx.storageState({ path: SESSION_PATH });
  } catch {}

  const totalElapsed = Math.round((Date.now() - sessionStartedAt) / 1000);
  if (SYNC_MODE === 'full') {
    console.log(`→ Session summary (${totalElapsed}s total, plan target ${sessionDurationS}s)`);
  } else {
    console.log(`→ Session summary (${totalElapsed}s total, fast mode)`);
  }
  taskResults.forEach((r, i) => {
    const icon = r.status === 'ok' ? '✓' : '✗';
    const marker = r.kind === 'EXPORT' ? '✦' : ' ';
    console.log(`  ${String(i + 1).padStart(2)}. ${icon} ${marker} ${r.label}: ${r.elapsed}s${r.error ? ` (${r.error})` : ''}`);
  });
  console.log(`→ Disconnecting`);

  if (exportError) throw exportError;
} catch (err) {
  console.error('✗ Sync failed:', err.message);
  try {
    const shotPath = resolve(OUT_DIR, 'failure.png');
    await mkdir(dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });
    console.error(`✗ Saved failure screenshot to ${shotPath}`);
  } catch (shotErr) {
    console.error('✗ Could not capture failure screenshot:', shotErr.message);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}