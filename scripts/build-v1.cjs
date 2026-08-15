#!/usr/bin/env node
/**
 * build-v1.cjs — content-hash fingerprinting build for the v1 (no-framework) site.
 *
 * WHY: GitHub Pages forces Cache-Control: max-age=600 and it can't be changed.
 * A stuck intermediate proxy can serve stale JS/CSS well past that window, and
 * v1's relative-import graph can't be busted by a query string on the entry file
 * (the query does not propagate to relatively-resolved children). Content-hashing
 * the whole module graph (via esbuild) + hashing every CSS file changes the URL
 * on any content change, so caches — including query-ignoring proxies, because the
 * PATH itself changes — are forced to refetch. Only the small HTML entry files
 * revalidate on the 10-min window.
 *
 * OUTPUT: dist/ — a deployable mirror of the site with:
 *   - every page's <script type="module"> bundled+split into /assets/build/<name>-<hash>.js
 *   - every referenced .css renamed to <name>-<hash>.css (in place, same dir → url() still resolves)
 *   - every <link>/entry <script> in the HTML rewritten to the hashed URL
 *
 * Run:  node scripts/build-v1.cjs   (from repo root)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
// The repo root is the DOMAIN root (golan.me.uk/): it holds only the hub page
// and CNAME. The app itself lives one folder down and is served from
// golan.me.uk/shabi-israel/, so every future project is a sibling folder here.
// Everything below builds SITE → DIST/shabi-israel; only the hub and CNAME land
// at DIST's own root.
const SITE_DIR = 'shabi-israel';
const SITE = path.join(ROOT, SITE_DIR);
const DIST = path.join(ROOT, 'dist');
const SITE_DIST = path.join(DIST, SITE_DIR);
const BUILD_SUBDIR = path.join('assets', 'build'); // under dist/shabi-israel/

// esbuild: prefer a normally-installed copy (CI runs `npm install` at the repo
// root, where it's a devDependency); fall back to v2/node_modules for local dev
// so you don't need a second install just to build v1.
let esbuild;
try { esbuild = require('esbuild'); }
catch { esbuild = require(path.join(ROOT, 'v2', 'node_modules', 'esbuild')); }

// ---- config -------------------------------------------------------------
// Directories copied verbatim into dist (js/ is intentionally excluded — it is
// superseded by the hashed bundles; vendor/ holds classic non-module libs that
// are already version-named).
const COPY_DIRS = ['assets', 'css', 'leagues', 'table-lab', 'vendor'];
// Domain-root files: the hub page, the custom-domain marker, and the old-URL
// redirect, copied to dist/ itself rather than into the project folder.
const COPY_DOMAIN_FILES = ['CNAME', 'index.html', '404.html'];
// Domain-root project folders — served from golan.me.uk/<dir>/, NOT from inside
// shabi-israel/. WC26 predates the multi-project layout and keeps its original
// URL; it borrows the app's CSS via ../shabi-israel/css/.
const COPY_DOMAIN_DIRS = ['WC26'];
const MINIFY = false; // keep readable for first-pass verification; flip to true for prod

// HTML pages to process: the app's own pages plus any domain-root project page.
function discoverHtml() {
  const siteHtml = fs.readdirSync(SITE).filter(f => f.endsWith('.html'));
  const extra = ['WC26/wc26.html'].filter(p => fs.existsSync(path.join(ROOT, p)));
  return [...siteHtml, ...extra];
}

// A page path is resolved against the domain root when it belongs to a
// domain-root project (WC26/…), and against the app folder otherwise. One pair
// of helpers keeps every stage of the build agreeing on where a page lives.
const isDomainRoot = rel => COPY_DOMAIN_DIRS.some(d => toPosix(rel).startsWith(d + '/'));
const srcOf  = rel => path.join(isDomainRoot(rel) ? ROOT : SITE, rel);
const distOf = rel => path.join(isDomainRoot(rel) ? DIST : SITE_DIST, rel);

// ---- helpers ------------------------------------------------------------
const sha8 = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const toPosix = p => p.split(path.sep).join('/');

// Match <script ...>...</script> blocks; we then inspect attrs for type=module + src.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const isModule = attrs => /\btype\s*=\s*["']module["']/i.test(attrs);
const getAttr = (attrs, name) => {
  const m = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
};
const isLocal = url => url && !/^(https?:)?\/\//i.test(url) && !url.startsWith('data:');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// ---- step 1: clean + copy static tree ----------------------------------
function copyStatic() {
  rmrf(DIST);
  fs.mkdirSync(SITE_DIST, { recursive: true });
  for (const d of COPY_DIRS) {
    const src = path.join(SITE, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(SITE_DIST, d), { recursive: true });
  }
  for (const f of COPY_DOMAIN_FILES) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(DIST, f));
  }
  for (const d of COPY_DOMAIN_DIRS) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(DIST, d), { recursive: true });
  }
  for (const f of discoverHtml()) {
    fs.mkdirSync(path.dirname(distOf(f)), { recursive: true });
    fs.cpSync(srcOf(f), distOf(f));
  }
  // Belt-and-suspenders: never let GitHub Pages run Jekyll over the output.
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  // Drop now-dead module sources copied inside WC26/ (bundled into /assets/build).
  for (const f of ['wc26.js', 'wc26-data.js']) {
    const p = path.join(DIST, 'WC26', f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

// ---- step 2: collect JS entries + write temp inline-entry files ---------
// Returns { entries:[{in,out}], htmlMap:{ [htmlRel]: {inlineOut?, analytics?} }, tempFiles:[] }
function collectEntries(htmlFiles) {
  const entries = [];
  const seenExternal = new Set();
  const htmlMap = {};
  const tempFiles = [];

  for (const rel of htmlFiles) {
    const abs = srcOf(rel);
    const dir = path.dirname(abs);
    const base = path.basename(rel).replace(/\.html$/, '');
    const text = fs.readFileSync(abs, 'utf8');
    htmlMap[rel] = {};

    let m;
    SCRIPT_RE.lastIndex = 0;
    while ((m = SCRIPT_RE.exec(text))) {
      const attrs = m[1], body = m[2];
      if (!isModule(attrs)) continue;
      const src = getAttr(attrs, 'src');
      if (src && isLocal(src)) {
        // external module entry (e.g. js/analytics.js) — dedupe across pages
        const outName = path.basename(src).replace(/\.js$/, '');
        if (!seenExternal.has(src)) {
          seenExternal.add(src);
          entries.push({ in: path.join(SITE, src), out: outName });
        }
        htmlMap[rel].externalSrc = src;
        htmlMap[rel].externalOut = outName;
      } else if (!src && body.trim()) {
        // inline module entry — extract to a temp file NEXT TO the html so its
        // relative imports (./js/…, ../js/…, ./wc26.js) resolve unchanged.
        const outName = base + '.page';
        const tmp = path.join(dir, `._build_entry_${base}.js`);
        fs.writeFileSync(tmp, body);
        tempFiles.push(tmp);
        entries.push({ in: tmp, out: outName });
        htmlMap[rel].inlineOut = outName;
      }
    }
  }
  return { entries, htmlMap, tempFiles };
}

// ---- step 3: esbuild bundle+split+hash ----------------------------------
async function bundle(entries) {
  const outdir = path.join(SITE_DIST, BUILD_SUBDIR);
  fs.mkdirSync(outdir, { recursive: true });
  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: MINIFY,
    sourcemap: false,
    outdir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: 'asset-[hash]',
    logLevel: 'warning',
  });
  // Map each entry `out` → its hashed output basename by scanning the outdir.
  const files = fs.readdirSync(outdir);
  const outMap = {};
  for (const { out } of entries) {
    const re = new RegExp('^' + out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-[A-Za-z0-9]+\\.js$');
    const hit = files.find(f => re.test(f));
    if (!hit) throw new Error(`No hashed output found for entry "${out}"`);
    outMap[out] = hit;
  }
  return outMap;
}

// ---- step 4: content-hash every CSS file in dist ------------------------
// CSS has its own dependency graph: table-lab format files do
//   @import url("../base/base.css")
// so we must hash in dependency order (leaves first) and rewrite each
// importer's @import to the hashed name BEFORE hashing the importer — the exact
// analog of the JS import-graph problem. Returns map: original-abs-path → hashed basename.
const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')]+\.css)["']?\s*\)?\s*;/gi;

function hashCss() {
  // 1. collect every css file under the relevant dirs
  const files = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.css')) files.push(p);
    }
  };
  for (const d of ['css', 'table-lab', 'assets']) {
    const dir = path.join(SITE_DIST, d);
    if (fs.existsSync(dir)) walk(dir);
  }
  // Domain-root projects keep their own CSS beside them, outside the app folder.
  for (const d of COPY_DOMAIN_DIRS) {
    const dir = path.join(DIST, d);
    if (fs.existsSync(dir)) walk(dir);
  }

  // 2. dependency edges via @import (resolved to absolute original paths)
  const deps = new Map(); // absPath → [absDepPath...]
  for (const p of files) {
    const text = fs.readFileSync(p, 'utf8');
    const list = [];
    let m; IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text))) {
      if (/^(https?:)?\/\//i.test(m[1])) continue; // remote @import — leave
      list.push(path.resolve(path.dirname(p), m[1]));
    }
    deps.set(p, list);
  }

  // 3. process depth-first (deps before dependents), rewriting @import then hashing
  const map = {};          // origAbs → hashed basename
  const processing = new Set();
  const process = p => {
    if (map[p]) return;
    if (processing.has(p)) return; // cycle guard (none expected)
    processing.add(p);
    for (const d of deps.get(p) || []) if (map[d] === undefined && deps.has(d)) process(d);
    processing.delete(p);

    let text = fs.readFileSync(p, 'utf8');
    text = text.replace(IMPORT_RE, (full, imp) => {
      if (/^(https?:)?\/\//i.test(imp)) return full;
      const absDep = path.resolve(path.dirname(p), imp);
      const hashedBase = map[absDep];
      if (!hashedBase) return full;
      return full.replace(/[^/"')]+\.css/, hashedBase);
    });
    const hashed = path.basename(p).replace(/\.css$/, `-${sha8(text)}.css`);
    fs.writeFileSync(p, text);
    fs.renameSync(p, path.join(path.dirname(p), hashed));
    map[p] = hashed;
  };
  for (const p of files) process(p);
  return map;
}

// ---- step 5: rewrite HTML in dist --------------------------------------
function rewriteHtml(htmlFiles, htmlMap, jsOutMap, cssMap) {
  for (const rel of htmlFiles) {
    const abs = distOf(rel);
    let text = fs.readFileSync(abs, 'utf8');
    const info = htmlMap[rel];

    // 5a. module scripts
    text = text.replace(SCRIPT_RE, (full, attrs, body) => {
      if (!isModule(attrs)) return full;
      const src = getAttr(attrs, 'src');
      // RELATIVE to the page, never `/assets/build/…`. A root-absolute src
      // resolves against the DOMAIN root, so it 404s the moment the site is
      // served from a subfolder — which is exactly where it lives now
      // (golan.me.uk/shabi-israel/). See CLAUDE.md § Hosting layout.
      const buildHref = out =>
        toPosix(path.relative(path.dirname(abs), path.join(SITE_DIST, BUILD_SUBDIR, out)));
      if (src && isLocal(src) && info.externalOut) {
        return `<script type="module" src="${buildHref(jsOutMap[info.externalOut])}"></script>`;
      }
      if (!src && body.trim() && info.inlineOut) {
        return `<script type="module" src="${buildHref(jsOutMap[info.inlineOut])}"></script>`;
      }
      return full;
    });

    // 5b. CSS <link> hrefs (strip any old ?v=, swap basename to hashed)
    text = text.replace(/<link\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi, (full, pre, href, post) => {
      const clean = href.split('?')[0];
      if (!isLocal(clean) || !clean.endsWith('.css')) return full;
      const absOrig = path.resolve(path.dirname(abs), clean);
      const hashedBase = cssMap[absOrig];
      if (!hashedBase) return full; // not one of ours (or already-missing) — leave
      const newHref = clean.replace(/[^/]+\.css$/, hashedBase);
      return `<link${pre}href="${newHref}"${post}>`;
    });

    fs.writeFileSync(abs, text);
  }
}

// ---- main ---------------------------------------------------------------
(async () => {
  const htmlFiles = discoverHtml();
  console.log(`build-v1: ${htmlFiles.length} pages`);
  copyStatic();
  const { entries, htmlMap, tempFiles } = collectEntries(htmlFiles);
  try {
    const jsOutMap = await bundle(entries);
    const cssMap = hashCss();
    rewriteHtml(htmlFiles, htmlMap, jsOutMap, cssMap);
    console.log(`build-v1: bundled ${entries.length} entries, hashed ${Object.keys(cssMap).length} css files → dist/`);
  } finally {
    for (const t of tempFiles) { try { fs.rmSync(t); } catch {} }
  }
})().catch(err => { console.error(err); process.exit(1); });
