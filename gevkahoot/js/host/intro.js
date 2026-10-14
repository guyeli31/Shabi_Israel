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
import { h, safeMedia } from '../ui/dom.js';
import { createAction } from './action.js';
import { circleCutout } from './puzzle.js';

const hand = () => h('span', { class: 'dm-hand', 'aria-hidden': 'true' }, h('span', { text: '👆' }));
const pill = (text) => h('span', { class: 'dm-pill', text });

/** Drag a piece into the frame, then press "done". */
function puzzleDemo() {
    return h('div', { class: 'dm dm-puzzle', 'aria-hidden': 'true' },
        h('div', { class: 'dm-frame' },
            h('span', { class: 'dm-cell', dataset: { c: '1' } }),
            h('span', { class: 'dm-cell', dataset: { c: '2' } }),
            h('span', { class: 'dm-cell', dataset: { c: '3' } }),
            h('span', { class: 'dm-cell dm-cell--empty' })),
        h('span', { class: 'dm-piece' }),
        pill('סיימתי ✓'), hand());
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
    puzzle: { icon: '🧩', name: 'פאזל', demo: puzzleDemo, steps: ['גוררים כל חלק למקומו', 'לוחצים ״סיימתי״'] },
    spot: { icon: '🔎', name: 'זיהוי בתמונה', demo: spotDemo, steps: ['מקישים על האזור הנכון', 'לוחצים ״הזן תשובה״'] },
    complete: { icon: '🖼️', name: 'השלמת תמונה', demo: completeDemo, steps: ['מנסים את האפשרויות על התמונה', 'לוחצים ״הזן תשובה״'] },
    rank: { icon: '🔢', name: 'דירוג', demo: rankDemo, steps: ['גוררים את התשובות לפי הסדר', 'לוחצים ״הזן תשובה״'],
        note: 'רק הסדר המדויק מזכה, ומי שמהיר יותר מרוויח יותר' },
    // The one game that is not right-or-wrong, so the slide says how it scores.
    slider: { icon: '🎚️', name: 'סליידר', demo: sliderDemo, steps: ['מזיזים את הסליידר עד שהעצם בגודל האמיתי', 'לוחצים ״הזן תשובה״'],
        note: 'הניקוד: נקודות המהירות × (1 − הסטייה באחוזים)' },
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
