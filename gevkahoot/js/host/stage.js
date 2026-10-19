/**
 * stage.js — the quiz screen: the projected one, and every player's.
 *
 * A pure rendering of the public state: it holds no quiz logic and makes no
 * decisions, which is why the editor can frame this exact module and feed it
 * invented state to preview a design. The host controls live in drawer.js and
 * are layered on top by gkHost.js.
 *
 * The same stage is what a PLAYER sees (gkPlayer.js), with three differences,
 * all options here:
 *   role     'player' makes the answers buttons, and drops the "how to join"
 *            panel from the lobby.
 *   compact  a phone: one column, and the answers are colour-and-emblem only —
 *            the question and its picture are shown, the option texts are not.
 *   media    'full'  plays everything (the projected screen; the demo);
 *            'muted' plays video silently and no audio (a desktop player in a
 *                    room where the projected screen already has the sound);
 *            'still' shows pictures only (a phone in that same room).
 *
 * Each phase is rebuilt only when its key changes (renderKeyed), and the
 * things that move inside a phase — the countdown, the "answered" counter,
 * the lobby's names — are updated in place by sync(), so a counter ticking up
 * never restarts a video or an entrance animation.
 */
import { h, svgEl, clear, renderKeyed, safeMedia, fmtSeconds } from '../ui/dom.js';
import { tile } from '../ui/teams.js';
import { leaderboard, podium, matrix, confetti, moneyRain, winnerMoment, multiplier } from '../ui/views.js';
import { serverNow as liveNow } from '../data/clock.js';
import { createBouncers } from './bouncers.js';
import { createPuzzle, circleCutout } from './puzzle.js';
import { memoryPicture } from './memory.js';
import { createTable, createWheel, colourOf, noMoreBets, NO_MORE_BETS_MS, SPIN_MS, SETTLE_MS } from './roulette.js';
import { createSpot } from './spot.js';
import { createComplete } from './complete.js';
import { createSlider } from './slider.js';
import { createRank } from './rank.js';
import { createAction, actionResults } from './action.js';
import { playSound, preloadSounds } from '../ui/sounds.js';
import { introSlide, hasIntro } from './intro.js';

const WEIGHT_BADGE = { 0: 'חימום · בלי ניקוד', 2: 'שאלה כפולה ×2' };
/** The one-time "first to three in a row" animation (a generated, self-contained SVG). */
const FIRST_STREAK_ANIM = 'media/animations/first-streak.svg';

// The puzzle's reveal: the whole picture, then the cut, then the lift.
// (10s until the host's request to shorten it: the room was waiting on a
// held picture well past the point of having seen it.)
const SHOW_WHOLE_MS = 3000, CUT_DRAW_MS = 1600, CUT_MS = 2600, FADE_MS = 1600;
/** How long the puzzle's reveal takes to play out, up to the detail
 *  bouncing — what the demo, which has no host to press "next", waits for. */
export const PUZZLE_REVEAL_MS = SHOW_WHOLE_MS + CUT_MS + FADE_MS;

export function createStage(frame, { muted = false, joinUrl = '', role = 'host', compact = () => false, media = () => 'full', onAnswer = null, onSettled = null, texts = () => false } = {}) {
    // `frame` is the size container; the stage inside it is laid out in units
    // of that container (see host.css), so it scales the same on a projector,
    // in a player's browser, and in the editor's preview.
    const root = h('div', { class: 'st', dataset: { role } });
    frame.classList.add('st-frame');
    frame.append(root);
    // `texts`: a phone shows the answers' TEXT too, not only colour and
    // emblem — in the demo, where no projected screen shows them (the host's
    // request). The live phone keeps colour-only: the room reads the screen.
    const applyCompact = () => { root.toggleAttribute('data-compact', !!compact()); root.toggleAttribute('data-texts', !!texts()); };
    applyCompact();
    window.addEventListener('resize', applyCompact);
    const mode = () => (muted ? 'muted' : media());
    // The stage's clock. The editor's preview freezes it (`frozen_at` in its
    // invented state): a question shown there must not run out — it used to
    // lock after its time limit, and the slider in the preview "would not move".
    const serverNow = () => state?.data?.frozen_at ?? liveNow();

    const bg = h('div', { class: 'st-bg' });
    const title = h('div', { class: 'st-title', dir: 'auto' });
    const progress = h('div', { class: 'st-progress' });
    const timer = h('div', { class: 'st-timer', hidden: true }, h('span', { class: 'st-timer-num' }));
    const main = h('main', { class: 'st-main' });
    const music = h('audio', { loop: true, preload: 'none' });
    root.append(bg, h('header', { class: 'st-top' }, timer, title, progress), main, music);
    music.volume = 0.35;
    const bouncers = createBouncers(root);

    // ---- the puzzle's reveal: its round detail lifts off the picture --------
    // The picture appears whole; then all of it but the host's round detail
    // fades away, and that detail — at exactly the size it had in the picture —
    // sets off bouncing from where it sat. One copy, at the puzzle's own speed.
    let lift = null;        // { key, timers, ghost } — the run in progress
    function stopLift() {
        if (!lift) return;
        lift.timers.forEach(clearTimeout);
        lift.ghost?.remove();
        for (const el of lift.cut || []) el.remove();
        lift = null;
    }
    /** Where the picture's pixels actually are inside its (object-fit:
     *  contain) element. */
    function contentBox(img) {
        const b = img.getBoundingClientRect();
        if (!img.naturalWidth || !img.naturalHeight) return b;
        const k = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
        const w = img.naturalWidth * k, hgt = img.naturalHeight * k;
        return { left: b.left + (b.width - w) / 2, top: b.top + (b.height - hgt) / 2, width: w, height: hgt };
    }
    function startLift(key, image, circle) {
        stopLift();
        bouncers.update(null);
        const run = lift = { key, timers: [], ghost: null };
        const later = (ms, fn) => run.timers.push(setTimeout(() => { if (lift === run) fn(); }, ms));
        circleCutout(image, circle).then((src) => {
            if (lift !== run || !src) return;
            // The assembled picture is shown whole and large for ten seconds
            // (the host's request: the room looks at what it built) …
            later(SHOW_WHOLE_MS, () => {
                const pic = main.querySelector('.st-puzzle-reveal .st-media-el');
                if (!pic) return;
                const box = contentBox(pic);
                const at = root.getBoundingClientRect();
                const r = circle.r * Math.min(box.width, box.height);
                const cx = box.left + circle.x * box.width - at.left;
                const cy = box.top + circle.y * box.height - at.top;
                // … then the cut is SHOWN: the rest of the picture dims, a line
                // is drawn round the detail and scissors run along it …
                run.cut = cutMarks({ box, at, cx, cy, r });
                root.append(...run.cut);
                later(CUT_MS, () => {
                // … and only then does the rest fade and the detail lift off.
                // A still copy laid exactly over the detail, so that what stays
                // behind while the picture fades is the picture's own piece.
                run.ghost = h('img', { class: 'st-lift', src, alt: '', draggable: 'false',
                    style: { width: `${2 * r}px`, height: `${2 * r}px`, transform: `translate3d(${cx - r}px, ${cy - r}px, 0)` } });
                root.append(run.ghost);
                pic.dataset.fade = '';
                for (const el of run.cut) el.dataset.out = '';
                // Faded: hand the detail to the bouncing layer, same size and
                // same place, and drop the still copy in the same frame.
                later(FADE_MS, () => {
                    const W = root.clientWidth, H = root.clientHeight;
                    bouncers.update({ src, count: 1, size: (2 * r) / Math.min(W, H) * 100,
                        speed: circle.speed || 4, front: true, start: { x: cx / W, y: cy / H } });
                    requestAnimationFrame(() => { run.ghost?.remove(); run.ghost = null; for (const el of run.cut || []) el.remove(); });
                });
                });
            });
        });
    }

    /** The cut, drawn: a dimming veil with a round hole over the detail, the
     *  circle traced in white, and scissors running once round it. */
    function cutMarks({ box, at, cx, cy, r }) {
        const veil = h('div', { class: 'st-cut-veil' });
        Object.assign(veil.style, { left: `${box.left - at.left}px`, top: `${box.top - at.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        const hole = `radial-gradient(circle at ${cx - (box.left - at.left)}px ${cy - (box.top - at.top)}px, transparent ${r}px, #000 ${r + 1}px)`;
        veil.style.webkitMaskImage = hole;
        veil.style.maskImage = hole;
        const c = 2 * Math.PI * r;
        const ring = svgEl('svg', { class: 'st-cut-ring', width: String(2 * r + 12), height: String(2 * r + 12),
            viewBox: `${-r - 6} ${-r - 6} ${2 * r + 12} ${2 * r + 12}` },
            svgEl('circle', { cx: 0, cy: 0, r: String(r) }));
        // through the CSSOM: the page's CSP refuses a style ATTRIBUTE
        ring.firstChild.style.setProperty('--c', String(c));
        ring.style.transform = `translate(${cx - r - 6}px, ${cy - r - 6}px)`;
        const scissors = h('span', { class: 'st-cut-scissors', 'aria-hidden': 'true', text: '✂️' });
        // once round the circle, the blades pointing along it
        const frames = Array.from({ length: 25 }, (_, i) => {
            const a = -Math.PI / 2 + (i / 24) * 2 * Math.PI;
            return { transform: `translate(${cx + r * Math.cos(a)}px, ${cy + r * Math.sin(a)}px) translate(-50%, -50%) rotate(${a + Math.PI}rad)` };
        });
        scissors.animate(frames, { duration: CUT_DRAW_MS, delay: 500, easing: 'ease-in-out', fill: 'both' });
        return [veil, ring, scissors];
    }

    let state = null;
    let me = null;          // gk_me() for this device, in the player role
    let refs = {};          // elements the current phase wants sync() to update
    let celebrated = null;  // rev the confetti already fired for
    let crowned = false;    // the winner's own moment has been shown (once a quiz)
    let podiumSince = null; // when this screen first showed the podium

    // ---- media ------------------------------------------------------------
    /** Autoplay with sound needs a prior user gesture. The host has normally
     *  made one (logging in, opening the drawer); when they have not — a
     *  restored session, a refresh — start muted rather than not at all, and
     *  unmute on the first key or click. */
    function start(el) {
        if (mode() !== 'full') { el.muted = true; }
        el.play?.().catch(() => {
            el.muted = true;
            el.play?.().catch(() => {});
            const unmute = () => { el.muted = false; };
            window.addEventListener('pointerdown', unmute, { once: true });
            window.addEventListener('keydown', unmute, { once: true });
        });
    }

    function mediaBlock(item) {
        const video = safeMedia(item.video);
        const image = safeMedia(item.image);
        const audio = safeMedia(item.audio);
        const parts = [];
        if (mode() === 'still') {
            // A phone beside the projected screen: the picture, and a pointer
            // to where the clip or the sound is actually playing.
            if (image && item.layout !== 'background') parts.push(h('img', { class: 'st-media-el', src: image, alt: '' }));
            else if (video || audio) parts.push(h('div', { class: 'st-audio-badge', text: video ? '🎬' : '🎵' }));
            return parts.length ? h('div', { class: 'st-media' }, parts) : null;
        }
        if (video) {
            const el = h('video', { class: 'st-media-el', src: video, playsInline: true, preload: 'auto' });
            parts.push(el);
            queueMicrotask(() => start(el));
        } else if (image && item.layout !== 'background') {
            parts.push(h('img', { class: 'st-media-el', src: image, alt: '' }));
        }
        if (audio && mode() === 'full') {
            const el = h('audio', { src: audio, preload: 'auto' });
            parts.push(el, !video && !image && h('div', { class: 'st-audio-badge', text: '🎵' }));
            queueMicrotask(() => start(el));
        }
        return parts.some(Boolean) ? h('div', { class: 'st-media' }, parts) : null;
    }

    /** Background music plays under everything except an item that brings its
     *  own sound, or one whose editor toggle switched it off. */
    /** The element on screen right now, for "what plays here": during an
     *  "answer explained" segment that is the segment, not its question. */
    const current = () => (state.phase === 'explain' && state.data.explain) || state.data.item || null;

    function syncMusic() {
        const quiz = state.data.quiz || {};
        const item = current();
        // Three musics, by the host's rules:
        //   lobby_music   the lobby, and the "starting in…" slide after it
        //   music         the questions' (an item's own beats it): under an
        //                 interlude; under a question ONLY while it can be
        //                 answered (from the clock's start to its end — not
        //                 the get-ready count, not a memory picture, not an
        //                 instruction slide) — and for the special kinds (every
        //                 picture game, the roulette, the action round) on
        //                 through its reveal too; a plain multiple-choice
        //                 question ('question', 'memory') stops at the bell.
        //   podium_music  the podium and the matrix.
        // Never under the results: the fastest five, the special slide, the
        // table. An "answer explained" segment plays only music of its own.
        // music_on = false (the quiz's switch) silences the quiz's three.
        const own = safeMedia(item?.music);
        const quizMusic = (key) => (quiz.music_on ? safeMedia(quiz[key]) : null);
        const q = state.data.item;
        const special = q && !['question', 'memory', 'interlude'].includes(q.kind);
        const now = serverNow();
        const answering = state.phase === 'question' && now >= state.data.starts_at && now <= state.data.deadline;
        const src = { lobby: quizMusic('lobby_music'), countdown: quizMusic('lobby_music'),
            podium: quizMusic('podium_music'), matrix: quizMusic('podium_music'),
            interlude: own || quizMusic('music'),
            explain: own,
            question: answering ? own || quizMusic('music') : null,
            reveal: special ? own || quizMusic('music') : null }[state.phase] || null;
        // Wherever an element's own video or audio is on screen, it is heard
        // and the music is not — the reveal included: a question's clip plays
        // again beside the answers, and the music used to come back over it.
        const itemOwnsSound = item && ['interlude', 'question', 'reveal', 'explain'].includes(state.phase) && (item.video || item.audio);
        // …unless the author chose for THIS slide (slide_music, the host's
        // request): 'none', 'continue' (what the screen before was playing goes
        // on, untouched), or a file — which plays even where the element's own
        // music switch is off. Opening and closing slides are the quiz's.
        const slideKey = { lobby: 'lobby', countdown: 'countdown', podium: 'podium', matrix: 'matrix', intro: 'intro',
            question: now < state.data.starts_at ? 'ready' : 'question', reveal: 'reveal', fastest: 'fastest', fire: 'fire',
            leaderboard: 'leaderboard' }[state.phase];
        const slides = ['lobby', 'countdown', 'podium', 'matrix'].includes(state.phase) ? quiz.slide_music : q?.slide_music;
        const setting = slideKey && slides ? slides[slideKey] : undefined;
        if (setting === 'continue') return;
        const chosen = setting === 'none' ? null : typeof setting === 'string' && setting ? safeMedia(setting) : src;
        const explicit = typeof setting === 'string' && setting !== 'none';
        const want = mode() === 'full' && chosen && state.status !== 'idle'
            && (explicit || !(item && item.music_on === false)) && !itemOwnsSound;
        if (!want) { music.pause(); return; }
        if (music.getAttribute('src') !== chosen) music.setAttribute('src', chosen);
        if (music.paused) start(music);
    }

    // ---- phases -----------------------------------------------------------
    /** "Starting in 7… get ready": registration is over, the first item is
     *  seconds away. The number is the server's `ends_at`, counted here. */
    function countdown() {
        refs.countdown = h('span', { class: 'st-cd-num' });
        return h('section', { class: 'st-center st-cd' },
            h('p', { class: 'st-cd-lead', text: 'ההרשמה נסגרה · מתחילים בעוד' }),
            refs.countdown,
            h('p', { class: 'st-cd-ready', text: 'תתכוננו!' }));
    }
    function idle() {
        return h('section', { class: 'st-center' },
            h('div', { class: 'st-brand' }, 'Gev', h('b', { text: 'Kahoot' })),
            h('p', { class: 'st-lead', text: 'אין חידון באוויר כרגע' }));
    }

    function lobby() {
        refs.names = h('div', { class: 'st-names' });
        refs.count = h('div', { class: 'st-count' });
        return h('section', { class: 'st-lobby', dataset: { role } },
            role === 'host' && h('div', { class: 'st-join' },
                h('p', { class: 'st-lead', text: 'מצטרפים מהטלפון' }),
                qr(joinUrl),
                h('div', { class: 'st-url', dir: 'ltr', text: joinUrl.replace(/^https?:\/\//, '') })),
            h('div', { class: 'st-roster' }, refs.count, refs.names));
    }

    function qr(url) {
        // qrcode-generator is a classic vendored script (see host.html); it is
        // absent in the editor's preview frame only if the file failed to load.
        if (!url || typeof window.qrcode !== 'function') return null;
        const code = window.qrcode(0, 'M');
        code.addData(url);
        code.make();
        const n = code.getModuleCount();
        const canvas = h('canvas', { class: 'st-qr', width: String(n + 4), height: String(n + 4), 'aria-label': 'קוד QR להצטרפות' });
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, n + 4, n + 4);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) ctx.fillRect(c + 2, r + 2, 1, 1);
        return canvas;
    }

    function interlude(item) {
        return h('section', { class: 'st-item', dataset: { layout: item.layout, kind: 'interlude' } },
            mediaBlock(item),
            h('div', { class: 'st-text' },
                item.title && h('h1', { class: 'st-question', dir: 'auto', text: item.title }),
                item.body && h('p', { class: 'st-body', dir: 'auto', text: item.body })));
    }

    /** The puzzle: an introduction while the room gets ready, the five pieces
     *  while the clock runs, and the whole picture once everyone is done. */
    function puzzle(item, { started, revealed }) {
        const d = state.data;
        const image = safeMedia(item.image);
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });

        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🧩' }),
                h('h1', { class: 'st-heading', text: 'פאזל!' }),
                h('p', { class: 'st-lead', text: role === 'player'
                    ? 'גוררים את חמשת החלקים אל המסגרת. ברגע שהפאזל שלם הוא נשלח לבד — מי שמסיים ראשון מרוויח הכי הרבה.'
                    : 'כל אחד מרכיב אצלו את התמונה מחמישה חלקים. מי שמסיים ראשון מרוויח הכי הרבה.' }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        if (revealed) {
            const done = d.answered || 0;
            return h('section', { class: 'st-item st-puzzle-reveal', dataset: { layout: 'top', kind: 'interlude' } },
                image && h('div', { class: 'st-media' }, h('img', { class: 'st-media-el', src: image, alt: '' })),
                h('div', { class: 'st-text' },
                    h('h1', { class: 'st-question', dir: 'auto', text: item.title || 'הפאזל' }),
                    h('p', { class: 'st-body', text: done === 1 ? 'שחקן אחד הרכיב בזמן' : `${done} שחקנים הרכיבו בזמן` })));
        }
        if (!image) {
            return h('section', { class: 'st-center' }, h('p', { class: 'st-lead', text: 'לפאזל הזה עוד לא נבחרה תמונה' }));
        }
        const live = role === 'player';
        // No "done" button: the moment the fifth piece snaps home the answer
        // goes by itself (the host's request) — the time IS the score, and a
        // button to find and press only cost the player seconds. sync() sends
        // it again if a send did not get through.
        refs.puzzle = createPuzzle({ image, interactive: live, onChange: (complete) => { if (complete && live) sendPuzzle(item); } });
        return h('section', { class: 'st-puzzle' },
            h('div', { class: 'st-puzzle-head' }, badge,
                h('h1', { class: 'st-question', dir: 'auto', text: item.title || 'הרכיבו את הפאזל' })),
            refs.puzzle.el,
            h('div', { class: 'st-puzzle-foot' }, refs.answered));
    }

    /** "Spot it": the picture with the host's rectangles; tap one, then submit. */
    function spot(item, { started, revealed }) {
        const d = state.data;
        const image = safeMedia(item.image);
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const head = h('div', { class: 'st-puzzle-head' }, badge,
            h('h1', { class: 'st-question', dir: 'auto', text: item.title || 'זהו את הדמות' }));

        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🔎' }),
                h('h1', { class: 'st-heading', dir: 'auto', text: item.title || 'זהו את הדמות' }),
                h('p', { class: 'st-lead', text: role === 'player'
                    ? 'מקישים על האזור הנכון בתמונה ואז על ״הזן תשובה״.'
                    : 'כל אחד מסמן אצלו את האזור הנכון בתמונה.' }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        if (!image || !item.regions?.length) {
            return h('section', { class: 'st-center' }, h('p', { class: 'st-lead', text: 'לשאלה הזאת עוד לא נבחרה תמונה או לא סומנו אזורים' }));
        }
        const live = role === 'player' && !revealed;
        const submit = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', disabled: true, text: 'הזן תשובה',
            onclick: () => { if (refs.spot.selected !== null) onAnswer?.(item.id, refs.spot.selected); } });
        refs.done = submit;
        refs.spot = createSpot({ image, regions: item.regions, interactive: live, onSelect: () => { if (submit) submit.disabled = false; } });
        if (revealed) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            refs.spot.reveal({ correct: d.correct || [], counts: d.counts || [], answered: d.answered || 0, picked: mine });
        }
        return h('section', { class: 'st-puzzle st-spot' }, head, refs.spot.el,
            h('div', { class: 'st-puzzle-foot' }, submit, refs.answered));
    }

    /** The roulette: put a chip on a number, then submit. At the reveal the
     *  wheel spins and the ball drops into the right one; then the table,
     *  with the winning square lit and everyone's chips counted on it. */
    const spinStarts = new Map();   // `${item}|${starts_at}` → when this screen first saw the spin
    // While the wheel turns, the result is not out yet: a player's own "right!"
    // and their new score wait for the ball (see `spinning`, `onSettled`).
    let spinFor = null;             // the item id whose spin is still running
    function roulette(item, { started, revealed }) {
        const d = state.data;
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const title = item.title || 'על איזה מספר להמר?';
        const live = role === 'player' && !revealed;
        const submit = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', disabled: true, text: 'הזן תשובה',
            onclick: () => { if (refs.spot.selected !== null) onAnswer?.(item.id, refs.spot.selected); } });
        refs.done = submit;
        refs.spot = createTable({ interactive: live && started, compact: !!compact(), onSelect: () => { if (submit) submit.disabled = false; } });
        const result = h('div', { class: 'rl-result', hidden: true });
        const section = h('section', { class: 'st-puzzle st-roulette' },
            h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title }), result),
            refs.spot.el,
            h('div', { class: 'st-puzzle-foot' }, submit, refs.answered),
            !started && h('div', { class: 'st-ready rl-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        if (!revealed) return section;

        const number = (d.correct || [])[0];
        const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
        const showTable = () => {
            const wasSpinning = spinFor === item.id;
            spinFor = null;
            if (wasSpinning) { onSettled?.(); answerSound(item); }
            section.removeAttribute('data-spinning');
            result.hidden = false;
            clear(result).append(h('span', { class: 'rl-result-num', dataset: { colour: colourOf(number) }, text: String(number) }));
            refs.spot.reveal({ correct: d.correct || [], counts: d.counts || [], picked: mine });
        };
        const key = `${item.id}|${d.starts_at}`;
        if (!spinStarts.has(key)) spinStarts.set(key, performance.now());
        const elapsed = performance.now() - spinStarts.get(key);
        if (number === undefined || elapsed >= NO_MORE_BETS_MS + SPIN_MS + SETTLE_MS) { showTable(); return section; }
        spinFor = item.id;
        // "NO MORE BETS" first, then the wheel — both timed from the same start,
        // so a screen rebuilt mid-way joins the sequence where it is.
        const spinWheel = (at) => {
            section.toggleAttribute('data-spinning', true);
            section.querySelector('.rl-nomore')?.remove();
            const wheel = createWheel({ number, key: item.id, elapsed: at, onDone: () => { spin.remove(); showTable(); } });
            const spin = h('div', { class: 'rl-spin' }, wheel.el);
            section.append(spin);
        };
        if (elapsed >= NO_MORE_BETS_MS) spinWheel(elapsed - NO_MORE_BETS_MS);
        else {
            section.append(noMoreBets());
            setTimeout(() => { if (section.isConnected) spinWheel(0); }, NO_MORE_BETS_MS - elapsed);
        }
        return section;
    }

    /** "Complete the picture": try the candidate pieces in the gap, then submit. */
    function complete(item, { started, revealed }) {
        const d = state.data;
        const image = safeMedia(item.image);
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const title = item.title || 'השלימו את התמונה';

        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🖼️' }),
                h('h1', { class: 'st-heading', dir: 'auto', text: title }),
                h('p', { class: 'st-lead', text: role === 'player'
                    ? 'משהו חסר בתמונה. מנסים את האפשרויות עד שאחת יושבת בדיוק, ואז ״הזן תשובה״.'
                    : 'משהו חסר בתמונה. כל אחד בוחר אצלו איזו אפשרות משלימה אותה בדיוק.' }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        if (!image || !item.slot || !item.options?.length) {
            return h('section', { class: 'st-center' }, h('p', { class: 'st-lead', text: 'לשאלה הזאת עוד לא נבחרה תמונה או לא נחתך ממנה עצם' }));
        }
        const live = role === 'player' && !revealed;
        const submit = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', disabled: true, text: 'הזן תשובה',
            onclick: () => { if (refs.spot.selected !== null) onAnswer?.(item.id, refs.spot.selected); } });
        refs.done = submit;
        // Kept under refs.spot: it has the same lock / markPicked / selected
        // contract as the spot question, so sync() treats the two alike.
        refs.spot = createComplete({ image, slot: item.slot, options: item.options, interactive: live, onSelect: () => { if (submit) submit.disabled = false; } });
        if (revealed) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            refs.spot.reveal({ correct: d.correct || [], counts: d.counts || [], answered: d.answered || 0, picked: mine });
        }
        return h('section', { class: 'st-puzzle st-complete' },
            h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title })),
            refs.spot.el,
            h('div', { class: 'st-puzzle-foot' }, submit, refs.answered));
    }

    /** The slider: one piece in the picture, sized by the player; submit
     *  appears only once the slider has moved. */
    function slider(item, { started, revealed }) {
        const d = state.data;
        const image = safeMedia(item.image);
        const piece = safeMedia(item.options?.[0]?.image);
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const title = item.title || 'באיזה גודל העצם באמת?';

        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🎚️' }),
                h('h1', { class: 'st-heading', dir: 'auto', text: title }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        if (!image || !piece || !item.slot) {
            return h('section', { class: 'st-center' }, h('p', { class: 'st-lead', text: 'לשאלה הזאת עוד לא נבחרה תמונה או לא נחתך ממנה עצם' }));
        }
        const live = role === 'player' && !revealed;
        const submit = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', hidden: true, text: 'הזן תשובה',
            onclick: () => { if (refs.spot.selected !== null) onAnswer?.(item.id, refs.spot.selected); } });
        refs.done = submit;
        // Under refs.spot, like "complete the picture": the same lock /
        // markPicked / selected contract, so sync() treats them alike.
        refs.spot = createSlider({ image, slot: item.slot, piece, symbol: item.symbols?.[0] || null, interactive: live, scale: item.slider,
            onMove: () => { if (submit) submit.hidden = false; } });
        if (revealed) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            refs.spot.reveal({ values: d.values || [], picked: mine });
        }
        return h('section', { class: 'st-puzzle st-complete st-slider' },
            h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title })),
            refs.spot.el,
            h('div', { class: 'st-puzzle-foot' }, submit, refs.answered));
    }

    /** The ranking: drag the cards into order by the host's keyword, then submit. */
    function rank(item, { started, revealed }) {
        const d = state.data;
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const title = item.title || 'סדרו לפי הסדר';

        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🔢' }),
                h('h1', { class: 'st-heading', dir: 'auto', text: title }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        if ((item.options || []).length < 2) {
            return h('section', { class: 'st-center' }, h('p', { class: 'st-lead', text: 'לשאלה הזאת עוד אין תשובות לסדר' }));
        }
        const live = role === 'player' && !revealed;
        const submit = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', text: 'הזן תשובה',
            onclick: () => onAnswer?.(item.id, refs.spot.selected) });
        refs.done = submit;
        // Under refs.spot: the same lock / markPicked / selected contract.
        refs.spot = createRank({ options: item.options, keyword: item.body || '', symbols: item.symbols || [], marks: item.marks, interactive: live });
        if (revealed) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            refs.spot.reveal({ correct: d.correct || [], right: d.right || 0, answered: d.answered || 0, picked: mine });
        }
        return h('section', { class: 'st-puzzle st-rank' },
            h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title })),
            refs.spot.el,
            h('div', { class: 'st-puzzle-foot' }, submit, refs.answered));
    }

    /** This device's throws in an action round, by item — kept outside the
     *  court so a rebuilt screen (a republish mid-round) carries on counting. */
    const throws = new Map();
    /** The action round's end-of-time buzzer (js/ui/sounds.js): once per
     *  round, on the projected screen AND on every player's device — it is
     *  the bell of a game everyone is playing on their own screen. Silent in
     *  the preview. */
    const buzzed = new Set();
    function buzz(item) {
        if (muted || buzzed.has(item.id)) return;
        buzzed.add(item.id);
        // Only right at the bell: a screen that opens on a finished round
        // (a refresh, a late join) must not sound it.
        if (serverNow() - state.data.deadline > 2500) return;
        playSound('buzzer');
    }
    /** The ball of an action round: its circle cut out of its picture, or
     *  null for the drawn basketball. */
    const ballOf = (item) => (item.ball && safeMedia(item.image) ? circleCutout(safeMedia(item.image), item.ball) : null);

    /** The action round: free throws until the clock runs out. A player
     *  throws; the projected screen shows a hand throwing, and the count of
     *  who is playing; the reveal shows how the room shot. */
    function action(item, { started, revealed }) {
        const d = state.data;
        refs.answered = h('div', { class: 'st-answered' });
        const badge = WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] });
        const title = item.title || 'כמה סלים תקלעו?';
        if (!started) {
            return h('section', { class: 'st-center st-puzzle-intro' },
                h('div', { class: 'st-puzzle-icon', 'aria-hidden': 'true', text: '🏀' }),
                h('h1', { class: 'st-heading', dir: 'auto', text: title }),
                h('div', { class: 'st-ready' }, (refs.ready = h('span', { class: 'st-ready-num' })), multiplier(item.weight)));
        }
        const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
        if (revealed) {
            return h('section', { class: 'st-puzzle st-action st-action--res' },
                h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title })),
                actionResults({ values: d.values || [], mine: role === 'player' ? mine ?? 0 : null }),
                h('div', { class: 'st-puzzle-foot' }, refs.answered));
        }
        const live = role === 'player';
        // loaded now, so the bell rings on time
        if (!muted) preloadSounds('buzzer', 'correct', 'wrong');
        const kept = throws.get(item.id) || { hits: 0, attempts: 0 };
        const resume = { hits: Math.max(kept.hits, mine || 0), attempts: kept.attempts };
        // A throw may start only if it will have come down before the bell.
        const canThrow = () => state?.phase === 'question' && state.data.item?.id === item.id
            && serverNow() >= state.data.starts_at && serverNow() < state.data.deadline - 1300;
        const game = createAction({ ball: ballOf(item), interactive: live, auto: !live,
            // The throw's sound is this player's own feedback, so it plays on
            // a phone too (unlike the room's media) — only the preview is silent.
            start: resume, canThrow, sfx: !muted, feedback: item.feedback || {}, level: item.throw_level ?? 5,
            onScore: (hits, attempts) => {
                throws.set(item.id, { hits, attempts });
                onAnswer?.(item.id, hits, { again: true });
            } });
        refs.action = game;
        return h('section', { class: 'st-puzzle st-action' },
            h('div', { class: 'st-puzzle-head' }, badge, h('h1', { class: 'st-question', dir: 'auto', text: title })),
            game.el,
            h('div', { class: 'st-puzzle-foot' }, refs.answered));
    }

    function question(item, { started, revealed }) {
        if (item.kind === 'action') return action(item, { started, revealed });
        if (item.kind === 'rank') return rank(item, { started, revealed });
        if (item.kind === 'slider') return slider(item, { started, revealed });
        if (item.kind === 'puzzle') return puzzle(item, { started, revealed });
        if (item.kind === 'spot') return spot(item, { started, revealed });
        if (item.kind === 'complete') return complete(item, { started, revealed });
        if (item.kind === 'roulette') return roulette(item, { started, revealed });
        const memory = item.kind === 'memory';
        if (memory && !started) return memorize(item);
        const d = state.data;
        const counts = d.counts || [];
        const answered = d.answered || 0;
        refs.answered = h('div', { class: 'st-answered' });
        // A memory question asks with its picture gone, and brings it back —
        // with the host's arrows on it — only at the reveal.
        const memoryImage = memory && safeMedia(item.image);
        const media = !memory ? mediaBlock(item)
            : revealed && memoryImage ? h('div', { class: 'st-media' }, memoryPicture(memoryImage, d.arrows || []).el) : null;
        return h('section', { class: 'st-item', dataset: { layout: memory ? 'side' : item.layout, kind: 'question',
            ...(memory && media ? { memory: '' } : {}) } },
            media,
            h('div', { class: 'st-text' },
                WEIGHT_BADGE[item.weight] && h('div', { class: 'st-badge', dataset: { weight: String(item.weight) }, text: WEIGHT_BADGE[item.weight] }),
                h('h1', { class: 'st-question', dir: 'auto', text: item.title })),
            !started && h('div', { class: 'st-ready' },
                (refs.ready = h('span', { class: 'st-ready-num' })),
                multiplier(item.weight)),
            started && h('div', { class: 'st-options', dataset: { n: String(item.options.length), ...(revealed ? { revealed: '' } : {}) } },
                item.options.map((text, i) => {
                    const isCorrect = revealed && (d.correct || []).includes(i);
                    const pct = answered ? Math.round((counts[i] || 0) / answered * 100) : 0;
                    return h('div', { class: 'st-option', dataset: revealed ? { correct: String(isCorrect) } : {} },
                        role === 'player' && !revealed
                            ? tile(i, { tag: 'button', type: 'button', text, symbol: item.symbols?.[i] || null, marks: item.marks, 'aria-label': text, onclick: () => onAnswer?.(item.id, i) })
                            : tile(i, { text, symbol: item.symbols?.[i] || null, marks: item.marks }),
                        // After the reveal: how the room split, beside each answer.
                        revealed && h('div', { class: 'st-share' },
                            h('div', { class: 'st-share-bar' }, shareFill(pct)),
                            h('span', { class: 'st-share-pct', dir: 'ltr', text: `${pct}%` }),
                            isCorrect && h('span', { class: 'st-share-tick', text: '✓' })));
                })),
            refs.answered);
    }

    /** The memory question before its clock: the picture alone, and how long
     *  it stays. The question itself is not shown yet — it would say what to
     *  look at. (sync() counts refs.ready down to starts_at, as for any lead-in.) */
    function memorize(item) {
        const image = safeMedia(item.image);
        return h('section', { class: 'st-item st-memo', dataset: { layout: 'top', kind: 'interlude' } },
            image ? h('div', { class: 'st-media' }, memoryPicture(image, []).el) : null,
            h('div', { class: 'st-text' },
                h('h1', { class: 'st-question st-memo-head', text: image ? '📸 זכרו את התמונה!' : 'לשאלת הזיכרון הזו עוד לא נבחרה תמונה' }),
                (refs.ready = h('span', { class: 'st-memo-left' }))));
    }

    function shareFill(pct) {
        const fill = h('div', { class: 'st-share-fill' });
        fill.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${pct / 100})` }],
            { duration: 900, delay: 250, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.3,1)' });
        return fill;
    }

    /** The fastest five — for an action round, its five best shooters. */
    function fastest(rows, kind) {
        const shooters = kind === 'action';
        return h('section', { class: 'st-center st-results' },
            h('h1', { class: 'st-heading', text: shooters ? '🏀 הקלעים הטובים' : '⚡ הכי מהירים' }),
            rows.length
                ? h('ol', { class: 'st-fastest' }, rows.map((row, i) => {
                    const li = h('li', { class: 'st-fast-row' },
                        h('span', { class: 'gk-board-rank', text: String(i + 1) }),
                        h('span', { class: 'gk-board-name', dir: 'auto', text: row.name }),
                        shooters
                            ? h('span', { class: 'st-fast-time', text: `${row.hits ?? 0} 🏀` })
                            : h('span', { class: 'st-fast-time', dir: 'ltr', text: `${fmtSeconds(row.ms)}s` }),
                        h('span', { class: 'gk-board-points', dir: 'ltr', text: `+${row.points}` }));
                    li.style.animationDelay = `${i * 0.18}s`;
                    return li;
                }))
                : h('p', { class: 'st-lead', text: 'אף אחד לא פגע הפעם 😅' }));
    }

    function table(rows, animate) {
        return h('section', { class: 'st-center st-results' },
            h('h1', { class: 'st-heading', text: '🏆 הטבלה' }),
            h('div', { class: 'st-board' }, leaderboard(rows, { size: 8, animate, me: me?.name || null, streaks: state.data.streaks || {} })));
    }

    /** The quiz's one special slide (phase 'fire'): for the first player to
     *  get three in a row, or — if nobody does — before the last question, for
     *  the leader. The words sit in their own band ABOVE the animation, never
     *  over it: the animation fills the whole of its 16:9 picture, logo
     *  included, so anything laid on top of it covers something. */
    function onFire(fire) {
        const lead = fire?.lead;
        const kicker = lead
            ? (lead.gap > 0 ? `מוביל בפער של ${lead.gap} נקודות על הטבלה` : 'תיקו בראש הטבלה!')
            : '🔥 ראשון לשלוש ברצף!';
        return h('section', { class: 'st-first' },
            h('div', { class: 'st-first-head' },
                h('p', { class: 'st-first-kicker', text: kicker }),
                h('h1', { class: 'st-first-name', dir: 'auto', text: lead ? lead.name : fire?.first?.name || '' })),
            h('div', { class: 'st-first-stage' }, h('img', { class: 'st-first-anim', src: FIRST_STREAK_ANIM, alt: '' })));
    }

    function winners(rows) {
        return h('section', { class: 'st-center st-results' },
            h('h1', { class: 'st-heading', text: 'אלופי החידון' }),
            h('div', { class: 'st-podium' }, podium(rows)));
    }

    function grid(data) {
        const hasSlider = (data?.questions || []).some((q) => q.kind === 'slider');
        const hasAction = (data?.questions || []).some((q) => q.kind === 'action');
        return h('section', { class: 'st-center st-results st-matrix' },
            h('h1', { class: 'st-heading', text: 'מי ענה מה' }),
            h('p', { class: 'st-legend' },
                h('span', { dataset: { cell: 'good' }, text: 'נכון · שניות עד התשובה' }),
                h('span', { dataset: { cell: 'bad' }, text: 'טעות' }),
                hasSlider && h('span', { dataset: { cell: 'scale' }, text: 'סליידר: מאדום לירוק לפי הסטייה' }),
                hasAction && h('span', { dataset: { cell: 'scale' }, text: 'קליעות: מאדום לירוק, מהחלש לטוב ביותר' }),
                h('span', { dataset: { cell: 'none' }, text: 'לא ענה' })),
            matrix(data));
    }

    // ---- render -----------------------------------------------------------
    function pick() {
        const { status, phase, data, rev } = state;
        const item = data.item;
        if (status === 'idle') return ['idle', idle];
        if (phase === 'lobby') return ['lobby', lobby];
        if (phase === 'countdown') return [`countdown|${rev}`, countdown];
        if (phase === 'interlude' && item) return [`interlude|${item.id}|${rev}`, () => interlude(item)];
        // A picture game's instruction slide: shown until the host starts the question.
        if (phase === 'intro' && item && hasIntro(item.kind)) return [`intro|${item.id}|${rev}`, () => introSlide(item, { host: role === 'host' })];
        if (phase === 'question' && item) {
            const started = serverNow() >= data.starts_at;
            return [`question|${item.id}|${rev}|${started}`, () => question(item, { started, revealed: false })];
        }
        if (phase === 'reveal' && item) return [`reveal|${item.id}|${rev}`, () => question(item, { started: true, revealed: true })];
        // The "answer explained" segment is drawn exactly like an interlude.
        if (phase === 'explain' && data.explain) return [`explain|${data.explain.id}|${rev}`, () => interlude(data.explain)];
        if (phase === 'fastest') return [`fastest|${rev}`, () => fastest(data.fastest || [], item?.kind)];
        if (phase === 'fire') return [`fire|${rev}`, () => onFire(data.fire)];
        if (phase === 'leaderboard') return [`board|${rev}`, () => table(data.leaderboard || [], true)];
        if (phase === 'podium') return [`podium|${rev}`, () => winners(data.leaderboard || [])];
        if (phase === 'matrix') return [`matrix|${rev}`, () => grid(data.matrix)];
        return ['idle', idle];
    }

    const autoSent = new Set();      // sliders sent by the bell, by item
    /** A solved puzzle's "done", sent by itself; at most once a second. */
    let puzzleSentAt = 0;
    function sendPuzzle(item) {
        if (Date.now() - puzzleSentAt < 1000) return;
        puzzleSentAt = Date.now();
        onAnswer?.(item.id, 0);
    }
    /** The in-place updates: called on every state change and on a clock tick. */
    function sync() {
        if (!state) return;
        // The questions' music follows the clock (it plays only while answers
        // can be given), so it is re-decided on every tick.
        syncMusic();
        const { phase, data, live } = state;
        const item = data.item;

        // The player's own pick is marked in place: it arrives after the tap
        // (and again from the server), and must not rebuild the question.
        if (role === 'player' && item && (phase === 'question' || phase === 'reveal')) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            const closed = phase === 'question' && (mine !== null || serverNow() > data.deadline);
            const options = main.querySelector('.st-options');
            if (options) {
                options.toggleAttribute('data-locked', closed);
                [...options.children].forEach((el, i) => {
                    el.toggleAttribute('data-picked', mine === i);
                    const button = el.querySelector('button');
                    if (button) button.disabled = closed;
                });
            }
        }

        if (refs.names && phase === 'lobby') {
            refs.count.textContent = live.players === 1 ? 'שחקן אחד בפנים' : `${live.players} שחקנים בפנים`;
            renderKeyed(refs.names, live.names.join('\u0001'), () =>
                live.names.map((name) => h('span', { class: 'st-name', dir: 'auto', text: name })));
        }

        const inQuestion = phase === 'question' && item;
        if (refs.puzzle && inQuestion && item.kind === 'puzzle') {
            // This device finished (show it assembled) or the clock ran out
            // (freeze it as it is): either way the pieces stop moving.
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined;
            if (mine) refs.puzzle.lock(true);
            else if (serverNow() > data.deadline) refs.puzzle.lock(false);
            // solved, but no answer on record yet: the send failed — again
            else if (role === 'player' && refs.puzzle.complete) sendPuzzle(item);
        }
        if (refs.spot && ['spot', 'complete', 'slider', 'rank', 'roulette'].includes(item?.kind)) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            // The slider: time is up and it was never submitted — the place it
            // was left at IS the answer (the host's rule), sent just before
            // the bell so the server still takes it. Only a slider the player
            // moved: an untouched one at its 50% start is no answer at all.
            if (role === 'player' && inQuestion && item.kind === 'slider' && mine === null && !autoSent.has(item.id)
                && refs.spot.selected !== null && serverNow() >= data.deadline - 400) {
                autoSent.add(item.id);
                onAnswer?.(item.id, refs.spot.selected);
            }
            if (phase === 'reveal') refs.spot.markPicked(mine);
            else if (inQuestion && (mine !== null || serverNow() > data.deadline)) {
                // Answered, or out of time: the picture stops taking taps and
                // keeps showing what this player chose (if anything).
                refs.spot.lock(mine);
                if (refs.done) { refs.done.disabled = true; if (mine !== null) { refs.done.hidden = false; refs.done.textContent = 'נקלט ✓'; } }
            }
        }
        // The roulette's clock ran out: the croupier closes the table.
        if (inQuestion && item.kind === 'roulette' && serverNow() > data.deadline) {
            const table = main.querySelector('.st-roulette');
            if (table && !table.querySelector('.rl-nomore')) table.append(noMoreBets());
        }
        if (refs.answered && item && (inQuestion || phase === 'reveal')) {
            const verb = item.kind === 'puzzle' ? 'סיימו' : item.kind === 'action' ? 'זורקים' : 'ענו';
            refs.answered.textContent = `${verb} ${inQuestion ? live.answered : data.answered ?? live.answered} מתוך ${live.players}`;
        }

        const now = serverNow();
        if (refs.countdown && phase === 'countdown' && data.ends_at) {
            const left = Math.max(0, Math.ceil((data.ends_at - now) / 1000));
            const text = left > 0 ? String(left) : '🚀';
            if (refs.countdown.textContent !== text) {
                refs.countdown.textContent = text;
                // each number lands with a beat
                refs.countdown.classList.remove('st-cd-num--beat'); void refs.countdown.offsetWidth; refs.countdown.classList.add('st-cd-num--beat');
            }
        }
        if (inQuestion && refs.ready && now < data.starts_at) {
            refs.ready.textContent = String(Math.ceil((data.starts_at - now) / 1000));
        }
        const running = inQuestion && now >= data.starts_at;
        timer.hidden = !running;
        if (running) {
            const left = Math.max(0, Math.ceil((data.deadline - now) / 1000));
            timer.firstChild.textContent = String(left);
            timer.toggleAttribute('data-urgent', left <= 5);
        }
        // The action round's bell. The host reveals a moment after the
        // deadline, so it may first be seen from the reveal.
        if (item?.kind === 'action' && (phase === 'question' || phase === 'reveal') && data.deadline && now >= data.deadline) buzz(item);
        // The "started" flag is part of the question's key, so crossing
        // starts_at needs a render, not just a sync.
        if (inQuestion && main.dataset.viewKey?.endsWith('|false') && now >= data.starts_at) render(state, me);
    }

    /**
     * This player's own verdict, as a sound (js/ui/sounds.js): correct or
     * wrong, from the server's result in gk_me — so every kind is covered,
     * whatever makes it right (the roulette included). Once per question, on
     * the player's device only, and only on a screen that saw the question
     * open: a refresh onto a reveal says nothing. The action round is not
     * here: each of its throws already had its sound. No answer, no sound.
     */
    const opened = new Set(), judged = new Set();
    function answerSound(item) {
        if (!item || role !== 'player' || muted) return;
        if (state.phase === 'question') { opened.add(item.id); preloadSounds('correct', 'wrong'); return; }
        if (state.phase !== 'reveal' || item.kind === 'action' || !opened.has(item.id) || judged.has(item.id)) return;
        if (!me || me.item_id !== item.id || !me.answered || !me.result) return;
        // The roulette's verdict is the ball's: nothing until it has landed
        // (the host's request) — showTable() calls back here when it does.
        if (item.kind === 'roulette' && spinFor === item.id) return;
        judged.add(item.id);
        playSound(me.result.correct ? 'correct' : 'wrong');
        // …and a winning number pays out: banknotes all over this screen.
        if (item.kind === 'roulette' && me.result.correct) moneyRain();
    }

    function render(next, nextMe = null) {
        state = next;
        me = nextMe;
        const quiz = state.data.quiz || {};
        document.documentElement.dataset.theme = quiz.theme || 'stadium';

        const item = state.data.item;
        const shown = current();
        const itemBg = shown?.layout === 'background' && !shown.video ? safeMedia(shown.image) : null;
        const image = itemBg || safeMedia(quiz.background);
        bg.style.backgroundImage = image ? `url("${image}")` : '';
        bg.toggleAttribute('data-on', !!image);
        // An item's own picture as the background is shown WHOLE, in its own
        // proportions (host.css); the quiz's backdrop is wallpaper and fills.
        bg.toggleAttribute('data-item', !!itemBg);
        bg.style.setProperty('--bg-img', itemBg ? `url("${itemBg}")` : 'none');

        title.textContent = state.status === 'idle' ? '' : quiz.title || '';
        progress.textContent = item && item.kind !== 'interlude' && ['intro', 'question', 'reveal', 'explain', 'fastest'].includes(state.phase)
            ? `${item.kind === 'puzzle' ? 'פאזל' : 'שאלה'} ${item.no} מתוך ${item.of}` : '';

        const [key, build] = pick();
        const before = refs;
        refs = {};
        if (!renderKeyed(main, key, build)) refs = before;
        main.dataset.phase = state.phase;

        if (state.phase === 'podium' && celebrated !== state.rev) {
            celebrated = state.rev;
            podiumSince = performance.now();
            if (role === 'player' && !muted) preloadSounds('applause');
            confetti({ delay: 3300 });
            // Applause for the winners, as first place rises with the
            // confetti — the room's sound, so where the room's sound plays
            // (the projected screen; the demo).
            if (!muted && mode() === 'full') { preloadSounds('applause'); setTimeout(() => playSound('applause'), 3300); }
        }
        // The winner's own moment: on their device, as first place lands.
        // `me` arrives just after the podium (gk_me follows the new rev), so
        // this is checked on every render until it has happened once.
        if (state.status !== 'finished') crowned = false;     // a new quiz (the demo's "play again")
        // Not in the editor's preview (muted): it would cover the frame.
        if (state.phase === 'podium' && state.status === 'finished' && role === 'player' && !crowned && !muted
            && me?.player && me.rank === 1) {
            crowned = true;
            const wait = Math.max(0, 3300 - (performance.now() - (podiumSince ?? performance.now())));
            setTimeout(() => {
                if (state.phase !== 'podium') return;
                winnerMoment({ name: me.name, points: me.points, players: me.players });
                // their applause, on their own device (the room hears it from the projector)
                if (!muted && mode() !== 'full') playSound('applause');
            }, wait);
        }
        answerSound(item);
        // The quiz's animation runs on every screen of a quiz that has one,
        // except an item that opted out — the same rule as the music.
        const circle = state.phase === 'reveal' && item?.kind === 'puzzle' && state.data.circle && safeMedia(item.image);
        if (circle) {
            // The puzzle's reveal: the round detail the host picked lifts off
            // the picture and bounces, in front, while it is on screen. Started
            // once per reveal — a new answer count re-renders, it must not restart.
            const c = state.data.circle;
            const key = `${item.id}|${c.x}|${c.y}|${c.r}|${c.speed}`;
            if (lift?.key !== key) startLift(key, circle, c);
        } else {
            stopLift();
            // No drifting pictures over an open puzzle (the player is dragging
            // pieces around the same screen) or an open "complete the picture"
            // or slider (both judged by eye, to a few pixels).
            // The special slide's animation is its own show: nothing drifts over it.
            // Nor over a memory question's picture while it is being memorised.
            // Nor over the court, where a drifting picture would look like a second ball.
            const solving = state.phase === 'intro' || state.phase === 'fire' || (state.phase === 'question' && ['puzzle', 'complete', 'slider', 'rank', 'action', 'roulette'].includes(item?.kind))
                || (state.phase === 'question' && item?.kind === 'memory' && serverNow() < state.data.starts_at);
            // Which animation runs here — every element carries its own (the
            // host's request): on/off, picture, count, size, speed, front.
            // The opening's (lobby, countdown) is the quiz's `anim`; the
            // closing's (podium, matrix) is `closing_anim`. An element switched
            // on without a picture of its own (or a demo item) borrows the
            // opening's picture and settings.
            const here = current();
            let anim = null;
            if (['lobby', 'countdown'].includes(state.phase)) anim = quiz.anim?.on ? quiz.anim : null;
            else if (['podium', 'matrix'].includes(state.phase)) anim = quiz.closing_anim?.on ? quiz.closing_anim : null;
            else if (here && here.anim_on !== false) {
                const sprite = here.anim_sprite || (quiz.anim?.on ? quiz.anim.sprite : null);
                const base = quiz.anim || {};
                if (sprite) anim = { sprite, count: here.anim_count ?? base.count, size: here.anim_size ?? base.size,
                    speed: here.anim_speed ?? base.speed, front: here.anim_front ?? base.front };
            }
            bouncers.update(state.status !== 'idle' && !solving && anim ? anim : null);
        }
        syncMusic();
        sync();
    }

    setInterval(sync, 200);
    return {
        render,
        get state() { return state; },
        /** A roulette reveal whose ball has not landed yet: the result is held. */
        get spinning() { return !!spinFor && state?.phase === 'reveal' && state.data.item?.id === spinFor; },
    };
}
