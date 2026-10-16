/**
 * slideMusic.js — the editor's "music on each slide" picker.
 *
 * Every screen of a question (its instruction slide, the get-ready count, the
 * question itself, the reveal, the fastest five, the special slide, the
 * table) and of the quiz's opening (lobby, "starting in…") and closing
 * (podium, matrix) can be given its own music (the host's request) — stored
 * in `slide_music` ({ key: value }) on the item or on the quiz:
 *
 *   (missing)   as the rules say — what that slide plays by default
 *   'none'      silence
 *   'continue'  what the screen before was playing goes on
 *   a path      that file from media/audio/
 *
 * The screens read it in syncMusic() (js/host/stage.js). The SQL CHECKs
 * (gk_items_slide_music, gk_quizzes_slide_music) allow exactly these keys and
 * values.
 */
import { h } from '../ui/dom.js';

export const SLIDE_LABEL = {
    lobby: 'לובי', countdown: 'מתחילים בעוד', podium: 'פודיום', matrix: 'מטריצה',
    intro: 'שקופית הוראות', ready: 'מתכוננים', question: 'השאלה (בזמן המענה)', reveal: 'חשיפת התשובה',
    fastest: 'הכי מהירים', fire: '🔥 שקופית מיוחדת', leaderboard: 'טבלה',
};

/** The preview stage (js/preview/mock.js view) that shows each slide. */
export const SLIDE_VIEW = { question: 'item', fire: 'firstfire' };
export const viewOfSlide = (key) => SLIDE_VIEW[key] || key;
export const slideOfView = (view) => (view === 'item' ? 'question' : view === 'firstfire' || view === 'leadfire' ? 'fire' : view);

/** The slides of an item that have a music of their own. */
export function slidesOf(kind) {
    if (kind === 'interlude' || kind === 'explain') return [];
    const intro = ['puzzle', 'spot', 'complete', 'slider', 'rank', 'action', 'memory'].includes(kind) ? ['intro'] : [];
    return [...intro, 'ready', 'question', 'reveal', 'fastest', 'fire', 'leaderboard'];
}
export const OPENING_SLIDES = ['lobby', 'countdown'];
export const CLOSING_SLIDES = ['podium', 'matrix'];

/** What "as the rules say" plays on a slide — the rules of syncMusic(). */
export function ruleOf(key, kind) {
    const special = kind && !['question', 'memory'].includes(kind);
    switch (key) {
        case 'lobby': case 'countdown': return 'מוסיקת הלובי';
        case 'podium': case 'matrix': return 'מוסיקת הזוכים';
        case 'question': return 'מוסיקת השאלה';
        case 'reveal': return special ? 'מוסיקת השאלה (שאלה מיוחדת)' : 'שקט';
        default: return 'שקט';
    }
}

/**
 * One row per slide: its name (a button that shows it in the previews, when
 * `onShow` is given) and a select. `value` is the slide_music object; it is
 * edited in place and `onChange` is told.
 */
export function slideMusicRows({ keys, kind, value, manifest, onChange, onShow }) {
    const files = (manifest?.audio || []).map((name) => `media/audio/${name}`);
    return h('div', { class: 'if-slides' }, keys.map((key) => {
        const current = value[key] || '';
        const select = h('select', { class: 'dr-select', 'aria-label': `מוסיקה ב${SLIDE_LABEL[key]}`,
            onchange: () => {
                if (select.value) value[key] = select.value; else delete value[key];
                onChange?.(value);
            } },
            h('option', { value: '', text: `רגיל — ${ruleOf(key, kind)}` }),
            h('option', { value: 'none', text: 'בלי מוסיקה' }),
            h('option', { value: 'continue', text: 'המשך את המוסיקה מהשקופית הקודמת' }),
            files.map((path) => h('option', { value: path, text: `🎵 ${path.split('/').pop()}` })),
            current && !['none', 'continue'].includes(current) && !files.includes(current)
                && h('option', { value: current, text: `${current.split('/').pop()} (הקובץ חסר)` }));
        select.value = current;
        return h('div', { class: 'if-slide' },
            onShow
                ? h('button', { class: 'if-slide-name', type: 'button', title: 'הצג את השקופית בתצוגה המקדימה', text: SLIDE_LABEL[key], onclick: () => onShow(key) })
                : h('span', { class: 'if-slide-name', text: SLIDE_LABEL[key] }),
            select);
    }));
}
