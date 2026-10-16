-- The slider question "מה גודל הפטמה?": its picture and cut-out were remade
-- from the updated media/images/פטמה.jpeg (a tighter, sharper crop: 619×982,
-- where the old one was 788×1400). The file names are unchanged, but the gap is
-- now somewhere else in the picture, so the question's `slot` — where the
-- object was, as fractions of the picture — must move with it, or the piece
-- would be drawn beside its hole.
--
-- Matched by the picture's path, so it touches only questions built on this
-- picture. Re-runnable.

update public.gk_items
   set slot = '{"x":0.3554,"y":0.7138,"w":0.1002,"h":0.0672}'::jsonb
 where kind in ('slider', 'complete')
   and image = 'media/images/פטמה-בלי-העצם.jpg';

-- What it changed (expect one row: the slider question).
select id, kind, title, slot
  from public.gk_items
 where image = 'media/images/פטמה-בלי-העצם.jpg';
