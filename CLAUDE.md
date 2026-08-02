# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## v2 rebuild in progress — see `v2/`

A parallel clean-slate rebuild lives under `v2/` and is the end-state target. Plan: `C:\Users\User\.claude\plans\sharded-gliding-locket.md`. While the rebuild is in progress:

- **v1 (current production)** at `css/`, `js/`, `table-lab/`, `*.html` keeps running. Serve via `npx http-server -p 8090 --cors -c-1` from repo root → `http://localhost:8090`.
- **v2 (rebuild)** at `v2/` uses Vite. `cd v2 && npm install && npm run dev` → `http://localhost:5173`.
- Both versions share `leagues/` at the repo root. v1 reads via `fetch('leagues/...')`. v2 reads via `fetch('/data/...')` proxied by Vite's `shared-data-proxy` plugin (see `v2/vite.config.js`).
- **Admin writes**: avoid simultaneous admin editing in both versions. v2 admin is read-only until Phase 8 of the rebuild plan.
- **Bug fixes during rebuild**: any fix landing in v1 must also be re-applied to the corresponding v2 destination. Track in `v2/docs/MIGRATION-FROM-V1.md`.
- **Cutover**: single scripted commit via `bash v2/scripts/migrate-v1-to-v2.sh`. Archives v1 to `_archive_v1/`, promotes `v2/*` to repo root. Rollback = `git revert HEAD`.

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

Serve locally (ES modules require a server). **Preferred port: 8090** (we standardised off 8080 because other tools collide on it), but don't fixate on it — see below.

### Dev server — reuse if already up, else claim the next free port

The `http-server` process is OS-level, independent of any Claude window. If a sibling window already started one on 8090, every other window should reuse it. Before starting a server, always probe:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html
```

- `200` → server is up, reuse `http://localhost:8090/` as-is. Do **not** relaunch.
- anything else → try to start it on 8090; if that port is already held by something that isn't this app (EADDRINUSE, or a 200 comes back but not from this app's index.html), walk up sequentially (8091, 8092, …) until one binds cleanly:
  ```bash
  npx http-server -p 8090 --cors -c-1
  ```
  Run with `run_in_background: true` so it survives the turn. A follow-up 200 probe on the chosen port confirms bind success even if the bash task reports a non-zero exit.

Never kill a running `http-server` just to "start clean" — other windows (and the user's own browser tabs) may depend on it. This reuse-or-increment pattern applies to every project, not just this one.

### Playwright MCP — isolated per session (parallel-safe)

`.mcp.json` passes `--isolated` to the Playwright MCP server, so each Claude window gets its own in-memory browser profile instead of sharing one Chrome profile. This means multiple windows/sessions can drive Playwright MCP at the same time without the old "Browser is already in use" lock.

Trade-off: an isolated profile does **not** persist logins/cookies across sessions — each session starts logged out. For BGStudio automation, log in fresh each session (see `reference_mcp_credentials` memory for the test account) rather than expecting a shared authenticated session.

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

## Key Conventions

- League IDs in URLs = folder names under `leagues/` (e.g., "Shabi Israel April 2026")
- `landing_settings.json` `DisplayOrder` titles use " - " (dash), folder names use " " (space) — `landingPage.js` handles the mapping
- Default flag is IL (Israel); custom flags per player are in `league_params.json` → `CustomFlags`
- League types (`LeagueType` in `league_params.json`): `"doubling"` (default — WinRate ranking), `"regular"` (wins-only, no PR/Luck), `"ubc"` (PR Wins + Points system). Config logic lives in `compute/leagueTypes.js`
- Rankings sort varies by league type: Doubling = WinRate DESC then MeanPR ASC; Regular = Wins DESC; UBC = Avg Points DESC then MeanPR ASC

## Plan Mode

When in Plan Mode, present the plan concisely and focused — use short bullet points, avoid lengthy explanations, and get straight to the actionable steps.
