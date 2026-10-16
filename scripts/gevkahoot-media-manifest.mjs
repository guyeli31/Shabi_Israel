#!/usr/bin/env node
/**
 * gevkahoot-media-manifest.mjs — list what is in gevkahoot/media/.
 *
 * GevKahoot's media are plain files in the repo, one folder per kind:
 *
 *     gevkahoot/media/images/        pictures shown with a question or interlude
 *     gevkahoot/media/videos/        clips
 *     gevkahoot/media/audio/         music and sound clips
 *     gevkahoot/media/backgrounds/   full-screen backdrops
 *     gevkahoot/media/sprites/       cut-out pictures for the bouncing animation
 *     gevkahoot/media/animations/    ready-made animated slides (e.g. the first-streak one)
 *
 * GitHub Pages serves files but will not list a folder, so the editor's
 * pickers cannot discover them. This script writes media/manifest.json — the
 * list — and the editor reads that. It also holds each file's VERSION (a hash
 * of its content), which the site puts in the file's address so that a file
 * REPLACED under the same name is never served from a browser's old cache.
 * Run it after adding, removing or replacing a file:
 *
 *     node scripts/gevkahoot-media-manifest.mjs
 *
 * `--check` writes nothing and exits 1 when the manifest is stale or a file
 * breaks a rule, so it can gate a commit. The rules:
 *   · a file must sit in the folder for its kind (an .mp4 in images/ is the
 *     picker offering a video as a picture);
 *   · a name may be anything — Hebrew and spaces included — except the
 *     characters that could make it more than a name (/ \ ? # % : * " < > |,
 *     a leading dot). The database's CHECK enforces the same pattern, so a
 *     file the picker offers can always be saved;
 *   · nothing over 95 MB: GitHub rejects a push containing a 100 MB file.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gevkahoot', 'media');
const OUT = path.join(MEDIA, 'manifest.json');

const KINDS = {
    images: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'],
    backgrounds: ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif'],
    videos: ['.mp4', '.webm', '.m4v'],
    audio: ['.mp3', '.m4a', '.ogg', '.wav', '.aac'],
    sprites: ['.png', '.webp', '.svg', '.gif', '.avif'],
    animations: ['.svg', '.webp', '.gif', '.webm', '.mp4'],
};
// Same rule as the database CHECK and js/ui/dom.js: any name a person would
// give a file, minus what could make it more than a name.
const NAME_RE = /^[^./\\?#%:*"<>|\u0000-\u001f][^/\\?#%:*"<>|\u0000-\u001f]*$/;
const MAX_BYTES = 95 * 1024 * 1024;

const manifest = {};
const problems = [];

for (const [folder, exts] of Object.entries(KINDS)) {
    const dir = path.join(MEDIA, folder);
    manifest[folder] = [];
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        const rel = `gevkahoot/media/${folder}/${entry.name}`;
        if (!NAME_RE.test(entry.name)) {
            problems.push(`${rel} — rename it: a name cannot contain / \\ ? # % : * " < > | or start with a dot`);
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

// The version of every file: a short hash of its CONTENT. The site adds it to
// the file's address (safeMedia in js/ui/dom.js), so a file replaced under the
// same name gets a new address and no browser keeps showing the old one from
// its cache. Same order as the lists above; the editor's tools write it alike
// (addToManifest in js/admin/spriteCutter.js).
manifest.versions = {};
for (const folder of Object.keys(KINDS)) {
    for (const name of manifest[folder]) {
        const bytes = fs.readFileSync(path.join(MEDIA, folder, name));
        manifest.versions[`${folder}/${name}`] = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 10);
    }
}

const next = JSON.stringify(manifest, null, 2) + '\n';
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const check = process.argv.includes('--check');

for (const p of problems) console.error(`✗ ${p}`);

if (check) {
    if (current !== next) console.error('✗ gevkahoot/media/manifest.json is stale — run: node scripts/gevkahoot-media-manifest.mjs');
    if (problems.length || current !== next) process.exit(1);
    console.log('gevkahoot media manifest: up to date');
} else {
    fs.writeFileSync(OUT, next);
    const total = Object.keys(KINDS).reduce((n, folder) => n + manifest[folder].length, 0);
    console.log(`gevkahoot media manifest: ${total} file(s) → gevkahoot/media/manifest.json`);
    if (problems.length) process.exit(1);
}
