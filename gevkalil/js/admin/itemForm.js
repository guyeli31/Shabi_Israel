/**
 * itemForm.js — the form for one question or one interlude.
 *
 * Used twice: as the editor's main panel, and inside the host drawer for a
 * correction in the middle of a live quiz. One module, so a field added to a
 * question appears in both without a second form to remember.
 *
 * The form autosaves. It keeps a draft, and every change schedules one save of
 * the whole draft — never a per-field patch, so two quick edits cannot land
 * out of order and leave the row holding the older one.
 */
import { h, clear } from '../ui/dom.js';
import { crest, TILES } from '../ui/teams.js';

/** The list of files in gevkalil/media/, by folder. GitHub Pages has no
 *  directory listing, so the pickers read this generated file instead
 *  (scripts/gevkalil-media-manifest.mjs). */
export async function loadManifest() {
    const empty = { images: [], videos: [], audio: [], backgrounds: [] };
    try {
        const res = await fetch('media/manifest.json', { cache: 'no-store' });
        return res.ok ? { ...empty, ...(await res.json()) } : empty;
    } catch {
        return empty;
    }
}

/** A <select> over one or more media folders. The value is the path as the
 *  database stores it ("media/videos/x.mp4"), or null. */
export function mediaSelect(manifest, folders, value, onChange) {
    const paths = folders.flatMap((folder) => (manifest[folder] || []).map((name) => `media/${folder}/${name}`));
    const select = h('select', { class: 'dr-select', onchange: () => onChange(select.value || null) },
        h('option', { value: '', text: '— ללא —' }),
        paths.map((path) => h('option', { value: path, text: path.split('/').slice(1).join('/') })),
        // A path saved earlier whose file has since been removed: keep it
        // selectable and say so, rather than silently showing "none".
        value && !paths.includes(value) && h('option', { value, text: `${value.split('/').pop()} (הקובץ חסר)` }));
    select.value = value || '';
    return select;
}

const LAYOUTS = [
    ['side', 'לצד הטקסט'],
    ['top', 'מעל הטקסט'],
    ['full', 'לרוחב המסך'],
    ['background', 'כרקע (תמונה בלבד)'],
];

export function itemForm(item, { manifest, onSave }) {
    const isQuestion = item.kind === 'question';
    const draft = {
        title: item.title, body: item.body,
        options: [...(item.options || [])], correct: [...(item.correct || [])],
        weight: item.weight, time_limit_s: item.time_limit_s,
        image: item.image, video: item.video, audio: item.audio,
        media_layout: item.media_layout, music_on: item.music_on,
    };
    const status = h('span', { class: 'dr-note', role: 'status' });
    let timer = null;
    let saving = Promise.resolve();

    function changed() {
        status.textContent = 'שומר…';
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (isQuestion && draft.correct.length === 0) {
                status.textContent = 'סמנו לפחות תשובה נכונה אחת';
                return;
            }
            const patch = isQuestion
                ? { ...draft, options: [...draft.options], correct: [...draft.correct].sort() }
                : { title: draft.title, body: draft.body, image: draft.image, video: draft.video, audio: draft.audio,
                    media_layout: draft.media_layout, music_on: draft.music_on };
            // Chain the saves: the next one starts only when this one settled.
            saving = saving.then(() => onSave(patch))
                .then(() => { status.textContent = 'נשמר ✓'; })
                .catch((err) => { status.textContent = `לא נשמר: ${err.message}`; });
        }, 450);
    }
    const field = (label, control) => h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: label }), control);
    const set = (key) => (value) => { draft[key] = value; changed(); };

    // ---- options ----------------------------------------------------------
    const optionList = h('div', { class: 'if-options' });
    function drawOptions() {
        clear(optionList);
        draft.options.forEach((text, i) => {
            optionList.append(h('div', { class: 'if-option', dataset: { tile: TILES[i].key } },
                h('span', { class: 'if-swatch gk-tile', dataset: { tile: TILES[i].key }, title: TILES[i].label }, crest(i)),
                h('input', { class: 'dr-input', type: 'text', maxlength: '120', value: text, dir: 'auto',
                    placeholder: `תשובה ${i + 1}`, 'aria-label': `תשובה ${i + 1}`,
                    oninput: (e) => { draft.options[i] = e.target.value; changed(); } }),
                h('label', { class: 'if-correct' },
                    h('input', { type: 'checkbox', checked: draft.correct.includes(i),
                        onchange: (e) => {
                            draft.correct = e.target.checked
                                ? [...new Set([...draft.correct, i])]
                                : draft.correct.filter((c) => c !== i);
                            changed();
                        } }),
                    'נכונה'),
                draft.options.length > 2 && h('button', { class: 'dr-icon', type: 'button', title: 'מחק תשובה', text: '✕',
                    onclick: () => {
                        draft.options.splice(i, 1);
                        // Indexes above the removed option shift down by one.
                        draft.correct = draft.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
                        drawOptions(); changed();
                    } })));
        });
        if (draft.options.length < 5) {
            optionList.append(h('button', { class: 'gk-btn gk-btn--ghost gk-btn--small', type: 'button', text: '+ תשובה',
                onclick: () => { draft.options.push(''); drawOptions(); changed(); } }));
        }
    }

    const weights = h('div', { class: 'if-seg', role: 'radiogroup', 'aria-label': 'משקל' },
        [0, 1, 2].map((w) => h('button', { type: 'button', class: 'if-seg-btn', text: `×${w}`,
            dataset: draft.weight === w ? { on: '' } : {},
            onclick: (e) => {
                draft.weight = w;
                for (const b of weights.children) b.toggleAttribute('data-on', b === e.currentTarget);
                changed();
            } })));

    if (isQuestion) drawOptions();

    return h('div', { class: 'if' },
        field(isQuestion ? 'השאלה' : 'כותרת',
            h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                oninput: (e) => set('title')(e.target.value) })),
        !isQuestion && field('טקסט משני',
            h('textarea', { class: 'dr-input', rows: '2', maxlength: '600', dir: 'auto', value: draft.body,
                oninput: (e) => set('body')(e.target.value) })),
        isQuestion && h('div', { class: 'if-field' },
            h('span', { class: 'if-label', text: 'תשובות (2 עד 5) — אפשר לסמן יותר מנכונה אחת' }), optionList),
        isQuestion && h('div', { class: 'if-pair' },
            h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'משקל' }), weights),
            field('זמן (שניות)',
                h('input', { class: 'dr-input', type: 'number', min: '5', max: '300', value: String(draft.time_limit_s),
                    onchange: (e) => {
                        const n = Math.min(300, Math.max(5, Math.round(Number(e.target.value) || 20)));
                        e.target.value = String(n);
                        set('time_limit_s')(n);
                    } }))),
        h('div', { class: 'if-pair' },
            field('תמונה', mediaSelect(manifest, ['images', 'backgrounds'], draft.image, set('image'))),
            field('וידאו', mediaSelect(manifest, ['videos'], draft.video, set('video')))),
        h('div', { class: 'if-pair' },
            field('קטע אודיו', mediaSelect(manifest, ['audio'], draft.audio, set('audio'))),
            field('מיקום המדיה', (() => {
                const select = h('select', { class: 'dr-select', onchange: () => set('media_layout')(select.value) },
                    LAYOUTS.map(([value, text]) => h('option', { value, text })));
                select.value = draft.media_layout;
                return select;
            })())),
        h('label', { class: 'if-check' },
            h('input', { type: 'checkbox', checked: draft.music_on, onchange: (e) => set('music_on')(e.target.checked) }),
            'מוסיקת הרקע של החידון מתנגנת בפריט הזה'),
        status);
}
