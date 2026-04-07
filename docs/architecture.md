# Architecture

## File Structure

```
/
├── index.html                   Landing page (league list)
├── dashboard.html               League Dashboard (Phase F — default entry from index)
├── league.html                  League summary (ranked player table — full view)
├── player.html                  Player detail (match history)
├── start.bat                    Windows launcher (server + browser)
│
├── css/
│   ├── variables.css            Design tokens (colors, spacing, fonts)
│   ├── layout.css               Page structure, containers, responsive
│   ├── components.css           Tables, badges, medals, flags, pills
│   ├── dashboard.css            Dashboard cards, controls, charts, context menu
│   └── theme.css                Data-driven color utility classes
│
├── js/
│   ├── data/
│   │   ├── csvParser.js         Parse CSV → match objects (incl. round tagging)
│   │   └── leagueLoader.js     Fetch league data (CSV + JSON + match history)
│   ├── compute/
│   │   ├── stats.js             Per-player statistics
│   │   ├── rankings.js          Sorting, ranks, skill levels
│   │   ├── matchHistory.js      Per-match timeline (load/merge/asOf/dates)
│   │   └── colorScale.js        Color gradient calculations
│   ├── render/
│   │   ├── landingPage.js       Render league list on index.html
│   │   ├── dashboardPage.js     Render League Dashboard (F1–F4)
│   │   ├── playerBarChart.js    Interactive Canvas bar chart with tooltips
│   │   ├── playerNameInteraction.js  Player name left/right click + context menu
│   │   ├── leaguePage.js        Render league table on league.html
│   │   └── playerPage.js        Render match history on player.html
│   └── utils/
│       └── helpers.js           URL params, formatting, flag paths
│
├── leagues/
│   ├── leagues_order.json       Display order of leagues (source of truth)
│   └── <League Name>/
│       ├── leaguedata.csv       Match data
│       ├── league_params.json   League configuration (incl. StartDate, LeagueType)
│       ├── manual_overrides.json (optional) Admin manual edits
│       └── match_history.json   (optional) Per-match timeline (Phase F)
│
└── assets/
    ├── flags/                   Country flag PNGs (IL, TZ, RU, BE, UN)
    └── logo/                    logo.png
```

## SPA-Like Navigation

The app uses 3 static HTML files with **URL query parameters** for routing — no framework, no router library.

| Page | URL Pattern | Purpose |
|------|------------|---------|
| `index.html` | `/` | Lists all leagues with status and leader. Clicking a league opens its **Dashboard**. |
| `dashboard.html` | `?league=Shabi Israel April 2026` | League Dashboard — summary cards, historical view, rounds, player insights (Phase F) |
| `league.html` | `?league=Shabi Israel April 2026` | Full ranked player table for one league (reached via "Open full table" from dashboard) |
| `player.html` | `?league=...&player=Idan1986` | Head-to-head match history for one player |

Each HTML file loads a single JS module (`type="module"`) that reads the query params, fetches data, computes stats, and renders the DOM.

## JavaScript Module Layers

The JS code is organized in 4 layers with strict dependency direction: **Data → Compute → Render**, with **Utils** shared across all layers.

### Data Layer (`js/data/`)

| Module | Key Exports | Purpose |
|--------|------------|---------|
| `csvParser.js` | `parseCSV()`, `getAllPlayers()`, `getPlayerMatches()` | Parse raw CSV text into match objects. Filters headers, Bye entries, and all-zero rows. Generates normalized player-centric match records including unplayed opponents. |
| `leagueLoader.js` | `loadLeagueOrder()`, `loadLeague()`, `loadLeagueParams()`, `loadLeagueMatches()`, `loadAllLeagueParams()` | Async HTTP fetching of league data. Handles URL encoding for folder names with spaces. Parallel loading via `Promise.all`. |

### Compute Layer (`js/compute/`)

| Module | Key Exports | Purpose |
|--------|------------|---------|
| `stats.js` | `computeAllStats()` | Calculates per-player: games, wins, losses, winRate, meanPR, highestPR, lowestPR, oppMeanPR, luck. Returns a `Map<playerName, statsObject>`. |
| `rankings.js` | `buildRankings()`, `computeAverages()`, `computeMatchStats()` | Sorts by winRate desc → meanPR asc. Assigns rank numbers and skill level strings. Computes league-wide averages and played/total match ratio. |
| `colorScale.js` | `colorForValue()`, `colorForValueInverted()`, `colorForGames()`, `colorForLevel()` | Generates `rgb(...)` color strings from data values. Red→Yellow→Green gradient with normal and inverted modes. Discrete hex colors for skill levels. |

### Render Layer (`js/render/`)

| Module | Key Exports | Purpose |
|--------|------------|---------|
| `landingPage.js` | `renderLandingPage()` | Loads all leagues, finds rank-1 leader for each, renders table with status pills and leader info. Handles title-to-folder name mapping. |
| `leaguePage.js` | `renderLeaguePage()` | Most complex renderer. 9-column sortable table with medals, color-coded cells, bold best/worst values, sticky averages row, and stats row. |
| `playerPage.js` | `renderPlayerPage()` | 8-column sortable table showing head-to-head results. Bold better values in pairs. Unplayed matches shown as grayed rows. |

### Utils Layer (`js/utils/`)

| Module | Key Exports | Purpose |
|--------|------------|---------|
| `helpers.js` | `getQueryParam()`, `formatPercent()`, `formatNumber()`, `flagUrl()`, `leagueUrl()`, `playerUrl()`, `getFlagCode()` | Shared utilities for URL parameter parsing, number formatting, flag/league/player URL construction, and custom flag resolution (default: IL). |

## CSS Responsibilities

| File | Scope |
|------|-------|
| `variables.css` | Design tokens only — all `--custom-properties` for colors, fonts, spacing, radii, shadows |
| `layout.css` | Page structure — containers (max-width 1100px), header, back-link, table wrapper, loading/error states, responsive breakpoint (768px) |
| `components.css` | UI components — table styling, sticky headers, player cells, flags, medal badges, rank row highlights, status pills, avg/stat rows, result classes, level cells |
| `theme.css` | Data-driven classes — `.val-best`, `.val-worst`, `.val-better` (currently minimal; most color logic is inline via JS) |