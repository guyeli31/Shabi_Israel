/**
 * check-query-standards.mjs — enforces docs/data-architecture/02-query-standards.md
 * rule 1: only an allowlisted set of files may call supabase.from()/rpc()
 * directly or import js/data/supabaseLoader.js. Everything else must go
 * through js/data/store.js.
 *
 * Run in CI and as a pre-commit check (wiring TBD — this script is the gate
 * itself; hooking it into CI/pre-commit is a separate, later step).
 *
 * Usage: node scripts/check-query-standards.mjs
 * Exit code 0 = clean, 1 = violation(s) found (printed with file:line).
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo root is the domain root; the site lives one folder down
// (see CLAUDE.md § Hosting layout).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'shabi-israel');
const JS_ROOT = join(REPO_ROOT, 'js');

// Files allowed to call supabase.from()/rpc() directly (rule 1).
const ALLOWED_DIRECT_CALL_FILES = new Set([
    'js/data/store.js',
    'js/data/supabaseLoader.js',
    'js/data/supabasePlayersMetadata.js', // admin-only, parallel to supabaseLoader.js for player metadata
    'js/analytics.js',
    'js/render/analyticsPage.js', // analytics dashboard's own dedicated RPC — out of scope for this redesign
]);
function isAllowedDirectCall(relPath) {
    return ALLOWED_DIRECT_CALL_FILES.has(relPath.replace(/\\/g, '/')) || relPath.replace(/\\/g, '/').startsWith('js/admin/');
}

// Files allowed to import js/data/supabaseLoader.js (rule 1 + rule 9).
function isAllowedSupabaseLoaderImporter(relPath) {
    const p = relPath.replace(/\\/g, '/');
    return p.startsWith('js/admin/') || p === 'js/data/supabaseLoader.js';
}

const DIRECT_CALL_PATTERN = /\bsupabase\s*\.\s*(from|rpc)\s*\(/;
const SUPABASE_LOADER_IMPORT_PATTERN = /from\s+['"][^'"]*\/supabaseLoader\.js['"]/;

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            files.push(...(await walk(full)));
        } else if (entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}

async function main() {
    const files = await walk(JS_ROOT);
    const violations = [];

    for (const file of files) {
        const relPath = relative(REPO_ROOT, file);
        const text = await readFile(file, 'utf8');
        const lines = text.split(/\r?\n/);

        lines.forEach((line, i) => {
            if (DIRECT_CALL_PATTERN.test(line) && !isAllowedDirectCall(relPath)) {
                violations.push({
                    file: relPath, line: i + 1, text: line.trim(),
                    rule: 'rule 1: supabase.from()/rpc() outside the allowed files',
                });
            }
            if (SUPABASE_LOADER_IMPORT_PATTERN.test(line) && !isAllowedSupabaseLoaderImporter(relPath)) {
                violations.push({
                    file: relPath, line: i + 1, text: line.trim(),
                    rule: 'rule 1/9: importing supabaseLoader.js outside js/admin/**',
                });
            }
        });
    }

    if (violations.length === 0) {
        console.log(`OK — scanned ${files.length} files under js/, no query-standards violations.`);
        process.exit(0);
    }

    console.error(`Found ${violations.length} query-standards violation(s):\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  [${v.rule}]\n    ${v.text}\n`);
    }
    process.exit(1);
}

main().catch((err) => {
    console.error('check-query-standards.mjs crashed:', err);
    process.exit(1);
});
