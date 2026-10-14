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
import { crest, MARK_SETS, TILES } from '../ui/teams.js';
import { emojiButton, openEmojiPicker } from './emojiPicker.js';
import { openCompleteMaker } from './completeMaker.js';
import { safeMedia } from '../ui/dom.js';
import { scrambleRank } from '../scoring.js';

/** The list of files in gevkahoot/media/, by folder. GitHub Pages has no
 *  directory listing, so the pickers read this generated file instead
 *  (scripts/gevkahoot-media-manifest.mjs). */
export async function loadManifest() {
    const empty = { images: [], videos: [], audio: [], backgrounds: [], sprites: [] };
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
    const isPuzzle = item.kind === 'puzzle';
    const isSpot = item.kind === 'spot';
    const isComplete = item.kind === 'complete';
    const isSlider = item.kind === 'slider';
    const isRank = item.kind === 'rank';
    // The ranking is edited IN ORDER (top place first) and stored scrambled.
    const rankList = isRank
        ? ((item.correct || []).length === (item.options || []).length ? item.correct.map((i) => item.options[i]) : [...(item.options || [])])
        : [];
    const draft = {
        slot: item.slot ? { ...item.slot } : null,
        regions: (item.regions || []).map((r) => ({ ...r })),
        symbols: [...(item.symbols || [])], music: item.music ?? null, anim_sprite: item.anim_sprite ?? null,
        // A question saved before mark sets existed has 'teams' and maybe
        // emojis: those emojis are what it shows, so it opens as 'emoji'.
        marks: item.marks && item.marks !== 'teams' ? item.marks
            : isQuestion && (item.symbols || []).some(Boolean) ? 'emoji' : 'teams',
        circle_x: item.circle_x ?? null, circle_y: item.circle_y ?? null, circle_r: item.circle_r ?? null,
        circle_speed: item.circle_speed ?? 4,
        title: item.title, body: item.body,
        options: (item.options || []).map((o) => (o && typeof o === 'object' ? { ...o } : o)), correct: [...(item.correct || [])],
        weight: item.weight, time_limit_s: item.time_limit_s,
        image: item.image, video: item.video, audio: item.audio,
        media_layout: item.media_layout, music_on: item.music_on, anim_on: item.anim_on,
    };
    const status = h('span', { class: 'dr-note', role: 'status' });
    let timer = null;
    let saving = Promise.resolve();

    /** Save the draft now. Used by the autosave timer and by the Save button. */
    function commit() {
        clearTimeout(timer);
        timer = null;
        saveBtn.toggleAttribute('data-dirty', false);
        {
            if (isQuestion && draft.correct.length === 0) {
                status.textContent = 'סמנו לפחות תשובה נכונה אחת';
                saveBtn.toggleAttribute('data-dirty', true);
                return saving;
            }
            // A spot question is saved as it is drawn; the reminder is shown
            // after the save, not instead of it.
            const reminder = (isSpot && (draft.regions.length < 2 ? 'נשמר — סמנו לפחות שני אזורים' : draft.correct.length === 0 ? 'נשמר — סמנו איזה אזור נכון' : null))
                || (isRank && rankList.some((t) => !t.trim()) && 'נשמר — יש תשובה ריקה')
                || (isComplete && draft.image && (draft.options.length < 2 ? 'נשמר — צריך לפחות שתי אפשרויות' : draft.correct.length === 0 ? 'נשמר — סמנו איזו אפשרות נכונה' : null));
            // Each kind saves only the columns that mean something for it.
            const { circle_x, circle_y, circle_r, circle_speed, regions, symbols, slot, marks, ...common } = draft;
            const playback = { music_on: draft.music_on, music: draft.music, anim_on: draft.anim_on, anim_sprite: draft.anim_sprite };
            const patch = isRank
                ? { title: draft.title, body: draft.body.trim().slice(0, 40), weight: draft.weight, time_limit_s: draft.time_limit_s,
                    ...scrambleRank(rankList.map((t) => t.trim())), symbols: [], marks: marks === 'emoji' ? 'teams' : marks, ...playback }
                : isSlider
                // One cut-out at its real size; the target position is fixed.
                ? { title: draft.title, image: draft.image, slot, weight: draft.weight, time_limit_s: draft.time_limit_s,
                    options: draft.options.slice(0, 1).map((o) => ({ image: o.image, scale: 1 })), correct: [900],
                    symbols: draft.symbols[0] ? [draft.symbols[0]] : [], ...playback }
                : isComplete
                ? { title: draft.title, image: draft.image, slot, weight: draft.weight, time_limit_s: draft.time_limit_s,
                    options: draft.options.map((o) => ({ image: o.image, scale: o.scale })),
                    correct: [...draft.correct].sort((a, b) => a - b), ...playback }
                : isSpot
                ? { title: draft.title, image: draft.image, weight: draft.weight, time_limit_s: draft.time_limit_s,
                    regions: regions.map((r) => ({ ...r })), correct: [...draft.correct].sort((a, b) => a - b), ...playback }
                : isQuestion
                // One symbol slot per answer, '' meaning "the set's emblem" —
                // and emojis are saved only while the set IS emoji.
                ? { ...common, options: [...draft.options], correct: [...draft.correct].sort(), marks,
                    symbols: draft.options.map((_, i) => (marks === 'emoji' && draft.symbols[i]) || '') }
                : isPuzzle
                    ? { title: draft.title, image: draft.image, weight: draft.weight, time_limit_s: draft.time_limit_s,
                        circle_x, circle_y, circle_r, circle_speed, ...playback }
                : { title: draft.title, body: draft.body, image: draft.image, video: draft.video, audio: draft.audio,
                    media_layout: draft.media_layout, ...playback };
            // Chain the saves: the next one starts only when this one settled.
            status.textContent = 'שומר…';
            saving = saving.then(() => onSave(patch))
                .then(() => {
                    const at = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    status.textContent = reminder || `נשמר ✓ ${at}`;
                })
                .catch((err) => { status.textContent = `לא נשמר: ${err.message}`; saveBtn.toggleAttribute('data-dirty', true); });
        }
        return saving;
    }

    /** Something was edited: mark it, and save by itself shortly after the
     *  last keystroke. The Save button does the same thing at once. */
    function changed() {
        status.textContent = 'יש שינויים שלא נשמרו…';
        saveBtn.toggleAttribute('data-dirty', true);
        clearTimeout(timer);
        timer = setTimeout(commit, 450);
    }

    // The explicit Save. Edits are also saved automatically, so this is never
    // the only thing between the host and lost work — it is the answer to "is
    // it saved?": press it and the line beside it says so, with the time.
    const saveBtn = h('button', { class: 'gk-btn gk-btn--small if-save-btn', type: 'button', text: '💾 שמור',
        onclick: () => commit() });
    const saveRow = h('div', { class: 'if-save' }, saveBtn, status);
    // Closing the tab inside the half-second before the autosave would lose the
    // last edit: ask the browser to hold the page while one is pending.
    window.addEventListener('beforeunload', (e) => { if (timer && saveRow.isConnected) { commit(); e.preventDefault(); e.returnValue = ''; } });
    const field = (label, control) => h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: label }), control);
    const set = (key) => (value) => { draft[key] = value; changed(); };

    // ---- options ----------------------------------------------------------
    const optionList = h('div', { class: 'if-options' });
    function drawOptions() {
        clear(optionList);
        const emoji = draft.marks === 'emoji';
        draft.options.forEach((text, i) => {
            optionList.append(h('div', { class: 'if-option', dataset: { tile: TILES[i].key } },
                // The mark on this answer's tile: the set's emblem, or — in the
                // emoji set — one of the author's choice. Click to choose; ↺
                // goes back to the default.
                emoji
                    ? h('button', { class: 'if-swatch gk-tile', type: 'button', dataset: { tile: TILES[i].key, emojiOpener: '' },
                        title: 'הסמל על האריח — לחצו כדי לבחור אימוג׳י',
                        onclick: (e) => openEmojiPicker(e.currentTarget, (picked) => { draft.symbols[i] = picked; drawOptions(); changed(); }) },
                        crest(i, draft.symbols[i] || null))
                    : h('span', { class: 'if-swatch gk-tile', dataset: { tile: TILES[i].key } }, crest(i, null, draft.marks)),
                emoji && draft.symbols[i] && h('button', { class: 'dr-icon', type: 'button', title: 'בלי אימוג׳י', text: '↺',
                    onclick: () => { draft.symbols[i] = ''; drawOptions(); changed(); } }),
                emojiButton(h('input', { class: 'dr-input', type: 'text', maxlength: '120', value: text, dir: 'auto',
                    placeholder: `תשובה ${i + 1}`, 'aria-label': `תשובה ${i + 1}`,
                    oninput: (e) => { draft.options[i] = e.target.value; changed(); } })),
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
                        draft.symbols.splice(i, 1);
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

    // ---- the marks on the tiles: one set per question -----------------------
    // Ranking has no per-answer emoji picker, so it is offered the image sets only.
    const markSets = MARK_SETS.filter((m) => isQuestion || m.key !== 'emoji');
    const marksSeg = h('div', { class: 'if-seg if-seg--words', role: 'radiogroup', 'aria-label': 'סמלים על האריחים' },
        markSets.map((m) => h('button', { type: 'button', class: 'if-seg-btn', text: m.label,
            dataset: draft.marks === m.key ? { on: '' } : {},
            onclick: (e) => {
                draft.marks = m.key;
                for (const b of marksSeg.children) b.toggleAttribute('data-on', b === e.currentTarget);
                if (isQuestion) drawOptions(); else drawMarksPreview();
                changed();
            } })));
    // A question shows the marks on its answers' swatches. A ranking's editor
    // list has no tiles, so it gets this strip of the five instead.
    const marksPreview = h('div', { class: 'if-marks-preview', 'aria-hidden': 'true' });
    function drawMarksPreview() {
        clear(marksPreview);
        TILES.forEach((t, i) => marksPreview.append(
            h('span', { class: 'if-swatch gk-tile', dataset: { tile: t.key } }, crest(i, null, draft.marks))));
    }
    if (isRank) drawMarksPreview();
    const marksField = h('div', { class: 'if-field' },
        h('span', { class: 'if-label', text: 'סמלים על האריחים' }), marksSeg, isRank && marksPreview);

    if (isQuestion) drawOptions();

    // ---- the puzzle's picture, and the round detail that bounces afterwards --
    const circleBox = h('div', { class: 'if-circle' });
    function drawCircle() {
        clear(circleBox);
        if (!draft.image) {
            circleBox.append(h('p', { class: 'dr-note', text: 'בחרו קודם תמונה לפאזל.' }));
            return;
        }
        const ring = h('div', { class: 'if-circle-ring', hidden: draft.circle_r === null });
        const img = h('img', { class: 'if-circle-img', src: draft.image, alt: '', draggable: 'false' });
        const stage = h('div', { class: 'if-circle-stage', title: 'לחצו על התמונה כדי למקם את העיגול' }, img, ring);
        const radius = h('input', { type: 'range', class: 'ed-range', min: '3', max: '50', step: '1',
            value: String(Math.round((draft.circle_r ?? 0.18) * 100)), 'aria-label': 'גודל העיגול' });
        // The ring is drawn in the picture's own proportions: the radius is a
        // fraction of its SHORTER side, exactly as the stage will cut it.
        const place = () => {
            ring.hidden = draft.circle_r === null;
            if (ring.hidden) return;
            const w = img.clientWidth, hgt = img.clientHeight;
            const r = draft.circle_r * Math.min(w, hgt);
            ring.style.width = ring.style.height = `${r * 2}px`;
            ring.style.transform = `translate(${draft.circle_x * w - r}px, ${draft.circle_y * hgt - r}px)`;
        };
        const move = (e) => {
            const box = img.getBoundingClientRect();
            draft.circle_x = +Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)).toFixed(4);
            draft.circle_y = +Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)).toFixed(4);
            if (draft.circle_r === null) draft.circle_r = Number(radius.value) / 100;
            place();
        };
        stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); move(e); stage.dataset.drag = ''; });
        stage.addEventListener('pointermove', (e) => { if ('drag' in stage.dataset) move(e); });
        stage.addEventListener('pointerup', () => { if ('drag' in stage.dataset) { delete stage.dataset.drag; changed(); } });
        radius.addEventListener('input', () => {
            draft.circle_r = Number(radius.value) / 100;
            if (draft.circle_x === null) { draft.circle_x = 0.5; draft.circle_y = 0.5; }
            place();
        });
        radius.addEventListener('change', changed);
        // How fast the detail bounces once it is free of the picture.
        const speed = h('input', { type: 'range', class: 'ed-range', min: '1', max: '10', step: '1',
            value: String(draft.circle_speed), 'aria-label': 'מהירות הקפיצה',
            onchange: (e) => set('circle_speed')(Number(e.target.value)) });
        img.addEventListener('load', place);
        new ResizeObserver(place).observe(img);
        circleBox.append(stage,
            h('div', { class: 'if-pair' },
                h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'גודל העיגול' }), radius),
                h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'מהירות הקפיצה' }), speed)),
            h('button', { class: 'gk-btn gk-btn--ghost gk-btn--small', type: 'button', text: 'בלי עיגול קופץ',
                onclick: () => { draft.circle_x = draft.circle_y = draft.circle_r = null; place(); changed(); } }),
            h('p', { class: 'dr-note', text: 'לחצו על התמונה כדי לבחור איזה חלק עגול ממנה יקפוץ על המסך אחרי שכולם סיימו: שאר התמונה נמוג, והעיגול — בגודלו המקורי — משתחרר וקופץ.' }));
    }
    if (isPuzzle) drawCircle();

    const weightAndTime = h('div', { class: 'if-pair' },
        h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'משקל' }), weights),
        field('זמן (שניות)',
            h('input', { class: 'dr-input', type: 'number', min: '5', max: '300', value: String(draft.time_limit_s),
                onchange: (e) => {
                    const n = Math.min(300, Math.max(5, Math.round(Number(e.target.value) || 20)));
                    e.target.value = String(n);
                    set('time_limit_s')(n);
                } })));
    /**
     * "What plays in THIS element": the quiz's own choice, nothing, or one
     * specific file. Three states in two columns — `<x>_on = false` is
     * "nothing", a path is "this one", and neither is "as the quiz".
     */
    function playbackSelect(folder, onKey, pathKey, labels) {
        const paths = (manifest[folder] || []).map((name) => `media/${folder}/${name}`);
        const current = draft[onKey] === false ? '__none' : draft[pathKey] || '';
        const select = h('select', { class: 'dr-select', onchange: () => {
            draft[onKey] = select.value !== '__none';
            draft[pathKey] = select.value && select.value !== '__none' ? select.value : null;
            changed();
        } },
        h('option', { value: '', text: labels.inherit }),
        h('option', { value: '__none', text: labels.none }),
        paths.map((path) => h('option', { value: path, text: path.split('/').pop() })),
        current && current !== '__none' && !paths.includes(current) && h('option', { value: current, text: `${current.split('/').pop()} (הקובץ חסר)` }));
        select.value = current;
        return select;
    }
    const toggles = h('div', { class: 'if-pair' },
        field('מוסיקת רקע באלמנט הזה', playbackSelect('audio', 'music_on', 'music', { inherit: 'כמו בחידון', none: 'בלי מוסיקה' })),
        field('אנימציה באלמנט הזה', playbackSelect('sprites', 'anim_on', 'anim_sprite', { inherit: 'כמו בחידון', none: 'בלי אנימציה' })));

    // ---- "spot it": rectangles drawn on the picture ------------------------
    const MAX_REGIONS = 12;
    const spotBox = h('div', { class: 'if-circle' });
    function drawSpot() {
        clear(spotBox);
        if (!draft.image) {
            spotBox.append(h('p', { class: 'dr-note', text: 'בחרו קודם תמונה.' }));
            return;
        }
        const img = h('img', { class: 'if-circle-img', src: draft.image, alt: '', draggable: 'false' });
        const layer = h('div', { class: 'if-spot-layer' });
        const stage = h('div', { class: 'if-circle-stage if-spot-stage', title: 'גררו על התמונה כדי לסמן אזור' }, img, layer);
        const list = h('div', { class: 'if-options' });
        const round = (n) => +n.toFixed(4);

        function paint(ghost) {
            clear(layer);
            [...draft.regions, ...(ghost ? [ghost] : [])].forEach((r, i) => {
                const isGhost = ghost && i === draft.regions.length;
                const el = h('div', { class: 'if-spot-rect', dataset: isGhost ? { ghost: '' } : { correct: String(draft.correct.includes(i)) } },
                    !isGhost && h('span', { class: 'sp-num', text: String(i + 1) }));
                el.style.left = `${r.x * 100}%`; el.style.top = `${r.y * 100}%`;
                el.style.width = `${r.w * 100}%`; el.style.height = `${r.h * 100}%`;
                layer.append(el);
            });
        }
        function rows() {
            clear(list);
            draft.regions.forEach((_, i) => {
                list.append(h('div', { class: 'if-option' },
                    h('span', { class: 'if-spot-tag', text: `אזור ${i + 1}` }),
                    h('label', { class: 'if-correct' },
                        h('input', { type: 'checkbox', checked: draft.correct.includes(i), onchange: (e) => {
                            draft.correct = e.target.checked ? [...new Set([...draft.correct, i])] : draft.correct.filter((c) => c !== i);
                            paint(); changed();
                        } }),
                        'תשובה נכונה'),
                    h('button', { class: 'dr-icon', type: 'button', title: 'מחק אזור', text: '✕', onclick: () => {
                        draft.regions.splice(i, 1);
                        // Indexes above the removed region shift down by one.
                        draft.correct = draft.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
                        paint(); rows(); changed();
                    } })));
            });
            if (!draft.regions.length) list.append(h('p', { class: 'dr-note', text: 'עדיין לא סומנו אזורים.' }));
        }

        // Drag on the picture = a new rectangle, from the press to the release.
        let from = null;
        const at = (e) => {
            const box = img.getBoundingClientRect();
            return [Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))];
        };
        const rect = (a, b) => ({ x: round(Math.min(a[0], b[0])), y: round(Math.min(a[1], b[1])), w: round(Math.abs(a[0] - b[0])), h: round(Math.abs(a[1] - b[1])) });
        stage.addEventListener('pointerdown', (e) => {
            if (draft.regions.length >= MAX_REGIONS) return;
            stage.setPointerCapture(e.pointerId);
            from = at(e);
        });
        stage.addEventListener('pointermove', (e) => { if (from) paint(rect(from, at(e))); });
        stage.addEventListener('pointerup', (e) => {
            if (!from) return;
            const r = rect(from, at(e));
            from = null;
            // A click, or a sliver, is not a region.
            if (r.w >= 0.03 && r.h >= 0.03) { draft.regions.push(r); rows(); changed(); }
            paint();
        });
        stage.addEventListener('pointercancel', () => { from = null; paint(); });

        paint(); rows();
        spotBox.append(stage,
            h('p', { class: 'dr-note', text: `גררו על התמונה כדי לסמן אזור (עד ${MAX_REGIONS}). השחקנים יראו את כל המסגרות ויבחרו אחת — סמנו אילו מהן נכונות.` }),
            list);
    }
    if (isSpot) drawSpot();

    // ---- "complete the picture": the gap picture and its candidate pieces ----
    const completeBox = h('div', { class: 'if-circle' });
    function drawComplete() {
        clear(completeBox);
        const make = h('button', { class: 'gk-btn gk-btn--small', type: 'button',
            text: draft.image ? '✂ החלפת התמונה / העצם…' : '✂ בחירת תמונה והוצאת עצם ממנה…',
            onclick: () => openCompleteMaker({ onSaved: ({ image, piece, slot }) => {
                // A fresh question from the new cut: the same object at four
                // sizes, in a mixed order, with the true size marked right.
                draft.image = image; draft.slot = slot;
                draft.options = [0.7, 1.3, 1, 0.85].map((scale) => ({ image: piece, scale }));
                draft.correct = [2];
                drawComplete(); changed();
            } }) });
        if (!draft.image || !draft.slot) {
            completeBox.append(make, h('p', { class: 'dr-note', text: 'מעלים תמונה, מקיפים בה עצם אחד, והוא יוצא ממנה: התמונה נשמרת בלעדיו, והעצם הופך לאפשרויות הבחירה בגדלים שונים.' }));
            return;
        }
        const gap = h('div', { class: 'if-spot-rect', dataset: { ghost: '' } });
        gap.style.left = `${draft.slot.x * 100}%`; gap.style.top = `${draft.slot.y * 100}%`;
        gap.style.width = `${draft.slot.w * 100}%`; gap.style.height = `${draft.slot.h * 100}%`;
        const sprites = (manifest.sprites || []).map((name) => `media/sprites/${name}`);
        const list = h('div', { class: 'if-options' });
        function rows() {
            clear(list);
            draft.options.forEach((opt, i) => {
                const src = safeMedia(opt.image);
                const pieceSelect = h('select', { class: 'dr-select if-piece', 'aria-label': 'תמונת האפשרות', onchange: () => { opt.image = pieceSelect.value; rows(); changed(); } },
                    [...new Set([opt.image, ...sprites])].filter(Boolean).map((path) => h('option', { value: path, text: path.split('/').pop() })));
                pieceSelect.value = opt.image;
                list.append(h('div', { class: 'if-option' },
                    h('span', { class: 'if-swatch if-swatch--piece gk-tile', dataset: { tile: TILES[i].key } }, src && h('img', { src, alt: '' })),
                    h('label', { class: 'if-scale' },
                        h('input', { class: 'dr-input', type: 'number', min: '15', max: '400', step: '5', value: String(Math.round(opt.scale * 100)), 'aria-label': 'גודל באחוזים',
                            onchange: (e) => {
                                const n = Math.min(400, Math.max(15, Math.round(Number(e.target.value) || 100)));
                                e.target.value = String(n); opt.scale = n / 100; changed();
                            } }),
                        '%'),
                    pieceSelect,
                    h('label', { class: 'if-correct' },
                        h('input', { type: 'checkbox', checked: draft.correct.includes(i), onchange: (e) => {
                            draft.correct = e.target.checked ? [...new Set([...draft.correct, i])] : draft.correct.filter((c) => c !== i);
                            changed();
                        } }),
                        'נכונה'),
                    draft.options.length > 2 && h('button', { class: 'dr-icon', type: 'button', title: 'מחק אפשרות', text: '✕', onclick: () => {
                        draft.options.splice(i, 1);
                        draft.correct = draft.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
                        rows(); changed();
                    } })));
            });
            if (draft.options.length < 5) {
                list.append(h('button', { class: 'gk-btn gk-btn--ghost gk-btn--small', type: 'button', text: '+ אפשרות',
                    onclick: () => { draft.options.push({ image: draft.options[0]?.image || sprites[0], scale: 1 }); rows(); changed(); } }));
            }
        }
        rows();
        completeBox.append(
            h('div', { class: 'if-circle-stage if-spot-stage' }, h('img', { class: 'if-circle-img', src: draft.image, alt: '', draggable: 'false' }), h('div', { class: 'if-spot-layer' }, gap)),
            make,
            h('span', { class: 'if-label', text: 'האפשרויות — 100% הוא הגודל האמיתי של העצם; לכל אפשרות תמונה וגודל משלה' }),
            list);
    }
    // ---- the slider: one cut-out, and an optional emoji on the handle --------
    const sliderBox = h('div', { class: 'if-circle' });
    function drawSlider() {
        clear(sliderBox);
        const make = h('button', { class: 'gk-btn gk-btn--small', type: 'button',
            text: draft.image ? '✂ החלפת התמונה / העצם…' : '✂ בחירת תמונה והוצאת עצם ממנה…',
            onclick: () => openCompleteMaker({ title: 'סליידר — הוצאת עצם מהתמונה', onSaved: ({ image, piece, slot }) => {
                draft.image = image; draft.slot = slot;
                draft.options = [{ image: piece, scale: 1 }];
                drawSlider(); changed();
            } }) });
        const emoji = h('div', { class: 'if-pair' },
            h('button', { class: 'if-swatch gk-tile', type: 'button', dataset: { tile: TILES[0].key, emojiOpener: '' },
                title: 'אימוג׳י על ידית הסליידר — גדל וקטן באותו יחס כמו העצם',
                onclick: (e) => openEmojiPicker(e.currentTarget, (picked) => { draft.symbols = [picked]; drawSlider(); changed(); }) },
                draft.symbols[0] ? crest(0, draft.symbols[0]) : h('span', { text: '🙂+' })),
            draft.symbols[0] && h('button', { class: 'dr-icon', type: 'button', title: 'בלי אימוג׳י (ידית רגילה)', text: '↺',
                onclick: () => { draft.symbols = []; drawSlider(); changed(); } }),
            h('span', { class: 'dr-note', text: draft.symbols[0] ? 'האימוג׳י רוכב על הידית וגדל וקטן באותו יחס כמו העצם.' : 'אפשר לבחור אימוג׳י שירכב על ידית הסליידר.' }));
        if (!draft.image || !draft.slot || !draft.options[0]) {
            sliderBox.append(make, h('p', { class: 'dr-note', text: 'מעלים תמונה ומקיפים בה עצם אחד. העצם יוצא ממנה, והשחקנים מגדילים ומקטינים אותו במקומו עם סליידר עד שהוא בגודל האמיתי.' }), emoji);
            return;
        }
        const gap = h('div', { class: 'if-spot-rect', dataset: { ghost: '' } });
        gap.style.left = `${draft.slot.x * 100}%`; gap.style.top = `${draft.slot.y * 100}%`;
        gap.style.width = `${draft.slot.w * 100}%`; gap.style.height = `${draft.slot.h * 100}%`;
        const src = safeMedia(draft.options[0].image);
        sliderBox.append(
            h('div', { class: 'if-circle-stage if-spot-stage' }, h('img', { class: 'if-circle-img', src: draft.image, alt: '', draggable: 'false' }), h('div', { class: 'if-spot-layer' }, gap)),
            h('div', { class: 'if-pair' }, src && h('span', { class: 'if-swatch if-swatch--piece gk-tile', dataset: { tile: TILES[0].key } }, h('img', { src, alt: '' })), make),
            h('p', { class: 'dr-note', text: 'הסליידר מתחיל ב-50%; בקצה השמאלי העצם בשליש משטחו, והגודל האמיתי הוא ב-90%. הניקוד: נקודות המהירות × (1 − הסטייה באחוזים) — סטייה של 10% משאירה 90% מהנקודות. במטריצה התא נצבע מאדום לירוק לפי הסטייה.' }),
            emoji);
    }
    // ---- the ranking: the answers in their right order, top place first ----
    const rankBox = h('div', { class: 'if-options' });
    function drawRank() {
        clear(rankBox);
        rankList.forEach((text, i) => {
            const move = (to) => { rankList.splice(i, 1); rankList.splice(to, 0, text); drawRank(); changed(); };
            rankBox.append(h('div', { class: 'if-option', dataset: { tile: TILES[i].key } },
                h('span', { class: 'if-rank-n', text: String(i + 1) }),
                emojiButton(h('input', { class: 'dr-input', type: 'text', maxlength: '120', value: text, dir: 'auto',
                    placeholder: i === 0 ? 'הכי …' : i === rankList.length - 1 ? 'הכי פחות …' : `מקום ${i + 1}`, 'aria-label': `מקום ${i + 1}`,
                    oninput: (e) => { rankList[i] = e.target.value; changed(); } })),
                i > 0 && h('button', { class: 'dr-icon', type: 'button', title: 'מקום אחד למעלה', text: '↑', onclick: () => move(i - 1) }),
                i < rankList.length - 1 && h('button', { class: 'dr-icon', type: 'button', title: 'מקום אחד למטה', text: '↓', onclick: () => move(i + 1) }),
                rankList.length > 2 && h('button', { class: 'dr-icon', type: 'button', title: 'מחק תשובה', text: '✕',
                    onclick: () => { rankList.splice(i, 1); drawRank(); changed(); } })));
        });
        if (rankList.length < 5) {
            rankBox.append(h('button', { class: 'gk-btn gk-btn--ghost gk-btn--small', type: 'button', text: '+ תשובה',
                onclick: () => { rankList.push(''); drawRank(); changed(); } }));
        }
    }
    if (isRank) {
        drawRank();
        return h('div', { class: 'if' },
            field('השאלה',
                emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                    oninput: (e) => set('title')(e.target.value) }))),
            field('מילת המפתח לדירוג (למשל: מוקדם, גדול)',
                h('input', { class: 'dr-input', type: 'text', maxlength: '40', dir: 'auto', value: draft.body || '',
                    oninput: (e) => set('body')(e.target.value) })),
            h('div', { class: 'if-field' },
                h('span', { class: 'if-label', text: 'התשובות בסדר הנכון — הראשונה היא ה״הכי״, האחרונה ה״הכי פחות״ (2 עד 5). השחקנים יקבלו אותן מעורבבות.' }),
                rankBox),
            marksField, weightAndTime, toggles, saveRow);
    }

    if (isSlider) {
        drawSlider();
        return h('div', { class: 'if' },
            field('השאלה',
                emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                    oninput: (e) => set('title')(e.target.value) }))),
            h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'התמונה והעצם' }), sliderBox),
            weightAndTime, toggles, saveRow);
    }

    if (isComplete) {
        drawComplete();
        return h('div', { class: 'if' },
            field('השאלה',
                emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                    oninput: (e) => set('title')(e.target.value) }))),
            h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'התמונה והעצם החסר' }), completeBox),
            weightAndTime, toggles, saveRow);
    }

    if (isSpot) {
        return h('div', { class: 'if' },
            field('השאלה',
                emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                    oninput: (e) => set('title')(e.target.value) }))),
            field('התמונה',
                mediaSelect(manifest, ['images', 'backgrounds'], draft.image, (v) => {
                    // A new picture: the old rectangles outlined the old one.
                    draft.image = v; draft.regions = []; draft.correct = [];
                    drawSpot(); changed();
                })),
            h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'האזורים לבחירה' }), spotBox),
            weightAndTime, toggles, saveRow);
    }

    if (isPuzzle) {
        return h('div', { class: 'if' },
            field('הכותרת שמעל הפאזל',
                emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                    oninput: (e) => set('title')(e.target.value) }))),
            field('התמונה שתיחתך לחמישה חלקים',
                mediaSelect(manifest, ['images', 'backgrounds'], draft.image, (v) => {
                    // A new picture: the old circle pointed at the old one.
                    draft.image = v; draft.circle_x = draft.circle_y = draft.circle_r = null;
                    drawCircle(); changed();
                })),
            weightAndTime,
            h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'העיגול הקופץ' }), circleBox),
            toggles, saveRow);
    }

    return h('div', { class: 'if' },
        field(isQuestion ? 'השאלה' : 'כותרת',
            emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '300', dir: 'auto', value: draft.title,
                oninput: (e) => set('title')(e.target.value) }))),
        !isQuestion && field('טקסט משני',
            emojiButton(h('textarea', { class: 'dr-input', rows: '2', maxlength: '600', dir: 'auto', value: draft.body,
                oninput: (e) => set('body')(e.target.value) }))),
        isQuestion && marksField,
        isQuestion && h('div', { class: 'if-field' },
            h('span', { class: 'if-label', text: 'תשובות (2 עד 5) — אפשר לסמן יותר מנכונה אחת' }), optionList),
        isQuestion && weightAndTime,
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
        toggles, saveRow);
}
