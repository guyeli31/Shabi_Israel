-- The special slide ("ON FIRE", phase `fire`) plays "וינטר" in every question.
--
-- The slide's music is per question: gk_items.slide_music -> 'fire'. This sets
-- it on every scored item (every kind but an interlude / an "answer explained"
-- segment, which have no streak slide) of every saved quiz EXCEPT the demo
-- quiz. The question's other slides keep their music — only the 'fire' key
-- is written. Re-runnable.

-- 1. Before: which quizzes, and how many questions each.
select q.title as quiz, count(*) as questions
  from public.gk_items i join public.gk_quizzes q on q.id = i.quiz_id
 where i.kind not in ('interlude', 'explain')
   and i.quiz_id <> '6e0b5f0a-0000-4000-8000-00000000d3a0'
 group by q.title order by q.title;

-- 2. The change.
update public.gk_items i
   set slide_music = i.slide_music || jsonb_build_object('fire', 'media/audio/וינטר.mp3')
 where i.kind not in ('interlude', 'explain')
   and i.quiz_id <> '6e0b5f0a-0000-4000-8000-00000000d3a0';

-- 3. After: every one of them should show וינטר.
select q.title as quiz, i.position, i.kind, i.title, i.slide_music ->> 'fire' as fire_music
  from public.gk_items i join public.gk_quizzes q on q.id = i.quiz_id
 where i.kind not in ('interlude', 'explain')
   and i.quiz_id <> '6e0b5f0a-0000-4000-8000-00000000d3a0'
 order by q.title, i.position;
