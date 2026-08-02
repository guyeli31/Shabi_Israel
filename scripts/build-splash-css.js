#!/usr/bin/env node
/**
 * build-splash-css.js — splash-config.json → splash-vars.css
 *
 * The splash's design is edited in splash-poc.html and saved as JSON. But
 * JSON has to be fetched, and that fetch measured ~330ms: long enough for
 * the splash to be painted in css/splash.css's fallback design and then
 * visibly restyle itself. A loading screen that changes design while you
 * watch it is worse than no loading screen.
 *
 * So the visual half of the config is also emitted as a stylesheet that each
 * page links in <head>. It is render-blocking (a few hundred bytes, same
 * origin), which is the point: the first frame is already correct.
 *
 * The editor writes this file directly on Save, using the same
 * js/utils/splashCss.js module this script imports — so the two can't drift.
 * This script exists to regenerate it from the committed JSON: after a merge,
 * a hand-edit, or a save from a browser without File System Access.
 *
 *   node scripts/build-splash-css.js          # write
 *   node scripts/build-splash-css.js --check  # verify it matches (CI)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splashCss } from '../js/utils/splashCss.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = path.join(ROOT, 'assets/splash/splash-config.json');
const CSS_PATH  = path.join(ROOT, 'assets/splash/splash-vars.css');

// Strip a BOM: JSON.parse rejects it, and a Windows editor (or PowerShell's
// Set-Content -Encoding utf8) adds one silently.
const cfg = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8').replace(/^﻿/, ''));
const css = splashCss(cfg);

if (process.argv.includes('--check')) {
    const current = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf8') : '';
    if (current !== css) {
        console.error('✗ assets/splash/splash-vars.css is stale.');
        console.error('  Run: node scripts/build-splash-css.js');
        process.exit(1);
    }
    console.log('✓ splash-vars.css matches splash-config.json.');
    process.exit(0);
}

fs.writeFileSync(CSS_PATH, css);
console.log(`✓ Wrote ${path.relative(ROOT, CSS_PATH).replace(/\\/g, '/')}`);
