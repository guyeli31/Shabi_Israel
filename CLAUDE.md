# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## v2 rebuild in progress — see `v2/`

A parallel clean-slate rebuild lives under `v2/` and is the end-state target. Plan: `C:\Users\User\.claude\plans\sharded-gliding-locket.md`. While the rebuild is in progress:

- **v1 (current production)** at `shabi-israel/` keeps running. Serve via `npx http-server -p 8090 --cors -c-1` from repo root → `http://localhost:8090/shabi-israel/`.
- **v2 (rebuild)** at `v2/` uses Vite. `cd v2 && npm install && npm run dev` → `http://localhost:5173`.
- Both versions share `leagues/` at the repo root. v1 reads via `fetch('leagues/...')`. v2 reads via `fetch('/data/...')` proxied by Vite's `shared-data-proxy` plugin (see `v2/vite.config.js`).
- **Admin writes**: avoid simultaneous admin editing in both versions. v2 admin is read-only until Phase 8 of the rebuild plan.
- **Bug fixes during rebuild**: any fix landing in v1 must also be re-applied to the corresponding v2 destination. Track in `v2/docs/MIGRATION-FROM-V1.md`.
- **Cutover**: single scripted commit via `bash v2/scripts/migrate-v1-to-v2.sh`. Archives v1 to `_archive_v1/`, promotes `v2/*` to repo root. Rollback = `git revert HEAD`.

## Hosting layout — the repo root is the DOMAIN root

`golan.me.uk` hosts more than one project, so **the repo root is not the app** —
it is the domain root, and the app lives one folder down:

```
<repo root>              → golan.me.uk/            hub page, CNAME, 404.html
├── shabi-israel/        → golan.me.uk/shabi-israel/   the whole app
│   └── *.html  css/  js/  assets/  vendor/  table-lab/
└── WC26/                → golan.me.uk/WC26/       predates the layout; keeps
                                                    its original URL, borrows the
                                                    app's CSS via ../shabi-israel/
```

Everything else at the repo root (`scripts/`, `docs/`, `sql/`, `tools/`, `v2/`)
is tooling, not served content.

- **`404.html` at the domain root is the redirect for the old URLs.** The app
  used to be served from the domain root, so `golan.me.uk/league.html?league=…`
  must still land on `/shabi-israel/league.html?league=…`. Pages has no
  server-side rewrites — serving 404.html for every unmatched path is the only
  hook there is. It skips paths already under a served folder, so a genuine miss
  can't loop.

- **Serve locally from the repo root** so the local tree matches production:
  `npx http-server -p 8090 --cors -c-1` → the app is at
  `http://localhost:8090/shabi-israel/`, NOT at the port root. The `tools/*.bat`
  launchers point there — but note the trap they all fell into after the folder
  move: a launcher that PROBES port 8090 and falls back to claiming a free one
  has **two** URLs in it, and only the probe branch got updated. The fallback
  branch still opened the port root, so the launcher worked whenever a server
  happened to be up already and silently opened the domain hub instead of the app
  whenever it did not. When adding or editing a launcher, update every URL in it.
- **Every path inside `shabi-israel/` is relative and must stay that way.** The
  whole folder move worked precisely because the project has zero root-absolute
  (`/…`) paths — a single `src="/css/x.css"` would have broken under the
  subpath and would break the next move too.
- **The only absolute URLs are the `og:`/`twitter:` meta tags**, which the
  protocol requires to be absolute. They carry `/shabi-israel/` and are the one
  thing that does NOT follow a move on its own.
- **Scripts in `scripts/` resolve into `../shabi-israel/`**, not `..`. A new
  script that reads the site must do the same.
- **The build emits page-relative asset paths, never `/assets/build/…`.** A
  root-absolute src resolves against the DOMAIN root and 404s from inside a
  subfolder; `build-v1.cjs` computes the path relative to each page instead.
- A future project = a sibling folder here, plus a link on the hub page. If it
  ever needs its own repo instead, the domain has to move to a
  `<user>.github.io` repo first; `golan.me.uk/shabi-israel/` stays identical
  either way, so no link breaks.

## Data & query standards

v1's read path moved from static CSV/JSON to Supabase (see `js/data/supabaseLoader.js`). A ground-up redesign of the query strategy is proposed in `docs/data-architecture/` — read `docs/data-architecture/README.md` first. Once approved and implemented, all future pages/features touching data reads must follow `docs/data-architecture/02-query-standards.md`.

## Project Overview

Shabi Israel is a Backgammon league statistics web app. It loads CSV match data client-side, computes player statistics (win rate, PR, luck, rankings), and renders interactive HTML pages with sortable tables and color-coded stats.

No build step — pure vanilla HTML/CSS/JS running in the browser. Deployed on GitHub Pages. (v2 introduces Vite; deployment workflow updates at cutover.)

## Architecture

3 HTML pages with SPA-like navigation via query params:
- `index.html` — Landing page listing all leagues
- `league_table.html?league=<id>` — League summary with ranked player table
- `player_league.html?league=<id>&player=<name>` — Player match history

### JS Modules (`js/`)
| Layer | Files | Purpose |
|-------|-------|---------|
| Data | `data/csvParser.js`, `data/leagueLoader.js` | Parse CSV, fetch league data |
| Compute | `compute/stats.js`, `compute/rankings.js`, `compute/colorScale.js`, `compute/leagueTypes.js` | Statistics, sorting/ranking, color gradients, league type config |
| Render | `render/landingPage.js`, `render/leaguePage.js`, `render/playerPage.js` | DOM rendering for each page |
| Utils | `utils/helpers.js` | URL params, formatting, flag paths |

### CSS (`css/`)
- `variables.css` — Design tokens (colors, spacing, fonts)
- `layout.css` — Page structure, responsive breakpoints
- `components.css` — Tables, badges, medals, flags, status pills
- `theme.css` — Data-driven color classes

### Data (`leagues/`)
- `landing_settings.json` — Title, subtitle, logo path, and display order of leagues (source of truth for league discovery)
- Each league folder contains `leaguedata.csv` and `league_params.json`

## Development

Serve locally (ES modules require a server) **from the repo root** — the app is then at `http://localhost:8090/shabi-israel/`, matching production (see § Hosting layout). **Preferred port: 8090** (we standardised off 8080 because other tools collide on it), but don't fixate on it — see below.

### Dev server — reuse if already up, else claim the next free port

The `http-server` process is OS-level, independent of any Claude window. If a sibling window already started one on 8090, every other window should reuse it. Before starting a server, always probe:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/shabi-israel/index.html
```

- `200` → server is up, reuse `http://localhost:8090/shabi-israel/` as-is. Do **not** relaunch.
- anything else → try to start it on 8090; if that port is already held by something that isn't this app (EADDRINUSE, or a 200 comes back but not from this app's index.html), walk up sequentially (8091, 8092, …) until one binds cleanly:
  ```bash
  npx http-server -p 8090 --cors -c-1
  ```
  Run with `run_in_background: true` so it survives the turn. A follow-up 200 probe on the chosen port confirms bind success even if the bash task reports a non-zero exit.

Never kill a running `http-server` just to "start clean" — other windows (and the user's own browser tabs) may depend on it. This reuse-or-increment pattern applies to every project, not just this one.

### Playwright MCP — isolated per session (parallel-safe)

`.mcp.json` passes `--isolated` to the Playwright MCP server, so each Claude window gets its own in-memory browser profile instead of sharing one Chrome profile. This means multiple windows/sessions can drive Playwright MCP at the same time without the old "Browser is already in use" lock.

Trade-off: an isolated profile does **not** persist logins/cookies across sessions — each session starts logged out. For BGStudio automation, log in fresh each session (see `reference_mcp_credentials` memory for the test account) rather than expecting a shared authenticated session.

### Playwright MCP — two servers: `playwright` (desktop) and `playwright-mobile`

Mobile behaviour on this site is gated on **touch, not width**
(`isTouchDevice()` in `js/render/searchOverlay.js` reads `pointer: coarse` /
`maxTouchPoints` / `ontouchstart`). So `browser_resize` to 390px does **not**
put the site in mobile mode — it gives you a narrow desktop, and every
touch-only path (the search sheet above all) stays dormant. This has already
caused a "the sheet is broken" false alarm.

`.mcp.json` therefore declares a second server, `playwright-mobile`, started
with `--device "iPhone 15 Pro Max"` (430×739, dsf 3, `hasTouch`) — 430px
matching the real phone this project is checked on. Use its `browser_*` tools
for any mobile verification; use plain `playwright` for desktop. Both carry
`--isolated`, so they run side by side.

**Do NOT emulate touch over CDP** (`Emulation.setTouchEmulationEnabled` /
`setEmitTouchEventsForMouse` via `browser_run_code_unsafe`). It sets the
signals the page reads, so it looks like it worked — and then **every**
`click()` in that context times out at "performing click action", including on
elements with no relation to touch, because Playwright's input pipeline and the
CDP override disagree about the event model. The damage outlives
`clearDeviceMetricsOverride`; only closing the page clears it. `hasTouch` has to
come from the browser context at creation, which is what `--device` does.

**A window is mobile or desktop for its whole life.** Pick the server before the
first navigation and stay on it; there is no way to convert a running window.

`?searchoverlay=force` / `=off` is a **per-URL** override, not a session mode: it
applies to the page you load it on and is LOST on the next navigation, so a
session run that way silently drops back to desktop the moment you follow a link
to the next search. Use it for a one-off check of the opposite mode on either
server — never as the way to test mobile.

### Automated browsing must never reach the live analytics

Driving a real browser against `golan.me.uk` fires **real analytics beacons**.
A single performance run once wrote **151 pageviews across 103 sessions into one
hour** of the production dashboard — each measurement uses a fresh browser
profile, so each registered as its own visitor. Cleaning it up needed a
hand-written SQL file reconstructed from timestamps
(`sql/cleanup_test_analytics_2026-08-18.sql`), because the traffic had left no
marker to filter on.

- **Playwright scripts:** set the flag in `context.addInitScript()`, before the
  first navigation —
  `try { localStorage.setItem('shabi:no-analytics', '1'); } catch {}`
- **MCP / hand-driven browsing:** load the FIRST url with `?notrack`. It writes
  the same localStorage key, so it survives every navigation after it — a
  per-URL override alone would cover exactly one pageview, the same trap as
  `?searchoverlay=force`. `?track` clears it.
- `analytics.html` emits nothing (it does not load `js/analytics.js`), so
  reading the dashboard is always free.
- **Verify with `node scripts/check-no-analytics-pollution.mjs`** (fails if a
  browser-driving script under `scripts/` forgot the flag) and
  **`node scripts/perf/verify-analytics-optout.mjs`** (proves `js/analytics.js`
  still honours it, with a control case so a silent no-op cannot pass). The
  second refuses to run against production.

### Playwright MCP — output directory (NEVER write to repo root)

Playwright MCP is configured in `.mcp.json` to write all artifacts (screenshots, traces, sessions) into `.playwright-mcp/`, which is gitignored. **Never** save MCP-generated files at the repo root — and never pass an absolute path or a bare filename like `"foo.png"` to `browser_take_screenshot` that would land in the project root. If you need a tracked screenshot (e.g. for a design audit), explicitly write it under `docs/audit-*/screenshots/`. Repo root has a blanket `/*.png /*.jpg /*.jpeg /*.gif /*.webp` ignore rule — even an accidental drop won't be committed, but it also won't appear in `git status`, so be deliberate.

No build, no dependencies, no package.json. All JS uses ES modules (`type="module"`).

## No third-party resources — project-wide rule

**No page may load anything from an origin we don't own.** No Google Fonts, no
CDN scripts, no remote stylesheets or images, and no runtime-injected
`<link>`/`<script>` pointing off-origin. This applies to the internal design
tools (`banner-poc`, `design-lab`, `logo-editor`, `design-catalogue`) exactly
as much as to the production pages. The only permitted off-origin destination
is the app's own Supabase backend.

Two reasons, both of which have already bitten this project: a third-party
`<link>` discloses every visitor's IP address and user-agent to that company,
and a render-blocking one in `<head>` measured **~324ms of blank screen** on a
cold load — in front of the loading screen whose whole job is to cover latency.

- **Fonts** are self-hosted in `assets/fonts/`, declared by `css/fonts.css`.
  That CSS is **generated — never hand-edit it**. To add a family, add its spec
  to `SPECS` in `scripts/fetch-fonts.js`, run `node scripts/fetch-fonts.js`,
  and commit the woff2 files plus the regenerated CSS.
- **Libraries** get vendored into `vendor/` (as `html2canvas-pro` already is),
  never referenced from a CDN.
- **Verify with `node scripts/check-no-external.js`** — it fails with exit 1
  and lists every offending file:line. Run it before committing anything that
  touches a page's `<head>` or adds a dependency. This regression is invisible
  in code review and only shows up in a network panel, which is why the check
  exists.

## The loading screen (splash)

Designed in `splash-poc.html` (the Splash Editor), rendered by
`js/utils/splash.js` + `css/splash.css`. Its design is saved as **two files
that must stay in step**:

- `assets/splash/splash-config.json` — the full config, fetched at runtime.
- `assets/splash/splash-vars.css` — **generated, never hand-edit**. Emits the
  visual half as `--sp-*-cfg` properties on `:root`, and is linked in every
  page's `<head>`.

The CSS exists because the JSON fetch measured **~330ms**: long enough for the
splash to appear in `css/splash.css`'s fallback design and then visibly
restyle itself. A loading screen that changes design while the user watches is
the flicker the whole rewrite set out to remove. So the `<link>` must stay in
`<head>`, and the fallbacks in `css/splash.css` are a safety net for a missing
stylesheet — not the design.

The editor's **Save to site** writes both. After editing the JSON by hand, run
`node scripts/build-splash-css.js` (`--check` verifies they match).

## URL contract

**The iron rule: a slug in the URL is ALWAYS the visible label, lowercased,
with spaces → hyphens. No exceptions, no mapping tables.** `Charts` →
`?tab=charts`. `Upload CSV` → `#…/upload-csv`. If a slug comes out too long,
**shorten the label, not the slug** — the URL is the thing a user reads aloud
and pastes into WhatsApp, and a URL that disagrees with the tab it opens is a
URL nobody can trust. The one function that performs the transform is
`tabSlug()` in `js/utils/queryString.js`; call sites **derive** their slug from
it rather than declaring both halves separately, so a label rename can't leave a
stale slug behind. This is not hypothetical: `?tab=insights` opened a tab called
Charts, `?tab=leaderboard` opened Leaders, and `#…/rounds` opened the Round
Editor, each written by hand as a pair that reads fine on its own line.

- **Main tabs push, second-tier state replaces.** `mountAppTabs`
  (`js/render/appTabs.js`) writes the active tab with `pushState` on a click,
  arrow key or hotkey and listens for `popstate`, so Back returns to the previous
  tab instead of leaving the page. Everything below tab level — filters, sort,
  ranges, accordions — uses `replaceState`: a filter is a refinement of where you
  already are, not a place you went.
- **The default is always omitted.** The first tab and the default admin view
  carry no param and no hash. A URL names only what differs from the default, so
  the shortest URL is always the canonical entry point.
- **Renames get a silent alias, never a redirect page.** `aliases: { insights:
  'charts' }` on the `mountAppTabs` call: the old slug activates the right tab
  and the URL is normalised with `replaceState`, so an already-shared link keeps
  working without polluting Back. Aliases are permanent and cost one line.
- **Never round-trip a query string through `URLSearchParams` to write one
  param.** Its serialiser encodes a space as `+` while `encodeURIComponent`
  (what `helpers.js` `leagueUrl()` uses) emits `%20`, so editing one param
  silently rewrote every other one — `?league=July%20 2026` became
  `?league=July+2026`, giving one league two different URLs depending on whether
  the page happened to have tabs. Use `spliceQueryParam()` from
  `js/utils/queryString.js`, which edits one param and leaves every other byte
  alone. Reading via `URLSearchParams` is fine; the asymmetry is serialise-only.
- **Boolean flags are valueless and read by presence.** `?edit`, `?preview` —
  never `?edit=1` or `?preview=true`. Read them with `hasUrlFlag()` from
  `js/utils/queryString.js`, which also honours the retired valued forms so old
  links keep working. The two used to disagree (`preview` read with `.has()`,
  `edit` with `=== '1'`), which meant `?preview=false` switched preview mode
  **on**.
- **Verify with `node scripts/check-url-contract.js`** — it fails with exit 1
  and lists every offending file:line. It checks each `mountAppTabs` tab set and
  its aliases, bans slug⇄panel mapping objects outright, checks the admin's view
  and nav tables, and validates every literal `?tab=` in `js/` and the HTML pages
  against the live slug set. Run it after touching any tab label, tab id, or nav
  slug.

Deliberately NOT in the URL today (each would be second-tier `replaceState`
state if added): league-type and match-length filters, table sort column and
direction, the H2H opponent on `player.html`, the dashboard's snapshot selector,
and accordion open state outside the admin's Match Results tabs.

## Key Conventions

- URL slugs = the visible label, kebab-cased — see § URL contract above; enforced by `scripts/check-url-contract.js`
- League IDs in URLs = folder names under `leagues/` (e.g., "Shabi Israel April 2026")
- `landing_settings.json` `DisplayOrder` titles use " - " (dash), folder names use " " (space) — `landingPage.js` handles the mapping
- Default flag is IL (Israel); custom flags per player are in `league_params.json` → `CustomFlags`
- League types (`LeagueType` in `league_params.json`): `"doubling"` (default — WinRate ranking), `"regular"` (wins-only, no PR/Luck), `"ubc"` (PR Wins + Points system). Config logic lives in `compute/leagueTypes.js`
- Rankings sort varies by league type: Doubling = WinRate DESC then MeanPR ASC; Regular = Wins DESC; UBC = Avg Points DESC then MeanPR ASC

## Plan Mode

When in Plan Mode, present the plan concisely and focused — use short bullet points, avoid lengthy explanations, and get straight to the actionable steps.
