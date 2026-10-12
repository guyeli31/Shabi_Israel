#!/usr/bin/env node
/**
 * gevkalil-security-check.mjs — prove what a player's browser can NOT do.
 *
 * Gevkalil's players are anonymous: every one of them holds the same public
 * key, so anything that key can read, every player can read, and anything it
 * can write, any player can forge. The design answers that with RLS deny-all
 * plus SECURITY DEFINER functions (see the header of sql/gevkalil.sql); this
 * script is the check that the answer actually holds, run against the local
 * Docker Supabase.
 *
 * Every "is refused" assertion is paired with a control that the same route
 * DOES work when it should — a test that passes because the endpoint is simply
 * broken would otherwise look like security.
 *
 *     node scripts/gevkalil-security-check.mjs
 *
 * Exits 1 on any failure, 2 if a real quiz is live on the local database.
 */
import { rpc, rest, sql, host, token, check, section, finish, requireIdle, seedTestQuiz, cleanup, publicState, TEST_QUIZ, Q } from './gevkalil-lib.mjs';

requireIdle();
seedTestQuiz();

try {
    // ------------------------------------------------------------------------
    section('Tables: anon reads nothing but the two public rows');
    for (const table of ['gk_quizzes', 'gk_items', 'gk_sessions', 'gk_players', 'gk_answers', 'gk_relink_requests']) {
        const r = await rest(`${table}?select=*`);
        check(`${table} is not readable`, !r.ok || (Array.isArray(r.data) && r.data.length === 0), r);
    }
    check('control: gk_public_state IS readable', (await rest('gk_public_state?select=id')).data?.length === 1);
    check('control: gk_public_live IS readable', (await rest('gk_public_live?select=id')).data?.length === 1);

    section('Tables: anon writes nothing, public rows included');
    const forged = await rest('gk_public_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ phase: 'podium' }) });
    check('gk_public_state cannot be patched', !forged.ok || forged.data?.length === 0, forged);
    const forgedLive = await rest('gk_public_live?id=eq.1', { method: 'PATCH', body: JSON.stringify({ players: 999 }) });
    check('gk_public_live cannot be patched', !forgedLive.ok || forgedLive.data?.length === 0, forgedLive);
    const planted = await rest('gk_answers', { method: 'POST', body: JSON.stringify({ points: 99999 }) });
    check('gk_answers cannot be inserted into', !planted.ok, planted);

    // ------------------------------------------------------------------------
    section('Functions: host and internal functions are closed to anon');
    for (const [name, args] of [
        ['gk_admin_open', { p_quiz: TEST_QUIZ }], ['gk_admin_next', {}], ['gk_admin_goto', { p_index: 1 }],
        ['gk_admin_reveal', {}], ['gk_admin_show', { p_view: 'leaderboard' }], ['gk_admin_finish', {}],
        ['gk_admin_close', {}], ['gk_admin_state', {}], ['gk_admin_refresh', {}], ['gk_admin_lock', { p_locked: true }],
        ['gk_admin_rescore', { p_item: Q[0] }],
        ['_gk_publish', { p_session: null }], ['_gk_leaderboard', { p_session: TEST_QUIZ, p_exclude: null }],
        ['_gk_matrix', { p_session: TEST_QUIZ }], ['_gk_hash', { p_token: token() }], ['is_admin', {}],
    ]) {
        const r = await rpc(name, args);
        check(`${name} refused`, !r.ok, r);
    }
    check('nothing opened as a side effect', (await publicState()).status === 'idle');

    section('Functions: a signed-in user who is NOT on the allowlist is not a host');
    const stranger = sql(`select public.gk_admin_open('${TEST_QUIZ}');`, { as: 'stranger@example.com' });
    check('gk_admin_open refused for a non-admin', !stranger.ok && /not authorized/.test(stranger.out), stranger.out);
    const strangerRead = sql('select count(*) from public.gk_items;', { as: 'stranger@example.com' });
    check('gk_items shows a non-admin no rows', strangerRead.ok && strangerRead.out.split('\n').pop() === '0', strangerRead.out);
    const hashRead = sql('select token_hash from public.gk_players limit 1;', { as: 'claude-demo@example.com' });
    check('token_hash is not selectable even by an admin', !hashRead.ok && /permission denied/.test(hashRead.out), hashRead.out);

    // ------------------------------------------------------------------------
    section('Database constraints');
    const offOrigin = sql(`insert into public.gk_items (quiz_id, kind, image) values ('${TEST_QUIZ}', 'interlude', 'https://evil.example/x.png');`);
    check('an off-origin media URL is rejected', !offOrigin.ok && /violates check/.test(offOrigin.out), offOrigin.out);
    const traversal = sql(`insert into public.gk_items (quiz_id, kind, video) values ('${TEST_QUIZ}', 'interlude', 'media/videos/../../index.html');`);
    check('a path that leaves media/ is rejected', !traversal.ok && /violates check/.test(traversal.out), traversal.out);
    const sixOptions = sql(`insert into public.gk_items (quiz_id, kind, options, correct) values ('${TEST_QUIZ}', 'question', '["1","2","3","4","5","6"]', '{0}');`);
    check('a sixth option is rejected', !sixOptions.ok, sixOptions.out);
    const badCorrect = sql(`insert into public.gk_items (quiz_id, kind, options, correct) values ('${TEST_QUIZ}', 'question', '["1","2"]', '{2}');`);
    check('a correct index past the last option is rejected', !badCorrect.ok, badCorrect.out);

    // ------------------------------------------------------------------------
    section('Joining');
    check('control: host opens the quiz', host(`select public.gk_admin_open('${TEST_QUIZ}');`).ok);
    const second = host(`select public.gk_admin_open('${TEST_QUIZ}');`);
    check('a second quiz cannot be opened alongside it', !second.ok && /already_active/.test(second.out), second.out);

    const alice = token();
    const bob = token();
    check('control: a player joins', (await rpc('gk_join', { p_name: 'Alice', p_token: alice })).ok);
    check('a short token is refused', (await rpc('gk_join', { p_name: 'Mallory', p_token: '1' })).code === 'bad_token');
    check('a one-letter name is refused', (await rpc('gk_join', { p_name: 'x', p_token: token() })).code === 'bad_name');
    check('a 21-letter name is refused', (await rpc('gk_join', { p_name: 'x'.repeat(21), p_token: token() })).code === 'bad_name');
    check('a taken name is refused, case-insensitively', (await rpc('gk_join', { p_name: 'ALICE', p_token: token() })).code === 'name_taken');
    const bidi = await rpc('gk_join', { p_name: 'Bob‮\u0007', p_token: bob });
    check('bidi-override and control characters are stripped from a name', bidi.ok && bidi.data.name === 'Bob', bidi);
    const again = await rpc('gk_join', { p_name: 'Someone Else', p_token: alice });
    check('the same device joining again gets its own player back', again.ok && again.data.name === 'Alice', again);

    // ------------------------------------------------------------------------
    section('While a question is open, its answer is not in any browser');
    check('control: host starts question 1', host('select public.gk_admin_next();').ok);
    let st = await publicState();
    check('control: the question IS public', st.phase === 'question' && st.data.item?.title === 'q1');
    check('`correct` is absent from the public state', !('correct' in st.data) && !JSON.stringify(st.data).includes('"correct"'), st.data);
    check('`counts` and `fastest` are absent too', !('counts' in st.data) && !('fastest' in st.data));

    check('control: an answer is accepted', (await rpc('gk_answer', { p_token: alice, p_item: Q[0], p_option: 0 })).ok);
    const meOpen = (await rpc('gk_me', { p_token: alice })).data;
    check('gk_me does not tell the player whether they were right', meOpen.answered === true && !('result' in meOpen), meOpen);
    check('gk_me does not leak the points either', meOpen.points === 0, meOpen);
    check('a second answer is refused', (await rpc('gk_answer', { p_token: alice, p_item: Q[0], p_option: 2 })).code === 'already_answered');
    check('an answer to a different question is refused', (await rpc('gk_answer', { p_token: bob, p_item: Q[1], p_option: 1 })).code === 'closed');
    check('an out-of-range option is refused', (await rpc('gk_answer', { p_token: bob, p_item: Q[0], p_option: 7 })).code === 'bad_option');
    check('a stranger\'s token cannot answer', (await rpc('gk_answer', { p_token: token(), p_item: Q[0], p_option: 0 })).code === 'unknown_player');

    section('The clock is the server\'s');
    sql(`update public.gk_sessions set q_deadline = now() - interval '5 seconds' where status = 'running';`);
    check('an answer after the deadline is refused', (await rpc('gk_answer', { p_token: bob, p_item: Q[0], p_option: 0 })).code === 'closed');
    sql(`update public.gk_sessions set q_started_at = now() + interval '30 seconds', q_deadline = now() + interval '50 seconds' where status = 'running';`);
    check('an answer before the question starts is refused', (await rpc('gk_answer', { p_token: bob, p_item: Q[0], p_option: 0 })).code === 'closed');

    section('After the reveal');
    check('control: host reveals', host('select public.gk_admin_reveal();').ok);
    st = await publicState();
    check('control: `correct` IS now public', st.phase === 'reveal' && JSON.stringify(st.data.correct) === '[0,2]', st.data);
    const meShown = (await rpc('gk_me', { p_token: alice })).data;
    check('control: gk_me now reports the result', meShown.result?.correct === true && meShown.points > 0, meShown);
    check('an answer after the reveal is refused', (await rpc('gk_answer', { p_token: bob, p_item: Q[0], p_option: 0 })).code === 'closed');

    section('Taking over a name needs the host');
    const thief = token();
    check('a relink request for an existing name is accepted as a REQUEST', (await rpc('gk_request_relink', { p_name: 'alice', p_token: thief })).ok);
    const pending = (await rpc('gk_me', { p_token: thief })).data;
    check('…and grants nothing until approved', pending.player === false && pending.pending === true, pending);
    check('the original device is still the player', (await rpc('gk_me', { p_token: alice })).data.player === true);
    check('a relink request for an unknown name is refused', (await rpc('gk_request_relink', { p_name: 'Nobody', p_token: token() })).code === 'no_such_player');
    host(`select public.gk_admin_relink(id, false) from public.gk_relink_requests where status = 'pending';`);
    check('a rejected request still grants nothing', (await rpc('gk_me', { p_token: thief })).data.player === false);
} finally {
    cleanup();
}

finish('gevkalil security check');
