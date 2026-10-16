/**
 * sounds.js — the quiz's fixed sound effects. Not a setting: every quiz has
 * them, and no editor field changes them.
 *
 *   correct   a right answer (any kind — the server's verdict in gk_me), and
 *             every basket in the action round
 *   wrong     a wrong answer, and every missed throw
 *   applause  the winners (the podium)
 *   buzzer    the end of the action round's time
 *
 * The first three are the files the host dropped into media/audio/ (keep
 * them there — renaming or deleting one silences it); the buzzer is the
 * app's own, synthesised by scripts/gevkahoot-sounds.mjs.
 *
 * Played through Web Audio: each file is fetched and decoded ONCE, and a play
 * is a buffer started on one shared AudioContext. It used to be a new
 * <audio> per play, which iOS Safari refuses whenever the play is not inside
 * a touch — the reveal's verdict and a basket's sound arrive from a timer, so
 * on an iPhone they were silent — and dozens of them during a round of
 * throws weighed on a phone. An AudioContext needs ONE touch to be allowed
 * to sound (unlock below), after which it plays at any time. Where there is
 * no Web Audio the old way is kept. A sound is never worth an error.
 */
export const SOUND = {
    correct: 'media/audio/Correct.mp3',
    wrong: 'media/audio/Wrong.mp3',
    applause: 'media/audio/Applause.mp3',
    buzzer: 'assets/sounds/buzzer.wav',
};

const VOLUME = { correct: 0.8, wrong: 0.7, applause: 0.85, buzzer: 0.9 };

const Ctx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let ctx = null;
const decoded = new Map();     // key → Promise<AudioBuffer | null>
// A sound that came while the context could not wake (an iPhone locked while
// waiting for the reveal): played at the next wake-up, if still in time.
let pending = null;            // { key, buffer, until }
const PENDING_MS = 6000;

/*
 * ?sounddebug — a few lines in the corner saying what became of each sound
 * (the context's state, played / held / dropped). For a phone that is silent
 * only sometimes, where the console cannot be seen.
 */
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sounddebug');
let debugBox = null;
function note(text) {
    if (!DEBUG) return;
    if (!debugBox) {
        debugBox = document.createElement('div');
        Object.assign(debugBox.style, { position: 'fixed', left: '6px', bottom: '6px', zIndex: 99999, maxWidth: '90vw',
            font: '12px/1.35 monospace', color: '#fff', background: 'rgba(0,0,0,.75)', padding: '4px 6px', borderRadius: '6px',
            pointerEvents: 'none', direction: 'ltr', whiteSpace: 'pre' });
        document.body.append(debugBox);
    }
    const t = new Date().toTimeString().slice(0, 8);
    debugBox.textContent = [...debugBox.textContent.split('\n').filter(Boolean).slice(-5), `${t} ${text}`].join('\n');
}

function context() {
    if (!Ctx) return null;
    if (!ctx) { try { ctx = new Ctx(); } catch { return null; } }
    return ctx;
}

/** Every touch, click or key while the context is not running: resume it, and
 *  on iOS also start one silent buffer inside the gesture — that is what
 *  unlocks it there. The listeners STAY: a context that ran can be suspended
 *  again (the phone locked, another app took the sound, the tab went to the
 *  background), and only a gesture can wake it on iOS. They used to be
 *  removed after the first unlock — and from the first suspension on, a
 *  phone was silent for the rest of the quiz: no right / wrong, no baskets,
 *  no winner's applause. */
function unlock() {
    const c = context();
    if (!c || c.state === 'running') return;
    c.resume().then(flushPending, () => {});
    try {
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, 22050);
        s.connect(c.destination);
        s.start(0);
    } catch { /* ignore */ }
}
const GESTURES = ['pointerdown', 'touchend', 'keydown'];
// On an iPhone, Web Audio follows the ring/silent switch: with the phone on
// silent every effect was mute — no right / wrong, no applause — while a
// video still played. Declaring the page's audio as "playback" (Safari 16.4+)
// makes it sound as media does. Where the API does not exist, nothing changes.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browser */ }
if (Ctx) {
    for (const t of GESTURES) addEventListener(t, unlock, { capture: true, passive: true });
    // Back on screen: try to resume at once (allowed on most browsers; on iOS
    // the next touch does it).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().then(flushPending, () => {});
    });
}

function load(key) {
    if (!decoded.has(key)) {
        const c = context();
        decoded.set(key, !c ? Promise.resolve(null) : fetch(SOUND[key])
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            // the callback form: older Safari has no promise-returning decodeAudioData
            .then((bytes) => new Promise((resolve, reject) => c.decodeAudioData(bytes, resolve, reject)))
            .catch(() => null));
    }
    return decoded.get(key);
}

function start(buffer, key) {
    const c = context();
    const src = c.createBufferSource();
    const gain = c.createGain();
    gain.gain.value = VOLUME[key] ?? 0.8;
    src.buffer = buffer;
    src.connect(gain).connect(c.destination);
    src.start(0);
}

export function playSound(key) {
    if (!SOUND[key]) return;
    const c = context();
    if (!c) {
        try { const a = new Audio(SOUND[key]); a.volume = VOLUME[key] ?? 0.8; a.play().catch(() => {}); } catch { /* no audio here */ }
        return;
    }
    const asked = performance.now();
    const state = c.state;
    // Wake it from ANY state but running: an iPhone's context goes
    // "interrupted" (screen locked, a notification, another app's sound), not
    // "suspended" — and a sound started into a context that is not running is
    // simply lost. That was the "sometimes there is a sound, sometimes not".
    const awake = state === 'running' ? Promise.resolve(true)
        : Promise.race([c.resume().then(() => c.state === 'running', () => false),
            new Promise((ok) => setTimeout(() => ok(c.state === 'running'), 800))]);
    Promise.all([load(key), awake]).then(([buffer, running]) => {
        if (!buffer) { note(`${key}: not loaded (state ${state}) — dropped`); return; }
        // A sound half a second late (beyond the wake-up) is about something
        // else already — skip it. (preloadSounds fetches them ahead.)
        const late = performance.now() - asked > (state === 'running' ? 600 : 1500);
        if (running && !late) {
            try { start(buffer, key); note(`${key}: played (was ${state})`); } catch { note(`${key}: failed to start`); }
        } else if (!running) {
            // Could not wake without a gesture: hold it for the next touch or
            // the return to the screen, a few seconds at most.
            pending = { key, buffer, until: asked + PENDING_MS };
            note(`${key}: held — context ${c.state}`);
        } else note(`${key}: too late — dropped`);
    });
}

/** The context is running again: a held sound, if still in time, plays now. */
function flushPending() {
    if (!pending || !ctx || ctx.state !== 'running') return;
    const p = pending;
    pending = null;
    if (performance.now() > p.until) { note(`${p.key}: held too long — dropped`); return; }
    try { start(p.buffer, p.key); note(`${p.key}: played after wake-up`); } catch { /* ignore */ }
}

/** Fetch and decode them ahead, so the first one plays on time. */
export function preloadSounds(...keys) {
    for (const key of keys) if (SOUND[key]) load(key);
}
