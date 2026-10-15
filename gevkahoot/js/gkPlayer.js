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
import { lockZoom, resetZoom } from './ui/touch.js';
import * as api from './data/api.js';
import { createStateSource, isPreview } from './data/stateSource.js';
import { syncClock, serverNow } from './data/clock.js';
import { createStage } from './host/stage.js';
import { createDemo } from './demo/engine.js';
import { listSavedQuizzes, loadSavedQuiz } from './demo/saved.js';
import { sliderVerdict, decodeRank } from './scoring.js';
import { hasUrlFlag } from '../../shabi-israel/js/utils/queryString.js';

const isDemo = hasUrlFlag('demo') && !isPreview;
// ?demo&quiz=<id>: a quiz saved in the database, played alone against the
// bots (js/demo/saved.js) — the same quiz the host runs live.
const savedQuizId = isDemo && /^[0-9a-f-]{36}$/i.test(new URLSearchParams(location.search).get('quiz') || '')
    ? new URLSearchParams(location.search).get('quiz') : null;

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
// legacy.js may have said "too old" in a browser that then coped after all.
app.querySelector('.pl-legacy')?.remove();
app.append(head, main, strip, foot);

let state = null;
let me = { player: false };
let meRev = null;          // the state rev `me` was last fetched for
let typedName = '';
let formError = null;      // { code, text }
let busy = false;
let picked = null;         // { itemId, option } — optimistic, until `me` confirms
let otherName = false;     // a pending relink set aside: "not me, I'll pick another name"
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
    onAnswer: (itemId, option, opts) => (opts?.again ? reportCount(itemId, option) : choose(itemId, option)),
    // The roulette's ball has landed: now the result may be told.
    onSettled: () => render(),
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

let demo = isDemo && !savedQuizId ? createDemo(onState) : null;
if (savedQuizId) {
    loadSavedQuiz(savedQuizId)
        .then((content) => { demo = createDemo(onState, content); })
        .catch((err) => {
            // Not opened for solo play, or being played live right now.
            renderKeyed(entry, 'saved-missing', () => view(
                h('div', { class: 'pl-emoji', text: '🔒' }),
                h('p', { class: 'pl-big', text: err.code === 'live' ? 'החידון הזה רץ עכשיו בלייב' : 'החידון הזה לא זמין לשחק לבד' }),
                h('p', { class: 'pl-sub', text: err.code === 'live' ? 'אפשר לשחק אותו לבד אחרי שהוא יסתיים.' : 'אפשר לנסות את החידון לדוגמה.' }),
                demoLink('פתח חידון לדוגמה')));
        });
}
if (!isDemo) createStateSource(onState);
// The quizzes the host opened for solo play, offered on the entry screens.
let savedQuizzes = [];
if (!isDemo && !isPreview) listSavedQuizzes().then((list) => { savedQuizzes = Array.isArray(list) ? list : []; render(); });

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
        otherName = false;
        await refreshMe();
    } catch (err) {
        formError = { code: err.code, text: errorText(err.code) };
        // A name already in the quiz is most often its owner back from a
        // crashed browser: the request to take it over goes to the host at
        // once (they approve or not), rather than waiting for a second tap.
        if (err.code === 'name_taken' && !demo && !relink) {
            try { await api.requestRelink(name); otherName = false; formError = null; await refreshMe(); } catch { /* keep the error */ }
        }
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

/** The action round: the running count of baskets, sent after every throw.
 *  Not an answer that closes anything — the server keeps the highest count —
 *  so it bypasses choose()'s "once only". At most ONE send is in flight: a
 *  throw made meanwhile only updates the count waiting to go, and when the
 *  send returns the latest count follows it. So a slow network gets fewer,
 *  later sends rather than a queue of stale ones (each of which the server
 *  serialises behind every other player's), and the count still always
 *  arrives. A failed send is overtaken by the next. */
let sending = false;
let toSend = null;         // { itemId, hits } — the newest count not yet sent
let shownHits = null;      // { itemId, hits } — this device's count, for the status line
function reportCount(itemId, hits) {
    shownHits = { itemId, hits };
    renderStrip();
    if (isPreview) return;
    if (demo) { demo.answer(itemId, hits); return; }
    toSend = { itemId, hits };
    if (!sending) sendCount();
}
async function sendCount() {
    sending = true;
    while (toSend) {
        const { itemId, hits } = toSend;
        toSend = null;
        try { await api.answer(itemId, hits); } catch { /* the next send carries the count */ }
    }
    sending = false;
    if (!me.answered) refreshMe();
}

// ---- entry views ----------------------------------------------------------
const view = (...children) => h('section', { class: 'pl-view' }, ...children);
const demoLink = (text, cls = 'gk-btn gk-btn--ghost') => h('a', { class: cls, href: './?demo', text });
/** One link per saved quiz the host opened for solo play. */
const savedLinks = () => savedQuizzes.map((q) => h('a', { class: 'gk-btn gk-btn--ghost', dir: 'auto',
    href: `./?demo&quiz=${encodeURIComponent(q.id)}`, text: `שחקו לבד: ${q.title}` }));

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
        isDemo && h('p', { class: 'pl-sub', text: savedQuizId
            ? 'החידון של המנחה, לבד מול שחקנים וירטואליים: בוחרים שם ומתחרים על המקום הראשון.'
            : 'כל סוגי השאלות, כמו בחידון אמיתי: בוחרים שם, רואים מי מצטרף, ומתחרים על המקום הראשון.' }),
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
        return [`idle|${savedQuizzes.map((q) => q.id).join()}`, () => view(
            h('div', { class: 'pl-status' }, h('span', { class: 'pl-dot' }), 'אין חידון באוויר'),
            h('h1', { class: 'pl-big', text: 'עוד לא התחלנו' }),
            h('p', { class: 'pl-sub', text: 'כשהמנחה יפתח חידון, ההרשמה תופיע כאן לבד.' }),
            demoLink('פתח חידון לדוגמה'),
            savedLinks(),
            h('p', { class: 'pl-sub pl-sub--small', text: 'משחק מלא מול שחקנים וירטואליים, בלי הרשמה.' }))];
    }
    if (me.kicked) return ['kicked', () => view(h('div', { class: 'pl-emoji', text: '🚪' }), h('p', { class: 'pl-big', text: 'הוסרת מהחידון' }))];
    if (status === 'finished') {
        return [`over|${savedQuizzes.map((q) => q.id).join()}`, () => view(h('div', { class: 'pl-emoji', text: '🏁' }), h('p', { class: 'pl-big', text: 'החידון הסתיים' }),
            demoLink('פתח חידון לדוגמה'), savedLinks())];
    }
    if (me.pending && !otherName) {
        return ['pending', () => view(
            h('div', { class: 'pl-emoji', text: '🙋' }),
            h('p', { class: 'pl-big', text: 'השם הזה כבר בחידון' }),
            h('p', { class: 'pl-sub', dir: 'auto', text: `אם ${typedName.trim() || 'השם'} זה השם שלך (למשל אחרי שהדפדפן קרס), נשלחה למנחה בקשה להעביר אותו למכשיר הזה עם כל הניקוד. ממתינים לאישור…` }),
            h('button', { class: 'gk-btn gk-btn--ghost', type: 'button', text: 'זה לא אני — אבחר שם אחר',
                onclick: () => { otherName = true; typedName = ''; render(); } }))];
    }
    // The host said it is not them: the same form, asking for another name.
    if (me.rejected && !formError && !otherName) formError = { code: 'rejected', text: 'החיבור לשם הזה לא אושר. בחרו שם אחר.' };
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
    if (phase === 'countdown') return ['countdown', 'plain', 'עוד רגע מתחילים — תתכוננו!', [go('התחל ▶')]];
    if (phase === 'interlude') return [`inter|${item?.id}`, 'plain', compact() && !demo ? 'עיניים למסך' : standing, [go('המשך ▶')]];
    if (phase === 'intro') return [`intro|${item?.id}`, 'plain', compact() && !demo ? 'מיד מתחילים — כך משחקים' : 'כך משחקים', [go('התחל ▶')]];
    if (phase === 'question' && item) {
        if (item.kind === 'action') {
            // Throwing until the bell: the line is the count, not "sent".
            const hits = Math.max(shownHits?.itemId === item.id ? shownHits.hits : 0, me.item_id === item.id ? me.option || 0 : 0);
            if (now < data.starts_at) return [`ready|${item.id}`, 'plain', '🏀 מתכוננים לזרוק…', []];
            const count = hits === 1 ? 'קליעה אחת' : `${hits} קליעות`;
            if (now > data.deadline) return [`late|${item.id}|${hits}`, 'sent', `נגמר הזמן · ${count}`, []];
            return [`throw|${item.id}|${hits}`, 'plain', hits ? `🏀 ${count} — עוד!` : 'גוררים את הכדור אל הסל ומשחררים', []];
        }
        const mine = me.answered && me.item_id === item.id ? me.option : picked?.itemId === item.id ? picked.option : null;
        if (mine !== null && mine !== undefined) return [`sent|${item.id}`, 'sent', 'נקלט! מחכים לכל השאר…', []];
        if (now < data.starts_at) return [`ready|${item.id}`, 'plain', item.kind === 'memory'
            ? 'שאלת זיכרון · זכרו את התמונה, השאלה תבוא אחריה'
            : `${item.kind === 'puzzle' ? 'פאזל' : 'שאלה'} ${item.no} מתוך ${item.of} · מתכוננים…`, []];
        if (now > data.deadline) return [`late|${item.id}`, 'none', 'נגמר הזמן', []];
        return [`open|${item.id}`, 'plain', { puzzle: 'גררו את החלקים אל המסגרת', spot: 'הקישו על האזור הנכון ואז ״הזן תשובה״', complete: 'נסו את האפשרויות על התמונה ואז ״הזן תשובה״', slider: 'הזיזו את הסליידר עד שהגודל מדויק ואז ״הזן תשובה״', rank: 'גררו את התשובות לפי הסדר ואז ״הזן תשובה״', roulette: 'שימו ז׳יטון על מספר ואז ״הזן תשובה״' }[item.kind] || 'בחרו תשובה', []];
    }
    // The leader slide before the last question is about the table, not the
    // question before it: show where this player stands.
    if (phase === 'fire' && data.fire?.lead) return [`lead|${state.rev}|${me.rank}|${me.points}`, 'plain', standing, [go('המשך ▶')]];
    // A roulette's result waits for the ball: until it lands, "right" or
    // "wrong" here would tell the player before the wheel does.
    if (phase === 'reveal' && item?.kind === 'roulette' && stage.spinning) return [`spin|${item.id}`, 'plain', '🎰 הכדור מתגלגל…', []];
    if (['reveal', 'explain', 'fastest', 'fire'].includes(phase) && item && item.kind !== 'interlude') {
        const r = me.result || {};
        // A run of three or more correct answers that this one extended.
        const fire = me.streak >= 3 ? ` · 🔥 ${me.streak} ברצף!` : '';
        const key = `res|${item.id}|${phase}|${me.answered}|${r.correct}|${r.points}|${me.streak}`;
        if (!me.answered) return [key, 'none', item.kind === 'puzzle' ? 'לא הספקת להרכיב' : item.kind === 'action' ? 'לא זרקת הפעם' : 'לא הספקת לענות', [go('המשך ▶')]];
        // The action round: the baskets, and what they were worth against the room.
        if (item.kind === 'action') {
            const best = Math.max(0, ...(data.values || []));
            const count = me.option === 1 ? 'קליעה אחת' : `${me.option} קליעות`;
            const top = me.option > 0 && me.option === best ? ' · הכי הרבה בחדר!' : '';
            return [key, r.correct ? 'good' : 'plain', `🏀 ${count} · ⁦+${r.points || 0}⁩${top}${fire}`, [go('המשך ▶')]];
        }
        // The slider is not right-or-wrong: the player is told how far off
        // they were (and what that was worth), whatever it was.
        if (item.kind === 'slider') {
            return [key, r.correct ? 'good' : 'plain', `⁦+${r.points || 0}⁩ · ${sliderVerdict(me.option, item.slider)}${fire}`, [go('המשך ▶')]];
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
/**
 * The goodbye: when a LIVE quiz this device played in is over, it moves on to
 * handoff.html — the Shabi Israel loading screen with the farewell line, then
 * the site's main page. "Over" is the host moving past the podium to the
 * matrix (the last screen), or taking the finished quiz off the air from the
 * podium (by then the server has forgotten this device, so the page
 * remembers that it was a player in a finished quiz). Never in the demo or
 * the editor's preview.
 */
let playedToTheEnd = false;
function farewell() {
    if (isDemo || isPreview || !state) return false;
    if (state.status === 'finished' && me.player) playedToTheEnd = true;
    const over = (state.status === 'finished' && state.phase === 'matrix' && me.player)
        || (state.status === 'idle' && playedToTheEnd);
    if (over) location.replace('handoff.html');
    return over;
}

function render() {
    if (!state || state.rev === -1) return;
    if (farewell()) return;
    if (me.answered && picked && picked.itemId === me.item_id) picked = null;
    if (picked && state.data.item?.id !== picked.itemId) picked = null;

    const pickedEntry = pickEntry();
    const playing = !pickedEntry;
    entry.hidden = playing;
    stageFrame.hidden = !playing;
    foot.hidden = playing;
    app.toggleAttribute('data-playing', playing);
    // While playing the page does not zoom (js/ui/touch.js), and a page that
    // got zoomed anyway is put back on every new screen.
    if (!isPreview) { lockZoom(playing); if (playing) resetZoom(); }

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

    // During a roulette spin the score still shows what it was before this
    // question — the new total would give the result away.
    const points = (me.points ?? 0) - (stage.spinning ? me.result?.points || 0 : 0);
    renderKeyed(head, `${me.player}|${me.name}|${points}|${isDemo}`, () => [
        h('div', { class: 'pl-brand' }, 'Gev', h('b', { text: 'Kahoot' }), isDemo && h('span', { class: 'pl-demo-tag', text: 'הדגמה' })),
        me.player && h('div', { class: 'pl-chip' },
            h('span', { class: 'pl-chip-name', dir: 'auto', text: me.name }),
            h('span', { class: 'pl-chip-points', text: String(points) })),
    ]);
}
