#!/usr/bin/env node
/**
 * gevkahoot-security-check.mjs — prove what a player's browser can NOT do.
 *
 * GevKahoot's players are anonymous: every one of them holds the same public
 * key, so anything that key can read, every player can read, and anything it
 * can write, any player can forge. The design answers that with RLS deny-all
 * plus SECURITY DEFINER functions (see the header of sql/gevkahoot.sql); this
 * script is the check that the answer actually holds, run against the local
 * Docker Supabase.
 *
 * Every "is refused" assertion is paired with a control that the same route
 * DOES work when it should — a test that passes because the endpoint is simply
 * broken would otherwise look like security.
 *
 *     node scripts/gevkahoot-security-check.mjs
 *
 * Exits 1 on any failure, 2 if a real quiz is live on the local database.
 */
import { rpc, rest, sql, host, token, check, section, finish, requireIdle, seedTestQuiz, cleanup, publicState, TEST_QUIZ, Q } from './gevkahoot-lib.mjs';

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
    // A file NAME may be Hebrew or contain spaces; it may not be more than a name.
    const hebrew = sql(`insert into public.gk_items (quiz_id, kind, image) values ('${TEST_QUIZ}', 'interlude', 'media/images/עם ישראל (2).png');`);
    check('control: a Hebrew file name with spaces IS accepted', hebrew.ok, hebrew.out);
    // …and removed again: it is a real item, and would become the quiz's first.
    sql(`delete from public.gk_items where quiz_id = '${TEST_QUIZ}' and kind = 'interlude';`);
    for (const [why, path] of [
        ['a second path segment', 'media/images/sub/x.png'],
        ['a backslash', 'media/images/sub\\\\x.png'],
        ['a query string', 'media/images/x.png?v=1'],
        ['a pre-encoded escape', 'media/images/%2e%2e'],
        ['a leading dot', 'media/images/..'],
        ['a scheme-like colon', 'media/images/javascript:alert(1)'],
        ['the wrong folder for the column', 'media/videos/x.png'],
    ]) {
        const r = sql(`insert into public.gk_items (quiz_id, kind, image) values ('${TEST_QUIZ}', 'interlude', '${path}');`);
        check(`a path with ${why} is rejected`, !r.ok && /violates check/.test(r.out), r.out);
    }
    const sprite = sql(`update public.gk_quizzes set anim_sprite = 'https://evil.example/s.png' where id = '${TEST_QUIZ}';`);
    check('an off-origin animation sprite is rejected', !sprite.ok && /violates check/.test(sprite.out), sprite.out);
    const orphan = sql(`insert into public.gk_items (quiz_id, kind, title) values ('${TEST_QUIZ}', 'explain', 'x');`);
    check('an "answer explained" segment without a question is rejected', !orphan.ok && /violates check/.test(orphan.out), orphan.out);
    const itemSprite = sql(`update public.gk_items set anim_sprite = '//evil.example/s.png', music = 'media/audio/../x' where id = '${Q[0]}';`);
    check('an off-origin per-item sprite / a traversing per-item music path is rejected', !itemSprite.ok && /violates check/.test(itemSprite.out), itemSprite.out);
    const bigSymbols = sql(`update public.gk_items set symbols = to_jsonb(array[repeat('x', 300)]) where id = '${Q[0]}';`);
    check('an oversized tile symbol is rejected', !bigSymbols.ok && /violates check/.test(bigSymbols.out), bigSymbols.out);
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

    section('The puzzle: "done" is taken on trust, within what the server can check');
    sql(`insert into public.gk_items (id, quiz_id, position, kind, title, correct, weight, time_limit_s, image, circle_x, circle_y, circle_r)
         values ('7e57ab1e-0000-4000-8000-0000000000b9', '${TEST_QUIZ}', 0, 'puzzle', 'pz', '{0}', 1, 30, 'media/images/demo-puzzle.svg', 0.5, 0.5, 0.2);`);
    const PZ = '7e57ab1e-0000-4000-8000-0000000000b9';
    check('control: host opens the puzzle', host('select public.gk_admin_goto(1);').ok);
    st = await publicState();
    // A picture game opens on its instruction slide: no clock, no answering.
    check('it opens on the instruction slide, with no clock', st.phase === 'intro' && !('starts_at' in st.data) && !('deadline' in st.data), st);
    check('"done" on the instruction slide is refused', (await rpc('gk_answer', { p_token: bob, p_item: PZ, p_option: 0 })).code === 'closed');
    check('control: "next" starts the question and its countdown', host('select public.gk_admin_next();').ok);
    st = await publicState();
    check('…now the clock is published', st.phase === 'question' && st.data.deadline > st.data.starts_at, st.data);
    check('control: the puzzle and its picture are public', st.data.item?.kind === 'puzzle' && !!st.data.item.image, st.data.item);
    check('the bouncing circle is not published before the reveal', !('circle' in st.data), st.data);
    // The server gives a puzzle at least a 4s introduction; wait it out.
    await new Promise((r) => setTimeout(r, Math.max(0, st.data.starts_at - Date.now()) + 300));
    check('"done" in the first two seconds is refused', (await rpc('gk_answer', { p_token: bob, p_item: PZ, p_option: 0 })).code === 'too_fast');
    check('any option but "done" is refused', (await rpc('gk_answer', { p_token: bob, p_item: PZ, p_option: 1 })).code === 'bad_option');
    await new Promise((r) => setTimeout(r, 2000));
    check('control: "done" after that is accepted', (await rpc('gk_answer', { p_token: bob, p_item: PZ, p_option: 0 })).ok);
    check('…once', (await rpc('gk_answer', { p_token: bob, p_item: PZ, p_option: 0 })).code === 'already_answered');
    host('select public.gk_admin_reveal();');
    st = await publicState();
    check('control: the circle IS published at the reveal', st.phase === 'reveal' && st.data.circle?.r === 0.2, st.data.circle);
    const bobPz = (await rpc('gk_me', { p_token: bob })).data;
    check('a solved puzzle scores by time, like a question', bobPz.result?.correct === true && bobPz.result.points > 800 && bobPz.result.points < 1000, bobPz);
    const noCircle = sql(`update public.gk_items set circle_r = 0.9 where id = '${PZ}';`);
    check('a circle larger than the picture is rejected', !noCircle.ok && /violates check/.test(noCircle.out), noCircle.out);

    section('"Spot it": the rectangles are public, which of them is right is not');
    const SP = '7e57ab1e-0000-4000-8000-0000000000c9';
    sql(`insert into public.gk_items (id, quiz_id, position, kind, title, correct, weight, time_limit_s, image, regions)
         values ('${SP}', '${TEST_QUIZ}', -1, 'spot', 'sp', '{2}', 1, 30, 'media/images/demo-puzzle.svg',
                 '[{"x":0.1,"y":0.1,"w":0.2,"h":0.2},{"x":0.5,"y":0.1,"w":0.2,"h":0.2},{"x":0.5,"y":0.6,"w":0.2,"h":0.2}]');`);
    check('control: host opens the spot question', host('select public.gk_admin_goto(1); select public.gk_admin_next();').ok);
    st = await publicState();
    check('control: the three rectangles are public', st.data.item?.kind === 'spot' && st.data.item.regions?.length === 3, st.data.item);
    check('`correct` is absent while it is open', !JSON.stringify(st.data).includes('"correct"'), st.data);
    await new Promise((r) => setTimeout(r, Math.max(0, st.data.starts_at - Date.now()) + 200));
    check('a region that does not exist is refused', (await rpc('gk_answer', { p_token: bob, p_item: SP, p_option: 3 })).code === 'bad_option');
    check('control: tapping a real region is accepted', (await rpc('gk_answer', { p_token: bob, p_item: SP, p_option: 2 })).ok);
    host('select public.gk_admin_reveal();');
    st = await publicState();
    check('control: the right region is public at the reveal, with the split', JSON.stringify(st.data.correct) === '[2]' && st.data.counts?.length === 3, st.data);
    const ghostRegion = sql(`update public.gk_items set correct = '{5}' where id = '${SP}';`);
    check('marking a region that was never drawn as correct is rejected', !ghostRegion.ok && /violates check/.test(ghostRegion.out), ghostRegion.out);
    const tooMany = sql(`update public.gk_items set correct = '{}', regions = (select jsonb_agg(jsonb_build_object('x',0,'y',0,'w',0.1,'h',0.1)) from generate_series(1,13)) where id = '${SP}';`);
    check('a thirteenth region is rejected', !tooMany.ok && /violates check/.test(tooMany.out), tooMany.out);

    section('"Complete the picture": the candidates are public, the right one is not');
    const CP = '7e57ab1e-0000-4000-8000-0000000000d9';
    sql(`insert into public.gk_items (id, quiz_id, position, kind, title, correct, weight, time_limit_s, image, slot, options)
         values ('${CP}', '${TEST_QUIZ}', -2, 'complete', 'cp', '{1}', 1, 30, 'media/images/demo-complete.svg', '{"x":0.6,"y":0.1,"w":0.3,"h":0.4}',
                 '[{"image":"media/sprites/demo-sun.svg","scale":0.6},{"image":"media/sprites/demo-sun.svg","scale":1}]');`);
    check('control: host opens the question', host('select public.gk_admin_goto(1); select public.gk_admin_next();').ok);
    st = await publicState();
    check('control: the gap and both candidates are public', st.data.item?.kind === 'complete' && st.data.item.options?.length === 2 && st.data.item.slot?.w === 0.3, st.data.item);
    check('`correct` is absent while it is open', !JSON.stringify(st.data).includes('"correct"'), st.data);
    await new Promise((r) => setTimeout(r, Math.max(0, st.data.starts_at - Date.now()) + 200));
    check('a candidate that does not exist is refused', (await rpc('gk_answer', { p_token: bob, p_item: CP, p_option: 2 })).code === 'bad_option');
    check('control: a real candidate is accepted', (await rpc('gk_answer', { p_token: bob, p_item: CP, p_option: 1 })).ok);
    const badCandidate = sql(`update public.gk_items set options = '[{"image":"https://evil.example/p.png","scale":1}]', correct = '{}' where id = '${CP}';`);
    check('an off-origin candidate image is rejected', !badCandidate.ok && /violates check/.test(badCandidate.out), badCandidate.out);
    const sixth = sql(`update public.gk_items set correct = '{}', options = (select jsonb_agg(jsonb_build_object('image','media/sprites/a.png','scale',1)) from generate_series(1,6)) where id = '${CP}';`);
    check('a sixth candidate is rejected', !sixth.ok && /violates check/.test(sixth.out), sixth.out);

    section('The slider: a position 0-1000, scored by the server for accuracy');
    const SL = '7e57ab1e-0000-4000-8000-0000000000da';
    sql(`insert into public.gk_items (id, quiz_id, position, kind, title, correct, weight, time_limit_s, image, slot, options)
         values ('${SL}', '${TEST_QUIZ}', -3, 'slider', 'sl', '{900}', 1, 30, 'media/images/demo-slider.svg', '{"x":0.1,"y":0.3,"w":0.3,"h":0.4}',
                 '[{"image":"media/sprites/demo-house.svg","scale":1}]');`);
    check('control: host opens the slider', host('select public.gk_admin_goto(1);').ok);
    st = await publicState();
    check('it opens on the instruction slide, with no clock', st.phase === 'intro' && st.data.item?.kind === 'slider' && !('deadline' in st.data), st);
    check('a position on the instruction slide is refused', (await rpc('gk_answer', { p_token: bob, p_item: SL, p_option: 900 })).code === 'closed');
    check('control: "next" starts it', host('select public.gk_admin_next();').ok);
    st = await publicState();
    check('control: the piece and its place are public', st.data.item.options?.length === 1 && st.data.item.slot?.w === 0.3, st.data.item);
    check('`correct` and `values` are absent while it is open', !/"correct"|"values"/.test(JSON.stringify(st.data)), st.data);
    await new Promise((r) => setTimeout(r, Math.max(0, st.data.starts_at - Date.now()) + 200));
    check('a position past the end (1001) is refused', (await rpc('gk_answer', { p_token: bob, p_item: SL, p_option: 1001 })).code === 'bad_option');
    check('a negative position is refused', (await rpc('gk_answer', { p_token: bob, p_item: SL, p_option: -1 })).code === 'bad_option');
    check('control: the exact position is accepted', (await rpc('gk_answer', { p_token: bob, p_item: SL, p_option: 900 })).ok);
    check('control: the far end (a third of the area) is accepted', (await rpc('gk_answer', { p_token: alice, p_item: SL, p_option: 0 })).ok);
    host('select public.gk_admin_reveal();');
    st = await publicState();
    check('control: the reveal publishes the target and the positions chosen', JSON.stringify(st.data.correct) === '[900]' && JSON.stringify(st.data.values) === '[0,900]', st.data);
    const bobSl = (await rpc('gk_me', { p_token: bob })).data, aliceSl = (await rpc('gk_me', { p_token: alice })).data;
    check('the exact size is "correct" and scores', bobSl.result.correct === true && bobSl.result.points > 500 && bobSl.option === 900, bobSl);
    // 67% off: the factor is 1 − 0.67 = a third of the time points, and not "correct".
    check('67% off the area keeps a third of its time points and is not "correct"', aliceSl.result.correct === false
        && aliceSl.result.points > 0 && Math.abs(aliceSl.result.points / bobSl.result.points - 1 / 3) < 0.02 && aliceSl.option === 0, { aliceSl, bobSl });
    const pts = sql(`select points from public.gk_answers where item_id = '${SL}' and not voided order by option_idx;`);
    check('control: re-scoring leaves the slider points as they were', host(`select public.gk_admin_rescore('${SL}');`).ok
        && sql(`select points from public.gk_answers where item_id = '${SL}' and not voided order by option_idx;`).out === pts.out, pts.out);
    const moved = sql(`update public.gk_items set correct = '{800}' where id = '${SL}';`);
    check('a slider target other than 900 is rejected', !moved.ok && /violates check/.test(moved.out), moved.out);
    const twoPieces = sql(`update public.gk_items set options = '[{"image":"media/sprites/a.png","scale":1},{"image":"media/sprites/b.png","scale":1}]' where id = '${SL}';`);
    check('a second piece is rejected', !twoPieces.ok && /violates check/.test(twoPieces.out), twoPieces.out);
    const offSite = sql(`update public.gk_items set options = '[{"image":"https://evil.example/p.png","scale":1}]' where id = '${SL}';`);
    check('an off-origin piece is rejected', !offSite.ok && /violates check/.test(offSite.out), offSite.out);

    section('The ranking: a whole order, packed in one number; only the exact order scores');
    const RK = '7e57ab1e-0000-4000-8000-0000000000db';
    // stored scrambled; the right order (top first) is options 2, 0, 3, 1
    sql(`insert into public.gk_items (id, quiz_id, position, kind, title, body, options, correct, weight, time_limit_s)
         values ('${RK}', '${TEST_QUIZ}', -4, 'rank', 'rk', 'גדול', '["b","d","a","c"]', '{2,0,3,1}', 1, 30);`);
    const enc = (order) => order.reduce((c, o, i) => c + o * 5 ** i, 0);
    check('control: host opens the ranking', host('select public.gk_admin_goto(1);').ok);
    st = await publicState();
    check('it opens on the instruction slide', st.phase === 'intro' && st.data.item?.kind === 'rank', st);
    check('control: "next" starts it', host('select public.gk_admin_next();').ok);
    st = await publicState();
    check('control: all the options and the keyword are public', st.data.item.options?.length === 4 && st.data.item.body === 'גדול', st.data.item);
    check('the right order is absent while it is open', !/"correct"|"right"/.test(JSON.stringify(st.data)), st.data);
    await new Promise((r) => setTimeout(r, Math.max(0, st.data.starts_at - Date.now()) + 200));
    check('an order with a repeat is refused', (await rpc('gk_answer', { p_token: bob, p_item: RK, p_option: enc([2, 2, 3, 1]) })).code === 'bad_option');
    check('an order naming a 5th option of 4 is refused', (await rpc('gk_answer', { p_token: bob, p_item: RK, p_option: enc([4, 0, 3, 1]) })).code === 'bad_option');
    check('a code past the range is refused', (await rpc('gk_answer', { p_token: bob, p_item: RK, p_option: 625 })).code === 'bad_option');
    check('control: the exact order is accepted', (await rpc('gk_answer', { p_token: bob, p_item: RK, p_option: enc([2, 0, 3, 1]) })).ok);
    check('control: an order with two places swapped is accepted', (await rpc('gk_answer', { p_token: alice, p_item: RK, p_option: enc([0, 2, 3, 1]) })).ok);
    host('select public.gk_admin_reveal();');
    st = await publicState();
    check('control: the reveal publishes the order and how many got it exact', JSON.stringify(st.data.correct) === '[2,0,3,1]' && st.data.right === 1, st.data);
    const bobRk = (await rpc('gk_me', { p_token: bob })).data, aliceRk = (await rpc('gk_me', { p_token: alice })).data;
    check('the exact order is correct and scores', bobRk.result.correct === true && bobRk.result.points > 500, bobRk);
    check('an order with two places swapped scores nothing', aliceRk.result.correct === false && aliceRk.result.points === 0, aliceRk);
    const notOrder = sql(`update public.gk_items set correct = '{0,0,1,2}' where id = '${RK}';`);
    check('a "right order" with a repeat is rejected', !notOrder.ok && /violates check/.test(notOrder.out), notOrder.out);
    const short = sql(`update public.gk_items set correct = '{0,1,2}' where id = '${RK}';`);
    check('a "right order" missing an option is rejected', !short.ok && /violates check/.test(short.out), short.out);

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

finish('gevkahoot security check');
