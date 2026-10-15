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

function context() {
    if (!Ctx) return null;
    if (!ctx) { try { ctx = new Ctx(); } catch { return null; } }
    return ctx;
}

/** The first touch, click or key: resume the context, and on iOS also start
 *  one silent buffer inside the gesture — that is what unlocks it there. */
function unlock() {
    const c = context();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    try {
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, 22050);
        s.connect(c.destination);
        s.start(0);
    } catch { /* ignore */ }
    if (c.state === 'running') for (const t of GESTURES) removeEventListener(t, unlock, true);
}
const GESTURES = ['pointerdown', 'touchend', 'keydown'];
if (Ctx) for (const t of GESTURES) addEventListener(t, unlock, { capture: true, passive: true });

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
    if (c.state === 'suspended') c.resume().catch(() => {});
    const asked = performance.now();
    load(key).then((buffer) => {
        // Not loaded in time (preloadSounds is called ahead for that): a sound
        // half a second late is about something else already — skip it.
        if (buffer && performance.now() - asked < 600) { try { start(buffer, key); } catch { /* ignore */ } }
    });
}

/** Fetch and decode them ahead, so the first one plays on time. */
export function preloadSounds(...keys) {
    for (const key of keys) if (SOUND[key]) load(key);
}
