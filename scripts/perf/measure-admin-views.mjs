/**
 * measure-admin-views.mjs — how the ADMIN and ANALYTICS pages behave as you
 * move around inside them.
 *
 * The main harness (measure-transitions.mjs) only covers the five public pages.
 * These two are single documents whose views swap in place, so "time to table"
 * says nothing about them. What matters here is what each step inside the page
 * costs once you are already in it.
 *
 * ── READ-ONLY, BY CONSTRUCTION ─────────────────────────────────────────────
 * This script is safe to point at the live site. It only ever clicks
 * NAVIGATION: sidebar items, a league's "Edit" button, and the editor's own
 * sub-tabs. It never clicks Save, Publish, Delete, Run, Sync, Undo or Import,
 * never submits a form other than the login form, and never writes to the
 * database. If you add a step, keep it that way — see SAFE_CLICK_NOTE below.
 *
 * ── What it reports, per step ──────────────────────────────────────────────
 *   ms      wall time from the click until the page stops fetching
 *   data    row fetches (leagues / matches / manual_overrides / match_history /
 *           players_metadata / landing_settings / analytics RPCs)
 *   verify  site_meta reads — the one-row "did anything change?" check
 *   splash  whether the loading screen became visible during the step
 *
 * data and verify are counted separately on purpose: trading N row fetches for
 * one tiny version read is the intended shape of the admin cache, and a single
 * total would hide it.
 *
 * ── Lap 2 is the point ─────────────────────────────────────────────────────
 * The journey is walked twice with NOTHING written in between. Every data call
 * in lap 2 is a re-download of rows the page provably already had.
 *
 * Usage:
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/perf/measure-admin-views.mjs
 *     [--base-url=https://golan.me.uk/shabi-israel] [--laps=2] [--out=<path>]
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=').slice(1).join('=');
const BASE_URL = argOf('base-url', 'http://localhost:8090/shabi-israel').replace(/\/$/, '');
const LAPS = Number(argOf('laps', '2'));
const outArg = args.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.split('=')[1] : null;

const VERIFY = ['site_meta'];
const NOISE = ['analytics_events'];

/* SAFE_CLICK_NOTE — every selector used below must be navigation only. These
   are the words that mean "this button changes data"; a step whose target text
   matches one of them is refused rather than clicked, so a future edit cannot
   quietly turn this into a script that writes to production. */
const FORBIDDEN = /save|publish|delete|remove|run|sync now|undo|import|upload|apply|submit|confirm|create|add /i;

const browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  // Analytics opt-out FIRST, before any page script runs. This harness drives a
  // real browser against the real site — including, deliberately, production —
  // so without this every step it takes lands in the live dashboard as a real
  // visit. Set here rather than via a URL param because a param covers one
  // page load and this journey is dozens. See NO_TRACK_KEY in js/analytics.js.
  try { localStorage.setItem('shabi:no-analytics', '1'); } catch { /* storage blocked */ }

  // ── True render time, independent of how long the harness waits ──────────
  // An admin view swaps in place, so there is no navigation to time and no
  // single "ready" selector to wait on across a dozen different views. The
  // harness therefore settles on a fixed pause — which lands INSIDE the
  // measured span and swamps it: with a 600ms settle, a step that really took
  // 90ms reports ~690ms, and every step looks identical. The first version of
  // this script reported exactly that, and the per-step times were worthless.
  //
  // So the page timestamps its own last DOM change. Time-to-rendered is then
  // (last mutation − click), read back after the settle, and the harness's own
  // waiting is excluded by construction rather than subtracted by guesswork.
  // Attached once the document root exists. addInitScript runs at
  // document_start, where `document.documentElement` can still be null —
  // observe(null) THROWS, and because everything here shares one init script
  // that took the splash probe below down with it. The whole run then reported
  // "no splash" everywhere, which read as a result rather than as a crash.
  window.__t0 = null;
  window.__lastMutation = null;
  const attachObserver = () => {
    if (!document.documentElement) return false;
    new MutationObserver(() => {
      if (window.__t0 !== null) window.__lastMutation = performance.now();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    return true;
  };
  if (!attachObserver()) {
    document.addEventListener('readystatechange', attachObserver, { once: true });
    document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
  }

  const s = { seen: false };
  window.__splashProbe = s;
  const poll = () => {
    const el = document.getElementById('logo-splash');
    if (el) {
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && (parseFloat(cs.opacity) || 0) > 0.01) s.seen = true;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
});
const page = await context.newPage();

const calls = [];
// Proof, per run, that the opt-out held. Counted on `request`, not `response`:
// a beacon is fire-and-forget, so counting replies would under-report exactly
// the number we need to be zero.
let beaconsSent = 0;
page.on('request', (r) => {
  if (r.url().includes('/analytics_events')) beaconsSent++;
});
page.on('response', (r) => {
  const u = r.url();
  if (!u.includes('/rest/v1/')) return;
  calls.push(u.split('/rest/v1/')[1].split('?')[0].replace(/\/$/, ''));
});

const results = { generatedAt: new Date().toISOString(), baseUrl: BASE_URL, laps: LAPS, admin: [], analytics: [] };

/**
 * Wait for a view swap to finish.
 *
 * `networkidle` alone is not enough and fails silently in the worst way: the
 * admin's views render asynchronously AFTER their data resolves, so on an
 * already-idle page it returns immediately, the next step finds no buttons, and
 * the whole lap reports a flat zero — indistinguishable from "nothing was
 * fetched". A short fixed settle on top gives the render a chance to land.
 */
async function settle() {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** Run one navigation step and report what it cost. */
async function step(label, action, bucket) {
  const from = calls.length;
  await page.evaluate(() => {
    if (window.__splashProbe) window.__splashProbe.seen = false;
    window.__t0 = performance.now();
    window.__lastMutation = null;
  }).catch(() => {});
  const wallT0 = Date.now();
  const ok = await action();
  await settle();
  const wallMs = Date.now() - wallT0;
  const probe = await page.evaluate(() => ({
    splash: !!window.__splashProbe?.seen,
    // null when the click changed nothing at all.
    renderMs: window.__lastMutation === null ? null : Math.round(window.__lastMutation - window.__t0),
  })).catch(() => ({ splash: false, renderMs: null }));
  const splash = probe.splash;
  // The number that means something: click → last DOM change. `wallMs` is kept
  // only as a sanity check; it is dominated by settle() and must never be
  // reported as a speed.
  const ms = probe.renderMs;

  const made = calls.slice(from).filter((p) => !NOISE.includes(p));
  const verify = made.filter((p) => VERIFY.includes(p)).length;
  const data = made.filter((p) => !VERIFY.includes(p));
  const byPath = {};
  for (const p of data) byPath[p] = (byPath[p] || 0) + 1;

  const row = { label, ok, renderMs: ms, wallMs, data: data.length, verify, splash, paths: byPath };
  bucket.push(row);
  console.log(
    `  ${label.padEnd(34)} ${ok ? ' ' : '!'} ${String(ms === null ? '—' : ms).padStart(5)}ms | ${String(data.length).padStart(2)} data | ${verify} verify | splash ${splash ? 'SHOWN' : 'no'}` +
    (data.length ? ` | ${JSON.stringify(byPath)}` : '')
  );
  return ok;
}

/** Click a locator, refusing anything whose label looks like a write action. */
async function safeClick(locator) {
  if (!(await locator.count())) return false;
  const text = (await locator.first().textContent().catch(() => '') || '').trim();
  if (FORBIDDEN.test(text)) {
    console.error(`  REFUSED to click "${text}" — looks like a write action.`);
    return false;
  }
  await locator.first().click({ timeout: 15000 }).catch(() => {});
  return true;
}

const navTo = (name) => page.locator(`button.site-nav-item`).filter({ hasText: new RegExp(name, 'i') }).first();

// ── Log in ─────────────────────────────────────────────────────────────────
// Deliberately via analytics.html, NOT admin.html. A Supabase session is stored
// per ORIGIN, so signing in on either page authenticates both — but admin.html
// REDIRECTS to index.html when it is not logged in, which makes a failed login
// there indistinguishable from a successful one: no password field remains on
// the page either way. Signing in on the analytics gate, which stays put and
// reports its own failure, turns a bad password into an error instead of a
// silent run of zeros. (It did: a whole lap reported "0 data calls" while
// actually sitting on the public landing page.)
//
// Credentials come from the environment, never from this file — it is
// committed, and a checked-in password is a checked-in password whatever it
// unlocks.
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Login required. Set ADMIN_EMAIL and ADMIN_PASSWORD for this run.');
  await browser.close();
  process.exit(2);
}

await page.goto(`${BASE_URL}/analytics.html`, { waitUntil: 'networkidle' });
if (await page.locator('input[type=password]').count()) {
  await page.locator('input[type=email], input[type=text]').first().fill(email);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('button[type=submit], button:has-text("Sign in"), button:has-text("Login")').first().click();
  await page.locator('#analytics-range').waitFor({ timeout: 45000 }).catch(() => {});
}
if (await page.locator('input[type=password]').count()) {
  const msg = await page.locator('[class*=error]').first().textContent().catch(() => '');
  console.error(`Login failed${msg ? ` — ${msg.trim()}` : ''}. Check ADMIN_EMAIL / ADMIN_PASSWORD.`);
  await browser.close();
  process.exit(2);
}

// Cold load of the admin shell, reported on its own. The laps below all start
// from a page that has already loaded, so without this the first load — where a
// per-league fan-out shows up most plainly — is measured by nothing at all.
const coldFrom = calls.length;
await page.goto(`${BASE_URL}/admin.html`, { waitUntil: 'networkidle' });
await page.locator('button:has-text("Edit")').first().waitFor({ timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1000);
{
  const made = calls.slice(coldFrom).filter((p) => !NOISE.includes(p));
  const counts = {};
  for (const p of made) counts[p] = (counts[p] || 0) + 1;
  results.adminColdLoad = { calls: made.length, paths: counts };
  console.log(`cold load of admin.html: ${made.length} calls | ${JSON.stringify(counts)}\n`);
}
if (!page.url().includes('admin.html')) {
  console.error(`Signed in, but admin.html redirected to ${page.url()} — this account may not have admin access.`);
  await browser.close();
  process.exit(2);
}

console.log(`Target: ${BASE_URL}\n`);

for (let lap = 1; lap <= LAPS; lap++) {
  console.log(`── ADMIN, lap ${lap} ${lap > 1 ? '(nothing was written since lap 1)' : ''} ──`);
  const bucket = [];

  await step(`L${lap} → Leagues`, () => safeClick(navTo('Leagues')), bucket);

  // Two different leagues, so the second one proves the cache is per-league and
  // not just "whatever was opened last".
  // The league list renders after its data resolves; without this the Edit
  // buttons are simply not there yet and every step below reports zero.
  await page.locator('button:has-text("Edit")').first().waitFor({ timeout: 30000 }).catch(() => {});

  for (const idx of [0, 1]) {
    const opened = await step(`L${lap} → open league #${idx + 1}`, async () => {
      const edit = page.locator('button:has-text("Edit")').nth(idx);
      if (!(await edit.count())) return false;
      await edit.click({ timeout: 15000 }).catch(() => {});
      return true;
    }, bucket);

    if (opened) {
      // The editor's own sub-tabs. Read-only views over data already fetched.
      // `.subtab--accordion`, not getByRole: each button's accessible name
      // includes the arrow glyph its markup prepends, so an exact-name role
      // query never matches and every sub-tab step silently reported zero.
      // "Upload CSV" is deliberately not in this list. Opening that tab is in
      // fact read-only, but its label trips the FORBIDDEN guard — and the guard
      // staying blunt is worth more than one extra tab, on a script whose whole
      // licence to run against production is that it cannot write.
      for (const tab of ['Round Editor', 'Overrides']) {
        await step(`L${lap}   ↳ ${tab}`, () =>
          safeClick(page.locator('button.subtab--accordion').filter({ hasText: tab })), bucket);
      }
      await step(`L${lap} ← back to Leagues`, () => safeClick(navTo('Leagues')), bucket);
      await page.locator('button:has-text("Edit")').first().waitFor({ timeout: 30000 }).catch(() => {});
    }
  }

  await step(`L${lap} → Players`, () => safeClick(navTo('Players')), bucket);
  await step(`L${lap} → Pending Changes`, () => safeClick(navTo('Pending')), bucket);
  await step(`L${lap} → Historical Changes`, () => safeClick(navTo('Historical')), bucket);
  await step(`L${lap} → Sync`, () => safeClick(navTo('Sync')), bucket);
  await step(`L${lap} → Leagues (return)`, () => safeClick(navTo('Leagues')), bucket);

  const data = bucket.reduce((s, r) => s + r.data, 0);
  const verify = bucket.reduce((s, r) => s + r.verify, 0);
  // Real render time only. Never sum wallMs: it is mostly settle(), so a total
  // built from it measures the harness's patience, not the app's speed.
  const ms = bucket.reduce((s, r) => s + (r.renderMs || 0), 0);
  const timed = bucket.filter((r) => r.renderMs !== null);
  const slowest = timed.reduce((a, r) => (r.renderMs > a.renderMs ? r : a), timed[0] || { label: '—', renderMs: 0 });
  console.log(`  ── lap ${lap}: ${ms}ms of rendering across ${timed.length} steps · slowest ${slowest.label.trim()} at ${slowest.renderMs}ms · ${data} data calls · ${verify} verify\n`);
  results.admin.push({ lap, totalRenderMs: ms, totalData: data, totalVerify: verify, steps: bucket });
}

// ── Analytics ──────────────────────────────────────────────────────────────
console.log('── ANALYTICS ──');
{
  const bucket = [];
  await step('load analytics.html', async () => {
    await page.goto(`${BASE_URL}/analytics.html`, { waitUntil: 'domcontentloaded' });
    // The Supabase session lives in localStorage per ORIGIN, so arriving from
    // admin.html on the same origin is normally already authenticated — but a
    // session can expire mid-run, and a silent re-login beats a 30-second
    // timeout that gets reported as "the page was slow".
    if (await page.locator('input[type=password]').count()) {
      await page.locator('input[type=email], input[type=text]').first().fill(process.env.ADMIN_EMAIL || '');
      await page.locator('input[type=password]').first().fill(process.env.ADMIN_PASSWORD || '');
      await page.locator('button[type=submit], button:has-text("Sign in"), button:has-text("Login")').first().click();
    }
    await page.locator('#analytics-range').waitFor({ timeout: 45000 }).catch(() => {});
    return true;
  }, bucket);

  const opts = await page.locator('#analytics-range option').evaluateAll((os) => os.map((o) => o.value)).catch(() => []);
  const other = opts.find((v) => v !== (opts[0] || ''));
  if (other) {
    await step(`month → ${other}`, async () => {
      await page.locator('#analytics-range').selectOption(other).catch(() => {});
      return true;
    }, bucket);
    await step(`month → ${opts[0]} (back)`, async () => {
      await page.locator('#analytics-range').selectOption(opts[0]).catch(() => {});
      return true;
    }, bucket);
    await step(`month → ${other} (already seen)`, async () => {
      await page.locator('#analytics-range').selectOption(other).catch(() => {});
      return true;
    }, bucket);
  }

  const toggle = page.locator('input[type=checkbox]').first();
  if (await toggle.count()) {
    await step('toggle exclude-my-traffic', async () => { await toggle.click().catch(() => {}); return true; }, bucket);
    await step('toggle back', async () => { await toggle.click().catch(() => {}); return true; }, bucket);
  }

  const data = bucket.reduce((s, r) => s + r.data, 0);
  console.log(`  ── analytics: ${bucket.reduce((s, r) => s + (r.renderMs || 0), 0)}ms of rendering · ${data} data calls\n`);
  results.analytics = bucket;
}

await browser.close();

results.analyticsBeaconsSent = beaconsSent;
if (beaconsSent === 0) {
  console.log('✓ 0 analytics beacons sent — this run left no trace in the dashboard.');
} else {
  console.error(`✗ ${beaconsSent} ANALYTICS BEACON(S) ESCAPED — this run polluted the dashboard.`);
  console.error("  Check js/analytics.js still reads localStorage['shabi:no-analytics'].");
}

if (outPath) {
  await writeFile(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Written: ${outPath}`);
}
