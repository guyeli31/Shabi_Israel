/**
 * drawer.js — the host's controls, in a side drawer over the projected screen.
 *
 * The screen the audience watches is also the host's console, so the controls
 * stay out of sight: two faint buttons top-left (☰ and ▶), and everything else
 * behind the hamburger. A whole quiz can be run with ▶ / the space bar alone;
 * the drawer is for the exceptions — jumping, going back, fixing a question,
 * linking a player's new phone.
 */
import { h, clear, renderKeyed } from '../ui/dom.js';
import * as api from '../data/api.js';
import { itemForm, keptForm, leaveForms, loadManifest } from '../admin/itemForm.js';

const KIND_ICON = { interlude: '🎬', question: '❓', spot: '🔎', puzzle: '🧩', complete: '🖼️', slider: '🎚️', rank: '🔢', memory: '📸', roulette: '🎰', action: '🏀', explain: '💡' };
const PHASE_LABEL = {
    lobby: 'הרשמה פתוחה', interlude: 'קטע מעבר', question: 'שאלה פתוחה', reveal: 'התשובה נחשפה',
    explain: 'הסבר התשובה', intro: 'שקופית הוראות — ״הבא״ מתחיל את השאלה',
    fastest: 'הכי מהירים', fire: '🔥 שקופית מיוחדת — ״הבא״ ממשיך', leaderboard: 'טבלה', podium: 'פודיום', matrix: 'מטריצה',
};

export function createDrawer({ email, onArchive, onSignOut }) {
    let open = false;
    let admin = { session: null };   // gk_admin_state()
    let quizList = [];
    let itemRows = [];               // full gk_items rows of the live quiz, for the edit form
    let manifest = null;
    let editing = null;              // id of the item whose form is open
    let archiveRows = null;
    let error = null;
    let chosenQuiz = '';

    const badge = h('span', { class: 'hc-badge', hidden: true });
    const burger = h('button', { class: 'hc-btn', type: 'button', title: 'תפריט ניהול', 'aria-label': 'תפריט ניהול', onclick: () => toggle(true) }, '☰', badge);
    const nextBtn = h('button', { class: 'hc-btn', type: 'button', title: 'הבא (רווח)', 'aria-label': 'הבא', text: '▶', onclick: () => run(api.admin.next) });
    const controls = h('div', { class: 'hc' }, burger, nextBtn);
    // A phone asking to take over a name already in the quiz (its owner's
    // browser crashed — or someone else typed the same name): shown on the
    // screen itself, under the two buttons, so the host decides at once
    // without opening the drawer.
    const alerts = h('div', { class: 'hc-alerts', role: 'alert', 'aria-live': 'assertive' });
    controls.append(alerts);
    const body = h('div', { class: 'dr-body' });
    const backdrop = h('div', { class: 'dr-backdrop', onclick: () => toggle(false) });
    const panel = h('aside', { class: 'dr', dir: 'rtl', 'aria-label': 'ניהול החידון' },
        h('div', { class: 'dr-head' },
            h('h2', { text: 'ניהול החידון' }),
            h('span', { class: 'dr-user', text: email }),
            h('button', { class: 'dr-x', type: 'button', 'aria-label': 'סגור', text: '✕', onclick: () => toggle(false) })),
        body);
    document.body.append(controls, backdrop, panel);

    function toggle(next) {
        open = next;
        panel.toggleAttribute('data-open', open);
        backdrop.toggleAttribute('data-open', open);
        drawAlerts();
        if (open) { poll(); if (!admin.session) loadQuizzes(); }
    }

    /** Run a host action, then re-read: the drawer always shows what the
     *  server says happened, never what the click hoped for. */
    async function run(action) {
        error = null;
        try { await action(); } catch (err) { error = describe(err); }
        await poll();
    }
    const describe = (err) => ({
        already_active: 'כבר יש חידון פעיל',
        empty_quiz: 'בחידון הזה אין עדיין פריטים',
        not_revealed: 'קודם חושפים את התשובה',
        'not authorized': 'החשבון הזה אינו מורשה לנהל',
    }[err.code] || err.message || 'הפעולה נכשלה');

    async function loadQuizzes() {
        try { quizList = await api.quizzes.list(); } catch { quizList = []; }
        if (!quizList.some((q) => q.id === chosenQuiz)) chosenQuiz = quizList[0]?.id || '';
        draw();
    }

    let polling = false;
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const before = admin.session?.quiz_id;
            admin = (await api.admin.state()) || { session: null };
            if (admin.session?.quiz_id && (admin.session.quiz_id !== before || editing)) {
                itemRows = await api.items.list(admin.session.quiz_id);
            }
        } catch { /* keep the last known state */ }
        polling = false;
        const waiting = admin.requests?.length || 0;
        badge.hidden = !waiting;
        badge.textContent = String(waiting);
        // A phone waiting to be linked is the one thing the host must notice
        // without opening the drawer.
        burger.toggleAttribute('data-alert', waiting > 0);
        drawAlerts();
        // Don't rebuild under the host's cursor while they are typing a fix.
        if (open && !panel.contains(document.activeElement?.closest?.('.if') || null)) draw();
    }
    setInterval(() => { if (!document.hidden) poll(); }, 2500);

    // ---- sections ---------------------------------------------------------
    const sec = (title, ...children) => h('section', { class: 'dr-sec' }, title && h('h3', { text: title }), ...children);
    const btn = (text, onclick, cls = '') => h('button', { class: `gk-btn ${cls}`, type: 'button', text, onclick });

    function controlSection() {
        const s = admin.session;
        if (!s || s.status === 'aborted') {
            const select = h('select', { class: 'dr-select', 'aria-label': 'חידון', onchange: () => { chosenQuiz = select.value; } },
                quizList.map((q) => h('option', { value: q.id, text: q.title })));
            select.value = chosenQuiz;
            return sec('העלאת חידון',
                quizList.length
                    ? h('div', { class: 'dr-row' }, select, btn('פתח הרשמה', () => run(() => api.admin.open(chosenQuiz))))
                    : h('p', { class: 'dr-note', text: 'עדיין אין חידונים. צרו אחד בעורך.' }),
                h('p', { class: 'dr-note' }, h('a', { href: 'editor.html', target: '_blank', rel: 'noopener', text: 'פתיחת העורך ↗' })));
        }
        const where = s.index ? ` · פריט ${s.index} מתוך ${admin.items.length}` : '';
        const rows = [h('p', { class: 'dr-status', text: `${s.status === 'finished' ? 'החידון הסתיים · ' : ''}${PHASE_LABEL[s.phase] || s.phase}${where}` })];

        if (s.status === 'finished') {
            rows.push(h('div', { class: 'dr-row' },
                btn('פודיום', () => run(() => api.admin.show('podium')), 'gk-btn--ghost'),
                btn('מטריצה', () => run(() => api.admin.show('matrix')), 'gk-btn--ghost')),
            h('div', { class: 'dr-row' }, btn('סגור את החידון', () => run(api.admin.close), 'gk-btn--danger')),
            h('p', { class: 'dr-note', text: 'התוצאות כבר שמורות בארכיון. סגירה רק מורידה אותן מהמסך.' }));
            return sec('שליטה', ...rows);
        }

        rows.push(h('div', { class: 'dr-row' },
            btn(s.status === 'lobby' ? 'התחל את החידון ▶' : 'הבא ▶', () => run(api.admin.next), 'gk-btn--primary')));
        if (s.status === 'running') {
            rows.push(h('div', { class: 'dr-row' },
                s.phase === 'question' && btn('חשוף עכשיו', () => run(api.admin.reveal), 'gk-btn--ghost'),
                s.revealed && btn('תשובה', () => run(() => api.admin.show('reveal')), 'gk-btn--ghost'),
                s.revealed && admin.items.find((it) => it.id === s.item_id)?.explain && btn('הסבר', () => run(() => api.admin.show('explain')), 'gk-btn--ghost'),
                s.revealed && btn('מהירים', () => run(() => api.admin.show('fastest')), 'gk-btn--ghost'),
                s.phase !== 'question' && btn('טבלה', () => run(() => api.admin.show('leaderboard')), 'gk-btn--ghost')));
        }
        rows.push(h('div', { class: 'dr-row' },
            btn(s.locked ? 'פתח הרשמה מחדש' : 'נעל הרשמה', () => run(() => api.admin.lock(!s.locked)), 'gk-btn--ghost'),
            s.status === 'running' && btn('סיים עכשיו', () => confirm('לסיים את החידון ולהציג את הזוכים?') && run(api.admin.finish), 'gk-btn--ghost'),
            btn('בטל חידון', () => confirm('לבטל את החידון? התוצאות לא יישמרו.') && run(api.admin.close), 'gk-btn--danger')));
        return sec('שליטה', ...rows);
    }

    /** The on-screen alert: one card per waiting request, with whether the
     *  player it names is still connected — a crashed browser is not. */
    function drawAlerts() {
        const reqs = open ? [] : admin.requests || [];
        const online = (name) => admin.players?.find((p) => p.name === name)?.online;
        renderKeyed(alerts, reqs.map((r) => `${r.id}|${online(r.name)}`).join(','), () => reqs.map((r) => h('div', { class: 'hc-alert' },
            h('p', { class: 'hc-alert-text' },
                '🙋 מכשיר חדש מבקש להיות ', h('b', { dir: 'auto', text: r.name }),
                h('small', { text: online(r.name)
                    ? 'השחקן בשם הזה עדיין מחובר מהמכשיר הקודם — אולי זה מישהו אחר עם אותו שם.'
                    : 'המכשיר הקודם לא מחובר — כנראה הדפדפן קרס. אישור מעביר אליו את השחקן עם כל הניקוד.' })),
            h('div', { class: 'hc-alert-actions' },
                btn('אשר', () => run(() => api.admin.relink(r.id, true)), 'gk-btn--small'),
                btn('דחה', () => run(() => api.admin.relink(r.id, false)), 'gk-btn--small gk-btn--ghost')))));
    }

    function requestSection() {
        if (!admin.requests?.length) return null;
        return sec('מכשיר חדש מבקש להתחבר',
            h('ul', { class: 'dr-list' }, admin.requests.map((r) => h('li', { class: 'dr-item' },
                h('span', { class: 'dr-item-title', dir: 'auto', text: r.name }),
                btn('אשר', () => run(() => api.admin.relink(r.id, true)), 'gk-btn--small'),
                btn('דחה', () => run(() => api.admin.relink(r.id, false)), 'gk-btn--small gk-btn--ghost')))),
            h('p', { class: 'dr-note', text: 'אשרו רק אחרי שהשחקן אמר לכם את השם בעצמו — המכשיר יקבל את הניקוד שלו.' }));
    }

    function runSheetSection() {
        const s = admin.session;
        if (!s || s.status === 'finished') return null;
        const goto = (it) => {
            const back = s.index && it.idx <= s.index;
            if (back && !confirm(`לחזור לפריט ${it.idx}? התשובות מהפריט הזה והלאה יבוטלו והטבלה תחזור למצב שלפניו.`)) return;
            run(() => api.admin.goto(it.idx));
        };
        return sec('מהלך החידון',
            h('ul', { class: 'dr-list ed-list' }, admin.items.map((it) => [
                h('li', { class: 'dr-item ed-row', title: it.title || '', dataset: { kind: it.kind, ...(it.id === s.item_id ? { current: '' } : {}) } },
                    h('button', { class: 'dr-item-main', type: 'button', title: `עבור לפריט הזה: ${it.title || ''}`, onclick: () => goto(it) },
                        h('span', { class: 'dr-item-idx', text: String(it.idx) }),
                        h('span', { class: 'ed-kind', text: KIND_ICON[it.kind] || '🎬' }),
                        h('span', { class: 'dr-item-title', dir: 'auto', text: it.title || '(ללא כותרת)' })),
                    it.cancelled
                        ? h('span', { class: 'dr-tag dr-tag--off', text: 'ניקוד בוטל' })
                        : it.kind !== 'interlude' && it.weight !== 1 && h('span', { class: 'dr-tag', dir: 'ltr', text: `×${it.weight}` }),
                    // A question already asked whose points the host takes back
                    // (or gives back) for everyone — it did not work the same for all.
                    s.status === 'running' && it.kind !== 'interlude' && s.index && it.idx <= s.index && h('button', {
                        class: 'dr-icon', type: 'button', text: it.cancelled ? '↺' : '⊘',
                        title: it.cancelled ? 'החזרת הניקוד של השאלה הזאת' : 'ביטול הניקוד של השאלה הזאת לכל המשתתפים',
                        onclick: () => (it.cancelled
                            ? confirm('להחזיר את הניקוד של השאלה הזאת לכולם?')
                            : confirm('לבטל את הניקוד של השאלה הזאת לכל המשתתפים?\nהתשובות נשמרות, אבל לא שוות נקודות, והטבלה תתעדכן מיד. אפשר להחזיר.'))
                            && run(() => api.admin.cancel(it.id, !it.cancelled)) }),
                    h('button', { class: 'dr-icon', type: 'button', title: 'עריכה', text: '✎',
                        onclick: () => { if (!leaveForms()) return; editing = editing === it.id ? null : it.id; openEditor(); } })),
                editing === it.id && editForm(it),
                // The question's "answer explained" segment: part of the
                // question, so not a stop to jump to — it is reached by
                // "next" after the reveal.
                it.explain && h('li', { class: 'dr-item ed-row', title: it.explain.title || '', dataset: { kind: 'explain', child: '' } },
                    h('span', { class: 'dr-item-main' },
                        h('span', { class: 'dr-item-idx', text: '↳' }),
                        h('span', { class: 'ed-kind', text: KIND_ICON.explain }),
                        h('span', { class: 'dr-item-title', dir: 'auto', text: it.explain.title || '(הסבר התשובה)' })),
                    h('button', { class: 'dr-icon', type: 'button', title: 'עריכה', text: '✎',
                        onclick: () => { if (!leaveForms()) return; editing = editing === it.explain.id ? null : it.explain.id; openEditor(); } })),
                it.explain && editing === it.explain.id && editForm(it.explain),
            ])));
    }

    async function openEditor() {
        if (editing) {
            manifest ??= await loadManifest();
            itemRows = await api.items.list(admin.session.quiz_id);
        }
        draw();
    }

    function editForm(it) {
        const row = itemRows.find((r) => r.id === it.id);
        if (!row || !manifest) return null;
        // The drawer redraws every few seconds: keptForm hands back the same
        // form while it has unsaved changes, so a fix in progress survives.
        return h('li', { class: 'dr-edit' }, keptForm(`dr:${row.id}`, () => itemForm(row, {
            manifest,
            onSave: async (patch) => {
                await api.items.update(row.id, patch);
                // A changed answer or weight re-prices the answers already in;
                // anything else just needs the screen redrawn.
                if (!['interlude', 'explain'].includes(row.kind)) await api.admin.rescore(row.id);
                await api.admin.refresh();
            },
        })));
    }

    function playerSection() {
        const s = admin.session;
        if (!s || !admin.players?.length) return null;
        const active = admin.players.filter((p) => !p.kicked);
        return sec(`שחקנים (${active.length})`,
            h('ul', { class: 'dr-list' }, active.map((p) => h('li', { class: 'dr-item' },
                h('span', { class: 'dr-dot', dataset: p.online ? { online: '' } : {}, title: p.online ? 'מחובר' : 'לא מחובר' }),
                h('span', { class: 'dr-item-title', dir: 'auto', text: p.name }),
                s.phase === 'question' && p.answered && h('span', { class: 'dr-tag', text: 'ענה' }),
                h('span', { class: 'dr-points', text: String(p.points) }),
                s.status !== 'finished' && h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', title: 'הסרת השחקן מהחידון', text: '🗑 הסר',
                    onclick: () => confirm(`להסיר את ${p.name} מהחידון?\nכל התשובות של השחקן יוסרו מהטבלה, מהמטריצה ומהספירות.`) && run(() => api.admin.kick(p.id)) })))));
    }

    function archiveSection() {
        return sec('ארכיון חידונים',
            archiveRows === null
                ? btn('הצג חידונים שהסתיימו', async () => { archiveRows = await api.archive.list().catch(() => []); draw(); }, 'gk-btn--ghost gk-btn--small')
                : archiveRows.length === 0
                    ? h('p', { class: 'dr-note', text: 'עדיין אין חידונים שהסתיימו.' })
                    : h('ul', { class: 'dr-list' }, archiveRows.map((row) => h('li', { class: 'dr-item' },
                        h('button', { class: 'dr-item-main', type: 'button', onclick: () => { toggle(false); onArchive(row); } },
                            h('span', { class: 'dr-item-title', dir: 'auto', text: row.quiz_title || 'חידון' }),
                            h('span', { class: 'dr-tag', dir: 'ltr', text: new Date(row.finished_at).toLocaleDateString('he-IL') }),
                            h('span', { class: 'dr-tag', text: `${row.result?.leaderboard?.length ?? 0} שחקנים` }))))));
    }

    function draw() {
        const scroll = body.scrollTop;
        clear(body);
        for (const part of [
            error && h('p', { class: 'dr-error', role: 'alert', text: error }),
            controlSection(), requestSection(), runSheetSection(), playerSection(), archiveSection(),
            sec(null, h('div', { class: 'dr-row' },
                h('a', { class: 'gk-btn gk-btn--ghost gk-btn--small', href: 'editor.html', target: '_blank', rel: 'noopener', text: 'עורך החידונים ↗' }),
                btn('התנתק', onSignOut, 'gk-btn--ghost gk-btn--small'))),
        ]) if (part) body.append(part);
        body.scrollTop = scroll;
    }

    poll().then(loadQuizzes);
    return {
        next: () => run(api.admin.next),
        get isOpen() { return open; },
        close: () => toggle(false),
        poll,
    };
}
