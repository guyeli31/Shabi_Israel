/**
 * check-splash-arming.mjs — guards the one duplication the splash design needs.
 *
 * Whether the loading screen is armed at all is decided in each page's inline
 * <head> script, because the decision has to be made before any module has
 * loaded. A <head> script cannot import, so the rule it applies — the receipt's
 * key name, the schema version it accepts, and the max age it tolerates — is
 * written out by hand, while js/data/store.js holds the real definitions.
 *
 * That is exactly the shape of the DEFER_MS duplication that already carries a
 * "kept in step by hand" comment in splash.js, and hand-kept constants drift.
 * The failure would be silent and nasty in both directions: raise
 * EXPECTED_SCHEMA_VERSION in store.js alone and every page suppresses its
 * splash on a receipt the store then rejects, so a cold fetch runs with no
 * loading screen at all; change MAX_AGE_MS alone and the two disagree about
 * whether a week-old visitor is warm.
 *
 * So this asserts, mechanically, that the numbers match. Run it after touching
 * the receipt, the schema version, the cache max age, or any page's head script.
 *
 * Usage: node scripts/check-splash-arming.mjs   (exit 1 on any mismatch)
 */
import { readFile } from 'node:fs/promises';

const STORE = 'shabi-israel/js/data/store.js';
const SPLASH = 'shabi-israel/js/utils/splash.js';
// Only the pages whose data comes from store.js. analytics.html and admin.html
// read their own endpoints, so the site bundle's receipt says nothing about
// whether THEY have to fetch — suppressing their splash from it would hide a
// loading screen over a real wait.
const PAGES = [
  'shabi-israel/index.html',
  'shabi-israel/league.html',
  'shabi-israel/league_table.html',
  'shabi-israel/player_league.html',
  'shabi-israel/player.html',
];

const problems = [];
const num = (src, re, what, file) => {
  const m = src.match(re);
  if (!m) { problems.push(`${file}: could not find ${what}`); return null; }
  return Number(m[1].replace(/_/g, ''));
};

const storeSrc = await readFile(STORE, 'utf8');
const splashSrc = await readFile(SPLASH, 'utf8');

const receiptKey = storeSrc.match(/const RECEIPT_KEY = '([^']+)'/)?.[1];
if (!receiptKey) problems.push(`${STORE}: could not find RECEIPT_KEY`);

const schema = num(storeSrc, /const EXPECTED_SCHEMA_VERSION = (\d+)/, 'EXPECTED_SCHEMA_VERSION', STORE);
const maxAgeExpr = storeSrc.match(/const MAX_AGE_MS = ([^;]+);/)?.[1];
if (!maxAgeExpr) problems.push(`${STORE}: could not find MAX_AGE_MS`);
// eslint-disable-next-line no-eval -- a numeric literal expression from our own source
const maxAge = maxAgeExpr ? Number(eval(maxAgeExpr)) : null;

const deferJs = num(splashSrc, /const DEFER_MS = (\d+)/, 'DEFER_MS', SPLASH);

const fetchEvent = storeSrc.match(/const FETCH_START_EVENT = '([^']+)'/)?.[1];
if (!fetchEvent) problems.push(`${STORE}: could not find FETCH_START_EVENT`);
if (fetchEvent && !splashSrc.includes(`'${fetchEvent}'`)) {
  problems.push(`${SPLASH}: does not listen for the '${fetchEvent}' event store.js fires`);
}

for (const page of PAGES) {
  const src = await readFile(page, 'utf8');
  if (!src.includes('__splashSuppress')) {
    problems.push(`${page}: head script never sets __splashSuppress — its splash is still armed by stopwatch`);
    continue;
  }
  if (receiptKey && !src.includes(`'${receiptKey}'`)) {
    problems.push(`${page}: head script does not read the receipt key '${receiptKey}'`);
  }
  const pSchema = num(src, /var SP_SCHEMA = (\d+)/, 'SP_SCHEMA', page);
  const pMaxAge = num(src, /SP_MAX_AGE = (\d+)/, 'SP_MAX_AGE', page);
  const pDefer = num(src, /DEFER = (\d+)/, 'DEFER', page);
  if (pSchema !== null && schema !== null && pSchema !== schema) {
    problems.push(`${page}: SP_SCHEMA is ${pSchema}, but ${STORE} EXPECTED_SCHEMA_VERSION is ${schema}`);
  }
  if (pMaxAge !== null && maxAge !== null && pMaxAge !== maxAge) {
    problems.push(`${page}: SP_MAX_AGE is ${pMaxAge}ms, but ${STORE} MAX_AGE_MS is ${maxAge}ms`);
  }
  if (pDefer !== null && deferJs !== null && pDefer !== deferJs) {
    problems.push(`${page}: DEFER is ${pDefer}ms, but ${SPLASH} DEFER_MS is ${deferJs}ms`);
  }
}

if (problems.length) {
  console.error('Splash arming is out of step:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`OK — splash arming consistent across ${PAGES.length} pages (receipt '${receiptKey}', schema ${schema}, max age ${maxAge}ms, defer ${deferJs}ms).`);
