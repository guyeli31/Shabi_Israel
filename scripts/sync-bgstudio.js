import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DEFAULT_FLAG = 'IL';
const SITE_URL = 'https://heroes3.backgammonstudio.com/';
const LEAGUE_NAME = 'Shabi Israel';
const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'out', 'leaguedata.csv');
const SESSION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'out', 'session-state.json');

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
];

const username = process.env.BGSTUDIO_USER;
const password = process.env.BGSTUDIO_PASS;
const SYNC_MODE = (process.env.SYNC_MODE || 'full').toLowerCase();

if (!username || !password) {
  console.error('Missing BGSTUDIO_USER or BGSTUDIO_PASS env vars.');
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
  bgStudioReady: { code: 18, label: 'BG Studio ready' },
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

async function exportShabiIsraelTask(page, repoRoot) {
  await page.waitForTimeout(randInt(500, 2500));
  console.log('  → Switching to Tournaments tab');
  await page.locator('th').filter({ hasText: /^\s*Tournaments\s*$/ }).first().click({ timeout: 10000 });
  await page.locator('tr').filter({ hasText: 'Leagues' }).first().waitFor({ timeout: 10000 });

  await page.waitForTimeout(randInt(500, 2500));
  console.log('  → Opening Leagues');
  await page.locator('tr').filter({ hasText: 'Leagues' }).locator('.button.tablebutton').first().click();

  await page.waitForTimeout(randInt(500, 2500));
  console.log(`  → Opening league "${LEAGUE_NAME}" (with pagination)`);
  const MAX_PAGES = 10;
  const leagueRegex = new RegExp(`^\\s*${LEAGUE_NAME}\\s*$`);
  let clicked = false;
  let prevFirstId = null;
  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
    await page.locator('button.tablebutton[onclick^="lg(682,"]').first().waitFor({ timeout: 10000 });
    const target = page.locator('button.tablebutton[onclick^="lg(682,"]').filter({ hasText: leagueRegex }).first();
    if ((await target.count()) > 0) {
      console.log(`    Found on page ${pageIdx + 1}`);
      await target.click({ timeout: 15000 });
      clicked = true;
      break;
    }
    const firstId = await page.evaluate(() => {
      const b = document.querySelector('button.tablebutton[onclick^="lg(682,"]');
      return b ? b.getAttribute('onclick') : null;
    });
    if (firstId === prevFirstId) {
      throw new Error(`League "${LEAGUE_NAME}" not found — Next button no longer advances at firstId=${firstId}`);
    }
    console.log(`    Not on page ${pageIdx + 1} (firstId=${firstId}) — clicking Next`);
    prevFirstId = firstId;
    await page.locator('button.tablebutton:has-text("Next")').first().click();
    await page.waitForTimeout(600);
  }
  if (!clicked) {
    throw new Error(`League "${LEAGUE_NAME}" not found within ${MAX_PAGES} pages`);
  }

  await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });

  console.log('  → Waiting for league roster (DL) and round count (FL[RG]) to populate');
  const rosterReady = await page.evaluate(async () => {
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
  console.log(`    Trace: ${JSON.stringify(rosterReady.trace)}`);
  if (!rosterReady.ok) {
    throw new Error('DL never populated within 15s after league click');
  }
  console.log(`    DL = ${rosterReady.dl} players, FL[RG] = ${rosterReady.rg} rounds played — ready after ${rosterReady.t}ms`);

  console.log('  → Extracting player roster (DL) for players.json');
  const players = await page.evaluate(() => {
    if (typeof DL === 'undefined' || !Array.isArray(DL)) return null;
    return DL.map((p) => ({ username: p.username, fl: p.fl, cname: p.cname }));
  });
  if (!players || players.length === 0) {
    console.warn('    DL not available or empty — skipping players.json');
  } else {
    const playersPath = resolve(dirname(OUTPUT_PATH), 'players.json');
    await mkdir(dirname(playersPath), { recursive: true });
    await writeFile(playersPath, JSON.stringify(players, null, 2) + '\n', 'utf8');
    console.log(`  ✓ Wrote ${players.length} players to ${playersPath}`);

    console.log('  → Player roster (alphabetical)');
    const sortedPlayers = [...players].sort((a, b) => a.username.localeCompare(b.username));
    const nameWidth = Math.max(...sortedPlayers.map((p) => p.username.length));
    for (const p of sortedPlayers) {
      const code = (p.fl || '').toUpperCase();
      console.log(`    ${p.username.padEnd(nameWidth)}  ${code}  ${p.cname || ''}`);
    }

    console.log('  → Active league detection');
    const leaguesRoot = join(repoRoot, 'leagues');
    const active = await findActiveLeague(leaguesRoot);
    if (!active) {
      console.warn('    ⚠ No league with "Running": true found — skipping league-config update');
    } else {
      console.log(`    Active league: "${active.folder}"`);

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
      }

      console.log('  → CustomFlags diff (BGStudio → local)');
      const diff = computeCustomFlagsDiff(active.params.CustomFlags, players);
      const noChanges = diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
      if (noChanges) {
        console.log('    ✓ No changes — local CustomFlags match BGStudio');
      } else {
        for (const a of diff.added) console.log(`    + ${a.username}: ${a.to} (new override)`);
        for (const c of diff.changed) console.log(`    ~ ${c.username}: ${c.from} → ${c.to}`);
        for (const r of diff.removed) console.log(`    - ${r.username}: ${r.from} (now uses default ${DEFAULT_FLAG})`);

        const updatedParams = { ...active.params, CustomFlags: diff.desired };
        const updatedPath = resolve(dirname(OUTPUT_PATH), 'league_params.json');
        await writeFile(updatedPath, JSON.stringify(updatedParams, null, 2) + '\n', 'utf8');
        console.log(`  ✓ Updated config written to ${updatedPath}`);
        console.log(`    (review and copy to leagues/${active.folder}/league_params.json when ready)`);
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
      console.log(`    ⚠ ${missing.length} new flag(s) detected:`);
      for (const code of missing) {
        const info = flagUsage[code];
        console.log(`      • ${code} (${info.cname}) — used by: ${info.users.join(', ')}`);
      }

      console.log('  → Fetching missing flags via fetch-flag.py');
      const outFlagsDir = resolve(dirname(OUTPUT_PATH), 'new_flags');
      await mkdir(outFlagsDir, { recursive: true });
      const fetchScript = join(repoRoot, 'scripts', 'fetch-flag.py');
      let okCount = 0;
      const failed = [];
      for (const code of missing) {
        const res = spawnSync('python', [fetchScript, code, outFlagsDir], { encoding: 'utf8' });
        if (res.status === 0) {
          console.log(`    ✓ ${code} (${flagUsage[code].cname}): ${res.stdout.trim()}`);
          okCount++;
        } else {
          console.error(`    ✗ ${code} (${flagUsage[code].cname}) failed: ${res.stderr.trim() || res.stdout.trim()}`);
          failed.push(code);
        }
      }
      console.log(
        `  → Flag fetch summary: ${okCount}/${missing.length} downloaded to scripts/out/new_flags/` +
          (failed.length ? ` (failed: ${failed.join(', ')})` : ''),
      );
    }
  }

  if (!rosterReady.rg || rosterReady.rg < 1) {
    console.log(`  → Skipping CSV export — league has 0 rounds played yet (FL[RG] = ${rosterReady.rg})`);
    return;
  }

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

  if (!csv.data) {
    console.warn('    Textarea never populated within 30s — Export did not stream data. Skipping CSV.');
    return;
  }

  const csvText = csv.data;
  const lines = csvText.split('\n').filter(Boolean).length;
  console.log(`  ✓ CSV: ${csvText.length} bytes, ${lines} lines`);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, csvText, 'utf8');
  console.log(`  ✓ Saved to ${OUTPUT_PATH}`);
}

console.log(`→ Sync mode: ${SYNC_MODE}`);

const viewport = VIEWPORTS[randInt(0, VIEWPORTS.length - 1)];
console.log(`→ Viewport: ${viewport.width}×${viewport.height}`);

const hasSession = existsSync(SESSION_PATH);
console.log(`→ Saved session: ${hasSession ? 'found, will try to restore' : 'none, fresh login required'}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport,
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
  storageState: hasSession ? SESSION_PATH : undefined,
});
const page = await ctx.newPage();

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

    const exportTask = { kind: 'EXPORT', label: '✦ Export Shabi Israel (real task)', durationS: 30 };
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
    await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });
  }

  await mkdir(dirname(SESSION_PATH), { recursive: true });
  await ctx.storageState({ path: SESSION_PATH });
  console.log(`✓ Saved session state to ${SESSION_PATH}`);

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  if (SYNC_MODE === 'fast') {
    const start = Date.now();
    try {
      await exportShabiIsraelTask(page, repoRoot);
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  ✓ Export done in ${elapsed}s`);
      taskResults.push({ kind: 'EXPORT', label: '✦ Export Shabi Israel (fast mode)', status: 'ok', elapsed });
    } catch (err) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.error(`  ✗ Export failed after ${elapsed}s: ${err.message}`);
      taskResults.push({ kind: 'EXPORT', label: '✦ Export Shabi Israel (fast mode)', status: 'fail', error: err.message, elapsed });
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
            await exportShabiIsraelTask(page, repoRoot);
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
    const shotPath = OUTPUT_PATH.replace(/leaguedata\.csv$/, 'failure.png');
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