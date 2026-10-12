/**
 * gkEditor.js — editor.html, the quiz editor (opened from tools/).
 *
 * Three columns: the quiz and its run sheet, the form for the selected item,
 * and two live previews — the projected screen in a desktop frame and the
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
import { itemForm, loadManifest, mediaSelect } from './admin/itemForm.js';
import { mock, VIEWS } from './preview/mock.js';

const root = document.getElementById('app');
const THEMES = [['stadium', 'אצטדיון'], ['candy', 'ממתק'], ['night', 'לילה']];

let quizzes = [];
let quiz = null;
let items = [];
let selectedId = null;
let manifest = null;
let view = 'item';
let notice = '';

const selected = () => items.find((i) => i.id === selectedId) || null;

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
    items = quiz ? await api.items.list(quiz.id) : [];
    selectedId = items[0]?.id || null;
    try { localStorage.setItem('gevkalil:editor-quiz', quiz?.id || ''); } catch { /* convenience only */ }
    draw();
}

async function act(fn) {
    notice = '';
    try { await fn(); } catch (err) { notice = `הפעולה נכשלה: ${err.message}`; }
    draw();
}

async function saveQuiz(patch) {
    Object.assign(quiz, await api.quizzes.update(quiz.id, patch));
    pushPreview(); pushLive();
}

async function addItem(kind) {
    const position = (items.at(-1)?.position || 0) + 1;
    const row = kind === 'question'
        ? { quiz_id: quiz.id, position, kind, title: '', options: ['', ''], correct: [0] }
        : { quiz_id: quiz.id, position, kind, title: '', media_layout: 'full' };
    const created = await api.items.create(row);
    items.push(created);
    selectedId = created.id;
}

async function removeItem(item) {
    if (!confirm(`למחוק את "${item.title || 'הפריט'}"?`)) return;
    await api.items.remove(item.id);
    items = items.filter((i) => i.id !== item.id);
    if (selectedId === item.id) selectedId = items[0]?.id || null;
    pushLive();
}

/** Move an item one place. Positions are rewritten 1..n for the whole list —
 *  only rows whose number actually changed are written. */
async function moveItem(item, delta) {
    const from = items.indexOf(item);
    const to = from + delta;
    if (to < 0 || to >= items.length) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    await Promise.all(items.map((it, i) => {
        if (it.position === i + 1) return null;
        it.position = i + 1;
        return api.items.update(it.id, { position: i + 1 });
    }));
    pushLive();
}

// ---- view -----------------------------------------------------------------
const btn = (text, onclick, cls = '') => h('button', { class: `gk-btn gk-btn--small ${cls}`, type: 'button', text, onclick });
const panel = (title, ...children) => h('section', { class: 'ed-panel' }, title && h('h2', { text: title }), ...children);

function topBar() {
    const select = h('select', { class: 'dr-select', 'aria-label': 'חידון', onchange: () => act(() => selectQuiz(quizzes.find((q) => q.id === select.value))) },
        quizzes.map((q) => h('option', { value: q.id, text: q.title })));
    select.value = quiz?.id || '';
    return h('header', { class: 'ed-top' },
        h('div', { class: 'ed-brand' }, 'Gev', h('b', { text: 'kalil' }), h('span', { text: ' · עורך' })),
        quizzes.length > 0 && select,
        btn('+ חידון חדש', () => act(async () => { const q = await api.quizzes.create('חידון חדש'); await loadQuizzes(q.id); })),
        quiz && btn('מחק חידון', () => confirm(`למחוק את החידון "${quiz.title}" וכל הפריטים שבו?`) && act(async () => { await api.quizzes.remove(quiz.id); await loadQuizzes(); }), 'gk-btn--ghost'),
        h('span', { class: 'ed-spacer' }),
        notice && h('span', { class: 'dr-error', role: 'alert', text: notice }),
        h('a', { class: 'gk-btn gk-btn--small gk-btn--ghost', href: 'host.html', target: '_blank', rel: 'noopener', text: 'מסך המנחה ↗' }),
        h('a', { class: 'gk-btn gk-btn--small gk-btn--ghost', href: './', target: '_blank', rel: 'noopener', text: 'מסך הכניסה ↗' }));
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
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'מוסיקת רקע' }),
            mediaSelect(manifest, ['audio'], quiz.music, (v) => act(() => saveQuiz({ music: v })))),
        h('label', { class: 'if-check' },
            h('input', { type: 'checkbox', checked: quiz.music_on, onchange: (e) => act(() => saveQuiz({ music_on: e.target.checked })) }),
            'להשמיע מוסיקת רקע'),
        h('label', { class: 'if-field' }, h('span', { class: 'if-label', text: 'שניות "מתכוננים" לפני כל שאלה' }),
            h('input', { class: 'dr-input', type: 'number', min: '0', max: '10', value: String(quiz.lead_in_s),
                onchange: (e) => act(() => saveQuiz({ lead_in_s: Math.min(10, Math.max(0, Math.round(Number(e.target.value) || 0))) })) })));
}

function listPanel() {
    return panel(`מהלך החידון (${items.length})`,
        h('ul', { class: 'dr-list' }, items.map((it, i) => h('li', { class: 'dr-item', dataset: it.id === selectedId ? { current: '' } : {} },
            h('button', { class: 'dr-item-main', type: 'button', onclick: () => { selectedId = it.id; draw(); } },
                h('span', { class: 'dr-item-idx', text: String(i + 1) }),
                h('span', { text: it.kind === 'question' ? '❓' : '🎬' }),
                h('span', { class: 'dr-item-title', dir: 'auto', text: it.title || (it.kind === 'question' ? '(שאלה ריקה)' : '(קטע מעבר)') })),
            it.kind === 'question' && it.weight !== 1 && h('span', { class: 'dr-tag', dir: 'ltr', text: `×${it.weight}` }),
            h('button', { class: 'dr-icon', type: 'button', title: 'הזז למעלה', text: '▲', disabled: i === 0, onclick: () => act(() => moveItem(it, -1)) }),
            h('button', { class: 'dr-icon', type: 'button', title: 'הזז למטה', text: '▼', disabled: i === items.length - 1, onclick: () => act(() => moveItem(it, 1)) }),
            h('button', { class: 'dr-icon', type: 'button', title: 'מחק', text: '✕', onclick: () => act(() => removeItem(it)) })))),
        h('div', { class: 'dr-row' },
            btn('+ שאלה', () => act(() => addItem('question'))),
            btn('+ קטע מעבר', () => act(() => addItem('interlude')), 'gk-btn--ghost')));
}

function formPanel() {
    const item = selected();
    if (!item) return panel('פריט', h('p', { class: 'dr-note', text: 'הוסיפו שאלה או קטע מעבר כדי להתחיל.' }));
    return panel(item.kind === 'question' ? 'עריכת שאלה' : 'עריכת קטע מעבר',
        itemForm(item, {
            manifest,
            onSave: async (patch) => {
                Object.assign(item, await api.items.update(item.id, patch));
                // Only the list row and the previews follow a save — rebuilding
                // the form here would pull the field out from under the cursor.
                redrawList();
                pushPreview(); pushLive();
            },
        }),
        h('p', { class: 'dr-note', text: 'קובצי מדיה: שימו את הקובץ בתיקייה gevkalil/media/‎<סוג>‎ והריצו node scripts/gevkalil-media-manifest.mjs — הוא יופיע ברשימות.' }));
}

function previewPanel() {
    return h('section', { class: 'ed-panel ed-preview' },
        h('h2', { text: 'תצוגה מקדימה' }),
        h('div', { class: 'ed-views', role: 'tablist' }, VIEWS.map(([key, label]) => h('button', {
            type: 'button', class: 'ed-view', role: 'tab', text: label, 'aria-selected': String(view === key),
            dataset: view === key ? { on: '' } : {},
            onclick: (e) => {
                view = key;
                for (const b of e.currentTarget.parentElement.children) {
                    b.toggleAttribute('data-on', b === e.currentTarget);
                    b.setAttribute('aria-selected', String(b === e.currentTarget));
                }
                pushPreview();
            } }))),
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
const colA = h('div', { class: 'ed-col' });
const colB = h('div', { class: 'ed-col' });
const shell = [topSlot, h('div', { class: 'ed-cols' }, colA, colB, previewColumn)];
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
    colA.append(settingsPanel(), listSlot);
    colB.append(formPanel());
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
    try { last = localStorage.getItem('gevkalil:editor-quiz'); } catch { /* convenience only */ }
    await loadQuizzes(last);
}

boot();
