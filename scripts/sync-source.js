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
import {
  validateCsvStructure, describeLeagueShape, collectPlayed,
  findPlayedRegressions, splitRegressions, formatRegressions,
} from '../js/data/csvIntegrity.js';
import { computeMatchHistoryReconcile } from '../js/data/matchHistoryReconcile.js';

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
 * getLeagueBaseline / writeMatchesToSupabase / reconcileMatchHistoryInSupabase).
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
    return `The league opened but its players never finished loading. The source may be slow, or the league may have no data yet — try again in a few minutes.`;
  }
  if (/never produced CSV data|no usable CSV/i.test(m)) {
    return `The league opened but the source returned nothing to export. If it has no played matches yet that's expected; otherwise the export timed out — try again.`;
  }
  if (/CSV\/league mismatch/i.test(m)) {
    return `The data the source returned doesn't match this league — a different roster, a different number of rounds, or a broken file. Nothing was changed. Check that the Source League Name points at the right league on the source site.`;
  }
  if (/CSV regression/i.test(m)) {
    return `The source returned data that would have erased results already saved for this league, so nothing was changed and your results are safe. This is almost always a temporary source glitch — try again in a few minutes.`;
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
 * Everything the two integrity layers need about the league's CURRENT state:
 *
 *   shape            — roster / round count / total match rows (LAYER 1 target)
 *   previouslyPlayed — every pairing that already HAS a result, from the data or
 *                      from a manual override (LAYER 2 target)
 *   overrides        — re-applied to the fresh CSV for an apples-to-apples count
 *
 * Two source modes, selected by env vars:
 *   Phase 1 (no Supabase configured): read CSV + manual_overrides.json from the
 *     repo working tree. Same logic the dashboard renders with.
 *   Phase 2 (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set): query the database.
 *     Repo files are ignored.
 *
 * Returns null for a brand-new league — nothing to compare against, so LAYER 1
 * only self-checks the CSV and LAYER 2 is a no-op.
 */
async function getLeagueBaseline(folder, repoRoot) {
  let allMatches = []; // every row incl. unplayed; 'Bye' already excluded
  let overrides = [];

  if (supabase) {
    const { data: overrideRows, error: ovErr } = await supabase
      .from('manual_overrides')
      .select('*')
      .eq('league_id', folder);
    if (ovErr) throw new Error(`Supabase baseline: manual_overrides query failed: ${ovErr.message}`);

    // NOTE: no .eq('played', true) — LAYER 1 needs the league's FULL shape
    // (unplayed rows included), not just the played ones.
    const { data: matchRows, error: mErr } = await supabase
      .from('matches')
      .select('*')
      .eq('league_id', folder);
    if (mErr) throw new Error(`Supabase baseline: matches query failed: ${mErr.message}`);

    overrides = (overrideRows || []).map((o) => ({
      type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
      scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
    }));
    allMatches = (matchRows || []).map((m) => ({
      playerA: m.player_a, prA: m.pr_a, luckA: m.luck_a, scoreA: m.score_a,
      playerB: m.player_b, prB: m.pr_b, luckB: m.luck_b, scoreB: m.score_b,
      round: m.round, played: m.played,
    }));
  } else {
    try {
      const csv = await readFile(join(repoRoot, 'leagues', folder, 'leaguedata.csv'), 'utf8');
      const overridesRaw = await readFile(
        join(repoRoot, 'leagues', folder, 'manual_overrides.json'),
        'utf8',
      ).catch(() => '{"overrides":[]}');
      overrides = JSON.parse(overridesRaw).overrides || [];
      allMatches = parseCSVAllWithRounds(csv).matches;
    } catch {
      return null;
    }
  }

  if (allMatches.length === 0 && overrides.length === 0) return null; // first-ever sync

  return {
    shape: describeLeagueShape(allMatches),
    previouslyPlayed: collectPlayed(allMatches, overrides),
    overrides,
  };
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

/**
 * Wait for the league's roster (DL) to populate before exporting.
 *
 * This no longer gates on FL[RG] — the source's "rounds played" counter — which was
 * a leftover from an earlier design and measures the wrong thing: the exported CSV
 * ALWAYS carries every round of the round-robin, with not-yet-played matches present
 * as all-zero rows. So the round counter says nothing about export completeness; the
 * two integrity layers (js/data/csvIntegrity.js) establish that instead.
 *
 * DL IS STALE ON ENTRY. It is a page global that still holds whatever the PREVIOUS
 * page/league left in it, so `DL.length > 0` is true the instant we arrive and means
 * nothing. Returning on that read gives the previous league's roster (or the Live
 * matches list, whose entries have no `username` at all — which is how this surfaced:
 * a cryptic "Cannot read properties of undefined (reading 'localeCompare')" while
 * sorting the roster). So we require all three:
 *   • SETTLE_MS since DL first looked non-empty — the window in which the page swaps
 *     in the real roster (this is the check whose removal caused the bug),
 *   • DL stable (same length) for STABLE_MS,
 *   • the entries actually LOOK like a roster (they carry `username`).
 */
async function waitForRoster(page, prevFingerprint) {
  return await page.evaluate(async (prevFp) => {
    const HARD_TIMEOUT = 15000;
    const SETTLE_MS = 5000;
    const STABLE_MS = 1500;
    const T0 = performance.now();
    const trace = [];
    let dlSince = null;
    let stableSince = null;
    let lastDl = -1;

    // Identity of what DL currently holds. Used to prove the roster actually
    // BELONGS to the league we just opened: in a multi-league run the global is
    // not reset between leagues, so a league whose roster never loads would
    // silently inherit the previous league's — and we'd write its players.json
    // and detect its flags against the wrong roster.
    const fingerprint = () => {
      if (typeof DL === 'undefined' || !Array.isArray(DL) || DL.length === 0) return '';
      const first = DL[0] && DL[0].username ? DL[0].username : '?';
      const last = DL[DL.length - 1] && DL[DL.length - 1].username ? DL[DL.length - 1].username : '?';
      return `${DL.length}|${first}|${last}`;
    };

    // ONE malformed entry must not discard an otherwise valid roster — the caller
    // filters those out. (Requiring EVERY entry to be named is what rejected a real
    // 21-player roster that had a single nameless row; the previous code instead
    // sorted it and died on `undefined.localeCompare`.)
    const rosterShaped = () =>
      typeof DL !== 'undefined' && Array.isArray(DL) && DL.length > 0
      && DL.some((p) => p && typeof p.username === 'string' && p.username.length > 0);

    // What DL actually holds, for diagnosis when it isn't the roster we expect.
    const sampleDl = () => {
      if (typeof DL === 'undefined' || !Array.isArray(DL) || DL.length === 0) return null;
      try {
        return { keys: Object.keys(DL[0] || {}).slice(0, 15), first: JSON.stringify(DL[0]).slice(0, 240) };
      } catch { return { keys: null, first: String(DL[0]).slice(0, 120) }; }
    };

    while (performance.now() - T0 < HARD_TIMEOUT) {
      const dl = (typeof DL !== 'undefined' && Array.isArray(DL)) ? DL.length : 0;
      const shaped = rosterShaped();
      const fp = fingerprint();
      const fresh = !prevFp || fp !== prevFp; // must not be the PREVIOUS league's roster
      const t = Math.round(performance.now() - T0);

      if (dl !== lastDl) {
        trace.push({ t, dl, shaped, fresh });
        lastDl = dl;
        stableSince = dl > 0 ? performance.now() : null;
      }
      if (dl > 0 && dlSince === null) dlSince = performance.now();

      if (shaped && fresh && dlSince !== null
          && performance.now() - dlSince >= SETTLE_MS
          && stableSince !== null && performance.now() - stableSince >= STABLE_MS) {
        return { ok: true, dl, t, trace, fingerprint: fp, sample: sampleDl() };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      ok: false, dl: lastDl, trace, t: HARD_TIMEOUT, fingerprint: fingerprint(),
      stale: !!prevFp && fingerprint() === prevFp,
      sample: sampleDl(),
    };
  }, prevFingerprint || '');
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

  // Fingerprint DL BEFORE opening the league. The source never resets this global
  // between leagues, so in a multi-league run the next league inherits the previous
  // one's roster if its own never loads. Comparing against this proves the roster we
  // read afterwards is really THIS league's.
  const prevFingerprint = await page.evaluate(() => {
    if (typeof DL === 'undefined' || !Array.isArray(DL) || DL.length === 0) return '';
    const f = DL[0] && DL[0].username ? DL[0].username : '?';
    const l = DL[DL.length - 1] && DL[DL.length - 1].username ? DL[DL.length - 1].username : '?';
    return `${DL.length}|${f}|${l}`;
  });

  console.log(`  → Opening league "${sourceLeagueName}" (with pagination)`);
  await clickLeagueByName(page, sourceLeagueName);

  await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });

  // The roster (DL) is NOT load-bearing for the sync. It feeds players.json and
  // new-flag detection only — the league's actual results come from the CSV export,
  // which is validated by its own two integrity layers (js/data/csvIntegrity.js).
  // So an unreadable DL is a WARNING, never a failure: we skip the roster work and
  // still export the results. (Treating it as fatal is what turned a cosmetic
  // problem into "all leagues failed" — and before that, into a bare
  // `undefined.localeCompare` crash that aborted the export before it ever ran.)
  console.log('  → Waiting for the league roster (DL) to settle');
  const rosterReady = await waitForRoster(page, prevFingerprint);
  console.log(`    Trace: ${JSON.stringify(rosterReady.trace)}`);

  let players = null;
  if (!rosterReady.ok) {
    const why = rosterReady.stale
      ? `still the PREVIOUS league's roster (${rosterReady.fingerprint}) — it never reloaded`
      : `${rosterReady.dl} entries, none player-shaped`;
    console.warn(`  ⚠ Roster (DL) unusable — ${why}.`);
    console.warn(`    DL sample: ${JSON.stringify(rosterReady.sample)}`);
    console.warn('    Skipping players.json + flag detection; continuing to the CSV export.');
    await logEvent(folder, 'warning',
      "Couldn't read the player list from the source, so new players and flags weren't checked this time. The match results are still being synced normally.");
  } else {
    console.log(`    DL = ${rosterReady.dl} players — ready after ${rosterReady.t}ms`);
    await logEvent(folder, 'info', `Opened the league — ${rosterReady.dl} players.`);

    console.log('  → Extracting player roster (DL) for players.json');
    players = await page.evaluate(() => {
      if (typeof DL === 'undefined' || !Array.isArray(DL)) return null;
      return DL
        .filter((p) => p && typeof p.username === 'string' && p.username.length > 0)
        .map((p) => ({ username: p.username, fl: p.fl, cname: p.cname }));
    });

    // A roster entry with no username is a real thing on the source (a player who
    // joined but has no name set yet). It must not silently vanish: it's skipped
    // here, but the admin needs to know the roster is one short — and it's exactly
    // the row that used to crash the sort with `undefined.localeCompare`.
    const nameless = rosterReady.dl - (players ? players.length : 0);
    if (nameless > 0) {
      console.warn(`  ⚠ ${nameless} roster entr${nameless > 1 ? 'ies have' : 'y has'} no username on the source — skipped.`);
      await logEvent(folder, 'warning',
        `${nameless} player${nameless > 1 ? 's' : ''} in this league ${nameless > 1 ? 'have' : 'has'} no name set on the source site, so ${nameless > 1 ? 'they were' : 'it was'} left out of the player list. The match results are unaffected.`);
    }
  }
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

  const baselineCtx = await getLeagueBaseline(folder, repoRoot);
  const expectedShape = baselineCtx?.shape ?? null;
  const previouslyPlayed = baselineCtx?.previouslyPlayed ?? [];
  const overridesForCheck = baselineCtx?.overrides ?? [];
  const baselineSource = process.env.SUPABASE_URL ? 'Supabase' : `leagues/${folder}/leaguedata.csv + overrides`;
  if (!expectedShape) {
    console.log('  → Integrity baseline: none (first sync — structure is taken from this CSV)');
  } else {
    console.log(
      `  → Integrity baseline (${baselineSource}): ${expectedShape.rounds} rounds, ` +
        `${expectedShape.players.size} players, ${expectedShape.totalMatches} match rows, ` +
        `${previouslyPlayed.length} already played`,
    );
  }

  const MAX_EXPORT_ATTEMPTS = 3;
  let csvText = null;
  // Carried out of the loop so the post-loop code knows WHY the last attempt was
  // unhappy: a structure failure is terminal (never write), a regression is not
  // (write, but restore what the source dropped and tell the admin).
  let lastStructureErrors = null;
  let lastRegressions = null;
  for (let attempt = 1; attempt <= MAX_EXPORT_ATTEMPTS; attempt++) {
    if (attempt === 2) {
      console.log(`  → Retry 2/${MAX_EXPORT_ATTEMPTS}: re-navigating to leagues list and re-opening "${sourceLeagueName}"`);
      await logEvent(folder, 'info', 'Reopening the league to fetch the data again…');
      await navigateToLeaguesList(page);
      await clickLeagueByName(page, sourceLeagueName);
      await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });
      // Same rule as the first entry: the roster is not load-bearing, so a bad DL
      // must not abort the retry — only the export result matters here.
      const retryRoster = await waitForRoster(page);
      console.log(`    Trace: ${JSON.stringify(retryRoster.trace)}`);
      if (!retryRoster.ok) console.warn('    ⚠ Roster (DL) still unusable after re-entry — exporting anyway.');
    } else if (attempt === 3) {
      console.log(`  → Retry 3/${MAX_EXPORT_ATTEMPTS}: full disconnect + reconnect (logout, re-login, re-open "${sourceLeagueName}")`);
      await logEvent(folder, 'info', 'Signing in again to fetch the data…');
      await relogin(page);
      await navigateToLeaguesList(page);
      await clickLeagueByName(page, sourceLeagueName);
      await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });
      const retryRoster = await waitForRoster(page);
      console.log(`    Trace: ${JSON.stringify(retryRoster.trace)}`);
      if (!retryRoster.ok) console.warn('    ⚠ Roster (DL) still unusable after relogin — exporting anyway.');
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

    // ── LAYER 1 — does this CSV belong to THIS league? ──────────────────
    // Roster / rounds / rows-per-round / column layout are fixed at league
    // creation. A mismatch means we were handed someone else's data (or junk),
    // and nothing may be written from it.
    const structural = validateCsvStructure(data, expectedShape);
    if (!structural.ok) {
      lastStructureErrors = structural.errors;
      lastRegressions = null;
      console.warn(`  ⚠ CSV does not match the league (attempt ${attempt}/${MAX_EXPORT_ATTEMPTS}):`);
      for (const e of structural.errors) console.warn(`      • ${e}`);
      if (attempt < MAX_EXPORT_ATTEMPTS) {
        await logEvent(folder, 'info', "The data doesn't match this league — fetching it again…");
        continue;
      }
      break; // terminal — handled after the loop
    }

    // ── LAYER 2 — did a match that already has a result come back unplayed? ──
    // Only a REAL regression counts (played per the data, unplayed in this CSV) —
    // that's the source serving a stale/partial export. An 'overridden' one is a
    // manual override, which the source has never heard of: it is EXPECTED to look
    // unplayed in the CSV, so it warns and never blocks.
    const { matches: newMatches } = parseCSVAllWithRounds(data);
    const { real, overridden } = splitRegressions(findPlayedRegressions(newMatches, previouslyPlayed));
    if (real.length > 0) {
      lastStructureErrors = null;
      lastRegressions = real;
      console.warn(
        `  ⚠ ${real.length} already-played match(es) came back unplayed ` +
          `(attempt ${attempt}/${MAX_EXPORT_ATTEMPTS}): ${formatRegressions(real)}`,
      );
      if (attempt < MAX_EXPORT_ATTEMPTS) {
        await logEvent(folder, 'info', 'Some already-played games are missing from the data — fetching it again…');
        continue;
      }
      break; // terminal — handled after the loop, nothing is written
    }

    // Both layers clean (bar manual overrides, which are expected — warn only).
    lastStructureErrors = null;
    lastRegressions = null;
    if (overridden.length > 0) {
      console.warn(
        `  ⚠ ${overridden.length} manually-overridden match(es) are unplayed at the source (expected): ` +
          formatRegressions(overridden, 50),
      );
      await logEvent(folder, 'warning',
        `${overridden.length} match${overridden.length > 1 ? 'es' : ''} in this league ${overridden.length > 1 ? 'have' : 'has'} a manual result that the source doesn't have: ` +
          `${formatRegressions(overridden)}. ${overridden.length > 1 ? 'They were' : 'It was'} kept as-is.`);
    }
    const newPlayed = applyOverrides(parseCSV(data), overridesForCheck).length;
    const added = expectedShape ? newPlayed - previouslyPlayed.length : null;
    console.log(
      `  ✓ Integrity checks passed: CSV matches the league; ${newPlayed} played (post-overrides)` +
        (expectedShape ? `, none lost (was ${previouslyPlayed.length})` : ' — first sync, no baseline'),
    );
    await logEvent(folder, 'success',
      !expectedShape
        ? `Data looks healthy — ${newPlayed} games (first sync).`
        : `Data looks healthy — ${newPlayed} games, none lost${added > 0 ? ` (+${added} new)` : ' (no new games)'}.`);
    csvText = data;
    break;
  }

  // Both failures are TERMINAL and mean the same thing for the data: a CSV WAS
  // produced, but applying it would damage the league — so the league's results are
  // left exactly as they were, and the log says which of the two it was.
  if (lastStructureErrors) {
    await logEvent(folder, 'error',
      `The data was downloaded but NOT applied — it doesn't match this league, so nothing was updated. ` +
        `${lastStructureErrors[0]}`);
    throw new Error(
      `CSV/league mismatch after ${MAX_EXPORT_ATTEMPTS} attempts ` +
        `(attempt 1: in-place, attempt 2: re-nav, attempt 3: full relogin): ${lastStructureErrors.join(' ')}`,
    );
  }
  if (lastRegressions) {
    await logEvent(folder, 'error',
      `The data was downloaded but NOT applied — it would have erased ${lastRegressions.length} already-played ` +
        `result${lastRegressions.length > 1 ? 's' : ''}: ${formatRegressions(lastRegressions)}. ` +
        `Your results are unchanged. This is usually a temporary source glitch — try again shortly.`);
    throw new Error(
      `CSV regression after ${MAX_EXPORT_ATTEMPTS} attempts ` +
        `(attempt 1: in-place, attempt 2: re-nav, attempt 3: full relogin): ` +
        `${lastRegressions.length} already-played match(es) came back unplayed: ${formatRegressions(lastRegressions, 50)}`,
    );
  }
  if (!csvText) {
    throw new Error(`Export produced no usable CSV after ${MAX_EXPORT_ATTEMPTS} attempts`);
  }

  const lines = csvText.split('\n').filter(Boolean).length;
  console.log(`  ✓ CSV: ${csvText.length} bytes, ${lines} lines`);
  await mkdir(outSubdir, { recursive: true });
  // The file on disk stays the RAW export — the untouched artifact of what the
  // source actually served. The merged result below is what we treat as truth.
  await writeFile(csvOutputPath, csvText, 'utf8');
  console.log(`  ✓ Saved to ${csvOutputPath}`);

  // Past both layers: this CSV is this league's, and it loses nothing. Manual
  // overrides are re-applied downstream (they always win over the CSV), so the
  // 'overridden' warnings above cost nothing here.
  const matchesToWrite = parseCSVAllWithRounds(csvText).matches;

  if (supabase) {
    console.log('  → Writing matches + match_history to Supabase');
    await writeMatchesToSupabase(folder, matchesToWrite);
    await reconcileMatchHistoryInSupabase(folder);
    console.log('  ✓ Supabase updated');
  }

  await logEvent(folder, 'success', `Sync complete — "${sourceLeagueName}" data updated.`);
}

/**
 * Upsert a league's matches table to match this match set (delete-stale + upsert,
 * keyed on league_id+round+player_a+player_b). Never touches admin-controlled
 * fields on the leagues row itself — only bumps last_updated, and only if the
 * row already exists (league creation stays an Admin operation).
 *
 * Takes the already-parsed matches rather than raw CSV: by the time we get here the
 * CSV has cleared both integrity layers (js/data/csvIntegrity.js), and the caller
 * already holds the parsed set.
 */
// Postgres `numeric` round-trips through PostgREST as a string; parsed CSV gives
// numbers. Compare by value so "0" and 0 aren't read as a change.
function numEq(x, y) {
  if (x === null || x === undefined) return y === null || y === undefined;
  if (y === null || y === undefined) return false;
  return Number(x) === Number(y);
}
function sameMatchRow(row, m) {
  return numEq(row.pr_a, m.prA) && numEq(row.luck_a, m.luckA) && numEq(row.score_a, m.scoreA)
      && numEq(row.pr_b, m.prB) && numEq(row.luck_b, m.luckB) && numEq(row.score_b, m.scoreB)
      && row.played === m.played;
}

async function writeMatchesToSupabase(folder, matches) {
  const { data: leagueRow } = await supabase.from('leagues').select('id').eq('id', folder).single();
  if (!leagueRow) {
    console.warn(`    ⚠ leagues row "${folder}" not found — skipping Supabase write (create the league via Admin first)`);
    return;
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('matches')
    .select('id, round, player_a, player_b, pr_a, luck_a, score_a, pr_b, luck_b, score_b, played')
    .eq('league_id', folder);
  if (fetchErr) throw new Error(`matches fetch failed for ${folder}: ${fetchErr.message}`);

  const keyOf = (r, a, b) => `${r}|${a}|${b}`;
  const existingByKey = new Map((existing || []).map((row) => [keyOf(row.round, row.player_a, row.player_b), row]));
  const freshKeys = new Set(matches.map((m) => keyOf(m.round, m.playerA, m.playerB)));
  const staleIds = (existing || [])
    .filter((row) => !freshKeys.has(keyOf(row.round, row.player_a, row.player_b)))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('matches').delete().in('id', staleIds);
    if (error) throw new Error(`matches stale-delete failed for ${folder}: ${error.message}`);
  }

  // Only new or genuinely-changed matches. Upserting unchanged rows fires the
  // audit trigger on every row (no-op "ghost" history) — the same fan-out the
  // admin path was fixed for (js/admin/supabaseAdmin.js, sql/audit_batching.sql).
  const changed = matches.filter((m) => {
    const cur = existingByKey.get(keyOf(m.round, m.playerA, m.playerB));
    return !cur || !sameMatchRow(cur, m);
  });
  if (changed.length > 0) {
    const rows = changed.map((m) => ({
      league_id: folder, round: m.round, player_a: m.playerA, player_b: m.playerB,
      pr_a: m.prA, luck_a: m.luckA, score_a: m.scoreA,
      pr_b: m.prB, luck_b: m.luckB, score_b: m.scoreB, played: m.played,
    }));
    const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'league_id,round,player_a,player_b' });
    if (error) throw new Error(`matches upsert failed for ${folder}: ${error.message}`);
  }

  // Only bump last_updated if matches actually changed — otherwise a no-op sync
  // ghosts the leagues row too.
  if (changed.length > 0 || staleIds.length > 0) {
    await supabase.from('leagues').update({ last_updated: new Date().toISOString() }).eq('id', folder);
  }
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
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches').select('*').eq('league_id', folder).eq('played', true).order('round', { ascending: true });
  // A read failure must NOT be treated as "0 matches" — that would stale-delete
  // the whole history below. Abort the reconcile instead of wiping.
  if (matchErr) throw new Error(`match_history reconcile aborted for ${folder}: could not read matches — ${matchErr.message}`);
  const { data: overrideRows } = await supabase.from('manual_overrides').select('*').eq('league_id', folder);
  const { data: historyRows } = await supabase.from('match_history').select('*').eq('league_id', folder);

  // Single canonical reconcile shared with the admin publish path
  // (js/data/matchHistoryReconcile.js) — the wipe-guard, the override-date
  // handling and the not_played rule all live there, once.
  const { skipped, reason, staleIds, upsertRows } = computeMatchHistoryReconcile({
    matchRows, overrideRows, historyRows, leagueId: folder, now: new Date().toISOString(),
  });
  if (skipped) {
    console.log(`  → Skipping match_history reconcile for ${folder}: ${reason}.`);
    return;
  }

  if (staleIds.length > 0) {
    const { error } = await supabase.from('match_history').delete().in('id', staleIds);
    if (error) throw new Error(`match_history stale-delete failed for ${folder}: ${error.message}`);
  }
  if (upsertRows.length > 0) {
    const { error } = await supabase.from('match_history').upsert(upsertRows, { onConflict: 'league_id,player_a,player_b' });
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