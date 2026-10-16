/**
 * gevkahoot-gnomes.mjs — draws the gnomes of the built-in "גמדים" animation.
 *
 *   node scripts/gevkahoot-gnomes.mjs          writes gevkahoot/assets/gnomes/<colour>.svg
 *   node scripts/gevkahoot-gnomes.mjs --check  exits 1 if a committed file differs
 *
 * Six garden gnomes, one per colour: a pointed hat, a white beard, a round
 * nose, a tunic and a belt — drawn here from scratch as vector shapes with
 * their own gradients, no downloaded artwork. They are a BUILT-IN animation
 * (anim_sprite = 'builtin:gnomes'), not media: js/host/bouncers.js sends one
 * of each colour around the stage, each also spinning on itself.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'gevkahoot', 'assets', 'gnomes');

const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
const lin = (id, [x1, y1, x2, y2], list) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
const rad = (id, [cx, cy, r], list) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
const INK = '#2a1a12';

/** A gnome: `hat` [light, base, dark], `tunic` [light, base, dark]. */
function gnome({ hat, tunic }) {
    // The beard is a cloud of puffs: outlined as one shape by drawing every
    // puff once fat and dark, then once in white on top.
    const puffs = [[60, 86, 20], [44, 92, 15], [76, 92, 15], [48, 108, 14], [72, 108, 14], [60, 112, 16], [60, 124, 11]];
    return '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="170" viewBox="0 0 120 170">'
        + '<defs>'
        + lin('hat', [0, 0, 1, 0], [[0, hat[0]], [0.45, hat[1]], [1, hat[2]]])
        + lin('tunic', [0, 0, 1, 0], [[0, tunic[0]], [0.5, tunic[1]], [1, tunic[2]]])
        + rad('skin', [0.4, 0.35, 0.7], [[0, '#ffe2c8'], [1, '#f2b38c']])
        + rad('nose', [0.35, 0.3, 0.7], [[0, '#ffb3a6'], [1, '#e2665a']])
        + rad('beard', [0.4, 0.3, 0.8], [[0, '#ffffff'], [1, '#d9dce3']])
        + lin('boot', [0, 0, 0, 1], [[0, '#6b4224'], [1, '#3a210f']])
        + '</defs>'
        // boots
        + `<ellipse cx="44" cy="158" rx="15" ry="8" fill="url(#boot)" stroke="${INK}" stroke-width="2"/>`
        + `<ellipse cx="76" cy="158" rx="15" ry="8" fill="url(#boot)" stroke="${INK}" stroke-width="2"/>`
        // tunic, belt and buckle
        + `<path d="M34,92 Q60,84 86,92 L98,150 Q60,160 22,150 Z" fill="url(#tunic)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<path d="M27,126 Q60,134 93,126 L94,136 Q60,144 26,136 Z" fill="#2b2b33" stroke="${INK}" stroke-width="1.6"/>`
        + `<rect x="53" y="127" width="14" height="12" rx="2" fill="#f2c94c" stroke="#8a6312" stroke-width="2"/>`
        + '<rect x="57.5" y="130.5" width="5" height="5" fill="#2b2b33"/>'
        // arms and hands
        + `<path d="M34,96 Q20,108 22,124" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`
        + '<path d="M34,96 Q20,108 22,124" fill="none" stroke="url(#tunic)" stroke-width="8" stroke-linecap="round"/>'
        + `<path d="M86,96 Q100,108 98,124" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`
        + '<path d="M86,96 Q100,108 98,124" fill="none" stroke="url(#tunic)" stroke-width="8" stroke-linecap="round"/>'
        + `<circle cx="22" cy="127" r="7" fill="url(#skin)" stroke="${INK}" stroke-width="1.8"/>`
        + `<circle cx="98" cy="127" r="7" fill="url(#skin)" stroke="${INK}" stroke-width="1.8"/>`
        // face
        + `<ellipse cx="60" cy="70" rx="22" ry="17" fill="url(#skin)" stroke="${INK}" stroke-width="2"/>`
        // beard (outline, then fill)
        + puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 2.2}" fill="${INK}"/>`).join('')
        + puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#beard)"/>`).join('')
        + '<path d="M50,96 q4,6 0,12 M70,96 q-4,6 0,12 M60,104 q3,7 0,14" fill="none" stroke="#c4c8d0" stroke-width="1.6" stroke-linecap="round"/>'
        // moustache, cheeks, eyes, nose
        + `<path d="M38,84 Q48,74 60,82 Q72,74 82,84 Q72,92 60,86 Q48,92 38,84 Z" fill="url(#beard)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`
        + '<circle cx="44" cy="72" r="5" fill="#ff8a7a" fill-opacity=".55"/><circle cx="76" cy="72" r="5" fill="#ff8a7a" fill-opacity=".55"/>'
        + `<circle cx="51" cy="65" r="3.4" fill="${INK}"/><circle cx="69" cy="65" r="3.4" fill="${INK}"/>`
        + '<circle cx="52.2" cy="63.8" r="1.2" fill="#fff"/><circle cx="70.2" cy="63.8" r="1.2" fill="#fff"/>'
        + `<circle cx="60" cy="74" r="8.5" fill="url(#nose)" stroke="${INK}" stroke-width="1.8"/>`
        + '<ellipse cx="57" cy="71" rx="2.6" ry="1.8" fill="#fff" fill-opacity=".7"/>'
        // the hat: a leaning cone, a brim fold and a shine
        + `<path d="M30,62 Q34,34 52,14 Q60,4 74,2 Q66,10 66,22 Q72,42 90,62 Q60,70 30,62 Z" fill="url(#hat)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<path d="M28,62 Q60,72 92,62 L92,66 Q60,78 28,66 Z" fill="${hat[2]}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
        + '<path d="M42,52 Q46,32 58,18" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3.2" stroke-linecap="round"/>'
        + '</svg>\n';
}

/** Hat and tunic per colour — the tunic always a contrast to its hat. */
const GNOMES = {
    red: { hat: ['#ff6a6a', '#e2162f', '#9e0d1e'], tunic: ['#5d8cff', '#1c4fd6', '#12348f'] },
    blue: { hat: ['#6f9bff', '#1c4fd6', '#12348f'], tunic: ['#ffe066', '#ffc61a', '#c79100'] },
    yellow: { hat: ['#ffe680', '#ffc61a', '#c79100'], tunic: ['#ff7b8c', '#e2162f', '#9e0d1e'] },
    green: { hat: ['#5fd88a', '#19a34a', '#0f6b30'], tunic: ['#b07be6', '#7a2bc4', '#4f1a82'] },
    purple: { hat: ['#b07be6', '#7a2bc4', '#4f1a82'], tunic: ['#ffa85c', '#ff7a1a', '#c4540a'] },
    orange: { hat: ['#ffa85c', '#ff7a1a', '#c4540a'], tunic: ['#5fd88a', '#19a34a', '#0f6b30'] },
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [key, spec] of Object.entries(GNOMES)) {
    const path = join(OUT, `${key}.svg`);
    const text = gnome(spec);
    if (check) {
        let old = null;
        try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
        if (old !== text) { console.error(`stale: gevkahoot/assets/gnomes/${key}.svg`); stale++; }
        continue;
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote gevkahoot/assets/gnomes/${key}.svg (${text.length} bytes)`);
}
if (check) {
    if (stale) { console.error(`${stale} file(s) differ — run node scripts/gevkahoot-gnomes.mjs`); process.exit(1); }
    console.log('gnomes up to date');
}
