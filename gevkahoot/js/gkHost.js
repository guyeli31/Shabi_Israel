/**
 * gkHost.js — host.html: the projected screen, and behind a login, the host's
 * controls on top of it.
 *
 * Three ways this page runs:
 *   ?preview   framed by the editor: stage only, fed by postMessage, no login,
 *              no backend. This is how TOOLS shows the projected screen.
 *   signed in  as an allowlisted admin: stage + drawer.
 *   otherwise  the login card.
 */
import { h, clear } from './ui/dom.js';
import * as api from './data/api.js';
import { createStateSource, isPreview } from './data/stateSource.js';
import { syncClock, serverNow } from './data/clock.js';
import { createStage } from './host/stage.js';
import { createDrawer } from './host/drawer.js';

const root = document.getElementById('app');

/** The address players type: this folder, without the page name. */
const joinUrl = new URL('.', location.href).href;

function mountStage({ withControls, email }) {
    clear(root);
    root.className = 'st-frame--screen';
    const stage = createStage(root, { muted: isPreview, joinUrl });
    let live = null;        // the last state from the backend
    let archived = null;    // a finished quiz being browsed locally, or null
    let drawer = null;
    const revealAsked = new Set();

    const show = () => stage.render(archived || live);
    createStateSource((state) => { live = state; if (!archived) show(); });

    if (!withControls) return;

    const banner = h('div', { class: 'st-archive-banner', hidden: true });
    document.body.append(banner);
    /** Browse an archived quiz on this screen only. It is rendered from the
     *  stored result through the same stage, and nothing is broadcast: the
     *  players' phones keep showing whatever is actually on air. */
    function browseArchive(row, phase = 'podium') {
        archived = { status: 'finished', phase, rev: Date.now(), data: row.result || {}, live: { answered: 0, players: 0, names: [] } };
        clear(banner).append(
            h('span', { dir: 'auto', text: `ארכיון: ${row.quiz_title} — מוצג רק במסך הזה` }),
            h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: phase === 'podium' ? 'מטריצה' : 'פודיום',
                onclick: () => browseArchive(row, phase === 'podium' ? 'matrix' : 'podium') }),
            h('button', { class: 'gk-btn gk-btn--small', type: 'button', text: 'סגור', onclick: () => { archived = null; banner.hidden = true; show(); } }));
        banner.hidden = false;
        show();
    }

    drawer = createDrawer({
        email,
        onArchive: browseArchive,
        onSignOut: async () => { await api.signOut(); location.reload(); },
    });

    // Space / Enter / PageDown advance the quiz — but never while the host is
    // typing in the drawer, and never from a focused button (which Space would
    // also click, advancing twice).
    window.addEventListener('keydown', (e) => {
        if (!['Space', 'Enter', 'PageDown'].includes(e.code) || e.repeat) return;
        if (drawer.isOpen || archived) return;
        if (e.target.closest?.('input, textarea, select, button, a')) return;
        e.preventDefault();
        drawer.next();
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') drawer.close(); });

    // The countdown reaching zero is what closes a question, and this screen is
    // the one device guaranteed to be watching it. The server re-checks the
    // phase, so a duplicate or late call is a no-op.
    setInterval(() => {
        // "Starting in…" runs out on this screen too: on to the first item.
        if (live?.phase === 'countdown' && live.data.ends_at && serverNow() > live.data.ends_at + 150) {
            const key = `countdown|${live.rev}`;
            if (!revealAsked.has(key)) { revealAsked.add(key); api.admin.countdownDone().catch(() => revealAsked.delete(key)); }
            return;
        }
        if (!live || live.phase !== 'question' || !live.data.item) return;
        const id = `${live.data.item.id}|${live.data.deadline}`;
        if (serverNow() > live.data.deadline + 250 && !revealAsked.has(id)) {
            revealAsked.add(id);
            api.admin.reveal().catch(() => revealAsked.delete(id));
        }
    }, 250);
}

function mountLogin(message) {
    clear(root);
    root.className = 'lg';
    const email = h('input', { class: 'gk-input', type: 'email', autocomplete: 'username', placeholder: 'email', required: true, 'aria-label': 'אימייל' });
    const password = h('input', { class: 'gk-input', type: 'password', autocomplete: 'current-password', placeholder: 'סיסמה', required: true, 'aria-label': 'סיסמה' });
    const error = h('p', { class: 'pl-error', role: 'alert', hidden: !message, text: message || '' });
    const submit = h('button', { class: 'gk-btn', type: 'submit', text: 'כניסה' });
    root.append(h('form', { class: 'lg-card', onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        const ok = await api.signIn(email.value.trim(), password.value);
        if (ok) return boot();
        submit.disabled = false;
        error.hidden = false;
        // One message for every failure: which half was wrong is not the
        // visitor's business.
        error.textContent = 'הכניסה נכשלה';
    } },
    h('h1', { text: 'כניסת מנחה' }), email, password, error, submit,
    h('a', { class: 'lg-back', href: './', text: '→ חזרה למסך הכניסה' })));
}

async function boot() {
    if (isPreview) return mountStage({ withControls: false });
    const session = await api.currentSession();
    if (!session) return mountLogin();
    // Being signed in is not being a host: the allowlist decides. The server
    // enforces this on every call regardless; asking here only chooses between
    // a working console and an honest message.
    let allowed = false;
    try { allowed = await api.admin.isAdmin(); } catch { allowed = false; }
    if (!allowed) {
        await api.signOut();
        return mountLogin('החשבון הזה אינו מורשה לנהל חידונים');
    }
    await syncClock();
    setInterval(syncClock, 60_000);
    mountStage({ withControls: true, email: session.user?.email || '' });
}

boot();
