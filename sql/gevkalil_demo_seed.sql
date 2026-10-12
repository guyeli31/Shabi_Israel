-- ============================================================================
-- gevkalil_demo_seed.sql
-- The demo quiz as a real, hostable quiz.
--
-- This is the SAME quiz as gevkalil/js/demo/demoQuiz.js — the one anyone can
-- play against bots from the entry page with no backend at all. Seeding it
-- here as well gives the editor something to open and lets a host run it live.
-- Keep the two in step: two of its questions ask about the synthetic media
-- ("how many balls?", "how many beeps?") made by
-- scripts/gevkalil-demo-media.mjs.
--
-- It is a tour of what a quiz can hold: an interlude of each media kind
-- (image, video, audio) and five questions that differ in every dimension —
-- 2 to 5 options, 10 to 30 seconds, weights x0 / x1 / x2, some with one
-- correct answer and some with several.
--
-- OPTIONAL — nothing depends on it. Re-runnable: it replaces its own quiz
-- (fixed id) and touches nothing else.
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/gevkalil_demo_seed.sql
--   Cloud:   paste into the Supabase SQL Editor and Run (only if you want the demo there)
-- Run AFTER sql/gevkalil.sql.
-- ============================================================================
begin;

delete from public.gk_quizzes where id = '6e0b5f0a-0000-4000-8000-00000000d3a0';

insert into public.gk_quizzes (id, title, theme, background, music, music_on, lead_in_s)
values ('6e0b5f0a-0000-4000-8000-00000000d3a0', 'חידון לדוגמה', 'stadium', null, 'media/audio/demo-loop.wav', true, 3);

insert into public.gk_items
  (quiz_id, position, kind, title, body, options, correct, weight, time_limit_s, image, video, audio, media_layout)
values
 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 1, 'interlude', 'ברוכים הבאים לחידון לדוגמה',
  'חמש שאלות. עונים מהר ונכון — הזמן שווה נקודות.', '[]', '{}', 1, 20,
  'media/images/demo-ball.svg', null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 2, 'question', 'חימום: כמה צלעות יש למשולש?', '',
  '["3", "4"]', '{0}', 0, 10, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 3, 'question', 'אילו צורות מופיעות בתמונה?', '',
  '["משולש", "ריבוע", "עיגול", "כוכב"]', '{0,2}', 1, 20,
  'media/images/demo-shapes.svg', null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 4, 'interlude', 'צפו היטב', 'השאלה הבאה היא על הסרטון.',
  '[]', '{}', 1, 20, null, 'media/videos/demo-clip.mp4', null, 'top'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 5, 'question', 'כמה כדורים קפצו בסרטון?', '',
  '["2", "3", "4"]', '{1}', 1, 15, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 6, 'interlude', 'עכשיו מקשיבים', 'ספרו את הצפצופים.',
  '[]', '{}', 1, 20, null, null, 'media/audio/demo-beeps.wav', 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 7, 'question', 'כמה צפצופים נשמעו?', '',
  '["3", "4", "5", "6"]', '{1}', 1, 12, null, null, null, 'side'),

 ('6e0b5f0a-0000-4000-8000-00000000d3a0', 8, 'question', 'שאלת הסיום: אילו מהמספרים זוגיים?', '',
  '["7", "12", "15", "20", "33"]', '{1,3}', 2, 30,
  'media/backgrounds/demo-pitch.svg', null, null, 'background');

commit;
