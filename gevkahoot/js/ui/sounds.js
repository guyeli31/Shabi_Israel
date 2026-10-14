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
 * A new Audio per play, so two in quick succession overlap instead of
 * cutting each other off; the browser serves the file from its cache.
 * Playback can be refused before the page has had a user gesture — that is
 * swallowed: a sound is never worth an error.
 */
export const SOUND = {
    correct: 'media/audio/Correct.mp3',
    wrong: 'media/audio/Wrong.mp3',
    applause: 'media/audio/Applause.mp3',
    buzzer: 'assets/sounds/buzzer.wav',
};

const VOLUME = { correct: 0.8, wrong: 0.7, applause: 0.85, buzzer: 0.9 };

export function playSound(key) {
    const src = SOUND[key];
    if (!src) return;
    try {
        const a = new Audio(src);
        a.volume = VOLUME[key] ?? 0.8;
        a.play().catch(() => {});
    } catch { /* no audio here */ }
}

/** Fetch them ahead, so the first one plays on time. */
export function preloadSounds(...keys) {
    for (const key of keys) {
        try { const a = new Audio(SOUND[key]); a.preload = 'auto'; } catch { /* ignore */ }
    }
}
