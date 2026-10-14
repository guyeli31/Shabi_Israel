/**
 * gkPlayer.js — index.html: the entry screen, and a player's whole quiz.
 *
 * The page is a function of three things: the public state (what is on air),
 * `me` (who this device is), and the clock. Nothing else is remembered, which
 * is the whole reconnect story — a refresh re-reads all three and lands on the
 * same screen.
 *
 * Once joined, a player watches the same stage the host projects
 * (js/host/stage.js) and answers on it: a desktop gets the full screen with
 * the option texts; a phone gets the question and its picture with colour-only
 * answers. Under the stage sits one line of personal status.
 *
 * Three sources can feed the page, and the rendering below never asks which:
 *   live      the backend (stateSource.js + gk_me)
 *   ?demo     a quiz played entirely in this browser against bots (demo/engine.js)
 *   ?preview  the editor's frame, fed by postMessage
 */
import { h, clear, renderKeyed } from './ui/dom.js';
import * as api from './data/api.js';
import { createStateSource, isPreview } from './data/stateSource.js';
import { syncClock, serverNow } from './data/clock.js';
import { createStage } from './host/stage.js';
import { createDemo } from './demo/engine.js';
import { sliderVerdict, decodeRank } from './scoring.js';
import { hasUrlFlag } from '../../shabi-israel/js/utils/queryString.js';

const isDemo = hasUrlFlag('demo') && !isPreview;

const app = document.getElementById('app');
const head = h('header', { class: 'pl-head' });
const main = h('main', { class: 'pl-main' });
const entry = h('div', { class: 'pl-entry' });
const stageFrame = h('div', { class: 'pl-stage', hidden: true });
const strip = h('div', { class: 'pl-strip', hidden: true });
const foot = h('footer', { class: 'pl-foot' },
    // Always present on the entry screens: the way in for the host.
    h('a', { class: 'pl-admin', href: 'host.html', text: 'ADMIN LOGIN' }));
main.append(entry, stageFrame);
app.append(head, main, strip, foot);

let state = null;
let me = { player: false };
let meRev = null;          // the state rev `me` was last fetched for
let typedName = '';
let formError = null;      // { code, text }
let busy = false;
let picked = null;         // { itemId, option } — optimistic, until `me` confirms
let demoUntil = null;      // demo only: when the current pause ends by itself

/** A phone: touch, or simply narrow (which is also the editor's phone frame). */
const compact = () => matchMedia('(pointer: coarse)').matches || innerWidth < 760;

const stage = createStage(stageFrame, {
    role: 'player',
    compact,
    // The demo has no projected screen, so this device plays everything. In a
    // live quiz the room already has the sound: a desktop shows video muted
    // and a phone shows pictures only.
    media: () => (isDemo ? 'full' : compact() ? 'still' : 'muted'),
    muted: isPreview,
    onAnswer: (itemId, option) => choose(itemId, option),
});

const ERRORS = {
    name_taken: 'השם הזה כבר תפוס',
    bad_name: 'שם באורך 2 עד 20 תווים',
    locked: 'ההרשמה נסגרה',
    full: 'החידון מלא',
    kicked: 'הוסרת מהחידון',
    no_quiz: 'אין כרגע חידון באוויר',
    no_such_player: 'אין שחקן רשום בשם הזה',
};
const errorText = (code) => ERRORS[code] || 'משהו השתבש, נסו שוב';

// ---- data -----------------------------------------------------------------
async function refreshMe() {
    if (isPreview || isDemo) return;
    try {
        me = (await api.me()) || { player: false };
        render();
    } catch { /* offline for a moment; the next state change retries */ }
}

function onState(next, extra) {
    state = next;
    if (extra && 'me' in extra) me = extra.me || { player: false };
    if (extra?.demo) demoUntil = extra.demo.until;
    document.documentElement.dataset.theme = state.data?.quiz?.theme || 'stadium';
    if (!isPreview && !isDemo && state.rev !== meRev) { meRev = state.rev; refreshMe(); }
    render();
}

const demo = isDemo ? createDemo(onState) : null;
if (!isDemo) createStateSource(onState);

if (!isPreview && !isDemo) {
    syncClock();
    setInterval(syncClock, 60_000);
    // While waiting for the host to approve a device link there is no state
    // change to react to, so ask; otherwise this doubles as the heartbeat that
    // tells the host who is still connected.
    setInterval(() => {
        if (document.hidden || !state || state.status === 'idle') return;
        if (me.pending || me.player) refreshMe();
    }, 4000);
}
// The status line follows the clock (get ready → answer → time's up).
setInterval(() => { if (state && (state.phase === 'question' || demoUntil)) renderStrip(); }, 250);

// ---- actions --------------------------------------------------------------
async function submitJoin(relink) {
    const name = typedName.trim();
    if (busy || isPreview) return;
    busy = true; formError = null; render();
    try {
        if (demo) demo.join(name);
        else if (relink) await api.requestRelink(name);
        else await api.join(name);
        await refreshMe();
    } catch (err) {
        formError = { code: err.code, text: errorText(err.code) };
    }
    busy = false; render();
}

async function choose(itemId, option) {
    if (picked?.itemId === itemId || (me.answered && me.item_id === itemId)) return;
    picked = { itemId, option };
    render();
    if (isPreview) return;
    if (demo) { demo.answer(itemId, option); return; }
    try {
        await api.answer(itemId, option);
    } catch (err) {
        // 'already_answered' means an earlier tap got through — that IS success.
        if (err.code !== 'already_answered') picked = null;
    }
    refreshMe();
}

// ---- entry views ----------------------------------------------------------
const view = (...children) => h('section', { class: 'pl-view' }, ...children);
const demoLink = (text, cls = 'gk-btn gk-btn--ghost') => h('a', { class: cls, href: './?demo', text });

function joinView() {
    const taken = formError?.code === 'name_taken';
    const locked = !isDemo && !!state.data?.locked;
    const input = h('input', {
        class: 'gk-input', type: 'text', maxlength: '20', autocomplete: 'off', enterkeyhint: 'go',
        placeholder: 'השם שלך', value: typedName, 'aria-label': 'השם שלך',
        oninput: (e) => { typedName = e.target.value; },
    });
    return view(
        isDemo
            ? h('div', { class: 'pl-status' }, h('span', { class: 'pl-dot' }), 'הדגמה · מול שחקנים וירטואליים')
            : h('div', { class: 'pl-status', dataset: { live: '' } }, h('span', { class: 'pl-dot' }), 'חידון באוויר'),
        h('h1', { class: 'pl-big', dir: 'auto', text: state.data?.quiz?.title || 'GevKahoot' }),
        isDemo && h('p', { class: 'pl-sub', text: 'כל סוגי השאלות, כמו בחידון אמיתי: בוחרים שם, רואים מי מצטרף, ומתחרים על המקום הראשון.' }),
        h('form', { class: 'pl-form', onsubmit: (e) => { e.preventDefault(); typedName = input.value; submitJoin(locked); } },
            input,
            formError && h('p', { class: 'pl-error', role: 'alert', text: formError.text }),
            !locked && h('button', { class: 'gk-btn', type: 'submit', disabled: busy, text: 'יאללה, אני בפנים' }),
            !isDemo && (taken || locked) && h('button', {
                class: `gk-btn ${locked ? '' : 'gk-btn--ghost'}`, type: 'button', disabled: busy,
                text: 'זה אני — חיבור מחדש',
                onclick: () => { typedName = input.value; submitJoin(true); },
            })),
        locked
            ? h('p', { class: 'pl-sub', text: 'ההרשמה נסגרה. מי שכבר נרשם והתנתק: כותבים את השם ומבקשים חיבור מחדש.' })
            : !isDemo && taken && h('p', { class: 'pl-sub', text: 'אם זה השם שלך מקודם, אפשר לבקש חיבור מחדש והמנחה יאשר.' }),
        isDemo
            ? h('a', { class: 'pl-link', href: './', text: 'חזרה למסך הכניסה' })
            : demoLink('או נסו קודם חידון לדוגמה', 'pl-link'));
}

/** The screen before (or instead of) playing. Returns [key, build], or null
 *  when this device is a player and the stage should be shown. */
function pickEntry() {
    const { status, data } = state;
    if (me.player) return null;
    if (status === 'idle') {
        return ['idle', () => view(
            h('div', { class: 'pl-status' }, h('span', { class: 'pl-dot' }), 'אין חידון באוויר'),
            h('h1', { class: 'pl-big', text: 'עוד לא התחלנו' }),
            h('p', { class: 'pl-sub', text: 'כשהמנחה יפתח חידון, ההרשמה תופיע כאן לבד.' }),
            demoLink('פתח חידון לדוגמה'),
            h('p', { class: 'pl-sub pl-sub--small', text: 'משחק מלא מול שחקנים וירטואליים, בלי הרשמה.' }))];
    }
    if (me.kicked) return ['kicked', () => view(h('div', { class: 'pl-emoji', text: '🚪' }), h('p', { class: 'pl-big', text: 'הוסרת מהחידון' }))];
    if (status === 'finished') {
        return ['over', () => view(h('div', { class: 'pl-emoji', text: '🏁' }), h('p', { class: 'pl-big', text: 'החידון הסתיים' }),
            demoLink('פתח חידון לדוגמה'))];
    }
    if (me.pending) {
        return ['pending', () => view(
            h('div', { class: 'pl-emoji', text: '🙋' }),
            h('p', { class: 'pl-big', text: 'ממתינים לאישור המנחה' }),
            h('p', { class: 'pl-sub', dir: 'auto', text: `ספרו למנחה שזה ${typedName.trim() || 'השחקן שהתנתק'}.` }))];
    }
    return [`join|${formError?.code || ''}|${busy}|${!!data.locked}`, joinView];
}

// ---- the status line under the stage --------------------------------------
/** [key, tone, text, buttons] — one line about THIS player. */
function stripContent() {
    const { status, phase, data } = state;
    const item = data.item;
    const now = serverNow();
    const left = demoUntil ? Math.max(0, Math.ceil((demoUntil - Date.now()) / 1000)) : null;
    const go = (text) => demo && demoUntil && h('button', { class: 'gk-btn gk-btn--small', type: 'button', text, onclick: () => demo.skip() });
    const standing = `מקום ${me.rank ?? '–'} מתוך ${me.players ?? 0} · ${me.points ?? 0} נק׳`;

    if (status === 'finished') {
        return [`fin|${phase}|${!!demoUntil}`, 'plain', `סיימת במקום ${me.rank} עם ${me.points} נקודות`, [
            go('למטריצה ▶'),
            demo && h('button', { class: 'gk-btn gk-btn--small gk-btn--ghost', type: 'button', text: 'שחק שוב', onclick: () => { picked = null; demo.restart(); } }),
            demo && h('a', { class: 'gk-btn gk-btn--small gk-btn--ghost', href: './', text: 'יציאה' }),
        ]];
    }
    if (phase === 'lobby') {
        return demo
            ? [`lobby|${left}`, 'plain', `${me.name}, נכנסת! מתחילים בעוד ${left} שניות`, [go('התחל עכשיו ▶')]]
            : ['lobby', 'plain', `${me.name}, נכנסת! מחכים שהמנחה יתחיל`, []];
    }
    if (phase === 'interlude') return [`inter|${item?.id}`, 'plain', compact() && !demo ? 'עיניים למסך' : standing, [go('המשך ▶')]];
    if (phase === 'intro') return [`intro|${item?.id}`, 'plain', compact() && !demo ? 'מיד מתחילים — כך משחקים' : 'כך משחקים', [go('התחל ▶')]];
    if (phase === 'question' && item) {
        const mine = me.answered && me.item_id === item.id ? me.option : picked?.itemId === item.id ? picked.option : null;
        if (mine !== null && mine !== undefined) return [`sent|${item.id}`, 'sent', 'נקלט! מחכים לכל השאר…', []];
        if (now < data.starts_at) return [`ready|${item.id}`, 'plain', `${item.kind === 'puzzle' ? 'פאזל' : 'שאלה'} ${item.no} מתוך ${item.of} · מתכוננים…`, []];
        if (now > data.deadline) return [`late|${item.id}`, 'none', 'נגמר הזמן', []];
        return [`open|${item.id}`, 'plain', { puzzle: 'גררו את החלקים אל המסגרת', spot: 'הקישו על האזור הנכון ואז ״הזן תשובה״', complete: 'נסו את האפשרויות על התמונה ואז ״הזן תשובה״', slider: 'הזיזו את הסליידר עד שהגודל מדויק ואז ״הזן תשובה״', rank: 'גררו את התשובות לפי הסדר ואז ״הזן תשובה״' }[item.kind] || 'בחרו תשובה', []];
    }
    // The leader slide before the last question is about the table, not the
    // question before it: show where this player stands.
    if (phase === 'fire' && data.fire?.lead) return [`lead|${state.rev}|${me.rank}|${me.points}`, 'plain', standing, [go('המשך ▶')]];
    if (['reveal', 'explain', 'fastest', 'fire'].includes(phase) && item && item.kind !== 'interlude') {
        const r = me.result || {};
        // A run of three or more correct answers that this one extended.
        const fire = me.streak >= 3 ? ` · 🔥 ${me.streak} ברצף!` : '';
        const key = `res|${item.id}|${phase}|${me.answered}|${r.correct}|${r.points}|${me.streak}`;
        if (!me.answered) return [key, 'none', item.kind === 'puzzle' ? 'לא הספקת להרכיב' : 'לא הספקת לענות', [go('המשך ▶')]];
        // The slider is not right-or-wrong: the player is told how far off
        // they were (and what that was worth), whatever it was.
        if (item.kind === 'slider') {
            return [key, r.correct ? 'good' : 'plain', `⁦+${r.points || 0}⁩ · ${sliderVerdict(me.option)}${fire}`, [go('המשך ▶')]];
        }
        const cheer = item.kind === 'puzzle' ? 'הרכבת!' : item.kind === 'rank' ? 'סידרת בדיוק!' : 'נכון!';
        return r.correct
            // The isolate keeps "+965" reading as +965 inside the Hebrew line;
            // without it the bidi algorithm moves the plus to the far side.
            ? [key, 'good', `${r.points > 0 ? `${cheer} ⁦+${r.points}⁩` : cheer}${fire}`, [go('המשך ▶')]]
            : [key, 'bad', item.kind === 'rank' ? rankMiss(item) : 'לא הפעם', [go('המשך ▶')]];
    }
    return [`rank|${state.rev}|${me.rank}|${me.points}`, 'plain', standing, [go('המשך ▶')]];
}

/** "2 מתוך 4 במקום" — how close a ranking answer came. */
function rankMiss(item) {
    const n = item.options.length;
    const mine = decodeRank(me.option, n), correct = state.data.correct || [];
    if (!mine || correct.length !== n) return 'לא הסדר הנכון';
    const ok = mine.filter((opt, place) => correct[place] === opt).length;
    return `לא הסדר הנכון · ${ok} מתוך ${n} במקום`;
}

function renderStrip() {
    if (!state || !me.player) { strip.hidden = true; return; }
    strip.hidden = false;
    const [key, tone, text, buttons] = stripContent();
    strip.dataset.tone = tone;
    renderKeyed(strip, `${key}|${text}`, () => [
        h('span', { class: 'pl-strip-text', dir: 'auto', role: 'status', text }),
        h('span', { class: 'pl-strip-actions' }, buttons),
    ]);
}

// ---- render ---------------------------------------------------------------
function render() {
    if (!state || state.rev === -1) return;
    if (me.answered && picked && picked.itemId === me.item_id) picked = null;
    if (picked && state.data.item?.id !== picked.itemId) picked = null;

    const pickedEntry = pickEntry();
    const playing = !pickedEntry;
    entry.hidden = playing;
    stageFrame.hidden = !playing;
    foot.hidden = playing;
    app.toggleAttribute('data-playing', playing);

    if (playing) {
        // The stage marks the chosen answer from `me`; fold the optimistic tap
        // in so the tile responds at once instead of after the round trip.
        const item = state.data.item;
        const shown = picked && item && picked.itemId === item.id && !me.answered
            ? { ...me, item_id: item.id, option: picked.option }
            : me;
        stage.render(state, shown);
    } else {
        clear(strip);
        delete strip.dataset.viewKey;
        renderKeyed(entry, pickedEntry[0], pickedEntry[1]);
    }
    renderStrip();

    renderKeyed(head, `${me.player}|${me.name}|${me.points}|${isDemo}`, () => [
        h('div', { class: 'pl-brand' }, 'Gev', h('b', { text: 'Kahoot' }), isDemo && h('span', { class: 'pl-demo-tag', text: 'הדגמה' })),
        me.player && h('div', { class: 'pl-chip' },
            h('span', { class: 'pl-chip-name', dir: 'auto', text: me.name }),
            h('span', { class: 'pl-chip-points', text: String(me.points ?? 0) })),
    ]);
}
