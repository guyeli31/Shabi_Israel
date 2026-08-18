/**
 * check-no-analytics-pollution.mjs — every browser-driving script must opt out
 * of analytics before it navigates.
 *
 * Why this is a gate and not a convention
 * ---------------------------------------
 * A performance harness has to drive a REAL browser against the REAL site;
 * that is the entire point, and it means every page it opens fires a real
 * analytics beacon. It is also the kind of thing nobody remembers, because the
 * damage is invisible from the script's own output — it shows up days later in
 * someone else's dashboard.
 *
 * It already happened: on 2026-08-18 a single "before" run against production
 * wrote **151 pageviews across 103 sessions into one hour** of the live
 * analytics. Each measurement uses a fresh browser profile, so each registered
 * as its own visitor. The cleanup needed a hand-written SQL file
 * (sql/cleanup_test_analytics_2026-08-18.sql) reconstructed from timestamps,
 * because the traffic had left no marker to filter on.
 *
 * So: any script under scripts/ that imports Playwright must set
 * localStorage['shabi:no-analytics'] inside an addInitScript — before the first
 * navigation, not after, and not via a URL param (a param covers one page load;
 * these scripts navigate dozens of times).
 *
 * Usage: node scripts/check-no-analytics-pollution.mjs   (exit 1 on a violation)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = 'scripts';
const KEY = 'shabi:no-analytics';

// Dependencies are not ours to police — and Playwright's own bundle naturally
// mentions Playwright, so scanning them produces nothing but noise.
const SKIP_DIRS = new Set(['node_modules', '.git']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0;

for (const file of await walk(ROOT)) {
  const src = await readFile(file, 'utf8');
  // Only scripts that actually open a browser can pollute anything.
  if (!/from ['"]playwright['"]|require\(['"]playwright['"]\)/.test(src)) continue;
  checked++;

  if (!src.includes(KEY)) {
    problems.push(`${file}: drives a browser but never sets localStorage['${KEY}'] — its traffic will land in the live dashboard`);
    continue;
  }
  if (!src.includes('addInitScript')) {
    problems.push(`${file}: sets '${KEY}' but not via addInitScript — it must be written BEFORE the first navigation, or the first pageview is still recorded`);
  }
}

if (problems.length) {
  console.error('Scripts that would pollute analytics:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s). Add to the context's addInitScript:`);
  console.error(`    try { localStorage.setItem('${KEY}', '1'); } catch {}`);
  process.exit(1);
}
console.log(`OK — all ${checked} browser-driving script(s) under ${ROOT}/ opt out of analytics before navigating.`);
