import { chromium } from 'playwright';
import { mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SITE_URL = 'https://heroes3.backgammonstudio.com/';
const LEAGUE_NAME = 'Shabi Israel';
const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'out', 'leaguedata.csv');

const username = process.env.BGSTUDIO_USER;
const password = process.env.BGSTUDIO_PASS;

if (!username || !password) {
  console.error('Missing BGSTUDIO_USER or BGSTUDIO_PASS env vars.');
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

try {
  console.log(`→ Opening ${SITE_URL}`);
  await page.goto(SITE_URL);
  await page.waitForLoadState('domcontentloaded');

  console.log('→ Injecting CSS to suppress intro/news/welcome dialogs');
  await page.addStyleTag({
    content: '#introdialog, #myrooms, #newsdialog, #welcomedialog { display: none !important; }',
  });

  console.log('→ Opening login form');
  await page.locator('button:has-text("Login"):not(.dialogbutton)').click();

  console.log('→ Filling credentials');
  await page.locator('#username').fill(username);
  await page.locator('#pass').fill(password);

  console.log('→ Submitting login');
  await page.locator('button.dialogbutton:has-text("Login")').click();

  await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });

  console.log('→ Diagnosing welcome modal');
  const diag = await page.evaluate(() => {
    const dump = (el) => el ? {
      tag: el.tagName,
      id: el.id || null,
      cls: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').slice(0, 50).trim(),
      onclick: el.getAttribute('onclick'),
    } : null;
    return {
      at_top_right: dump(document.elementFromPoint(1517, 182)),
      modals: Array.from(document.querySelectorAll('[id*="dialog" i], [id*="modal" i], [class*="dialog" i], [class*="modal" i]'))
        .filter((el) => el.offsetParent !== null)
        .slice(0, 10)
        .map((el) => ({ tag: el.tagName, id: el.id, cls: (el.className || '').toString().slice(0, 60) })),
    };
  });
  console.log(`  At (1517,182): ${JSON.stringify(diag.at_top_right)}`);
  console.log(`  Visible dialog-like elements: ${JSON.stringify(diag.modals)}`);

  console.log('→ Closing welcome modal (multi-strategy)');
  const closed = await page.evaluate(() => {
    const xChars = /^[✕×Xx⨯⊗⊠✗]$/;
    const visible = (el) => el.offsetParent !== null;
    const fullClick = (el) => {
      const o = { bubbles: true, cancelable: true };
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.click();
    };
    const tried = [];

    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      if (!visible(el)) continue;
      const text = (el.textContent || '').trim();
      if (xChars.test(text)) {
        fullClick(el);
        if (el.parentElement) fullClick(el.parentElement);
        tried.push({ s: 'char-leaf', tag: el.tagName, text });
      }
    }
    for (const el of document.querySelectorAll('[onclick*="close" i], [onclick*="hide" i], [class*="close" i]')) {
      if (!visible(el)) continue;
      fullClick(el);
      tried.push({ s: 'class-attr', tag: el.tagName, cls: (el.className || '').toString().slice(0, 40) });
    }
    return tried;
  });
  console.log(`  Tried: ${JSON.stringify(closed)}`);
  await page.mouse.click(1517, 182);
  await page.waitForTimeout(800);

  const stillThere = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').slice(0, 100);
      if (/Welcome back|News for you today/.test(text)) {
        return { id: el.id, cls: (el.className || '').toString().slice(0, 60), tag: el.tagName };
      }
    }
    return null;
  });
  console.log(`  Welcome modal still visible? ${JSON.stringify(stillThere)}`);

  console.log('→ Switching to Tournaments tab');
  await page.locator('th').filter({ hasText: /^\s*Tournaments\s*$/ }).first().click({ timeout: 10000 });
  await page.locator('tr').filter({ hasText: 'Leagues' }).first().waitFor({ timeout: 10000 });

  console.log('→ Opening Leagues');
  await page.locator('tr').filter({ hasText: 'Leagues' }).locator('.button.tablebutton').first().click();

  console.log(`→ Opening league "${LEAGUE_NAME}"`);
  const leagueBtn = page.locator('button').filter({ hasText: new RegExp(`^\\s*${LEAGUE_NAME}\\s*$`) });
  await leagueBtn.first().click({ timeout: 15000 });

  await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });

  console.log('→ Waiting for league data (FL[RG]) to populate');
  const flReady = await page.evaluate(async () => {
    const T0 = performance.now();
    const trace = [];
    while (performance.now() - T0 < 15000) {
      const rg = typeof FL !== 'undefined' && FL ? FL[typeof RG !== 'undefined' ? RG : 'RG'] : undefined;
      const t = Math.round(performance.now() - T0);
      if (trace.length === 0 || trace[trace.length - 1].rg !== rg) trace.push({ t, rg });
      if (typeof rg === 'number' && rg > 0) return { ok: true, rg, t, trace };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, trace, t: 15000 };
  });
  console.log(`  FL trace: ${JSON.stringify(flReady.trace)}`);
  if (!flReady.ok) {
    throw new Error('FL[RG] never populated within 15s after league click');
  }
  console.log(`  FL[RG] = ${flReady.rg} (rounds) — ready after ${flReady.t}ms`);

  console.log('→ Extracting player roster (DL) for players.json');
  const players = await page.evaluate(() => {
    if (typeof DL === 'undefined' || !Array.isArray(DL)) return null;
    return DL.map((p) => ({ username: p.username, fl: p.fl, cname: p.cname }));
  });
  if (!players || players.length === 0) {
    console.warn('  DL not available or empty — skipping players.json');
  } else {
    const playersPath = resolve(dirname(OUTPUT_PATH), 'players.json');
    await mkdir(dirname(playersPath), { recursive: true });
    await writeFile(playersPath, JSON.stringify(players, null, 2) + '\n', 'utf8');
    console.log(`✓ Wrote ${players.length} players to ${playersPath}`);

    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const flagsDir = join(repoRoot, 'assets', 'flags');
    let existing = new Set();
    try {
      const entries = await readdir(flagsDir);
      existing = new Set(entries.filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/i, '').toUpperCase()));
    } catch {
      console.warn(`  assets/flags/ not readable — assuming empty`);
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

    console.log('→ Flag analysis');
    console.log(`  Total players: ${players.length}`);
    const usageLine = Object.entries(flagUsage)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, info]) => `${code} (${info.cname}) × ${info.users.length}`)
      .join(', ');
    console.log(`  Flags used: ${usageLine}`);
    console.log(`  Flags in repo (assets/flags/): ${[...existing].sort().join(', ') || '(none)'}`);

    if (missing.length === 0) {
      console.log('  ✓ No new flags needed — all player flags already in repo');
    } else {
      console.log(`  ⚠ ${missing.length} new flag(s) detected:`);
      for (const code of missing) {
        const info = flagUsage[code];
        console.log(`    • ${code} (${info.cname}) — used by: ${info.users.join(', ')}`);
      }

      console.log('→ Fetching missing flags via fetch-flag.py');
      const outFlagsDir = resolve(dirname(OUTPUT_PATH), 'new_flags');
      await mkdir(outFlagsDir, { recursive: true });
      const fetchScript = join(repoRoot, 'scripts', 'fetch-flag.py');
      let okCount = 0;
      const failed = [];
      for (const code of missing) {
        const res = spawnSync('python', [fetchScript, code, outFlagsDir], { encoding: 'utf8' });
        if (res.status === 0) {
          console.log(`  ✓ ${code} (${flagUsage[code].cname}): ${res.stdout.trim()}`);
          okCount++;
        } else {
          console.error(`  ✗ ${code} (${flagUsage[code].cname}) failed: ${res.stderr.trim() || res.stdout.trim()}`);
          failed.push(code);
        }
      }
      console.log(
        `→ Flag fetch summary: ${okCount}/${missing.length} downloaded to scripts/out/new_flags/` +
          (failed.length ? ` (failed: ${failed.join(', ')})` : ''),
      );
    }
  }

  console.log('→ Triggering Export results (lg(622))');
  await page.locator('button:has-text("Export results")').click();

  console.log('→ Polling #lgexport textarea until data stabilises');
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

  console.log(`  Textarea growth trace: ${JSON.stringify(csv.trace)}`);
  console.log(`  Finished after ${csv.elapsed}ms`);

  if (!csv.data) {
    console.warn('  Textarea never populated within 30s — league may be empty (no rounds played yet). Skipping CSV.');
  } else {
    const csvText = csv.data;
    const lines = csvText.split('\n').filter(Boolean).length;
    console.log(`✓ CSV: ${csvText.length} bytes, ${lines} lines`);
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, csvText, 'utf8');
    console.log(`✓ Saved to ${OUTPUT_PATH}`);
  }
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
