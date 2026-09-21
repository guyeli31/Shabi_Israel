#!/usr/bin/env node
/**
 * build-promo-manifest.mjs — regenerates shabi-israel/assets/promo/manifest.json
 * from whatever image files are actually sitting in that folder.
 *
 * Why a manifest at all: promo-lab.html runs in a browser, and a browser
 * cannot list a directory. Guessing filenames one by one means a 404 (and a red
 * console line) for every guess that misses. One manifest is one fetch.
 *
 * Usage — after dropping images into shabi-israel/assets/promo/:
 *   node scripts/build-promo-manifest.mjs
 *
 * Nothing else reads this file. It exists only so an image saved to the repo
 * survives a page reload, unlike a drag-and-drop choice in the lab (which is an
 * in-memory blob URL and dies with the page).
 *
 * Resolves into ../shabi-israel/, not .. — the repo root is the DOMAIN root and
 * the app lives one folder down (see CLAUDE.md § Hosting layout).
 */

import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMO_DIR = join(HERE, '..', 'shabi-israel', 'assets', 'promo');
const MANIFEST = join(PROMO_DIR, 'manifest.json');

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

// The lab's OWN OUTPUT lives in this folder too: promo-lab.html writes the
// WhatsApp share images here on every save. They are products of the design,
// not candidate backgrounds for it, and listing them would offer the designer
// last save's picture as the artwork for the next one — a loop, and a confusing
// one, since the thumbnail would look almost right.
//
// Matched by name rather than moved to a subfolder so the campaign images stay
// where they are asked for, next to the artwork they are cut from.
const EXPORT_NAME = /^shabi-israel-ubc-promo-[a-z]{2}\.png$/i;

let entries;
try {
    entries = await readdir(PROMO_DIR, { withFileTypes: true });
} catch (err) {
    if (err.code === 'ENOENT') {
        console.error(`No such folder: ${PROMO_DIR}\nCreate it and drop the promo images in first.`);
        process.exit(1);
    }
    throw err;
}

const images = entries
    .filter((e) => e.isFile() && IMAGE_EXT.test(e.name) && !EXPORT_NAME.test(e.name))
    .map((e) => e.name)
    .sort();

await writeFile(MANIFEST, JSON.stringify(images, null, 2) + '\n', 'utf8');

console.log(`${MANIFEST}\n  ${images.length} image(s):`);
for (const name of images) console.log(`  · ${name}`);
if (!images.length) console.log('  (none — the lab falls back to its built-in CSS backgrounds)');
