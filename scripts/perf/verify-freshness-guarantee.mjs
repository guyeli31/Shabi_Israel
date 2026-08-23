/**
 * verify-freshness-guarantee.mjs — proves the rule-12 contract
 * (docs/data-architecture/02-query-standards.md) still holds:
 *
 *   Any visitor, on any browser, with AT MOST ONE reload, sees the current
 *   database — and an open tab converges on its own, with no reload at all.
 *
 * This exists because the failure it guards is invisible: the page renders
 * perfectly, the cache updates correctly, the network panel looks healthy, and
 * the only symptom is that the numbers on screen are yesterday's. It shipped
 * that way for weeks. A test that only checked "does the bundle refresh?" would
 * have passed the whole time — which is why every assertion below is made
 * against the RENDERED TABLE, never against localStorage.
 *
 * Local Docker only, and it enforces that: it writes to the database (that is
 * the whole experiment) and must never be pointed at production.
 *
 *   node scripts/perf/verify-freshness-guarantee.mjs
 *   node scripts/perf/verify-freshness-guarantee.mjs --base-url=http://localhost:8091/shabi-israel
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  (args.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split('=').slice(1).join('=');

const BASE_URL = argOf('base-url', 'http://localhost:8090/shabi-israel').replace(/\/$/, '');
const DB_CONTAINER = argOf('db-container', 'supabase_db_supabase-migration');
// The visible-tab poll in store.js. The no-reload assertion has to outwait it.
const POLL_MS = 60_000;
const POLL_GRACE_MS = 25_000;

if (/golan\.me\.uk|supabase\.co/.test(BASE_URL)) {
  console.error('REFUSING: this script writes to the database. Local Docker only.');
  process.exit(1);
}

/** Bump data_version exactly the way a real write does, without touching any
 *  league data — the bump trigger is what clients actually watch. */
function bumpDataVersion() {
  const out = execFileSync('docker', [
    'exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A',
    '-c', 'update landing_settings set updated_at = now() where id = 1; select data_version from site_meta;',
  ], { encoding: 'utf8' });
  return Number(out.trim().split('\n').pop());
}

/**
 * Swap the score of one played match, in BOTH `matches` and `match_history`.
 *
 * Swapping rather than setting an arbitrary value makes the experiment its own
 * undo: calling it twice restores the original. Both tables, because
 * `match_history` wins the merge — editing only `matches` changes the database
 * and nothing on screen, which reads exactly like a broken refresh. (It cost an
 * hour of chasing the wrong thing during this fix.)
 *
 * A swapped score flips who won, so the change is guaranteed to be visible in
 * the standings — the assertion can then be "the numbers on screen changed",
 * which is the only claim that actually matters here.
 */
function swapTopMatch(leagueId) {
  execFileSync('docker', [
    'exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c',
    `with target as (
       select id, player_a, player_b from matches
        where league_id = $q$${leagueId}$q$ and played order by id limit 1
     ), m as (
       update matches x set score_a = x.score_b, score_b = x.score_a
         from target t where x.id = t.id returning 1
     )
     update match_history h set score_a = h.score_b, score_b = h.score_a
       from target t
      where h.league_id = $q$${leagueId}$q$
        and h.player_a = t.player_a and h.player_b = t.player_b;`,
  ], { encoding: 'utf8' });
}

function serverVersion() {
  const out = execFileSync('docker', [
    'exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A',
    '-c', 'select data_version from site_meta;',
  ], { encoding: 'utf8' });
  return Number(out.trim());
}

const OPT_OUT = `try { localStorage.setItem('shabi:no-analytics', '1'); } catch {}`;

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const cachedVersion = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('shabi:bundle:v1') || 'null')?.dataVersion ?? null; }
  catch { return null; }
});

/** What the visitor can actually read, as one string. Every "did it update?"
 *  assertion is made against this and never against localStorage — the bug being
 *  guarded here was precisely a correct cache behind a stale screen. */
const tableText = (page) => page.evaluate(() =>
  [...document.querySelectorAll('table tbody tr')].slice(0, 12)
    .map((tr) => [...tr.children].map((c) => c.textContent.trim()).join('|')).join('\n'));

async function main() {
  console.log(`Target: ${BASE_URL}\nDB:     ${DB_CONTAINER}\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(OPT_OUT);
  const page = await context.newPage();

  // Discover a league by clicking, never by URL — league ids get renamed.
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  const link = page.locator('.site-main a[href^="league_table.html"]').first();
  await link.waitFor({ state: 'attached', timeout: 30_000 });
  const leagueUrl = new URL(await link.getAttribute('href'), `${BASE_URL}/`).toString();
  const leagueId = new URL(leagueUrl).searchParams.get('league');
  console.log(`Discovered league "${leagueId}"\n`);

  // ---- Case 1: an OPEN tab converges with no reload at all ----
  console.log('Case 1 — open tab, zero reloads');
  await page.goto(leagueUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(2000); // let the load-time check settle first

  const beforeText = await tableText(page);
  const beforeVersion = await cachedVersion(page);
  swapTopMatch(leagueId); // flips a result — guaranteed visible in the standings
  const bumped = serverVersion();
  check(bumped > beforeVersion, 'database moved ahead of the open tab', `${beforeVersion} → ${bumped}`);

  const t0 = Date.now();
  let afterText = beforeText;
  while (Date.now() - t0 < POLL_MS + POLL_GRACE_MS) {
    afterText = await tableText(page);
    if (afterText !== beforeText) break;
    await page.waitForTimeout(1000);
  }
  check(afterText !== beforeText,
    'the SCREEN changed on an open tab, with no reload',
    `${Math.round((Date.now() - t0) / 1000)}s`);

  swapTopMatch(leagueId); // restore
  check(true, 'test data restored');

  // ---- Case 2: one reload is always enough ----
  console.log('\nCase 2 — one reload, immediately after a write');
  const bumped2 = bumpDataVersion();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: 30_000 });

  let caught = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 15_000) {
    if (await cachedVersion(page) >= bumped2) { caught = true; break; }
    await page.waitForTimeout(250);
  }
  check(caught, 'a single reload served the current database',
    `${Math.round(Date.now() - t1)}ms after load`);

  // The regression that made this script necessary: a second write moments
  // later, reloaded inside what used to be a 60s check window. The old code
  // skipped the version check entirely here, so no number of reloads helped.
  console.log('\nCase 3 — a second write seconds later (the old TTL blind spot)');
  await page.waitForTimeout(3500); // clear the burst-coalescer, nothing more
  const bumped3 = bumpDataVersion();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: 30_000 });

  let caught3 = false;
  const t2 = Date.now();
  while (Date.now() - t2 < 15_000) {
    if (await cachedVersion(page) >= bumped3) { caught3 = true; break; }
    await page.waitForTimeout(250);
  }
  check(caught3, 'back-to-back writes still need only one reload each');

  // ---- Case 4: a brand-new visitor is fresh by definition ----
  console.log('\nCase 4 — a different browser profile, entering cold');
  const bumped4 = bumpDataVersion();
  const fresh = await browser.newContext();
  await fresh.addInitScript(OPT_OUT);
  const freshPage = await fresh.newPage();
  await freshPage.goto(leagueUrl, { waitUntil: 'domcontentloaded' });
  await freshPage.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: 30_000 });
  check(await cachedVersion(freshPage) >= bumped4, 'cold entry served the current database');
  await fresh.close();

  await browser.close();

  console.log(`\nServer data_version now ${serverVersion()}.`);
  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} assertion(s):\n  - ${failures.join('\n  - ')}`);
    console.error('\nSee docs/data-architecture/02-query-standards.md rule 12.');
    process.exit(1);
  }
  console.log('\nPASS — the freshness contract holds.');
}

main().catch((err) => { console.error(err); process.exit(1); });
