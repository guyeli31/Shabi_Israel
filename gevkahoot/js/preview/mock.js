/**
 * mock.js — invented quiz state for the editor's two preview frames.
 *
 * The editor does not draw a picture of the screens: it frames the real
 * host.html and index.html in ?preview mode and posts them a state object
 * shaped exactly like the one the backend publishes (see _gk_publish in
 * sql/gevkahoot.sql). This module builds that object for each stage of a quiz
 * out of the quiz being edited plus a made-up room of twelve players, so a
 * design can be judged at every step without running a quiz.
 */

const NAMES = ['נועה', 'יוסי', 'דנה כהן', 'Avi', 'מיכל', 'רון השועל', 'תמר', 'אלון', 'שירה', 'גיא', 'ליאור', 'עומר'];
const ME = 'נועה';

export const VIEWS = [
    ['lobby', 'לובי'],
    ['intro', 'שקופית הוראות'],
    ['ready', 'מתכוננים'],
    ['item', 'הפריט הנבחר'],
    ['reveal', 'חשיפת תשובה'],
    ['explain', 'הסבר התשובה'],
    ['fastest', 'הכי מהירים'],
    ['leaderboard', 'טבלה'],
    ['podium', 'פודיום'],
    ['matrix', 'מטריצה'],
];

/** The quiz-wide screens: not about any one element of the running order. */
export const GENERAL_VIEWS = ['lobby', 'podium', 'matrix'];

/**
 * The stages that exist for ONE element of the running order — what the
 * editor offers to preview when that element is selected. An interlude is a
 * single screen; a scored item has its get-ready, the item itself, the reveal,
 * its "answer explained" segment if it has one, and the results that follow.
 */
export function viewsFor(item) {
    if (!item) return [];
    if (item.kind === 'interlude') return ['item'];
    if (item.kind === 'explain') return ['explain'];
    const intro = ['puzzle', 'spot', 'complete'].includes(item.kind) ? ['intro'] : [];
    return [...intro, 'ready', 'item', 'reveal', ...(item.explain ? ['explain'] : []), 'fastest', 'leaderboard'];
}

const STUB_QUESTION = {
    id: 'stub', kind: 'question', title: 'כאן תופיע השאלה', body: '', options: ['תשובה א׳', 'תשובה ב׳', 'תשובה ג׳', 'תשובה ד׳'],
    correct: [1], weight: 1, time_limit_s: 20, image: null, video: null, audio: null, media_layout: 'side', music_on: true,
};

/** Deterministic pseudo-random, so the preview does not reshuffle on every keystroke. */
const noise = (a, b) => ((Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1 + 1) % 1;

function publicItem(item, items) {
    const questions = items.filter((i) => i.kind !== 'interlude');
    return {
        id: item.id, kind: item.kind, title: item.title, body: item.body,
        options: ['question', 'complete'].includes(item.kind) ? item.options : [], slot: item.slot || null,
        weight: item.weight, time_limit: item.time_limit_s,
        image: item.image, video: item.video, audio: item.audio,
        layout: item.media_layout, music_on: item.music_on, anim_on: item.anim_on,
        music: item.music || null, anim_sprite: item.anim_sprite || null, symbols: item.symbols || [],
        regions: item.kind === 'spot' ? item.regions || [] : [],
        no: Math.max(1, questions.findIndex((q) => q.id === item.id) + 1), of: Math.max(1, questions.length),
    };
}

function board() {
    const before = NAMES.map((name, i) => ({ name, base: 4200 - i * 310 }));
    const rows = before.map((row, i) => {
        const gain = [0, 940, 610, 0, 880, 720, 0, 990, 450, 0, 830, 560][i];
        return { name: row.name, points: row.base + gain, gain, prev: i + 1, correct: 3 + (gain ? 1 : 0) };
    });
    rows.sort((a, b) => b.points - a.points);
    rows.forEach((row, i) => { row.rank = i + 1; });
    return rows;
}

function grid(items) {
    const real = items.filter((i) => i.kind !== 'interlude');
    const questions = (real.length ? real : [STUB_QUESTION, STUB_QUESTION, STUB_QUESTION, STUB_QUESTION, STUB_QUESTION])
        .map((q, i) => ({ no: i + 1, title: q.title, weight: q.weight }));
    const rows = board().map((row, r) => ({
        name: row.name, rank: row.rank, points: row.points,
        cells: questions.map((_, c) => {
            const roll = noise(r + 1, c + 1);
            if (roll < 0.1) return null;
            return roll < 0.38 ? [false, Math.round(2000 + roll * 20000)] : [true, Math.round(1500 + noise(c + 3, r + 7) * 12000)];
        }),
    }));
    return { questions, rows };
}

let rev = 0;

export function mock(view, quiz, selected, items) {
    const now = Date.now();
    // Both spellings: the editor passes a gk_quizzes row (anim_* columns), the
    // layout check passes the demo quiz (an `anim` object already).
    const anim = quiz.anim || { on: !!(quiz.anim_on && quiz.anim_sprite), sprite: quiz.anim_sprite,
        count: quiz.anim_count, size: quiz.anim_size, speed: quiz.anim_speed, front: quiz.anim_front };
    const quizData = { title: quiz.title, theme: quiz.theme, background: quiz.background, music: quiz.music, music_on: quiz.music_on, anim };
    // The scored item the results views are about: the selected question or
    // puzzle, else the quiz's first question.
    // An "answer explained" segment is previewed on top of the question it belongs to.
    if (selected?.kind === 'explain') {
        const parent = items.find((i) => i.explain?.id === selected.id);
        if (parent) { selected = parent; view = 'explain'; }
    }
    const question = selected && selected.kind !== 'interlude' ? selected : items.find((i) => i.kind === 'question') || STUB_QUESTION;
    const isPuzzle = question.kind === 'puzzle';
    const base = { rev: ++rev, status: 'running', data: { quiz: quizData, index: 1, count: items.length, locked: false },
        live: { players: NAMES.length, answered: 7, names: NAMES } };
    const me = { player: true, name: ME, points: 2840, rank: 3, players: NAMES.length };
    const rows = board();
    const mine = rows.find((r) => r.name === ME);

    if (view === 'lobby') return { state: { ...base, status: 'lobby', phase: 'lobby' }, me: { ...me, points: 0, rank: 1 } };

    if (view === 'intro' && ['puzzle', 'spot', 'complete'].includes(question.kind)) {
        return { state: { ...base, phase: 'intro', data: { ...base.data, item: publicItem(question, items) } }, me };
    }
    if (view === 'ready' || view === 'intro') {
        // The real lead-in, then it runs on into the question — so the ×2 / ×0
        // marker is previewed exactly as the room will see it.
        const lead = Math.max(3, quiz.lead_in_s || 0) * 1000;
        return {
            state: { ...base, phase: 'question', data: { ...base.data, item: publicItem(question, items),
                starts_at: now + lead, deadline: now + lead + question.time_limit_s * 1000 } },
            me: { ...me, item_id: question.id, answered: false },
        };
    }

    if (view === 'item') {
        const item = selected || question;
        if (item.kind === 'interlude') {
            return { state: { ...base, phase: 'interlude', data: { ...base.data, item: publicItem(item, items) } }, me };
        }
        return {
            state: { ...base, phase: 'question', data: { ...base.data, item: publicItem(item, items),
                starts_at: now - 1500, deadline: now - 1500 + item.time_limit_s * 1000 } },
            me: { ...me, item_id: item.id, answered: false },
        };
    }

    const n = question.options.length;
    const slots = question.kind === 'spot' ? question.regions || [] : question.options;
    const counts = isPuzzle ? [9] : slots.map((_, i) => (question.correct.includes(i) ? 5 : 1) + (i % 2));
    // Editor rows carry circle_x/y/r columns; the demo quiz carries `circle`.
    const circle = !isPuzzle ? null : question.circle
        || (question.circle_r ? { x: question.circle_x, y: question.circle_y, r: question.circle_r } : null);
    const answered = counts.reduce((a, b) => a + b, 0);
    const revealData = { ...base.data, item: publicItem(question, items), starts_at: now - 20000, deadline: now - 1000,
        correct: isPuzzle ? [0] : question.correct, circle, counts, answered,
        fastest: NAMES.slice(0, 5).map((name, i) => ({ name, ms: 1400 + i * 900, points: 965 - i * 45 })) };

    if (view === 'explain' && question.explain) {
        const x = question.explain;
        return { state: { ...base, phase: 'explain', data: { ...revealData, explain: {
            id: x.id, kind: 'explain', title: x.title, body: x.body, image: x.image, video: x.video, audio: x.audio,
            layout: x.media_layout, music_on: x.music_on, music: x.music || null, anim_on: x.anim_on, anim_sprite: x.anim_sprite || null } } },
            me: { ...me, item_id: question.id, answered: true, option: question.correct[0] ?? 0, result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'reveal' || view === 'explain') {
        return { state: { ...base, phase: 'reveal', data: revealData, live: { ...base.live, answered: Math.min(answered, NAMES.length) } },
            me: { ...me, item_id: question.id, answered: true, option: question.correct[0] ?? 0, result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'fastest') {
        return { state: { ...base, phase: 'fastest', data: revealData },
            me: { ...me, item_id: question.id, answered: true, option: Math.min(n - 1, 0), result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'leaderboard') {
        return { state: { ...base, phase: 'leaderboard', data: { ...base.data, item: publicItem(question, items), leaderboard: rows } },
            me: { ...me, points: mine.points, rank: mine.rank } };
    }
    const matrix = grid(items);
    const finished = { ...base, status: 'finished', phase: view, data: { quiz: quizData, leaderboard: rows, matrix } };
    return { state: finished, me: { ...me, points: mine.points, rank: mine.rank, cells: matrix.rows.find((r) => r.name === ME).cells } };
}
