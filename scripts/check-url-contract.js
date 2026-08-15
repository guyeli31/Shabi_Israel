#!/usr/bin/env node
/**
 * check-url-contract.js — fail if any URL slug diverges from its visible label.
 *
 * Standing project rule (CLAUDE.md § URL contract): a slug in the URL is ALWAYS
 * the visible label, lowercased, spaces → hyphens. No mapping tables, no
 * abbreviations, no exceptions. If a slug comes out too long, the LABEL gets
 * shortened — never the slug.
 *
 * This check exists because the drift is invisible in code review and only shows
 * up in the address bar. `{ id: 'insights', label: 'Charts' }` reads perfectly
 * well on its own line; it took a URL audit to notice that ?tab=insights opened
 * a tab called Charts, that ?tab=leaderboard opened Leaders, and that
 * #leagues/edit/<id>/rounds opened the Round Editor.
 *
 * Rules enforced:
 *   1. every mountAppTabs tab has  id === tabSlug(label)
 *   2. every `aliases:` key is a RETIRED slug (not a live id) and every value is
 *      a live id in the same call — a typo'd alias silently does nothing
 *   3. no slug⇄panel mapping object exists anywhere in js/ — the pair of lookup
 *      tables is exactly how the admin's slugs drifted, so the shape is banned
 *   4. the admin's VIEW_TITLES and NAV_ITEMS keys match their titles/labels
 *   5. every literal ?tab=<slug> in js/ and the HTML pages names a live tab id
 *      or a declared alias — this is what catches a hand-written nav href
 *
 * Run:  node scripts/check-url-contract.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabSlug } from '../shabi-israel/js/utils/queryString.js';

// The repo root is the domain root; the site lives one folder down (see
// CLAUDE.md § Hosting layout), so scan there rather than the whole repo.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shabi-israel');

/* Same exclusions as check-no-external.js, plus dist: the build output holds
   stale copies of every tab array and would report findings that `npm run build`
   fixes on its own. */
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'v2', 'vendor', '.playwright-mcp',
    'supabase-migration', 'docs', '_archive_v1', 'dist', 'table-lab'
]);

const EXTS = new Set(['.html', '.js']);

const findings = [];
/** Every live tab id + every declared alias, collected by rule 1/2 for rule 5. */
const knownTabSlugs = new Set();

/* ── file walking ─────────────────────────────────────────────────────── */

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files);
        } else if (EXTS.has(path.extname(entry.name))) {
            files.push(path.join(dir, entry.name));
        }
    }
    return files;
}

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

/**
 * Blank out comments so a doc-comment's usage example isn't checked as if it
 * were real code (appTabs.js's own header shows a sample tabs array). Every
 * character is replaced with a space and newlines are kept, so reported line
 * numbers still point at the real source.
 *
 * Only block comments and WHOLE-LINE `//` comments are stripped — a trailing
 * `//` would also match inside a string like 'https://…', and eating the rest
 * of that line could hide a real finding.
 */
function blankComments(src) {
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    return src
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^[ \t]*\/\/[^\n]*/gm, blank);
}
const lineOf = (src, index) => src.slice(0, index).split('\n').length;
const report = (file, src, index, rule, detail) =>
    findings.push({ file: rel(file), line: lineOf(src, index), rule, detail });

/**
 * The source text of a balanced (...) call starting at `openIndex` (the index of
 * the '('). Good enough for these call sites — none of them contain a paren
 * inside a string literal — and it keeps the checker dependency-free.
 */
function callBlock(src, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')' && --depth === 0) return src.slice(openIndex, i + 1);
    }
    return src.slice(openIndex);
}

/* ── rules 1 + 2: mountAppTabs tab sets and their aliases ─────────────── */

function checkAppTabs(file, src) {
    const call = /mountAppTabs\s*\(/g;
    let m;
    while ((m = call.exec(src))) {
        const at = m.index + m[0].length - 1;
        const block = callBlock(src, at);
        // Skip the primitive's own definition/doc-comment occurrences.
        if (!/\btabs\s*:/.test(block)) continue;

        const ids = new Set();
        const pair = /\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g;
        let t;
        while ((t = pair.exec(block))) {
            const [, id, label] = t;
            ids.add(id);
            knownTabSlugs.add(id);
            let want;
            try { want = tabSlug(label); }
            catch (err) { report(file, src, at + t.index, 'label', err.message); continue; }
            if (id !== want) {
                report(file, src, at + t.index, 'slug≠label',
                    `id '${id}' should be '${want}' (label "${label}") — or shorten the label`);
            }
        }

        const aliasBlock = /aliases:\s*\{([^}]*)\}/.exec(block);
        if (!aliasBlock) continue;
        const alias = /'?([A-Za-z0-9_-]+)'?\s*:\s*'([^']+)'/g;
        let a;
        while ((a = alias.exec(aliasBlock[1]))) {
            const [, from, to] = a;
            knownTabSlugs.add(from);
            if (ids.has(from)) {
                report(file, src, at + aliasBlock.index, 'alias',
                    `'${from}' is a live tab id — an alias must be a RETIRED slug`);
            }
            if (!ids.has(to)) {
                report(file, src, at + aliasBlock.index, 'alias',
                    `'${from}' → '${to}', but '${to}' is not a tab id in this call`);
            }
        }
    }
}

/* ── rule 3: no slug⇄panel mapping tables ─────────────────────────────── */

function checkNoSlugMaps(file, src) {
    const re = /const\s+(\w*(?:SLUG_TO|TO_SLUG|TO_PANEL|PANEL_TO)\w*)\s*=\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
        report(file, src, m.index, 'slug-map',
            `${m[1]} — derive the slug with tabSlug(label) instead of declaring both halves`);
    }
}

/* ── rule 4: the admin's own key/label tables ─────────────────────────── */

function checkAdminTables(file, src) {
    if (rel(file).endsWith('admin/render/adminPage.js')) {
        const block = /const\s+VIEW_TITLES\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
        if (block) {
            const entry = /'?([A-Za-z0-9_-]+)'?\s*:\s*'([^']+)'/g;
            let e;
            while ((e = entry.exec(block[1]))) checkPair(file, src, block.index, e[1], e[2], 'VIEW_TITLES');
        }
    }
    if (rel(file).endsWith('admin/render/adminSidebarNav.js')) {
        const entry = /\{\s*key:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g;
        let e;
        while ((e = entry.exec(src))) {
            // 'dashboard' links out to index.html — it names no admin hash.
            if (e[1] === 'dashboard') continue;
            checkPair(file, src, e.index, e[1], e[2], 'NAV_ITEMS');
        }
    }
}

function checkPair(file, src, index, key, label, where) {
    let want;
    try { want = tabSlug(label); }
    catch (err) { report(file, src, index, 'label', `${where}: ${err.message}`); return; }
    if (key !== want) {
        report(file, src, index, 'slug≠label',
            `${where}: key '${key}' should be '${want}' (label "${label}")`);
    }
}

/* ── rule 5: hand-written ?tab= links ─────────────────────────────────── */

function checkLiteralTabLinks(file, src) {
    const re = /[?&]tab=([A-Za-z0-9_-]+)/g;
    let m;
    while ((m = re.exec(src))) {
        if (knownTabSlugs.has(m[1])) continue;
        report(file, src, m.index, 'dead-link',
            `?tab=${m[1]} names no tab id or declared alias — it would silently open tab 1`);
    }
}

/* ── run ──────────────────────────────────────────────────────────────── */

const files = walk(ROOT).map(file => ({
    file,
    src: blankComments(fs.readFileSync(file, 'utf8')),
}));

// Two passes: rule 5 compares against the slug set that rules 1-2 build, so
// every tab definition in the tree must be seen before any link is judged.
for (const { file, src } of files) {
    checkAppTabs(file, src);
    checkNoSlugMaps(file, src);
    checkAdminTables(file, src);
}
for (const { file, src } of files) checkLiteralTabLinks(file, src);

if (findings.length === 0) {
    console.log(`✓ URL contract holds (${knownTabSlugs.size} slugs checked).`);
    process.exit(0);
}

console.error(`✗ ${findings.length} URL-contract violation(s).`);
console.error('  Project rule: a URL slug is ALWAYS the visible label, kebab-cased.');
console.error('  If the slug is too long, shorten the LABEL — never the slug.');
console.error('  Renaming a live slug? Add it to that call\'s `aliases` so shared links survive.\n');
for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.detail}`);
}
process.exit(1);
