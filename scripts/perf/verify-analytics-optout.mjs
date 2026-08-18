/**
 * verify-analytics-optout.mjs — proves automated traffic sends no analytics.
 *
 * The gate (scripts/check-no-analytics-pollution.mjs) checks that every
 * browser-driving script *asks* to be excluded. This checks that asking
 * actually works — that `js/analytics.js` still honours the flag. The two are
 * different failures: a harness could set the key perfectly while a refactor of
 * analytics.js quietly stopped reading it, and nothing would complain until the
 * next run polluted the live dashboard again.
 *
 * Three cases, and the CONTROL is the important one:
 *
 *   1. control — no opt-out. Beacons MUST fire. Without this the test passes
 *      trivially when analytics is broken, misconfigured, or the endpoint is
 *      unset, and "0 beacons" would mean nothing at all.
 *   2. addInitScript sets the key — what the harnesses do. Must be 0.
 *   3. `?notrack` on the FIRST url, then a click to a second page. Must be 0
 *      across BOTH. This is the case that matters for hand-driven automation:
 *      a per-URL override dies on navigation, which is why the flag is written
 *      to localStorage rather than read from the query string each time.
 *
 * Run against a LOCAL server only — it deliberately generates real beacons in
 * case 1. Never point it at production.
 *
 * Usage: node scripts/perf/verify-analytics-optout.mjs [--base-url=<url>]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=').slice(1).join('=');
const BASE = argOf('base-url', 'http://localhost:8090/shabi-israel').replace(/\/$/, '');

if (/golan\.me\.uk|supabase\.co/.test(BASE)) {
  console.error('Refusing to run against production: case 1 exists to CREATE analytics rows.');
  process.exit(2);
}

const browser = await chromium.launch({ headless: false });

/** Load the landing page, click through to a league, count beacons on both. */
async function run(label, { initScript = null, firstUrl = `${BASE}/index.html` } = {}) {
  const ctx = await browser.newContext();
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  let beacons = 0;
  page.on('request', (r) => { if (r.url().includes('/analytics_events')) beacons++; });

  await page.goto(firstUrl, { waitUntil: 'networkidle' });
  await page.locator('.site-main .league-card-title a').first().click().catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500); // pagehide duration beacons land late

  console.log(`  ${label.padEnd(40)} beacons: ${beacons}`);
  await ctx.close();
  return beacons;
}

console.log(`Target: ${BASE}\n`);

const control = await run('1. control — no opt-out (must be > 0)');
const viaInit = await run('2. addInitScript opt-out (must be 0)', {
  initScript: () => { try { localStorage.setItem('shabi:no-analytics', '1'); } catch { /* blocked */ } },
});
const viaParam = await run('3. ?notrack + click to page 2 (must be 0)', {
  firstUrl: `${BASE}/index.html?notrack`,
});

await browser.close();

const failures = [];
if (control === 0) failures.push('control sent no beacons — analytics is not running, so this test proves nothing');
if (viaInit !== 0) failures.push(`addInitScript opt-out leaked ${viaInit} beacon(s)`);
if (viaParam !== 0) failures.push(`?notrack leaked ${viaParam} beacon(s) — check it survives navigation`);

if (failures.length) {
  console.error('\nOPT-OUT BROKEN:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n✓ Automated traffic sends nothing, and the control proves beacons do fire without the flag.');
