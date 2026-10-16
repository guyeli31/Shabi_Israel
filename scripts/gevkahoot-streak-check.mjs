#!/usr/bin/env node
/**
 * gevkahoot-streak-check.mjs — runs of correct answers, and the quiz's one
 * special slide: for the first player to get three in a row — or, if nobody
 * does, before the last question for the leader.
 *
 * A quiz of five scored questions (one of them a ×0 warm-up, which must
 * neither extend a run nor break it), three phones with designed answer
 * patterns, and at every step a check of what the server publishes:
 *
 *              q1   q2   w×0   q3   q4
 *     Ada      ✓    ✓    ✕     ✓    ✕      fast — first to three, at q3
 *     Ben      ✓    ✓    –     ✓    ✓      also three at q3, but slower
 *     Cal      ✕    ✓    –     ✓    ✓      three at q4 — not "first"
 *
 * Local Docker Supabase only; refuses to run while a quiz is live.
 *     node scripts/gevkahoot-streak-check.mjs
 */
import { rpc, sql, host, token, check, section, finish, publicState, requireIdle } from './gevkahoot-lib.mjs';

const QUIZ = '7e57ab1e-0000-4000-8000-0000000f17e0';
const ids = [1, 2, 3, 4, 5].map((n) => `7e57ab1e-0000-4000-8000-0000000f17e${n}`);
const [Q1, Q2, W0, Q3, Q4] = ids;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup() {
    sql(`update public.gk_sessions set status = 'aborted' where status in ('lobby','running') and quiz_id = '${QUIZ}';
         select public._gk_publish(null) where exists (select 1 from public.gk_public_state st join public.gk_sessions g on g.id = st.session_id where g.quiz_id = '${QUIZ}');
         delete from public.gk_sessions where quiz_id = '${QUIZ}';
         delete from public.gk_quizzes where id = '${QUIZ}';`);
}

requireIdle();
cleanup();
const seeded = sql(`
    insert into public.gk_quizzes (id, title, lead_in_s) values ('${QUIZ}', 'streak test quiz', 0);
    insert into public.gk_items (id, quiz_id, position, kind, title, options, correct, weight, time_limit_s) values
      ('${Q1}', '${QUIZ}', 1, 'question', 'q1', '["a","b"]', '{0}', 1, 20),
      ('${Q2}', '${QUIZ}', 2, 'question', 'q2', '["a","b"]', '{0}', 1, 20),
      ('${W0}', '${QUIZ}', 3, 'question', 'w0', '["a","b"]', '{0}', 0, 20),
      ('${Q3}', '${QUIZ}', 4, 'question', 'q3', '["a","b"]', '{0}', 1, 20),
      ('${Q4}', '${QUIZ}', 5, 'question', 'q4', '["a","b"]', '{0}', 1, 20);`);
if (!seeded.ok) throw new Error(seeded.out);

const next = () => host('select public.gk_admin_next();');
const phones = { Ada: token(), Ben: token(), Cal: token() };
/** Open item `item`, let the phones answer (`picks`: name → option, in that
 *  order, a little apart so the first is fastest), and reveal. */
async function play(item, picks) {
    let st = await publicState();
    if (st.data.item?.id !== item) throw new Error(`expected ${item} on screen, got ${st.data.item?.id} (${st.phase})`);
    await sleep(Math.max(0, st.data.starts_at - Date.now()) + 50);
    for (const [name, option] of Object.entries(picks)) {
        await rpc('gk_answer', { p_token: phones[name], p_item: item, p_option: option });
        await sleep(250);
    }
    host('select public.gk_admin_reveal();');
}
/** reveal → fastest → (fire?) — returns the phase after "fastest". */
async function afterFastest() {
    next();                     // fastest
    next();                     // fire, or the table
    return publicState();
}

try {
    host(`select public.gk_admin_open('${QUIZ}');`);
    for (const [name, t] of Object.entries(phones)) await rpc('gk_join', { p_name: name, p_token: t });
    next();   // "starting in…"
    next();   // q1

    section('Two in a row is not a streak yet');
    await play(Q1, { Ada: 0, Ben: 0, Cal: 1 });
    let st = await afterFastest();
    check('after q1: straight from the fastest five to the table', st.phase === 'leaderboard', st.phase);
    check('…with nobody on fire', JSON.stringify(st.data.streaks) === '{}', st.data.streaks);
    next();
    await play(Q2, { Ada: 0, Ben: 0, Cal: 0 });
    st = await afterFastest();
    check('after q2 (two in a row): still no slide', st.phase === 'leaderboard', st.phase);
    next();

    section('A ×0 warm-up neither counts nor breaks');
    await play(W0, { Ada: 1 });   // Ada wrong, Ben and Cal do not answer
    st = await afterFastest();
    check('after the ×0 item: no slide', st.phase === 'leaderboard', st.phase);
    next();

    section('Three in a row: the special slide, once');
    await play(Q3, { Ada: 0, Ben: 0, Cal: 0 });
    let me = (await rpc('gk_me', { p_token: phones.Ada })).data;
    check('the phone hears its own streak at the reveal', me.streak === 3, me);
    st = await afterFastest();
    check('after q3: the special slide', st.phase === 'fire', st.phase);
    check('…naming Ada, the first (Ben also reached three, with fewer points)', st.data.fire?.first?.name === 'Ada' && !st.data.fire.lead, st.data.fire);
    next();
    st = await publicState();
    check('then the table, with the flames beside the names', st.phase === 'leaderboard' && st.data.streaks.Ada === 3 && st.data.streaks.Ben === 3 && !('Cal' in st.data.streaks), st.data.streaks);
    next();
    st = await publicState();
    check('a streak happened, so no leader slide before the last question', st.phase === 'question' && st.data.item.id === Q4, [st.phase, st.data.item?.id]);

    section('No second slide');
    await play(Q4, { Ben: 0, Cal: 0, Ada: 1 });
    // q4 is the LAST question: no table after it (the winners come next), so
    // the flames are read from the players' own lines on its fastest five.
    next();                     // fastest
    st = await publicState();
    check('after q4 (Ben at four, Cal at three): no second special slide', st.phase === 'fastest', st.phase);
    const flames = {};
    for (const name of ['Ben', 'Cal']) flames[name] = (await rpc('gk_me', { p_token: phones[name] })).data.streak;
    check('…and their flames are still counted', flames.Ben === 4 && flames.Cal === 3, flames);
    me = (await rpc('gk_me', { p_token: phones.Ada })).data;
    check('a broken run is reported as 0', me.streak === 0, me);

    section('Going back recomputes it');
    host('select public.gk_admin_goto(4);');   // q3 again: its answers are voided
    // Replayed with Ada wrong this time: only Ben reaches three at q3.
    // (Had both reached it, Ada would still win the tie: the tie-break is
    // the points of the whole three-answer run, and she was faster on q1-q2.)
    await play(Q3, { Ben: 0, Cal: 0, Ada: 1 });
    st = await afterFastest();
    check('replayed q3 with Ada wrong: Ben is the first', st.phase === 'fire' && st.data.fire?.first?.name === 'Ben', st.data.fire);

    section('Nobody reaches three: the slide comes before the last question, for the leader');
    host('select public.gk_admin_goto(1);');   // everything voided
    const forced = host(`select public.gk_admin_show('fire');`);
    check('with no streak, forcing the slide as a view is refused', !forced.ok && /bad_view/.test(forced.out), forced.out);
    await play(Q1, { Ada: 0 });
    next(); next();                             // fastest, table
    next();
    await play(Q2, { Ada: 1, Ben: 0 });         // Ada's run breaks; Ben has one
    next(); next(); next();
    await play(W0, {});
    next(); next(); next();
    await play(Q3, { Ada: 0 });                 // Ada: 1, 0, -, 1 — never three
    st = await afterFastest();
    check('after q3: the table (no streak slide)', st.phase === 'leaderboard', st.phase);
    next();
    st = await publicState();
    check('next: the special slide instead of the last question', st.phase === 'fire' && !!st.data.fire?.lead, st.data.fire);
    const table = JSON.parse(sql(`select public._gk_leaderboard(id, null) from public.gk_sessions where quiz_id = '${QUIZ}' and status = 'running';`).out);
    check('…naming the leader with the gap to second place', st.data.fire?.lead?.name === table[0].name
        && st.data.fire.lead.gap === table[0].points - table[1].points && st.data.fire.lead.gap > 0, { fire: st.data.fire, table });
    next();
    st = await publicState();
    check('then the last question itself', st.phase === 'question' && st.data.item.id === Q4, [st.phase, st.data.item?.id]);
} finally {
    cleanup();
}

finish('gevkahoot streak check');
