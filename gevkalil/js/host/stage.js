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

const WEIGHT_BADGE = { 0: 'חימום · בלי ניקוד', 2: 'שאלה כפולה ×2' };

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
    function syncMusic() {
        const quiz = state.data.quiz || {};
        const item = state.data.item;
        const src = safeMedia(quiz.music);
        const itemOwnsSound = item && ['interlude', 'question'].includes(state.phase) && (item.video || item.audio);
        const want = mode() === 'full' && src && quiz.music_on && state.status !== 'idle'
            && !(item && item.music_on === false) && !itemOwnsSound;
        if (!want) { music.pause(); return; }
        if (music.getAttribute('src') !== src) music.setAttribute('src', src);
        if (music.paused) start(music);
    }

    // ---- phases -----------------------------------------------------------
    function idle() {
        return h('section', { class: 'st-center' },
            h('div', { class: 'st-brand' }, 'Gev', h('b', { text: 'kalil' })),
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

    function question(item, { started, revealed }) {
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
                            ? tile(i, { tag: 'button', type: 'button', text, 'aria-label': text, onclick: () => onAnswer?.(item.id, i) })
                            : tile(i, { text }),
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
            h('div', { class: 'st-board' }, leaderboard(rows, { size: 8, animate, me: me?.name || null })));
    }

    function winners(rows) {
        return h('section', { class: 'st-center st-results' },
            h('h1', { class: 'st-heading', text: 'אלופי החידון' }),
            h('div', { class: 'st-podium' }, podium(rows)));
    }

    function grid(data) {
        return h('section', { class: 'st-center st-results st-matrix' },
            h('h1', { class: 'st-heading', text: 'מי ענה מה' }),
            h('p', { class: 'st-legend' },
                h('span', { dataset: { cell: 'good' }, text: 'נכון · שניות עד התשובה' }),
                h('span', { dataset: { cell: 'bad' }, text: 'טעות' }),
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
        if (phase === 'question' && item) {
            const started = serverNow() >= data.starts_at;
            return [`question|${item.id}|${rev}|${started}`, () => question(item, { started, revealed: false })];
        }
        if (phase === 'reveal' && item) return [`reveal|${item.id}|${rev}`, () => question(item, { started: true, revealed: true })];
        if (phase === 'fastest') return [`fastest|${rev}`, () => fastest(data.fastest || [])];
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
        if (refs.answered && item && (inQuestion || phase === 'reveal')) {
            refs.answered.textContent = `ענו ${inQuestion ? live.answered : data.answered ?? live.answered} מתוך ${live.players}`;
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
        const itemBg = item?.layout === 'background' && !item.video ? safeMedia(item.image) : null;
        const image = itemBg || safeMedia(quiz.background);
        bg.style.backgroundImage = image ? `url("${image}")` : '';
        bg.toggleAttribute('data-on', !!image);

        title.textContent = state.status === 'idle' ? '' : quiz.title || '';
        progress.textContent = item?.kind === 'question' && ['question', 'reveal', 'fastest'].includes(state.phase)
            ? `שאלה ${item.no} מתוך ${item.of}` : '';

        const [key, build] = pick();
        const before = refs;
        refs = {};
        if (!renderKeyed(main, key, build)) refs = before;
        main.dataset.phase = state.phase;

        if (state.phase === 'podium' && celebrated !== state.rev) {
            celebrated = state.rev;
            confetti({ delay: 3300 });
        }
        syncMusic();
        sync();
    }

    setInterval(sync, 200);
    return { render, get state() { return state; } };
}
