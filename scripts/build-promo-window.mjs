#!/usr/bin/env node
/**
 * build-promo-window.mjs — promo-config.json → js/render/promoWindow.js
 *
 * WHY THIS FILE EXISTS
 *
 * js/analytics.js stamps `promo_banner` on every event, so the dashboard can
 * mark each page the UBC announcement was on screen for (🎉) instead of
 * inventing a separate "shown" click. That stamp is computed ONCE, at module
 * load, immediately before the pageview beacon goes out — so the predicate
 * behind it has to be fully SYNCHRONOUS. movedNotice.js gets this for free: its
 * window is a code constant (`EXPIRES_ON`).
 *
 * The promo's window is not: it lives in assets/promo/promo-config.json, which
 * the Promo Lab writes and which has to be FETCHED. That fetch resolves long
 * after the pageview has already been sent, and analytics is insert-only — the
 * row can never be amended afterwards. Caching the fetched window would not
 * help either: the one pageview that matters most, a first-ever visitor's
 * arrival, is precisely the one with a cold cache.
 *
 * So the window is ALSO emitted as a tiny JS module that analytics.js can
 * import statically. Exactly the same problem, and the same answer, as
 * assets/splash/splash-vars.css (see CLAUDE.md § The loading screen): the JSON
 * stays the source of truth a human edits, and a generated artefact makes it
 * available at a moment when fetching is too late.
 *
 * The Promo Lab's "Save to site" writes BOTH files, so they cannot drift from
 * a normal edit. This script regenerates the JS from the committed JSON after
 * a merge, a hand-edit, or a save from a browser without File System Access.
 *
 *   node scripts/build-promo-window.mjs          # write
 *   node scripts/build-promo-window.mjs --check  # verify it matches (CI/gate)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo root is the domain root; the site lives one folder down
// (see CLAUDE.md § Hosting layout).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shabi-israel');
const JSON_PATH = path.join(ROOT, 'assets/promo/promo-config.json');
const JS_PATH = path.join(ROOT, 'js/render/promoWindow.js');

// Fallbacks only — a truncated config must not make the notice run forever (no
// end) or never (no start). Kept identical to DEFAULT_CONFIG in promoNotice.js.
const FALLBACK_STARTS = '2026-09-20';
const FALLBACK_ENDS = '2026-10-31';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Strip a BOM: JSON.parse rejects it, and a Windows editor (or PowerShell's
// Set-Content -Encoding utf8) adds one silently.
const cfg = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8').replace(/^﻿/, ''));

function day(value, fallback, field) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) return fallback;
    if (!ISO_DAY.test(v)) {
        console.error(`✗ promo-config.json: ${field} is "${v}", not an ISO YYYY-MM-DD day.`);
        process.exit(1);
    }
    return v;
}

const startsOn = day(cfg.startsOn, FALLBACK_STARTS, 'startsOn');
const endsOn = day(cfg.endsOn, FALLBACK_ENDS, 'endsOn');

if (endsOn < startsOn) {
    console.error(`✗ promo-config.json: endsOn (${endsOn}) is before startsOn (${startsOn}) — the notice would never render.`);
    process.exit(1);
}

const js = `/**
 * promoWindow.js — GENERATED, DO NOT EDIT.
 *
 * Source: assets/promo/promo-config.json
 * Regenerate: node scripts/build-promo-window.mjs   (--check to verify)
 *
 * The UBC announcement's date window, in Israel wall-clock days (inclusive at
 * both ends), as a pair of constants rather than a fetched config — because
 * js/analytics.js has to know whether the announcement is on screen BEFORE it
 * sends the pageview, and a fetch resolves far too late for that. Full
 * rationale in scripts/build-promo-window.mjs.
 *
 * TEMPORARY, with js/render/promoNotice.js — delete both together.
 */

export const PROMO_STARTS_ON = '${startsOn}';
export const PROMO_ENDS_ON = '${endsOn}';
`;

if (process.argv.includes('--check')) {
    const current = fs.existsSync(JS_PATH) ? fs.readFileSync(JS_PATH, 'utf8') : '';
    if (current !== js) {
        console.error('✗ js/render/promoWindow.js is stale — its dates disagree with assets/promo/promo-config.json.');
        console.error(`  config says ${startsOn} → ${endsOn}`);
        console.error('  Run: node scripts/build-promo-window.mjs');
        process.exit(1);
    }
    console.log(`✓ promoWindow.js matches promo-config.json (${startsOn} → ${endsOn}).`);
    process.exit(0);
}

fs.writeFileSync(JS_PATH, js);
console.log(`✓ Wrote js/render/promoWindow.js (${startsOn} → ${endsOn})`);
