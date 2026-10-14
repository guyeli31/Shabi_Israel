/**
 * roulette.js — the roulette question: a betting table, and the wheel.
 *
 * The answer is a number from 0 to 36, and the number IS the option index —
 * so to everything downstream (scoring, the fastest five, the table, the
 * matrix) a roulette question is an ordinary question with 37 options.
 *
 * The table is a real single-zero (European) table, drawn as a CSS grid after
 * a photographed one: three columns of numbers under ONE zero, the outside
 * bets down the side (1-18, EVEN, red, black, ODD, 19-36), the dozens down the
 * other side and "2 to 1" under each column. On a phone it stands upright,
 * exactly as in the photograph; on the projector it lies on its side — 0 on
 * the left, the dozens and outside bets underneath, "2 to 1" at the end. Only
 * the numbers take a bet (the question has one right number); the outside
 * fields are the table's furniture. A tap puts a chip on a number; another
 * tap moves it.
 *
 * At the reveal the wheel spins and the ball drops into the right number.
 * The spin is a pure function of the time since it began, so a screen that
 * rebuilds in the middle (a late poll, a rotated phone) picks it up where it
 * was rather than starting again; its starting angles come from the item id,
 * so every screen in the room shows the same spin.
 */
import { h, svgEl } from '../ui/dom.js';

/** The pockets in wheel order, clockwise from the zero. */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colourOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/*
 * The grid, in both orientations (lines are 1-based).
 *   upright   columns: outside | 3 numbers | dozens      rows: zero | 12 rows | 2-to-1
 *   on side   columns: zero | 12 numbers | 2-to-1        rows: 3 rows | dozens | outside
 * Number n is in table column (n-1)%3 and table row ⌊(n-1)/3⌋; on its side, the
 * table's first column (1, 4, …) is the BOTTOM row, as on a real table.
 */
function place(n, compact) {
    if (n === 0) return compact ? { gridColumn: '2 / 5', gridRow: '1' } : { gridColumn: '1', gridRow: '1 / 4' };
    const col = (n - 1) % 3, row = Math.floor((n - 1) / 3);
    return compact
        ? { gridColumn: String(col + 2), gridRow: String(row + 2) }
        : { gridColumn: String(row + 2), gridRow: String(3 - col) };
}

/** The outside fields: [label or swatch, upright place, on-side place]. */
const OUTSIDE = [
    ['1-18', ['1', '2 / 4'], ['2 / 4', '5']],
    ['EVEN', ['1', '4 / 6'], ['4 / 6', '5']],
    ['◆red', ['1', '6 / 8'], ['6 / 8', '5']],
    ['◆black', ['1', '8 / 10'], ['8 / 10', '5']],
    ['ODD', ['1', '10 / 12'], ['10 / 12', '5']],
    ['19-36', ['1', '12 / 14'], ['12 / 14', '5']],
    ['1st 12', ['5', '2 / 6'], ['2 / 6', '4']],
    ['2nd 12', ['5', '6 / 10'], ['6 / 10', '4']],
    ['3rd 12', ['5', '10 / 14'], ['10 / 14', '4']],
    // "2 to 1" under each column: upright along the bottom, on its side at the end.
    ['2 to 1', ['2', '14'], ['14', '3']],
    ['2 to 1', ['3', '14'], ['14', '2']],
    ['2 to 1', ['4', '14'], ['14', '1']],
];
function outside(compact) {
    return OUTSIDE.map(([label, up, side]) => {
        const [gridColumn, gridRow] = compact ? up : side;
        const swatch = label.startsWith('◆');
        return h('div', { class: 'rl-out', 'aria-hidden': 'true', style: { gridColumn, gridRow },
            dataset: swatch ? { swatch: label.slice(1) } : label === '2 to 1' ? { col: '' } : {} },
        swatch ? h('span', { class: 'rl-diamond' }) : h('span', { class: 'rl-out-text', text: label }));
    });
}

/** A chip, carrying the number it sits on — so the bet still reads under it. */
function chip(n) {
    return h('span', { class: 'rl-chip', 'aria-hidden': 'true' }, h('span', { class: 'rl-chip-face', text: String(n) }));
}

/**
 * @param interactive  a player's copy: the squares are buttons
 * @param compact      the phone layout
 * @param onSelect     called with the tapped number (not yet an answer — the
 *                     stage offers "submit" for the current selection)
 */
export function createTable({ interactive, compact, onSelect }) {
    let selected = null;
    let locked = false;
    const cells = Array.from({ length: 37 }, (_, n) => {
        const el = h(interactive ? 'button' : 'div', {
            class: 'rl-cell', type: interactive ? 'button' : null, 'aria-label': `מספר ${n}`,
            dataset: { colour: colourOf(n) }, style: place(n, compact),
            onclick: interactive ? () => { if (!locked) { select(n); onSelect?.(n); } } : null,
        }, h('span', { class: 'rl-num', text: String(n) }));
        return el;
    });
    const table = h('div', { class: 'rl-table', dataset: compact ? { compact: '' } : {} }, outside(compact), cells);
    const root = h('div', { class: 'rl', dataset: interactive ? { live: '' } : {} }, table);

    function select(n) {
        if (selected !== null) cells[selected].querySelector('.rl-chip')?.remove();
        selected = n;
        if (n !== null && n !== undefined && cells[n]) cells[n].append(chip(n));
    }

    return {
        el: root,
        get selected() { return selected; },
        /** Freeze it on `picked` (this player's answer, or null if none). */
        lock(picked) {
            locked = true;
            root.toggleAttribute('data-locked', true);
            if (picked !== selected) select(picked);
            for (const el of cells) if (el.tagName === 'BUTTON') el.disabled = true;
        },
        /** This player's own pick: their chip. */
        markPicked(picked) { if (picked !== null && picked !== selected) select(picked); },
        /** The reveal: the winning square, and how many chips each square drew. */
        reveal({ correct, counts, picked }) {
            locked = true;
            root.toggleAttribute('data-revealed', true);
            const win = correct?.[0];
            cells.forEach((el, n) => {
                el.toggleAttribute('data-win', n === win);
                if (el.tagName === 'BUTTON') el.disabled = true;
                const c = counts?.[n] || 0;
                if (c) el.append(h('span', { class: 'rl-count', text: String(c) }));
            });
            if (picked !== null && picked !== undefined) select(picked);
        },
    };
}

/** The croupier's call, slammed over the table when the betting closes: as the
 *  clock runs out, and again to open the reveal (which can come before the
 *  clock, when everyone has bet). */
export const NO_MORE_BETS_MS = 1800;
export function noMoreBets() {
    return h('div', { class: 'rl-nomore', role: 'status' }, h('span', { class: 'rl-nomore-text', text: 'NO MORE BETS' }));
}

/* ---- the wheel -------------------------------------------------------------- */

const STEP = 360 / 37;
const C = 200;                              // centre of the 400 × 400 drawing
const R_TRACK = 166, R_POCKET = 121;        // the ball's radius on the track / in a pocket
const pt = (r, deg) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
const f = (n) => +n.toFixed(2);

function wedge(r0, r1, a0, a1) {
    const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
    return `M${f(x0)},${f(y0)} A${r1},${r1} 0 0 1 ${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${r0},${r0} 0 0 0 ${f(x3)},${f(y3)} Z`;
}

const FILL = { red: '#c8102e', black: '#17171c', green: '#0b8f3e' };
const DEEP = { red: '#8e0a20', black: '#0a0a0d', green: '#066129' };

function buildWheel() {
    const defs = svgEl('defs', {},
        grad('rl-wood', 'radialGradient', { cx: '50%', cy: '45%', r: '60%' }, [[0.7, '#7a4420'], [0.92, '#4a250f'], [1, '#2a1406']]),
        grad('rl-track', 'radialGradient', { cx: '50%', cy: '42%', r: '55%' }, [[0.7, '#3b2010'], [1, '#170a03']]),
        grad('rl-cone', 'radialGradient', { cx: '42%', cy: '36%', r: '65%' }, [[0, '#b0703a'], [0.6, '#7b431c'], [1, '#4a250f']]),
        grad('rl-gold', 'linearGradient', { x1: '0', y1: '0', x2: '1', y2: '1' }, [[0, '#fff3b0'], [0.45, '#e2b33c'], [1, '#8a6312']]),
        grad('rl-ball', 'radialGradient', { cx: '35%', cy: '30%', r: '70%' }, [[0, '#ffffff'], [0.6, '#e6e8ec'], [1, '#9097a3']]),
        grad('rl-shine', 'linearGradient', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, '#fff', 0.22], [0.5, '#fff', 0], [1, '#000', 0.25]]));
    const rotor = svgEl('g', { class: 'rl-rotor' });
    // Pocket floors (inner, deeper) and number band (outer), one wedge each.
    WHEEL.forEach((n, i) => {
        const a0 = i * STEP - STEP / 2, a1 = a0 + STEP, col = colourOf(n);
        rotor.append(svgEl('path', { d: wedge(108, 132, a0, a1), fill: DEEP[col] }));
        rotor.append(svgEl('path', { d: wedge(132, 152, a0, a1), fill: FILL[col] }));
        const [tx, ty] = pt(142, i * STEP);
        rotor.append(svgEl('text', { x: f(tx), y: f(ty), class: 'rl-wheel-num',
            transform: `rotate(${f(i * STEP)} ${f(tx)} ${f(ty)})` }, String(n)));
        // The frets between pockets.
        const [fx0, fy0] = pt(108, a0), [fx1, fy1] = pt(132, a0);
        rotor.append(svgEl('line', { x1: f(fx0), y1: f(fy0), x2: f(fx1), y2: f(fy1), class: 'rl-fret' }));
    });
    rotor.append(
        svgEl('circle', { cx: C, cy: C, r: 152, fill: 'none', stroke: 'url(#rl-gold)', 'stroke-width': 2.5 }),
        svgEl('circle', { cx: C, cy: C, r: 132, fill: 'none', stroke: 'url(#rl-gold)', 'stroke-width': 1.5 }),
        svgEl('circle', { cx: C, cy: C, r: 107, fill: 'url(#rl-cone)', stroke: 'url(#rl-gold)', 'stroke-width': 2.5 }),
        // The cone's spokes and the turret at the centre.
        ...[0, 90, 180, 270].map((a) => {
            const [x, y] = pt(70, a);
            return svgEl('line', { x1: C, y1: C, x2: f(x), y2: f(y), stroke: 'url(#rl-gold)', 'stroke-width': 6, 'stroke-linecap': 'round' });
        }),
        ...[0, 90, 180, 270].map((a) => {
            const [x, y] = pt(70, a);
            return svgEl('circle', { cx: f(x), cy: f(y), r: 7, fill: 'url(#rl-gold)' });
        }),
        svgEl('circle', { cx: C, cy: C, r: 24, fill: 'url(#rl-gold)', stroke: '#6b4a0c', 'stroke-width': 1.5 }),
        svgEl('circle', { cx: C, cy: C, r: 9, fill: '#fff3b0' }));
    const ball = svgEl('circle', { class: 'rl-ball', r: 7.5, fill: 'url(#rl-ball)', cx: C, cy: C - R_TRACK });
    const svg = svgEl('svg', { class: 'rl-wheel', viewBox: '0 0 400 400', 'aria-hidden': 'true' }, defs,
        svgEl('circle', { cx: C, cy: C, r: 198, fill: 'url(#rl-wood)' }),
        svgEl('circle', { cx: C, cy: C, r: 182, fill: 'none', stroke: 'url(#rl-gold)', 'stroke-width': 3 }),
        svgEl('circle', { cx: C, cy: C, r: 181, fill: 'url(#rl-track)' }),
        // Diamond deflectors on the track.
        ...Array.from({ length: 8 }, (_, k) => {
            const [x, y] = pt(170, k * 45 + 22.5);
            return svgEl('rect', { x: f(x - 4), y: f(y - 4), width: 8, height: 8, fill: 'url(#rl-gold)',
                transform: `rotate(${k * 45 + 67.5} ${f(x)} ${f(y)})` });
        }),
        rotor,
        svgEl('circle', { cx: C, cy: C, r: 181, fill: 'url(#rl-shine)', 'pointer-events': 'none' }),
        ball);
    return { svg, rotor, ball };
}

function grad(id, type, attrs, list) {
    return svgEl(type, { id, ...attrs }, ...list.map(([o, c, a = 1]) =>
        svgEl('stop', { offset: o, 'stop-color': c, 'stop-opacity': a < 1 ? a : null })));
}

const easeOut = (x, p) => 1 - (1 - x) ** p;
/** A stable 0-1 number from a string (the item id): the same spin everywhere. */
function seed(s) {
    let x = 2166136261;
    for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return ((x >>> 0) % 10000) / 10000;
}

/** How long the spin lasts, and the pause on the result before the table. */
export const SPIN_MS = 7000, SETTLE_MS = 1300;

/**
 * The wheel, spinning to `number`. `elapsed` is how far into the spin it
 * already is (a rebuilt screen joins it mid-way). `onDone` fires once the
 * ball has settled and been seen.
 */
export function createWheel({ number, key, elapsed = 0, onDone }) {
    const { svg, rotor, ball } = buildWheel();
    const s = seed(key);
    const W0 = s * 360, Wturns = 3.1 * 360;                 // the wheel, clockwise
    const target = WHEEL.indexOf(number) * STEP;           // the pocket, in the wheel's frame
    const Rturns = 4.6 * 360;                               // the ball, against it
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now() - (still ? SPIN_MS : elapsed);
    let raf = 0, done = false;

    function frame(now) {
        const t = Math.min(1, (now - start) / SPIN_MS);
        const W = W0 + Wturns * easeOut(t, 3);
        // The ball, relative to the wheel: it runs against it and comes to
        // rest in its pocket at 82% of the spin; the wheel carries it after.
        const u = Math.min(1, t / 0.82);
        const R = target + Rturns * (1 - easeOut(u, 2.6));
        // Off the track and down the cone, with a few dying bounces.
        let r = R_TRACK;
        if (u > 0.58) {
            const d = Math.min(1, (u - 0.58) / 0.16);
            r = R_TRACK - (R_TRACK - R_POCKET) * easeOut(d, 2);
            if (u > 0.74) {
                const k = (u - 0.74) / 0.26;
                r += 13 * Math.abs(Math.sin(k * Math.PI * 3.5)) * (1 - k) ** 2;
            }
        }
        rotor.setAttribute('transform', `rotate(${f(W)} ${C} ${C})`);
        const [x, y] = pt(r, W + R);
        ball.setAttribute('cx', f(x));
        ball.setAttribute('cy', f(y));
        if (t < 1) { raf = requestAnimationFrame(frame); return; }
        if (!done) {
            done = true;
            svg.closest?.('.rl-spin')?.toggleAttribute('data-landed', true);
            const wait = Math.max(0, SETTLE_MS - Math.max(0, now - start - SPIN_MS));
            setTimeout(() => onDone?.(), wait);
        }
    }
    raf = requestAnimationFrame(frame);
    return { el: svg, stop() { cancelAnimationFrame(raf); } };
}
