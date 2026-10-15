/**
 * intro.js — the instruction slide before a picture game.
 *
 * Four coloured answers explain themselves. Dragging jigsaw pieces, tapping a
 * place in a photo, or trying pieces in a gap do not — so each of those opens
 * on a slide that SHOWS what to do: a small looping animation of a hand doing
 * it, and two steps in as few words as possible. The question, and its
 * countdown, start only when the host presses "next".
 *
 * The demonstrations are drawn with plain elements and CSS keyframes
 * (css/host.css, ".dm-…"): no video, no image, nothing to load. They are
 * deliberately generic shapes, not the question's own picture — the slide must
 * not give the picture away before the clock starts.
 */
import { h, svgEl, safeMedia } from '../ui/dom.js';
import { createAction } from './action.js';
import { circleCutout } from './puzzle.js';

const hand = () => h('span', { class: 'dm-hand', 'aria-hidden': 'true' }, h('span', { text: '👆' }));
const pill = (text) => h('span', { class: 'dm-pill', text });

/**
 * A jigsaw piece in a 100×100 cell: each edge flat (0), with a knob out (1)
 * or a socket in (−1). Drawn on a viewBox 20 units larger all round, so a
 * knob may reach into the neighbouring cell as on a real puzzle.
 */
function jigsaw({ top = 0, right = 0, bottom = 0, left = 0 }) {
    const k = 18;
    const d = [
        'M0,0',
        top ? `L35,0 C28,${-k * top} 72,${-k * top} 65,0` : '', 'L100,0',
        right ? `L100,35 C${100 + k * right},28 ${100 + k * right},72 100,65` : '', 'L100,100',
        bottom ? `L65,100 C72,${100 + k * bottom} 28,${100 + k * bottom} 35,100` : '', 'L0,100',
        left ? `L0,65 C${-k * left},72 ${-k * left},28 0,35` : '', 'Z',
    ].join(' ');
    return svgEl('svg', { class: 'dm-jig', viewBox: '-20 -20 140 140' }, svgEl('path', { d }));
}
// The four pieces of a 2×2 puzzle, each knob meeting its neighbour's socket.
const PIECES = [
    { right: 1, bottom: 1 }, { left: -1, bottom: 1 },
    { top: -1, right: 1 }, { top: -1, left: -1 },
];

/** Three jigsaw pieces in place, the fourth dragged home — and the moment it
 *  snaps in, the answer goes by itself: no button to press. */
function puzzleDemo() {
    return h('div', { class: 'dm dm-puzzle', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame' },
            h('span', { class: 'dm-cell', dataset: { c: '1' } }, jigsaw(PIECES[0])),
            h('span', { class: 'dm-cell', dataset: { c: '2' } }, jigsaw(PIECES[1])),
            h('span', { class: 'dm-cell', dataset: { c: '3' } }, jigsaw(PIECES[2])),
            h('span', { class: 'dm-cell dm-cell--empty' }, jigsaw(PIECES[3]))),
        h('span', { class: 'dm-piece' }, jigsaw(PIECES[3])),
        pill('נשלח ✓'), hand());
}

/** Tap one of the outlined places, then press "submit". */
function spotDemo() {
    return h('div', { class: 'dm dm-spot', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame dm-scene' },
            h('span', { class: 'dm-box', dataset: { b: '1' } }),
            h('span', { class: 'dm-box dm-box--pick', dataset: { b: '2' } }),
            h('span', { class: 'dm-box', dataset: { b: '3' } })),
        pill('הזן תשובה'), hand());
}

/** Try the candidates in the gap — too small, too big, just right — then submit. */
function completeDemo() {
    return h('div', { class: 'dm dm-complete', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame dm-scene' }, h('span', { class: 'dm-gap' }), h('span', { class: 'dm-fill' })),
        h('div', { class: 'dm-thumbs' },
            h('span', { class: 'dm-thumb', dataset: { t: '1' } }, h('i')),
            h('span', { class: 'dm-thumb', dataset: { t: '2' } }, h('i')),
            h('span', { class: 'dm-thumb', dataset: { t: '3' } }, h('i'))),
        pill('הזן תשובה'), hand());
}

/** Drag the handle — too small, too big, just right — and only then submit. */
function sliderDemo() {
    return h('div', { class: 'dm dm-slider', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame dm-scene' }, h('span', { class: 'dm-target' }), h('span', { class: 'dm-obj' })),
        h('span', { class: 'dm-rail' }), h('span', { class: 'dm-knob' }),
        pill('הזן תשובה'), hand());
}

/** Drag the bottom card to the top — the others make room — then submit. */
function rankDemo() {
    return h('div', { class: 'dm dm-rank', 'aria-hidden': 'true' },
        h('span', { class: 'dm-word', text: '⬆ הכי' }),
        h('span', { class: 'dm-card', dataset: { c: '1' } }),
        h('span', { class: 'dm-card', dataset: { c: '2' } }),
        h('span', { class: 'dm-card', dataset: { c: '3' } }),
        pill('הזן תשובה'), hand());
}

/** A picture to memorise, its time running out, then covered: the question
 *  comes after it. A generic scene — the real picture must not be seen early. */
function memoryDemo() {
    return h('div', { class: 'dm dm-memory', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame dm-scene' },
            h('span', { class: 'dm-sun' }), h('span', { class: 'dm-house' }), h('span', { class: 'dm-tree' }),
            h('span', { class: 'dm-cover' }, h('span', { text: '?' }))),
        h('span', { class: 'dm-bar' }),
        h('span', { class: 'dm-eyes' }, h('span', { text: '👀' })));
}

/** The action round: the real court, a hand throwing the real ball — the one
 *  exception to "generic shapes": the ball is the circle the puzzle before it
 *  already lifted off its picture, so it gives nothing away, and seeing it
 *  again IS the introduction. */
function actionDemo(item) {
    const image = safeMedia(item.image);
    const ball = item.ball && image ? circleCutout(image, item.ball) : null;
    return h('div', { class: 'dm dm-action', 'aria-hidden': 'true' }, createAction({ ball, auto: true, feedback: item.feedback || {} }).el);
}

const INTROS = {
    puzzle: { icon: '🧩', name: 'פאזל', demo: puzzleDemo, steps: ['גוררים כל חלק למקומו', 'הפאזל השלם נשלח לבד — בלי ללחוץ על כלום'] },
    spot: { icon: '🔎', name: 'זיהוי בתמונה', demo: spotDemo, steps: ['מקישים על האזור הנכון', 'לוחצים ״הזן תשובה״'] },
    complete: { icon: '🖼️', name: 'השלמת תמונה', demo: completeDemo, steps: ['מנסים את האפשרויות על התמונה', 'לוחצים ״הזן תשובה״'] },
    rank: { icon: '🔢', name: 'דירוג', demo: rankDemo, steps: ['גוררים את התשובות לפי הסדר', 'לוחצים ״הזן תשובה״'],
        note: 'רק הסדר המדויק מזכה, ומי שמהיר יותר מרוויח יותר' },
    // The one game that is not right-or-wrong, so the slide says how it scores.
    slider: { icon: '🎚️', name: 'סליידר', demo: sliderDemo, steps: ['מזיזים את הסליידר עד שהעצם בגודל האמיתי', 'לוחצים ״הזן תשובה״'],
        note: 'הניקוד: נקודות המהירות × (1 − הסטייה באחוזים)' },
    // The memory question: the warning the host asked for — what comes next
    // is a picture to MEMORISE, and it will be taken away before the question.
    memory: { icon: '📸', name: 'משחק זיכרון!', demo: memoryDemo,
        steps: (item) => [`תמונה תופיע ל-${item.memo_s || 10} שניות — זכרו את כל הפרטים בה`, 'היא נעלמת, ואז מגיעה שאלה עליה'],
        note: 'שימו לב לכל פרט: צבעים, מספרים, מי עומד איפה' },
    // Not right-or-wrong either, and scored against the room: the slide says so.
    action: { icon: '🏀', name: 'אקשן: קליעות לסל', demo: actionDemo,
        // It runs to the clock, whoever is done: the second step says how long.
        steps: (item) => ['גוררים את הכדור אל הסל ומשחררים — לא חזק מדי ולא חלש מדי', `כמה שיותר סלים ב-${item.time_limit} שניות`],
        note: 'הכי הרבה סלים = ניקוד מלא, הכי מעט = אפס, וכל השאר באמצע' },
};

export const hasIntro = (kind) => kind in INTROS;

/** The slide for one item. `host` adds the reminder that the room is waiting on them. */
export function introSlide(item, { host }) {
    const def = INTROS[item.kind];
    return h('section', { class: 'st-intro' },
        h('div', { class: 'st-intro-head' },
            h('span', { class: 'st-intro-icon', 'aria-hidden': 'true', text: def.icon }),
            h('h1', { class: 'st-heading', text: def.name })),
        def.demo(item),
        h('ol', { class: 'st-steps' }, (typeof def.steps === 'function' ? def.steps(item) : def.steps).map((text, i) => h('li', null,
            h('span', { class: 'st-step-n', text: String(i + 1) }), h('span', { text })))),
        h('p', { class: 'st-intro-note', text: `${def.note || 'מי שמהיר יותר מרוויח יותר'} · ${host ? '״הבא״ מתחיל את השאלה' : 'מיד מתחילים'}` }));
}
