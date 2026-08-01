-- ============================================================================
-- db_version_control.sql — a git object store for the league data
-- ============================================================================
-- Gives the database commits, branches, checkout and diff, with git's ACTUAL
-- architecture rather than a linear undo chain:
--
--   dbc_blob     = git blob   — one row's content, addressed by hash, shared by
--                              every commit in which that row is unchanged
--   dbc_tree     = git tree   — one table's manifest {row_pk -> blob hash},
--                              itself addressed by hash, so an untouched table
--                              costs zero storage in a new commit
--   dbc_commit   = git commit — a root {table -> tree hash} plus a parent
--                              pointer; the parent pointers form the DAG
--   dbc_ref      = git branch — a name pointing at a commit
--   dbc_head     = .git/HEAD  — where the live database currently sits
--   dbc_reflog   = git reflog — what moved HEAD, and when
--
-- Why this and not "replay the audit log backwards": a revert chain can only
-- walk the path it recorded, so it cannot put you at an arbitrary point and let
-- you diverge from there. Because every commit here stores a COMPLETE manifest,
-- checkout is a diff between two manifests applied to the live tables — the
-- path taken to get there is irrelevant. That is what makes branching work:
--
--   select dbc_checkout('main');                    -- where you are
--   select dbc_branch('experiment', '<old commit>');-- go back and fork
--   ... edit freely, publish ...                    -- commits land on the fork
--   select dbc_checkout('main');                    -- everything back as it was
--
-- Storage: with 3.5k rows / 2.3 MB of data, a commit that touches one league
-- costs a few KB — only the changed rows become new blobs, and only the changed
-- tables become new trees.
--
-- It is SAFE and RE-RUNNABLE: additive schema only, no existing table altered,
-- functions are create-or-replace. Installing it changes NOTHING about how the
-- app behaves until something calls dbc_snapshot().
--
-- Run once per environment:
--   Docker:  docker exec -i supabase_db_<project> psql -U postgres -d postgres < sql/db_version_control.sql
--   Cloud:   paste into the Supabase SQL Editor and Run
--
-- Companion to sql/supabase_schema.sql. Run AFTER it.
--
-- KNOWN BOUNDARIES (read these — they are the difference between this and PITR):
--   • Storage buckets (flags, player photos) are NOT versioned. Checkout moves
--     table data only; an image replaced yesterday stays replaced.
--   • ONE working copy. Unlike git there is no private checkout — the live DB
--     is what the public site serves, so a checkout is immediately visible.
--   • No merge. Branches diverge and you pick one; combining two divergent data
--     states needs conflict semantics that do not exist here.
--   • audit_log / Historical Changes are the journal, not versioned content —
--     they are deliberately left alone by checkout, exactly as git leaves the
--     reflog alone. A checkout is recorded in dbc_reflog instead.
--   • Identity sequences are not rewound, so ids are never reused after a
--     checkout to an older commit. This is intentional and safer.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Object store
-- ----------------------------------------------------------------------------
create table if not exists public.dbc_blob (
    hash    text primary key,
    content jsonb not null
);

create table if not exists public.dbc_tree (
    hash    text primary key,
    entries jsonb not null          -- {row_pk: blob_hash}
);

create table if not exists public.dbc_commit (
    id             uuid primary key default gen_random_uuid(),
    parent_id      uuid references public.dbc_commit(id),
    root           jsonb not null,  -- {table_name: tree_hash}
    message        text,
    author         text,
    created_at     timestamptz not null default now(),
    audit_batch_id uuid            -- the publish this commit corresponds to
);

create index if not exists idx_dbc_commit_parent on public.dbc_commit (parent_id);
create index if not exists idx_dbc_commit_at     on public.dbc_commit (created_at desc);

create table if not exists public.dbc_ref (
    name      text primary key,
    commit_id uuid not null references public.dbc_commit(id)
);

create table if not exists public.dbc_head (
    id        int primary key default 1 check (id = 1),
    commit_id uuid references public.dbc_commit(id),
    branch    text                     -- null => detached HEAD
);

insert into public.dbc_head (id, commit_id, branch) values (1, null, 'main')
on conflict (id) do nothing;

create table if not exists public.dbc_reflog (
    id          bigint generated always as identity primary key,
    at          timestamptz not null default now(),
    who         text,
    action      text not null,         -- 'commit' | 'checkout' | 'branch'
    from_commit uuid,
    to_commit   uuid,
    note        text
);

create index if not exists idx_dbc_reflog_at on public.dbc_reflog (at desc);

-- ----------------------------------------------------------------------------
-- 2. Which tables are versioned, and in FK-safe order (parents first).
--    Inserts walk this order; deletes walk it backwards.
-- ----------------------------------------------------------------------------
create or replace function public.dbc_tables()
returns text[] language sql immutable as $$
    select array['leagues','players_metadata','landing_settings',
                 'matches','manual_overrides','match_history']::text[];
$$;

-- `updated_at` is row-mtime noise written by the set_updated_at trigger, not
-- content: including it would make every commit differ from every other and
-- would fight the trigger on checkout. Stripped everywhere EXCEPT match_history,
-- where updated_at is DOMAIN data (when a result actually changed) and no
-- set_updated_at trigger exists. Mirrors audit_is_noop() in audit_batching.sql.
create or replace function public.dbc_strip_expr(p_table text)
returns text language sql immutable as $$
    select case when p_table = 'match_history' then '' else $x$ - 'updated_at'$x$ end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Reading the live tables into objects.
--    p_store=false => just compute the manifest (used to diff against reality);
--    p_store=true  => also persist every row as a blob (used when committing).
--    md5 is used as the address: this is deduplication, not a security boundary,
--    and it needs no extension. jsonb::text is already canonical (sorted keys,
--    no whitespace), so equal content always hashes equal.
-- ----------------------------------------------------------------------------
create or replace function public.dbc_table_entries(p_table text, p_store boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_store then
    execute format($f$
      with r as (select (to_jsonb(x) %s) as c, (to_jsonb(x)->>'id') as pk from public.%I x),
           h as (select pk, c, md5(c::text) as hash from r),
           ins as (insert into public.dbc_blob (hash, content)
                   select distinct hash, c from h on conflict (hash) do nothing
                   returning 1)
      select coalesce(jsonb_object_agg(pk, hash), '{}'::jsonb) from h
    $f$, public.dbc_strip_expr(p_table), p_table) into result;
  else
    execute format($f$
      select coalesce(jsonb_object_agg((to_jsonb(x)->>'id'), md5((to_jsonb(x) %s)::text)), '{}'::jsonb)
        from public.%I x
    $f$, public.dbc_strip_expr(p_table), p_table) into result;
  end if;
  return result;
end $$;

revoke all on function public.dbc_table_entries(text, boolean) from public;

-- ----------------------------------------------------------------------------
-- 4. Commit: snapshot the live database as a child of HEAD.
--    Returns the new commit id, or the existing HEAD when nothing changed
--    (git's "nothing to commit, working tree clean").
-- ----------------------------------------------------------------------------
create or replace function public.dbc_snapshot(p_message text default null,
                                               p_audit_batch_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t          text;
  entries    jsonb;
  tree_hash  text;
  root       jsonb := '{}'::jsonb;
  head       public.dbc_head%rowtype;
  parent     uuid;
  new_id     uuid;
  br         text;
begin
  perform pg_advisory_xact_lock(hashtext('dbc'));
  select * into head from public.dbc_head where id = 1;
  parent := head.commit_id;

  foreach t in array public.dbc_tables() loop
    entries   := public.dbc_table_entries(t, true);
    tree_hash := md5(entries::text);
    insert into public.dbc_tree (hash, entries) values (tree_hash, entries)
    on conflict (hash) do nothing;
    root := root || jsonb_build_object(t, tree_hash);
  end loop;

  if parent is not null
     and (select c.root from public.dbc_commit c where c.id = parent) = root then
    raise notice 'dbc: nothing to commit — working tree matches %', parent;
    return parent;
  end if;

  insert into public.dbc_commit (parent_id, root, message, author, audit_batch_id)
  values (parent, root, p_message, coalesce(auth.email(), 'external-source-automation'),
          p_audit_batch_id)
  returning id into new_id;

  -- Committing on a detached HEAD would orphan the commit, so name a branch for
  -- it (git tells you to do this by hand; here it just happens).
  br := coalesce(head.branch, 'branch-' || substr(new_id::text, 1, 8));

  insert into public.dbc_ref (name, commit_id) values (br, new_id)
  on conflict (name) do update set commit_id = excluded.commit_id;

  update public.dbc_head set commit_id = new_id, branch = br where id = 1;

  insert into public.dbc_reflog (who, action, from_commit, to_commit, note)
  values (coalesce(auth.email(), 'external-source-automation'), 'commit', parent, new_id,
          br || ': ' || coalesce(p_message, '(no message)'));

  if head.branch is null then
    raise notice 'dbc: HEAD was detached — created branch %', br;
  end if;
  return new_id;
end $$;

revoke all on function public.dbc_snapshot(text, uuid) from public;
grant execute on function public.dbc_snapshot(text, uuid) to authenticated;

-- The automation sync (scripts/sync-source.js) connects as service_role, not as
-- a logged-in user, and it saves a restore point of its own after each league.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dbc_snapshot(text, uuid) to service_role;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Writing one row back during a checkout.
--    Column list comes from the blob's own keys, so a stripped `updated_at` is
--    simply not written and the trigger stamps it — no fight, no drift.
--    OVERRIDING SYSTEM VALUE is emitted only for tables that actually have a
--    GENERATED ALWAYS identity column (matches/manual_overrides/match_history);
--    on leagues (text pk) it would be a syntax error.
-- ----------------------------------------------------------------------------
create or replace function public.dbc_write_row(p_table text, p_pk text,
                                                p_content jsonb, p_exists boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cols       text;
  cols_no_id text;
  overriding text := '';
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
           filter (where c.column_name <> 'id')
    into cols, cols_no_id
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and p_content ? c.column_name;

  if p_exists then
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, %L) r) where t.id::text = %L',
      p_table, cols_no_id, cols_no_id, p_table, p_content, p_pk);
  else
    if exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = p_table
                  and c.is_identity = 'YES' and c.identity_generation = 'ALWAYS'
                  and p_content ? c.column_name) then
      overriding := 'overriding system value';
    end if;
    execute format(
      'insert into public.%I (%s) %s select %s from jsonb_populate_record(null::public.%I, %L) r',
      p_table, cols, overriding, cols, p_table, p_content);
  end if;
end $$;

revoke all on function public.dbc_write_row(text, text, jsonb, boolean) from public;

-- ----------------------------------------------------------------------------
-- 6. Checkout: make the live database equal a commit.
--    Target may be a branch name or a commit uuid. The live tables are compared
--    against the target manifest directly (not against what HEAD claims), so
--    this self-heals even if something wrote to the DB outside version control.
--    Row-level audit is suppressed — a 3,000-row checkout must not carpet-bomb
--    Historical Changes — and the move is recorded in dbc_reflog instead.
-- ----------------------------------------------------------------------------
create or replace function public.dbc_checkout(p_target text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_commit uuid;
  target_branch text;
  head          public.dbc_head%rowtype;
  tbls          text[] := public.dbc_tables();
  t             text;
  i             int;
  want          jsonb;
  have          jsonb;
  pk            text;
  v_hash        text;
  n_row         int := 0;
  n_del         int := 0;
  n_ins         int := 0;
  n_upd         int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('dbc'));
  select * into head from public.dbc_head where id = 1;

  select r.commit_id, r.name into target_commit, target_branch
    from public.dbc_ref r where r.name = p_target;

  if target_commit is null then
    -- Not a branch: resolve a full or shortened restore-point id.
    target_commit := public.dbc_resolve(p_target);
    target_branch := null;   -- detached HEAD, exactly like git
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  -- Pass 1: deletions, children before parents.
  for i in reverse array_length(tbls, 1) .. 1 loop
    t := tbls[i];
    select coalesce(tr.entries, '{}'::jsonb) into want
      from public.dbc_commit c
      left join public.dbc_tree tr on tr.hash = c.root->>t
     where c.id = target_commit;

    execute format('delete from public.%I where id::text <> all($1)', t)
      using array(select jsonb_object_keys(want));
    get diagnostics n_row = row_count;
    n_del := n_del + n_row;
  end loop;

  -- Pass 2: inserts and updates, parents before children.
  foreach t in array tbls loop
    select coalesce(tr.entries, '{}'::jsonb) into want
      from public.dbc_commit c
      left join public.dbc_tree tr on tr.hash = c.root->>t
     where c.id = target_commit;

    have := public.dbc_table_entries(t, false);

    for pk, v_hash in select key, value from jsonb_each_text(want) loop
      if have ->> pk is distinct from v_hash then
        perform public.dbc_write_row(t, pk,
                 (select b.content from public.dbc_blob b where b.hash = v_hash),
                 have ? pk);
        if have ? pk then n_upd := n_upd + 1; else n_ins := n_ins + 1; end if;
      end if;
    end loop;
  end loop;

  update public.dbc_head set commit_id = target_commit, branch = target_branch where id = 1;

  insert into public.dbc_reflog (who, action, from_commit, to_commit, note)
  values (coalesce(auth.email(), 'unknown'), 'checkout', head.commit_id, target_commit,
          format('%s (+%s ~%s -%s)', p_target, n_ins, n_upd, n_del));

  if target_branch is null then
    raise notice 'dbc: HEAD is detached at % — commit here and a branch is created for you', target_commit;
  end if;
  return target_commit;
end $$;

revoke all on function public.dbc_checkout(text) from public;
grant execute on function public.dbc_checkout(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Branch: fork from any commit and switch to it. This is the whole point —
--    "go back to point X and carry on in a different direction".
-- ----------------------------------------------------------------------------
create or replace function public.dbc_branch(p_name text, p_from uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  src uuid;
begin
  src := coalesce(p_from, (select commit_id from public.dbc_head where id = 1));
  if src is null then
    raise exception 'dbc: nothing to branch from — take a dbc_snapshot() first';
  end if;
  if not exists (select 1 from public.dbc_commit where id = src) then
    raise exception 'dbc: no such commit %', src;
  end if;

  insert into public.dbc_ref (name, commit_id) values (p_name, src)
  on conflict (name) do update set commit_id = excluded.commit_id;

  insert into public.dbc_reflog (who, action, to_commit, note)
  values (coalesce(auth.email(), 'unknown'), 'branch', src, p_name);

  return public.dbc_checkout(p_name);
end $$;

revoke all on function public.dbc_branch(text, uuid) from public;
grant execute on function public.dbc_branch(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Inspection: log, diff, status
-- ----------------------------------------------------------------------------

-- Walk the parent chain from a ref/commit back to the root — `git log`.
create or replace function public.dbc_log(p_target text default null)
returns table(depth int, id uuid, parent_id uuid, created_at timestamptz,
              author text, message text, is_head boolean)
language sql
security definer
set search_path = public
as $$
    with recursive start as (
        select coalesce(
            (select r.commit_id from public.dbc_ref r where r.name = p_target),
            (select c.id from public.dbc_commit c where p_target is not null and c.id::text = p_target),
            (select h.commit_id from public.dbc_head h where h.id = 1)) as id
    ),
    walk as (
        select 0 as depth, c.* from public.dbc_commit c join start s on s.id = c.id
        union all
        select w.depth + 1, c.* from public.dbc_commit c join walk w on c.id = w.parent_id
    )
    select w.depth, w.id, w.parent_id, w.created_at, w.author, w.message,
           w.id = (select h.commit_id from public.dbc_head h where h.id = 1)
      from walk w order by w.depth;
$$;

grant execute on function public.dbc_log(text) to authenticated;

-- What differs between two commits — `git diff --name-status`, per row.
create or replace function public.dbc_diff(p_a uuid, p_b uuid)
returns table(table_name text, change text, row_pk text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  ea jsonb;
  eb jsonb;
begin
  foreach t in array public.dbc_tables() loop
    select coalesce(tr.entries, '{}'::jsonb) into ea
      from public.dbc_commit c left join public.dbc_tree tr on tr.hash = c.root->>t where c.id = p_a;
    select coalesce(tr.entries, '{}'::jsonb) into eb
      from public.dbc_commit c left join public.dbc_tree tr on tr.hash = c.root->>t where c.id = p_b;

    return query
      select t, 'removed', k from jsonb_object_keys(ea) k where not eb ? k
      union all
      select t, 'added',   k from jsonb_object_keys(eb) k where not ea ? k
      union all
      select t, 'changed', k from jsonb_object_keys(ea) k
       where eb ? k and (ea ->> k) is distinct from (eb ->> k);
  end loop;
end $$;

grant execute on function public.dbc_diff(uuid, uuid) to authenticated;

-- Is the live database dirty relative to HEAD? — `git status --short`.
create or replace function public.dbc_status()
returns table(branch text, head_commit uuid, dirty boolean, dirty_tables text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.dbc_head%rowtype;
  t text;
  d text[] := '{}';
begin
  select * into h from public.dbc_head where id = 1;
  foreach t in array public.dbc_tables() loop
    if h.commit_id is null
       or md5(public.dbc_table_entries(t, false)::text) is distinct from
          (select c.root->>t from public.dbc_commit c where c.id = h.commit_id) then
      d := d || t;
    end if;
  end loop;
  return query select h.branch, h.commit_id, array_length(d, 1) is not null, d;
end $$;

grant execute on function public.dbc_status() to authenticated;

-- ----------------------------------------------------------------------------
-- 8b. Human-readable layer. Everything above works in uuids; nobody wants to
--     read those. This gives short ids, a browsable list of restore points, and
--     a plain-language answer to "what actually changed here".
-- ----------------------------------------------------------------------------

-- Accept a branch name, a full uuid, or just the first few characters of one.
create or replace function public.dbc_resolve(p_target text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  out_id uuid;
  n int;
begin
  if p_target is null then
    return (select commit_id from public.dbc_head where id = 1);
  end if;

  select r.commit_id into out_id from public.dbc_ref r where r.name = p_target;
  if out_id is not null then return out_id; end if;

  -- min(uuid) has no aggregate before PG 18, hence the text detour.
  select count(*), min(c.id::text)::uuid into n, out_id
    from public.dbc_commit c where c.id::text like p_target || '%';
  if n = 1 then return out_id; end if;
  if n > 1 then raise exception 'dbc: "%" matches % restore points — use more characters', p_target, n; end if;

  raise exception 'dbc: no branch or restore point matching "%"', p_target;
end $$;

grant execute on function public.dbc_resolve(text) to authenticated;

-- The list of restore points, newest first. This is the screen you read.
create or replace view public.dbc_history as
select substr(c.id::text, 1, 8)                                    as point,
       to_char(c.created_at at time zone 'Asia/Jerusalem',
               'DD/MM/YYYY HH24:MI')                               as when_israel,
       coalesce(c.message, '(no description)')                     as description,
       c.author                                                    as by_whom,
       string_agg(r.name, ', ')                                    as branch,
       (c.id = h.commit_id)                                        as is_current,
       c.id                                                        as full_id
  from public.dbc_commit c
  cross join public.dbc_head h
  left join public.dbc_ref r on r.commit_id = c.id
 where h.id = 1
 group by c.id, h.commit_id
 order by c.created_at desc;

grant select on public.dbc_history to authenticated;

-- Name a row the way a person would refer to it.
create or replace function public.dbc_row_label(p_table text, p_content jsonb)
returns text language sql immutable as $$
    select case p_table
        when 'leagues'          then p_content->>'id'
        when 'players_metadata' then coalesce(nullif(p_content->>'full_name',''), p_content->>'id')
        when 'landing_settings' then 'Landing page'
        else coalesce(p_content->>'league_id', '?') || ': ' ||
             coalesce(p_content->>'player_a', '?') || ' vs ' || coalesce(p_content->>'player_b', '?')
    end;
$$;

-- What changed at a restore point (against its parent by default, or against
-- any other point you name). Field-level, in words.
create or replace function public.dbc_changes(p_point text default null,
                                              p_against text default null)
returns table(table_name text, change text, entity text, fields text)
language plpgsql
security definer
set search_path = public
as $$
declare
  newer uuid;
  older uuid;
  t     text;
  e_old jsonb;
  e_new jsonb;
begin
  newer := public.dbc_resolve(p_point);
  if p_against is null then
    select parent_id into older from public.dbc_commit where id = newer;
  else
    older := public.dbc_resolve(p_against);
  end if;

  foreach t in array public.dbc_tables() loop
    select coalesce(tr.entries, '{}'::jsonb) into e_old
      from public.dbc_commit c left join public.dbc_tree tr on tr.hash = c.root->>t
     where c.id = older;
    e_old := coalesce(e_old, '{}'::jsonb);

    select coalesce(tr.entries, '{}'::jsonb) into e_new
      from public.dbc_commit c left join public.dbc_tree tr on tr.hash = c.root->>t
     where c.id = newer;

    return query
    with old_e as (select key k, value h from jsonb_each_text(e_old)),
         new_e as (select key k, value h from jsonb_each_text(e_new))
    select t,
           case when o.k is null then 'added'
                when n.k is null then 'removed'
                else 'changed' end,
           public.dbc_row_label(t, coalesce(bn.content, bo.content)),
           case when o.k is null or n.k is null then null
                else (select string_agg(format('%s: %s → %s', f.key,
                             coalesce(left(fo.value, 40), '—'),
                             coalesce(left(fn.value, 40), '—')), '; ')
                        from jsonb_each_text(bo.content) fo
                        full outer join jsonb_each_text(bn.content) fn using (key)
                        cross join lateral (select coalesce(fo.key, fn.key) as key) f
                       where fo.value is distinct from fn.value)
           end
      from old_e o
      full outer join new_e n using (k)
      left join public.dbc_blob bo on bo.hash = o.h
      left join public.dbc_blob bn on bn.hash = n.h
     where o.h is distinct from n.h;
  end loop;
end $$;

grant execute on function public.dbc_changes(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Housekeeping: drop objects no commit references any more — `git gc`.
--    Only ever needed after deleting branches/commits by hand.
-- ----------------------------------------------------------------------------
create or replace function public.dbc_gc()
returns table(trees_removed int, blobs_removed int)
language plpgsql
security definer
set search_path = public
as $$
declare
  nt int; nb int;
begin
  delete from public.dbc_tree tr
   where not exists (select 1 from public.dbc_commit c, jsonb_each_text(c.root) e
                      where e.value = tr.hash);
  get diagnostics nt = row_count;

  delete from public.dbc_blob b
   where not exists (select 1 from public.dbc_tree tr, jsonb_each_text(tr.entries) e
                      where e.value = b.hash);
  get diagnostics nb = row_count;

  return query select nt, nb;
end $$;

revoke all on function public.dbc_gc() from public;

-- ----------------------------------------------------------------------------
-- 10. RLS: the history is readable by the admin app, writable only through the
--     functions above (all security definer).
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['dbc_blob','dbc_tree','dbc_commit','dbc_ref','dbc_head','dbc_reflog'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- 11. First commit: capture where the database is right now, so there is always
--     a floor to come back to. No-op on re-run (nothing to commit).
-- ----------------------------------------------------------------------------
select public.dbc_snapshot('Initial snapshot') as initial_commit;

select * from public.dbc_status();

-- ----------------------------------------------------------------------------
-- 12. Cheat sheet
-- ----------------------------------------------------------------------------
--   select dbc_snapshot('before the April re-sync'); -- save a restore point
--   select * from dbc_history;                       -- list the restore points
--   select * from dbc_changes('a1b2c3d4');           -- what changed there
--   select * from dbc_changes('a1b2c3d4','main');    -- compare any two points
--   select * from dbc_status();                      -- unsaved changes right now?
--   select dbc_checkout('a1b2c3d4');                 -- go back to that point
--   select dbc_checkout('main');                     -- return to the live line
--   select dbc_branch('experiment','a1b2c3d4');      -- go back AND fork
--   select * from dbc_reflog order by at desc;       -- everything HEAD ever did
--
-- Short ids from dbc_history work anywhere a point is expected.
