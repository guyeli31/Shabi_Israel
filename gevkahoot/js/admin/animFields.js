/**
 * animFields.js — one element's bouncing animation, as the editor sets it.
 *
 * Every element of a quiz carries its own animation (the host's request): a
 * question, an interlude, an "answer explained" segment, and the quiz's
 * opening and closing. One checkbox — "add an animation to this element" —
 * and only when it is ticked: the picture, how many, how big, how fast, and
 * in front of the text or behind it.
 *
 * The block does not know where the values live: `get(key)` reads one and
 * `set(patch)` writes some, keys on / sprite / count / size / speed / front.
 * The item form maps them to its draft (saved by its Save button), the
 * opening and closing to the quiz's columns (saved at once).
 */
import { h, clear } from '../ui/dom.js';
import { BUILTIN_ANIMS } from '../host/bouncers.js';

const RANGES = { count: [1, 30, ''], size: [3, 40, '%'], speed: [1, 10, ''] };
const LABELS = { count: 'כמות במקביל', size: 'גודל', speed: 'מהירות' };

export function animFields({ get, set, manifest, onCutter = null, label = 'הוסף אנימציה לאלמנט הזה', emptyNote = 'בלי דמות לא תופיע אנימציה.' }) {
    const box = h('div', { class: 'if-anim' });
    function draw() {
        clear(box);
        const on = !!get('on');
        box.append(h('label', { class: 'if-check' },
            h('input', { type: 'checkbox', checked: on, onchange: (e) => { set({ on: e.target.checked }); draw(); } }),
            label));
        if (!on) return;
        const sprites = (manifest?.sprites || []).map((name) => `media/sprites/${name}`);
        const current = get('sprite') || '';
        const select = h('select', { class: 'dr-select', 'aria-label': 'הדמות', onchange: () => set({ sprite: select.value || null }) },
            h('option', { value: '', text: '— בחרו דמות —' }),
            Object.entries(BUILTIN_ANIMS).map(([value, b]) => h('option', { value, text: b.label })),
            sprites.map((path) => h('option', { value: path, text: path.split('/').pop() })),
            current && !sprites.includes(current) && !BUILTIN_ANIMS[current] && h('option', { value: current, text: `${current.split('/').pop()} (הקובץ חסר)` }));
        select.value = current;
        const slider = (key) => {
            const [min, max, unit] = RANGES[key];
            const value = get(key) ?? min;
            const out = h('span', { class: 'ed-range-value', dir: 'ltr', text: `${value}${unit}` });
            return h('label', { class: 'if-field' }, h('span', { class: 'if-label' }, LABELS[key], ' ', out),
                h('input', { type: 'range', class: 'ed-range', min: String(min), max: String(max), step: '1', value: String(value),
                    // the number follows the thumb; the value is written when it is let go
                    oninput: (e) => { out.textContent = `${e.target.value}${unit}`; },
                    onchange: (e) => set({ [key]: Number(e.target.value) }) }));
        };
        box.append(
            h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'הדמות' }), select),
            onCutter && h('div', { class: 'dr-row' },
                h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: '✂ יצירת דמות מתמונה…',
                    onclick: () => onCutter((path) => { set({ sprite: path, on: true }); draw(); }) })),
            slider('count'), slider('size'), slider('speed'),
            h('label', { class: 'if-check' },
                h('input', { type: 'checkbox', checked: !!get('front'), onchange: (e) => set({ front: e.target.checked }) }),
                'מעל התוכן (ברירת המחדל: מאחורי הטקסט)'),
            !current && h('p', { class: 'dr-note', text: emptyNote }));
    }
    draw();
    return box;
}
