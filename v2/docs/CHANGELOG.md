# v2 Changelog

Phase-by-phase rebuild history. Each commit corresponds to a phase or a sub-task. Full plan: [`PLAN.md`](PLAN.md).

## Phase 0 — Bootstrap

- Created `v2/` directory at repo root.
- Initialized `package.json` with Vite + Stylelint + ESLint + Vitest + Playwright as devDependencies.
- Wrote `vite.config.js` with multi-page entries and `shared-data-proxy` plugin serving `../leagues` at `/data`.
- Wrote `.stylelintrc.json` enforcing token-only typography and forbidden hex colors outside tokens.
- Wrote `.eslintrc.json`, `.editorconfig`, `.gitignore`.
- Scaffolded complete directory tree: `src/{tokens,themes,base,primitives,components,tables,data,compute,pages,tools,utils,i18n,entry}`, `public/{icons,fonts,data}`, `docs/`, `tests/`, `scripts/`.
- Wrote placeholder HTML pages for all 6 production pages + 4 tools.
- Wrote per-page entry stubs in `src/entry/*.entry.js`.
- Wrote `src/index.css` declaring the 10-layer cascade order.
- Wrote helper scripts: `data-sync.js`, `parity-runner.js`, `grep-gates.sh`, `inventory-sync.js`, `icon-sprite-build.js`, `migrate-v1-to-v2.sh` (all functional or stubbed per phase).
- Wrote `README.md`, `docs/MIGRATION-FROM-V1.md` (mapping skeleton), `docs/PARITY-LOG.md`, `docs/CHANGELOG.md`.
- Updated root `CLAUDE.md` and `.gitignore` to acknowledge `v2/`.

**Verification**: directory tree confirmed; configs syntactically valid; `npm install` run 2026-05-27 (235 packages); `npm run dev` boots on `:5173` (HTTP 200, ready in 339 ms).

---

## Phase 1 — Tokens, themes, base

Foundation layer: every later phase consumes only what is declared here.

### Tokens (`src/tokens/`)

- `color.css` — raw palette (`--c-*`). 44 named colours grouped by family: neutrals (slate scale), brand blue, result greens/reds, medal golds/silvers/bronzes, league-type accents (violet/teal/mint), and chart-overlay alphas.
- `typography.css` — 7 fluid size tokens (`--fs-micro` → `--fs-display`) on the font-small slope `clamp(0.765·M·rem, 0.600·M·rem + 0.835·M·vw, M·rem)`, 4 weight tokens (regular/medium/subheading/heading = 400/500/600/700), 2 line-height tokens, font-family tokens.
- `icon.css` — 4 icon sizes in em (`--icon-xs/sm/md/lg`) so icons scale with surrounding text.
- `space.css` — 6-step spacing scale (4 → 64 px), mirrors v1's `--space-*` exactly.
- `radius.css` — 4 corner-radius tokens.
- `shadow.css` — 3 elevation shadows; dark themes override for visibility.
- `motion.css` — NEW in v2: 3 durations + 3 easing curves. v1 used ad-hoc `0.2s`/`0.3s` literals across component CSS.
- `breakpoints.css` — 5 viewport reference values declared as custom properties (used as documentation; consumed as literals in `@media` rules until PostCSS `@custom-media` is added).

### Themes (`src/themes/`)

- `_theme.css` — semantic colour contract + default (light) theme on `:root`. 37 `--color-*` / `--header-*` / `--chart-*` / `--lt-*` variables, byte-identical to v1's `css/variables.css`.
- `dark.css`, `beige.css`, `nature.css`, `vegas.css`, `casino.css`, `rainbow.css`, `x22.css` — 7 `[data-theme="*"]` override blocks ported from v1's `css/themes.css`. Theme-specific component decorations (e.g. Vegas roulette stripes, Rainbow card border colours, X22 backgammon triangle header) deferred to Phase 3 when those components are built.

> **Plan correction**: PLAN.md §1 listed fictional themes (`ocean, sunset, forest, monochrome`). The real v1 themePicker has 8: `default/dark/beige/nature/vegas/casino/rainbow/x22`. Phase 1 ports the real list; PLAN.md theme references in later phases will be updated accordingly.

### Base (`src/base/`)

- `reset.css` — minimal modern reset (box-sizing, margin/padding zero, img/svg display block, list-style none, anchor inherit).
- `root.css` — fluid `html` font-size `clamp(0.8125em, calc(0.75em + 0.3vw), 0.9375em)` (mirrors v1 exactly), `body` defaults via token references.
- `elements.css` — h1–h6 / p / table / form-control defaults via tokens; `strong, b { font-weight: inherit }` per [docs/TYPOGRAPHY.md](../../docs/TYPOGRAPHY.md) §4.3.
- `focus.css` — `:focus-visible` outline using `--color-accent`.
- `a11y.css` — `.sr-only` utility + `prefers-reduced-motion` reset. Added to stylelint's `declaration-no-important` allowlist (`!important` is the canonical idiom for the reduced-motion override).

### Wiring (`src/index.css`)

Imports all 8 token files, 8 theme files, 5 base files in cascade-order. Layer declarations inside each individual file place rules in the correct `@layer` regardless of import order; the @layer cascade `reset, tokens, themes, base, primitives, components, tables, pages, utilities, overrides` is the authority.

### Tools — designCatalogue (`src/tools/designCatalogue/`)

Built as a working Phase 1 reference: every token rendered as a swatch / sample, with a live 8-theme switcher. 81 colour swatches (37 semantic + 44 raw), 28 typography rows (7 sizes × 4 weights), 4 icon sizes, 6 space bars, 4 radius shapes, 3 shadow cards. Theme selection persists via `localStorage["dc-theme"]`.

### Verification

Playwright MCP run 2026-05-27 at 4 (theme × viewport) combinations: default@1440, dark@1440, dark@360, vegas@720. All token values resolve byte-identical to v1 source. Typography clamp math verified on `--fs-micro/--fs-small/--fs-2xl` — ratio invariance confirmed. Full results in [PARITY-LOG.md](PARITY-LOG.md).

### Stylelint config

Added `src/base/a11y.css` to the `declaration-no-important` override list (one accepted exception for the prefers-reduced-motion idiom).

---

## Phase 2 — Primitives

Ten atomic primitives, each in its own folder with `<name>.css` (token-only, lives in `@layer primitives`) + `<name>.js` (single `render(props)` export).

### Primitives (`src/primitives/`)

| Primitive | CSS classes | Variants |
|---|---|---|
| **Flag** | `.flag`, `.flag--{sm,md,lg,xl}` | Em-height image; default code `IL`. Resolves to `/assets/flags/{CODE}.png` via the new asset proxy. |
| **Icon** | `.icon`, `.icon--{xs,sm,md,lg}`, `.icon--solid` | Inline SVG; 10 built-in glyphs (`clock`, `search`, `chevron-down/right`, `check`, `x`, `user`, `star`, `trophy`, `settings`, `info`); `currentColor` stroke. |
| **Badge** | `.badge`, `.badge--{gold,silver,bronze,accent,neutral}`, `.badge--circle`, `.badge--{sm,md,lg}` | Replaces v1 `.medal` + ad-hoc count markers. |
| **Pill** | `.pill`, `.pill--{running,completed,doubling,regular,ubc,accent}`, `.pill--uppercase`, `.pill--{sm,md,lg}` | Replaces v1 `.status-pill` + `.league-type-pill`. |
| **Button** | `.btn`, `.btn--{primary,secondary,ghost,danger}`, `.btn--{sm,md,lg}`, `.btn--{block,icon,pill}` | Renders `<button>` or `<a>` when `href` provided. |
| **Link** | `.link`, `.link--{quiet,strong,muted}` | Four variants covering accent-underline, table-link (quiet), heading-link (strong), and muted. |
| **Avatar** | `.avatar`, `.avatar--{sm,md,lg,xl}`, `.avatar__dot`, `.avatar__dot--{idle,away}` | Image or auto-initials fallback; optional online/idle/away status dot. |
| **Tooltip** | `.tooltip-host`, `.tooltip-host--{top,right,bottom,left}`, `.tooltip-pop` | CSS-only on `:hover` + `:focus-within`; `attach(hostEl, opts)` exposes programmatic open/close. |
| **Chip** | `.chip`, `.chip--{accent,muted,selected}`, `.chip--{sm,md,lg}`, `.chip__close`, `.chip__label` | New in v2 — filter / multi-select tag with optional `✕` remove control. |
| **FormField** | `.field`, `.field--{inline,error}`, `.field__label`, `.field__input`, `.field__select`, `.field__textarea`, `.field__hint`, `.field__error`, `.field__required` | Replaces ad-hoc admin input styles in `css/admin.css` + `.matchup-search-input`. |

### Wiring

- `src/primitives/index.css` aggregates every primitive stylesheet; `src/index.css` imports it under `@layer primitives`.
- `src/entry/designCatalogue.entry.js` imports each primitive's `render()` and populates one section per primitive in `catalogue.html`.
- `vite.config.js` gains a second sirv middleware (`shared-assets-proxy`) serving `../assets` at `/assets`, so v2 references the same flag PNGs v1 uses (no copy/duplicate).

### designCatalogue extension

`catalogue.html` adds ten new `<section>` blocks after the Phase 1 token sections, each with a flex row of `.dc-sample` cards. Hovering catalogue Buttons in the Tooltip section now demonstrates all four tooltip placements live.

### Verification

Structural verification: every primitive stylesheet served correctly by Vite, asset proxy resolves `/assets/flags/IL.png` → HTTP 200, catalogue HTML/CSS bundle includes all 10 primitive mount points. Visual screenshot pass deferred (MCP browser was locked by a sibling Claude window). Full notes in [PARITY-LOG.md](PARITY-LOG.md) under *Phase 2 — Primitives*.

---

## Phase 3 — Components

Twenty composed components — each in its own folder with `<name>.css`
(rules inside `@layer components`) + `<name>.js` (one or more named
exports). Every component is a thin renderer over the Phase 2 primitives
plus token-only CSS; no bare hex/font-size literals leak outside the
deliberate decorative gradient stops (tier ribbons / theme swatches),
which carry the same hex pairs v1 used so the visual identity is
preserved.

### Cell-level (8)

| Component       | v1 source dissolved                                                     | Composition |
|-----------------|-------------------------------------------------------------------------|-------------|
| **PlayerCell**  | `td.player-cell` + inline `.flag` + `.title-abbr[ -champ]`               | Flag primitive + name `<a>` + optional title badges |
| **StatusChip**  | `.pg-v12-statuschip` + lh status pill                                    | Token-only span with glowing `currentColor` dot |
| **TypePill**    | `.league-type-pill.type-{doubling,regular,ubc}`                          | Pill primitive (variant + uppercase) |
| **MedalRow**    | `tr.rank-gold/silver/bronze` background tints                            | className helper `classNameForRank(rank)` |
| **RankBadge**   | `.medal-gold/silver/bronze` + plain numeric                              | Badge primitive (`circle` + variant) |
| **ScoreCell**   | `td` + inline `style="color:rgb(...)"` driven by colorScale              | Compute hook → inline RGB; flips on `inverted` flag |
| **FilterPill**  | NEW in v2                                                                | Chip primitive + click/keyboard toggle |
| **ChartTooltip**| `.chart-info-panel` + `.cip-{title,row,item,k,v}`                        | `setItems(title, items)` API |

### Chrome (6)

| Component       | v1 source dissolved                          | Notes |
|-----------------|----------------------------------------------|-------|
| **Breadcrumbs** | `.breadcrumbs` chevron-segment trail         | Last crumb auto `breadcrumbs__crumb--current` |
| **SearchBox**   | `.nav-search input + .nav-search-results`    | Standalone — caller wires data via `onQuery` |
| **Navigation**  | `.site-nav` + skip-link + leagues dropdown   | Composes SearchBox; data injected from `data/` |
| **ThemePicker** | `.theme-picker` floating bottom-right        | Lists v2's 8 themes (`default/dark/beige/nature/vegas/casino/rainbow/x22`); persists to `localStorage["shabi-theme"]` |
| **AdminButton** | `.admin-button` floating bottom-left         | Click handler owned by caller — modal flow lives in Phase 8 admin page |
| **ExportButton**| `.img-export-btn`                             | Wraps Button primitive + loading state |

### Hero / visual (5)

| Component         | v1 source dissolved                                          | Variants |
|-------------------|--------------------------------------------------------------|----------|
| **LeagueHero**    | `.lh13-card` + `.lh16-hero`                                  | `variant: "v13" \| "v16"` |
| **PlayerHero**    | `.pg-v7-card` + `.pg-v12-hero` + watermark layers            | `variant: "v7" \| "v12"`, `titles[].tier`, optional `photoPath` |
| **PlayerBarChart**| `js/render/playerBarChart.js` Canvas + `.chart-panel`         | Now embeds ChartTooltip; theme-aware repaint on `themechange` |
| **ColorScale**    | `js/compute/colorScale.js` + `.color-scaled` filter           | Math (`colorForValue` / `Inverted` / `Games` / `Level`) + visual demo strip |
| **Splash**        | `js/utils/splash.js` + `.logo-splash` overlay                 | 500 ms show-delay; cancelled if load finishes first |

### Export (1)

| Component            | v1 source dissolved                                                                     |
|----------------------|-----------------------------------------------------------------------------------------|
| **ExportTableImage** | Three near-duplicate exporters in `leaguePage.js` + `dashboardPage.js` (B6a/B6b/B6c)    |

`exportToImage({ source, filename, title?, subtitle? })` strips sticky
positioning from a clone, appends the "Built by Guy Eliyahu" credit, and
calls `html2canvas` (newly installed npm dependency, dynamically imported
so pages that never export pay zero bundle cost).

### Wiring

- `src/components/index.css` aggregates the 18 component stylesheets in
  display order (cell → chrome → hero → visual). Component CSS files all
  declare under `@layer components`, so import order is cosmetic.
- `src/index.css` adds the components layer to the cascade between
  `primitives` and `tables`.
- `src/entry/designCatalogue.entry.js` imports each component's
  `render()` and populates one section per component plus a final
  combined section for floating chrome. ThemePicker + AdminButton mount
  to `document.body` so the catalogue itself uses them.
- `catalogue.html` gains a *Phase 3 — Components* divider and 16 new
  `<section>` blocks; catalogue.css adds `.dc-table` + `.dc-hero-stack`
  + `.dc-hero-card` layout helpers.

### Dependencies

`html2canvas@^1.x` added to v2 `package.json` to back ExportTableImage.
Dynamic import keeps the production bundle slim — `import("html2canvas")`
inside `loadHtml2Canvas()` only fetches the chunk when a caller actually
invokes the exporter.

### Verification

Live in browser via Vite at `http://localhost:5173/src/tools/designCatalogue/catalogue.html`:

- All 39 Phase 3 source URLs serve HTTP 200.
- DOM probe confirms every sample container has children: 15/15 sample
  containers populated; PlayerCell renders × 9 (5 demo rows + 4
  cell-only), StatusChip × 7 (4 variants + 2 hero embeds), LeagueHero
  × 2 (V13 + V16), PlayerHero × 2 (V7 + V12), Breadcrumbs × 1,
  PlayerBarChart × 1 (canvas resolved + drawn).
- Theme switch between default → dark → vegas at 1440 / 720 viewports —
  every component re-tints without console errors (the only console
  entry is the harmless missing favicon, identical to Phase 1).
- Screenshots saved under `docs/audit-phase3/screenshots/` for
  `default-1440`, `dark-1440`, `vegas-720`.

Full notes in [PARITY-LOG.md](PARITY-LOG.md) under *Phase 3 — Components*.

---

## Phase 4 — Data + Compute layers

Pure, framework-free port of v1's data/, compute/, and utils/ folders.
No DOM, no rendering — everything in this phase is exercised by unit
tests under `v2/tests/unit/`.

### Data (`src/data/`)

| Module | Source | Notes |
|---|---|---|
| `csvParser.js`     | v1 `js/data/csvParser.js`     | Direct port. Splits each header row into a new round; -All variants keep unplayed (all-zero) rows. `getPlayerMatches()` normalises self vs. opponent regardless of column order. |
| `leagueLoader.js`  | v1 `js/data/leagueLoader.js`  | Direct port. `LEAGUES_BASE` changed from `"leagues"` (relative path) to `"/data"` so Vite's `shared-data-proxy` (see `vite.config.js`) resolves the shared `../leagues` tree. `setLeaguesBase()` retained for tests / alternate deploys. Override-resolver `applyOverrides()` extracted as a named export so it's unit-testable in isolation. |
| `playersMetadata.js` | v1 `js/data/playersMetadata.js` | Direct port. Path moved to `/data/players_metadata.json`. Single-load cache (`_cache`) preserved. |
| `titleConstants.js` | v1 `js/data/titleConstants.js` (data half) | The TIER_COLORS map + HTML-emitting helpers (`getTitleBadgesHtml`, `getTitleAbbreviationsHtml`, `bmabSelectOptionsHtml`) were stripped — components own those visuals now. Remaining: BMAB_TITLES, getBmabInfo, getChampionshipTooltip/Info, getHighestTier, hasTitles, compareTitlePriority, getFullTitleDescription, COUNTRIES. |
| `titleStyleMap.js` | NEW in v2 | Declarative join table mapping title tier → component CSS class names (TIER_ABBR_CLASS, CHAMP_ABBR_CLASS, TIER_RIBBON_CLASS, CHAMP_RIBBON_CLASS, NAME_TIER_CLASS) for PlayerCell + PlayerHero to consume without referencing colour literals. |
| `matchHistory.js`  | v1 `js/compute/matchHistory.js` (moved) | Moved from compute/ to data/: this module is dominated by I/O (`loadMatchHistory` fetches JSON) and a merge function; only `getMatchesAsOf` / `getUpdateDates` are pure derivation. The grouping is now consistent — every fetch helper lives under data/. |

### Compute (`src/compute/`)

| Module | Source | Notes |
|---|---|---|
| `stats.js` | v1 `js/compute/stats.js` | Direct port. Extracted private helpers `mean()`, `stdDev()`, `emptyStats()`, `computePlayerStats()` to keep `computeAllStats()` readable. Behaviour identical: technical (null-PR) matches count for games/wins/losses but are excluded from PR/luck averages and PR-wins; technical-draw rows count as games but not wins/losses. |
| `rankings.js` | v1 `js/compute/rankings.js` | Direct port. `LEVELS` band table, `getLevel()`, `buildRankings()` config-driven sort with null-handling, optional H2H tiebreak via `buildH2H()`, plus `computeAverages()` / `computeMatchStats()`. |
| `leagueTypes.js` | v1 `js/compute/leagueTypes.js` | Direct port. Three configs (`doubling` / `regular` / `ubc`) + a fallback to `doubling` for unknown / missing types. |

### Utils (`src/utils/`)

| Module | Owns |
|---|---|
| `urlParams.js`  | `getQueryParam`, `leagueUrl`, `dashboardUrl`, `playerUrl`, `playerGeneralUrl` |
| `formatting.js` | `formatPercent`, `formatNumber`, `thLabel`, `parseLeagueDate`, `getLeagueYear` |
| `flagUrl.js`    | `flagUrl` (returns `/assets/flags/<CODE>.png` to ride the shared-assets-proxy), `getFlagCode` |

`appendExportCredit()` from v1's helpers.js was already absorbed by
`components/ExportTableImage` in Phase 3 (private inline `appendCredit`),
so it intentionally does not appear in utils.

### Tests (`v2/tests/unit/`)

Eight Vitest files, 64 tests total. The suite covers:

- `csvParser` — 4 parser variants, Bye-skipping, round counting,
  player roster, `getPlayerMatches` self/opp normalisation, unplayed
  opponents when roster is provided.
- `stats` — basic W/L/games, mean/min/max PR, oppMeanPR, luck math,
  prWins/points/avgPoints (UBC), technical-match exclusion from PR
  averages, technical-draw handling, empty-stats placeholder for
  rostered but unplayed entrants.
- `rankings` — doubling sort (winRate DESC, meanPR ASC), regular
  H2H tiebreak when winRate + wins both tie, UBC avgPoints sort,
  computeAverages handling of null-PR rows, computeMatchStats math.
- `leagueTypes` — three configs + fallback for unknown LeagueType.
- `titleConstants` — BMAB lookup, championship tooltip / info,
  highest-tier resolution, hasTitles, compareTitlePriority ordering,
  full description string, COUNTRIES coverage of Israel + alpha sort.
- `matchHistory` — matchKey unordered, mergeHistoryIntoMatches
  override+append semantics, getMatchesAsOf cutoff inclusivity,
  getUpdateDates dedup + descending order.
- `leagueLoader` — applyOverrides for the four override types
  (`result`, `technical_win`, `technical_draw`, `not_played`) plus
  append-when-missing case.
- `utils` — URL builders URI-encode, formatters round correctly,
  parseLeagueDate / getLeagueYear precedence, flagUrl + getFlagCode
  defaults.

A `vitest.config.js` is now committed at v2/ root pinning the test
environment to `node` (Phase 4 modules have no DOM coupling).

### Verification

`npm test` → 8 files / 64 tests, all passing.

Cross-check on real production data (`leagues/Shabi Israel April 2026/`):
the v2 pipeline (`csvParser.parseCSV` → `stats.computeAllStats` →
`rankings.buildRankings(_, getLeagueConfig(params), matches)`) and the
equivalent v1 pipeline produce byte-identical top-5 output (25 players,
300 matches, doubling config). Full table verified — every rank,
WinRate, MeanPR, and Level matches.

ESLint v9's flat-config migration remains an open pre-Phase-4 issue
(`.eslintrc.json` is the v8 format); JS files in this phase pass
`node --check` and were spot-checked by hand against the v1 sources.
