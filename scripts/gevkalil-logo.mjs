#!/usr/bin/env node
/**
 * gevkalil-logo.mjs — render Gevkalil's logo PNGs from their SVG master.
 *
 *   gevkalil/assets/logo/logo.svg      the editable master (square, 640×640)
 *   gevkalil/assets/logo/logo.png      ← generated: the link-preview image
 *                                        (og:image / twitter:image — WhatsApp
 *                                        and friends do not accept SVG)
 *   gevkalil/assets/favicon-round.png  ← generated: the browser-tab icon, the
 *                                        round mark alone on transparency
 *
 * Same arrangement as the main site (assets/logo/logo.png + favicon-round.png).
 * Edit the SVG, run this, commit all three.
 *
 * The wordmark is set in Heebo 800. An SVG rendered as an image cannot load a
 * webfont, so the master is inlined into a page that carries the font as a
 * data: URL — the self-hosted file from the app, never a remote one.
 *
 *     node scripts/gevkalil-logo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'gevkalil', 'assets');
const svg = fs.readFileSync(path.join(ASSETS, 'logo', 'logo.svg'), 'utf8');
const font = fs.readFileSync(path.join(ROOT, 'shabi-israel', 'assets', 'fonts', 'heebo-800-normal-latin.woff2')).toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Heebo'; font-weight: 800; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: transparent; }
svg { display: block; }
</style>${svg}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
// No site page is opened; the opt-out is the standing rule for every
// browser-driving script regardless.
await context.addInitScript(() => { try { localStorage.setItem('shabi:no-analytics', '1'); } catch {} });
const page = await context.newPage();
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);

// The preview card: the whole square, opaque.
await page.locator('svg').screenshot({ path: path.join(ASSETS, 'logo', 'logo.png') });
console.log('assets/logo/logo.png');

// The tab icon: only the round mark, on transparency, cropped to its circle.
await page.evaluate(() => {
    const root = document.querySelector('svg');
    for (const el of [...root.children]) if (el.id !== 'mark' && el.tagName !== 'defs') el.remove();
    const box = root.querySelector('#mark').getBBox();
    root.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    root.setAttribute('width', '256');
    root.setAttribute('height', '256');
});
await page.locator('svg').screenshot({ path: path.join(ASSETS, 'favicon-round.png'), omitBackground: true });
console.log('assets/favicon-round.png');

await browser.close();
