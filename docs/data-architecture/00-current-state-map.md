# 00 — Current State Map (Supabase read path, v1)

Status: **baseline, not yet re-measured**. Request counts below come from static code analysis (exact — every query call site was traced), not from a running measurement harness. Millisecond timings are out of scope for this document; see [`04-performance-budget.md`](04-performance-budget.md) for the harness that will fill them in during Phase 0 of implementation.

This document answers: *what does the site actually do today, per page, every time a user loads it?*

## 0. Dual data-source switch

Two facades sit in front of two parallel implementations:

| Concern | Facade | Supabase impl | Static-file impl |
|---|---|---|---|
| League/match data | `js/data/dataSourceLoader.js` | `js/data/supabaseLoader.js` | `js/data/leagueLoader.js` |
| Player metadata | `js/data/dataSourceMeta.js` | `js/data/supabasePlayersMetadata.js` | `js/data/playersMetadata.js` |

`js/data/dataSourceConfig.js:51-68` resolves the source with a **top-level `await`**, so every importing module blocks until resolution:
- `?datasource=files` / `?datasource=supabase` forces a mode (`:58`).
- Non-localhost → `'supabase'` immediately, **no probe request** (`:60`) — this is the deployed site.
- localhost/127.0.0.1 → runs a probe (`:63`): `GET {url}/rest/v1/landing_settings?select=id&limit=1`, 2500ms `AbortController` timeout (`:33-49`). Any HTTP response = reachable; only a network failure falls back to `files`. **This blocks all rendering on localhost until it resolves or aborts** — it never runs in production.

Admin (`js/admin/**`) always targets Supabase directly regardless of this flag (`dataSourceConfig.js:22-25`).

There are **11 league folders** under `leagues/` — "N" below means 11.

## 1. Query catalogue (`js/data/supabaseLoader.js`)

| Function | Table / query | Order | Deterministic? | 1000-row cap risk |
|---|---|---|---|---|
| `loadLandingSettings` (:70) | `landing_settings` `*`, `id=1`, `.single()` | — | yes (single row) | no |
| `loadLeagueParams` (:93) | `leagues` `*`, `id=eq.<id>`, `.single()` | — | yes (single row) | no |
| `loadLeagueMatches` (:105) | `matches` `*`, `league_id=eq.<id>` | `round asc` | **no** — ties unordered | **yes — single request, no `.range()`** |
| `loadLeagueMatchesAll` (:133) | same, keeps unplayed | `round asc` | **no** | **yes** |
| `loadOverrides` (:154) | `manual_overrides` `*`, `league_id=eq.<id>` | none | no | yes (small sets, low practical risk) |
| `loadMatchHistory` (:160) | `match_history` `*`, `league_id=eq.<id>` | none | no | yes (small sets) |
| `loadLeague` (:186) | cache + `Promise.all` of the 4 above | — | inherits above | inherits |
| `loadLeaguesBulk` (:244) | 4 tables via `.in(id, leagueIds)`, paginated `fetchAllRows` (`.range()` loop, stops <1000) | `leagues.id`; `matches.round,id`\*; `overrides.id`; `history.id` | **yes** (working tree) | handled |
| `loadAllLeagueParams` (:385) | `leagues` `*`, `.in('id', leagueIds)` | none (re-sorted in JS) | query order not deterministic | yes — single request (low risk, ~11 rows) |

\* The `matches.round,id` order and the `.order('id')` tiebreakers across `loadLeaguesBulk` are an **uncommitted working-tree change** (`git status` shows `supabaseLoader.js` modified). The committed version ordered `matches` by `round` only with no tiebreaker — see §3 for why that mattered.

`last_updated`: not a separate query — rides along on `leagues` `select('*')` in every function above. `loadLeagueMatches`'s own docstring notes it deliberately skips re-fetching it. **No duplicate `last_updated` query exists today.**

## 2. Per-page request inventory

### `index.html` — Landing
Chain: `initNavBar → ensureLeagueIndex` (`navigation.js:86-117`, memoized) calls `loadLeagueOrder`(→`loadLandingSettings`) + `loadAllLeagueParams`. Independently, `mountSiteSidebar → populateAsync` (`siteSidebar.js:299-311`) calls **its own** `loadLandingSettings` + `loadAllLeagueParams` (not memoized against the navbar's calls). Independently again, `renderLandingPage` (`landingPage.js:64-210`) calls `loadLandingSettings` a **third/fourth time** (:75) plus `loadAllLeagues` (`crossLeague.js:21`) → `loadLeagueOrder`(→`loadLandingSettings` again) + `loadLeaguesBulk` (4 queries) ‖ `loadPlayersMetadata`.

| Query | Count | Note |
|---|---|---|
| `landing_settings id=eq.1` | ~4 | navbar + sidebar + renderer + crossLeague — **not memoized across these 4 call sites** |
| `leagues id=in.(11)` | ~2 | navbar + sidebar |
| `loadLeaguesBulk` set | 4 | fixed, regardless of league count |
| `players_metadata` | 1 | memoized after |
| `banner-config.json` (static) | 1 | not Supabase |
| analytics POST | 1 (+1 on exit) | |

**Total ≈ 12 Supabase requests, cold.** The old per-league 4×N fan-out is already fixed via `loadLeaguesBulk` (4 fixed queries for all 11 leagues) — remaining waste is the **unmemoized duplicate fixed queries**, not an N+1.

### `league.html` — Dashboard
`dashboardPage.js:49-56` — `Promise.all` of 6: `loadLeagueParams` + `loadOverrides` + `loadMatchHistory` + `loadLeagueOrder`(→`loadLandingSettings`) + `loadPlayersMetadata` + `loadLeagueMatchesAll`; then `loadAllLeagueParams` (:63) for nav arrows; predictor (`batchLast300PRForSimulator` :701) triggers `loadVisibleLeagues → loadAllLeagues → loadLeaguesBulk` (4 more queries).

**Important:** this page does **not** call `loadLeague`, so it **bypasses `sb-league-cache` entirely** — always re-queries even when the landing page just warmed the cache for this same league.

**Total ≈ 13–15 Supabase requests, cold or warm** (cache bypass means warm doesn't help).

### `league_table.html` — League table
`leaguePage.js:37-43` — `Promise.all([loadLeague(id), loadPlayersMetadata(), loadLeagueOrder()])` + `loadAllLeagueParams` for nav arrows. `loadLeague` (:186-211) **checks `sb-league-cache` first**; on miss, 4 parallel queries, then writes the cache.

**Total ≈ 8 cold**, **≈ 4 warm** (if this exact league was visited <60s ago in this tab — the only page that benefits from the cache).

### `player_league.html` — Player-in-league
`playerPage.js:35-42` — `Promise.all([loadLeague(id), loadPlayersMetadata(), ensurePlayerIndex(), loadLeagueOrder()])`. `ensurePlayerIndex` (`navigation.js:137-219`) builds a cross-league player index: **one `matches?league_id=eq.<id>` query per non-hidden league**, in parallel — a real N-fan-out (≈11 queries), memoized only within the same page instance, rebuilt on every navigation.

**Total ≈ 18–20 cold, ≈ 14 warm** — the worst page.

### `player.html` — Cross-league player profile
`playerGeneralPage.js:74-77` — `Promise.all([loadPlayerAcrossLeagues(name), loadPlayersMetadata()])`. `loadPlayerAcrossLeagues → loadVisibleLeagues → loadAllLeagues → loadLeaguesBulk` (4 queries, memoized for the rest of the page's ranking sections). This call also **populates `sb-league-cache` for every league**, so a subsequent league/table nav is cache-served.

**Total ≈ 9 Supabase requests.**

### `analytics.html` — Analytics dashboard
Single `supabase.rpc('analytics_summary', {from_date,to_date})`. No sidebar, no navbar, no analytics.js beacon, no data-source facade. **1 request** — not touched by this redesign.

### `admin.html`
Auth-gated (`js/admin/auth.js`), reads/writes Supabase directly via `js/admin/supabaseAdmin.js`. View-dependent request set, out of scope for the request-count table but **in scope for the architecture** (§ in `01-architecture.md`: admin stays on direct/fresh queries, never the cache).

## 3. Caching inventory

**sessionStorage `sb-league-cache:<leagueId>`** (`js/data/leagueCache.js`) — TTL 60s (:17). Written by `loadLeague` (:209) and `loadLeaguesBulk` (:319). **Read only by `loadLeague`** (:187) — `dashboardPage.js` never reads it. Per-tab only (not shared across tabs). Silent write failure on quota/private-mode (:38-41).

**In-memory module memos** (die on every full navigation — this is an MPA, not an SPA): `crossLeague.js:14 allLeaguesPromise`; `navigation.js:83 leagueIndexReady`, `:130 playerIndexPromise`; `supabasePlayersMetadata.js:11 _cache`; `dataSourceConfig.js:57 _source`.

## 4. Navigation model & bfcache

Every transition is a full browser navigation (MPA via query params: `?league=`, `?player=`, `?tab=`, `?datasource=`, `?edit=1`, `?preview=true`). **No `unload`/`beforeunload` handlers exist anywhere** → pages are bfcache-eligible today. `js/analytics.js` uses `pagehide` (bfcache-safe) + `visibilitychange`, and `fetch(..., {keepalive:true})` — not `navigator.sendBeacon` (deliberately abandoned per its own comments: Supabase's CORS preflight returns a wildcard origin, which browsers refuse to pair with a credentialed beacon). No WebSocket/realtime subscriptions are open. **No bfcache blockers found.**

Back navigation is "catastrophic" today specifically when: (a) bfcache misses (browser evicted the page, or dev tooling disabled it), or (b) the 60s `sb-league-cache` TTL has expired — either produces a full request storm identical to a cold load, and only `league_table.html`/`player.html`/`player_league.html`(partially) benefit from the cache at all.

## 5. Known-bugs register

| Bug | Location | Status | Resolved by |
|---|---|---|---|
| Silent 1000-row truncation | `loadLeagueMatches`, `loadLeagueMatchesAll`, `loadOverrides`, `loadMatchHistory`, `loadAllLeagueParams` — all single-request, no `.range()` | **latent** (low practical risk today at ~350 rows/league, but structural) | `01-architecture.md` §A5 — one-row jsonb RPC response eliminates PostgREST pagination entirely |
| Non-deterministic `ORDER BY` (round-only, ties unordered) | committed `loadLeagueMatches`/`All` | **latent** in the granular per-league loaders | same — bundle RPC orders server-side with a unique tiebreaker |
| Page-boundary row duplication (caused a player's PR to read 3.01 instead of 3.08) | `loadLeaguesBulk`'s paginated `matches` query, committed version, ordered by `round` only | **fixed only in uncommitted working tree** (`.order('id')` tiebreaker added) — not yet committed | superseded once the bundle RPC lands (no client-side pagination at all) |
| Blocking localhost probe (worst case 2.5s) | `dataSourceConfig.js:63`, top-level await | **live**, dev-only | `01-architecture.md` §A4 — probe removed; `?datasource=files` stays as explicit escape hatch |
| `landing_settings` fetched ~4× per landing-page load | navbar / sidebar / renderer / crossLeague, no shared memo | **live** | `01-architecture.md` — all consumers read one `store.js` |
| `leagues?id=in` fetched ~2× per landing-page load | navbar / sidebar | **live** | same |
| 11-query fan-out in `ensurePlayerIndex` | `navigation.js:170-183` | **live** | bundle already contains all leagues' matches; no per-league query needed |
| Dashboard bypasses the league cache entirely | `dashboardPage.js` uses granular loaders, never calls `loadLeague` | **live** | store.js is the only cache; no loader can bypass it by construction |
