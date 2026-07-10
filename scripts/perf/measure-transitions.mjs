/**
 * measure-transitions.mjs — before/after performance harness.
 * Spec: docs/data-architecture/04-performance-budget.md
 *
 * Measures, per page transition: Supabase request count (blocking vs total),
 * bytes transferred to the Supabase host, time-to-table, and bfcache
 * persisted flag. Playwright + CDP only (no Lighthouse — see spec for why).
 *
 * Gotchas handled here (see spec):
 *  - Playwright disables bfcache by default → launched with
 *    ignoreDefaultArgs: ['--disable-back-forward-cache'].
 *  - Must run against the deployed site, not localhost (which auto-targets
 *    local Docker Supabase, not the production database).
 *
 * Usage: node scripts/perf/measure-transitions.mjs [--runs=5] [--out=<path>]
 *        [--base-url=<url>] [--supabase-host=<host>]
 *
 * --base-url/--supabase-host default to production; pass both to point at a
 * local dev server (e.g. --base-url=http://localhost:8090
 * --supabase-host=127.0.0.1:54321) for a "before code change lands on
 * production" sanity check. Request-count deltas from such a run are valid;
 * absolute ms are NOT comparable to a production baseline (different
 * network/DB latency) — see docs/data-architecture/04-performance-budget.md.
 */

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const args0 = process.argv.slice(2);
const BASE_URL = (args0.find((a) => a.startsWith('--base-url=')) || '--base-url=https://golan.me.uk').split('=')[1];
const SUPABASE_HOST = (args0.find((a) => a.startsWith('--supabase-host=')) || '--supabase-host=oaowwbwssfsohaskrgnc.supabase.co').split('=')[1];

const LEAGUE_ID = 'Shabi Israel June 2026';
const PLAYER_ID = 'Idan1986';

const READY_SELECTOR = {
  'index.html': '.landing-league-card, .league-card, a[href*="league_table.html"]',
  'league.html': '#league-table tbody tr, table tbody tr',
  'league_table.html': '#league-table tbody tr, table tbody tr',
  'player_league.html': 'table tbody tr, .match-row',
  'player.html': 'table tbody tr, .match-row',
};

function urlFor(page) {
  const enc = encodeURIComponent(LEAGUE_ID);
  const encP = encodeURIComponent(PLAYER_ID);
  switch (page) {
    case 'index.html': return `${BASE_URL}/index.html`;
    case 'league.html': return `${BASE_URL}/league.html?league=${enc}`;
    case 'league_table.html': return `${BASE_URL}/league_table.html?league=${enc}`;
    case 'player_league.html': return `${BASE_URL}/player_league.html?league=${enc}&player=${encP}`;
    case 'player.html': return `${BASE_URL}/player.html?player=${encP}`;
    default: throw new Error(`Unknown page: ${page}`);
  }
}

function readySelectorFor(page) {
  return READY_SELECTOR[page] || 'body';
}

const args = process.argv.slice(2);
const RUNS = Number((args.find((a) => a.startsWith('--runs=')) || '--runs=5').split('=')[1]);
const outArg = args.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.split('=')[1] : null;

/**
 * Instruments a page: records every Supabase response with a timestamp
 * (relative to `performance.now()`-style Date.now()), plus the bfcache
 * persisted flag. Call `resolveCounts(readyElapsedMs, navStart)` after
 * waitForReady() to split the recorded responses into "blocking" (occurred
 * before the ready-selector matched) vs "total" (whole page-load window).
 */
// Endpoints that are fire-and-forget by design (store.js never awaits them
// as part of a page's render path) — excluded from the "blocking" count even
// if their response happens to arrive before the ready-selector matches.
// Discovered empirically: on localhost, analytics_events shares the same
// Supabase host as the bundle RPC (both 127.0.0.1:54321), and a fast local
// round trip can resolve before render finishes purely by timing — counting
// it as "blocking" by host+timing alone was a false positive that inflated
// every measurement by exactly 1 (see docs/data-architecture/
// 04-performance-budget.md's "harness measurement gotcha" note).
const NON_BLOCKING_PATHS = ['/analytics_events', '/rest/v1/site_meta'];

async function instrument(page) {
  const events = []; // { t: Date.now(), bytes, blockable }

  page.on('response', (resp) => {
    try {
      const url = resp.url();
      if (url.includes(SUPABASE_HOST)) {
        const len = resp.headers()['content-length'];
        const blockable = !NON_BLOCKING_PATHS.some((p) => url.includes(p));
        events.push({ t: Date.now(), bytes: len ? Number(len) : 0, blockable });
      }
    } catch { /* response may be gone already */ }
  });

  await page.addInitScript(() => {
    window.__pageshowPersisted = false;
    window.addEventListener('pageshow', (e) => { window.__pageshowPersisted = e.persisted; });
  });

  return {
    resolveCounts(navStart, readyAt) {
      const blocking = events.filter((e) => e.blockable && e.t <= readyAt).length;
      const bytes = events.reduce((sum, e) => sum + e.bytes, 0);
      return { blocking, total: events.length, bytes };
    },
  };
}

/** Waits for the ready-selector to appear, returns { ms, readyAt }. */
async function waitForReady(page, selector, startTime) {
  await page.waitForSelector(selector, { timeout: 15000, state: 'attached' }).catch(() => null);
  const readyAt = Date.now();
  return { ms: readyAt - startTime, readyAt };
}

async function measureCold(browser, page) {
  const context = await browser.newContext();
  const p = await context.newPage();
  const { resolveCounts } = await instrument(p);

  const start = Date.now();
  await p.goto(urlFor(page), { waitUntil: 'domcontentloaded' });
  const { ms, readyAt } = await waitForReady(p, readySelectorFor(page), start);
  const requests = resolveCounts(start, readyAt);

  await context.close();
  return { ms, requests };
}

async function measureWarmAndBack(browser, fromPage, toPage) {
  const context = await browser.newContext();
  const p = await context.newPage();

  // Seed: visit index first, then the "from" page, to warm any client cache.
  await instrument(p);
  await p.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.goto(urlFor(fromPage), { waitUntil: 'networkidle' }).catch(() => {});

  // Warm forward nav: fromPage -> toPage
  const { resolveCounts: resolveFwd } = await instrument(p);
  const fwdStart = Date.now();
  await p.goto(urlFor(toPage), { waitUntil: 'domcontentloaded' });
  const { ms: fwdMs, readyAt: fwdReadyAt } = await waitForReady(p, readySelectorFor(toPage), fwdStart);
  const fwdRequests = resolveFwd(fwdStart, fwdReadyAt);

  // Back-nav. waitUntil:'commit' is required, not 'load'/'domcontentloaded' —
  // a true bfcache restore never fires load/domcontentloaded (the page is
  // resurrected from a frozen snapshot, not re-parsed), so waiting on those
  // events hangs until Playwright's timeout on every actual bfcache hit.
  const { resolveCounts: resolveBack } = await instrument(p);
  const backStart = Date.now();
  await p.goBack({ waitUntil: 'commit' }).catch(() => {});
  const { ms: backMs, readyAt: backReadyAt } = await waitForReady(p, readySelectorFor(fromPage), backStart);
  const backRequests = resolveBack(backStart, backReadyAt);
  const persisted = await p.evaluate(() => window.__pageshowPersisted).catch(() => false);

  await context.close();
  return {
    forward: { ms: fwdMs, requests: fwdRequests },
    back: { ms: backMs, requests: backRequests, bfcachePersisted: persisted },
  };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  console.log(`Target: ${BASE_URL} (must be the deployed site, not localhost)`);
  console.log(`Runs per scenario: ${RUNS}\n`);

  // headless:false is required, not just ignoreDefaultArgs — confirmed
  // empirically during Phase 0: genuinely headless Chromium (both default
  // and explicit --headless=new) never restores from bfcache in this
  // Playwright build, so every back-nav becomes a bfcache miss regardless
  // of the site's own behavior. Headed mode is the only way to observe a
  // real bfcache hit locally; CI running this headless would need Xvfb (or
  // an equivalent virtual display) to launch headed rather than relying on
  // headless mode to report accurate bfcache numbers.
  const browser = await chromium.launch({
    headless: false,
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  });

  const results = { generatedAt: new Date().toISOString(), baseUrl: BASE_URL, runs: RUNS, scenarios: {} };

  // Cold entry, each page
  for (const page of Object.keys(READY_SELECTOR)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      runs.push(await measureCold(browser, page));
    }
    const msValues = runs.map((r) => r.ms);
    const blockingValues = runs.map((r) => r.requests.blocking);
    results.scenarios[`cold:${page}`] = {
      msMedian: median(msValues), msMax: Math.max(...msValues),
      blockingRequestsMedian: median(blockingValues),
      totalRequestsMedian: median(runs.map((r) => r.requests.total)),
    };
    console.log(`[cold] ${page}: ${median(msValues)}ms median, ${median(blockingValues)} blocking Supabase requests`);
  }

  // Warm transitions + back-nav
  const transitions = [
    ['index.html', 'league_table.html'],
    ['league_table.html', 'player_league.html'],
    ['player_league.html', 'player.html'],
    ['league.html', 'index.html'],
    ['index.html', 'league.html'],
  ];
  for (const [from, to] of transitions) {
    const fwdRuns = [];
    const backRuns = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await measureWarmAndBack(browser, from, to);
      fwdRuns.push(r.forward);
      backRuns.push(r.back);
    }
    const key = `warm:${from}->${to}`;
    results.scenarios[key] = {
      forward: {
        msMedian: median(fwdRuns.map((r) => r.ms)),
        blockingRequestsMedian: median(fwdRuns.map((r) => r.requests.blocking)),
      },
      back: {
        msMedian: median(backRuns.map((r) => r.ms)),
        blockingRequestsMedian: median(backRuns.map((r) => r.requests.blocking)),
        bfcacheHitRate: backRuns.filter((r) => r.bfcachePersisted).length / backRuns.length,
      },
    };
    console.log(`[warm] ${from} -> ${to}: fwd ${median(fwdRuns.map((r) => r.ms))}ms / ${median(fwdRuns.map((r) => r.requests.blocking))} blocking; back ${median(backRuns.map((r) => r.ms))}ms, bfcache hit rate ${Math.round(100 * backRuns.filter((r) => r.bfcachePersisted).length / backRuns.length)}%`);
  }

  await browser.close();

  console.log('\n--- Summary (fill into docs/data-architecture/04-performance-budget.md) ---');

  if (outPath) {
    await writeFile(outPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`Written: ${outPath}`);
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
