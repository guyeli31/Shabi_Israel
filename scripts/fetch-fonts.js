#!/usr/bin/env node
/**
 * fetch-fonts.js — download every webfont the project uses and generate
 * css/fonts.css, so no page ever requests a font from a third party.
 *
 * Why: a `<link>` to fonts.googleapis.com is a render-blocking request to
 * someone else's server that also hands them every visitor's IP address and
 * user-agent. Measured on this project, it cost ~324ms of blank screen on a
 * cold load. Self-hosting removes the request entirely.
 *
 * Run:  node scripts/fetch-fonts.js
 *
 * It asks Google's CSS2 endpoint with a modern browser User-Agent (an old or
 * missing UA makes it serve .ttf instead of .woff2), keeps only the subsets
 * we actually need, downloads each .woff2 into assets/fonts/, and rewrites
 * css/fonts.css with local paths. Google's own `unicode-range` values are
 * preserved, so a subset only downloads when a glyph needs it.
 *
 * Re-run after changing SPECS (e.g. the banner editor gains a font). Commit
 * both the .woff2 files and the regenerated CSS.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* Every family any page or tool asks for, as a Google CSS2 `family=` spec.
   Keep this the UNION of:
     · js/render/heroBanner.js  → GOOGLE_FONT_SPECS (banner element fonts)
     · banner-poc.html          → the editor's font picker
     · design-lab.html / design-catalogue.html / logo-editor.html
   Adding a family here and re-running is the ONLY way a new font should
   enter the project. Never add a fonts.googleapis.com <link> to a page. */
const SPECS = [
    'Montserrat:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,600',
    'Poppins:ital,wght@0,400;0,600;0,800;1,400',
    'Oswald:wght@400;600;700',
    'Anton',
    'Bebas+Neue',
    'Rubik:ital,wght@0,400;0,600;0,800;1,400',
    'Heebo:wght@400;600;800',
    'Assistant:wght@400;600;800',
    'Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,500;1,600;1,800',
    'Cinzel:wght@600;700',
    'Roboto+Condensed:wght@700'
];

/* Google serves cyrillic/greek/vietnamese subsets too. The site is English +
   Hebrew, so anything else is dead weight we would be committing to the repo.
   `hebrew` matters for Heebo/Assistant/Rubik. */
const KEEP_SUBSETS = new Set(['latin', 'latin-ext', 'hebrew']);

const OUT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const OUT_CSS = path.join(__dirname, '..', 'css', 'fonts.css');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(url, binary = false) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** Parse Google's CSS into face records, carrying the `/* subset *\/` comment
 *  that precedes each @font-face block. */
function parseFaces(css) {
    const faces = [];
    // Each block is preceded by a comment naming its subset.
    const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/gi;
    let m;
    while ((m = re.exec(css))) {
        const subset = m[1];
        const body = m[2];
        const field = (name) => {
            const f = new RegExp(name + '\\s*:\\s*([^;]+);', 'i').exec(body);
            return f ? f[1].trim() : null;
        };
        const srcMatch = /url\(([^)]+)\)\s*format\(['"]woff2['"]\)/i.exec(body);
        if (!srcMatch) continue;
        faces.push({
            subset,
            family: (field('font-family') || '').replace(/^['"]|['"]$/g, ''),
            style:  field('font-style')  || 'normal',
            weight: field('font-weight') || '400',
            range:  field('unicode-range'),
            url:    srcMatch[1].replace(/^['"]|['"]$/g, '')
        });
    }
    return faces;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const all = [];
    for (const spec of SPECS) {
        const url = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
        process.stdout.write(`· ${spec.split(':')[0].replace(/\+/g, ' ')} … `);
        const faces = parseFaces(await get(url));
        const kept = faces.filter(f => KEEP_SUBSETS.has(f.subset));
        console.log(`${faces.length} faces, keeping ${kept.length}`);
        all.push(...kept);
    }

    let bytes = 0;
    const blocks = [];
    for (const f of all) {
        const name = `${slug(f.family)}-${f.weight}-${f.style}-${f.subset}.woff2`;
        const dest = path.join(OUT_DIR, name);
        if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, await get(f.url, true));
        }
        bytes += fs.statSync(dest).size;
        blocks.push(
`/* ${f.family} ${f.weight} ${f.style} — ${f.subset} */
@font-face {
    font-family: '${f.family}';
    font-style: ${f.style};
    font-weight: ${f.weight};
    font-display: swap;
    src: url('../assets/fonts/${name}') format('woff2');${f.range ? `
    unicode-range: ${f.range};` : ''}
}`);
    }

    const header =
`/* fonts.css — SELF-HOSTED WEBFONTS. GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node scripts/fetch-fonts.js
 *
 * Every font the project uses is served from our own origin. No page may
 * reference fonts.googleapis.com or fonts.gstatic.com: those are
 * render-blocking third-party requests that also disclose each visitor's IP
 * address and user-agent to Google. Measured on this project, one such link
 * cost ~324ms of blank screen on a cold load.
 *
 * To add a font: add its family spec to SPECS in scripts/fetch-fonts.js and
 * re-run. Never add a <link> to a page.
 *
 * Subsets are limited to latin, latin-ext and hebrew. Google's own
 * unicode-range values are preserved, so a subset is only downloaded when a
 * glyph actually needs it. font-display: swap keeps text visible while a face
 * loads. All families here are SIL Open Font License or Apache 2.0, both of
 * which permit self-hosting.
 *
 * ${all.length} faces, ${(bytes / 1024).toFixed(0)} KB total.
 */

`;
    fs.writeFileSync(OUT_CSS, header + blocks.join('\n\n') + '\n');
    console.log(`\n✓ ${all.length} faces, ${(bytes / 1024).toFixed(0)} KB → assets/fonts/`);
    console.log(`✓ wrote ${path.relative(process.cwd(), OUT_CSS)}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
