-- Makes the live quiz's action round(s) use the SAME circle as the puzzle
-- that precedes them, instead of whatever was copied when the action item
-- was first created in the editor (image, circle_x/y/r are copied once at
-- creation time — gkEditor.js addItem() — and never re-synced automatically
-- afterwards, so moving or resizing the puzzle's circle later leaves the
-- action round's ball stale).
--
-- Scope: only the quiz currently on air (gk_sessions.status in lobby/running).
-- For each action item in that quiz, finds the nearest PRECEDING puzzle item
-- (lower position, same quiz) that has a circle set, and copies its
-- image/circle_x/circle_y/circle_r onto the action item. Re-runnable.

-- 1. Before: today's action items and the puzzle each would be matched to.
with live as (
  select quiz_id from public.gk_sessions where status in ('lobby', 'running') limit 1
),
matched as (
  select a.id as action_id, a.position as action_pos, a.image as action_image,
         a.circle_x as action_x, a.circle_y as action_y, a.circle_r as action_r,
         p.id as puzzle_id, p.position as puzzle_pos, p.image as puzzle_image,
         p.circle_x as puzzle_x, p.circle_y as puzzle_y, p.circle_r as puzzle_r
    from live, public.gk_items a
    left join lateral (
      select * from public.gk_items p
       where p.quiz_id = a.quiz_id and p.kind = 'puzzle' and p.circle_r is not null and p.position < a.position
       order by p.position desc limit 1
    ) p on true
   where a.quiz_id = live.quiz_id and a.kind = 'action'
)
select * from matched;

-- 2. The change: only rows with a matching puzzle, and only where something differs.
with live as (
  select quiz_id from public.gk_sessions where status in ('lobby', 'running') limit 1
),
matched as (
  select a.id as action_id,
         p.image as puzzle_image, p.circle_x as puzzle_x, p.circle_y as puzzle_y, p.circle_r as puzzle_r
    from live, public.gk_items a
    join lateral (
      select * from public.gk_items p
       where p.quiz_id = a.quiz_id and p.kind = 'puzzle' and p.circle_r is not null and p.position < a.position
       order by p.position desc limit 1
    ) p on true
   where a.quiz_id = live.quiz_id and a.kind = 'action'
)
update public.gk_items a
   set image = m.puzzle_image, circle_x = m.puzzle_x, circle_y = m.puzzle_y, circle_r = m.puzzle_r
  from matched m
 where a.id = m.action_id
   and (a.image, a.circle_x, a.circle_y, a.circle_r) is distinct from (m.puzzle_image, m.puzzle_x, m.puzzle_y, m.puzzle_r);

-- 3. After: confirm every action item in the live quiz now matches its puzzle.
with live as (
  select quiz_id from public.gk_sessions where status in ('lobby', 'running') limit 1
)
select a.position, a.title, a.image, a.circle_x, a.circle_y, a.circle_r
  from live, public.gk_items a
 where a.quiz_id = live.quiz_id and a.kind = 'action'
 order by a.position;
