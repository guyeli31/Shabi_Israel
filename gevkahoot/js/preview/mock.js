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
    ['countdown', 'מתחילים בעוד'],
    ['intro', 'שקופית הוראות'],
    ['ready', 'מתכוננים'],
    ['item', 'הפריט הנבחר'],
    ['reveal', 'חשיפת תשובה'],
    ['explain', 'הסבר התשובה'],
    ['fastest', 'הכי מהירים'],
    ['firstfire', '🔥 ראשון לשלוש ברצף'],
    ['leadfire', '🔥 המוביל לפני השאלה האחרונה'],
    ['leaderboard', 'טבלה'],
    ['podium', 'פודיום'],
    ['matrix', 'מטריצה'],
];

/** The quiz-wide screens: not about any one element of the running order. */
export const GENERAL_VIEWS = ['lobby', 'countdown', 'leadfire', 'podium', 'matrix'];

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
    const intro = ['puzzle', 'spot', 'complete', 'slider', 'rank', 'action', 'memory'].includes(item.kind) ? ['intro'] : [];
    return [...intro, 'ready', 'item', 'reveal', ...(item.explain ? ['explain'] : []), 'fastest', 'firstfire', 'leaderboard'];
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
        options: ['question', 'complete', 'slider', 'rank', 'memory'].includes(item.kind) ? item.options : [], slot: item.slot || null,
        // the slider's scale, as _gk_publish sends it
        slider: item.kind === 'slider' ? { min: item.slider_min ?? 1 / 3, target: item.correct?.[0] ?? 700 } : null,
        memo_s: item.kind === 'memory' ? item.memo_s ?? 10 : null,
        weight: item.weight, time_limit: item.time_limit_s,
        image: item.image, video: item.video, audio: item.audio,
        layout: item.media_layout, music_on: item.music_on, anim_on: item.anim_on,
        music: item.music || null, anim_sprite: item.anim_sprite || null, symbols: item.symbols || [], marks: item.marks || 'teams',
        regions: item.kind === 'spot' ? item.regions || [] : [],
        // the action round's ball: the demo carries `ball`, an editor row its circle_* columns
        feedback: item.kind === 'action' ? item.feedback || {} : null,
        ball: item.kind !== 'action' ? null : item.ball || (item.circle_r ? { x: item.circle_x, y: item.circle_y, r: item.circle_r } : null),
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
        .map((q, i) => ({ no: i + 1, title: q.title, weight: q.weight, kind: q.kind }));
    const rows = board().map((row, r) => ({
        name: row.name, rank: row.rank, points: row.points,
        cells: questions.map((q, c) => {
            const roll = noise(r + 1, c + 1);
            if (roll < 0.1) return null;
            // A slider: a deviation between −45% and +7%, coloured on the scale.
            // An action round: 2-14 baskets, coloured by their share of the best.
            if (q.kind === 'action') { const hits = 2 + Math.round(roll * 12); return [hits > 4, 28000, Math.round((hits - 2) / 12 * 1000), null, hits, +((hits - 2) / 12).toFixed(3)]; }
            if (q.kind === 'slider') return [roll > 0.6, Math.round(2000 + roll * 15000), Math.round(900 * (1 - roll * 0.4)), +(0.07 - roll * 0.52).toFixed(3)];
            return roll < 0.38 ? [false, Math.round(2000 + roll * 20000)] : [true, Math.round(1500 + noise(c + 3, r + 7) * 12000)];
        }),
    }));
    return { questions, rows };
}

const rankWithSwap = (correct) => {
    const o = [...correct];
    if (o.length > 1) [o[0], o[1]] = [o[1], o[0]];
    return o.reduce((code, opt, i) => code + opt * 5 ** i, 0);
};

let rev = 0;

export function mock(view, quiz, selected, items) {
    const now = Date.now();
    // Both spellings: the editor passes a gk_quizzes row (anim_* columns), the
    // layout check passes the demo quiz (an `anim` object already).
    const anim = quiz.anim || { on: !!(quiz.anim_on && quiz.anim_sprite), sprite: quiz.anim_sprite,
        count: quiz.anim_count, size: quiz.anim_size, speed: quiz.anim_speed, front: quiz.anim_front };
    const quizData = { title: quiz.title, theme: quiz.theme, background: quiz.background, music: quiz.music, lobby_music: quiz.lobby_music, podium_music: quiz.podium_music, music_on: quiz.music_on, anim };
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
    if (view === 'countdown') return { state: { ...base, phase: 'countdown', data: { ...base.data, ends_at: Date.now() + 5400 } }, me: { ...me, points: 0, rank: 1 } };

    if (view === 'intro' && ['puzzle', 'spot', 'complete', 'slider', 'rank', 'action', 'memory'].includes(question.kind)) {
        return { state: { ...base, phase: 'intro', data: { ...base.data, item: publicItem(question, items) } }, me };
    }
    if (view === 'ready' || view === 'intro') {
        // The real lead-in, then it runs on into the question — so the ×2 / ×0
        // marker is previewed exactly as the room will see it.
        const lead = (question.kind === 'memory' ? question.memo_s ?? 10 : Math.max(3, quiz.lead_in_s || 0)) * 1000;
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
    // The roulette's options are the 37 numbers of its table.
    const slots = question.kind === 'spot' ? question.regions || [] : question.kind === 'roulette' ? Array.from({ length: 37 }) : question.options;
    const isSlider = question.kind === 'slider';
    const isRank = question.kind === 'rank';
    const isAction = question.kind === 'action';
    // A roulette room bets on a handful of numbers near the right one, not on all 37.
    const near = (i) => [1, 3, 7].some((k) => Math.abs(i - question.correct[0]) === k);
    const counts = isPuzzle ? [9] : isSlider || isRank || isAction ? []
        : question.kind === 'roulette' ? slots.map((_, i) => (question.correct.includes(i) ? 5 : near(i) ? 1 + (i % 2) : 0))
        : slots.map((_, i) => (question.correct.includes(i) ? 5 : 1) + (i % 2));
    // The slider's room: positions scattered around the target.
    // (scattered around ITS target, whatever the author set)
    const values = isSlider ? [-90, 0, 60, 120, 150, 180, 205, 230, 260, 300].map((d) => Math.max(0, Math.min(1000, (question.correct?.[0] ?? 700) - 200 + d)))
        // the action round's room: how many baskets each made
        : isAction ? [2, 4, 5, 5, 6, 7, 7, 7, 8, 9, 11] : undefined;
    // Editor rows carry circle_x/y/r columns; the demo quiz carries `circle`.
    const circle = !isPuzzle ? null : question.circle
        || (question.circle_r ? { x: question.circle_x, y: question.circle_y, r: question.circle_r, speed: question.circle_speed ?? 4 } : null);
    const answered = isSlider || isAction ? values.length : isRank ? 11 : counts.reduce((a, b) => a + b, 0);
    const revealData = { ...base.data, item: publicItem(question, items), starts_at: now - 20000, deadline: now - 1000,
        correct: isPuzzle ? [0] : question.correct, circle, arrows: question.kind === 'memory' ? question.arrows || [] : undefined, counts, values, answered, right: isRank ? 4 : undefined,
        fastest: NAMES.slice(0, 5).map((name, i) => (isAction
            ? { name, ms: 27000 - i * 600, points: [1000, 889, 778, 778, 667][i], hits: [11, 10, 9, 9, 8][i] }
            : { name, ms: 1400 + i * 900, points: 965 - i * 45 })) };

    if (view === 'explain' && question.explain) {
        const x = question.explain;
        return { state: { ...base, phase: 'explain', data: { ...revealData, explain: {
            id: x.id, kind: 'explain', title: x.title, body: x.body, image: x.image, video: x.video, audio: x.audio,
            layout: x.media_layout, music_on: x.music_on, music: x.music || null, anim_on: x.anim_on, anim_sprite: x.anim_sprite || null } } },
            me: { ...me, item_id: question.id, answered: true, option: question.correct[0] ?? 0, result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'reveal' || view === 'explain') {
        return { state: { ...base, phase: 'reveal', data: revealData, live: { ...base.live, answered: Math.min(answered, NAMES.length) } },
            me: { ...me, item_id: question.id, answered: true,
                // the ranking: this player swapped the first two places
                option: isRank ? rankWithSwap(question.correct) : isSlider ? 850 : isAction ? 7 : question.correct[0] ?? 0,
                result: isAction ? { correct: true, points: 556, ms: 27400 } : isRank ? { correct: false, points: 0, ms: 6200 } : isSlider ? { correct: true, points: 880, ms: 1400 } : { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'fastest') {
        return { state: { ...base, phase: 'fastest', data: revealData },
            me: { ...me, item_id: question.id, answered: true, option: Math.min(n - 1, 0), result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'firstfire' || view === 'leadfire') {
        return { state: { ...base, phase: 'fire', data: { ...revealData,
            fire: view === 'firstfire' ? { first: { name: 'נועה', points: 2870 } } : { lead: { name: 'נועה', gap: 640 } } } },
            me: { ...me, item_id: question.id, answered: true, option: question.correct[0] ?? 0, streak: 4, result: { correct: true, points: 965, ms: 1400 } } };
    }
    if (view === 'leaderboard') {
        return { state: { ...base, phase: 'leaderboard', data: { ...base.data, item: publicItem(question, items), leaderboard: rows,
            streaks: { 'נועה': 4, Avi: 3 } } },
            me: { ...me, points: mine.points, rank: mine.rank } };
    }
    const matrix = grid(items);
    const finished = { ...base, status: 'finished', phase: view, data: { quiz: quizData, leaderboard: rows, matrix } };
    return { state: finished, me: { ...me, points: mine.points, rank: mine.rank, cells: matrix.rows.find((r) => r.name === ME).cells } };
}
