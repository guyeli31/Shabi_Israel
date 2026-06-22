# Plan: In-house anonymous analytics POC on Supabase

> **How to use this file:** this is a self-contained brief. You can paste it into a
> fresh Claude Code chat (even on another machine) and start work without prior context.
> Build order is at the bottom. Start by confirming the SQL schema with the user, then
> the beacon, then the dashboard.

---

## Project context (cold-start)

"Shabi Israel" — a Backgammon league statistics web app.
- Vanilla HTML/CSS/JS, ES modules, **no build step, no dependencies, no package.json** at v1 root.
- Hosted on GitHub Pages, custom domain **golan.me.uk**.
- Served locally: `npx http-server -p 8090 --cors -c-1` → http://localhost:8090
- SPA-style navigation via query params: `?league=<id>`, `?player=<name>`.
- A parallel v2 rebuild (Vite) lives under `v2/`. **Do not touch v2 in this POC** — v1 only.
  Record a follow-up note in `v2/docs/MIGRATION-FROM-V1.md` that analytics must be ported to v2 later.
- A Supabase project already exists (account provisioned) but **no code talks to it yet** —
  there is no `js/data/supabaseClient.js`. This POC is the **first** code to touch Supabase.
- Full DB migration plan (read it to match conventions/keys): `docs/plans/supabase-migration.md`.
  Key naming from there: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon key is safe for the browser);
  `service_role` key is **server-only, never in client code**. SDK is imported from `https://esm.sh/@supabase/supabase-js@2`.

### Live public pages to instrument (verified by filename + `<title>`)
| File | `<title>` | `page` value |
|------|-----------|--------------|
| `index.html` | Shabi Israel | `landing` |
| `league.html` | League | `league` |
| `league_table.html` | League Table | `league_table` |
| `player.html` | Player Profile | `player` |
| `player_league.html` | Player in League | `player_league` |

**Exclude** tooling/admin pages: `admin.html`, `design-catalogue.html`, `design-lab.html`,
`typo-editor.html`, `table-lab/`, and everything under `v2/`.

---

## Goal

A first-party, **fully anonymous** analytics system: no third party, no IP, no consent
banner, no cookies, no persistent identifier. It also serves as the **first Supabase POC**
— insert-only, zero risk to any existing data.

Collect: pageviews, dwell time, clicks, device, and referrer source.

### Privacy stance (deliberate)
- No IP, no persistent ID, no cookies, no localStorage.
- `session_id` is a random UUID in **`sessionStorage`** → cleared when the tab closes.
  This counts **visits**, not unique devices — an intentional choice that avoids the legal
  consent questions a persistent ID would raise. Leave a documented upgrade path to a
  persistent ID if ever wanted.
- If country is ever wanted, it requires an Edge Function that derives country from IP and
  discards the IP — **out of scope** for this POC.

---

## Architecture (4 parts)

### Part 1 — Supabase table + RLS + summary function (deliver as one `.sql` file)

Deliver a ready-to-run file (e.g. `sql/analytics_poc.sql`) for the Supabase SQL Editor.
The visitor (`anon` role) gets **INSERT only**; raw rows are never readable by anon. The
dashboard reads **aggregations only** through a `SECURITY DEFINER` function.

```sql
-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  session_id    text not null,
  event_type    text not null check (event_type in ('pageview','duration','click')),
  path          text,
  page          text check (page in ('landing','league','league_table','player','player_league')),
  league_id     text,
  player        text,
  referrer_kind text check (referrer_kind in ('direct','search','social','internal','other')),
  referrer_raw  text,
  device_type   text check (device_type in ('mobile','tablet','desktop')),
  os            text,
  browser       text,
  screen_w      int,
  screen_h      int,
  viewport_w    int,
  viewport_h    int,
  duration_ms   int,            -- duration events only
  click_target  text            -- click events only
);

create index if not exists idx_analytics_created_at on public.analytics_events (created_at);
create index if not exists idx_analytics_page       on public.analytics_events (page);
create index if not exists idx_analytics_event_type on public.analytics_events (event_type);

-- ── RLS: anon may INSERT only; no SELECT/UPDATE/DELETE for anon ───────────
alter table public.analytics_events enable row level security;

drop policy if exists analytics_anon_insert on public.analytics_events;
create policy analytics_anon_insert
  on public.analytics_events
  for insert
  to anon
  with check (true);

-- ── Aggregations via SECURITY DEFINER (read-only, returns JSON, no raw rows) ─
create or replace function public.analytics_summary(from_date timestamptz, to_date timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ev as (
    select * from public.analytics_events
    where created_at >= from_date and created_at < to_date
  )
  select jsonb_build_object(
    'total_pageviews', (select count(*) from ev where event_type = 'pageview'),
    'visits',          (select count(distinct session_id) from ev),
    'avg_dwell_ms',    (select coalesce(round(avg(duration_ms)), 0) from ev where event_type = 'duration'),
    'top_pages',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select page, count(*) views from ev
                           where event_type='pageview' and page is not null
                           group by page order by views desc limit 20) t),
    'top_leagues',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select league_id, count(*) views from ev
                           where event_type='pageview' and league_id is not null
                           group by league_id order by views desc limit 20) t),
    'top_players',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select player, count(*) views from ev
                           where event_type='pageview' and player is not null
                           group by player order by views desc limit 20) t),
    'by_device',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select device_type, count(*) views from ev
                           where event_type='pageview' and device_type is not null
                           group by device_type order by views desc) t),
    'by_referrer',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select referrer_kind, count(*) views from ev
                           where event_type='pageview' and referrer_kind is not null
                           group by referrer_kind order by views desc) t),
    'timeseries',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                          (select date_trunc('day', created_at) day, count(*) views from ev
                           where event_type='pageview' group by day order by day) t)
  );
$$;

revoke all on function public.analytics_summary(timestamptz, timestamptz) from public;
grant execute on function public.analytics_summary(timestamptz, timestamptz) to anon;
```

**Isolation requirement:** the insert grant and policy must touch **only** this table — do
not alter privileges on `leagues`, `matches`, `players_metadata`, etc.

**POC tradeoff to document:** `analytics_summary` is granted to `anon`, so the dashboard
works without auth. Upgrade path: restrict `execute` to `authenticated` and put `analytics.html`
behind Supabase Auth once Phase 3 of the migration plan lands.

### Part 2 — Client beacon: `js/analytics.js` (single source)

A single ES module, no dependencies. Behaviour:
- **Session id:** read from `sessionStorage`; if absent, `crypto.randomUUID()` and store it.
- **pageview** (on load): detect `page` from the filename (table above); extract `league_id`
  and `player` from `URLSearchParams`; collect device + referrer (below); send immediately.
- **dwell time:** accumulate **visible** time only via `visibilitychange` (start timer on
  `visible`, bank elapsed on `hidden`). On `pagehide` / final `hidden`, send a `duration`
  event with total visible `duration_ms`.
- **clicks:** one **delegated** listener on `document` — capture `<a>` clicks and any element
  with `data-track`. Record a stable `click_target` (e.g. `data-track` value, or link text/href).
- **device:** parse `navigator.userAgent` → `device_type` (mobile/tablet/desktop), `os`,
  `browser`; plus `screen.width/height` and `window.innerWidth/innerHeight`.
- **referrer:** `document.referrer` → `direct` (empty), `internal` (same origin),
  `search` (google/bing/duckduckgo/yahoo/…), `social` (facebook/x/twitter/t.co/instagram/
  linkedin/whatsapp/…), else `other`. Keep `referrer_raw` for debugging.

**Transport — read this carefully (the main implementation trap):**
- **Primary:** `fetch(url, { method:'POST', keepalive:true, headers, body })`.
  `keepalive:true` lets it survive page unload (covers the `duration` event), **and** unlike
  `sendBeacon` it can set the headers Supabase needs:
  ```
  POST {SUPABASE_URL}/rest/v1/analytics_events
  apikey:        {SUPABASE_ANON_KEY}
  Authorization: Bearer {SUPABASE_ANON_KEY}
  Content-Type:  application/json
  Prefer:        return=minimal      ← REQUIRED. With insert-only RLS, return=representation
                                       triggers a SELECT the anon role can't do → request fails.
  ```
- **Fallback (unload path only):** `navigator.sendBeacon`. Note it **cannot set custom headers**,
  so pass the key as a query param `?apikey={SUPABASE_ANON_KEY}` and send a
  `new Blob([json], { type:'application/json' })`. Do **not** rely on it as primary.
- **No-config = silent no-op.** If `SUPABASE_URL`/key are absent, do nothing — no console errors.

**Config single-source (match migration conventions):** put the two values in one tiny module
`js/data/supabaseConfig.js` (`export const SUPABASE_URL = '…'; export const SUPABASE_ANON_KEY = '…';`)
and import them in `analytics.js`. The future `js/data/supabaseClient.js` (migration Phase 2)
reuses the same module — no duplicated keys.

### Part 3 — Wire the beacon into all 5 public pages

Add one line immediately before `</body>` in `index.html`, `league.html`, `league_table.html`,
`player.html`, `player_league.html`:
```html
<script type="module" src="js/analytics.js"></script>
```

### Part 4 — Dashboard: `analytics.html`

- Standalone page that calls the RPC and renders the summary. Use the Supabase SDK from
  `https://esm.sh/@supabase/supabase-js@2` and `supabase.rpc('analytics_summary', { from_date, to_date })`
  (read path, not unload-sensitive — SDK is fine here).
- Show: pageviews over time, top pages, most-viewed leagues/players, avg dwell time,
  device breakdown, referrer breakdown, mobile vs desktop.
- Reuse existing design tokens/components (`css/variables.css`, `css/components.css`) and the
  project's existing chart approach (the repo already has a shared-chart utility — find and reuse it)
  so it matches the rest of the site.
- Escape any text rendered into `innerHTML` (player/league names) — reuse/borrow `escapeHtml()`
  pattern noted in the migration plan (`js/utils/sanitize.js`).

---

## Constraints / working rules

- **Do not `git commit`.** Stage/edit files only — the user commits at their own pace.
- Before starting a server, probe first:
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html` — if `200`, reuse it,
  don't relaunch. Otherwise `npx http-server -p 8090 --cors -c-1` (background).
- Vanilla ES modules only; no build, no deps, no root `package.json`.
- **v1 only.** Don't touch `v2/`; log the port-to-v2 follow-up in `v2/docs/MIGRATION-FROM-V1.md`.
- Anonymous by design: no IP, no persistent identifier, no cookies.

## What's needed from the user before coding
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (anon public key — safe for the browser).

## Deliverables
1. `sql/analytics_poc.sql` — table + indexes + insert-only RLS + `analytics_summary` function + grants.
2. `js/data/supabaseConfig.js` — single-source URL + anon key.
3. `js/analytics.js` — full beacon (pageview + duration + clicks + device + referrer + session).
4. Beacon `<script>` wired into the 5 public pages.
5. `analytics.html` — dashboard reading the RPC.
6. Short run instructions: where to paste URL+key, how to run the SQL, how to verify.

## Build order
1. **Confirm the schema + SQL with the user**, then have them run `sql/analytics_poc.sql` in Supabase.
2. `supabaseConfig.js` + `analytics.js`; wire into the 5 pages.
3. `analytics.html` dashboard.

## Verification
1. Run the SQL; confirm `analytics_events` exists and RLS is on (Supabase → Table Editor / Auth → Policies).
2. Serve locally; open each of the 5 pages. In DevTools → Network, confirm a `POST` to
   `/rest/v1/analytics_events` returns **2xx** (not 401/400). 401 ⇒ apikey/role wiring; 400 ⇒
   `Prefer: return=minimal` missing vs insert-only RLS.
3. Navigate away / close a tab → confirm a `duration` event with non-zero `duration_ms` is sent.
4. Click a link and a `[data-track]` element → confirm `click` events.
5. In Supabase SQL Editor, run `select count(*), event_type from analytics_events group by event_type;`
   (as service role) to confirm rows landed.
6. Open `analytics.html` → confirm the summary renders and numbers match.
7. Confirm anon **cannot** read raw rows: from the browser, a direct
   `GET /rest/v1/analytics_events` with the anon key must return **no rows / forbidden**.
