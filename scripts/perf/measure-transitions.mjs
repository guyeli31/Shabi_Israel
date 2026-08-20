/**
 * measure-transitions.mjs — before/after performance harness.
 * Spec: docs/data-architecture/04-performance-budget.md
 *
 * Measures, per page transition: Supabase request count (blocking vs total),
 * bytes transferred to the Supabase host, time-to-table, splash visibility,
 * time-to-VISIBLE, and the bfcache persisted flag. Playwright + CDP only
 * (no Lighthouse — see spec for why).
 *
 * Usage: node scripts/perf/measure-transitions.mjs [--runs=5] [--out=<path>]
 *        [--base-url=<url>] [--supabase-host=<host>]
 *
 * --base-url/--supabase-host default to production. Point BOTH at a local dev
 * server for the docker-before/docker-after pair
 * (--base-url=http://localhost:8090/shabi-israel --supabase-host=127.0.0.1:54321).
 * The improvement delta must always come from one environment; production runs
 * are their own separate before/after pair across a release.
 *
 * ── Two corrections this harness carries over its first version ───────────
 *
 * 1. WARM TRANSITIONS ARE CLICKS, NOT page.goto().
 *    The original harness drove every warm transition with page.goto(), which
 *    sends NO Referer header. The splash's whole defer mechanism is gated on
 *    `document.referrer` starting with our own origin (see the inline head
 *    script in each page): with no referrer the page is treated as a direct
 *    hit and the splash is shown AT ONCE, skipping the defer entirely. So the
 *    old warm numbers measured a code path no real user ever takes — a
 *    referrer-less navigation between two of our own pages does not exist in
 *    the wild. Every warm hop here is a real click on a real link, and the
 *    journey walks the site the way a visitor does. Cold entries stay
 *    goto()-based, because that IS a cold entry: a bookmark or a shared link,
 *    correctly arriving with no referrer.
 *
 * 2. TIME-TO-TABLE IS NOT THE NUMBER A USER FEELS.
 *    The ready-selector is waited on with state:'attached' — it fires when the
 *    table enters the DOM. The loading screen is a fixed overlay ON TOP of that
 *    table, with its own minimum-display floor plus a ring-close wait and a
 *    fade. A page whose table attached at 445ms can stay covered until ~1040ms,
 *    and the old harness stopped the clock at 445 and called the transition
 *    fast. So two further metrics, sampled from ground truth (computed opacity
 *    of #logo-splash every frame) rather than from splash.js's own flags —
 *    reading the module's opinion of itself would only confirm it agrees with
 *    itself:
 *      splashSeen — did the loading screen become visible AT ALL (opacity>0.01)
 *      msVisible  — when the content was actually uncovered: the later of
 *                   "table attached" and "splash gone".
 *    msVisible is the headline number; ms is kept so old baselines stay
 *    comparable.
 *
 * Also handled (see spec): Playwright disables bfcache by default → launched
 * with ignoreDefaultArgs: ['--disable-back-forward-cache'], and headed, because
 * headless Chromium never restores from bfcache in this build.
 */

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  (args.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split('=').slice(1).join('=');

const BASE_URL = argOf('base-url', 'https://golan.me.uk/shabi-israel').replace(/\/$/, '');
const SUPABASE_HOST = argOf('supabase-host', 'oaowwbwssfsohaskrgnc.supabase.co');
const RUNS = Number(argOf('runs', '5'));
const outArg = args.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.split('=')[1] : null;

/**
 * Selectors that mean "this page has rendered its content".
 * Kept generous (comma lists) so a class rename degrades to a slower match
 * rather than a 15s timeout that silently reports a huge number.
 */
const READY_SELECTOR = {
  'index.html': '.league-card-title, .landing-league-card, a[href^="league_table.html"]',
  'league.html': 'table tbody tr',
  'league_table.html': 'table tbody tr',
  'player_league.html': 'table tbody tr, .match-row',
  'player.html': 'table tbody tr, .match-row',
};

/**
 * The journey — one continuous session, clicked through exactly as a visitor
 * walks it. Each hop names the link to click ON THE CURRENT PAGE; nothing here
 * hardcodes a league or player name, because those change (the leagues were
 * renamed out from under the previous version of this file, which still asked
 * for "Shabi Israel June 2026" and measured five 15-second timeouts).
 *
 * `click` is resolved inside .site-main so it can never match the nav flyout,
 * which carries a duplicate of every league link on every page — see
 * scopedLocator() for why that prefix has to be applied per comma-branch.
 */
const JOURNEY = [
  { from: 'index.html', to: 'league.html', click: '.league-card-title a' },
  { from: 'league.html', to: 'league_table.html', click: 'a.open-full-btn[href^="league_table.html"]' },
  // Note: the player links on league_table.html carry no class (unlike the
  // .player-name-link ones on index/league), so match on href alone.
  { from: 'league_table.html', to: 'player_league.html', click: 'a[href^="player_league.html"]' },
  { from: 'player_league.html', to: 'player.html', click: 'a[href^="player.html"]' },
];

/**
 * Scope a selector to .site-main, applying the prefix to EVERY comma branch.
 *
 * Naive string concatenation is wrong and fails silently in the worst possible
 * way: `.site-main ` + `a.foo, a.bar` yields `.site-main a.foo, a.bar`, whose
 * second branch is unscoped and matches document-wide. With .first() on top,
 * the locator then resolves to whatever appears earliest in DOM order — which
 * during development here was a non-link container div. Clicking it "succeeded"
 * (clicking a div is legal), no navigation happened, and the run reported a
 * 15-second transition instead of an error.
 */
function scopedLocator(page, selector, scope = '.site-main') {
  const scoped = selector.split(',').map((s) => `${scope} ${s.trim()}`).join(', ');
  return page.locator(scoped).first();
}

/** Endpoints that are fire-and-forget by design (store.js never awaits them as
 *  part of a page's render path) — excluded from the "blocking" count even if
 *  their response happens to arrive before the ready-selector matches. On
 *  localhost these share a host with the bundle RPC, and a fast local round
 *  trip resolving before render was a false positive that inflated every
 *  measurement by exactly 1. */
const NON_BLOCKING_PATHS = ['/analytics_events', '/rest/v1/site_meta'];

/** Analytics beacons this whole run let escape. Must finish at 0 — see the
 *  opt-out in INIT_SCRIPT. Reported at the end so a regression is impossible to
 *  miss, rather than discovered later in someone's live dashboard. */
let beaconsSent = 0;

/**
 * Installed once per context, BEFORE the first navigation: the analytics
 * opt-out, the splash probe, and the bfcache flag.
 *
 * The opt-out has to be first and has to be here rather than in a URL param.
 * This harness drives a real browser against the real site, so every page it
 * opens fires a real analytics beacon, and it uses a FRESH profile per
 * measurement — so each one registers as its own visitor. A single "before" run
 * against production put 151 pageviews across 103 sessions into one hour of
 * the live dashboard. addInitScript runs before any page script on every
 * navigation in this context, so the flag is set before analytics.js reads it
 * and survives the whole journey.
 */
const INIT_SCRIPT = () => {
  try { localStorage.setItem('shabi:no-analytics', '1'); } catch { /* storage blocked */ }

  window.__pageshowPersisted = false;
  window.addEventListener('pageshow', (e) => { window.__pageshowPersisted = e.persisted; });

  const s = { seen: false, firstVisibleAt: null, lastVisibleAt: null, goneAt: null, maxOpacity: 0 };
  window.__splashProbe = s;
  const poll = () => {
    const el = document.getElementById('logo-splash');
    if (el) {
      const cs = getComputedStyle(el);
      const op = parseFloat(cs.opacity) || 0;
      if (op > s.maxOpacity) s.maxOpacity = op;
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && op > 0.01) {
        if (!s.seen) { s.seen = true; s.firstVisibleAt = performance.now(); }
        s.lastVisibleAt = performance.now();
      }
    } else if (s.seen && s.goneAt === null) {
      s.goneAt = performance.now();
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

/** A fresh, cache-free context with the probe installed and Supabase responses
 *  recorded. `sliceSince(t0, t1)` reports what happened inside one hop. */
async function newInstrumentedContext(browser) {
  const context = await browser.newContext();
  await context.addInitScript(INIT_SCRIPT);

  const events = [];
  const page = await context.newPage();

  // Proof, per run, that the opt-out above held. Counted on `request` rather
  // than `response` because a beacon is fire-and-forget: it can leave without
  // its reply ever being awaited, and counting replies would under-report the
  // exact thing we are trying to guarantee is zero.
  page.on('request', (req) => {
    if (req.url().includes('/analytics_events')) beaconsSent++;
  });

  page.on('response', (resp) => {
    try {
      const url = resp.url();
      if (!url.includes(SUPABASE_HOST)) return;
      const len = resp.headers()['content-length'];
      events.push({
        t: Date.now(),
        bytes: len ? Number(len) : 0,
        blockable: !NON_BLOCKING_PATHS.some((p) => url.includes(p)),
      });
    } catch { /* response may be gone already */ }
  });

  return {
    context,
    page,
    sliceSince(t0, readyAt) {
      const win = events.filter((e) => e.t >= t0);
      return {
        blocking: win.filter((e) => e.blockable && e.t <= readyAt).length,
        total: win.length,
        bytes: win.reduce((sum, e) => sum + e.bytes, 0),
      };
    },
  };
}

/** Waits for the ready-selector to attach. */
async function waitForReady(page, selector, startTime) {
  await page.waitForSelector(selector, { timeout: 15000, state: 'attached' }).catch(() => null);
  const readyAt = Date.now();
  return { ms: readyAt - startTime, readyAt };
}

/**
 * Waits until nothing covers the content any more — #logo-splash has left the
 * DOM. splash.js removes the node on BOTH of its exits (immediately when it was
 * never revealed, after the fade when it was), so element-absent is the one
 * condition that means "uncovered" in every case. Always called after
 * waitForReady, so the result is inherently >= time-to-table.
 */
async function waitForUncovered(page, startTime) {
  await page.waitForFunction(() => !document.getElementById('logo-splash'), null, { timeout: 20000 }).catch(() => null);
  const msVisible = Date.now() - startTime;
  const splash = await page.evaluate(() => {
    const s = window.__splashProbe;
    if (!s) return { seen: false, visibleMs: 0, maxOpacity: 0 };
    return {
      seen: s.seen,
      maxOpacity: Math.round(s.maxOpacity * 100) / 100,
      visibleMs: s.seen ? Math.round((s.goneAt ?? s.lastVisibleAt) - s.firstVisibleAt) : 0,
    };
  }).catch(() => ({ seen: false, visibleMs: 0, maxOpacity: 0 }));
  return { msVisible, splash };
}

/** One cold entry: fresh profile, direct URL, no referrer — a bookmark or a
 *  shared link, which is exactly how a cold entry actually happens. */
async function measureCold(browser, pageName, url) {
  const { context, page, sliceSince } = await newInstrumentedContext(browser);
  const start = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const { ms, readyAt } = await waitForReady(page, READY_SELECTOR[pageName], start);
  const requests = sliceSince(start, readyAt);
  const { msVisible, splash } = await waitForUncovered(page, start);
  await context.close();
  return { ms, msVisible, splash, requests };
}

/**
 * One full journey: cold-start the landing page, then CLICK through every hop.
 * Returns a per-hop measurement plus one Back measurement from the last page.
 */
async function measureJourney(browser) {
  const { context, page, sliceSince } = await newInstrumentedContext(browser);
  const hops = {};

  // Cold start of the journey — not measured here (measureCold does that
  // properly with a fresh profile per page); this only warms the cache so the
  // hops that follow are genuine warm transitions.
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
  await waitForUncovered(page, Date.now());

  for (const hop of JOURNEY) {
    const link = scopedLocator(page, hop.click);
    if (!(await link.count())) {
      hops[`${hop.from}->${hop.to}`] = { error: `no link matching ${hop.click}` };
      break;
    }
    const start = Date.now();
    let navigated = true;
    await Promise.all([
      page.waitForURL(`**/${hop.to}*`, { timeout: 15000 }).catch(() => { navigated = false; }),
      link.click(),
    ]);
    // A click that did not navigate must be reported, never measured: the
    // timings that follow would be of the page we never left.
    if (!navigated) {
      hops[`${hop.from}->${hop.to}`] = { error: `click on "${hop.click}" did not navigate to ${hop.to}` };
      break;
    }
    const { ms, readyAt } = await waitForReady(page, READY_SELECTOR[hop.to], start);
    const requests = sliceSince(start, readyAt);
    const { msVisible, splash } = await waitForUncovered(page, start);
    hops[`${hop.from}->${hop.to}`] = { ms, msVisible, splash, requests };
  }

  // Back-nav from wherever the journey ended. waitUntil:'commit' is required:
  // a true bfcache restore never fires load/domcontentloaded (the page is
  // resurrected from a frozen snapshot, not re-parsed), so waiting on those
  // hangs until timeout on every actual bfcache hit.
  const backFrom = JOURNEY[JOURNEY.length - 1];
  const backStart = Date.now();
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  const { ms: backMs, readyAt: backReadyAt } = await waitForReady(page, READY_SELECTOR[backFrom.from], backStart);
  const backRequests = sliceSince(backStart, backReadyAt);
  const persisted = await page.evaluate(() => window.__pageshowPersisted).catch(() => false);

  await context.close();
  return { hops, back: { ms: backMs, requests: backRequests, bfcachePersisted: persisted } };
}

/** Reads the live league/player names off the landing page, so cold-entry URLs
 *  are always built from what the site actually serves today. */
async function discoverTargets(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
  const found = await page.evaluate(() => {
    const main = document.querySelector('.site-main') || document.body;
    const href = (sel) => main.querySelector(sel)?.getAttribute('href') || null;
    return {
      league: href('.league-card-title a, a[href^="league.html"]'),
      leagueTable: href('a[href^="league_table.html"]'),
      playerLeague: href('a.player-name-link[href^="player_league.html"], a[href^="player_league.html"]'),
    };
  });
  await context.close();

  const q = (h, k) => (h ? new URLSearchParams(h.split('?')[1] || '').get(k) : null);
  const league = q(found.league, 'league') || q(found.leagueTable, 'league');
  const player = q(found.playerLeague, 'player');
  if (!league || !player) throw new Error(`Could not discover a league/player from ${BASE_URL}/index.html`);
  const encL = encodeURIComponent(league);
  const encP = encodeURIComponent(player);
  return {
    league,
    player,
    urls: {
      'index.html': `${BASE_URL}/index.html`,
      'league.html': `${BASE_URL}/league.html?league=${encL}`,
      'league_table.html': `${BASE_URL}/league_table.html?league=${encL}`,
      'player_league.html': `${BASE_URL}/player_league.html?league=${encL}&player=${encP}`,
      'player.html': `${BASE_URL}/player.html?player=${encP}`,
    },
  };
}

function median(arr) {
  const nums = arr.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  console.log(`Target:  ${BASE_URL}`);
  console.log(`Supabase host: ${SUPABASE_HOST}`);
  console.log(`Runs per scenario: ${RUNS}\n`);

  const browser = await chromium.launch({
    headless: false,
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  });

  const { league, player, urls } = await discoverTargets(browser);
  console.log(`Discovered league "${league}", player "${player}"\n`);

  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL, supabaseHost: SUPABASE_HOST, runs: RUNS,
    discovered: { league, player },
    scenarios: {},
  };

  console.log('── Cold entry (fresh profile, direct link) ──');
  for (const pageName of Object.keys(READY_SELECTOR)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measureCold(browser, pageName, urls[pageName]));
    const seen = runs.filter((r) => r.splash.seen).length;
    results.scenarios[`cold:${pageName}`] = {
      msMedian: median(runs.map((r) => r.ms)),
      msMax: Math.max(...runs.map((r) => r.ms)),
      msVisibleMedian: median(runs.map((r) => r.msVisible)),
      splashSeenRate: seen / runs.length,
      splashVisibleMsMedian: median(runs.map((r) => r.splash.visibleMs)),
      blockingRequestsMedian: median(runs.map((r) => r.requests.blocking)),
      totalRequestsMedian: median(runs.map((r) => r.requests.total)),
      bytesMedian: median(runs.map((r) => r.requests.bytes)),
    };
    console.log(`[cold] ${pageName.padEnd(20)} table ${String(median(runs.map((r) => r.ms))).padStart(5)}ms | visible ${String(median(runs.map((r) => r.msVisible))).padStart(5)}ms | splash ${seen}/${runs.length} | ${median(runs.map((r) => r.requests.blocking))} blocking`);
  }

  console.log('\n── Warm journey (real clicks, real referrer) ──');
  const journeys = [];
  for (let i = 0; i < RUNS; i++) journeys.push(await measureJourney(browser));

  for (const hop of JOURNEY) {
    const key = `${hop.from}->${hop.to}`;
    const runs = journeys.map((j) => j.hops[key]).filter((r) => r && !r.error);
    if (!runs.length) {
      results.scenarios[`warm:${key}`] = { error: journeys[0]?.hops[key]?.error || 'no runs' };
      console.log(`[warm] ${key}: FAILED — ${results.scenarios[`warm:${key}`].error}`);
      continue;
    }
    const seen = runs.filter((r) => r.splash.seen).length;
    results.scenarios[`warm:${key}`] = {
      msMedian: median(runs.map((r) => r.ms)),
      msVisibleMedian: median(runs.map((r) => r.msVisible)),
      // THE acceptance metric for the splash work: must be 0 on every warm
      // transition. Binary pass/fail, not a speed number.
      splashSeenRate: seen / runs.length,
      splashVisibleMsMedian: median(runs.map((r) => r.splash.visibleMs)),
      blockingRequestsMedian: median(runs.map((r) => r.requests.blocking)),
    };
    console.log(`[warm] ${key.padEnd(38)} table ${String(median(runs.map((r) => r.ms))).padStart(5)}ms | visible ${String(median(runs.map((r) => r.msVisible))).padStart(5)}ms | SPLASH SEEN ${seen}/${runs.length}${seen ? ` (${median(runs.map((r) => r.splash.visibleMs))}ms on screen)` : ''} | ${median(runs.map((r) => r.requests.blocking))} blocking`);
  }

  const backRuns = journeys.map((j) => j.back);
  results.scenarios['back-nav'] = {
    msMedian: median(backRuns.map((r) => r.ms)),
    blockingRequestsMedian: median(backRuns.map((r) => r.requests.blocking)),
    bfcacheHitRate: backRuns.filter((r) => r.bfcachePersisted).length / backRuns.length,
  };
  console.log(`[back] ${String(median(backRuns.map((r) => r.ms))).padStart(5)}ms | bfcache ${Math.round(100 * results.scenarios['back-nav'].bfcacheHitRate)}%`);

  await browser.close();

  results.analyticsBeaconsSent = beaconsSent;
  if (beaconsSent === 0) {
    console.log('\n✓ 0 analytics beacons sent — this run left no trace in the dashboard.');
  } else {
    console.error(`\n✗ ${beaconsSent} ANALYTICS BEACON(S) ESCAPED — this run polluted the dashboard.`);
    console.error('  The opt-out in INIT_SCRIPT did not hold. Check js/analytics.js still reads');
    console.error("  localStorage['shabi:no-analytics'], and see sql/cleanup_test_analytics_2026-08-18.sql");
    console.error('  for the shape of the cleanup this needs.');
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nWritten: ${outPath}`);
  } else {
    console.log(`\n${JSON.stringify(results, null, 2)}`);
  }
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
