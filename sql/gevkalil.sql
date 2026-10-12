-- ============================================================================
-- gevkalil.sql
-- Gevkalil — the live quiz served from golan.me.uk/gevkalil/.
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
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/gevkalil.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Authoring tables — admins only.
--    Media columns hold a path INSIDE gevkalil/media/, never a URL: the CHECK
--    makes the database itself refuse an off-origin resource, so the project's
--    no-third-party rule holds even against a hand-written INSERT.
-- ----------------------------------------------------------------------------
create table if not exists public.gk_quizzes (
    id          uuid primary key default gen_random_uuid(),
    title       text not null default 'חידון חדש' check (char_length(title) between 1 and 80),
    theme       text not null default 'stadium' check (theme in ('stadium', 'candy', 'night')),
    background  text check (background is null or background ~ '^media/backgrounds/[A-Za-z0-9._-]+$'),
    music       text check (music is null or music ~ '^media/audio/[A-Za-z0-9._-]+$'),
    music_on    boolean not null default true,
    lead_in_s   smallint not null default 3 check (lead_in_s between 0 and 10),
    created_at  timestamptz not null default now()
);

create table if not exists public.gk_items (
    id           uuid primary key default gen_random_uuid(),
    quiz_id      uuid not null references public.gk_quizzes(id) on delete cascade,
    position     integer not null default 0,
    kind         text not null check (kind in ('question', 'interlude')),
    title        text not null default '' check (char_length(title) <= 300),
    body         text not null default '' check (char_length(body) <= 600),
    options      jsonb not null default '[]'::jsonb,
    correct      integer[] not null default '{}',
    weight       smallint not null default 1 check (weight in (0, 1, 2)),
    time_limit_s integer not null default 20 check (time_limit_s between 5 and 300),
    image        text check (image is null or image ~ '^media/(images|backgrounds)/[A-Za-z0-9._-]+$'),
    video        text check (video is null or video ~ '^media/videos/[A-Za-z0-9._-]+$'),
    audio        text check (audio is null or audio ~ '^media/audio/[A-Za-z0-9._-]+$'),
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

-- ----------------------------------------------------------------------------
-- 2. Run-time tables — deny-all to browsers, reached only through functions.
-- ----------------------------------------------------------------------------
create table if not exists public.gk_sessions (
    id            uuid primary key default gen_random_uuid(),
    quiz_id       uuid references public.gk_quizzes(id) on delete set null,
    quiz_title    text not null default '',
    status        text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'aborted')),
    phase         text not null default 'lobby'
                  check (phase in ('lobby', 'interlude', 'question', 'reveal', 'fastest', 'leaderboard', 'podium', 'matrix')),
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
    from public.gk_items i where i.quiz_id = p_quiz;
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

-- Players × questions. A cell is null (no answer) or [is_correct, ms].
create or replace function public._gk_matrix(p_session uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with s as (select quiz_id from public.gk_sessions where id = p_session),
  qs as (
    select o.idx, i.id, i.title, i.weight,
           (row_number() over (order by o.idx))::int as no
      from s, public._gk_ordered(s.quiz_id) o
      join public.gk_items i on i.id = o.item_id
     where o.kind = 'question'
  ),
  lb as (
    select x.name, (x.points)::int as points, (x.rank)::int as rank
      from jsonb_to_recordset(public._gk_leaderboard(p_session, null))
           as x(name text, points int, rank int)
  ),
  cells as (
    select p.name,
           jsonb_agg(case when a.id is null then 'null'::jsonb
                          else jsonb_build_array(a.is_correct, a.answered_ms) end order by qs.idx) as cells
      from public.gk_players p
      cross join qs
      left join public.gk_answers a
             on a.player_id = p.id and a.item_id = qs.id and not a.voided
     where p.session_id = p_session and not p.kicked
     group by p.id, p.name
  )
  select jsonb_build_object(
    'questions', coalesce((select jsonb_agg(jsonb_build_object('no', no, 'title', title, 'weight', weight) order by idx) from qs), '[]'::jsonb),
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
         answered = case when s.phase in ('question', 'reveal', 'fastest')
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
      'quiz', jsonb_build_object('title', coalesce(q.title, s.quiz_title), 'theme', coalesce(q.theme, 'stadium'),
                                 'background', q.background, 'music', q.music, 'music_on', coalesce(q.music_on, false)),
      'index', s.cur_index,
      'count', (select count(*) from public.gk_items i where i.quiz_id = s.quiz_id),
      'locked', s.locked);

    if s.phase in ('interlude', 'question', 'reveal', 'fastest', 'leaderboard') then
      select * into it from public.gk_items where id = s.cur_item_id;
    end if;

    if it.id is not null then
      v_n := case when it.kind = 'question' then jsonb_array_length(it.options) else 0 end;
      d := d || jsonb_build_object('item', jsonb_build_object(
        'id', it.id, 'kind', it.kind, 'title', it.title, 'body', it.body,
        'options', case when it.kind = 'question' then it.options else '[]'::jsonb end,
        'weight', it.weight, 'time_limit', it.time_limit_s,
        'image', it.image, 'video', it.video, 'audio', it.audio,
        'layout', it.media_layout, 'music_on', it.music_on,
        'no', (select count(*) from public._gk_ordered(s.quiz_id) o where o.kind = 'question' and o.idx <= s.cur_index),
        'of', (select count(*) from public._gk_ordered(s.quiz_id) o where o.kind = 'question')));

      if it.kind = 'question' then
        d := d || jsonb_build_object('starts_at', public._gk_ms(s.q_started_at), 'deadline', public._gk_ms(s.q_deadline));
      end if;

      if it.kind = 'question' and s.revealed then
        d := d || jsonb_build_object(
          'correct', to_jsonb(it.correct),
          'counts', (select jsonb_agg((select count(*) from public.gk_answers a
                                        where a.session_id = s.id and a.item_id = it.id and not a.voided
                                          and a.option_idx = g.i) order by g.i)
                       from generate_series(0, v_n - 1) as g(i)),
          'answered', (select count(*) from public.gk_answers a
                        where a.session_id = s.id and a.item_id = it.id and not a.voided),
          'fastest', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'ms', f.answered_ms, 'points', f.points)
                                                order by f.answered_ms, f.id)
                                 from (select p.name, a.answered_ms, a.points, a.id
                                         from public.gk_answers a join public.gk_players p on p.id = a.player_id
                                        where a.session_id = s.id and a.item_id = it.id and not a.voided
                                          and a.is_correct and not p.kicked
                                        order by a.answered_ms, a.id limit 5) f), '[]'::jsonb));
      end if;
    end if;

    if s.phase = 'leaderboard' then
      d := d || jsonb_build_object('leaderboard',
             public._gk_leaderboard(s.id, case when it.kind = 'question' then it.id end));
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

-- Put item number p_index on screen. Everything from that item onwards is
-- voided first — this is what makes "go back two questions" restore the table.
create or replace function public._gk_enter(p_session uuid, p_index int)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s  public.gk_sessions%rowtype;
  it public.gk_items%rowtype;
  v_lead int;
  v_start timestamptz;
begin
  select * into s from public.gk_sessions where id = p_session for update;
  select i.* into it from public._gk_ordered(s.quiz_id) o join public.gk_items i on i.id = o.item_id
   where o.idx = p_index;
  if not found then raise exception 'no_such_item' using errcode = '22023'; end if;

  update public.gk_answers a set voided = true
   where a.session_id = s.id and not a.voided
     and a.item_id in (select o.item_id from public._gk_ordered(s.quiz_id) o where o.idx >= p_index);

  select coalesce(lead_in_s, 0) into v_lead from public.gk_quizzes where id = s.quiz_id;
  v_start := now() + make_interval(secs => coalesce(v_lead, 0));

  update public.gk_sessions
     set status = 'running', started_at = coalesce(started_at, now()),
         cur_index = p_index, cur_item_id = it.id, revealed = false,
         phase = case when it.kind = 'question' then 'question' else 'interlude' end,
         q_started_at = case when it.kind = 'question' then v_start end,
         q_deadline   = case when it.kind = 'question' then v_start + make_interval(secs => it.time_limit_s) end
   where id = s.id;
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
           'quiz', jsonb_build_object('title', coalesce(q.title, s.quiz_title), 'theme', coalesce(q.theme, 'stadium'),
                                      'background', q.background, 'music', q.music, 'music_on', coalesce(q.music_on, false)),
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

  if s.cur_item_id is not null and s.phase in ('question', 'reveal', 'fastest', 'leaderboard') then
    select * into a from public.gk_answers
     where session_id = v_sid and item_id = s.cur_item_id and player_id = p.id and not voided;
    v_out := v_out || jsonb_build_object('item_id', s.cur_item_id, 'answered', a.id is not null, 'option', a.option_idx);
    if not v_hide then
      v_out := v_out || jsonb_build_object('result', jsonb_build_object(
        'correct', coalesce(a.is_correct, false), 'points', coalesce(a.points, 0), 'ms', a.answered_ms));
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
  if not found or p_option is null or p_option < 0 or p_option >= jsonb_array_length(it.options) then
    raise exception 'bad_option' using errcode = '22023';
  end if;

  v_ms := least(greatest((extract(epoch from (v_now - s.q_started_at)) * 1000)::int, 0), it.time_limit_s * 1000);
  v_ok := p_option = any (it.correct);

  begin
    insert into public.gk_answers (session_id, item_id, player_id, option_idx, answered_ms, is_correct, points)
    values (s.id, it.id, p.id, p_option, v_ms, v_ok, public._gk_points(v_ok, it.weight, v_ms, it.time_limit_s));
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
  elsif s.phase = 'question' then
    perform public._gk_reveal(s.id);
  elsif s.phase = 'reveal' then
    update public.gk_sessions set phase = 'fastest' where id = s.id;
    perform public._gk_publish(s.id);
  elsif s.phase = 'fastest' then
    update public.gk_sessions set phase = 'leaderboard' where id = s.id;
    perform public._gk_publish(s.id);
  else
    -- An item deleted mid-quiz must not strand the host: fall back to the
    -- stored index when the current item is no longer in the list.
    select o.idx into v_idx from public._gk_ordered(s.quiz_id) o where o.item_id = s.cur_item_id;
    v_idx := coalesce(v_idx, s.cur_index - 1, 0) + 1;
    select count(*) into v_count from public.gk_items where quiz_id = s.quiz_id;
    if v_idx > v_count then
      perform public._gk_finish(s.id);
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
    if p_view not in ('reveal', 'fastest', 'leaderboard') then raise exception 'bad_view' using errcode = '22023'; end if;
    -- An open question's results are not a view yet — reveal it first.
    if s.phase = 'question' and not s.revealed then raise exception 'not_revealed' using errcode = 'P0001'; end if;
    if p_view in ('reveal', 'fastest') and not s.revealed then raise exception 'bad_view' using errcode = '22023'; end if;
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
  select * into it from public.gk_items where id = p_item and kind = 'question';
  if not found then return; end if;
  update public.gk_answers a
     set is_correct = a.option_idx = any (it.correct),
         points = public._gk_points(a.option_idx = any (it.correct), it.weight, a.answered_ms, it.time_limit_s)
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
