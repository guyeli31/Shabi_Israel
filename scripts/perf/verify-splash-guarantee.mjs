/**
 * verify-splash-guarantee.mjs — acceptance test for one hard requirement:
 *
 *   The loading screen must not delay an internal navigation by a single
 *   millisecond, on ANY device.
 *
 * Why this exists as its own script, separate from measure-transitions.mjs
 * ----------------------------------------------------------------------
 * The perf harness runs on a fast desktop with a warm cache, where the old
 * stopwatch-based splash ALSO mostly stayed hidden — so a green run there
 * proves nothing about the guarantee. The old mechanism failed by RACE: it
 * waited 350ms and showed the splash if the page was not finished, so whether
 * a transition cost ~0ms or ~1s (defer + minimum-display + ring-close + fade)
 * was decided by how fast the machine happened to be. That failure only
 * appears on hardware slow enough to cross the threshold.
 *
 * So this script deliberately makes the machine slow — CDP CPU throttling, up
 * to 20x, which is well past a low-end phone — and asserts the splash STILL
 * never becomes visible on a warm internal navigation. A timing-based
 * mechanism cannot pass this; only one that decides from state can, which is
 * the point of the receipt + shabi:bundle-fetch-start design.
 *
 * It also asserts the converse, because a splash that never shows is not a
 * fix, it is a regression: on a COLD entry (no cache, a real network wait) the
 * splash must still appear.
 *
 * Usage: node scripts/perf/verify-splash-guarantee.mjs [--base-url=<url>]
 * Exit 1 if the guarantee is broken.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=').slice(1).join('=');
const BASE_URL = argOf('base-url', 'http://localhost:8090/shabi-israel').replace(/\/$/, '');
const RATES = [1, 4, 10, 20]; // 1x = no throttling; 20x is far below any real phone
const NAV_TIMEOUT = 240000; // 20x CPU on the dashboard is genuinely minutes; the test must outlast it

const PROBE = () => {
  // Analytics opt-out first — this script can be pointed at production, and a
  // real browser driving real pages fires real beacons. See NO_TRACK_KEY in
  // js/analytics.js.
  try { localStorage.setItem('shabi:no-analytics', '1'); } catch { /* storage blocked */ }

  const s = { seen: false, maxOpacity: 0 };
  window.__splashProbe = s;
  const poll = () => {
    const el = document.getElementById('logo-splash');
    if (el) {
      const cs = getComputedStyle(el);
      const op = parseFloat(cs.opacity) || 0;
      if (op > s.maxOpacity) s.maxOpacity = op;
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && op > 0.01) s.seen = true;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

const readProbe = (p) => p.evaluate(() => window.__splashProbe || { seen: false, maxOpacity: 0 }).catch(() => ({ seen: false, maxOpacity: 0 }));
const settle = (p) => p.waitForFunction(() => !document.getElementById('logo-splash'), null, { timeout: NAV_TIMEOUT }).catch(() => null);

const browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
const failures = [];

console.log(`Target: ${BASE_URL}\n`);

// ── 1. Warm internal navigation must NEVER show the splash, at any CPU speed ──
console.log('Warm internal navigation (must never show the splash):');
for (const rate of RATES) {
  const context = await browser.newContext();
  await context.addInitScript(PROBE);
  const page = await context.newPage();

  // Warm the cache at full speed — we are testing the transition, not the
  // cold load that fills the cache.
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
  await settle(page);

  const cdp = await context.newCDPSession(page);
  if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });

  const link = page.locator('.site-main .league-card-title a').first();
  const t0 = Date.now();
  let navigated = true;
  await Promise.all([
    page.waitForURL('**/league.html*', { timeout: NAV_TIMEOUT }).catch(() => { navigated = false; }),
    link.click(),
  ]);
  await page.waitForSelector('table tbody tr', { timeout: NAV_TIMEOUT, state: 'attached' }).catch(() => null);
  await settle(page);
  const probe = await readProbe(page);
  const ms = Date.now() - t0;

  const ok = navigated && !probe.seen;
  console.log(`  ${rate.toString().padStart(2)}x CPU: ${ms.toString().padStart(5)}ms, splash ${probe.seen ? 'SEEN' : 'not seen'}  ${ok ? '✓' : '✗'}`);
  if (!navigated) failures.push(`${rate}x: click did not navigate — test inconclusive`);
  else if (probe.seen) failures.push(`${rate}x CPU: splash became visible on a warm internal navigation (max opacity ${probe.maxOpacity})`);

  if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await context.close();
}

// ── 2. Cold entry MUST still show it — a splash that never shows is a bug ──
console.log('\nCold entry (must still show the splash):');
{
  const context = await browser.newContext();
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.league-card-title', { timeout: 30000, state: 'attached' }).catch(() => null);
  await settle(page);
  const probe = await readProbe(page);
  console.log(`  cold index.html: splash ${probe.seen ? 'seen' : 'NOT SEEN'}  ${probe.seen ? '✓' : '✗'}`);
  if (!probe.seen) failures.push('cold entry: splash never appeared — a real network wait was left uncovered');
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error('\nGUARANTEE BROKEN:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n✓ Guarantee holds: no splash on a warm internal navigation at any CPU speed; still shown on a cold entry.');
