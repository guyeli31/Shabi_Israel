-- ============================================================================
-- gevkahoot_demo_seed.sql
-- The demo quiz as a real, hostable quiz.
--
-- This is the SAME quiz as gevkahoot/js/demo/demoQuiz.js — the one anyone can
-- play against bots from the entry page with no backend at all. Seeding it
-- here as well gives the editor something to open and lets a host run it live.
-- Keep the two in step: two of its questions ask about the synthetic media
-- ("how many balls?", "how many beeps?") made by
-- scripts/gevkahoot-demo-media.mjs.
--
-- It is a tour of everything a quiz can hold: every kind of scored item
-- (question, complete the picture, slider, ranking, spot it, puzzle, the
-- action round, memory), an
-- "answer explained" segment, interludes before and after questions in every
-- media kind (image, video, audio) and layout (side, top, full, background),
-- emoji in questions, in answers and on tiles, weights x0 / x1 / x2, one and
-- several right answers, and per-element overrides of the music and the
-- bouncing animation.
--
-- OPTIONAL — nothing depends on it. Re-runnable: it replaces its own quiz
-- (fixed id) and touches nothing else.
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/gevkahoot_demo_seed.sql
--   Cloud:   paste into the Supabase SQL Editor and Run (only if you want the demo there)
-- Run AFTER sql/gevkahoot.sql.
-- ============================================================================
begin;

delete from public.gk_quizzes where id = '6e0b5f0a-0000-4000-8000-00000000d3a0';

insert into public.gk_quizzes (id, title, theme, background, music, lobby_music, music_on, lead_in_s,
                               anim_on, anim_sprite, anim_count, anim_size, anim_speed, anim_front)
values ('6e0b5f0a-0000-4000-8000-00000000d3a0', 'חידון לדוגמה', 'stadium', null, 'media/audio/demo-loop.wav', 'media/audio/demo-loop.wav', true, 3,
        true, 'media/sprites/demo-ball.svg', 5, 11, 3, false);

-- Interludes and four-colour questions.
insert into public.gk_items
  (quiz_id, position, kind, title, body, options, correct, weight, time_limit_s, image, video, audio, media_layout)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 1, 'interlude', '👋 ברוכים הבאים לחידון לדוגמה',
  'סיור בכל סוגי השאלות. עונים מהר ונכון — הזמן שווה נקודות! 🏆', '[]', '{}', 1, 20,
  'media/images/demo-ball.svg', null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 2, 'question', '🔥 חימום: כמה צלעות יש למשולש?', '',
  '["3️⃣ שלוש", "4️⃣ ארבע"]', '{0}', 0, 10, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 3, 'question', 'אילו צורות מופיעות בתמונה? 👀', '',
  '["🔺 משולש", "🟥 ריבוע", "⚪ עיגול", "⭐ כוכב"]', '{0,2}', 1, 20,
  'media/images/demo-shapes.svg', null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 4, 'interlude', '🎬 צפו היטב', 'השאלה הבאה היא על הסרטון.',
  '[]', '{}', 1, 20, null, 'media/videos/demo-clip.mp4', null, 'top'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 5, 'question', 'כמה כדורים קפצו בסרטון? ⚽', '',
  '["2", "3", "4"]', '{1}', 1, 15, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 6, 'interlude', '🎧 עכשיו מקשיבים', 'ספרו את הצפצופים.',
  '[]', '{}', 1, 20, null, null, 'media/audio/demo-beeps.wav', 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 7, 'question', 'כמה צפצופים נשמעו? 🔔', '',
  '["3", "4", "5", "6"]', '{1}', 1, 12, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 8, 'interlude', '🖼️ ועכשיו — משחקי תמונה',
  'לפני כל אחד מהם: שקופית קצרה שמראה איך משחקים.', '[]', '{}', 1, 20,
  'media/images/demo-puzzle.svg', null, null, 'full'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 17, 'question', '🏁 שאלת הסיום: אילו מהמספרים זוגיים?', '',
  '["7", "12", "15", "20", "33"]', '{1,3}', 2, 30,
  'media/backgrounds/demo-pitch.svg', null, null, 'background'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 18, 'interlude', '🎉 זהו, סיימנו!', 'ועכשיו — מי ניצח? 🥁',
  '[]', '{}', 1, 20, 'media/images/demo-ball.svg', null, null, 'top');

-- The mark sets: emoji on the warm-up's two tiles, playing cards on the shapes
-- question, Catan terrain tiles on the video question, electronic parts on the
-- beeps question.
update public.gk_items set marks = 'emoji', symbols = '["🔺", "🟦"]'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 2;
update public.gk_items set marks = 'catan'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 5;
update public.gk_items set marks = 'circuit'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 7;
update public.gk_items set marks = 'cards'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 3;
-- Per-element overrides: the shapes question bounces a sun instead of the
-- quiz's ball; the beeps question has no music; the picture-games interlude
-- has no animation.
update public.gk_items set anim_sprite = 'media/sprites/demo-sun.svg'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 3;
update public.gk_items set music_on = false
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 7;
update public.gk_items set anim_on = false
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 8;

-- An "answer explained" segment for the video question: shown after its
-- reveal, before the fastest five and the table. It belongs to the question
-- (parent_id) and shares its position.
insert into public.gk_items (quiz_id, parent_id, position, kind, title, body, image, media_layout)
select quiz_id, id, position, 'explain', '💡 שלושה כדורים',
       'צהוב, ורוד ותכלת — כל אחד בגודל ובקצב קפיצה משלו.', 'media/images/demo-ball.svg', 'side'
  from public.gk_items
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and position = 5 and kind = 'question';

-- "Complete the picture": the sun is missing from the scene; four suns of
-- different sizes to try in its place, the third being the real size.
insert into public.gk_items
  (quiz_id, position, kind, title, correct, weight, time_limit_s, image, slot, options)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 9, 'complete', '☀️ איזו שמש משלימה את התמונה?', '{2}', 1, 20,
  'media/images/demo-complete.svg', '{"x":0.6413,"y":0.0417,"w":0.2975,"h":0.3967}',
  '[{"image":"media/sprites/demo-sun.svg","scale":0.55},{"image":"media/sprites/demo-sun.svg","scale":1.35},{"image":"media/sprites/demo-sun.svg","scale":1},{"image":"media/sprites/demo-sun.svg","scale":0.78}]');

-- The slider: the house is taken out of the scene and put back at whatever
-- size the player slides it to (the target is always 70%). A house emoji
-- rides on the handle.
insert into public.gk_items
  (quiz_id, position, kind, title, correct, weight, time_limit_s, image, slot, options, symbols)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 10, 'slider', '🎚️ באיזה גודל הבית באמת?', '{700}', 1, 20,
  'media/images/demo-slider.svg', '{"x":0.115,"y":0.37,"w":0.3325,"h":0.4533}',
  '[{"image":"media/sprites/demo-house.svg","scale":1}]', '["🏠"]');

-- The ranking: biggest at the top (keyword in `body`). Stored scrambled, as
-- the editor stores it; `correct` is the right order, top place first:
-- לוויתן (1), פיל (0), סוס (3), חתול (2).
insert into public.gk_items
  (quiz_id, position, kind, title, body, options, correct, weight, time_limit_s)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 11, 'rank', '🔢 סדרו מהגדול לקטן', 'גדול',
  '["🐘 פיל", "🐋 לוויתן", "🐈 חתול", "🐎 סוס"]', '{1,0,3,2}', 1, 25);

-- "Spot it": four rectangles on the picture (house, sun, tree, ball); the
-- ball (index 3) is the right one.
insert into public.gk_items
  (quiz_id, position, kind, title, correct, weight, time_limit_s, image, regions)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 12, 'spot', '🔎 איפה הכדור?', '{3}', 1, 15,
  'media/images/demo-puzzle.svg',
  '[{"x":0.11,"y":0.36,"w":0.34,"h":0.48},{"x":0.62,"y":0.03,"w":0.34,"h":0.42},{"x":0.62,"y":0.52,"w":0.19,"h":0.34},{"x":0.5,"y":0.78,"w":0.13,"h":0.17}]');

-- The puzzle: the picture is cut into five pieces; the circle is the sun,
-- which bounces around the screen once the puzzle is revealed.
insert into public.gk_items
  (quiz_id, position, kind, title, correct, weight, time_limit_s, image, circle_x, circle_y, circle_r)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 13, 'puzzle', '🧩 הרכיבו את התמונה', '{0}', 1, 40,
  'media/images/demo-puzzle.svg', 0.79, 0.24, 0.2);

-- The action round, right after the puzzle: the puzzle's round detail (the sun)
-- is now the ball. Free throws for 30 seconds; points relative to the room.
insert into public.gk_items
  (quiz_id, position, kind, title, options, correct, weight, time_limit_s, image, circle_x, circle_y, circle_r, feedback)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 14, 'action', '🏀 כמה סלים תקלעו?', '[]', '{}', 1, 30,
  'media/images/demo-puzzle.svg', 0.79, 0.24, 0.2,
  '{"hit": ["יש! 🔥", "סל! כמו בנבא 🏀", "איזה יד!", "עוד אחד כזה!"], "miss": ["אוף, כמעט 😬", "לא נורא, עוד ניסיון!", "הטבעת לא אוהבת אותך היום", "נשום עמוק ושוב"]}');

-- The memory question: the picture is up for six seconds, then the question;
-- at the reveal it returns with two arrows, one at each cloud.
insert into public.gk_items
  (quiz_id, position, kind, title, options, correct, weight, time_limit_s, image, memo_s, arrows)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 15, 'memory', '☁️ כמה עננים היו בשמיים?', '["1", "2", "3", "4"]', '{1}', 1, 15,
  'media/images/demo-puzzle.svg', 6,
  '[{"x1":0.08,"y1":0.5,"x2":0.24,"y2":0.27},{"x1":0.62,"y1":0.6,"x2":0.51,"y2":0.34}]');

-- The roulette: a chip on a number of the table; at the reveal the wheel
-- spins and the ball drops into 11.
insert into public.gk_items (quiz_id, position, kind, title, correct, weight, time_limit_s)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 16, 'roulette', '🎰 כמה שחקנים יש לקבוצת כדורגל על המגרש?', '{11}', 1, 20);

-- The closing interlude: the built-in gnomes as its animation.
update public.gk_items set anim_sprite = 'builtin:gnomes'
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and kind = 'interlude' and title = '🎉 זהו, סיימנו!';

-- Every element carries its own animation now (an element shows one only
-- when switched on): the sample's elements show the quiz's ball — or their
-- own sun / gnomes — except the picture-games interlude, as before; and the
-- closing (podium, matrix) the ball too.
update public.gk_items
   set anim_on = true, anim_sprite = coalesce(anim_sprite, 'media/sprites/demo-ball.svg'),
       anim_count = 5, anim_size = 11, anim_speed = 3, anim_front = false
 where quiz_id = '6e0b5f0a-0000-4000-8000-00000000d3a0' and not (parent_id is null and position = 8);
-- The closing's own animation (podium, matrix) — independent of the opening's:
-- the built-in gnomes, one of each colour (as js/demo/demoQuiz.js).
update public.gk_quizzes
   set closing_anim_on = true, closing_anim_sprite = 'builtin:gnomes',
       closing_anim_count = 6, closing_anim_size = 12, closing_anim_speed = 3, closing_anim_front = false
 where id = '6e0b5f0a-0000-4000-8000-00000000d3a0';

commit;
