# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shabi Israel is a chess league statistics web app. It loads CSV match data client-side, computes player statistics (win rate, PR, luck, rankings), and renders interactive HTML pages with sortable tables and color-coded stats.

No build step — pure vanilla HTML/CSS/JS running in the browser. Deployed on GitHub Pages.

## Architecture

3 HTML pages with SPA-like navigation via query params:
- `index.html` — Landing page listing all leagues
- `league.html?league=<id>` — League summary with ranked player table
- `player.html?league=<id>&player=<name>` — Player match history

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

Serve locally (ES modules require a server). **Default port: 8090** (we standardised off 8080 because other tools collide on it).

### Dev server — reuse, don't relaunch

The `http-server` process is OS-level, independent of any Claude window. If a sibling window already started it, every other window should reuse it. Before starting a server, always probe:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html
```

- `200` → server is up, reuse `http://localhost:8090/` as-is. Do **not** relaunch.
- anything else → start it once in the background:
  ```bash
  npx http-server -p 8090 --cors -c-1
  ```
  Run with `run_in_background: true` so it survives the turn. A follow-up 200 on the probe confirms bind success even if the bash task reports a non-zero exit (harmless EADDRINUSE race when the port is already held).

Never kill a running `http-server` just to "start clean" — other windows (and the user's own browser tabs) may depend on it.

### Playwright MCP — shared Chrome profile

Playwright MCP uses a single Chrome profile at `C:\Users\User\AppData\Local\ms-playwright\mcp-chrome-*`. Only one Claude window can drive it at a time; a second concurrent call returns *"Browser is already in use … use --isolated"* (we can't pass `--isolated` from the MCP tool). When this happens:
1. Do other work (code edits, static verification) first.
2. Retry the browser call later — the sibling window releases the lock when it finishes or when its page is closed.
3. If the wait is long, use `ScheduleWakeup` to retry in ~90–180 s rather than busy-polling.

Pages already navigated in the shared browser persist across windows — a new window's first `browser_navigate` just reuses the same tab.

No build, no dependencies, no package.json. All JS uses ES modules (`type="module"`).

## Key Conventions

- League IDs in URLs = folder names under `leagues/` (e.g., "Shabi Israel April 2026")
- `landing_settings.json` `DisplayOrder` titles use " - " (dash), folder names use " " (space) — `landingPage.js` handles the mapping
- Default flag is IL (Israel); custom flags per player are in `league_params.json` → `CustomFlags`
- League types (`LeagueType` in `league_params.json`): `"doubling"` (default — WinRate ranking), `"regular"` (wins-only, no PR/Luck), `"ubc"` (PR Wins + Points system). Config logic lives in `compute/leagueTypes.js`
- Rankings sort varies by league type: Doubling = WinRate DESC then MeanPR ASC; Regular = Wins DESC; UBC = Avg Points DESC then MeanPR ASC

## Plan Mode

When in Plan Mode, present the plan concisely and focused — use short bullet points, avoid lengthy explanations, and get straight to the actionable steps.
