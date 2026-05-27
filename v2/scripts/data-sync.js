#!/usr/bin/env node
/**
 * data-sync.js — copies the shared ../leagues directory into v2/public/data
 * so production builds ship with a data snapshot.
 *
 * During dev, Vite's `shared-data-proxy` plugin serves ../leagues directly
 * at /data — this script is only needed before `npm run build`.
 *
 * Usage:
 *   node scripts/data-sync.js          # copy ../leagues → public/data
 *   node scripts/data-sync.js --clean  # delete public/data first
 */

import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const leaguesDir = path.join(repoRoot, 'leagues');
const targetDir = path.resolve(__dirname, '..', 'public', 'data');

async function main() {
    if (!existsSync(leaguesDir)) {
        console.error(`[data-sync] Source not found: ${leaguesDir}`);
        process.exit(1);
    }

    if (process.argv.includes('--clean') && existsSync(targetDir)) {
        console.log(`[data-sync] Cleaning ${targetDir}`);
        await rm(targetDir, { recursive: true, force: true });
    }

    await mkdir(targetDir, { recursive: true });

    console.log(`[data-sync] Copying ${leaguesDir} → ${targetDir}`);
    await cp(leaguesDir, targetDir, { recursive: true });

    const stats = await stat(targetDir);
    console.log(`[data-sync] Done. Target dir ${stats.isDirectory() ? 'OK' : 'MISSING'}.`);
}

main().catch(err => {
    console.error('[data-sync] Failed:', err);
    process.exit(1);
});
