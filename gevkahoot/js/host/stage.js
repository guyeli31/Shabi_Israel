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
import { h, renderKeyed, safeMedia, fmtSeconds } from '../ui/dom.js';
import { tile } from '../ui/teams.js';
import { leaderboard, podium, matrix, confetti, multiplier } from '../ui/views.js';
import { serverNow } from '../data/clock.js';
import { createBouncers } from './bouncers.js';
import { createPuzzle, circleCutout } from './puzzle.js';
import { createSpot } from './spot.js';
import { createComplete } from './complete.js';
import { createSlider } from './slider.js';
import { createRank } from './rank.js';
import { introSlide, hasIntro } from './intro.js';

const WEIGHT_BADGE = { 0: 'חימום · בלי ניקוד', 2: 'שאלה כפולה ×2' };
/** The one-time "first to three in a row" animation (a generated, self-contained SVG). */
const FIRST_STREAK_ANIM = 'media/animations/first-streak.svg';

export function createStage(frame, { muted = false, joinUrl = '', role = 'host', compact = () => false, media = () => 'full', onAnswer = null } = {}) {
    // `frame` is the size container; the stage inside it is laid out in units
    // of that container (see host.css), so it scales the same on a projector,
    // in a player's browser, and in the editor's preview.
    const root = h('div', { class: 'st', dataset: { role } });
    frame.classList.add('st-frame');
    frame.append(root);
    const applyCompact = () => root.toggleAttribute('data-compact', !!compact());
    applyCompact();
    window.addEventListener('resize', applyCompact);
    const mode = () => (muted ? 'muted' : media());

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
            // Once the picture's own entrance (.6s) has settled and been seen.
            later(1200, () => {
                const pic = main.querySelector('.st-puzzle-reveal .st-media-el');
                if (!pic) return;
                const box = contentBox(pic);
                const at = root.getBoundingClientRect();
                const r = circle.r * Math.min(box.width, box.height);
                const cx = box.left + circle.x * box.width - at.left;
                const cy = box.top + circle.y * box.height - at.top;
                // A still copy laid exactly over the detail, so that what stays
                // behind while the picture fades is the picture's own piece.
                run.ghost = h('img', { class: 'st-lift', src, alt: '', draggable: 'false',
                    style: { width: `${2 * r}px`, height: `${2 * r}px`, transform: `translate3d(${cx - r}px, ${cy - r}px, 0)` } });
                root.append(run.ghost);
                pic.dataset.fade = '';
                // Faded: hand the detail to the bouncing layer, same size and
                // same place, and drop the still copy in the same frame.
                later(1600, () => {
                    const W = root.clientWidth, H = root.clientHeight;
                    bouncers.update({ src, count: 1, size: (2 * r) / Math.min(W, H) * 100,
                        speed: circle.speed || 4, front: true, start: { x: cx / W, y: cy / H } });
                    requestAnimationFrame(() => { run.ghost?.remove(); run.ghost = null; });
                });
            });
        });
    }

    let state = null;
    let me = null;          // gk_me() for this device, in the player role
    let refs = {};          // elements the current phase wants sync() to update
    let celebrated = null;  // rev the confetti already fired for

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
        // An item's own music beats the quiz's; music_on = false beats both.
        const src = safeMedia(item?.music) || (quiz.music_on ? safeMedia(quiz.music) : null);
        const itemOwnsSound = item && ['interlude', 'question', 'explain'].includes(state.phase) && (item.video || item.audio);
        const want = mode() === 'full' && src && state.status !== 'idle'
            && !(item && item.music_on === false) && !itemOwnsSound;
        if (!want) { music.pause(); return; }
        if (music.getAttribute('src') !== src) music.setAttribute('src', src);
        if (music.paused) start(music);
    }

    // ---- phases -----------------------------------------------------------
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
                    ? 'גוררים את חמשת החלקים אל המסגרת ולוחצים ״סיימתי״. מי שמסיים ראשון מרוויח הכי הרבה.'
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
        const done = live && h('button', { class: 'gk-btn st-puzzle-done', type: 'button', disabled: true, text: 'סיימתי ✓',
            onclick: () => onAnswer?.(item.id, 0) });
        refs.done = done;
        refs.puzzle = createPuzzle({ image, interactive: live, onChange: (complete) => { if (done) done.disabled = !complete; } });
        return h('section', { class: 'st-puzzle' },
            h('div', { class: 'st-puzzle-head' }, badge,
                h('h1', { class: 'st-question', dir: 'auto', text: item.title || 'הרכיבו את הפאזל' })),
            refs.puzzle.el,
            h('div', { class: 'st-puzzle-foot' }, done, refs.answered));
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
        refs.spot = createSlider({ image, slot: item.slot, piece, symbol: item.symbols?.[0] || null, interactive: live,
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

    function question(item, { started, revealed }) {
        if (item.kind === 'rank') return rank(item, { started, revealed });
        if (item.kind === 'slider') return slider(item, { started, revealed });
        if (item.kind === 'puzzle') return puzzle(item, { started, revealed });
        if (item.kind === 'spot') return spot(item, { started, revealed });
        if (item.kind === 'complete') return complete(item, { started, revealed });
        const d = state.data;
        const counts = d.counts || [];
        const answered = d.answered || 0;
        refs.answered = h('div', { class: 'st-answered' });
        return h('section', { class: 'st-item', dataset: { layout: item.layout, kind: 'question' } },
            mediaBlock(item),
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

    function shareFill(pct) {
        const fill = h('div', { class: 'st-share-fill' });
        fill.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${pct / 100})` }],
            { duration: 900, delay: 250, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.3,1)' });
        return fill;
    }

    function fastest(rows) {
        return h('section', { class: 'st-center st-results' },
            h('h1', { class: 'st-heading', text: '⚡ הכי מהירים' }),
            rows.length
                ? h('ol', { class: 'st-fastest' }, rows.map((row, i) => {
                    const li = h('li', { class: 'st-fast-row' },
                        h('span', { class: 'gk-board-rank', text: String(i + 1) }),
                        h('span', { class: 'gk-board-name', dir: 'auto', text: row.name }),
                        h('span', { class: 'st-fast-time', dir: 'ltr', text: `${fmtSeconds(row.ms)}s` }),
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
        return h('section', { class: 'st-center st-results st-matrix' },
            h('h1', { class: 'st-heading', text: 'מי ענה מה' }),
            h('p', { class: 'st-legend' },
                h('span', { dataset: { cell: 'good' }, text: 'נכון · שניות עד התשובה' }),
                h('span', { dataset: { cell: 'bad' }, text: 'טעות' }),
                hasSlider && h('span', { dataset: { cell: 'scale' }, text: 'סליידר: מאדום לירוק לפי הסטייה' }),
                h('span', { dataset: { cell: 'none' }, text: 'לא ענה' })),
            matrix(data));
    }

    // ---- render -----------------------------------------------------------
    function pick() {
        const { status, phase, data, rev } = state;
        const item = data.item;
        if (status === 'idle') return ['idle', idle];
        if (phase === 'lobby') return ['lobby', lobby];
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
        if (phase === 'fastest') return [`fastest|${rev}`, () => fastest(data.fastest || [])];
        if (phase === 'fire') return [`fire|${rev}`, () => onFire(data.fire)];
        if (phase === 'leaderboard') return [`board|${rev}`, () => table(data.leaderboard || [], true)];
        if (phase === 'podium') return [`podium|${rev}`, () => winners(data.leaderboard || [])];
        if (phase === 'matrix') return [`matrix|${rev}`, () => grid(data.matrix)];
        return ['idle', idle];
    }

    /** The in-place updates: called on every state change and on a clock tick. */
    function sync() {
        if (!state) return;
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
            if (mine) { refs.puzzle.lock(true); if (refs.done) { refs.done.disabled = true; refs.done.textContent = 'נקלט ✓'; } }
            else if (serverNow() > data.deadline) { refs.puzzle.lock(false); if (refs.done) refs.done.disabled = true; }
        }
        if (refs.spot && ['spot', 'complete', 'slider', 'rank'].includes(item?.kind)) {
            const mine = me && me.item_id === item.id && me.option !== null && me.option !== undefined ? me.option : null;
            if (phase === 'reveal') refs.spot.markPicked(mine);
            else if (inQuestion && (mine !== null || serverNow() > data.deadline)) {
                // Answered, or out of time: the picture stops taking taps and
                // keeps showing what this player chose (if anything).
                refs.spot.lock(mine);
                if (refs.done) { refs.done.disabled = true; if (mine !== null) { refs.done.hidden = false; refs.done.textContent = 'נקלט ✓'; } }
            }
        }
        if (refs.answered && item && (inQuestion || phase === 'reveal')) {
            const verb = item.kind === 'puzzle' ? 'סיימו' : 'ענו';
            refs.answered.textContent = `${verb} ${inQuestion ? live.answered : data.answered ?? live.answered} מתוך ${live.players}`;
        }

        const now = serverNow();
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
        // The "started" flag is part of the question's key, so crossing
        // starts_at needs a render, not just a sync.
        if (inQuestion && main.dataset.viewKey?.endsWith('|false') && now >= data.starts_at) render(state, me);
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
            confetti({ delay: 3300 });
        }
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
            const solving = state.phase === 'intro' || state.phase === 'fire' || (state.phase === 'question' && ['puzzle', 'complete', 'slider', 'rank'].includes(item?.kind));
            // Which picture bounces here: this element's own, else the quiz's
            // (if the quiz has its animation on); `anim_on = false` means none.
            // Count, size and speed are always the quiz's.
            const here = current();
            const sprite = here?.anim_on === false ? null : here?.anim_sprite || (quiz.anim?.on ? quiz.anim.sprite : null);
            bouncers.update(state.status !== 'idle' && !solving && sprite ? { ...(quiz.anim || {}), sprite } : null);
        }
        syncMusic();
        sync();
    }

    setInterval(sync, 200);
    return { render, get state() { return state; } };
}
