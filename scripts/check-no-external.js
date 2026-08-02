#!/usr/bin/env node
/**
 * check-no-external.js — fail if any page can load a third-party resource.
 *
 * Standing project rule: nothing may be fetched from an origin we don't own.
 * No Google Fonts, no CDN scripts, no remote stylesheets or images, and no
 * runtime-injected <link>/<script> pointing off-origin. The only permitted
 * off-origin destination is our own backend (Supabase).
 *
 * Two reasons, both of which have bitten this project:
 *   · Privacy — a third-party <link> hands that company every visitor's IP
 *     address and user-agent on page load.
 *   · Performance — a render-blocking third-party request in <head> measured
 *     ~324ms of blank screen on a cold load, in front of the loading screen
 *     whose entire job is to cover latency.
 *
 * This check exists because the regression is invisible in code review and
 * only shows up in a network panel. Run:  node scripts/check-no-external.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Directories that are not ours to police: third-party bundles we vendored
   deliberately (their source comments are full of URLs), build output, and
   the v2 rebuild, which has its own tooling. */
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'v2', 'vendor', '.playwright-mcp',
    'supabase-migration', 'docs', '_archive_v1'
]);

const EXTS = new Set(['.html', '.css', '.js']);

/* Hosts we are allowed to talk to. Supabase is the app's own backend; the
   *.supabase.co wildcard covers the project's cloud instance. */
const ALLOWED = [
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/,
    /^https?:\/\/[a-z0-9-]+\.supabase\.co/,
    /^https?:\/\/[a-z0-9-]+\.supabase\.in/
];

/* Patterns that indicate an actual runtime LOAD, not a URL in a comment or a
   canonical/og: meta tag. Anything matching here is checked against ALLOWED. */
const LOADERS = [
    { re: /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,   what: '<link href>' },
    { re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,  what: '<script src>' },
    { re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,     what: '<img src>' },
    { re: /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,  what: '<iframe src>' },
    { re: /url\(\s*["']?(https?:\/\/[^)"']+)/gi,                 what: 'css url()' },
    { re: /@import\s+["']([^"']+)["']/gi,                        what: '@import' },
    { re: /\.(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi,  what: 'JS .href/.src assignment' },
    { re: /\b(?:fetch|importScripts)\(\s*["'](https?:\/\/[^"']+)["']/gi, what: 'JS fetch()' }
];

/* A <link rel="preconnect"/"dns-prefetch"> to a third party is also a leak:
   it opens a connection to them before anything is even requested. */
const isOffOrigin = (url) =>
    /^(https?:)?\/\//.test(url) && !ALLOWED.some(re => re.test(url.replace(/^\/\//, 'https://')));

const findings = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (EXTS.has(path.extname(entry.name))) {
            scan(path.join(dir, entry.name));
        }
    }
}

function scan(file) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const { re, what } of LOADERS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
            const url = m[1];
            if (!isOffOrigin(url)) continue;
            // og:image / twitter:image / canonical point at our own public
            // domain for link previews; they are metadata, never fetched by
            // the page itself.
            if (/property=["'](og:|twitter:)/.test(m[0]) || /rel=["']canonical/.test(m[0])) continue;
            const line = src.slice(0, m.index).split('\n').length;
            findings.push({ file: rel, line, what, url: url.slice(0, 100) });
        }
    }
}

walk(ROOT);

if (findings.length === 0) {
    console.log('✓ No third-party resources found.');
    process.exit(0);
}

console.error(`✗ ${findings.length} third-party resource reference(s) found.`);
console.error('  Project rule: everything must be served from our own origin.');
console.error('  Fonts → add to SPECS in scripts/fetch-fonts.js and re-run it.');
console.error('  Libraries → vendor into vendor/ instead of using a CDN.\n');
for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.what}]  ${f.url}`);
}
process.exit(1);
