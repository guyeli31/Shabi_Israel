/**
 * action.js — the action round: free throws.
 *
 * A basketball court seen from the free-throw line, the hoop at the top, and
 * the ball at the player's feet — the ball being a round detail of a picture
 * (normally the very circle the puzzle before it lifted off its picture), or a
 * drawn basketball when the host picked none. The player drags the ball
 * towards the hoop and lets go: the drag's sideways slope is the aim, its
 * length the power, its duration whether it was a throw at all (THROW in
 * js/scoring.js holds the three windows). The ball flies where that sends it
 * — into the net, onto the rim, short onto the floor, long off the backboard —
 * a mark stays where it came down, a line says what went wrong, and the
 * quiz's fixed sound says which (js/ui/sounds.js: correct for a basket, wrong
 * for a miss)
 * says how good it was. Then the ball is back at the line for the next throw,
 * until the clock runs out. The count is reported after every throw.
 *
 * The court is a fixed 3:4 picture, laid out in fractions of its own box, so
 * the same geometry serves a phone, a desktop and the projected screen. Its
 * drawing is two SVG layers — everything behind the ball, and the front of
 * the rim with the net in front of it — so a basket really goes THROUGH the
 * hoop.
 *
 * `auto` is the demonstration: a hand throws by itself every few seconds,
 * mostly in, sometimes not. It is what the instruction slide shows (with the
 * real ball) and what the projected screen shows while the room plays.
 */
import { h, svgEl } from '../ui/dom.js';
import { THROW, throwWindows } from '../scoring.js';
import { playSound } from '../ui/sounds.js';
import { holdTouch } from '../ui/touch.js';

// ---- the court's geometry, as fractions of its box (3 wide : 4 high) ------
const START = { x: 0.5, y: 0.62 };      // the ball, held up by the shooter at the line
const FLOOR = 0.97;                     // the floor at the shooter's feet (a short throw lands between here and the hoop)
const RIM = { x: 0.5, y: 0.25, half: 0.0667 };
const BOARD_Y = 0.15;                   // where a long throw hits the backboard
const SIZE_NEAR = 0.155, SIZE_FAR = 0.072;   // ball width at the line / at the rim
const FLIGHT_MS = 900, RESET_MS = 420;

/** Ball width (fraction of the court's width) at floor depth y: perspective. */
const sizeAt = (y) => SIZE_FAR + (SIZE_NEAR - SIZE_FAR) * Math.min(1, Math.max(0, (y - RIM.y) / (START.y - RIM.y)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * What a drag does. `dx`, `up` are the drag in fractions of the court's width
 * and height (up = towards the hoop), `ms` its duration. Returns the outcome
 * and the line the player reads, or null for a drag too small to be a throw.
 * `win` is the windows at the question's difficulty (throwWindows).
 */
export function judgeThrow(dx, up, ms, win = THROW) {
    if (up < 0.04) return null;
    // The slope in court units: dx is a fraction of the WIDTH, up of the
    // HEIGHT, and the court is 3:4 — so a 45° drag is a slope of 1.
    const slope = (dx * 3) / (up * 4);
    const side = slope > 0 ? 'ימינה' : 'שמאלה';
    const [lo, hi] = win.power;
    const aimed = Math.abs(slope) <= win.aim;
    const alsoAim = !aimed && Math.abs(slope) > win.aim ? ` · וגם ${side} מדי` : '';
    if (ms > win.slow) return { outcome: 'slow', slope, power: up, text: '🐢 לאט מדי — זורקים בתנועה אחת' };
    if (up < lo) return { outcome: 'short', slope, power: up, text: `${up < lo * 0.8 ? '⬇️ חלש מדי' : '⬇️ קצת חלש מדי'}${alsoAim}` };
    if (up > hi) return { outcome: 'long', slope, power: up, text: `${up > hi * 1.2 ? '⬆️ חזק מדי' : '⬆️ קצת חזק מדי'}${alsoAim}` };
    if (aimed) {
        const clean = Math.abs(slope) <= win.aim * 0.4 && Math.abs(up - win.ideal) <= (hi - lo) * 0.2;
        return { outcome: clean ? 'swish' : 'hit', slope, power: up, text: clean ? '🎯 סוויש! נקי לגמרי' : '🏀 קליעה!' };
    }
    if (Math.abs(slope) <= win.rim) return { outcome: 'rim', slope, power: up, text: `😬 בטבעת — קצת ${side} מדי` };
    return { outcome: 'side', slope, power: up, text: `↔️ החטאה — ${side} מדי` };
}
export const isBasket = (outcome) => outcome === 'swish' || outcome === 'hit';

/** The path a judged throw takes: segments of { to, ms, arc } after the
 *  flight from the line, and where it comes down (null for a basket). */
function pathOf({ outcome, slope, power }) {
    const aimX = clamp(0.5 + slope * 0.5, 0.06, 0.94);
    const f = power / THROW.ideal;
    const dir = Math.sign(slope) || 1;
    switch (outcome) {
        case 'swish': case 'hit': {
            const x = 0.5 + slope * 0.25;
            return { segs: [{ to: { x, y: RIM.y - 0.005 }, ms: FLIGHT_MS, arc: 0.24 },
                { to: { x: 0.5, y: RIM.y + 0.075 }, ms: 260, arc: 0, net: true },
                { to: { x: 0.5 + dir * 0.02, y: RIM.y + 0.16 }, ms: 260, arc: -0.02, fade: true }], land: null };
        }
        case 'rim': {
            const edge = { x: 0.5 + dir * RIM.half * 0.92, y: RIM.y - 0.01 };
            const land = { x: clamp(edge.x + dir * 0.14, 0.06, 0.94), y: 0.42 };
            return { segs: [{ to: edge, ms: FLIGHT_MS, arc: 0.24, clank: true },
                { to: land, ms: 520, arc: 0.07 }], land };
        }
        case 'side': {
            const land = { x: aimX, y: 0.4 };
            return { segs: [{ to: { x: aimX, y: RIM.y + 0.01 }, ms: FLIGHT_MS, arc: 0.24 },
                { to: land, ms: 360, arc: 0, thud: true }], land };
        }
        case 'long': {
            const hit = { x: clamp(0.5 + slope * 0.45, 0.2, 0.8), y: BOARD_Y - Math.min(0.06, (f - 1) * 0.12) };
            const land = { x: clamp(hit.x + slope * 0.4, 0.06, 0.94), y: 0.47 };
            return { segs: [{ to: hit, ms: FLIGHT_MS * 0.9, arc: 0.2, bang: true },
                { to: land, ms: 520, arc: 0.03, thud: true }], land };
        }
        default: {   // short, slow: comes down on the floor in front of the hoop
            const reach = outcome === 'slow' ? f * 0.55 : f;
            const y = FLOOR - (FLOOR - RIM.y - 0.08) * clamp(reach, 0.15, 0.97);
            const land = { x: clamp(0.5 + slope * 0.5 * reach, 0.06, 0.94), y };
            return { segs: [{ to: land, ms: FLIGHT_MS * clamp(reach, 0.5, 1), arc: 0.12 + 0.12 * clamp(reach, 0, 1), thud: true }], land };
        }
    }
}

// ---- drawing ---------------------------------------------------------------
const VB = '0 0 300 400';

/** Everything behind the ball: the arena wall, the floor and its lines, the
 *  backboard, the back of the rim. */
function courtBack() {
    return svgEl('svg', { class: 'ac-court', viewBox: VB, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        svgEl('defs', {},
            svgEl('linearGradient', { id: 'ac-wall', x1: 0, y1: 0, x2: 0, y2: 1 },
                svgEl('stop', { offset: 0, 'stop-color': '#151b2e' }), svgEl('stop', { offset: 1, 'stop-color': '#2a3352' })),
            svgEl('linearGradient', { id: 'ac-floor', x1: 0, y1: 0, x2: 0, y2: 1 },
                svgEl('stop', { offset: 0, 'stop-color': '#b97a3c' }), svgEl('stop', { offset: 1, 'stop-color': '#e3a560' }))),
        svgEl('rect', { x: 0, y: 0, width: 300, height: 128, fill: 'url(#ac-wall)' }),
        // spotlights on the wall
        svgEl('ellipse', { cx: 150, cy: 70, rx: 120, ry: 60, fill: '#fff', opacity: 0.06 }),
        svgEl('rect', { x: 0, y: 128, width: 300, height: 272, fill: 'url(#ac-floor)' }),
        // the boards of the parquet, converging towards the hoop
        ...Array.from({ length: 13 }, (_, i) => {
            const xb = -60 + i * 35, xt = 150 + (xb - 150) * 0.45;
            return svgEl('line', { x1: xt, y1: 128, x2: xb, y2: 400, stroke: '#7a4a1e', 'stroke-opacity': 0.18, 'stroke-width': 1.2 });
        }),
        svgEl('line', { x1: 0, y1: 128, x2: 300, y2: 128, stroke: '#fff', 'stroke-opacity': 0.75, 'stroke-width': 2.5 }),
        // the key (the painted lane) and the free-throw line with its circle
        svgEl('path', { d: 'M110,128 L190,128 L232,330 L68,330 Z', fill: '#c0392b', 'fill-opacity': 0.55, stroke: '#fff', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M68,330 A82,34 0 0 0 232,330', fill: 'none', stroke: '#fff', 'stroke-width': 2.5 }),
        svgEl('path', { d: 'M68,330 A82,30 0 0 1 232,330', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '7 6', 'stroke-opacity': 0.8 }),
        // the stanchion behind the board
        svgEl('rect', { x: 146, y: 92, width: 8, height: 36, fill: '#39404f' }),
        // the backboard
        svgEl('rect', { x: 100, y: 22, width: 100, height: 76, rx: 3, fill: '#ffffff', 'fill-opacity': 0.88, stroke: '#2b2f3a', 'stroke-width': 2.5 }),
        svgEl('rect', { x: 131, y: 58, width: 38, height: 30, fill: 'none', stroke: '#e2162f', 'stroke-width': 2.5 }),
        // the back half of the rim
        svgEl('path', { d: 'M130,100 A20,5.5 0 0 1 170,100', fill: 'none', stroke: '#c2410c', 'stroke-width': 3 }));
}

/** In front of the ball: the front of the rim and the net hanging from it. */
function courtFront() {
    const net = svgEl('g', { class: 'ac-net' },
        svgEl('path', { d: 'M130,100 L136,126 L164,126 L170,100', fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-opacity': 0.9 }),
        ...[137, 144, 150, 156, 163].map((x, i) => svgEl('path', {
            d: `M${130 + i * 10},100 L${x},126`, fill: 'none', stroke: '#fff', 'stroke-width': 1.1, 'stroke-opacity': 0.8 })),
        svgEl('path', { d: 'M132,108 L168,108 M134,117 L166,117', fill: 'none', stroke: '#fff', 'stroke-width': 1.1, 'stroke-opacity': 0.75 }));
    return svgEl('svg', { class: 'ac-court ac-court--front', viewBox: VB, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        net,
        svgEl('path', { class: 'ac-rim', d: 'M130,100 A20,5.5 0 0 0 170,100', fill: 'none', stroke: '#f97316', 'stroke-width': 3.6, 'stroke-linecap': 'round' }));
}

/**
 * The shooter at the line, seen from behind: drawn here from a reference
 * photo of Shaquille O'Neal in Orlando — bald, broad, the black pinstriped
 * Magic jersey with blue trim, "שאקיל וניל" (so, deliberately — the author's
 * wording, not a typo for אוניל) over a blue 32. Two poses: the ball
 * held up between both hands (`set`), and the follow-through, arms up, while
 * the ball leaves (`shot`, shown by `data-shot` on the court). He stands in
 * front of the ball's layer, so the ball sits between his hands.
 */
const SKIN = '#5b3a24', SKIN_EDGE = '#3a2416', SKIN_LIGHT = '#7a5136';
function shooter() {
    const limb = (pts, w) => {
        const d = `M${pts.map((p) => p.join(',')).join(' L')}`;
        return [svgEl('path', { d, fill: 'none', stroke: SKIN_EDGE, 'stroke-width': w + 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
            svgEl('path', { d, fill: 'none', stroke: SKIN, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })];
    };
    const hand = (x, y) => svgEl('circle', { cx: x, cy: y, r: 8.5, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.6 });
    // both arms of a pose: shoulder → elbow → hand, mirrored
    const arms = (cls, elbow, wrist) => svgEl('g', { class: cls },
        ...limb([[112, 332], elbow, wrist], 15), ...limb([[188, 332], [300 - elbow[0], elbow[1]], [300 - wrist[0], wrist[1]]], 15),
        hand(...wrist), hand(300 - wrist[0], wrist[1]));
    const jersey = 'M121,313 Q150,328 179,313 L186,320 C188,336 197,350 207,357 L213,400 L87,400 L93,357 C103,350 112,336 114,320 Z';
    return svgEl('svg', { class: 'ac-court ac-shooter', viewBox: VB, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        svgEl('defs', {},
            svgEl('pattern', { id: 'ac-pin', width: 6.5, height: 10, patternUnits: 'userSpaceOnUse' },
                svgEl('line', { x1: 3.25, y1: 0, x2: 3.25, y2: 10, stroke: '#fff', 'stroke-width': 0.9, 'stroke-opacity': 0.55 }))),
        svgEl('ellipse', { cx: 150, cy: 397, rx: 74, ry: 8, fill: '#000', opacity: 0.35 }),
        // the back and the shoulders (the jersey is sleeveless)
        svgEl('path', { d: 'M86,352 C86,331 108,318 132,313 L168,313 C192,318 214,331 214,352 L212,400 L88,400 Z', fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.5 }),
        svgEl('ellipse', { cx: 107, cy: 334, rx: 9, ry: 6, fill: SKIN_LIGHT, opacity: 0.6 }),
        svgEl('ellipse', { cx: 193, cy: 334, rx: 9, ry: 6, fill: SKIN_LIGHT, opacity: 0.6 }),
        arms('ac-arms-set', [93, 284], [128, 252]),
        arms('ac-arms-shot', [122, 270], [141, 214]),
        // neck and the bald head, ears and a shine
        svgEl('rect', { x: 139, y: 290, width: 22, height: 28, rx: 6, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.5 }),
        svgEl('ellipse', { cx: 132.5, cy: 285, rx: 3.6, ry: 6.5, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.3 }),
        svgEl('ellipse', { cx: 167.5, cy: 285, rx: 3.6, ry: 6.5, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.3 }),
        svgEl('ellipse', { cx: 150, cy: 281, rx: 17.5, ry: 21, fill: SKIN, stroke: SKIN_EDGE, 'stroke-width': 1.5 }),
        svgEl('ellipse', { cx: 144, cy: 271, rx: 5.5, ry: 8, fill: '#fff', opacity: 0.16 }),
        // the jersey: black, pinstriped, blue trim at the neck and armholes
        svgEl('path', { d: jersey, fill: '#141418' }),
        svgEl('path', { d: jersey, fill: 'url(#ac-pin)' }),
        svgEl('path', { d: 'M93,357 C103,350 112,336 114,320 L121,313 Q150,328 179,313 L186,320 C188,336 197,350 207,357', fill: 'none', stroke: '#2f6ae0', 'stroke-width': 3.2, 'stroke-linejoin': 'round' }),
        // No letter-spacing on this text: WebKit lays out spaced SVG text
        // glyph by glyph, left to right, and the Hebrew comes out reversed.
        svgEl('text', { x: 150, y: 342, 'text-anchor': 'middle', direction: 'rtl', 'font-family': 'Arial, Helvetica, sans-serif', 'font-weight': 700, 'font-size': 10.5, fill: '#fff' }, 'שאקיל וניל'),
        svgEl('text', { x: 150, y: 378, 'text-anchor': 'middle', 'font-family': "'Arial Black', Arial, sans-serif", 'font-weight': 900, 'font-size': 36, fill: '#2f6ae0', stroke: '#fff', 'stroke-width': 2.6, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, '32'));
}

/** The ball when the host picked no picture: a drawn basketball. */
function drawnBall() {
    return svgEl('svg', { class: 'ac-ball-img', viewBox: '0 0 100 100', 'aria-hidden': 'true' },
        svgEl('defs', {}, svgEl('radialGradient', { id: 'ac-bb', cx: 0.38, cy: 0.32, r: 0.75 },
            svgEl('stop', { offset: 0, 'stop-color': '#ffb15c' }), svgEl('stop', { offset: 0.7, 'stop-color': '#e2620e' }),
            svgEl('stop', { offset: 1, 'stop-color': '#9a3c05' }))),
        svgEl('circle', { cx: 50, cy: 50, r: 48, fill: 'url(#ac-bb)', stroke: '#3a1702', 'stroke-width': 2 }),
        svgEl('path', { d: 'M2,50 H98 M50,2 V98 M16,16 C36,36 36,64 16,84 M84,16 C64,36 64,64 84,84', fill: 'none', stroke: '#3a1702', 'stroke-width': 3 }));
}

// ---- the game ----------------------------------------------------------------
/**
 * @param ball        a picture's URL for the ball, or a promise of one (the
 *                    circle cut out of the puzzle's picture), or null
 * @param interactive a player's copy: the ball can be thrown
 * @param auto        the demonstration: it throws by itself
 * @param start       { hits, attempts } to resume from (a rebuilt screen)
 * @param canThrow    () => whether a new throw may start (the clock)
 * @param onScore     (hits, attempts) after each throw has come down
 * @param feedback    { hit: [..], miss: [..] } — the quiz author's lines: one
 *                    of them heads the message after a throw, with the
 *                    built-in diagnosis ("too hard", "a bit to the left")
 *                    under it; none: the diagnosis alone
 */
export function createAction({ ball = null, interactive = false, auto = false, start = {}, canThrow = () => true, onScore = null, sfx = true, feedback = {}, level = 5 } = {}) {
    // The windows at the host's difficulty: what counts as a basket, and the
    // power meter's zone. (The demonstration hand keeps the standard ones.)
    const win = throwWindows(level);
    let hits = start.hits || 0, attempts = Math.max(start.attempts || 0, hits);
    let busy = false, locked = false;
    // The sounds are this player's own feedback: only a real throw, and not in the preview.
    const sounds = interactive && sfx;

    const ballEl = h('div', { class: 'ac-ball' });
    const setBall = (src) => { ballEl.replaceChildren(src ? h('img', { class: 'ac-ball-img', src, alt: '', draggable: 'false' }) : drawnBall()); };
    setBall(null);
    Promise.resolve(ball).then((src) => { if (src) setBall(src); }, () => {});

    const marks = h('div', { class: 'ac-marks', 'aria-hidden': 'true' });
    const guide = svgEl('svg', { class: 'ac-guide', viewBox: '0 0 300 400', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const guideLine = svgEl('line', { x1: 150, y1: 354, x2: 150, y2: 354, stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '8 7', 'stroke-linecap': 'round', opacity: 0 });
    guide.append(guideLine);
    const say = h('div', { class: 'ac-say', role: 'status', 'aria-live': 'polite' });
    const front = courtFront();
    // Placed from the start (its fingertip on the top of the ball, the whole
    // hand on the court): unplaced, an absolute box sits where the flow put
    // it — below the court, until the first throw moved it.
    const hand = auto ? h('span', { class: 'ac-hand', 'aria-hidden': 'true',
        style: { left: `${START.x * 100}%`, top: `${(START.y - 0.075) * 100}%`, transform: 'translate(-35%, 0)' } }, h('span', { text: '👆' })) : null;

    // The power window, beside the court: where the drag is, against where it
    // should end. It answers "how hard" while the finger is still down.
    const [lo, hi] = win.power;
    const METER_MAX = 0.55;
    const meterFill = h('span', { class: 'ac-meter-fill' });
    const meter = interactive && h('div', { class: 'ac-meter', 'aria-hidden': 'true' },
        h('span', { class: 'ac-meter-zone', style: { bottom: `${(lo / METER_MAX) * 100}%`, height: `${((hi - lo) / METER_MAX) * 100}%` } }),
        meterFill);
    const showPower = (p) => { if (meter) meterFill.style.height = `${clamp(p / METER_MAX, 0, 1) * 100}%`; };

    const hudHits = h('b', { class: 'ac-hits', text: String(hits) });
    const hudTries = h('span', { class: 'ac-tries' });
    const hud = interactive && h('div', { class: 'ac-hud' }, h('span', { class: 'ac-hud-icon', text: '🏀' }), hudHits, hudTries);
    const over = interactive && h('div', { class: 'ac-over', hidden: true });
    const drawHud = () => {
        if (!hud) return;
        hudHits.textContent = String(hits);
        hudTries.textContent = attempts ? `מתוך ${attempts}` : 'קליעות';
    };
    drawHud();

    const court = h('div', { class: 'ac', dataset: { ...(interactive ? { live: '' } : {}), ...(auto ? { auto: '' } : {}) } },
        courtBack(), marks, guide, ballEl, shooter(), front, hand, say, meter, hud, over);
    const root = h('div', { class: 'ac-wrap' }, court);

    // ---- placing the ball ----------------------------------------------------
    let pos = { ...START }, height = 0, spin = 0, fade = 1;
    function draw() {
        const W = court.clientWidth, H = court.clientHeight;
        if (!W || !H) return;
        const s = sizeAt(pos.y) * W;
        ballEl.style.width = ballEl.style.height = `${s}px`;
        ballEl.style.transform = `translate3d(${pos.x * W - s / 2}px, ${(pos.y - height) * H - s / 2}px, 0) rotate(${spin}deg)`;
        ballEl.style.opacity = String(fade);
    }
    new ResizeObserver(draw).observe(court);
    requestAnimationFrame(draw);

    /** One of the author's lines for this outcome — never the same twice in a row. */
    const lastLine = { hit: null, miss: null };
    function authorLine(which) {
        const lines = (Array.isArray(feedback?.[which]) ? feedback[which] : []).filter((t) => typeof t === 'string' && t.trim());
        if (!lines.length) return null;
        const pool = lines.length > 1 ? lines.filter((t) => t !== lastLine[which]) : lines;
        return (lastLine[which] = pool[Math.floor(Math.random() * pool.length)]);
    }
    const say_ = (judged, tone) => {
        const line = authorLine(isBasket(judged.outcome) ? 'hit' : 'miss');
        say.replaceChildren(...[h('span', { class: 'ac-say-main', dir: 'auto', text: line || judged.text }),
            line && h('small', { class: 'ac-say-sub', text: judged.text })].filter(Boolean));
        say.dataset.tone = tone;
        say.classList.remove('ac-say--on');
        void say.offsetWidth;            // restart the pop
        say.classList.add('ac-say--on');
    };
    function mark(at, basket) {
        const dot = h('span', { class: 'ac-mark', dataset: basket ? { in: '' } : {},
            style: { left: `${at.x * 100}%`, top: `${at.y * 100}%` } });
        marks.append(dot);
        while (marks.children.length > 7) marks.firstChild.remove();
    }

    /** Fly along the segments (each eased, with its own arc), then call done. */
    function fly(segs, done) {
        let i = 0, from = { ...pos }, t0 = performance.now();
        const step = (now) => {
            if (!court.isConnected) return;
            const seg = segs[i];
            const t = Math.min(1, (now - t0) / seg.ms);
            const e = i === 0 ? t : t * (2 - t);
            pos = { x: from.x + (seg.to.x - from.x) * e, y: from.y + (seg.to.y - from.y) * e };
            height = seg.arc * 4 * t * (1 - t);
            spin += i === 0 ? 9 : 5;
            if (seg.fade) fade = 1 - t;
            draw();
            if (t < 1) { requestAnimationFrame(step); return; }
            seg.onEnd?.();
            i += 1;
            if (i >= segs.length) { done(); return; }
            from = { ...pos }; t0 = now;
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function backToLine() {
        setTimeout(() => {
            pos = { ...START }; height = 0; fade = 0; draw();
            ballEl.animate([{ opacity: 0, transform: ballEl.style.transform + ' scale(.6)' }, { opacity: 1, transform: ballEl.style.transform }],
                { duration: RESET_MS, easing: 'ease-out' });
            fade = 1; draw();
            setTimeout(() => { busy = false; refreshOver(); }, RESET_MS);
        }, 180);
    }

    /** Throw: judged already. Counts and reports once it has come down. */
    function launch(judged, { real }) {
        busy = true;
        // The shooter's follow-through: arms up, for as long as the ball is rising.
        court.dataset.shot = '';
        setTimeout(() => { delete court.dataset.shot; }, 650);
        const { segs, land } = pathOf(judged);
        const sfxOf = (seg) => {
            // A basket as it drops through the net; a miss once it has come down.
            if (!real || !sounds) return;
            if (seg.net) playSound('correct');
        };
        segs.forEach((seg) => {
            seg.onEnd = () => {
                sfxOf(seg);
                if (seg.net) {
                    front.classList.remove('ac-swish'); void front.getBoundingClientRect(); front.classList.add('ac-swish');
                    if (real) { hits += 1; attempts += 1; drawHud(); onScore?.(hits, attempts); }
                    say_(judged, 'good');
                }
            };
        });
        fly(segs, () => {
            if (land) {
                mark(land, false);
                if (real && sounds) playSound('wrong');
                if (real) { attempts += 1; drawHud(); onScore?.(hits, attempts); }
                say_(judged, judged.outcome === 'rim' ? 'near' : 'bad');
            } else {
                mark({ x: RIM.x, y: RIM.y + 0.02 }, true);
            }
            backToLine();
        });
    }

    // ---- the player's throw ----------------------------------------------------
    if (interactive) {
        holdTouch(court);
        let drag = null;
        court.addEventListener('pointerdown', (e) => {
            if (busy || locked || drag || !canThrow()) return;
            e.preventDefault();
            court.setPointerCapture(e.pointerId);
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
            court.dataset.drag = '';
        });
        court.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const W = court.clientWidth, H = court.clientHeight;
            const dx = (e.clientX - drag.x) / W, up = (drag.y - e.clientY) / H;
            // The ball is pulled a little after the finger; the dashed line
            // shows the whole drag, the meter its strength.
            pos = { x: clamp(START.x + dx * 0.35, 0.1, 0.9), y: clamp(START.y - Math.max(0, up) * 0.18, START.y - 0.08, START.y) };
            draw();
            guideLine.setAttribute('x1', String(START.x * 300)); guideLine.setAttribute('y1', String(START.y * 400));
            guideLine.setAttribute('x2', String((START.x + dx) * 300)); guideLine.setAttribute('y2', String((START.y - up) * 400));
            guideLine.setAttribute('opacity', up > 0.02 ? '0.85' : '0');
            showPower(Math.max(0, up));
        });
        const release = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const W = court.clientWidth, H = court.clientHeight;
            const dx = (e.clientX - drag.x) / W, up = (drag.y - e.clientY) / H;
            const ms = performance.now() - drag.t;
            drag = null;
            delete court.dataset.drag;
            guideLine.setAttribute('opacity', '0');
            const judged = e.type === 'pointerup' && canThrow() && !locked ? judgeThrow(dx, up, ms, win) : null;
            if (!judged) { pos = { ...START }; draw(); showPower(0); return; }
            launch(judged, { real: true });
        };
        court.addEventListener('pointerup', release);
        court.addEventListener('pointercancel', release);
    }

    // ---- the demonstration -------------------------------------------------------
    if (auto) {
        // Mostly in, now and then not — so the slide shows both what a basket
        // and what a miss looks like.
        const plays = [
            { dx: 0.01, up: 0.33 }, { dx: -0.03, up: 0.34 }, { dx: 0.0, up: 0.2 },
            { dx: 0.02, up: 0.31 }, { dx: 0.13, up: 0.33 }, { dx: -0.01, up: 0.36 }, { dx: 0.0, up: 0.5 },
        ];
        let n = 0, waits = 0;
        const loop = () => {
            // Not on the page (yet, or any more): wait a little for the first
            // attachment, and stop for good once it has been taken away.
            if (!root.isConnected) { if (n === 0 && ++waits < 25) setTimeout(loop, 400); return; }
            const p = plays[n++ % plays.length];
            // The hand draws the drag first: from the ball, up towards the hoop.
            const W = court.clientWidth, H = court.clientHeight;
            // (its fingertip on the top of the ball, so the whole hand stays on the court)
            hand.style.left = `${START.x * 100}%`; hand.style.top = `${(START.y - 0.075) * 100}%`;
            hand.animate([
                { transform: 'translate(-35%, 0)', opacity: 0 },
                { transform: 'translate(-35%, 0)', opacity: 1, offset: 0.25 },
                { transform: `translate(calc(-35% + ${p.dx * W}px), -${p.up * H}px)`, opacity: 1, offset: 0.85 },
                { transform: `translate(calc(-35% + ${p.dx * W}px), -${p.up * H}px)`, opacity: 0 },
            ], { duration: 900, easing: 'ease-in-out', fill: 'forwards' });
            setTimeout(() => {
                const judged = judgeThrow(p.dx, p.up, 300);
                if (judged && root.isConnected) launch(judged, { real: false });
                setTimeout(loop, 2600);
            }, 760);
        };
        setTimeout(loop, 500);
    }

    function refreshOver() {
        if (!over) return;
        const done = locked || !canThrow();
        over.hidden = !done || busy;
        if (done) over.textContent = `⏱️ הזמן נגמר · ${hits === 1 ? 'קליעה אחת' : `${hits} קליעות`}`;
    }
    if (interactive) {
        const tick = setInterval(() => { if (!root.isConnected) { clearInterval(tick); return; } refreshOver(); }, 250);
    }

    return {
        el: root,
        get hits() { return hits; },
        get attempts() { return attempts; },
        lock() { locked = true; refreshOver(); },
    };
}

/**
 * The reveal: how the room shot — a bar per number of baskets, the player's
 * own bar marked — and the best and the average.
 */
export function actionResults({ values = [], mine = null }) {
    const max = values.length ? Math.max(...values) : 0;
    const counts = Array.from({ length: max + 1 }, (_, k) => values.filter((v) => v === k).length);
    const top = Math.max(1, ...counts);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return h('div', { class: 'ac-res' },
        h('div', { class: 'ac-res-bars', dir: 'ltr' }, counts.map((c, k) => h('div', {
            class: 'ac-res-col', dataset: mine === k ? { mine: '' } : {}, title: `${c} שחקנים קלעו ${k}` },
            h('span', { class: 'ac-res-n', text: c ? String(c) : '' }),
            h('span', { class: 'ac-res-bar', style: { height: `${(c / top) * 100}%`, animationDelay: `${k * 0.05}s` } }),
            h('span', { class: 'ac-res-k', text: String(k) })))),
        h('p', { class: 'ac-res-sum', text: values.length
            ? `הכי הרבה: ${max} קליעות · ממוצע ${avg.toFixed(1)}${mine !== null ? ` · שלך: ${mine}` : ''}`
            : 'אף אחד לא זרק הפעם' }));
}
