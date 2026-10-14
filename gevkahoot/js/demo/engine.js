/**
 * engine.js — a whole quiz in the browser, for the demo.
 *
 * In a live quiz the state a screen renders comes from the database, and the
 * host decides when it moves. The demo has neither: this module plays both
 * parts. It runs the demo quiz on a timer, moves eleven bots through it
 * (joining one by one, answering at their own pace and accuracy), scores
 * everyone with the live formula, and emits state objects of EXACTLY the shape
 * _gk_publish() and gk_me() produce — so the player's screen cannot tell the
 * difference and the demo exercises the real rendering code, not a mock-up.
 *
 * Nothing leaves the browser: no request is made and nothing is stored.
 */
import { DEMO_QUIZ, DEMO_ITEMS, DEMO_BOTS } from './demoQuiz.js';
import { points, sliderPoints, sliderCorrect, sliderDeviation, SLIDER, encodeRank, decodeRank } from '../scoring.js';

const PAUSE = { intro: 9000, fire: 10000, reveal: 5000, explain: 6000, fastest: 5000, leaderboard: 7500, podium: 11000 };
const LOBBY_MS = 12000;

export function createDemo(onChange) {
    // "Scored" items: questions and puzzles — everything but an interlude.
    const questions = DEMO_ITEMS.filter((i) => i.kind !== 'interlude');
    let players, user, status, phase, index, rev, until, startsAt, deadline, plans;

    function reset() {
        players = [];
        user = null;
        status = 'lobby';
        phase = 'lobby';
        index = -1;
        rev = 0;
        until = null;      // when the current phase moves on by itself
        startsAt = 0;
        deadline = 0;
        plans = [];        // the bots' pending answers for the open question
    }

    const item = () => DEMO_ITEMS[index] || null;
    /** How many answers an item offers: options, drawn regions, or the puzzle's single "done". */
    const choices = (it) => (it.kind === 'puzzle' ? 1 : it.kind === 'spot' ? it.regions.length : ['slider', 'rank'].includes(it.kind) ? 0 : it.options.length);
    const answered = (it) => players.filter((p) => p.answers[it.id]);

    // ---- the table (same order as _gk_leaderboard) ---------------------------
    function table(exclude) {
        const rows = players.map((p, order) => {
            const all = Object.entries(p.answers);
            const sum = (list, f) => list.reduce((n, [, a]) => n + f(a), 0);
            const prev = all.filter(([id]) => id !== exclude);
            return {
                name: p.name, order,
                points: sum(all, (a) => a.points), prevPoints: sum(prev, (a) => a.points),
                correct: sum(all, (a) => (a.correct ? 1 : 0)), prevCorrect: sum(prev, (a) => (a.correct ? 1 : 0)),
                ms: sum(all, (a) => (a.correct ? a.ms : 0)), prevMs: sum(prev, (a) => (a.correct ? a.ms : 0)),
            };
        });
        const rank = (pts, n, ms) => [...rows].sort((a, b) => b[pts] - a[pts] || b[n] - a[n] || a[ms] - b[ms] || a.order - b.order);
        const now = rank('points', 'correct', 'ms');
        const before = rank('prevPoints', 'prevCorrect', 'prevMs');
        return now.map((r, i) => ({
            name: r.name, points: r.points, gain: r.points - r.prevPoints,
            rank: i + 1, prev: before.indexOf(r) + 1, correct: r.correct,
        }));
    }

    function matrix() {
        const rows = table(null);
        return {
            questions: questions.map((q, i) => ({ no: i + 1, title: q.title, weight: q.weight, kind: q.kind })),
            rows: rows.map((r) => {
                const p = players.find((x) => x.name === r.name);
                return { name: r.name, rank: r.rank, points: r.points,
                    cells: questions.map((q) => cellOf(q, p.answers[q.id])) };
            }),
        };
    }

    /** One matrix cell, as _gk_matrix builds it: [correct, ms, points, deviation (slider only)]. */
    const cellOf = (q, a) => (a ? [a.correct, a.ms, a.points, q.kind === 'slider' ? sliderDeviation(a.option) : null] : null);

    // ---- streaks (same rules as _gk_runs / _gk_streaks / _gk_fire) ------------
    /** Runs of correct answers over the scored items worth something, up to the
     *  current one. A ×0 item neither counts nor breaks; no answer breaks. */
    function streakState() {
        const it = item();
        const qs = DEMO_ITEMS.slice(0, index + 1).filter((q) => q.kind !== 'interlude' && q.weight > 0);
        const curK = it && it.kind !== 'interlude' && it.weight > 0 ? qs.length - 1 : null;
        const now = {};        // name → run still going at the newest scored item
        const reached = [];    // { name, k, p3 } — where each run first hit three
        for (const p of players) {
            let run = 0, p3 = 0;
            qs.forEach((q, k) => {
                const a = p.answers[q.id];
                if (a?.correct) {
                    run += 1;
                    if (run <= 3) p3 += a.points;
                    if (run === 3) reached.push({ name: p.name, k, p3 });
                } else { run = 0; p3 = 0; }
            });
            if (run >= 3) now[p.name] = run;
        }
        const firstK = reached.length ? Math.min(...reached.map((r) => r.k)) : null;
        const firster = firstK !== null && firstK === curK
            ? reached.filter((r) => r.k === firstK).sort((a, b) => b.p3 - a.p3 || a.name.localeCompare(b.name))[0] : null;
        return {
            streaks: now,
            // the special slide for THIS item, if it is where someone first got three
            fire: firster ? { first: { name: firster.name, points: firster.p3 } } : null,
            // has anyone had three in a row yet (if not, the leader gets the slide)
            ever: reached.length > 0,
        };
    }

    /** The leader slide (as _gk_lead): every player tied at the top, and the gap to second. */
    function leadData() {
        const rows = table(null);
        if (!rows.length) return null;
        const top = rows[0].points;
        const tied = rows.filter((r) => r.points === top);
        const second = rows.find((r) => r.points < top);
        return { lead: { name: tied.map((r) => r.name).sort().join(' · '), gap: tied.length > 1 ? 0 : top - (second ? second.points : 0) } };
    }

    // ---- what the screen is told (same shape as _gk_publish / gk_me) ---------
    function publicItem(it) {
        return {
            id: it.id, kind: it.kind, title: it.title, body: it.body,
            options: ['question', 'complete', 'slider', 'rank'].includes(it.kind) ? it.options : [], slot: it.slot || null,
            weight: it.weight, time_limit: it.time_limit_s,
            image: it.image, video: it.video, audio: it.audio, layout: it.media_layout, music_on: it.music_on,
            anim_on: it.anim_on, regions: it.kind === 'spot' ? it.regions : [],
            music: it.music, anim_sprite: it.anim_sprite, symbols: it.symbols || [], marks: it.marks || 'teams',
            no: questions.filter((q) => DEMO_ITEMS.indexOf(q) <= index).length, of: questions.length,
        };
    }

    function buildState() {
        const it = item();
        const quiz = { title: DEMO_QUIZ.title, theme: DEMO_QUIZ.theme, background: DEMO_QUIZ.background,
            music: DEMO_QUIZ.music, music_on: DEMO_QUIZ.music_on, anim: DEMO_QUIZ.anim };
        let data = { quiz, index: index + 1, count: DEMO_ITEMS.length, locked: false };
        const revealed = ['reveal', 'explain', 'fastest', 'fire', 'leaderboard'].includes(phase);

        if (status === 'finished') {
            data = { quiz, leaderboard: table(null), matrix: matrix() };
        } else if (it) {
            data.item = publicItem(it);
            if (it.kind !== 'interlude' && phase !== 'intro') {
                data.starts_at = startsAt;
                data.deadline = deadline;
                if (revealed) {
                    const got = answered(it);
                    data.correct = it.correct;
                    data.circle = it.kind === 'puzzle' ? it.circle || null : null;
                    data.counts = Array.from({ length: choices(it) }, (_, i) => got.filter((p) => p.answers[it.id].option === i).length);
                    data.answered = got.length;
                    if (it.kind === 'rank') data.right = got.filter((p) => p.answers[it.id].correct).length;
                    if (it.kind === 'slider') data.values = got.map((p) => p.answers[it.id].option).sort((a, b) => a - b);
                    data.fastest = got.filter((p) => p.answers[it.id].correct)
                        .sort((a, b) => a.answers[it.id].ms - b.answers[it.id].ms).slice(0, 5)
                        .map((p) => ({ name: p.name, ms: p.answers[it.id].ms, points: p.answers[it.id].points }));
                }
            }
            if (phase === 'explain' && it.explain) {
                const x = it.explain;
                data.explain = { id: x.id, kind: 'explain', title: x.title, body: x.body, image: x.image, video: x.video, audio: x.audio,
                    layout: x.media_layout, music_on: x.music_on, music: x.music, anim_on: x.anim_on, anim_sprite: x.anim_sprite };
            }
            if (phase === 'fire') data.fire = streakState().fire || leadData();
            if (phase === 'leaderboard') {
                data.leaderboard = table(it.kind !== 'interlude' ? it.id : null);
                data.streaks = it.kind !== 'interlude' ? streakState().streaks : {};
            }
        }
        return { status, phase, rev, data,
            live: { players: players.length, names: players.map((p) => p.name),
                answered: it && it.kind !== 'interlude' ? answered(it).length : 0 } };
    }

    function buildMe() {
        if (!user) return { player: false };
        const it = item();
        const open = phase === 'question';
        const row = table(open && it ? it.id : null).find((r) => r.name === user.name);
        const me = { player: true, name: user.name, players: players.length,
            points: open ? row.points - row.gain : row.points, rank: open ? row.prev : row.rank };
        if (it && it.kind !== 'interlude' && status !== 'finished' && phase !== 'intro') {
            const a = user.answers[it.id];
            me.item_id = it.id;
            me.answered = !!a;
            me.option = a ? a.option : null;
            // As in a live quiz: the outcome is withheld until the reveal.
            if (!open) {
                me.result = { correct: !!a?.correct, points: a?.points || 0, ms: a?.ms ?? null };
                me.streak = streakState().streaks[user.name] || 0;
            }
        }
        if (status === 'finished') me.cells = questions.map((q) => cellOf(q, user.answers[q.id]));
        return me;
    }

    const emit = () => { rev += 1; onChange(buildState(), { me: buildMe(), demo: { until } }); };
    /** A counter moved but the screen is the same — do not bump rev, or the
     *  stage would rebuild (and restart its video) on every bot's answer. */
    const emitLive = () => onChange(buildState(), { me: buildMe(), demo: { until } });

    // ---- moving through the quiz ---------------------------------------------
    function enter(next, opts = {}) {
        index = next;
        const it = item();
        status = 'running';
        if (it.kind === 'interlude') {
            phase = 'interlude';
            until = Date.now() + it.seconds * 1000;
        } else if (['puzzle', 'spot', 'complete', 'slider', 'rank'].includes(it.kind) && !opts.started) {
            // As on the server: a picture game opens on its instruction slide,
            // with no clock. There is no host here, so it moves on by itself
            // after a few seconds (or when the player presses "start").
            phase = 'intro';
            until = Date.now() + PAUSE.intro;
        } else {
            phase = 'question';
            until = null;
            startsAt = Date.now() + DEMO_QUIZ.lead_in_s * 1000;
            deadline = startsAt + it.time_limit_s * 1000;
            // Each bot decides now whether, when and what it will answer.
            plans = players.filter((p) => p.bot).filter(() => Math.random() < 0.96).map((p) => {
                const limit = it.time_limit_s * 1000;
                const spread = (Math.random() + Math.random() - 1) * 0.22;
                if (it.kind === 'puzzle') {
                    // A bot "assembles" it: always right, never instant, and
                    // the weaker ones sometimes run out of time (no answer).
                    const ms = Math.round((0.3 + p.bot.pace * 0.75 + spread) * limit);
                    return ms < limit - 300 ? { player: p, at: startsAt + ms, ms, option: 0 } : null;
                }
                const ms = Math.round(Math.min(limit - 400, Math.max(900, (p.bot.pace + spread) * limit)));
                if (it.kind === 'rank') {
                    // Right order, or the right order with two neighbours swapped.
                    const order = [...it.correct];
                    if (Math.random() >= p.bot.skill) { const k = Math.floor(Math.random() * (order.length - 1)); [order[k], order[k + 1]] = [order[k + 1], order[k]]; }
                    return { player: p, at: startsAt + ms, ms, option: encodeRank(order) };
                }
                if (it.kind === 'slider') {
                    // A bot's eye: off by up to ±(1 − skill) of the area, centred on the truth.
                    const off = (Math.random() * 2 - 1) * (1 - p.bot.skill) * 0.9;
                    const option = Math.round(Math.min(SLIDER.max, Math.max(0, SLIDER.target + off * 1350)));
                    return { player: p, at: startsAt + ms, ms, option };
                }
                const right = Math.random() < p.bot.skill;
                const all = Array.from({ length: choices(it) }, (_, i) => i);
                const pool = all.filter((i) => it.correct.includes(i) === right);
                const option = (pool.length ? pool : all)[Math.floor(Math.random() * (pool.length || all.length))];
                return { player: p, at: startsAt + ms, ms, option };
            }).filter(Boolean);
        }
        emit();
    }

    function record(player, it, option, ms) {
        if (it.kind === 'slider') {
            player.answers[it.id] = { option, ms, correct: sliderCorrect(option), points: sliderPoints(option, it.weight, ms, it.time_limit_s) };
            return;
        }
        const correct = it.kind === 'rank'
            ? (decodeRank(option, it.options.length) || []).join() === it.correct.join()
            : it.correct.includes(option);
        player.answers[it.id] = { option, ms, correct, points: points(correct, it.weight, ms, it.time_limit_s) };
    }

    function advance() {
        const it = item();
        if (status === 'lobby') {
            // "Start now" must not leave half the room outside: whoever has not
            // walked in yet walks in with the whistle.
            for (const bot of DEMO_BOTS) if (!players.some((p) => p.bot === bot)) players.push({ name: bot.name, bot, answers: {} });
            return enter(0);
        }
        if (phase === 'intro') return enter(index, { started: true });
        if (phase === 'question') { phase = 'reveal'; until = Date.now() + PAUSE.reveal; return emit(); }
        // As on the server: a question's "answer explained" segment comes
        // between its reveal and the fastest five.
        if (phase === 'reveal' && it.explain) { phase = 'explain'; until = Date.now() + (it.explain.seconds * 1000 || PAUSE.explain); return emit(); }
        if (phase === 'reveal' || phase === 'explain') { phase = 'fastest'; until = Date.now() + PAUSE.fastest; return emit(); }
        if (phase === 'fastest') {
            // As on the server: the ON FIRE slide when someone's run of three or
            // more includes this question — longer when it is the first one.
            if (streakState().fire) { phase = 'fire'; until = Date.now() + PAUSE.fire; return emit(); }
        }
        if (phase === 'fastest' || (phase === 'fire' && streakState().fire)) { phase = 'leaderboard'; until = Date.now() + PAUSE.leaderboard; return emit(); }
        if (phase === 'podium') { phase = 'matrix'; until = null; return emit(); }
        if (phase === 'matrix') return undefined;
        if (index + 1 < DEMO_ITEMS.length) {
            // As on the server: if nobody has had three in a row by the time the
            // last question comes up, the special slide goes to the leader first.
            const lastQ = DEMO_ITEMS.map((q, i) => (q.kind !== 'interlude' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
            const before = DEMO_ITEMS.slice(0, index + 1).some((q) => q.kind !== 'interlude');
            if (phase !== 'fire' && index + 1 === lastQ && before && !streakState().ever) {
                phase = 'fire'; until = Date.now() + PAUSE.fire; return emit();
            }
            return enter(index + 1);
        }
        status = 'finished';
        phase = 'podium';
        until = Date.now() + PAUSE.podium;
        return emit();
    }

    setInterval(() => {
        const now = Date.now();
        if (status === 'lobby') {
            if (!user) return;
            const due = DEMO_BOTS.filter((b) => b.joinAt <= now && !players.some((p) => p.bot === b));
            for (const bot of due) players.push({ name: bot.name, bot, answers: {} });
            if (due.length) emitLive();
            if (until && now >= until) advance();
            return;
        }
        if (phase === 'question') {
            const it = item();
            const due = plans.filter((p) => p.at <= now);
            if (due.length) {
                plans = plans.filter((p) => p.at > now);
                for (const p of due) record(p.player, it, p.option, p.ms);
                emitLive();
            }
            if (now > deadline || answered(it).length === players.length) advance();
            return;
        }
        if (until && now >= until) advance();
    }, 100);

    reset();
    queueMicrotask(emit);

    return {
        /** Same contract as gk_join: a short machine code on refusal. */
        join(name) {
            const clean = String(name || '').replace(/\s+/g, ' ').trim();
            const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
            if (clean.length < 2 || clean.length > 20) fail('bad_name');
            if (DEMO_BOTS.some((b) => b.name.toLowerCase() === clean.toLowerCase())) fail('name_taken');
            user = { name: clean, answers: {} };
            players.push(user);
            const now = Date.now();
            // The bots trickle in over the first nine seconds, as a room fills.
            DEMO_BOTS.forEach((bot, i) => { bot.joinAt = now + 500 + i * 760 + Math.random() * 300; });
            until = now + LOBBY_MS;
            emit();
        },
        answer(itemId, option) {
            const it = item();
            const now = Date.now();
            if (!user || phase !== 'question' || !it || it.id !== itemId || user.answers[it.id]) return;
            if (now < startsAt || now > deadline) return;
            record(user, it, option, now - startsAt);
            // Nobody real is left to wait for. The bots' answers were decided
            // when the question opened (what, and after how long), so they are
            // simply recorded now with those times — their scores are what
            // they would have been — and the answer is revealed at once.
            for (const p of plans) record(p.player, it, p.option, p.ms);
            plans = [];
            advance();
        },
        /** "Continue" — cut short a pause the timer would end anyway. Never an
         *  open question: its clock is the game. */
        skip() { if (user && until && phase !== 'question') advance(); },
        restart() { reset(); emit(); },
    };
}
