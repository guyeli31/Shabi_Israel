/**
 * gkEditor.js — editor.html, the quiz editor (opened from tools/).
 *
 * A side menu — the quiz's running order between its OPENING (lobby,
 * "starting in…", the quiz's settings) and its CLOSING (podium, matrix),
 * collapsible, open by default — then the form for what is selected, and two
 * live previews — the projected screen in a desktop frame and the
 * player's phone in a phone frame — showing the item being edited at any stage
 * of a quiz. The previews are the real pages (see js/preview/mock.js).
 *
 * Everything is saved to Supabase as it is edited; RLS admits allowlisted
 * admins only, so the editor works identically on localhost and on the live
 * site. If the quiz being edited is on air, an edit is pushed to the screens
 * as well.
 */
import { h, clear } from './ui/dom.js';
import * as api from './data/api.js';
import { itemForm, keptForm, leaveForms, loadManifest, mediaSelect } from './admin/itemForm.js';
import { mock, VIEWS, viewsFor } from './preview/mock.js';
import { openSpriteCutter } from './admin/spriteCutter.js';
import { OPENING_SLIDES, CLOSING_SLIDES, slideMusicRows, viewOfSlide } from './admin/slideMusic.js';
import { animFields } from './admin/animFields.js';

const root = document.getElementById('app');
const THEMES = [['stadium', 'אצטדיון'], ['candy', 'ממתק'], ['night', 'לילה']];

let quizzes = [];
let quiz = null;
let items = [];
let selectedId = null;
let manifest = null;
let view = 'item';
let notice = '';
let quizSavedAt = null;   // when a quiz setting last saved (shown on the opening / closing)
let quizNote = '';        // the top Save's answer there

/** `items` holds the running order: the stops of the quiz. A question's
 *  "answer explained" segment is not a stop — it hangs off its question as
 *  `item.explain` — so every lookup by id has to look in both places. */
const everyItem = () => items.flatMap((i) => (i.explain ? [i, i.explain] : [i]));
const selected = () => everyItem().find((i) => i.id === selectedId) || null;
// Besides an item, the menu can select the quiz's opening or its closing.
const OPENING = 'opening', CLOSING = 'closing';
let sideOpen = true;   // the side menu, open by default
try { sideOpen = localStorage.getItem('gevkahoot:editor-side') !== 'closed'; } catch { /* convenience only */ }
const parentOf = (child) => items.find((i) => i.explain === child) || null;

// ---- previews -------------------------------------------------------------
const frames = [
    { key: 'desk', label: 'המסך המוקרן (דסקטופ)', src: 'host.html?preview', w: 1280, h: 720 },
    { key: 'phone', label: 'מסך השחקן (מובייל)', src: 'index.html?preview', w: 430, h: 739 },
].map((def) => {
    const iframe = h('iframe', { src: def.src, title: def.label, width: String(def.w), height: String(def.h), tabindex: '-1' });
    const box = h('div', { class: `ed-frame ed-frame--${def.key}` }, iframe);
    // The frame is laid out at its true device size and scaled down to fit, so
    // what is previewed is the real layout at 1280×720 / 430×739 — not a
    // narrower window's reflow of it.
    new ResizeObserver(() => {
        const k = box.clientWidth / def.w;
        iframe.style.transform = `scale(${k})`;
        box.style.height = `${def.h * k}px`;
    }).observe(box);
    return { ...def, iframe, box, ready: false };
});

window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'gk-preview-ready') return;
    const frame = frames.find((f) => f.iframe.contentWindow === event.source);
    if (frame) { frame.ready = true; pushPreview(); }
});

function pushPreview() {
    if (!quiz) return;
    const payload = mock(view, quiz, selected(), items);
    for (const frame of frames) {
        if (frame.ready) frame.iframe.contentWindow.postMessage({ type: 'gk-preview', ...payload }, location.origin);
    }
}

/** An edit to a quiz that is on air should reach the screens. When it is not
 *  on air this is a no-op on the server; when the caller is offline it is one
 *  failed request that does not matter. */
const pushLive = () => api.admin.refresh().catch(() => {});

// ---- data -----------------------------------------------------------------
async function loadQuizzes(keepId) {
    quizzes = await api.quizzes.list();
    await selectQuiz(quizzes.find((q) => q.id === keepId) || quizzes[0] || null);
}

async function selectQuiz(next) {
    quiz = next;
    const rows = quiz ? await api.items.list(quiz.id) : [];
    items = rows.filter((r) => !r.parent_id);
    for (const it of items) it.explain = rows.find((r) => r.parent_id === it.id) || null;
    selectedId = items[0]?.id || OPENING;
    try { localStorage.setItem('gevkahoot:editor-quiz', quiz?.id || ''); } catch { /* convenience only */ }
    quizSavedAt = null; quizNote = '';     // another quiz: its own saves from here
    draw();
}

async function act(fn) {
    notice = '';
    try { await fn(); } catch (err) { notice = `הפעולה נכשלה: ${err.message}`; }
    draw();
}

async function saveQuiz(patch) {
    Object.assign(quiz, await api.quizzes.update(quiz.id, patch));
    quizSavedAt = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    quizNote = '';
    pushPreview(); pushLive();
}

async function addItem(kind) {
    if (!leaveForms()) return;   // the new item's form replaces the one on screen
    const position = (items.at(-1)?.position || 0) + 1;
    const row = {
        question: { quiz_id: quiz.id, position, kind, title: '', options: ['', ''], correct: [0] },
        // A puzzle's only answer is "done" (option 0); it gets longer on the clock.
        puzzle: { quiz_id: quiz.id, position, kind, title: 'הרכיבו את התמונה', correct: [0], time_limit_s: 45 },
        // The answers are rectangles drawn on a picture; none exist yet.
        spot: { quiz_id: quiz.id, position, kind, title: 'זהו את הדמות', regions: [], correct: [] },
        // The gap and the candidate pieces are made in the form, from a picture.
        complete: { quiz_id: quiz.id, position, kind, title: 'מה משלים את התמונה?', options: [], correct: [] },
        // One cut-out, sized by the player; the target is always 70% (CHECK).
        slider: { quiz_id: quiz.id, position, kind, title: 'באיזה גודל העצם באמת?', options: [], correct: [700] },
        // Four blank answers already in "order"; the form scrambles them on save.
        rank: { quiz_id: quiz.id, position, kind, title: 'סדרו מהמוקדם למאוחר', body: 'מוקדם', options: ['', '', '', ''], correct: [0, 1, 2, 3] },
        // A picture to memorise, then an ordinary question about it.
        memory: { quiz_id: quiz.id, position, kind, title: '', options: ['', ''], correct: [0], memo_s: 10 },
        // The answer is a number 0-36 on the table; 0 until the host picks one.
        roulette: { quiz_id: quiz.id, position, kind, title: '', correct: [0] },
        // Free throws. The ball is a round detail of a picture — by default the
        // one the nearest puzzle before it lifts off its picture, so the round
        // follows on from it; the form can pick another.
        action: { quiz_id: quiz.id, position, kind, title: 'כמה סלים תקלעו?', options: [], correct: [], time_limit_s: 30,
            // a few lines to start from; the author rewrites them in the form
            feedback: { hit: ['יש! 🔥', 'סל! 🏀', 'איזה יד!'], miss: ['אוף, כמעט 😬', 'לא נורא, עוד ניסיון!'] },
            ...(() => {
                const p = [...items].reverse().find((i) => i.kind === 'puzzle' && i.image && i.circle_r);
                return p ? { image: p.image, circle_x: p.circle_x, circle_y: p.circle_y, circle_r: p.circle_r } : {};
            })() },
        interlude: { quiz_id: quiz.id, position, kind, title: '', media_layout: 'full' },
    }[kind];
    // A new question (any scored kind) starts with no bouncing animation over
    // it — "בלי אנימציה באלמנט הזה" — the host's chosen default; an interlude
    // starts "as the quiz". Either can be changed in the form.
    if (kind !== 'interlude') row.anim_on = false;
    const created = await api.items.create(row);
    created.explain = null;
    items.push(created);
    selectedId = created.id;
}

/** Give a question its "answer explained" segment (it can have one). */
async function addExplain(parent) {
    if (!leaveForms()) return;
    const created = await api.items.create({ quiz_id: quiz.id, position: parent.position, kind: 'explain', parent_id: parent.id, title: '', media_layout: 'side' });
    parent.explain = created;
    selectedId = created.id;
}

async function removeItem(item) {
    const extra = item.explain ? ' (כולל קטע הסבר התשובה שלו)' : '';
    if (!confirm(`למחוק את "${item.title || 'הפריט'}"${extra}?`)) return;
    // Deleting a question deletes its segment with it (ON DELETE CASCADE).
    await api.items.remove(item.id);
    const parent = parentOf(item);
    if (parent) parent.explain = null;
    else items = items.filter((i) => i.id !== item.id);
    if (selectedId === item.id || !selected()) selectedId = parent?.id || items[0]?.id || null;
    pushLive();
}

/** Move the item at `from` so that it lands at `to`. Positions are rewritten
 *  1..n for the whole list — only rows whose number actually changed are
 *  written. A segment keeps its question's position, which is all that ties
 *  it to a place: it has no order of its own. */
async function moveItem(from, to) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    await Promise.all(items.flatMap((it, i) => {
        if (it.position === i + 1) return [];
        it.position = i + 1;
        const writes = [api.items.update(it.id, { position: i + 1 })];
        if (it.explain) { it.explain.position = i + 1; writes.push(api.items.update(it.explain.id, { position: i + 1 })); }
        return writes;
    }));
    pushLive();
}

// ---- view -----------------------------------------------------------------
const btn = (text, onclick, cls = '') => h('button', { class: `gk-btn gk-btn--small ${cls}`, type: 'button', text, onclick });
const panel = (title, ...children) => h('section', { class: 'ed-panel' }, title && h('h2', { text: title }), ...children);

function topBar() {
    const select = h('select', { class: 'dr-select', 'aria-label': 'חידון', onchange: () => { if (leaveForms()) act(() => selectQuiz(quizzes.find((q) => q.id === select.value))); else select.value = quiz?.id || ''; } },
        quizzes.map((q) => h('option', { value: q.id, text: q.title })));
    select.value = quiz?.id || '';
    return h('header', { class: 'ed-top' },
        h('div', { class: 'ed-brand' }, 'Gev', h('b', { text: 'Kahoot' }), h('span', { text: ' · עורך' })),
        quizzes.length > 0 && select,
        btn('+ חידון חדש', () => act(async () => { const q = await api.quizzes.create('חידון חדש'); await loadQuizzes(q.id); })),
        quiz && btn('מחק חידון', () => confirm(`למחוק את החידון "${quiz.title}" וכל הפריטים שבו?`) && act(async () => { await api.quizzes.remove(quiz.id); await loadQuizzes(); }), 'gk-btn--ghost'),
        // Quiz settings save the moment they are changed; the open element's
        // form has its own Save. This one presses it, so there is a Save in
        // reach wherever the page is scrolled to. On the opening and the
        // closing there is no form: everything there is already saved, and
        // the button says so — it used to do nothing at all there, which read
        // as "the closing's animation cannot be saved".
        quiz && btn('💾 שמור', () => {
            const formSave = document.querySelector('.ed .if-save-btn');
            if (formSave) { formSave.click(); return; }
            quizNote = `כל השינויים כאן נשמרים מיד ✓${quizSavedAt ? ` (אחרון: ${quizSavedAt})` : ''}`;
            draw();
        }),
        // The opening's and the closing's settings: the proof that a change landed.
        quiz && (selectedId === OPENING || selectedId === CLOSING) && (quizNote || quizSavedAt)
            && h('span', { class: 'dr-note ed-saved', role: 'status', text: quizNote || `נשמר ✓ ${quizSavedAt}` }),
        h('span', { class: 'ed-spacer' }),
        notice && h('span', { class: 'dr-error', role: 'alert', text: notice }),
        h('a', { class: 'gk-btn gk-btn--small gk-btn--ghost', href: 'host.html', target: '_blank', rel: 'noopener', text: 'מסך המנחה ↗' }),
        h('a', { class: 'gk-btn gk-btn--small gk-btn--ghost', href: './', target: '_blank', rel: 'noopener', text: 'מסך הכניסה ↗' }));
}

/** The music of the quiz's own slides (its opening or its closing). Quiz
 *  settings save as they change, like every other quiz setting. */
function quizSlideMusic(keys) {
    const value = { ...(quiz.slide_music || {}) };
    return h('details', { class: 'if-details', open: true }, h('summary', { text: 'מוסיקה לכל שקופית' }),
        slideMusicRows({ keys, value, manifest, onChange: (v) => act(() => saveQuiz({ slide_music: v })),
            onShow: (key) => showSlide(key) }));
}

/** The opening: the quiz's settings, its lobby and "starting in…" slides. */
function openingPanel() {
    return [settingsPanel(), quizAnimPanel('אנימציה בפתיחה — לובי ו"מתחילים בעוד"', ''), panel('פתיחה — לובי ו"מתחילים בעוד"', quizSlideMusic(OPENING_SLIDES))];
}

/** The closing: the winners' music, the podium and the matrix. */
function closingPanel() {
    return [panel('סיום — פודיום ומטריצה',
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'מוסיקת רקע להצגת הזוכים' }),
            mediaSelect(manifest, ['audio'], quiz.podium_music, (v) => act(() => saveQuiz({ podium_music: v })))),
        quizSlideMusic(CLOSING_SLIDES),
        h('p', { class: 'dr-note', text: 'אחרי הפודיום, בטלפון של המנצח מופיע "ניצחת!"; אחרי המטריצה השחקנים עוברים לשקופית הפרידה ולאתר.' })),
        quizAnimPanel('אנימציה בסיום — פודיום ומטריצה', 'closing_')];
}

function settingsPanel() {
    const themes = h('div', { class: 'ed-themes', role: 'radiogroup', 'aria-label': 'עיצוב' },
        THEMES.map(([key, label]) => h('button', { type: 'button', class: 'ed-theme', text: label,
            dataset: { themeKey: key, ...(quiz.theme === key ? { on: '' } : {}) },
            onclick: () => act(() => saveQuiz({ theme: key })) })));
    return panel('הגדרות החידון',
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'שם החידון' }),
            h('input', { class: 'dr-input', type: 'text', maxlength: '80', dir: 'auto', value: quiz.title,
                onchange: (e) => act(async () => { await saveQuiz({ title: e.target.value.trim() || 'חידון' }); }) })),
        h('div', { class: 'if-field' }, h('span', { class: 'if-label', text: 'עיצוב' }), themes),
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'תמונת רקע' }),
            mediaSelect(manifest, ['backgrounds'], quiz.background, (v) => act(() => saveQuiz({ background: v })))),
        // Two musics: the lobby's, and the questions' — the latter also plays
        // under interludes and results, and is what an item's "as the quiz" means.
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'מוסיקת רקע ללובי' }),
            mediaSelect(manifest, ['audio'], quiz.lobby_music, (v) => act(() => saveQuiz({ lobby_music: v })))),
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'מוסיקת רקע לשאלות' }),
            mediaSelect(manifest, ['audio'], quiz.music, (v) => act(() => saveQuiz({ music: v })))),
        h('label', { class: 'if-check' },
            h('input', { type: 'checkbox', checked: quiz.music_on, onchange: (e) => act(() => saveQuiz({ music_on: e.target.checked })) }),
            'להשמיע מוסיקת רקע (בלובי, בשאלות ובהצגת הזוכים)'),
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'שניות "מתכוננים" לפני כל שאלה' }),
            h('input', { class: 'dr-input', type: 'number', min: '0', max: '10', value: String(quiz.lead_in_s),
                onchange: (e) => act(() => saveQuiz({ lead_in_s: Math.min(10, Math.max(0, Math.round(Number(e.target.value) || 0))) })) })),
        // Solo play (index.html?demo&quiz=<id>): the whole quiz, answers
        // included, goes to the solo player's browser — so the switch says so.
        h('label', { class: 'if-check' },
            h('input', { type: 'checkbox', checked: !!quiz.demo_public, onchange: (e) => act(() => saveQuiz({ demo_public: e.target.checked })) }),
            'זמין כחידון לדוגמה — כל אחד יכול לשחק אותו לבד מול שחקנים וירטואליים'),
        quiz.demo_public && h('p', { class: 'dr-note' },
            'שימו לב: במשחק לבד התשובות הנכונות נשלחות לדפדפן של המשחק, ומי שמבין בזה יכול לראות אותן. לא ניתן לשחק לבד בזמן שהחידון רץ בלייב, אבל מי שמשחק לפני הלייב יכיר את השאלות — כדאי להפעיל רק אחרי שהחידון רץ, או לחידון שלא ירוץ בלייב. ',
            h('a', { href: `./?demo&quiz=${encodeURIComponent(quiz.id)}`, target: '_blank', rel: 'noopener', text: 'לשחק אותו עכשיו ↗' })));
}

/** An animation of the QUIZ's own screens: the opening's (its `anim_*`
 *  columns: lobby, "starting in…") or the closing's (`closing_anim_*`:
 *  podium, matrix). Saved at once, like every quiz setting. */
function quizAnimPanel(title, prefix) {
    const col = (k) => `${prefix}${k === 'on' ? 'anim_on' : `anim_${k}`}`;
    return panel(title, animFields({ manifest,
        get: (k) => quiz[col(k)],
        set: (patch) => act(() => saveQuiz(Object.fromEntries(Object.entries(patch).map(([k, v]) => [col(k), v])))),
        onCutter: (done) => openSpriteCutter({ manifest, onSaved: async (path) => { manifest = await loadManifest(); done(path); } }),
        label: 'הוסף אנימציה', emptyNote: 'בלי דמות לא תופיע אנימציה.' }),
        h('p', { class: 'dr-note', text: 'כל דמות נעה בקו ישר וחוזרת מהקירות באותה זווית. לכל שאלה ולכל קטע מעבר יש אנימציה משלו, בטופס שלו.' }));
}

/** What each kind of element is called, and its mark in the running order. */
const KINDS = {
    interlude: { icon: '🎬', label: 'קטע מעבר' },
    question: { icon: '❓', label: 'שאלה' },
    spot: { icon: '🔎', label: 'זיהוי בתמונה' },
    puzzle: { icon: '🧩', label: 'פאזל' },
    complete: { icon: '🖼️', label: 'השלמת תמונה' },
    slider: { icon: '🎚️', label: 'סליידר' },
    rank: { icon: '🔢', label: 'דירוג' },
    memory: { icon: '📸', label: 'זיכרון' },
    roulette: { icon: '🎰', label: 'רולטה' },
    action: { icon: '🏀', label: 'אקשן: קליעות' },
    explain: { icon: '💡', label: 'הסבר התשובה' },
};
const EMPTY_TITLE = { question: '(שאלה ריקה)', puzzle: '(פאזל)', complete: '(השלמת תמונה)', slider: '(סליידר)', rank: '(דירוג)', memory: '(שאלת זיכרון)', roulette: '(רולטה)', action: '(אקשן: קליעות)', spot: '(זיהוי בתמונה)', explain: '(הסבר התשובה)', interlude: '(קטע מעבר)' };

let dragFrom = null;   // index of the row being dragged

function itemRow(it, index) {
    const child = it.kind === 'explain';
    const kind = KINDS[it.kind] || KINDS.interlude;
    const title = it.title || EMPTY_TITLE[it.kind];
    const row = h('li', {
        class: 'dr-item ed-row', dataset: { kind: it.kind, ...(it.id === selectedId ? { current: '' } : {}), ...(child ? { child: '' } : {}) },
        // The whole title on hover: the row shows as much as fits, in small type.
        title: `${kind.label}: ${title}`,
    },
    !child && h('span', { class: 'ed-grip', 'aria-hidden': 'true', text: '⠿' }),
    h('button', { class: 'dr-item-main', type: 'button', onclick: () => { if (it.id === selectedId || !leaveForms()) return; selectedId = it.id; draw(); } },
        h('span', { class: 'dr-item-idx', text: child ? '↳' : String(index + 1) }),
        h('span', { class: 'ed-kind', text: kind.icon }),
        h('span', { class: 'dr-item-title', dir: 'auto', text: title })),
    it.kind !== 'interlude' && !child && it.weight !== 1 && h('span', { class: 'dr-tag', dir: 'ltr', text: `×${it.weight}` }),
    // A scored element can be given its "answer explained" segment.
    !child && it.kind !== 'interlude' && !it.explain && h('button', { class: 'dr-icon', type: 'button', title: 'הוספת קטע הסבר התשובה (אחרי החשיפה, לפני הטבלה)', text: '💡+',
        onclick: () => act(() => addExplain(it)) }),
    h('button', { class: 'dr-icon', type: 'button', title: 'מחק', text: '✕', onclick: () => act(() => removeItem(it)) }));

    if (!child) {
        // Drag a row onto another to move it there. A segment is not
        // draggable: it travels with its question.
        row.draggable = true;
        row.addEventListener('dragstart', (e) => { dragFrom = index; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); row.toggleAttribute('data-dragging', true); });
        row.addEventListener('dragend', () => { dragFrom = null; for (const el of row.parentElement?.children || []) { el.removeAttribute('data-dragging'); el.removeAttribute('data-drop'); } });
        row.addEventListener('dragover', (e) => {
            if (dragFrom === null || dragFrom === index) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // The line shows where it will land: above when moving up, below when moving down.
            row.dataset.drop = dragFrom > index ? 'before' : 'after';
        });
        row.addEventListener('dragleave', () => row.removeAttribute('data-drop'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            const from = dragFrom;
            dragFrom = null;
            if (from !== null) act(() => moveItem(from, index));
        });
    }
    return row;
}

/** The opening and the closing: rows like an item's, without the item's tools. */
function bookendRow(id, icon, title, note) {
    return h('li', { class: 'dr-item ed-row ed-row--bookend', dataset: { kind: id, ...(selectedId === id ? { current: '' } : {}) }, title: note },
        h('button', { class: 'dr-item-main', type: 'button', onclick: () => { if (selectedId === id || !leaveForms()) return; selectedId = id; draw(); } },
            h('span', { class: 'dr-item-idx', text: icon }),
            h('span', { class: 'dr-item-title', text: title })));
}

function listPanel() {
    return panel(`מהלך החידון (${items.length})`,
        h('ul', { class: 'dr-list ed-list' },
            bookendRow(OPENING, '🚪', 'פתיחה', 'הגדרות החידון, הלובי ו"מתחילים בעוד"'),
            items.flatMap((it, i) => [itemRow(it, i), it.explain && itemRow(it.explain, i)]),
            bookendRow(CLOSING, '🏆', 'סיום', 'פודיום, "ניצחת!" ומטריצה')),
        h('p', { class: 'dr-note', text: 'גוררים שורה כדי לשנות את הסדר. 💡+ מוסיף לשאלה קטע הסבר שמוצג אחרי חשיפת התשובה.' }),
        h('div', { class: 'dr-row' },
            btn('❓ שאלה', () => act(() => addItem('question'))),
            btn('🔎 זיהוי בתמונה', () => act(() => addItem('spot')), 'gk-btn--ghost'),
            btn('🧩 פאזל', () => act(() => addItem('puzzle')), 'gk-btn--ghost'),
            btn('🖼️ השלמת תמונה', () => act(() => addItem('complete')), 'gk-btn--ghost'),
            btn('🎚️ סליידר', () => act(() => addItem('slider')), 'gk-btn--ghost'),
            btn('🔢 דירוג', () => act(() => addItem('rank')), 'gk-btn--ghost'),
            btn('📸 זיכרון', () => act(() => addItem('memory')), 'gk-btn--ghost'),
            btn('🎰 רולטה', () => act(() => addItem('roulette')), 'gk-btn--ghost'),
            btn('🏀 אקשן: קליעות', () => act(() => addItem('action')), 'gk-btn--ghost'),
            btn('🎬 קטע מעבר', () => act(() => addItem('interlude')), 'gk-btn--ghost')));
}

function formPanel() {
    if (selectedId === OPENING) return openingPanel();
    if (selectedId === CLOSING) return closingPanel();
    const item = selected();
    if (!item) return panel('פריט', h('p', { class: 'dr-note', text: 'הוסיפו שאלה או קטע מעבר כדי להתחיל.' }));
    return panel({ question: 'עריכת שאלה', puzzle: 'עריכת פאזל', complete: 'עריכת שאלת השלמת תמונה', slider: 'עריכת שאלת סליידר', rank: 'עריכת שאלת דירוג', memory: 'עריכת שאלת זיכרון', roulette: 'עריכת שאלת רולטה', action: 'עריכת שאלת אקשן', spot: 'עריכת שאלת זיהוי בתמונה', explain: 'עריכת קטע הסבר התשובה' }[item.kind] || 'עריכת קטע מעבר',
        // Kept across redraws while it has unsaved changes (keptForm).
        keptForm(`ed:${item.id}`, () => itemForm(item, {
            manifest,
            onShowSlide: (key) => showSlide(key),
            onSave: async (patch) => {
                Object.assign(item, await api.items.update(item.id, patch));
                // Only the list row and the previews follow a save — rebuilding
                // the form here would pull the field out from under the cursor.
                redrawList();
                pushPreview(); pushLive();
            },
        })),
        h('p', { class: 'dr-note', text: 'קובצי מדיה: שימו את הקובץ בתיקייה gevkahoot/media/‎<סוג>‎ והריצו node scripts/gevkahoot-media-manifest.mjs — הוא יופיע ברשימות.' }));
}

const VIEW_LABEL = Object.fromEntries(VIEWS);
const viewTabs = h('div', { class: 'ed-views', role: 'tablist' });

/** The slides of what is selected, in the order the room sees them: the
 *  opening's, the closing's, or an item's (its get-ready, itself, the reveal,
 *  its segment if any, the results; the leader's special slide on the last
 *  question). The arrows step through them; a question opens on itself. */
function slidesInView() {
    if (selectedId === OPENING) return ['lobby', 'countdown'];
    if (selectedId === CLOSING) return ['podium', 'matrix'];
    const item = selected();
    const own = viewsFor(item);
    const lastQ = [...items].reverse().find((i) => i.kind !== 'interlude');
    // the last question: the leader's slide before it, and NO table after it
    // (the winners are announced next — gk_admin_next skips it)
    return item && item === lastQ ? own.flatMap((v) => (v === 'firstfire' ? ['firstfire', 'leadfire'] : v === 'leaderboard' ? [] : [v])) : own;
}

function drawViewTabs() {
    const offered = slidesInView();
    if (!offered.includes(view)) view = offered.includes('item') ? 'item' : offered[0] || 'lobby';
    clear(viewTabs);
    const at = offered.indexOf(view);
    const go = (i) => { view = offered[i]; drawViewTabs(); pushPreview(); };
    if (offered.length > 1) {
        // RTL: "previous" on the right, "next" on the left.
        viewTabs.append(
            h('button', { type: 'button', class: 'ed-view ed-step', text: '› הקודם', disabled: at <= 0, onclick: () => go(at - 1) }),
            h('span', { class: 'ed-step-label', text: `${VIEW_LABEL[view]} · ${at + 1} מתוך ${offered.length}` }),
            h('button', { type: 'button', class: 'ed-view ed-step', text: 'הבא ‹', disabled: at >= offered.length - 1, onclick: () => go(at + 1) }),
            h('div', { class: 'ed-dots' }, offered.map((key, i) => h('button', { type: 'button', class: 'ed-dot', title: VIEW_LABEL[key],
                'aria-label': VIEW_LABEL[key], dataset: i === at ? { on: '' } : {}, onclick: () => go(i) }))));
    } else if (offered.length === 1) {
        viewTabs.append(h('span', { class: 'ed-step-label', text: VIEW_LABEL[view] }));
    }
}

/** "Show me this slide": from a music row's name to the previews. */
function showSlide(key) {
    const target = viewOfSlide(key);
    const offered = slidesInView();
    view = offered.includes(target) ? target : key === 'fire' && offered.includes('leadfire') ? 'leadfire' : view;
    drawViewTabs();
    pushPreview();
}

function previewPanel() {
    return h('section', { class: 'ed-panel ed-preview' },
        h('h2', { text: 'תצוגה מקדימה' }),
        viewTabs,
        frames.map((f) => h('figure', { class: 'ed-figure' }, h('figcaption', { text: f.label }), f.box)));
}

let listSlot = null;
function redrawList() {
    if (!listSlot) return;
    const fresh = listPanel();
    listSlot.replaceWith(fresh);
    listSlot = fresh;
}

// The page shell is built once and only its slots are refilled. The preview
// column in particular must never leave the document: detaching an <iframe>
// reloads it, which would blank both previews on every click.
const previewColumn = previewPanel();
const topSlot = h('div', { class: 'ed-slot' });
const colA = h('div', { class: 'ed-side-body' });
const colB = h('div', { class: 'ed-col' });
// The side menu: the whole height of the window, top included; it folds away
// to a strip and back (open by default; the choice is remembered).
const side = h('aside', { class: 'ed-side', 'aria-label': 'מהלך החידון' });
const sideToggle = h('button', { class: 'ed-side-toggle', type: 'button' });
const syncSide = () => {
    side.toggleAttribute('data-closed', !sideOpen);
    sideToggle.textContent = sideOpen ? '⟩ סגירה' : '⟨ מהלך החידון';
    sideToggle.title = sideOpen ? 'קיפול התפריט' : 'פתיחת התפריט';
};
sideToggle.addEventListener('click', () => {
    sideOpen = !sideOpen;
    try { localStorage.setItem('gevkahoot:editor-side', sideOpen ? 'open' : 'closed'); } catch { /* convenience only */ }
    syncSide();
});
side.append(sideToggle, colA);
syncSide();
const shell = [side, h('div', { class: 'ed-main' }, topSlot, h('div', { class: 'ed-cols' }, colB, previewColumn))];
let mounted = false;

function draw() {
    if (!mounted) {
        clear(root);
        root.className = 'ed kit';
        root.append(...shell);
        mounted = true;
    }
    clear(topSlot).append(topBar());
    clear(colA);
    clear(colB);
    if (!quiz) {
        listSlot = null;
        colB.append(h('p', { class: 'ed-empty', text: 'אין עדיין חידונים. לחצו "+ חידון חדש".' }));
        return;
    }
    listSlot = listPanel();
    colA.append(listSlot);
    const form = formPanel();
    colB.append(...(Array.isArray(form) ? form : [form]));
    drawViewTabs();
    pushPreview();
}

// ---- boot (same gate as the host screen) ----------------------------------
function mountLogin(message) {
    clear(root);
    mounted = false;
    root.className = 'lg';
    const email = h('input', { class: 'gk-input', type: 'email', autocomplete: 'username', placeholder: 'email', required: true, 'aria-label': 'אימייל' });
    const password = h('input', { class: 'gk-input', type: 'password', autocomplete: 'current-password', placeholder: 'סיסמה', required: true, 'aria-label': 'סיסמה' });
    const error = h('p', { class: 'pl-error', role: 'alert', hidden: !message, text: message || '' });
    const submit = h('button', { class: 'gk-btn', type: 'submit', text: 'כניסה' });
    root.append(h('form', { class: 'lg-card', onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        if (await api.signIn(email.value.trim(), password.value)) return boot();
        submit.disabled = false;
        error.hidden = false;
        error.textContent = 'הכניסה נכשלה';
    } }, h('h1', { text: 'עורך החידונים' }), email, password, error, submit));
}

async function boot() {
    if (!(await api.currentSession())) return mountLogin();
    let allowed = false;
    try { allowed = await api.admin.isAdmin(); } catch { allowed = false; }
    if (!allowed) { await api.signOut(); return mountLogin('החשבון הזה אינו מורשה לערוך חידונים'); }
    manifest = await loadManifest();
    let last = null;
    try { last = localStorage.getItem('gevkahoot:editor-quiz'); } catch { /* convenience only */ }
    await loadQuizzes(last);
}

boot();
