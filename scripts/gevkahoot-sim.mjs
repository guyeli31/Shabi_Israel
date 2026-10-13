#!/usr/bin/env node
/**
 * gevkahoot-sim.mjs — play a whole quiz with thirty simulated phones.
 *
 * Where gevkahoot-security-check.mjs proves what cannot be done, this proves
 * the quiz itself works end to end against the local Docker Supabase: joining
 * in parallel, scoring, the automatic reveal when the last player answers, the
 * table, going BACK and getting the earlier table back exactly, a mid-quiz
 * device relink that keeps the score, a live correction of a wrong answer key,
 * and the archive written at the end.
 *
 *     node scripts/gevkahoot-sim.mjs
 *
 * Exits 1 on any failure, 2 if a real quiz is live on the local database.
 */
import { rpc, rest, sql, host, token, check, section, finish, requireIdle, seedTestQuiz, cleanup, publicState, TEST_QUIZ, Q } from './gevkahoot-lib.mjs';

const N = 30;
requireIdle();
seedTestQuiz();

// Question 1 gets an "answer explained" segment; questions 2 and 3 do not.
sql(`insert into public.gk_items (quiz_id, parent_id, position, kind, title) values ('${TEST_QUIZ}', '${Q[0]}', 1, 'explain', 'because');`);

const players = Array.from({ length: N }, (_, i) => ({ name: `שחקן ${i + 1}`, token: token() }));
const next = () => host('select public.gk_admin_next();');
const table = () => JSON.parse(sql(`select public._gk_leaderboard(id, null) from public.gk_sessions where quiz_id = '${TEST_QUIZ}' order by created_at desc limit 1;`).out);
const totals = (rows) => rows.map((r) => `${r.name}:${r.points}:${r.rank}`).join('|');

try {
    section(`Lobby: ${N} phones join at once`);
    check('host opens the quiz', host(`select public.gk_admin_open('${TEST_QUIZ}');`).ok);
    const joined = await Promise.all(players.map((p) => rpc('gk_join', { p_name: p.name, p_token: p.token })));
    check('every join succeeded', joined.every((r) => r.ok), joined.find((r) => !r.ok));
    const lobby = (await rest('gk_public_live?id=eq.1&select=*')).data[0];
    check(`the lobby shows all ${N} names`, lobby.players === N && lobby.names.length === N, lobby);

    // ------------------------------------------------------------------------
    section('Question 1 (weight ×1, options 0 and 2 both correct)');
    check('host starts', next().ok);
    // Everyone but the last answers, one option each in rotation.
    const first = await Promise.all(players.slice(0, N - 1).map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[0], p_option: i % 3 })));
    check('29 answers accepted in parallel', first.every((r) => r.ok), first.find((r) => !r.ok));
    let st = await publicState();
    check('the question is still open while one player is missing', st.phase === 'question');
    await rpc('gk_answer', { p_token: players[N - 1].token, p_item: Q[0], p_option: 1 });
    st = await publicState();
    check('the last answer reveals the question by itself', st.phase === 'reveal', st.phase);
    check('the counts add up to the room', st.data.counts.reduce((a, b) => a + b, 0) === N && st.data.answered === N, st.data.counts);
    check('five fastest are listed, fastest first, all correct', st.data.fastest.length === 5
        && st.data.fastest.every((f, i, all) => i === 0 || all[i - 1].ms <= f.ms), st.data.fastest);

    let rows = table();
    const right = rows.filter((r) => r.points > 0).length;
    check('exactly the players who chose 0 or 2 scored', right === players.filter((_, i) => i < N - 1 && i % 3 !== 1).length, right);
    check('a fast correct answer is worth just under 1000', rows[0].points > 900 && rows[0].points <= 1000, rows[0]);
    check('ranks are 1..N with no gaps', rows.every((r, i) => r.rank === i + 1));
    const afterQ1 = totals(rows);

    section('Answer explained → fastest → table');
    next();
    st = await publicState();
    check('a question with an "answer explained" segment shows it right after the reveal',
        st.phase === 'explain' && st.data.explain?.title === 'because' && st.data.item?.id === Q[0], st.data.explain);
    check('the segment is not a stop in the running order', st.data.count === 3, st.data.count);
    const during = (await rpc('gk_me', { p_token: players[0].token })).data;
    check('a player still sees their result during it', during.result?.correct === true, during);
    next();
    check('fastest view', (await publicState()).phase === 'fastest');
    next();
    st = await publicState();
    check('table view carries every player with a previous rank', st.phase === 'leaderboard' && st.data.leaderboard.length === N
        && st.data.leaderboard.every((r) => Number.isInteger(r.prev)), st.data.leaderboard?.[0]);

    // ------------------------------------------------------------------------
    section('Question 2 (weight ×2)');
    next();
    await Promise.all(players.map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[1], p_option: i % 2 })));
    st = await publicState();
    check('revealed when everyone answered', st.phase === 'reveal');
    rows = table();
    const doubled = rows.find((r) => r.name === players[1].name); // answered wrong on q1 (i%3===1), right on q2
    check('a double-weight answer is worth just under 2000', doubled.points > 1800 && doubled.points <= 2000, doubled);
    check('the table changed', totals(rows) !== afterQ1);

    section('A phone dies mid-quiz and is linked back by the host');
    const lost = players[1];
    const before = (await rpc('gk_me', { p_token: lost.token })).data;
    const fresh = token();
    await rpc('gk_request_relink', { p_name: lost.name, p_token: fresh });
    host(`select public.gk_admin_relink(id, true) from public.gk_relink_requests where status = 'pending';`);
    const after = (await rpc('gk_me', { p_token: fresh })).data;
    check('the new device is the same player with the same score', after.player && after.name === lost.name && after.points === before.points, { before, after });
    check('the old device no longer is', (await rpc('gk_me', { p_token: lost.token })).data.player === false);
    lost.token = fresh;

    section('A wrong answer key is corrected live');
    const beforeFix = table().find((r) => r.name === players[0].name).points; // players[0] chose option 0 on q2 — marked wrong
    sql(`update public.gk_items set correct = '{0}' where id = '${Q[1]}';`);
    host(`select public.gk_admin_rescore('${Q[1]}');`);
    const afterFix = table().find((r) => r.name === players[0].name).points;
    check('re-scoring moves the points to the players who were actually right', afterFix > beforeFix + 1800, { beforeFix, afterFix });
    check('…and takes them from the others', table().find((r) => r.name === players[1].name).points === 0);
    sql(`update public.gk_items set correct = '{1}' where id = '${Q[1]}';`);
    host(`select public.gk_admin_rescore('${Q[1]}');`);

    // ------------------------------------------------------------------------
    section('Going back restores the table');
    check('host returns to question 2', host('select public.gk_admin_goto(2);').ok);
    check('the table is exactly what it was after question 1', totals(table()) === afterQ1);
    const meBack = (await rpc('gk_me', { p_token: players[0].token })).data;
    check('a player can answer the replayed question again', meBack.answered === false, meBack);
    await Promise.all(players.map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[1], p_option: i % 2 })));
    check('host returns all the way to question 1', host('select public.gk_admin_goto(1);').ok);
    check('the table is empty again', table().every((r) => r.points === 0));

    section('Replay to the end');
    await Promise.all(players.map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[0], p_option: i % 3 })));
    next(); next(); next(); next();   // answer explained, fastest, table, question 2
    await Promise.all(players.map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[1], p_option: i % 2 })));
    next(); next(); next();   // fastest, table, question 3 (weight ×0)
    // Points only, by name: a correct warm-up answer may still reorder a tie.
    const pointsByName = () => table().map((r) => `${r.name}:${r.points}`).sort().join('|');
    const beforeWarmup = pointsByName();
    await Promise.all(players.map((p, i) => rpc('gk_answer', { p_token: p.token, p_item: Q[2], p_option: i % 5 })));
    check('a zero-weight question changes nobody\'s points', pointsByName() === beforeWarmup);
    next(); next();           // fastest, table
    check('host steps past the last item', next().ok);
    st = await publicState();
    check('the quiz is finished, on the podium', st.status === 'finished' && st.phase === 'podium', st);

    section('Archive');
    const result = JSON.parse(sql(`select result from public.gk_sessions where quiz_id = '${TEST_QUIZ}' and status = 'finished';`).out);
    check('the result holds the final table', result.leaderboard.length === N);
    check('the matrix is players × questions', result.matrix.rows.length === N && result.matrix.questions.length === 3
        && result.matrix.rows.every((r) => r.cells.length === 3));
    check('a correct cell carries the answer time', result.matrix.rows.some((r) => r.cells.some((c) => c && c[0] === true && Number.isInteger(c[1]))));
    const final = (await rpc('gk_me', { p_token: players[0].token })).data;
    check('a player can still read their own final row', final.player && Array.isArray(final.cells) && final.cells.length === 3, final);
    next();
    check('podium → matrix', (await publicState()).phase === 'matrix');
    check('no new quiz can be answered into', (await rpc('gk_answer', { p_token: players[0].token, p_item: Q[2], p_option: 4 })).code === 'closed');
    check('host closes it', host('select public.gk_admin_close();').ok && (await publicState()).status === 'idle');
    check('the archive survives closing', sql(`select count(*) from public.gk_sessions where quiz_id = '${TEST_QUIZ}' and status = 'finished' and result is not null;`).out === '1');
} finally {
    cleanup();
}

finish('gevkahoot simulation');
