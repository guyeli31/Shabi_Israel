/**
 * gevkahoot-marks.mjs — draws the tile emblems of the two extra mark sets.
 *
 *   node scripts/gevkahoot-marks.mjs          writes gevkahoot/assets/{catan,circuit,cards}/<colour>.svg
 *   node scripts/gevkahoot-marks.mjs --check  exits 1 if a committed file differs
 *
 * The emblems are drawn here from scratch — no downloaded artwork — as plain
 * vector shapes with their own gradients. The lift off the tile (rim, contact,
 * ambient shadow) is NOT in the files: it is the same `.gk-crest img` filter
 * the team crests get, so every set sits on its tile the same way.
 *
 * A file is named by the TILE colour it stands on (tile N is option N), like
 * assets/teams/. Which picture goes on which colour is chosen for contrast:
 * the blue capacitor is on the yellow tile, the dark diode on purple, never a
 * picture on a tile of its own colour.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'gevkahoot', 'assets');
const f = (n) => +n.toFixed(2);

const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');
const lin = (id, [x1, y1, x2, y2], list, user = false) =>
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops(list)}</linearGradient>`;
const rad = (id, [cx, cy, r], list, user = false) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops(list)}</radialGradient>`;

/* ======================================================================
   Catan — a pointy-topped terrain hex, with the resource's own picture
   (the one on its resource card) in the middle.
   ====================================================================== */

const HW = 180, HH = 206, CX = 90, CY = 103;
const hex = (r, cx = CX, cy = CY) => [...Array(6)].map((_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
}).join(' ');

/** A tile: sand rim, bevelled terrain, a texture clipped to it, the picture. */
function catanTile({ land, texture, icon, scale }) {
    icon = { ...icon, scale };
    const [light, base, dark] = land;
    return svg(HW, HH,
        '<defs>'
        + lin('rim', [0, 0, 0, 1], [[0, '#fbedc6'], [0.45, '#e2c588'], [1, '#a37b41']])
        + rad('land', [0.38, 0.3, 0.8], [[0, light], [0.55, base], [1, dark]])
        + lin('bevel', [0, 0, 1, 1], [[0, '#fff', 0.85], [0.5, '#fff', 0], [1, '#000', 0.55]])
        + rad('vignette', [0.5, 0.45, 0.62], [[0.6, '#000', 0], [1, '#000', 0.3]])
        + `<clipPath id="in"><polygon points="${hex(86)}"/></clipPath>`
        + '<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.4" flood-color="#000" flood-opacity=".6"/></filter>'
        + icon.defs
        + '</defs>'
        + `<polygon points="${hex(100)}" fill="url(#rim)" stroke="#5a4120" stroke-width="3" stroke-linejoin="round"/>`
        + `<polygon points="${hex(93)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"/>`
        + `<polygon points="${hex(86)}" fill="url(#land)" stroke="#4a3518" stroke-width="2.4" stroke-linejoin="round"/>`
        + `<g clip-path="url(#in)">${texture}<polygon points="${hex(86)}" fill="url(#vignette)"/></g>`
        + `<polygon points="${hex(83)}" fill="none" stroke="url(#bevel)" stroke-width="5" stroke-linejoin="round"/>`
        + `<g transform="translate(${CX} ${CY + 4}) scale(${icon.scale})" filter="url(#lift)">${icon.body}</g>`);
}

const mulberry = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- lumber: three logs, end on, in a pyramid; small pines behind ----------
function lumber() {
    const D = [-0.82, -0.57];              // the logs run back and to the left
    const len = 26;
    const log = (cx, cy, r) => {
        const bx = cx + D[0] * len, by = cy + D[1] * len;
        const nx = -D[1], ny = D[0];
        const body = `M${f(cx + nx * r)},${f(cy + ny * r)} L${f(bx + nx * r)},${f(by + ny * r)} A${r},${r} 0 0 1 ${f(bx - nx * r)},${f(by - ny * r)} L${f(cx - nx * r)},${f(cy - ny * r)} Z`;
        return `<path d="${body}" fill="url(#bark)" stroke="#2b1708" stroke-width="2.2" stroke-linejoin="round"/>`
            + `<path d="M${f(cx + nx * r * 0.45)},${f(cy + ny * r * 0.45)} L${f(bx + nx * r * 0.45)},${f(by + ny * r * 0.45)}" stroke="#2b1708" stroke-opacity=".45" stroke-width="1.4"/>`
            + `<path d="M${f(cx - nx * r * 0.2)},${f(cy - ny * r * 0.2)} L${f(bx - nx * r * 0.2)},${f(by - ny * r * 0.2)}" stroke="#2b1708" stroke-opacity=".35" stroke-width="1.2"/>`
            + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#grain)" stroke="#5a3412" stroke-width="3.4"/>`
            + `<circle cx="${cx}" cy="${cy}" r="${f(r - 1.7)}" fill="none" stroke="#2b1708" stroke-width="1.2"/>`
            + [0.72, 0.5, 0.28].map((k) => `<circle cx="${f(cx + 0.6)}" cy="${f(cy - 0.4)}" r="${f(r * k)}" fill="none" stroke="#b07b40" stroke-width="1.3"/>`).join('')
            + `<circle cx="${f(cx + 0.8)}" cy="${f(cy - 0.6)}" r="2" fill="#8a5a2a"/>`
            + `<path d="M${f(cx + 2)},${f(cy - 2)} l${f(r * 0.55)},${f(-r * 0.35)}" stroke="#8a5a2a" stroke-width="1.1"/>`;
    };
    const r = 19;
    return {
        defs: lin('bark', [0, 0, 1, 1], [[0, '#9a6a3a'], [0.5, '#6b4220'], [1, '#3d230e']])
            + rad('grain', [0.42, 0.38, 0.7], [[0, '#fbe3b4'], [0.7, '#e7bf84'], [1, '#c99555']]),
        body: `<g transform="translate(10 6)">${log(-20, 18, r)}${log(20, 18, r)}${log(0, -15, r)}</g>`,
    };
}
function forest() {
    const rnd = mulberry(7);
    let s = '';
    const pine = (x, y, h, c1, c2) => {
        const w = h * 0.55;
        s += `<rect x="${f(x - h * 0.05)}" y="${f(y)}" width="${f(h * 0.1)}" height="${f(h * 0.18)}" fill="#3b2410"/>`;
        for (let k = 0; k < 3; k++) {
            const top = y - h + k * h * 0.28, bw = w * (0.55 + k * 0.22);
            s += `<path d="M${f(x)},${f(top)} L${f(x + bw / 2)},${f(top + h * 0.45)} L${f(x - bw / 2)},${f(top + h * 0.45)} Z" fill="${k % 2 ? c1 : c2}" stroke="#0f3317" stroke-width=".8" stroke-linejoin="round"/>`;
        }
    };
    for (const [x, y, h] of [[34, 52, 34], [62, 40, 30], [118, 40, 30], [148, 54, 34], [24, 112, 30], [158, 116, 30], [44, 172, 28], [140, 174, 28], [90, 30, 26]]) {
        pine(x + (rnd() - 0.5) * 6, y, h, '#2f8a3e', '#256f31');
    }
    return s;
}

// ---- brick: a small 3-2-1 stack, in three-quarter view --------------------
function brick() {
    const W = 34, H = 15, G = 3, DX = 9, DY = -7;
    const rnd = mulberry(3);
    const one = (x, y) => {
        let s = `<path d="M${x},${y} l${DX},${DY} h${W} l${-DX},${-DY} Z" fill="url(#brTop)" stroke="#43160a" stroke-width="1.5" stroke-linejoin="round"/>`
            + `<path d="M${x + W},${y} l${DX},${DY} v${H} l${-DX},${-DY} Z" fill="url(#brSide)" stroke="#43160a" stroke-width="1.5" stroke-linejoin="round"/>`
            + `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="url(#brFront)" stroke="#43160a" stroke-width="1.5" stroke-linejoin="round"/>`
            + `<path d="M${x + 2},${y + 2.2} h${W - 4}" stroke="#f3a27a" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>`;
        for (let k = 0; k < 3; k++) s += `<circle cx="${f(x + 4 + rnd() * (W - 8))}" cy="${f(y + 5 + rnd() * (H - 8))}" r="${f(0.7 + rnd() * 0.7)}" fill="#5d1f0b" fill-opacity=".55"/>`;
        return s;
    };
    const rows = [
        { y: 22, n: 3 }, { y: 22 - H - G, n: 2 }, { y: 22 - 2 * (H + G), n: 1 },
    ];
    let s = '';
    for (const { y, n } of rows) {
        const total = n * W + (n - 1) * G;
        for (let i = 0; i < n; i++) s += one(f(-total / 2 + i * (W + G) - 4), y);
    }
    return {
        defs: lin('brFront', [0, 0, 0, 1], [[0, '#d0663a'], [0.6, '#b04c22'], [1, '#8a3615']])
            + lin('brTop', [0, 0, 0, 1], [[0, '#f0a079'], [1, '#d97a4e']])
            + lin('brSide', [0, 0, 1, 0], [[0, '#8a3414'], [1, '#6a250c']]),
        body: `<g transform="translate(0 -4) scale(1.12)">${s}</g>`,
    };
}
function hills() {
    let s = '';
    for (const [x, y, w, hgt, c] of [[20, 70, 70, 26, '#b9552c'], [120, 62, 80, 30, '#c25d32'], [10, 160, 90, 30, '#a94a24'], [110, 168, 90, 28, '#b5512a']]) {
        s += `<path d="M${x - w / 2},${y} Q${x},${y - hgt * 2} ${x + w / 2},${y} Z" fill="${c}"/>`;
        s += `<path d="M${x - w / 4},${y - hgt * 0.65} Q${x},${y - hgt * 1.05} ${x + w / 5},${y - hgt * 0.75}" stroke="#e79469" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    }
    return s;
}

// ---- wool: a sheep ---------------------------------------------------------
function wool() {
    const puffs = [[-26, -4, 15], [-12, -16, 16], [6, -18, 16], [22, -8, 14], [24, 8, 13], [8, 14, 16], [-10, 14, 16], [-26, 10, 14], [-2, -1, 18]];
    const legs = [[-22, 16], [-10, 20], [10, 20], [20, 16]].map(([x, y]) =>
        `<rect x="${x - 3.6}" y="${y}" width="7.2" height="22" rx="3.6" fill="url(#leg)" stroke="#111" stroke-width="1.4"/>`
        + `<rect x="${x - 4}" y="${y + 17}" width="8" height="5.5" rx="2" fill="#2b2b2b"/>`).join('');
    const outline = puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 2.2}" fill="#3a3a3a"/>`).join('');
    const fill = puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#fleece)"/>`).join('');
    const curls = [[-22, -6], [-8, -10], [8, -10], [20, 2], [-14, 8], [4, 8], [-26, 6]].map(([x, y]) =>
        `<path d="M${x - 4},${y + 1} q4,-6 8,0" stroke="#b9b9b2" stroke-width="1.4" fill="none" stroke-linecap="round"/>`).join('');
    const head = '<g transform="translate(36 -10) rotate(18)">'
        + '<ellipse cx="-3" cy="-11" rx="10" ry="4.5" transform="rotate(-30 -3 -11)" fill="#1c1c1c" stroke="#000" stroke-width="1"/>'
        + '<ellipse cx="0" cy="2" rx="12" ry="16" fill="url(#face)" stroke="#000" stroke-width="1.6"/>'
        + '<circle cx="-4" cy="-13" r="5.5" fill="#f3f2ec" stroke="#3a3a3a" stroke-width="1.2"/><circle cx="3" cy="-14" r="5" fill="#f3f2ec" stroke="#3a3a3a" stroke-width="1.2"/>'
        + '<circle cx="4.5" cy="-2" r="3" fill="#fff"/><circle cx="5.2" cy="-1.6" r="1.6" fill="#000"/>'
        + '<ellipse cx="2" cy="13" rx="3" ry="1.6" fill="#555"/>'
        + '</g>';
    return {
        defs: rad('fleece', [0.38, 0.32, 0.75], [[0, '#ffffff'], [0.6, '#f1f0ea'], [1, '#c9c8c0']])
            + rad('face', [0.4, 0.3, 0.8], [[0, '#4a4a4a'], [1, '#121212']])
            + lin('leg', [0, 0, 1, 0], [[0, '#4a4a4a'], [1, '#111']]),
        body: `<g transform="translate(-4 -2) scale(1.12)">${legs}${outline}${fill}${curls}${head}</g>`,
    };
}
function pasture() {
    const rnd = mulberry(11);
    let s = '';
    for (let k = 0; k < 46; k++) {
        const x = 8 + rnd() * 164, y = 18 + rnd() * 176;
        if (Math.hypot(x - CX, y - CY) < 50) continue;
        s += `<path d="M${f(x - 4)},${f(y)} l2,-7 M${f(x)},${f(y)} l0,-9 M${f(x + 4)},${f(y)} l-2,-7" stroke="${k % 3 ? '#5e9a28' : '#b6e070'}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
    s += '<circle cx="44" cy="58" r="3" fill="#fff"/><circle cx="44" cy="58" r="1.2" fill="#f2c400"/>'
        + '<circle cx="140" cy="150" r="3" fill="#fff"/><circle cx="140" cy="150" r="1.2" fill="#f2c400"/>'
        + '<circle cx="150" cy="64" r="2.6" fill="#fff"/><circle cx="34" cy="146" r="2.6" fill="#fff"/>';
    return s;
}

// ---- grain: a sheaf of wheat ----------------------------------------------
function grain() {
    let s = '';
    const pivot = [0, 22];
    const stalk = (deg, len) => {
        const a = (deg * Math.PI) / 180;
        const ux = Math.sin(a), uy = -Math.cos(a);
        const at = (t) => [pivot[0] + ux * t, pivot[1] + uy * t];
        const [ex, ey] = at(len - 34);
        let g = `<path d="M${pivot[0]},${pivot[1]} L${f(ex)},${f(ey)}" stroke="#8a5d0c" stroke-width="3.6" stroke-linecap="round"/>`
            + `<path d="M${pivot[0]},${pivot[1]} L${f(ex)},${f(ey)}" stroke="#e7b440" stroke-width="1.8" stroke-linecap="round"/>`;
        for (let k = 0; k < 6; k++) {
            const [kx, ky] = at(len - 32 + k * 5.6);
            for (const side of [-1, 1]) {
                const rot = deg + side * 24;
                g += `<ellipse cx="${f(kx + side * Math.cos(a) * 3.4)}" cy="${f(ky + side * Math.sin(a) * 3.4)}" rx="3.3" ry="6.4" transform="rotate(${f(rot)} ${f(kx + side * Math.cos(a) * 3.4)} ${f(ky + side * Math.sin(a) * 3.4)})" fill="url(#kernel)" stroke="#7a5208" stroke-width="1"/>`;
            }
        }
        const [tx, ty] = at(len + 2);
        g += `<ellipse cx="${f(tx)}" cy="${f(ty)}" rx="3" ry="6" transform="rotate(${deg} ${f(tx)} ${f(ty)})" fill="url(#kernel)" stroke="#7a5208" stroke-width="1"/>`;
        for (const side of [-1, 1]) {
            const b = a + side * 0.28;
            g += `<path d="M${f(tx)},${f(ty)} l${f(Math.sin(b) * 14)},${f(-Math.cos(b) * 14)}" stroke="#a7781a" stroke-width=".9" stroke-linecap="round"/>`;
        }
        return g;
    };
    for (const d of [-14, 14, 0]) {
        const a = ((180 + d * 0.9) * Math.PI) / 180;
        s += `<path d="M${pivot[0]},${pivot[1]} l${f(Math.sin(a) * 34)},${f(-Math.cos(a) * 34)}" stroke="#8a5d0c" stroke-width="3.6" stroke-linecap="round"/>`
            + `<path d="M${pivot[0]},${pivot[1]} l${f(Math.sin(a) * 34)},${f(-Math.cos(a) * 34)}" stroke="#e7b440" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    for (const [d, len] of [[-34, 66], [34, 66], [-17, 74], [17, 74], [0, 80]]) s += stalk(d, len);
    s += `<path d="M-11,16 Q0,21 11,16 L11,26 Q0,31 -11,26 Z" fill="url(#band)" stroke="#3d2408" stroke-width="1.4"/>`
        + '<path d="M-10,19 Q0,24 10,19" stroke="#e0b07a" stroke-width="1" fill="none"/>';
    return {
        defs: lin('kernel', [0, 0, 1, 1], [[0, '#fff2b0'], [0.4, '#f2c64a'], [1, '#c48a16']])
            + lin('band', [0, 0, 0, 1], [[0, '#a3652a'], [1, '#5d3612']]),
        body: `<g transform="translate(0 4) scale(1.02)">${s}</g>`,
    };
}
function fields() {
    let s = '';
    for (let k = -8; k < 14; k++) {
        const y = k * 16;
        s += `<path d="M-10,${y} L190,${y + 70}" stroke="${k % 2 ? '#c99a25' : '#f6d469'}" stroke-width="5" stroke-opacity=".38"/>`;
    }
    return s;
}

// ---- ore: a heap of faceted rocks with bright flecks ----------------------
function ore() {
    const rock = (pts, facets) => {
        const base = `<polygon points="${pts}" fill="url(#rockMid)" stroke="#23272d" stroke-width="2" stroke-linejoin="round"/>`;
        return base + facets.map(([p, c]) => `<polygon points="${p}" fill="${c}" stroke="#23272d" stroke-width=".9" stroke-linejoin="round" stroke-opacity=".7"/>`).join('');
    };
    const L = '#d7dde5', M = '#9aa5b2', D = '#5b6470', DD = '#3c434c';
    let s = '';
    s += rock('-6,-40 22,-30 34,-4 20,16 -16,14 -32,-10', [['-6,-40 22,-30 8,-12 -20,-18', L], ['22,-30 34,-4 20,16 8,-12', D], ['-20,-18 8,-12 20,16 -16,14 -32,-10', M]]);
    s += rock('-46,10 -28,-4 -8,6 -2,30 -38,34', [['-46,10 -28,-4 -18,10 -40,20', L], ['-18,10 -8,6 -2,30 -20,32', D], ['-40,20 -18,10 -20,32 -38,34', M]]);
    s += rock('6,14 30,4 50,18 44,36 10,36', [['6,14 30,4 26,20 10,24', L], ['30,4 50,18 44,36 26,20', DD], ['10,24 26,20 44,36 10,36', M]]);
    s += rock('-14,24 4,18 14,30 2,42 -16,40', [['-14,24 4,18 2,30 -12,32', L], ['4,18 14,30 2,42 2,30', D], ['-12,32 2,30 2,42 -16,40', M]]);
    const glint = (x, y, r) => `<path d="M${x},${y - r} L${x + r * 0.25},${y - r * 0.25} L${x + r},${y} L${x + r * 0.25},${y + r * 0.25} L${x},${y + r} L${x - r * 0.25},${y + r * 0.25} L${x - r},${y} L${x - r * 0.25},${y - r * 0.25} Z" fill="#fff"/>`;
    s += '<path d="M-4,-22 L6,-14 L14,-20 M-30,16 L-22,22" stroke="#7fd3ff" stroke-width="2" stroke-linecap="round" fill="none"/>';
    s += glint(-10, -28, 6) + glint(26, 22, 5) + glint(-34, 18, 4) + glint(14, -6, 3.5);
    return {
        defs: lin('rockMid', [0, 0, 1, 1], [[0, '#b7c0cb'], [1, '#5d6672']]),
        body: `<g transform="translate(0 0) scale(1.08)">${s}</g>`,
    };
}
function mountains() {
    let s = '';
    for (const [x, y, w, hgt] of [[30, 76, 70, 52], [92, 60, 80, 58], [154, 78, 70, 50], [26, 186, 70, 40], [156, 188, 70, 40]]) {
        s += `<path d="M${x - w / 2},${y} L${x},${y - hgt} L${x + w / 2},${y} Z" fill="#6f737b" stroke="#4b4f56" stroke-width="1.2" stroke-linejoin="round"/>`;
        s += `<path d="M${x},${y - hgt} L${x + w / 2},${y} L${x + w * 0.1},${y} Z" fill="#555960"/>`;
        s += `<path d="M${x},${y - hgt} L${x + w * 0.13},${y - hgt * 0.72} L${x + w * 0.04},${y - hgt * 0.78} L${x - w * 0.05},${y - hgt * 0.68} L${x - w * 0.13},${y - hgt * 0.74} Z" fill="#f4f6f8"/>`;
    }
    return s;
}

const CATAN = {
    red: { land: ['#e58a5c', '#c4623a', '#8a3a1d'], texture: hills(), icon: brick(), scale: 1.06 },
    blue: { land: ['#bfe57a', '#8cc63f', '#4f8a22'], texture: pasture(), icon: wool(), scale: 1.22 },
    yellow: { land: ['#fbe08a', '#e8b830', '#a87a12'], texture: fields(), icon: grain(), scale: 1.2 },
    black: { land: ['#c3c7ce', '#8e9299', '#565a61'], texture: mountains(), icon: ore(), scale: 1.3 },
    purple: { land: ['#5fb35e', '#2f7d3a', '#17491f'], texture: forest(), icon: lumber(), scale: 1.3 },
};

/* ======================================================================
   Circuit — five real components, drawn as the parts themselves.
   ====================================================================== */

const CW = 200, CH = 200;
const LEAD = lin('lead', [0, 0, 0, 1], [[0, '#f4f6f9'], [0.45, '#c3c8cf'], [1, '#7c838c']]);
/** Cylinder shading laid across any part: highlight a third of the way in. */
const SHADE = (id, horizontal) => lin(id, horizontal ? [0, 0, 1, 0] : [0, 0, 0, 1],
    [[0, '#000', 0.4], [0.22, '#fff', 0.45], [0.38, '#fff', 0.06], [0.8, '#000', 0.18], [1, '#000', 0.55]]);
/** A horizontal axial lead, drawn as a metallic bar. */
const axialLeads = (x0, x1, y = 100) => `<rect x="${x0}" y="${y - 3.2}" width="${x1 - x0}" height="6.4" rx="3.2" fill="url(#lead)" stroke="#4d535a" stroke-width="1.2"/>`;

function resistor() {
    const shape = (extra = '') => `<circle cx="60" cy="100" r="29"${extra}/><circle cx="140" cy="100" r="29"${extra}/><rect x="60" y="79" width="80" height="42"${extra}/>`;
    const bands = [[72, '#6b3410'], [92, '#151515'], [108, '#c3161c'], [130, 'url(#gold)']].map(([x, c]) =>
        `<rect x="${x}" y="66" width="11" height="68" fill="${c}"/>`).join('');
    return svg(CW, CH,
        '<defs>' + LEAD + SHADE('rShade', false)
        + lin('body', [0, 0, 0, 1], [[0, '#f1dcae'], [1, '#c79e62']])
        + lin('gold', [0, 0, 0, 1], [[0, '#fff0a8'], [0.5, '#d7a325'], [1, '#8d6510']])
        + `<clipPath id="rb">${shape()}</clipPath>`
        + '</defs>'
        + '<g transform="rotate(-45 100 100)">'
        + axialLeads(2, 198)
        + `<g fill="#4b3218" stroke="#4b3218" stroke-width="5">${shape()}</g>`
        + `<g fill="url(#body)">${shape()}</g>`
        + `<g clip-path="url(#rb)">${bands}<rect x="26" y="70" width="148" height="60" fill="url(#rShade)"/>`
        + '<ellipse cx="100" cy="82" rx="66" ry="3.4" fill="#fff" fill-opacity=".55"/></g>'
        + '</g>');
}

function diode() {
    return svg(CW, CH,
        '<defs>' + LEAD + SHADE('dShade', false)
        + lin('silver', [0, 0, 0, 1], [[0, '#ffffff'], [0.5, '#c4c9d0'], [1, '#6f7680']])
        + '<clipPath id="db"><rect x="42" y="76" width="116" height="48" rx="9"/></clipPath>'
        + '</defs>'
        + '<g transform="rotate(-45 100 100)">'
        + axialLeads(2, 198)
        + '<rect x="42" y="76" width="116" height="48" rx="9" fill="#1b1b1e" stroke="#000" stroke-width="3"/>'
        + '<g clip-path="url(#db)"><rect x="124" y="70" width="18" height="60" fill="url(#silver)"/>'
        // the diode's own symbol printed on the body: ▶|
        + '<path d="M76,88 L101,100 L76,112 Z M102,87 v26" fill="#9ea4ad" stroke="#9ea4ad" stroke-width="2.6" stroke-linejoin="round"/>'
        + '<rect x="36" y="72" width="128" height="56" fill="url(#dShade)"/>'
        + '<rect x="50" y="81" width="100" height="3.4" rx="1.7" fill="#fff" fill-opacity=".5"/></g>'
        + '</g>');
}

function capacitor() {
    const minus = [70, 92, 114].map((y) => `<rect x="118" y="${y}" width="9" height="3.4" rx="1" fill="#0b2c6b"/>`).join('');
    return svg(CW, CH,
        '<defs>' + LEAD + SHADE('cShade', true)
        + lin('sleeve', [0, 0, 1, 0], [[0, '#0c2f78'], [0.3, '#2b6fe0'], [0.7, '#1648b0'], [1, '#0a2259']])
        + lin('stripe', [0, 0, 1, 0], [[0, '#a9c4ee'], [1, '#7c9fd6']])
        + rad('lid', [0.4, 0.35, 0.8], [[0, '#ffffff'], [0.6, '#c5cad2'], [1, '#7d848e']])
        + '<clipPath id="cb"><path d="M56,38 V150 A44,11 0 0 0 144,150 V38 Z"/></clipPath>'
        + '</defs>'
        + '<rect x="78" y="146" width="7" height="50" rx="3.5" fill="url(#lead)" stroke="#4d535a" stroke-width="1.2"/>'
        + '<rect x="115" y="146" width="7" height="44" rx="3.5" fill="url(#lead)" stroke="#4d535a" stroke-width="1.2"/>'
        + '<path d="M56,38 V150 A44,11 0 0 0 144,150 V38 Z" fill="url(#sleeve)" stroke="#06183f" stroke-width="3" stroke-linejoin="round"/>'
        + `<g clip-path="url(#cb)"><rect x="112" y="30" width="21" height="140" fill="url(#stripe)"/>${minus}`
        + '<rect x="50" y="52" width="100" height="5" fill="#000" fill-opacity=".3"/><rect x="50" y="57" width="100" height="2" fill="#fff" fill-opacity=".25"/>'
        + '<rect x="50" y="30" width="100" height="140" fill="url(#cShade)"/></g>'
        + '<ellipse cx="100" cy="38" rx="44" ry="11" fill="url(#lid)" stroke="#06183f" stroke-width="3"/>'
        + '<ellipse cx="100" cy="38" rx="34" ry="7.5" fill="none" stroke="#6f7680" stroke-width="1.4"/>'
        + '<path d="M84,34 L116,42 M84,42 L116,34" stroke="#6f7680" stroke-width="2.2" stroke-linecap="round"/>');
}

function inductor() {
    const C = [100, 90], RO = 70, RI = 32, N = 26;
    let wires = '';
    for (let k = 0; k < N; k++) {
        const a = (2 * Math.PI * k) / N + 0.06;
        const ca = Math.cos(a), sa = Math.sin(a);
        const p = (r, t = 0) => `${f(C[0] + ca * r - sa * t)},${f(C[1] + sa * r + ca * t)}`;
        wires += `<path d="M${p(RI - 3)} L${p(RO + 3)}" stroke="#6a2f08" stroke-width="10.5" stroke-linecap="round"/>`
            + `<path d="M${p(RI - 3)} L${p(RO + 3)}" stroke="url(#copper)" stroke-width="8" stroke-linecap="round"/>`
            + `<path d="M${p(RI, -1.6)} L${p(RO, -1.6)}" stroke="#ffd7a8" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/>`;
    }
    return svg(CW, CH,
        '<defs>'
        + lin('copper', [0, 0, 200, 200], [[0, '#f2a868'], [0.5, '#c9681f'], [1, '#8a400c']], true)
        + rad('core', [0.45, 0.4, 0.6], [[0, '#4d5d55'], [1, '#1d2622']])
        + rad('toroShade', [0.38, 0.3, 0.75], [[0, '#fff', 0.35], [0.5, '#fff', 0], [1, '#000', 0.45]])
        + `<mask id="ring"><circle cx="${C[0]}" cy="${C[1]}" r="${RO + 9}" fill="#fff"/><circle cx="${C[0]}" cy="${C[1]}" r="${RI - 8}" fill="#000"/></mask>`
        + '</defs>'
        + '<path d="M82,150 Q78,172 74,196 M118,150 Q122,172 126,196" stroke="#6a2f08" stroke-width="7.5" fill="none" stroke-linecap="round"/>'
        + '<path d="M82,150 Q78,172 74,196 M118,150 Q122,172 126,196" stroke="url(#copper)" stroke-width="5" fill="none" stroke-linecap="round"/>'
        + `<circle cx="${C[0]}" cy="${C[1]}" r="${(RO + RI) / 2}" fill="none" stroke="url(#core)" stroke-width="${RO - RI}"/>`
        + `<circle cx="${C[0]}" cy="${C[1]}" r="${RO + 2}" fill="none" stroke="#111" stroke-width="2"/>`
        + `<g mask="url(#ring)">${wires}<circle cx="${C[0]}" cy="${C[1]}" r="${RO + 9}" fill="url(#toroShade)"/></g>`);
}

function battery() {
    return svg(CW, CH,
        '<defs>' + SHADE('bShade', true)
        + lin('label', [0, 0, 1, 0], [[0, '#8f0f12'], [0.3, '#ef3b2c'], [0.7, '#c81e1e'], [1, '#6e0a0c']])
        + lin('steel', [0, 0, 1, 0], [[0, '#6f7680'], [0.3, '#ffffff'], [0.65, '#b9bfc7'], [1, '#596069']])
        + rad('top', [0.4, 0.35, 0.8], [[0, '#ffffff'], [0.6, '#c5cad2'], [1, '#7d848e']])
        + lin('bolt', [0, 0, 0, 1], [[0, '#fff5a0'], [1, '#f2b705']])
        + '<clipPath id="bb"><path d="M58,44 V172 A42,10 0 0 0 142,172 V44 Z"/></clipPath>'
        + '</defs>'
        + '<path d="M58,44 V172 A42,10 0 0 0 142,172 V44 Z" fill="url(#label)" stroke="#2a0405" stroke-width="3" stroke-linejoin="round"/>'
        + '<g clip-path="url(#bb)">'
        + '<rect x="50" y="150" width="100" height="40" fill="url(#steel)"/>'
        + '<rect x="50" y="148" width="100" height="3" fill="#000" fill-opacity=".35"/>'
        // a lightning bolt and the + / − of the terminals, all drawn shapes
        + '<path d="M106,66 L82,108 H98 L90,140 L120,94 H103 L114,66 Z" fill="url(#bolt)" stroke="#7a4b00" stroke-width="2" stroke-linejoin="round"/>'
        + '<rect x="122" y="60" width="12" height="3.4" fill="#fff"/><rect x="126.3" y="55.7" width="3.4" height="12" fill="#fff"/>'
        + '<rect x="122" y="132" width="12" height="3.4" fill="#fff"/>'
        + '<rect x="50" y="36" width="100" height="160" fill="url(#bShade)"/></g>'
        + '<ellipse cx="100" cy="44" rx="42" ry="10" fill="url(#top)" stroke="#2a0405" stroke-width="3"/>'
        + '<path d="M84,44 V30 A16,4 0 0 0 116,30 V44 A16,4 0 0 1 84,44 Z" fill="url(#steel)" stroke="#3d434a" stroke-width="2"/>'
        + '<ellipse cx="100" cy="30" rx="16" ry="4" fill="url(#top)" stroke="#3d434a" stroke-width="2"/>');
}

const CIRCUIT = { red: resistor, blue: inductor, yellow: capacitor, black: battery, purple: diode };

/* ======================================================================
   Cards — five playing cards, a little tilted: the joker, the ace of
   spades, the queen of hearts, the eight of diamonds, the two of clubs.
   The suits are drawn as paths here (no font glyphs: a suit symbol in a
   system font looks different on every phone); only the corner ranks are
   text, in a serif every system has.
   ====================================================================== */

const RED = '#d0142c', INK = '#16161b';
/** Suit shapes, centred on 0,0, about 80 units tall. */
const SUIT = {
    heart: 'M0,32 C-36,4 -46,-14 -38,-28 C-30,-42 -8,-42 0,-24 C8,-42 30,-42 38,-28 C46,-14 36,4 0,32 Z',
    diamond: 'M0,-40 Q13,-19 29,0 Q13,19 0,40 Q-13,19 -29,0 Q-13,-19 0,-40 Z',
    spade: 'M0,-40 C-9,-24 -44,-8 -38,14 C-33,30 -12,30 -4,19 C-5,29 -10,37 -18,42 L18,42 C10,37 5,29 4,19 C12,30 33,30 38,14 C44,-8 9,-24 0,-40 Z',
    club: 'M-4,10 C-4,24 -10,34 -18,41 L18,41 C10,34 4,24 4,10 Z M-15,-19 a15,15 0 1 0 30,0 a15,15 0 1 0 -30,0 Z M-32,4 a15,15 0 1 0 30,0 a15,15 0 1 0 -30,0 Z M2,4 a15,15 0 1 0 30,0 a15,15 0 1 0 -30,0 Z',
};
const pip = (suit, x, y, s = 1, flip = false) =>
    `<path d="${SUIT[suit]}" transform="translate(${x} ${y}) scale(${s})${flip ? ' rotate(180)' : ''}" fill="${suit === 'heart' || suit === 'diamond' ? RED : INK}"/>`;

const CARD = { x: 36, y: 11, w: 128, h: 178 };   // in a 200×200 square, so it sits like the other sets
/** The card itself: ivory face, thin rim, a soft inner line; `face` drawn on it, then the tilt. */
function card(face, corner) {
    const { x, y, w, h } = CARD;
    const index = (rank, suit, colour) => {
        const one = `<text x="${x + 15}" y="${y + 29}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${rank.length > 1 ? 18 : 24}" fill="${colour}">${rank}</text>`
            + (suit ? pip(suit, x + 15, y + 43, 0.17) : '');
        return one + `<g transform="rotate(180 ${x + w / 2} ${y + h / 2})">${one}</g>`;
    };
    return svg(CW, CH,
        '<defs>'
        + lin('face', [0, 0, 0, 1], [[0, '#ffffff'], [1, '#f1ece0']])
        + '</defs>'
        + `<g transform="rotate(-7 100 100)">`
        + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="url(#face)" stroke="#9a9488" stroke-width="2"/>`
        + `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="8" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="1.5"/>`
        + face
        + (corner ? index(...corner) : '')
        + '</g>');
}

function aceOfSpades() {
    // The big ornate spade of the ace, with a fine white line inside it.
    const cx = CARD.x + CARD.w / 2, cy = CARD.y + CARD.h / 2;
    return card(pip('spade', cx, cy, 1.25)
        + `<path d="${SUIT.spade}" transform="translate(${cx} ${cy}) scale(.9)" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>`,
    ['A', 'spade', INK]);
}

function eightOfDiamonds() {
    // The standard layout: three down each side, two in the middle column.
    const l = CARD.x + 40, r = CARD.x + CARD.w - 40, c = CARD.x + CARD.w / 2;
    const top = CARD.y + 38, bot = CARD.y + CARD.h - 38, mid = CARD.y + CARD.h / 2;
    const at = [[l, top], [r, top], [l, mid], [r, mid], [l, bot], [r, bot], [c, (top + mid) / 2], [c, (mid + bot) / 2]];
    return card(at.map(([x, y]) => pip('diamond', x, y, 0.36)).join(''), ['8', 'diamond', RED]);
}

function twoOfClubs() {
    const c = CARD.x + CARD.w / 2;
    return card(pip('club', c, CARD.y + 50, 0.62) + pip('club', c, CARD.y + CARD.h - 50, 0.62, true), ['2', 'club', INK]);
}

function queenOfHearts() {
    // A court card: a framed panel, a gold crown, and under it the queen's heart.
    const { x, y, w, h } = CARD;
    const cx = x + w / 2;
    const panel = `<rect x="${x + 26}" y="${y + 22}" width="${w - 52}" height="${h - 44}" rx="5" fill="#fbe6e4" stroke="${RED}" stroke-width="2"/>`;
    const crown = `<path d="M${cx - 30},${y + 76} L${cx - 34},${y + 44} L${cx - 15},${y + 60} L${cx},${y + 38} L${cx + 15},${y + 60} L${cx + 34},${y + 44} L${cx + 30},${y + 76} Z" fill="url(#gold)" stroke="#8a5b06" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<rect x="${cx - 31}" y="${y + 72}" width="62" height="9" rx="3" fill="url(#gold)" stroke="#8a5b06" stroke-width="2"/>`
        + [[cx - 34, y + 44], [cx, y + 38], [cx + 34, y + 44]].map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4.5" fill="#fff4c2" stroke="#8a5b06" stroke-width="1.6"/>`).join('')
        + `<circle cx="${cx}" cy="${y + 66}" r="4" fill="${RED}"/>`;
    const goldDef = lin('gold', [0, 0, 0, 1], [[0, '#ffe680'], [0.55, '#f2b71c'], [1, '#b8790a']]);
    return card(`<defs>${goldDef}</defs>` + panel + crown + pip('heart', cx, y + 118, 0.72), ['Q', 'heart', RED]);
}

function joker() {
    // The jester: a three-pointed cap with bells over a grin, and the word
    // JOKER stacked down the corners instead of a rank.
    const { x, y, w, h } = CARD;
    const cx = x + w / 2;
    const face = `<circle cx="${cx}" cy="${y + 112}" r="24" fill="#ffe0bd" stroke="${INK}" stroke-width="2.2"/>`
        + `<circle cx="${cx - 9}" cy="${y + 107}" r="3" fill="${INK}"/><circle cx="${cx + 9}" cy="${y + 107}" r="3" fill="${INK}"/>`
        + `<path d="M${cx - 13},${y + 118} Q${cx},${y + 132} ${cx + 13},${y + 118}" fill="none" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`
        + `<circle cx="${cx - 17}" cy="${y + 117}" r="4" fill="${RED}" fill-opacity=".35"/><circle cx="${cx + 17}" cy="${y + 117}" r="4" fill="${RED}" fill-opacity=".35"/>`;
    const cap = `<path d="M${cx - 30},${y + 94} C${cx - 36},${y + 72} ${cx - 42},${y + 60} ${cx - 44},${y + 46} C${cx - 26},${y + 54} ${cx - 16},${y + 64} ${cx - 10},${y + 78} Z" fill="#7a2bc4" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<path d="M${cx - 12},${y + 86} C${cx - 10},${y + 64} ${cx - 4},${y + 46} ${cx},${y + 32} C${cx + 4},${y + 46} ${cx + 10},${y + 64} ${cx + 12},${y + 86} Z" fill="${RED}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<path d="M${cx + 30},${y + 94} C${cx + 36},${y + 72} ${cx + 42},${y + 60} ${cx + 44},${y + 46} C${cx + 26},${y + 54} ${cx + 16},${y + 64} ${cx + 10},${y + 78} Z" fill="#1c4fd6" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`
        + `<path d="M${cx - 30},${y + 96} Q${cx},${y + 84} ${cx + 30},${y + 96} L${cx + 28},${y + 101} Q${cx},${y + 90} ${cx - 28},${y + 101} Z" fill="#ffc61a" stroke="${INK}" stroke-width="2"/>`
        + [[cx - 44, y + 46], [cx, y + 32], [cx + 44, y + 46]].map(([px, py]) => `<circle cx="${px}" cy="${py}" r="6" fill="#ffc61a" stroke="${INK}" stroke-width="2"/>`).join('');
    const word = (gx, gy, rot) => `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})">`
        + [...'JOKER'].map((ch, i) => `<text x="${gx}" y="${gy + i * 12}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="11.5" fill="${RED}">${ch}</text>`).join('')
        + '</g>';
    const star = `<path d="M${cx},${y + 146} l4,9 10,1 -7.5,7 2,10 -8.5,-5 -8.5,5 2,-10 -7.5,-7 10,-1 Z" fill="#ffc61a" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
    return card(cap + face + star + word(x + 11, y + 20, 0) + word(x + 11, y + 20, 180), null);
}

/** Tile N is option N, in the order the set was asked for. */
const CARDS = { red: joker, blue: aceOfSpades, yellow: queenOfHearts, black: eightOfDiamonds, purple: twoOfClubs };


/* ====================================================================== */

const out = {};
for (const [key, spec] of Object.entries(CATAN)) out[`catan/${key}.svg`] = catanTile(spec);
for (const [key, draw] of Object.entries(CIRCUIT)) out[`circuit/${key}.svg`] = draw();
for (const [key, draw] of Object.entries(CARDS)) out[`cards/${key}.svg`] = draw();

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, text] of Object.entries(out)) {
    const path = join(ROOT, rel);
    if (check) {
        let old = null;
        try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
        if (old !== text) { console.error(`stale: gevkahoot/assets/${rel}`); stale++; }
        continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote gevkahoot/assets/${rel} (${text.length} bytes)`);
}
if (check) {
    if (stale) { console.error(`${stale} file(s) differ — run node scripts/gevkahoot-marks.mjs`); process.exit(1); }
    console.log('marks up to date');
}
