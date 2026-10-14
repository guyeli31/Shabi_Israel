-- ============================================================================
-- gevkahoot.sql
-- GevKahoot — the live quiz served from golan.me.uk/gevkahoot/.
-- ============================================================================
-- One quiz may be on air at a time. The host (an admin, on a desktop) projects
-- the question; players join from their phones with a temporary name and no
-- account, and the phone is only a remote: coloured tiles, no question text.
--
-- THE SECURITY MODEL, in one paragraph. A player is not a Supabase user — the
-- whole audience shares the `anon` role, so RLS cannot tell two players apart
-- and no table a player touches may be writable (or, mostly, readable) by anon.
-- Everything a player does therefore goes through a SECURITY DEFINER function
-- that identifies them by a random device token, of which only the sha256 is
-- stored. The server owns the clock, the correctness check and the score; the
-- browser is trusted with nothing. And the correct answers live in gk_items,
-- which anon cannot read at all — they reach a browser only inside
-- gk_public_state, and only once the host has revealed the question.
--
-- What anon CAN read is exactly two single-row tables:
--   gk_public_state — what the projected screen is showing right now
--   gk_public_live  — the fast-moving counters (who joined, how many answered)
-- Both are in the realtime publication; everything else is deny-all.
--
-- Admin authority reuses public.is_admin() / public.admin_emails — the same
-- allowlist as the main site, so there is no second roster to keep in step.
--
-- SAFE and RE-RUNNABLE: additive tables (create if not exists), functions
-- create-or-replace, policies dropped-if-exists then recreated.
--
-- Run order: AFTER sql/admin_write_allowlist_2026-10-09.sql (needs is_admin()).
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/gevkahoot.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Authoring tables — admins only.
--    Media columns hold a path INSIDE gevkahoot/media/, never a URL: a CHECK
--    (section 1b, below the tables) makes the database itself refuse an
--    off-origin resource, so the project's no-third-party rule holds even
--    against a hand-written INSERT.
-- ----------------------------------------------------------------------------
create table if not exists public.gk_quizzes (
    id          uuid primary key default gen_random_uuid(),
    title       text not null default 'חידון חדש' check (char_length(title) between 1 and 80),
    theme       text not null default 'stadium' check (theme in ('stadium', 'candy', 'night')),
    background  text,
    music       text,
    music_on    boolean not null default true,
    lead_in_s   smallint not null default 3 check (lead_in_s between 0 and 10),
    created_at  timestamptz not null default now()
);

create table if not exists public.gk_items (
    id           uuid primary key default gen_random_uuid(),
    quiz_id      uuid not null references public.gk_quizzes(id) on delete cascade,
    position     integer not null default 0,
    kind         text not null,   -- question | interlude | puzzle | spot | explain | complete (CHECK below, so it can grow)
    title        text not null default '' check (char_length(title) <= 300),
    body         text not null default '' check (char_length(body) <= 600),
    options      jsonb not null default '[]'::jsonb,
    correct      integer[] not null default '{}',
    weight       smallint not null default 1 check (weight in (0, 1, 2)),
    time_limit_s integer not null default 20 check (time_limit_s between 5 and 300),
    image        text,
    video        text,
    audio        text,
    media_layout text not null default 'side' check (media_layout in ('side', 'top', 'background', 'full')),
    music_on     boolean not null default true,
    created_at   timestamptz not null default now(),
    -- A question has 2-5 options and at least one correct index, all in range.
    constraint gk_items_question_shape check (
        kind <> 'question' or (
            jsonb_typeof(options) = 'array'
            and jsonb_array_length(options) between 2 and 5
            and cardinality(correct) >= 1
            and correct <@ (array[0, 1, 2, 3, 4])[1:jsonb_array_length(options)]
        )
    )
);
create index if not exists gk_items_quiz_order on public.gk_items (quiz_id, position, created_at, id);

-- The bouncing animation: one cut-out picture ("sprite"), multiplied, drifting
-- across the screen in straight lines and reflecting off its edges. It is a
-- property of the quiz; an item can switch it off for itself, like the music.
-- Added with ALTER so re-running this file upgrades an existing database.
alter table public.gk_quizzes
    add column if not exists anim_on     boolean  not null default false,
    add column if not exists anim_sprite text,
    add column if not exists anim_count  smallint not null default 6,
    add column if not exists anim_size   smallint not null default 12,
    add column if not exists anim_speed  smallint not null default 4,
    add column if not exists anim_front  boolean  not null default false;
alter table public.gk_items
    add column if not exists anim_on boolean not null default true;

-- The puzzle: a third kind of item. Its picture (`image`) is cut into five
-- pieces that each player drags back into place against the clock; "done" is
-- its one and only answer, stored as option 0, so everything downstream —
-- scoring by time, the fastest five, the table, the matrix — treats it as an
-- ordinary question with a single correct option.
--   circle_*  the host's pick of a round detail of the picture (centre and
--             radius, as fractions of the picture's width / height / shorter
--             side). At the reveal the rest of the picture fades away and that
--             one detail, at its own size, bounces around the screen.
--   circle_speed  how fast it bounces, 1-10 (the scale of the quiz's anim_speed)
alter table public.gk_items
    add column if not exists circle_x real,
    add column if not exists circle_y real,
    add column if not exists circle_r real,
    add column if not exists circle_speed smallint not null default 4;

-- "Spot it": a picture with rectangles the host drew on it (around faces,
-- say). The rectangles ARE the answers — a player taps one and confirms — so
-- this too is an ordinary question underneath: region N is option N, and
-- `correct` lists the indexes of the right ones (there may be several).
--   regions  [{x, y, w, h}, …] — each a fraction of the picture's width/height.
-- The rectangles are public while the question is open (they are what the
-- player chooses between); which of them are right is not, exactly as with
-- option texts.
alter table public.gk_items
    add column if not exists regions jsonb not null default '[]'::jsonb;

-- The "answer explained" segment: an interlude that BELONGS to a question. It
-- is shown right after that question's answer is revealed and before the
-- fastest five and the table. It is a row of its own (so it has its own text,
-- media, music and animation like any item) tied to its question by parent_id:
-- it is not a stop in the quiz's running order, it moves and is deleted with
-- its question, and a question has at most one.
alter table public.gk_items
    add column if not exists parent_id uuid references public.gk_items(id) on delete cascade;
create unique index if not exists gk_items_one_explain on public.gk_items (parent_id) where parent_id is not null;

-- Per-item overrides. NULL means "whatever the quiz uses"; the existing
-- music_on / anim_on = false still mean "none here".
--   anim_sprite  a different bouncing picture for this item only
--   music        different background music for this item only
--   symbols      per answer, an emoji to show on its tile instead of the
--                default emblem ('' or missing = the emblem)
alter table public.gk_items
    add column if not exists anim_sprite text,
    add column if not exists music text,
    add column if not exists symbols jsonb not null default '[]'::jsonb;

-- "Complete the picture": a picture with one object taken out of it (the host
-- cuts it out in the editor, which also paints the background back in), and
-- 2-5 candidate pieces to put in the gap. A player tries them on the picture
-- and submits one. So, once more, an ordinary question: piece N is option N.
--   image    the picture WITH THE GAP
--   slot     {x, y, w, h} — where the missing object was, as fractions of the
--            picture; a piece is drawn centred there
--   options  [{image, scale}, …] — each candidate is a cut-out in
--            media/sprites/ and a size relative to the real one (1 = exact).
--            Typically the same cut-out at several sizes, one of them right.
alter table public.gk_items
    add column if not exists slot jsonb;

-- The slider: the same cut-out-from-a-picture as "complete the picture", but
-- ONE piece, always drawn at the object's own place, whose SIZE the player
-- sets with a slider. The answer is the slider's position, 0-1000, stored in
-- option_idx; the area grows linearly with it, from a third of the real area
-- at 0 to exactly the real area at 900 (see _gk_slider_dev). `correct` is
-- therefore always '{900}' — it is the target position, not an option index.
--   image    the picture WITH THE GAP     slot     where the object was
--   options  [{image, scale: 1}] — the one cut-out (none yet = not cut)
--   symbols  [emoji] — optional: an emoji riding on the slider's handle, which
--            grows and shrinks in the same ratio as the object
-- The ranking question: all the options at once, to be dragged into order by
-- a keyword the host chose (`body`: "מוקדם", "גדול" — most at the top). The
-- answer is the whole order, packed into option_idx (see _gk_rank_order), and
-- `correct` is the right order: option indexes from the top place down. The
-- options are STORED scrambled by the editor (scrambleRank in js/scoring.js),
-- because the stored order is the order a player first sees.
alter table public.gk_items drop constraint if exists gk_items_kind_check;
alter table public.gk_items add constraint gk_items_kind_check
    check (kind in ('question', 'interlude', 'puzzle', 'spot', 'explain', 'complete', 'slider', 'rank', 'memory', 'action', 'roulette'));

-- The roulette question: a betting table of 0-36 (single zero); a player puts
-- a chip on one number. The number IS the option index, so it is an ordinary
-- question with 37 options and exactly one right — and at the reveal the
-- wheel spins and the ball drops into it.
alter table public.gk_items drop constraint if exists gk_items_roulette_shape;
alter table public.gk_items add constraint gk_items_roulette_shape check (
    kind <> 'roulette' or (cardinality(correct) = 1 and correct[1] between 0 and 36)
);

-- The memory question: a picture shown for `memo_s` seconds, then taken away,
-- and only then the question about something in it, with 2-5 answers — an
-- ordinary question from there on (option N = tile N, any number right). The
-- memorising time is the question's lead-in: _gk_start_question sets
-- q_started_at that far ahead, so gk_answer refuses an answer while the
-- picture is still up, and the time points count from when it goes.
--   memo_s  how long the picture stays up, 3-120
--   arrows  [{x1, y1, x2, y2}, …] — up to twelve, each tail to tip as fractions
--           of the picture: drawn on the picture at the reveal, pointing at
--           what was asked about. Published only at the reveal (they ARE the
--           answer).
alter table public.gk_items drop constraint if exists gk_items_memory_shape;
alter table public.gk_items drop column if exists arrow;   -- a single-arrow draft, never released
alter table public.gk_items
    add column if not exists memo_s smallint not null default 10,
    add column if not exists arrows jsonb not null default '[]'::jsonb;
alter table public.gk_items add constraint gk_items_memory_shape check (
    memo_s between 3 and 120
    and jsonb_typeof(arrows) = 'array'
    and jsonb_array_length(arrows) <= 12
    and char_length(arrows::text) <= 1500
    and not jsonb_path_exists(arrows, '$[*] ? (@.type() != "object")')
    and not jsonb_path_exists(arrows, '$[*] ? (!(exists(@.x1) && exists(@.y1) && exists(@.x2) && exists(@.y2)))')
    and not jsonb_path_exists(arrows, '$[*].* ? (@.type() != "number" || @ < 0 || @ > 1)')
    and (kind <> 'memory' or (
        jsonb_typeof(options) = 'array'
        and jsonb_array_length(options) between 2 and 5
        and cardinality(correct) >= 1
        and correct <@ (array[0, 1, 2, 3, 4])[1:jsonb_array_length(options)]))
);

-- 2-5 options, and `correct` a full order of them: as long as the list, and
-- containing every index (equal length + all present = no repeats).
alter table public.gk_items drop constraint if exists gk_items_rank_shape;
alter table public.gk_items add constraint gk_items_rank_shape check (
    kind <> 'rank' or (
        jsonb_typeof(options) = 'array'
        and jsonb_array_length(options) between 2 and 5
        and cardinality(correct) = jsonb_array_length(options)
        and correct @> (array[0, 1, 2, 3, 4])[1:jsonb_array_length(options)]
        and char_length(body) <= 40
    )
);

-- The action round ("🏀 קליעות"): free throws for the whole time limit. The
-- ball is a round detail of a picture — `image` + circle_x/y/r, normally the
-- very circle the puzzle before it lifted off its picture (its sounds are the
-- quiz's fixed ones, js/ui/sounds.js — not a column). No options and no
-- `correct`: the answer is how many baskets the player made, in option_idx,
-- re-sent after every throw (gk_answer keeps the highest). Its points are
-- RELATIVE, so they are set for the whole room at once by _gk_action_score.
--   feedback  {hit: [..], miss: [..]} — the lines the quiz's author wrote for
--             a basket and for a miss (one is picked at random per throw;
--             none: the built-in ones). Up to 12 of each, 80 characters each.
alter table public.gk_items drop constraint if exists gk_items_action_shape;
alter table public.gk_items
    add column if not exists feedback jsonb not null default '{}'::jsonb;
alter table public.gk_items drop constraint if exists gk_items_feedback_shape;
alter table public.gk_items add constraint gk_items_feedback_shape check (
    jsonb_typeof(feedback) = 'object'
    and char_length(feedback::text) <= 2400
    and (feedback - 'hit' - 'miss') = '{}'::jsonb
    and (not feedback ? 'hit' or (jsonb_typeof(feedback -> 'hit') = 'array' and jsonb_array_length(feedback -> 'hit') <= 12))
    and (not feedback ? 'miss' or (jsonb_typeof(feedback -> 'miss') = 'array' and jsonb_array_length(feedback -> 'miss') <= 12))
    -- every line a one-line string of 1-80 characters
    and not jsonb_path_exists(feedback, '$.*[*] ? (@.type() != "string" || !(@ like_regex "^.{1,80}$"))')
);
alter table public.gk_items add constraint gk_items_action_shape check (
    kind <> 'action' or (
        jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 0
        and cardinality(correct) = 0
        and time_limit_s between 10 and 120
    )
);

alter table public.gk_items drop constraint if exists gk_items_slider_shape;
alter table public.gk_items add constraint gk_items_slider_shape check (
    kind <> 'slider' or (
        jsonb_typeof(options) = 'array'
        and jsonb_array_length(options) <= 1
        and correct = '{900}'
        and not jsonb_path_exists(options,
              '$[*] ? (!(@.image like_regex "^media/sprites/[^./\\\\?#%:*<>|][^/\\\\?#%:*<>|]*$"))')
    )
);

-- Up to five candidates, `correct` naming only ones that exist, and every
-- candidate's image a file in media/sprites/ — the same "a path is only ever a
-- file name inside its folder" rule as the media columns (§1b), applied inside
-- the JSON. No minimum: the row must be saveable before the object is cut.
alter table public.gk_items drop constraint if exists gk_items_complete_shape;
alter table public.gk_items add constraint gk_items_complete_shape check (
    kind <> 'complete' or (
        jsonb_typeof(options) = 'array'
        and jsonb_array_length(options) <= 5
        and correct <@ (array[0, 1, 2, 3, 4])[1:jsonb_array_length(options)]
        and not jsonb_path_exists(options,
              '$[*] ? (!(@.image like_regex "^media/sprites/[^./\\\\?#%:*<>|][^/\\\\?#%:*<>|]*$"))')
        and not jsonb_path_exists(options, '$[*] ? (!(@.scale > 0.1 && @.scale < 5))')
    )
);

alter table public.gk_items drop constraint if exists gk_items_explain_shape;
alter table public.gk_items add constraint gk_items_explain_shape
    check ((kind = 'explain') = (parent_id is not null));

-- The set of marks on a question's (or a ranking's) tiles: the team crests,
-- Catan terrain tiles, electronic parts or playing cards — files in assets/<set>/<colour>.svg
-- (js/ui/teams.js) — or 'emoji', where the author picks one per answer in
-- `symbols`. An emoji in `symbols` wins whatever the set, which is also how a
-- question saved before this column existed still shows its emojis.
alter table public.gk_items
    add column if not exists marks text not null default 'teams';
alter table public.gk_items drop constraint if exists gk_items_marks_check;
alter table public.gk_items add constraint gk_items_marks_check
    check (marks in ('teams', 'emoji', 'catan', 'circuit', 'cards'));

alter table public.gk_items drop constraint if exists gk_items_symbols_shape;
alter table public.gk_items add constraint gk_items_symbols_shape check (
    jsonb_typeof(symbols) = 'array' and jsonb_array_length(symbols) <= 5 and char_length(symbols::text) <= 240
);

-- Up to twelve regions; `correct` may only name regions that exist. (Unlike a
-- question's options there is no minimum: the host draws them one at a time,
-- and the row has to be saveable in between.)
alter table public.gk_items drop constraint if exists gk_items_spot_shape;
alter table public.gk_items add constraint gk_items_spot_shape check (
    kind <> 'spot' or (
        jsonb_typeof(regions) = 'array'
        and jsonb_array_length(regions) <= 12
        and correct <@ (array[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])[1:jsonb_array_length(regions)]
    )
);

alter table public.gk_items drop constraint if exists gk_items_puzzle_shape;
alter table public.gk_items add constraint gk_items_puzzle_shape check (
        (kind <> 'puzzle' or correct = '{0}')
    and (circle_x is null or circle_x between 0 and 1)
    and (circle_y is null or circle_y between 0 and 1)
    and (circle_r is null or circle_r between 0.03 and 0.5)
    and circle_speed between 1 and 10
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gk_quizzes_anim_shape') then
    alter table public.gk_quizzes add constraint gk_quizzes_anim_shape check (
          anim_count between 1 and 30      -- how many copies at once
      and anim_size  between 3 and 40      -- % of the screen's shorter side
      and anim_speed between 1 and 10
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1b. What a media path may be: `media/<folder>/<file name>` and nothing else.
--     The file NAME may be anything a person would call a file — Hebrew,
--     spaces, brackets — because the first real files dropped into the folder
--     were named in Hebrew and silently never appeared in the editor. What it
--     may not contain is anything that could make it more than a name:
--       /  \        another path segment (so no `..` traversal, no `//host`)
--       ? # %       a query, a fragment, a pre-encoded escape
--       : * " < > | characters no Windows file can have anyway (":" is also
--                   what a URL scheme needs)
--       control characters, or a leading dot (hidden files, `.` and `..`)
--     The path is anchored at `media/`, so it can never be a URL.
--     Dropped and re-added on every run, so re-running this file upgrades the
--     rule in place (the first version allowed A-Z a-z 0-9 . _ - only).
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_name constant text := '[^./\\?#%:*"<>|[:cntrl:]][^/\\?#%:*"<>|[:cntrl:]]*';
begin
  for r in
    select * from (values
      ('gk_quizzes', 'background',  'backgrounds'),
      ('gk_quizzes', 'music',       'audio'),
      ('gk_quizzes', 'anim_sprite', 'sprites'),
      ('gk_items',   'image',       'images|backgrounds'),
      ('gk_items',   'video',       'videos'),
      ('gk_items',   'audio',       'audio'),
      ('gk_items',   'music',       'audio'),
      ('gk_items',   'anim_sprite', 'sprites')
    ) as t(tbl, col, folders)
  loop
    -- the inline CHECKs of the first version were auto-named <table>_<col>_check
    execute format('alter table public.%I drop constraint if exists %I;', r.tbl, r.tbl || '_' || r.col || '_check');
    execute format('alter table public.%I drop constraint if exists %I;', r.tbl, r.tbl || '_' || r.col || '_path');
    execute format('alter table public.%I add constraint %I check (%I is null or %I ~ %L);',
                   r.tbl, r.tbl || '_' || r.col || '_path', r.col, r.col,
                   '^media/(' || r.folders || ')/' || v_name || '$');
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Run-time tables — deny-all to browsers, reached only through functions.
-- ----------------------------------------------------------------------------
create table if not exists public.gk_sessions (
    id            uuid primary key default gen_random_uuid(),
    quiz_id       uuid references public.gk_quizzes(id) on delete set null,
    quiz_title    text not null default '',
    status        text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'aborted')),
    phase         text not null default 'lobby'
                  check (phase in ('lobby', 'interlude', 'intro', 'question', 'reveal', 'explain', 'fastest', 'fire', 'leaderboard', 'podium', 'matrix')),
    cur_index     integer,
    cur_item_id   uuid,
    q_started_at  timestamptz,
    q_deadline    timestamptz,
    revealed      boolean not null default false,
    locked        boolean not null default false,
    created_at    timestamptz not null default now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    -- Frozen at finish: quiz snapshot + final table + matrix. This is the
    -- archive; it stays readable after the quiz itself is edited or deleted.
    result        jsonb
);
-- "No parallel quizzes" as a constraint rather than a convention.
-- Re-stated as ALTERs so a database created before the 'explain' phase gets it.
alter table public.gk_sessions drop constraint if exists gk_sessions_phase_check;
alter table public.gk_sessions add constraint gk_sessions_phase_check
    check (phase in ('lobby', 'interlude', 'intro', 'question', 'reveal', 'explain', 'fastest', 'fire', 'leaderboard', 'podium', 'matrix'));
create unique index if not exists gk_sessions_one_active
    on public.gk_sessions ((true)) where status in ('lobby', 'running');

create table if not exists public.gk_players (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.gk_sessions(id) on delete cascade,
    name        text not null,
    name_key    text not null,
    token_hash  text,
    joined_at   timestamptz not null default now(),
    last_seen   timestamptz not null default now(),
    kicked      boolean not null default false,
    unique (session_id, name_key)
);
create index if not exists gk_players_token on public.gk_players (session_id, token_hash);

create table if not exists public.gk_answers (
    id          bigint generated always as identity primary key,
    session_id  uuid not null references public.gk_sessions(id) on delete cascade,
    item_id     uuid not null,
    player_id   uuid not null references public.gk_players(id) on delete cascade,
    option_idx  smallint not null,
    answered_ms integer not null,
    is_correct  boolean not null,
    points      integer not null,
    -- Going back to an earlier question voids the answers from there on rather
    -- than deleting them: the table is always "sum of the non-voided answers",
    -- so it returns to exactly what it was, and the history stays auditable.
    voided      boolean not null default false,
    created_at  timestamptz not null default now()
);
create unique index if not exists gk_answers_one_per_player
    on public.gk_answers (session_id, item_id, player_id) where not voided;

create table if not exists public.gk_relink_requests (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.gk_sessions(id) on delete cascade,
    player_id   uuid not null references public.gk_players(id) on delete cascade,
    token_hash  text not null,
    status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. The two public single-row tables.
-- ----------------------------------------------------------------------------
create table if not exists public.gk_public_state (
    id          integer primary key check (id = 1),
    rev         bigint not null default 0,
    session_id  uuid,
    status      text not null default 'idle',
    phase       text not null default 'idle',
    data        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);
create table if not exists public.gk_public_live (
    id          integer primary key check (id = 1),
    -- Bumped on every write. Clients order updates by this, not by
    -- updated_at: several writes in one transaction share a now().
    seq         bigint not null default 0,
    answered    integer not null default 0,
    players     integer not null default 0,
    names       jsonb not null default '[]'::jsonb,
    updated_at  timestamptz not null default now()
);
alter table public.gk_public_live add column if not exists seq bigint not null default 0;
insert into public.gk_public_state (id) values (1) on conflict (id) do nothing;
insert into public.gk_public_live  (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. RLS + grants. Supabase's default privileges hand anon/authenticated ALL
--    on every new public table, so each table is revoked first and then given
--    back exactly what it should have.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['gk_quizzes','gk_items','gk_sessions','gk_players','gk_answers',
                           'gk_relink_requests','gk_public_state','gk_public_live']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;

  -- authoring: full access for admins
  foreach t in array array['gk_quizzes','gk_items']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('drop policy if exists %I_admin_all on public.%I;', t, t);
    execute format('create policy %I_admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t, t);
  end loop;

  -- run-time: admins may READ (the archive); nobody writes except the functions
  foreach t in array array['gk_sessions','gk_players','gk_answers','gk_relink_requests']
  loop
    execute format('grant select on public.%I to authenticated;', t);
    execute format('drop policy if exists %I_admin_select on public.%I;', t, t);
    execute format('create policy %I_admin_select on public.%I for select to authenticated using (public.is_admin());', t, t);
  end loop;

  -- public: read-only for everyone
  foreach t in array array['gk_public_state','gk_public_live']
  loop
    execute format('grant select on public.%I to anon, authenticated;', t);
    execute format('drop policy if exists %I_public_select on public.%I;', t, t);
    execute format('create policy %I_public_select on public.%I for select to anon, authenticated using (true);', t, t);
  end loop;
end;
$$;

-- gk_players.token_hash must not reach even an admin's browser.
revoke select on public.gk_players from authenticated;
grant select (id, session_id, name, joined_at, last_seen, kicked) on public.gk_players to authenticated;
revoke select on public.gk_relink_requests from authenticated;
grant select (id, session_id, player_id, status, created_at) on public.gk_relink_requests to authenticated;

-- Realtime: only the two public rows are ever broadcast.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['gk_public_state','gk_public_live']
    loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I;', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Internal helpers (underscore prefix = never granted to a browser role).
-- ----------------------------------------------------------------------------
create or replace function public._gk_hash(p_token text)
returns text language plpgsql immutable set search_path = public, pg_catalog as $$
begin
  -- The token is minted by the browser (crypto.getRandomValues, hex). Refusing
  -- anything else keeps a guessable "token" like '1' from ever being stored.
  if p_token is null or p_token !~ '^[0-9a-f]{32,64}$' then
    raise exception 'bad_token' using errcode = '22023';
  end if;
  return encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end;
$$;

-- The quiz's items in play order, numbered. Every "which item is N" question
-- goes through here so two functions cannot disagree about the order.
create or replace function public._gk_ordered(p_quiz uuid)
returns table (idx integer, item_id uuid, kind text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select (row_number() over (order by i.position, i.created_at, i.id))::int, i.id, i.kind
    from public.gk_items i where i.quiz_id = p_quiz and i.parent_id is null;
$$;

-- The quiz as a screen sees it. One function, because it is published while
-- the quiz runs AND frozen into the archive at the end — two hand-written
-- copies of this object had already been made, and a field added to one only
-- would have vanished from finished quizzes.
create or replace function public._gk_quiz_json(p_quiz uuid, p_fallback_title text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(
    (select jsonb_build_object(
              'title', q.title, 'theme', q.theme, 'background', q.background,
              'music', q.music, 'music_on', q.music_on,
              -- Always present, with `on`: an item may bring its own sprite to a
              -- quiz whose animation is otherwise off, and still needs the
              -- quiz's count / size / speed to bounce it with.
              'anim', jsonb_build_object('on', q.anim_on and q.anim_sprite is not null, 'sprite', q.anim_sprite,
                                         'count', q.anim_count, 'size', q.anim_size,
                                         'speed', q.anim_speed, 'front', q.anim_front))
       from public.gk_quizzes q where q.id = p_quiz),
    jsonb_build_object('title', p_fallback_title, 'theme', 'stadium', 'background', null,
                       'music', null, 'music_on', false, 'anim', null));
$$;

create or replace function public._gk_ms(p_ts timestamptz)
returns bigint language sql immutable as $$
  select (extract(epoch from p_ts) * 1000)::bigint;
$$;

-- points = round( weight × 1000 × (1 − 0.5 × t/T) ) for a correct answer.
create or replace function public._gk_points(p_correct boolean, p_weight int, p_ms int, p_limit_s int)
returns integer language sql immutable as $$
  select case when p_correct
              then round(p_weight * 1000 * (1 - 0.5 * least(greatest(p_ms, 0), p_limit_s * 1000)::numeric / (p_limit_s * 1000)))::int
              else 0 end;
$$;

-- The slider's deviation: (area chosen / real area) − 1, signed. Position v
-- (0-1000) gives area 1/3 + 2/3 × v/900, so the deviation is (v − 900)/1350.
-- Mirrored by sliderDeviation() in js/scoring.js.
create or replace function public._gk_slider_dev(p_value int)
returns numeric language sql immutable as $$
  select (p_value - 900)::numeric / 1350;
$$;

-- A ranking answer's code → the order it stands for (option indexes, top
-- first), or NULL if it is not a full order of p_n options. The code is the
-- order's base-5 digits, the top place in the lowest. Mirrored by
-- decodeRank() in js/scoring.js.
create or replace function public._gk_rank_order(p_code int, p_n int)
returns int[] language sql immutable as $$
  with d as (select array_agg((p_code / (5 ^ i)::int) % 5 order by i) as o
               from generate_series(0, p_n - 1) as g(i))
  select case when p_code >= 0 and p_code < (5 ^ p_n)::int
               and (select count(distinct x) from unnest(d.o) x where x < p_n) = p_n
              then d.o end
    from d;
$$;

-- What one answer is worth — the one place the kinds differ in scoring, used
-- by gk_answer and by the re-score after a live edit.
--   every kind but the slider: right or wrong, and time-based points if right;
--   the slider: time-based points scaled by accuracy, 1 − |dev| — the
--     deviation as a fraction of the real area, so a 100% deviation would score
--     nothing (the slider cannot get there: its worst is −67%) — and "correct"
--     (fastest five, the tie-break) within 5% of the real area.
create or replace function public._gk_score(p_kind text, p_correct int[], p_option int, p_weight int, p_ms int, p_limit_s int,
                                            out is_correct boolean, out points int)
language sql immutable as $$
  select case when p_kind = 'slider' then abs(public._gk_slider_dev(p_option)) <= 0.05
              -- the ranking: only the exact order
              when p_kind = 'rank' then public._gk_rank_order(p_option, cardinality(p_correct)) = p_correct
              else p_option = any (p_correct) end,
         case when p_kind = 'slider'
              then round(public._gk_points(true, p_weight, p_ms, p_limit_s)
                         * greatest(0, 1 - abs(public._gk_slider_dev(p_option))))::int
              when p_kind = 'rank'
              then public._gk_points(coalesce(public._gk_rank_order(p_option, cardinality(p_correct)) = p_correct, false),
                                     p_weight, p_ms, p_limit_s)
              else public._gk_points(p_option = any (p_correct), p_weight, p_ms, p_limit_s) end;
$$;

-- The action round's share for `p_hits` baskets when the room's fewest is
-- p_lo and its most p_hi: linear, 1 for the best and 0 for the worst — the
-- best scores as if it answered at once, the worst as if it answered wrong.
-- Everyone level: 1 if they scored at all. Mirrored by actionFactor() in
-- js/scoring.js.
create or replace function public._gk_action_factor(p_hits int, p_lo int, p_hi int)
returns numeric language sql immutable as $$
  select case when p_hi > p_lo then (p_hits - p_lo)::numeric / (p_hi - p_lo)
              when p_hits > 0 then 1 else 0 end;
$$;

-- Score every answer of one action round from the room's spread. Run after
-- each throw is recorded and by the re-score, so the stored points are always
-- those of the answers as they stand (and nobody sees them before the reveal).
-- "Correct" = a share above zero: what the fastest five and the streaks read.
create or replace function public._gk_action_score(p_session uuid, p_item uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_lo int; v_hi int; v_w int;
begin
  select weight into v_w from public.gk_items where id = p_item;
  select min(option_idx), max(option_idx) into v_lo, v_hi
    from public.gk_answers where session_id = p_session and item_id = p_item and not voided;
  update public.gk_answers a
     set points = round(v_w * 1000 * public._gk_action_factor(a.option_idx, v_lo, v_hi))::int,
         is_correct = public._gk_action_factor(a.option_idx, v_lo, v_hi) > 0
   where a.session_id = p_session and a.item_id = p_item and not a.voided;
end;
$$;

-- Streaks: runs of correct answers in a row. Counted over the scored items
-- (not interludes) that are worth something — a ×0 warm-up neither extends a
-- run nor breaks it — up to and including the item on screen. A question not
-- answered breaks the run, as a wrong answer does. Derived from the non-voided
-- answers like everything else, so going back recomputes them.
-- One row per run: who, where it starts and ends (k = the scored item's
-- number), its length, and the points of its first three answers (the
-- tie-break for "first to three"). `last_k` is the newest scored item so far,
-- `cur_k` the item on screen if it is one (null on a ×0 item).
create or replace function public._gk_runs(p_session uuid)
returns table (name text, k0 int, k1 int, n int, p3 int, last_k int, cur_k int)
language sql stable security definer set search_path = public, pg_catalog as $$
  with s as (select quiz_id, cur_item_id from public.gk_sessions where id = p_session),
  upto as (select o.idx from s, public._gk_ordered(s.quiz_id) o where o.item_id = s.cur_item_id),
  q as (
    select o.item_id, (row_number() over (order by o.idx))::int as k
      from s, public._gk_ordered(s.quiz_id) o join public.gk_items i on i.id = o.item_id
     where o.kind <> 'interlude' and i.weight > 0 and o.idx <= (select idx from upto)
  ),
  c as (
    select p.id as pid, p.name, q.k, coalesce(a.is_correct, false) as ok, coalesce(a.points, 0) as pts
      from public.gk_players p cross join q
      left join public.gk_answers a on a.player_id = p.id and a.item_id = q.item_id and not a.voided
     where p.session_id = p_session and not p.kicked
  ),
  g0 as (select c.*, c.k - (row_number() over (partition by c.pid order by c.k))::int as grp from c where c.ok),
  g as (select g0.*, min(g0.k) over (partition by g0.pid, g0.grp) as ks from g0)
  select g.name, min(g.k)::int, max(g.k)::int, count(*)::int,
         (sum(g.pts) filter (where g.k < g.ks + 3))::int,
         (select max(k) from q)::int,
         (select q.k from q, s where q.item_id = s.cur_item_id)::int
    from g group by g.pid, g.name, g.grp;
$$;

-- Who is on fire now — {name: run} for every run of three or more that is
-- still going (it reaches the newest scored item). Shown beside the names in
-- the table and on the player's own phone.
create or replace function public._gk_streaks(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(jsonb_object_agg(r.name, r.n), '{}'::jsonb)
    from public._gk_runs(p_session) r where r.k1 = r.last_k and r.n >= 3;
$$;

-- The one special slide of a quiz (phase 'fire', shown with
-- media/animations/first-streak.svg). Two ways to earn it, at most one per quiz:
--   first  at the first item where anyone's run reaches three: whoever got
--          there (several at once: the most points over those three answers);
--   lead   if NOBODY has reached three by the time the last question comes up:
--          shown before it, naming the leader and the gap to second place.
-- _gk_fire is the "first" case only (NULL unless it is THIS item);
-- _gk_lead is the other, and is asked only by gk_admin_next.
create or replace function public._gk_fire(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with r as (select * from public._gk_runs(p_session)),
  firsts as (select r.name, r.p3, r.k0 + 2 as kk from r where r.n >= 3),
  first_k as (select min(kk) as kk from firsts)
  select jsonb_build_object('first', jsonb_build_object('name', f.name, 'points', f.p3))
    from firsts f, first_k fk
   where f.kk = fk.kk and fk.kk = (select max(cur_k) from r)
   order by f.p3 desc, f.name limit 1;
$$;

-- The leader before the last question: {lead: {name, gap}} — `name` is every
-- player tied at the top, joined; `gap` is 0 for a tie.
create or replace function public._gk_lead(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with lb as (select x.name, x.points from jsonb_to_recordset(public._gk_leaderboard(p_session, null)) as x(name text, points int, rank int)),
  top as (select max(points) as p from lb),
  second as (select max(points) as p from lb, top where lb.points < top.p)
  select jsonb_build_object('lead', jsonb_build_object(
           'name', (select string_agg(lb.name, ' · ' order by lb.name) from lb, top where lb.points = top.p),
           'gap', case when (select count(*) from lb, top where lb.points = top.p) > 1 then 0
                       else (select top.p - coalesce(second.p, 0) from top, second) end))
   where exists (select 1 from lb);
$$;

-- The table. `p_exclude` is the question whose effect is being animated: every
-- row carries its rank with and without that question, so the client can slide
-- each row from where it was to where it is.
create or replace function public._gk_leaderboard(p_session uuid, p_exclude uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with tot as (
    select p.id, p.name, p.joined_at,
           coalesce(sum(a.points), 0)::int                                                       as pts,
           coalesce(sum(a.points) filter (where a.item_id is distinct from p_exclude), 0)::int   as prev_pts,
           coalesce(sum(a.answered_ms) filter (where a.is_correct), 0)                           as ms,
           coalesce(sum(a.answered_ms) filter (where a.is_correct
                                                 and a.item_id is distinct from p_exclude), 0)   as prev_ms,
           (count(*) filter (where a.is_correct))::int                                           as n_correct,
           (count(*) filter (where a.is_correct
                              and a.item_id is distinct from p_exclude))::int                    as prev_correct
      from public.gk_players p
      left join public.gk_answers a on a.player_id = p.id and not a.voided
     where p.session_id = p_session and not p.kicked
     group by p.id
  ), r as (
    select tot.*,
           -- Ties: more correct answers first (a zero-weight warm-up scores
           -- nothing but still counts here), then the faster total, then who
           -- joined first. Without the count, a correct warm-up answer would
           -- rank BELOW not answering — it adds time and no points.
           row_number() over (order by pts desc, n_correct desc, ms asc, joined_at, id)              as rnk,
           row_number() over (order by prev_pts desc, prev_correct desc, prev_ms asc, joined_at, id) as prev_rnk
      from tot
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', name, 'points', pts, 'gain', pts - prev_pts,
           'rank', rnk, 'prev', prev_rnk, 'correct', n_correct) order by rnk), '[]'::jsonb)
    from r;
$$;

-- Players × questions. A cell is null (no answer) or [is_correct, ms, points,
-- deviation] — the deviation only for a slider (null otherwise): its cell is
-- coloured on a red-green scale by it rather than right/wrong. An action
-- round's cell adds [.., hits, share]: its baskets, and the 0-1 share of the
-- points they earned (its colour on the same scale).
create or replace function public._gk_matrix(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with s as (select quiz_id from public.gk_sessions where id = p_session),
  qs as (
    select o.idx, i.id, i.title, i.weight, i.kind,
           (row_number() over (order by o.idx))::int as no
      from s, public._gk_ordered(s.quiz_id) o
      join public.gk_items i on i.id = o.item_id
     where o.kind <> 'interlude'
  ),
  lb as (
    select x.name, (x.points)::int as points, (x.rank)::int as rank
      from jsonb_to_recordset(public._gk_leaderboard(p_session, null))
           as x(name text, points int, rank int)
  ),
  cells as (
    select p.name,
           jsonb_agg(case when a.id is null then 'null'::jsonb
                          when qs.kind = 'action'
                          then jsonb_build_array(a.is_correct, a.answered_ms, a.points, null, a.option_idx,
                                                 round(public._gk_action_factor(a.option_idx, sp.lo, sp.hi), 4))
                          else jsonb_build_array(a.is_correct, a.answered_ms, a.points,
                                                 case when qs.kind = 'slider' then round(public._gk_slider_dev(a.option_idx), 4) end)
                     end order by qs.idx) as cells
      from public.gk_players p
      cross join qs
      left join public.gk_answers a
             on a.player_id = p.id and a.item_id = qs.id and not a.voided
      left join lateral (select min(x.option_idx) as lo, max(x.option_idx) as hi from public.gk_answers x
                          where x.session_id = p_session and x.item_id = qs.id and not x.voided) sp on qs.kind = 'action'
     where p.session_id = p_session and not p.kicked
     group by p.id, p.name
  )
  select jsonb_build_object(
    'questions', coalesce((select jsonb_agg(jsonb_build_object('no', no, 'title', title, 'weight', weight, 'kind', kind) order by idx) from qs), '[]'::jsonb),
    'rows',      coalesce((select jsonb_agg(jsonb_build_object('name', lb.name, 'points', lb.points, 'rank', lb.rank,
                                                               'cells', coalesce(c.cells, '[]'::jsonb)) order by lb.rank)
                             from lb left join cells c on c.name = lb.name), '[]'::jsonb)
  );
$$;

-- The fast-moving public row.
create or replace function public._gk_live(p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  select * into s from public.gk_sessions where id = p_session;
  update public.gk_public_live l
     set seq      = l.seq + 1,
         players  = (select count(*) from public.gk_players p where p.session_id = p_session and not p.kicked),
         names    = coalesce((select jsonb_agg(p.name order by p.joined_at)
                                from public.gk_players p where p.session_id = p_session and not p.kicked), '[]'::jsonb),
         answered = case when s.phase in ('question', 'reveal', 'explain', 'fastest', 'fire')
                         then (select count(*) from public.gk_answers a
                                where a.session_id = p_session and a.item_id = s.cur_item_id and not a.voided)
                         else 0 end,
         updated_at = now()
   where l.id = 1;
end;
$$;

-- Rebuild gk_public_state from the session. This is the ONLY writer of what
-- browsers see, and it decides per phase what may be shown: option texts once
-- the question is on screen, `correct` and the counts only from reveal on.
create or replace function public._gk_publish(p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s   public.gk_sessions%rowtype;
  q   public.gk_quizzes%rowtype;
  it  public.gk_items%rowtype;
  d   jsonb;
  v_n int;
begin
  select * into s from public.gk_sessions where id = p_session;
  if not found or s.status = 'aborted' then
    update public.gk_public_state
       set rev = rev + 1, session_id = null, status = 'idle', phase = 'idle', data = '{}'::jsonb, updated_at = now()
     where id = 1;
    update public.gk_public_live set seq = seq + 1, answered = 0, players = 0, names = '[]'::jsonb, updated_at = now() where id = 1;
    return;
  end if;

  if s.status = 'finished' then
    -- A finished quiz is shown from its frozen result, never from live tables:
    -- the quiz may be edited the moment it ends.
    d := coalesce(s.result, '{}'::jsonb);
  else
    select * into q from public.gk_quizzes where id = s.quiz_id;
    d := jsonb_build_object(
      'quiz', public._gk_quiz_json(s.quiz_id, s.quiz_title),
      'index', s.cur_index,
      'count', (select count(*) from public.gk_items i where i.quiz_id = s.quiz_id and i.parent_id is null),
      'locked', s.locked);

    if s.phase in ('interlude', 'intro', 'question', 'reveal', 'explain', 'fastest', 'fire', 'leaderboard') then
      select * into it from public.gk_items where id = s.cur_item_id;
    end if;

    if it.id is not null then
      v_n := case it.kind when 'question' then jsonb_array_length(it.options) when 'complete' then jsonb_array_length(it.options)
                          when 'memory' then jsonb_array_length(it.options)
                          when 'roulette' then 37
                          when 'puzzle' then 1
                          when 'spot' then jsonb_array_length(it.regions) else 0 end;
      d := d || jsonb_build_object('item', jsonb_build_object(
        'id', it.id, 'kind', it.kind, 'title', it.title, 'body', it.body,
        'options', case when it.kind in ('question', 'complete', 'slider', 'rank', 'memory') then it.options else '[]'::jsonb end,
        'memo_s', case when it.kind = 'memory' then it.memo_s end,
        'slot', case when it.kind in ('complete', 'slider') then it.slot end,
        'weight', it.weight, 'time_limit', it.time_limit_s,
        'image', it.image, 'video', it.video, 'audio', it.audio,
        'layout', it.media_layout, 'music_on', it.music_on, 'anim_on', it.anim_on,
        'music', it.music, 'anim_sprite', it.anim_sprite, 'symbols', it.symbols, 'marks', it.marks,
        'regions', case when it.kind = 'spot' then it.regions else '[]'::jsonb end,
        -- the action round's ball: no secret, it is what the players throw
        'ball', case when it.kind = 'action' and it.circle_r is not null
                     then jsonb_build_object('x', it.circle_x, 'y', it.circle_y, 'r', it.circle_r) end,
        -- and the author's lines for a basket and a miss
        'feedback', case when it.kind = 'action' then it.feedback end,
        'no', (select count(*) from public._gk_ordered(s.quiz_id) o where o.kind <> 'interlude' and o.idx <= s.cur_index),
        'of', (select count(*) from public._gk_ordered(s.quiz_id) o where o.kind <> 'interlude')));

      if it.kind <> 'interlude' and s.phase <> 'intro' then
        d := d || jsonb_build_object('starts_at', public._gk_ms(s.q_started_at), 'deadline', public._gk_ms(s.q_deadline));
      end if;

      if it.kind <> 'interlude' and s.revealed then
        d := d || jsonb_build_object(
          -- the puzzle's bouncing detail is part of the reveal, not before it
          'circle', case when it.kind = 'puzzle' and it.circle_r is not null
                         then jsonb_build_object('x', it.circle_x, 'y', it.circle_y, 'r', it.circle_r, 'speed', it.circle_speed) end,
          -- the memory question's arrows point at the answer: reveal only
          'arrows', case when it.kind = 'memory' then it.arrows end,
          'correct', to_jsonb(it.correct),
          'counts', (select jsonb_agg((select count(*) from public.gk_answers a
                                        where a.session_id = s.id and a.item_id = it.id and not a.voided
                                          and a.option_idx = g.i) order by g.i)
                       from generate_series(0, v_n - 1) as g(i)),
          'answered', (select count(*) from public.gk_answers a
                        where a.session_id = s.id and a.item_id = it.id and not a.voided),
          -- The slider has positions, not options (its v_n is 0, so no counts):
          -- instead, every position chosen, anonymous and sorted, so the
          -- reveal can draw how the room spread around the target.
          -- the ranking has no per-option counts either: how many got it exact
          'right', case when it.kind = 'rank' then
                      (select count(*) from public.gk_answers a
                        where a.session_id = s.id and a.item_id = it.id and not a.voided and a.is_correct) end,
          -- (and the action round: every player's baskets)
          'values', case when it.kind in ('slider', 'action') then
                      coalesce((select jsonb_agg(a.option_idx order by a.option_idx) from public.gk_answers a
                                 where a.session_id = s.id and a.item_id = it.id and not a.voided), '[]'::jsonb) end,
          -- The action round's "fastest five" are its five best shooters
          -- (most baskets; the earlier last basket breaks a tie), with `hits`.
          'fastest', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'ms', f.answered_ms, 'points', f.points,
                                                                   'hits', case when it.kind = 'action' then f.option_idx end)
                                                order by f.ord)
                                 from (select p.name, a.answered_ms, a.points, a.option_idx,
                                              row_number() over (order by case when it.kind = 'action' then -a.option_idx else 0 end,
                                                                          a.answered_ms, a.id) as ord
                                         from public.gk_answers a join public.gk_players p on p.id = a.player_id
                                        where a.session_id = s.id and a.item_id = it.id and not a.voided
                                          and a.is_correct and not p.kicked
                                        order by ord limit 5) f), '[]'::jsonb));
      end if;
    end if;

    -- The "answer explained" segment rides on top of its question's state:
    -- `item` stays the question (so a phone still knows what it answered),
    -- and the segment itself is added as `explain`.
    if s.phase = 'explain' then
      d := d || jsonb_build_object('explain', (
        select jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body,
                                  'image', c.image, 'video', c.video, 'audio', c.audio, 'layout', c.media_layout,
                                  'music_on', c.music_on, 'music', c.music, 'anim_on', c.anim_on, 'anim_sprite', c.anim_sprite)
          from public.gk_items c where c.parent_id = s.cur_item_id));
    end if;

    if s.phase = 'fire' then
      d := d || jsonb_build_object('fire', coalesce(public._gk_fire(s.id), public._gk_lead(s.id)));
    end if;

    if s.phase = 'leaderboard' then
      d := d || jsonb_build_object('leaderboard',
             public._gk_leaderboard(s.id, case when it.kind <> 'interlude' then it.id end),
             -- who is on a run of three or more, shown beside their name
             'streaks', case when it.kind <> 'interlude' then public._gk_streaks(s.id) else '{}'::jsonb end);
    end if;
  end if;

  update public.gk_public_state
     set rev = rev + 1, session_id = s.id, status = s.status, phase = s.phase, data = d, updated_at = now()
   where id = 1;
  perform public._gk_live(s.id);
end;
$$;

create or replace function public._gk_reveal(p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.gk_sessions set phase = 'reveal', revealed = true
   where id = p_session and phase = 'question';
  if found then perform public._gk_publish(p_session); end if;
end;
$$;

-- Start the clock on the current item: the get-ready lead-in, then the time
-- limit. The one place a question's start and deadline are set — reached
-- straight from _gk_enter for an ordinary question, and from "next" on the
-- instruction slide for a picture game.
create or replace function public._gk_start_question(p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s  public.gk_sessions%rowtype;
  it public.gk_items%rowtype;
  v_lead int;
  v_start timestamptz;
begin
  select * into s from public.gk_sessions where id = p_session for update;
  select * into it from public.gk_items where id = s.cur_item_id;
  if not found then return; end if;
  select coalesce(lead_in_s, 0) into v_lead from public.gk_quizzes where id = s.quiz_id;
  -- A memory question's lead-in is the time its picture is up.
  if it.kind = 'memory' then v_lead := it.memo_s; end if;
  v_start := now() + make_interval(secs => coalesce(v_lead, 0));
  update public.gk_sessions
     set phase = 'question', revealed = false,
         q_started_at = v_start, q_deadline = v_start + make_interval(secs => it.time_limit_s)
   where id = s.id;
  perform public._gk_publish(s.id);
end;
$$;

-- Put item number p_index on screen. Everything from that item onwards is
-- voided first — this is what makes "go back two questions" restore the table.
create or replace function public._gk_enter(p_session uuid, p_index int)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s  public.gk_sessions%rowtype;
  it public.gk_items%rowtype;
begin
  select * into s from public.gk_sessions where id = p_session for update;
  select i.* into it from public._gk_ordered(s.quiz_id) o join public.gk_items i on i.id = o.item_id
   where o.idx = p_index;
  if not found then raise exception 'no_such_item' using errcode = '22023'; end if;

  update public.gk_answers a set voided = true
   where a.session_id = s.id and not a.voided
     and a.item_id in (select o.item_id from public._gk_ordered(s.quiz_id) o where o.idx >= p_index);

  -- The picture games (puzzle, spot it, complete the picture, the slider) are not
  -- self-explanatory the way four coloured answers are, so each opens on an
  -- instruction slide: phase 'intro', no clock. The question itself — and its
  -- countdown — starts only when the host presses "next" (_gk_start_question).
  if it.kind in ('puzzle', 'spot', 'complete', 'slider', 'rank', 'action') then
    update public.gk_sessions
       set status = 'running', started_at = coalesce(started_at, now()),
           cur_index = p_index, cur_item_id = it.id, revealed = false,
           phase = 'intro', q_started_at = null, q_deadline = null
     where id = s.id;
  else
    update public.gk_sessions
       set status = 'running', started_at = coalesce(started_at, now()),
           cur_index = p_index, cur_item_id = it.id, revealed = false,
           phase = case when it.kind <> 'interlude' then 'question' else 'interlude' end,
           q_started_at = null, q_deadline = null
     where id = s.id;
    if it.kind <> 'interlude' then
      perform public._gk_start_question(s.id);
      return;
    end if;
  end if;
  perform public._gk_publish(s.id);
end;
$$;

create or replace function public._gk_finish(p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
  q public.gk_quizzes%rowtype;
begin
  select * into s from public.gk_sessions where id = p_session for update;
  select * into q from public.gk_quizzes where id = s.quiz_id;
  update public.gk_sessions
     set status = 'finished', phase = 'podium', finished_at = now(), revealed = true,
         result = jsonb_build_object(
           'quiz', public._gk_quiz_json(s.quiz_id, s.quiz_title),
           'leaderboard', public._gk_leaderboard(s.id, null),
           'matrix', public._gk_matrix(s.id),
           'finished_at', public._gk_ms(now()))
   where id = s.id;
  perform public._gk_publish(s.id);
end;
$$;

create or replace function public._gk_require_admin()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Player functions (anon).
-- ----------------------------------------------------------------------------
create or replace function public.gk_time()
returns bigint language sql stable as $$
  -- Inlined rather than calling _gk_ms(): this runs as the caller, and a
  -- browser role holds no EXECUTE on the underscore helpers.
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

create or replace function public.gk_join(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
  p public.gk_players%rowtype;
  h text := public._gk_hash(p_token);
  v_name text;
begin
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;

  -- The same device joining twice gets its existing player back, whatever name
  -- it typed the second time: one browser is one player.
  select * into p from public.gk_players where session_id = s.id and token_hash = h limit 1;
  if found then
    if p.kicked then raise exception 'kicked' using errcode = 'P0001'; end if;
    return jsonb_build_object('name', p.name);
  end if;

  if s.locked then raise exception 'locked' using errcode = 'P0001'; end if;

  -- Collapse runs of whitespace, drop control and bidi-override characters (a
  -- name is shown on a projector — it must not be able to reorder the row).
  v_name := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''),
              '[\u0000-\u001F\u007F​-\u200F\u202A-\u202E\u2066-\u2069]', '', 'g'), '\s+', ' ', 'g'));
  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    raise exception 'bad_name' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gk_players where session_id = s.id and name_key = lower(v_name)) then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;
  if (select count(*) from public.gk_players where session_id = s.id) >= 300 then
    raise exception 'full' using errcode = 'P0001';
  end if;

  insert into public.gk_players (session_id, name, name_key, token_hash)
  values (s.id, v_name, lower(v_name), h);
  perform public._gk_live(s.id);
  return jsonb_build_object('name', v_name);
end;
$$;

-- "That name is me, on a new device." Creates a request the host approves after
-- hearing the name from the player; nothing changes until then.
create or replace function public.gk_request_relink(p_name text, p_token text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
  p public.gk_players%rowtype;
  h text := public._gk_hash(p_token);
begin
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  select * into p from public.gk_players
   where session_id = s.id and name_key = lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
     and not kicked;
  if not found then raise exception 'no_such_player' using errcode = 'P0001'; end if;
  if exists (select 1 from public.gk_relink_requests
              where session_id = s.id and token_hash = h and status = 'pending') then
    return;
  end if;
  if (select count(*) from public.gk_relink_requests where session_id = s.id and status = 'pending') >= 30 then
    raise exception 'full' using errcode = 'P0001';
  end if;
  insert into public.gk_relink_requests (session_id, player_id, token_hash) values (s.id, p.id, h);
end;
$$;

-- Everything one phone needs about itself: who it is, its score and rank, and
-- whether it already answered. Called on load and after every phase change, so
-- a refresh or a dropped connection resumes exactly where the player was.
create or replace function public.gk_me(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_sid uuid;
  s public.gk_sessions%rowtype;
  p public.gk_players%rowtype;
  a public.gk_answers%rowtype;
  h text := public._gk_hash(p_token);
  v_hide boolean;
  v_row jsonb;
  v_out jsonb;
begin
  select session_id into v_sid from public.gk_public_state where id = 1;
  if v_sid is null then return jsonb_build_object('player', false); end if;

  select * into p from public.gk_players where session_id = v_sid and token_hash = h limit 1;
  if not found or p.kicked then
    return jsonb_build_object(
      'player', false,
      'kicked', coalesce(p.kicked, false),
      'pending', exists (select 1 from public.gk_relink_requests
                          where session_id = v_sid and token_hash = h and status = 'pending'));
  end if;
  update public.gk_players set last_seen = now() where id = p.id;

  select * into s from public.gk_sessions where id = v_sid;
  -- While a question is open its outcome is a secret, including from the
  -- player who answered it: score and rank are reported as of the question
  -- before.
  v_hide := s.phase = 'question' and not s.revealed;

  select x into v_row
    from jsonb_array_elements(public._gk_leaderboard(v_sid, case when v_hide then s.cur_item_id end)) x
   where x->>'name' = p.name;

  v_out := jsonb_build_object(
    'player', true, 'name', p.name,
    'points', case when v_hide then (v_row->>'points')::int - (v_row->>'gain')::int else (v_row->>'points')::int end,
    'rank',   case when v_hide then (v_row->>'prev')::int else (v_row->>'rank')::int end,
    'players', (select count(*) from public.gk_players where session_id = v_sid and not kicked));

  if s.cur_item_id is not null and s.phase in ('question', 'reveal', 'explain', 'fastest', 'fire', 'leaderboard') then
    select * into a from public.gk_answers
     where session_id = v_sid and item_id = s.cur_item_id and player_id = p.id and not voided;
    v_out := v_out || jsonb_build_object('item_id', s.cur_item_id, 'answered', a.id is not null, 'option', a.option_idx);
    if not v_hide then
      v_out := v_out || jsonb_build_object('result', jsonb_build_object(
        'correct', coalesce(a.is_correct, false), 'points', coalesce(a.points, 0), 'ms', a.answered_ms),
        'streak', coalesce((public._gk_streaks(v_sid) ->> p.name)::int, 0));
    end if;
  end if;

  if s.status = 'finished' then
    v_out := v_out || jsonb_build_object('cells',
      (select r->'cells' from jsonb_array_elements(s.result->'matrix'->'rows') r where r->>'name' = p.name));
  end if;
  return v_out;
end;
$$;

create or replace function public.gk_answer(p_token text, p_item uuid, p_option int)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s  public.gk_sessions%rowtype;
  p  public.gk_players%rowtype;
  it public.gk_items%rowtype;
  h  text := public._gk_hash(p_token);
  v_now timestamptz := clock_timestamp();
  v_ms int;
  v_ok boolean;
  v_pts int;
begin
  -- The session row is the lock every answer and every host action queues on,
  -- so "is this the last answer?" below is never decided on a stale count.
  select * into s from public.gk_sessions where status = 'running' for update;
  if not found or s.phase <> 'question' or s.revealed or s.cur_item_id is distinct from p_item then
    raise exception 'closed' using errcode = 'P0001';
  end if;
  v_now := clock_timestamp();
  if v_now < s.q_started_at or v_now > s.q_deadline + interval '500 milliseconds' then
    raise exception 'closed' using errcode = 'P0001';
  end if;

  select * into p from public.gk_players where session_id = s.id and token_hash = h and not kicked limit 1;
  if not found then raise exception 'unknown_player' using errcode = 'P0001'; end if;

  select * into it from public.gk_items where id = p_item;
  if not found or it.kind in ('interlude', 'explain') or p_option is null or p_option < 0
     or p_option >= (case it.kind when 'puzzle' then 1 when 'spot' then jsonb_array_length(it.regions)
                                  when 'slider' then 1001   -- a position, 0-1000
                                  when 'rank' then 3125     -- a packed order; checked in full below
                                  when 'roulette' then 37   -- a number, 0-36
                                  when 'action' then 121    -- baskets; at most one a second, below
                                  else jsonb_array_length(it.options) end)
     or (it.kind = 'slider' and jsonb_array_length(it.options) = 0)
     or (it.kind = 'rank' and public._gk_rank_order(p_option, jsonb_array_length(it.options)) is null) then
    raise exception 'bad_option' using errcode = '22023';
  end if;
  -- Whether the five pieces are really in place is known only to the browser,
  -- so "done" is taken on trust — the one answer in this system that is. The
  -- floor below is what the server CAN enforce: nobody assembles it in under
  -- two seconds, so a script calling this function the instant the puzzle
  -- opens is refused rather than handed full marks.
  if it.kind = 'puzzle' and v_now < s.q_started_at + interval '2 seconds' then
    raise exception 'too_fast' using errcode = 'P0001';
  end if;

  -- The action round: the answer is the running count of baskets, re-sent
  -- after every throw, so it is UPDATED (upwards only) rather than refused as
  -- a second answer, and never closes the question early — everyone has
  -- answered after their first throw. Like the puzzle's "done", the count is
  -- the browser's word; what the server holds it to is the pace of a throw —
  -- no more than one basket per second on the clock so far.
  if it.kind = 'action' then
    if p_option * 1000 > extract(epoch from (v_now - s.q_started_at)) * 1000 then
      raise exception 'too_fast' using errcode = 'P0001';
    end if;
    v_ms := least(greatest((extract(epoch from (v_now - s.q_started_at)) * 1000)::int, 0), it.time_limit_s * 1000);
    update public.gk_answers set option_idx = p_option, answered_ms = v_ms
     where session_id = s.id and item_id = it.id and player_id = p.id and not voided and option_idx < p_option;
    if not found and not exists (select 1 from public.gk_answers
                                  where session_id = s.id and item_id = it.id and player_id = p.id and not voided) then
      insert into public.gk_answers (session_id, item_id, player_id, option_idx, answered_ms, is_correct, points)
      values (s.id, it.id, p.id, p_option, v_ms, false, 0);
    end if;
    perform public._gk_action_score(s.id, it.id);
    update public.gk_players set last_seen = now() where id = p.id;
    perform public._gk_live(s.id);
    return;
  end if;

  v_ms := least(greatest((extract(epoch from (v_now - s.q_started_at)) * 1000)::int, 0), it.time_limit_s * 1000);
  select sc.is_correct, sc.points into v_ok, v_pts
    from public._gk_score(it.kind, it.correct, p_option, it.weight, v_ms, it.time_limit_s) sc;

  begin
    insert into public.gk_answers (session_id, item_id, player_id, option_idx, answered_ms, is_correct, points)
    values (s.id, it.id, p.id, p_option, v_ms, v_ok, v_pts);
  exception when unique_violation then
    raise exception 'already_answered' using errcode = 'P0001';
  end;

  update public.gk_players set last_seen = now() where id = p.id;

  if (select count(*) from public.gk_answers a where a.session_id = s.id and a.item_id = it.id and not a.voided)
     >= (select count(*) from public.gk_players pl where pl.session_id = s.id and not pl.kicked) then
    perform public._gk_reveal(s.id);
  else
    perform public._gk_live(s.id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Host functions. SECURITY DEFINER bypasses RLS, so the allowlist check is
--    the FIRST statement of each — an unauthorised call mutates nothing.
-- ----------------------------------------------------------------------------
create or replace function public.gk_admin_open(p_quiz uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  q public.gk_quizzes%rowtype;
  v_id uuid;
begin
  perform public._gk_require_admin();
  select * into q from public.gk_quizzes where id = p_quiz;
  if not found then raise exception 'no_such_quiz' using errcode = '22023'; end if;
  if not exists (select 1 from public.gk_items where quiz_id = q.id) then
    raise exception 'empty_quiz' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gk_sessions where status in ('lobby', 'running')) then
    raise exception 'already_active' using errcode = 'P0001';
  end if;
  -- Device tokens belong to one evening. Clearing the previous quiz's hashes
  -- here means a phone from last time starts this one as a stranger.
  update public.gk_players set token_hash = null where token_hash is not null;
  -- `where true`: Supabase loads pg-safeupdate for API sessions, which rejects
  -- a DELETE with no WHERE even inside a SECURITY DEFINER function.
  delete from public.gk_relink_requests where true;
  insert into public.gk_sessions (quiz_id, quiz_title) values (q.id, q.title) returning id into v_id;
  perform public._gk_publish(v_id);
end;
$$;

-- The one button the host presses all evening: whatever comes next.
create or replace function public.gk_admin_next()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
  v_idx int;
  v_count int;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then
    -- nothing live: step the finished quiz still on screen, podium → matrix
    select g.* into s from public.gk_sessions g join public.gk_public_state st on st.session_id = g.id
     where st.id = 1 and g.status = 'finished' for update of g;
    if found and s.phase = 'podium' then
      update public.gk_sessions set phase = 'matrix' where id = s.id;
      perform public._gk_publish(s.id);
    end if;
    return;
  end if;

  if s.status = 'lobby' then
    perform public._gk_enter(s.id, 1);
  elsif s.phase = 'intro' then
    -- the instruction slide has been read: now the question, and its countdown
    perform public._gk_start_question(s.id);
  elsif s.phase = 'question' then
    perform public._gk_reveal(s.id);
  elsif s.phase = 'reveal' then
    -- A question with an "answer explained" segment shows it here, between
    -- the reveal and the fastest five.
    update public.gk_sessions
       set phase = case when exists (select 1 from public.gk_items c where c.parent_id = s.cur_item_id)
                        then 'explain' else 'fastest' end
     where id = s.id;
    perform public._gk_publish(s.id);
  elsif s.phase = 'explain' then
    update public.gk_sessions set phase = 'fastest' where id = s.id;
    perform public._gk_publish(s.id);
  elsif s.phase = 'fastest' then
    -- The special slide, when this is the question where someone first got
    -- three in a row, comes between the fastest five and the table.
    update public.gk_sessions
       set phase = case when public._gk_fire(s.id) is not null then 'fire' else 'leaderboard' end
     where id = s.id;
    perform public._gk_publish(s.id);
  elsif s.phase = 'fire' and public._gk_fire(s.id) is not null then
    update public.gk_sessions set phase = 'leaderboard' where id = s.id;
    perform public._gk_publish(s.id);
  else
    -- An item deleted mid-quiz must not strand the host: fall back to the
    -- stored index when the current item is no longer in the list.
    select o.idx into v_idx from public._gk_ordered(s.quiz_id) o where o.item_id = s.cur_item_id;
    v_idx := coalesce(v_idx, s.cur_index - 1, 0) + 1;
    select count(*) into v_count from public.gk_items where quiz_id = s.quiz_id and parent_id is null;
    if v_idx > v_count then
      perform public._gk_finish(s.id);
    elsif s.phase <> 'fire'
          -- the next item is the last question,
          and v_idx = (select max(o.idx) from public._gk_ordered(s.quiz_id) o where o.kind <> 'interlude')
          -- there were questions before it,
          and exists (select 1 from public._gk_ordered(s.quiz_id) o where o.kind <> 'interlude' and o.idx < v_idx)
          -- and nobody has had three in a row: the special slide goes here,
          -- for the leader (a 'fire' phase whose _gk_fire is NULL).
          and not exists (select 1 from public._gk_runs(s.id) r where r.n >= 3) then
      update public.gk_sessions set phase = 'fire' where id = s.id;
      perform public._gk_publish(s.id);
    else
      perform public._gk_enter(s.id, v_idx);
    end if;
  end if;
end;
$$;

create or replace function public.gk_admin_goto(p_index int)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  perform public._gk_enter(s.id, p_index);
end;
$$;

create or replace function public.gk_admin_reveal()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status = 'running' for update;
  if found then perform public._gk_reveal(s.id); end if;
end;
$$;

-- Switch which results view is on screen without moving through the quiz.
create or replace function public.gk_admin_show(p_view text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select g.* into s from public.gk_sessions g join public.gk_public_state st on st.session_id = g.id
   where st.id = 1 for update of g;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;

  if s.status = 'finished' then
    if p_view not in ('podium', 'matrix') then raise exception 'bad_view' using errcode = '22023'; end if;
  elsif s.status = 'running' then
    if p_view not in ('reveal', 'explain', 'fastest', 'fire', 'leaderboard') then raise exception 'bad_view' using errcode = '22023'; end if;
    if p_view = 'fire' and public._gk_fire(s.id) is null then raise exception 'bad_view' using errcode = '22023'; end if;
    if p_view = 'explain' and not exists (select 1 from public.gk_items c where c.parent_id = s.cur_item_id) then
      raise exception 'bad_view' using errcode = '22023';
    end if;
    -- An open question's results are not a view yet — reveal it first.
    if s.phase = 'question' and not s.revealed then raise exception 'not_revealed' using errcode = 'P0001'; end if;
    if p_view in ('reveal', 'explain', 'fastest', 'fire') and not s.revealed then raise exception 'bad_view' using errcode = '22023'; end if;
  else
    raise exception 'bad_view' using errcode = '22023';
  end if;
  update public.gk_sessions set phase = p_view where id = s.id;
  perform public._gk_publish(s.id);
end;
$$;

create or replace function public.gk_admin_finish()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status = 'running' for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  perform public._gk_finish(s.id);
end;
$$;

-- Abort a live quiz (nothing archived as a result) or take a finished one off
-- the screen. Either way the entry page goes back to "no quiz on air".
create or replace function public.gk_admin_close()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform public._gk_require_admin();
  update public.gk_sessions set status = 'aborted', finished_at = now() where status in ('lobby', 'running');
  update public.gk_players set token_hash = null where token_hash is not null;
  -- `where true`: Supabase loads pg-safeupdate for API sessions, which rejects
  -- a DELETE with no WHERE even inside a SECURITY DEFINER function.
  delete from public.gk_relink_requests where true;
  perform public._gk_publish(null);
end;
$$;

create or replace function public.gk_admin_lock(p_locked boolean)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  update public.gk_sessions set locked = coalesce(p_locked, false) where id = s.id;
  perform public._gk_publish(s.id);
end;
$$;

create or replace function public.gk_admin_kick(p_player uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  update public.gk_players set kicked = true, token_hash = null where id = p_player and session_id = s.id;
  perform public._gk_publish(s.id);
end;
$$;

create or replace function public.gk_admin_relink(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
  r public.gk_relink_requests%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status in ('lobby', 'running') for update;
  if not found then raise exception 'no_quiz' using errcode = 'P0001'; end if;
  select * into r from public.gk_relink_requests where id = p_request and session_id = s.id and status = 'pending';
  if not found then return; end if;

  if coalesce(p_approve, false) then
    -- One browser is one player: if this device had joined under another name
    -- first, that entry lets go of the device (its score, if any, stays).
    update public.gk_players set token_hash = null where session_id = s.id and token_hash = r.token_hash;
    update public.gk_players set token_hash = r.token_hash, last_seen = now() where id = r.player_id;
    update public.gk_relink_requests set status = 'approved' where id = r.id;
  else
    update public.gk_relink_requests set status = 'rejected' where id = r.id;
  end if;
end;
$$;

-- After a live edit of the current question (a wrong "correct" tick, a changed
-- weight) recompute what its answers are worth, from the stored answer times.
create or replace function public.gk_admin_rescore(p_item uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s  public.gk_sessions%rowtype;
  it public.gk_items%rowtype;
begin
  perform public._gk_require_admin();
  select * into s from public.gk_sessions where status = 'running' for update;
  if not found then return; end if;
  select * into it from public.gk_items where id = p_item and kind not in ('interlude', 'explain');
  if not found then return; end if;
  if it.kind = 'action' then
    -- relative points: the whole room at once (a changed weight, mostly)
    perform public._gk_action_score(s.id, it.id);
    perform public._gk_publish(s.id);
    return;
  end if;
  update public.gk_answers a
     set (is_correct, points) = (select sc.is_correct, sc.points
                                   from public._gk_score(it.kind, it.correct, a.option_idx, it.weight, a.answered_ms, it.time_limit_s) sc)
   where a.session_id = s.id and a.item_id = it.id and not a.voided;
  perform public._gk_publish(s.id);
end;
$$;

-- Republish after an edit that changes what is on screen (text, media, theme).
create or replace function public.gk_admin_refresh()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_sid uuid;
begin
  perform public._gk_require_admin();
  select id into v_sid from public.gk_sessions where status in ('lobby', 'running');
  if v_sid is not null then perform public._gk_publish(v_sid); end if;
end;
$$;

-- The host drawer's view: the run sheet WITH the correct answers, the roster
-- with who is connected, and the devices waiting to be linked.
create or replace function public.gk_admin_state()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.gk_sessions%rowtype;
begin
  perform public._gk_require_admin();
  select g.* into s from public.gk_sessions g join public.gk_public_state st on st.session_id = g.id where st.id = 1;
  if not found then return jsonb_build_object('session', null); end if;
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'quiz_id', s.quiz_id, 'status', s.status, 'phase', s.phase,
                                  'index', s.cur_index, 'item_id', s.cur_item_id, 'revealed', s.revealed, 'locked', s.locked),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'idx', o.idx, 'id', i.id, 'kind', i.kind, 'title', i.title, 'weight', i.weight,
                         'explain', (select jsonb_build_object('id', c.id, 'title', c.title)
                                       from public.gk_items c where c.parent_id = i.id),
                         'correct', to_jsonb(i.correct), 'options', i.options) order by o.idx)
                         from public._gk_ordered(s.quiz_id) o join public.gk_items i on i.id = o.item_id), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', p.id, 'name', p.name, 'kicked', p.kicked,
                           'linked', p.token_hash is not null,
                           'online', p.last_seen > now() - interval '25 seconds',
                           'points', coalesce((select sum(a.points) from public.gk_answers a
                                                where a.player_id = p.id and not a.voided), 0),
                           'answered', exists (select 1 from public.gk_answers a
                                                where a.player_id = p.id and a.item_id = s.cur_item_id and not a.voided))
                           order by p.joined_at)
                           from public.gk_players p where p.session_id = s.id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', p.name, 'at', public._gk_ms(r.created_at))
                                           order by r.created_at)
                            from public.gk_relink_requests r join public.gk_players p on p.id = r.player_id
                           where r.session_id = s.id and r.status = 'pending'), '[]'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Function grants. Supabase's default privileges grant EXECUTE on every new
--    public function to anon and authenticated, so `revoke … from public` alone
--    (the usual idiom) would leave the internal helpers callable. Revoke from
--    all three, then grant back by name.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'gk\_%' or p.proname like '\_gk\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', r.sig);
    execute format('grant execute on function %s to service_role;', r.sig);
    if r.proname in ('gk_time', 'gk_join', 'gk_request_relink', 'gk_me', 'gk_answer') then
      execute format('grant execute on function %s to anon, authenticated;', r.sig);
    elsif r.proname like 'gk\_admin\_%' then
      execute format('grant execute on function %s to authenticated;', r.sig);
    end if;
  end loop;
end;
$$;

commit;

-- PostgREST caches the schema; without this the new functions 404 until restart.
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 9. Report — what a browser role can reach.
-- ----------------------------------------------------------------------------
select c.relname as table_name,
       has_table_privilege('anon', c.oid, 'select')          as anon_select,
       has_table_privilege('anon', c.oid, 'insert')          as anon_insert,
       has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'gk\_%' and c.relkind = 'r'
 order by 1;

select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname like 'gk\_%' or p.proname like '\_gk\_%')
 order by 1;
