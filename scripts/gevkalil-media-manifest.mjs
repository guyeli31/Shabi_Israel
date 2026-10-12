#!/usr/bin/env node
/**
 * gevkalil-media-manifest.mjs — list what is in gevkalil/media/.
 *
 * Gevkalil's media are plain files in the repo, one folder per kind:
 *
 *     gevkalil/media/images/        pictures shown with a question or interlude
 *     gevkalil/media/videos/        clips
 *     gevkalil/media/audio/         music and sound clips
 *     gevkalil/media/backgrounds/   full-screen backdrops
 *
 * GitHub Pages serves files but will not list a folder, so the editor's
 * pickers cannot discover them. This script writes media/manifest.json — the
 * list — and the editor reads that. Run it after adding or removing a file:
 *
 *     node scripts/gevkalil-media-manifest.mjs
 *
 * `--check` writes nothing and exits 1 when the manifest is stale or a file
 * breaks a rule, so it can gate a commit. The rules:
 *   · a file must sit in the folder for its kind (an .mp4 in images/ is the
 *     picker offering a video as a picture);
 *   · a name may use only A-Z a-z 0-9 . _ - — the same pattern the database's
 *     CHECK constraint enforces, so a file the picker offers can always be
 *     saved;
 *   · nothing over 95 MB: GitHub rejects a push containing a 100 MB file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gevkalil', 'media');
const OUT = path.join(MEDIA, 'manifest.json');

const KINDS = {
    images: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'],
    backgrounds: ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif'],
    videos: ['.mp4', '.webm', '.m4v'],
    audio: ['.mp3', '.m4a', '.ogg', '.wav', '.aac'],
};
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_BYTES = 95 * 1024 * 1024;

const manifest = {};
const problems = [];

for (const [folder, exts] of Object.entries(KINDS)) {
    const dir = path.join(MEDIA, folder);
    manifest[folder] = [];
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        const rel = `gevkalil/media/${folder}/${entry.name}`;
        if (!NAME_RE.test(entry.name)) {
            problems.push(`${rel} — rename it: only A-Z a-z 0-9 . _ - are allowed (no spaces, no Hebrew)`);
            continue;
        }
        if (!exts.includes(path.extname(entry.name).toLowerCase())) {
            problems.push(`${rel} — not a ${folder} file (expected ${exts.join(' ')})`);
            continue;
        }
        if (fs.statSync(path.join(dir, entry.name)).size > MAX_BYTES) {
            problems.push(`${rel} — over 95 MB; GitHub will reject the push`);
            continue;
        }
        manifest[folder].push(entry.name);
    }
    manifest[folder].sort((a, b) => a.localeCompare(b, 'en'));
}

const next = JSON.stringify(manifest, null, 2) + '\n';
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const check = process.argv.includes('--check');

for (const p of problems) console.error(`✗ ${p}`);

if (check) {
    if (current !== next) console.error('✗ gevkalil/media/manifest.json is stale — run: node scripts/gevkalil-media-manifest.mjs');
    if (problems.length || current !== next) process.exit(1);
    console.log('gevkalil media manifest: up to date');
} else {
    fs.writeFileSync(OUT, next);
    const total = Object.values(manifest).reduce((n, list) => n + list.length, 0);
    console.log(`gevkalil media manifest: ${total} file(s) → gevkalil/media/manifest.json`);
    if (problems.length) process.exit(1);
}
