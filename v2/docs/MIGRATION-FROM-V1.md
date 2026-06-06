# Migration from v1 → v2

Authoritative mapping table. Every v1 source file lands in exactly one v2 destination. This file is filled in incrementally as each phase progresses; by Phase 11 it is complete and used as the cutover checklist.

> Status legend: ◯ pending — ◐ partial — ● complete

## CSS files (15 files in v1, all dissolved into layered structure in v2)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `css/variables.css` | split → `src/tokens/{space,radius,shadow,motion,breakpoints,color}.css` + `src/themes/_theme.css` (semantic vars) + theme overrides for `lt-*` per-theme blocks | ● | 1 |
| `css/typography-tokens.css` | replaced by `src/tokens/typography.css` (7 sizes + 4 weights per [docs/TYPOGRAPHY.md](../../docs/TYPOGRAPHY.md) §2.2) + `src/tokens/icon.css` (4 icon sizes). v1's legacy `--fs-055..--fs-200` numeric set is deliberately not ported. | ● | 1 |
| `css/typography-overrides.css` | `src/tools/typoEditor/workspace.css` (gitignored) — v1 file is a transitional hack forcing everything to `--fs-085`; v2 starts clean with the proper 7-token scale | ◯ | 7 |
| `css/themes.css` | split → `src/themes/{dark,beige,nature,vegas,casino,rainbow,x22}.css`. Theme-specific component decorations (Vegas roulette, Rainbow border stripes, X22 triangle header) deferred to the components that need them | ◐ | 1, 3 |
| `css/theme.css` | data-emphasis classes (`.val-best`, `.val-worst`, `.val-better`) — defer to component CSS (Phase 3) since they're component-level emphasis, not theme contract | ◯ | 3 |
| `css/layout.css` | universal/box-sizing reset + `html`/`body` defaults + `strong`/`b` reset + form-control inheritance → `src/base/{reset,root,elements,focus,a11y}.css`. Splash overlay extracted to `src/components/Splash/splash.css` in Phase 3. Page-level rules (`.page-container`, `.page-header`) still pending → per-page CSS in Phase 6 | ◐ | 1, 3, 6 |
| `css/components.css` | dissolved → `src/primitives/*` and `src/components/*` (PlayerCell, StatusChip, MedalRow, RankBadge, ScoreCell, ChartTooltip — Phase 3) | ◐ | 2, 3 |
| `css/navigation.css` | `src/components/Navigation/navigation.css` + `src/components/Breadcrumbs/breadcrumbs.css` + `src/components/SearchBox/searchBox.css` | ● | 3 |
| `css/dashboard.css` | `src/pages/dashboard/dashboard.css` + extractions | ◯ | 3, 6 |
| `css/league-header.css` | `src/components/LeagueHero/leagueHero.css` | ● | 3 |
| `css/player-general.css` | `src/components/PlayerHero/playerHero.css` (V7 + V12) + `src/pages/playerGeneral/playerGeneral.css` (page-only chrome) | ◐ | 3, 6 |
| `css/index-dashboard.css` | `src/pages/landing/landing.css` | ◯ | 6 |
| `css/admin.css` | split → FF format chrome (`.ff-wrap`, `.admin-table.font-large` block, scroll-shadow) → `src/tables/FormTable/formTable.css` (Phase 5); admin-page chrome → `src/pages/admin/admin.css` (Phase 8); form controls → `src/primitives/FormField/` (Phase 2); F3↔FF reconciliation (suppress hairline, match-block state colors, round-card max-height) → `src/pages/admin/roundEditor.css` (Phase 8) | ◐ | 2, 5, 8 |
| `css/admin-button.css` | `src/components/AdminButton/adminButton.css` | ● | 3 |
| `css/theme-picker.css` | `src/components/ThemePicker/themePicker.css` | ● | 3 |
| `css/typoEditor.css` | `src/tools/typoEditor/typoEditor.css` | ◯ | 7 |

## JS files

### Data layer (`js/data/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `csvParser.js` | `src/data/csvParser.js` | ● | 4 |
| `leagueLoader.js` | `src/data/leagueLoader.js` (paths via `/data/` alias) | ● | 4 |
| `playersMetadata.js` | `src/data/playersMetadata.js` (path uses `/data/` alias) | ● | 4 |
| `titleConstants.js` (with TIER_COLORS) | **split** → `src/data/titleConstants.js` (data only) + `src/data/titleStyleMap.js` (CSS class map). Tier colour classes are now owned by Phase 3 components (PlayerCell title badges, PlayerHero chips/ribbons). | ● | 3, 4 |
| `compute/matchHistory.js` (v1 lived under compute/, but is mostly I/O + a merge — moved to data/ in v2) | `src/data/matchHistory.js` | ● | 4 |

### Compute layer (`js/compute/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `stats.js` | `src/compute/stats.js` | ● | 4 |
| `rankings.js` | `src/compute/rankings.js` | ● | 4 |
| `colorScale.js` (with hex constants) | `src/components/ColorScale/colorScale.js` — theme-aware red→amber→green interpolation. Compute moved into the ColorScale component so ScoreCell can import it directly without going through `compute/`. | ● | 3 |
| `leagueTypes.js` | `src/compute/leagueTypes.js` | ● | 4 |
| `matchHistory.js` | moved to `src/data/matchHistory.js` (see Data layer) | ● | 4 |

### Render layer (`js/render/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `landingPage.js` | `src/pages/landing/landing.js` | ◯ | 6 |
| `leaguePage.js` | `src/pages/league/league.js` | ◯ | 6 |
| `dashboardPage.js` | `src/pages/dashboard/dashboard.js` + `src/components/ExportTableImage/exportTableImage.js` (replaces B6a/b/c + leaguePage export funcs with one reusable `exportToImage()`) | ◐ | 3, 6 |
| `playerPage.js` | `src/pages/player/player.js` | ◯ | 6 |
| `playerGeneralPage.js` | `src/pages/playerGeneral/playerGeneral.js` | ◯ | 6 |
| `navigation.js` | `src/components/Navigation/navigation.js` (+ Breadcrumbs + SearchBox components) | ● | 3 |
| `themePicker.js` | `src/components/ThemePicker/themePicker.js` | ● | 3 |
| `adminButton.js` | `src/components/AdminButton/adminButton.js` (login modal flow stays in admin page — Phase 8) | ◐ | 3, 8 |
| `splash.js` | `src/components/Splash/splash.js` | ● | 3 |
| `leagueHeader.js` | `src/components/LeagueHero/leagueHero.js` (V13 + V16) | ● | 3 |
| `playerHeader.js` | `src/components/PlayerHero/playerHero.js` (V7 + V12, watermark logic preserved) | ● | 3 |
| `playerBarChart.js` | `src/components/PlayerBarChart/playerBarChart.js` (now uses ChartTooltip component) | ● | 3 |
| `stickyShadow.js` | `src/tables/MFTable/stickyShadow.js` (internal to table system) | ◯ | 5 |
| `typoEditor.js` | `src/tools/typoEditor/typoEditor.js` (full refactor — 7+4+4 spec) | ◯ | 7 |

### Utils (`js/utils/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `helpers.js` | split → `src/utils/{urlParams,formatting,flagUrl}.js`. `appendExportCredit()` already absorbed by `components/ExportTableImage` in Phase 3, so it does not appear in utils. | ● | 4 |

### Admin (`js/admin/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `playerManager.js` | `src/pages/admin/playerManager.js` | ◯ | 8 |
| `roundEditor.js` (F3 — uses FF chrome via `<div class="ff-wrap">` + `class="admin-table font-large">` in v1; rewires to `FormTable` mount fn in v2) | `src/pages/admin/roundEditor.js` | ◯ | 8 |
| `leagueManager.js` (F1 Leagues + F2 Players + F2b Add-League players + F6 Medals & Prizes — all use FF chrome in v1; F2/F2b via `ffPlayersTableHTML`, F6 via `ffMedalsTableHTML`, shared between Edit + Add League) | `src/pages/admin/leagueManager.js` | ◯ | 8 |
| `overridesList.js` (F4 View Overrides — uses FF chrome in v1) | `src/pages/admin/overridesList.js` | ◯ | 8 |
| `excelImporter.js` (now also renders the **F5** MF import-preview + the pre-stage compatibility report — see `csvValidation.js` and the Bug-fixes row below) | `src/pages/admin/excelImporter.js` | ◯ | 8 |
| `csvValidation.js` (NEW — pre-stage CSV import compatibility report + `newMatches` filter feeding F5) | `src/pages/admin/csvValidation.js` | ◯ | 8 |

### Table-lab (`table-lab/`)

| v1 path | v2 destination | Status | Phase |
|---|---|---|---|
| `formats/base/base.css` | `src/tables/_table.css` | ◯ | 5 |
| `formats/mf/mf.css` + `mf.js` | `src/tables/MFTable/{mfTable.css,mfTable.js}` | ◯ | 5 |
| `formats/sf/sf.css` + `mount.js` | `src/tables/SFTable/{sfTable.css,sfTable.js}` | ◯ | 5 |
| `formats/exp/exp.css` + `mount.js` | `src/tables/ExpandableTable/{expandableTable.css,expandableTable.js}` | ◯ | 5 |
| `formats/ff/ff.css` + `mount.js` (untracked in v1) | `src/tables/FormTable/{formTable.css,formTable.js}` — unified FF (3 cell modes per ColDef: Display/Action/Edit). See `docs/TABLE-DESIGN.md` §FF | ◯ | 5 |
| `mount-mf-table.js` | `src/tables/MFTable/mfTable.js` (`mount(el, args)`) | ◯ | 5 |
| `lab.css` + `index.html` + `lab-loader.js` | `src/tools/tableLab/{tableLab.css,tableLab.html,tableLab.js}` | ◯ | 5 |
| `presets/*.js` (presets — A1-A6, B1-B6c, C0-C4, D, E, F1-F4, **F5**, **F6**) | `src/tables/presets/{TableCode}_{name}.js` (rename per convention). **F5 (CSV Import Preview)** is MF, not FF — read-only `mountMFTable` preset (`fontClass:'font-small'`, `stickyCols:1`); built by `buildF5` in `lab-loader.js`. **F6 (Medals & Prizes)** is FF (Display medal cell + 2 Edit cells Count/Prize); the FormTable preset reads the Count/Prize inputs via Edit-col `getValue`. FF chrome is font-large-only in the canon → F6 is font-large (a font-small FF variant would need a `.admin-table.font-small` chrome block). | ◯ | 5 |

## HTML pages

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `index.html` (redirect to design-lab) | `src/pages/landing/landing.html` (no redirect; real landing) | ◯ | 6 |
| `league.html` | `src/pages/league/league.html` | ◯ | 6 |
| `dashboard.html` | `src/pages/dashboard/dashboard.html` | ◯ | 6 |
| `player.html` | `src/pages/player/player.html` | ◯ | 6 |
| `player_general.html` | `src/pages/playerGeneral/playerGeneral.html` | ◯ | 6 |
| `admin.html` | `src/pages/admin/admin.html` | ◯ | 8 |
| `design-lab.html` (chrome + iframe) | `src/tools/designLab/designLab.html` | ◯ | 7 |
| `typo-editor.html` | `src/tools/typoEditor/typoEditor.html` | ◯ | 7 |
| `design-catalogue.html` | `src/tools/designCatalogue/catalogue.html` | ◯ | 1+ (grows) |
| `table-lab/index.html` | `src/tools/tableLab/tableLab.html` | ◯ | 5 |

## Docs

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `docs/TYPOGRAPHY.md` | `docs/TYPOGRAPHY.md` (updated for icon tokens + new editor spec) | ◯ | 1 |
| `docs/TYPOGRAPHY-INVENTORY.md` | `docs/TYPOGRAPHY-INVENTORY.md` (populated by typoEditor) | ◯ | 7+ |
| `docs/TABLE-DESIGN.md` | `docs/TABLE-DESIGN.md` (revised per variant READMEs) | ◯ | 5 |
| `docs/plans/*` | left in `_archive_v1/docs/` (historical) | ◯ | 12 |
| `docs/audit-*` | left in `_archive_v1/docs/` (historical) | ◯ | 12 |

## Data (untouched by rebuild)

| Path | Role | Action |
|---|---|---|
| `leagues/` (repo root) | Shared by v1 and v2 via Vite alias. No change. | Keep as-is |
| `leagues/{league}/leaguedata.csv` | Per-league match data | Keep |
| `leagues/{league}/league_params.json` | Per-league config (incl. CustomFlags admin overrides) | Keep |
| `leagues/landing_settings.json` | Display order + landing logo/title | Keep |
| `leagues/players_metadata.json` (if exists) | Cross-league player metadata | Keep |

## Plan corrections discovered during the rebuild

Things [PLAN.md](PLAN.md) got wrong against the real v1 state, noted here so later phases can act on the correct list.

| What PLAN.md said | Reality (v1) | Action |
|---|---|---|
| 8 themes: `light, dark, nature, vegas, ocean, sunset, forest, monochrome` | 8 themes: `default(=light), dark, beige, nature, vegas, casino, rainbow, x22` (see `js/render/themePicker.js`) | Phase 1 ports the real list. PLAN §6.1 sentinel sweep and §10 exit criteria must use this list, not the fictional one. |
| §1 tokens include `typography.css` with 7 sizes + 4 weights | [docs/TYPOGRAPHY.md](../../docs/TYPOGRAPHY.md) §3 specifies **3** weights in production (`regular/subheading/heading` = 400/600/700); §5 allows a 4th (medium = 500) **only inside the typoEditor for exploration** | `src/tokens/typography.css` exposes all 4 weight tokens (regular/medium/subheading/heading) so the editor can experiment. Production code MUST use 3. Stylelint can later add a project-source-only rule that forbids `--fw-medium` outside `src/tools/typoEditor/`. |

## Phase 2 — primitive coverage of v1 styles

Each primitive subsumes a slice of `css/components.css` / `css/admin.css`. Components in Phase 3 will compose these primitives, fully replacing the v1 rules.

| v1 class | v2 primitive | Notes |
|---|---|---|
| `.flag`, `.flag-title` | `Flag` (sizes `md` / `lg`) | Em-based heights replace v1's fixed `16px` / `24px`. |
| `.medal`, `.medal-gold`/`silver`/`bronze` | `Badge.--circle` + `--gold/silver/bronze` | Same colour tokens. |
| `.status-pill`, `.status-running`, `.status-completed` | `Pill.--running/completed` | |
| `.league-type-pill`, `.type-doubling/regular/ubc` | `Pill.--doubling/regular/ubc` + `.--uppercase` | Uppercase opt-in (v1 was always uppercase). |
| `.retired-badge` | `Pill` (composition decision — see Phase 3) | |
| `.img-export-btn`, `.admin-button-toggle`, `.matchup-show-all-btn` | `Button.--primary` / `Button.--icon` / `Button.--pill` | |
| `.floating-btn-tooltip` (admin/theme picker hover labels) | `Tooltip` | |
| `.matchup-search-input` + various admin inputs | `FormField` (input, select, textarea variants) | |
| `td.player-cell a`, `.landing-table a`, `.matchup-table a` | `Link.--quiet` | Same "underline on hover only" behaviour. |
| `.admin-welcome-avatar` | `Avatar` (initials variant, size `md`) | Replaces the bespoke gradient circle. |

## Phase 3 — component coverage of v1 styles

Each component dissolves a slice of v1's CSS and/or render-layer JS.
Pages in Phase 6 will compose these components, replacing the v1 page
renderers wholesale.

| v1 selector / function                                  | v2 component               | Notes |
|---------------------------------------------------------|----------------------------|-------|
| `td.player-cell` + inline `.flag` + `.title-abbr[-champ]` | `PlayerCell`              | Flag primitive + name `<a>` + title-abbr badges (BMAB outlined / Champ gradient) |
| `.pg-v12-statuschip`, lh status pill with dot           | `StatusChip`               | Status pill with glowing `currentColor` dot |
| `.league-type-pill.type-*`                              | `TypePill`                 | Wrapper over `Pill --doubling/regular/ubc --uppercase` |
| `tr.rank-{gold,silver,bronze}`                          | `MedalRow`                 | `classNameForRank(rank)` returns the row className |
| `.medal-{gold,silver,bronze}`                           | `RankBadge`                | Wraps `Badge --circle --gold/silver/bronze`; plain numeric for rank > 3 |
| `td` + inline RGB from colorScale + `.color-scaled`     | `ScoreCell`                | `inverted` flag flips the gradient direction |
| NEW                                                     | `FilterPill`               | Toggleable Chip; aria-pressed + Enter/Space |
| `.chart-info-panel` + `.cip-{title,row,item,k,v}`       | `ChartTooltip`             | `setItems(title, items)` API |
| `.breadcrumbs ol/li`                                    | `Breadcrumbs`              | Chevron-segment trail; current crumb auto-marked |
| `.nav-search input + .nav-search-results`               | `SearchBox`                | Standalone — `onQuery` + `setResults` |
| `.site-nav` + skip-link + leagues dropdown              | `Navigation`               | Composes SearchBox |
| `.theme-picker` floating bottom-right                   | `ThemePicker`              | 8 themes; persists to `localStorage["shabi-theme"]` |
| `.admin-button` floating bottom-left                    | `AdminButton`              | Login modal moves to Phase 8 admin page |
| `.img-export-btn`                                       | `ExportButton`             | Wraps Button + loading state |
| `.lh13-card` / `.lh16-hero`                             | `LeagueHero`               | `variant: "v13" \| "v16"` |
| `.pg-v7-card` / `.pg-v12-hero` + watermark layers       | `PlayerHero`               | `variant: "v7" \| "v12"` |
| `js/render/playerBarChart.js` + `.chart-panel/.chart-host`| `PlayerBarChart`         | Now embeds ChartTooltip; theme-aware redraw |
| `js/compute/colorScale.js` + `.color-scaled` filter     | `ColorScale`               | Math (`colorForValue`/`Inverted`/`Games`/`Level`) + visual demo strip |
| `js/utils/splash.js` + `.logo-splash`                   | `Splash`                   | 500 ms show-delay; cancelled if load finishes first |
| Three near-duplicate exporters across pages             | `ExportTableImage`         | One `exportToImage()` function; html2canvas dynamically imported |

## Dependencies added in Phase 3

| Package         | Version  | Used by              | Loading strategy |
|-----------------|----------|----------------------|------------------|
| `html2canvas`   | `^1.x`   | `ExportTableImage`   | Dynamic `import()` so pages that never export pay no bundle cost |

## Bug fixes during rebuild

Bug fixes applied to v1 during the rebuild MUST be re-applied to the corresponding v2 destination. Track them here:

| Date | v1 commit | v1 file | v2 status | Notes |
|---|---|---|---|---|
| 2026-05-28 | (staged) | `table-lab/formats/mf/mf.css` — removed `font-weight: 900` from `tr.avg-row td` (the row keeps `font-weight: 700` from the `tr.avg-row` rule). `<b>AVERAGES</b>` wrapper removed from `table-lab/lab-loader.js` (3 sites) and from `js/presets/{leagueTablePreset,playerMatchHistoryPreset}.js` (3 sites). | ◯ pending in Phase 5 | AVERAGES row was rendering at the highest possible weight (900 on cells + `<b>` label) which over-emphasised the summary row. v2 already forbids both: `900` is outside the 4-weight token scale (max 700 = `--fw-heading`), and `<b>` for visual styling is grep-gated ([PLAN.md:486](PLAN.md#L486)). When porting to `src/tables/MFTable/mfTable.css`, the row weight should map to `var(--fw-heading)`; presets must emit the plain string `'AVERAGES'`, never `<b>...</b>`. |
| 2026-05-29 | (staged) | New shared helper `js/utils/exportTableImage.js` consolidates all 5 v1 Export Image flows (D, A2, B6a, B6b, B6c). Replaces ~300 lines duplicated across `js/render/{leaguePage,landingPage,dashboardPage}.js`. Each page now exports via a 1-line wrapper that calls `exportTableImage({sourceTable, filename, title?, subtitle?, headerNode?, maxRows?})`. The helper bakes in: clone live `<table>`; `.mf-wrap` wrap for rank-* / surface-bg / divider rules; `box-shadow:none` on cells (html2canvas mis-renders inset hairlines as full-cell overlays — same root cause as the BMAB pill bug); replace BMAB pill `inset 0 0 0 1.5px currentColor` with a real border; strip `table-row-hidden`; sticky neutralisation; deterministic width via `display:inline-block` + `width:auto` + pinned `font-size`/`--space-md` (resolved at fluid-type design-max); iPhone 17 cap (`PHONE_MAX_WIDTH = 932`) with proportional shrink loop. Theme-aware bg/color/font. | ◐ ExportTableImage component scaffolded Phase 3, needs feature-parity uplift in Phase 6 | The v2 component at `src/components/ExportTableImage/exportTableImage.js` already has the close API (`{source, title, subtitle, filename}`). Phase 6 should: (a) add `headerNode` + `maxRows` params; (b) port every behaviour in the v1 helper. Best path: copy `js/utils/exportTableImage.js` verbatim into the v2 file, swap `appendExportCredit` import to the v2 path, and update the v2 ExportTableImage barrel exports. Then Phase 6 page ports become 1-line calls. |
| 2026-06-05 | (staged) | **Championship predictor — simulation model overhaul.** Files: `js/compute/championshipPredictor.js`, `js/compute/crossLeague.js`, `js/render/dashboardPage.js` (predictor + what-if call-sites, info popup, Last-300 source). Behaviour changes: **(0)** New `batchLast300PRForSimulator(playerNames)` in `crossLeague.js` pools **all non-REGULAR leagues** (doubling + ubc) into one Last-300 window (weight 7), returning `{mean, std}`; the dashboard predictor now uses this regardless of the league's own type (shared core `computeLast300Map` extracted; the old per-type `batchLast300PR` stays for site-wide display). **(1)** Always Monte Carlo — exact enumeration / Gray-code path removed; no more ≤20/>20 branching. Each remaining match, **every iteration**, draws both players' PR fresh from N(Last-300 mean, std) (Marsaglia-polar `gaussian()`), then looks up the win prob via `getWinProbability` — now **linearly interpolated** between adjacent PR-diff rows (was `Math.round`), benefiting `luckPercentile.js` too. **(2)** REGULAR uses the same combined Last-300 PR. **(3)** REGULAR Win-Rate ties resolved by a progressively-narrowing cascade over the still-tied subgroup: (a) head-to-head wins, (b) internal points-diff, (c) total points-diff vs league, (d) alphabetical — implemented via `rankRegular`/`resolveRegularTie` + base pairwise tables built from played-match scores passed in as new `playedMatches` param; a synthesized match scores winner = MatchLength, loser = ⌈ML/2⌉ (`winMargin`). UBC PR point now goes to the lower **drawn** PR (removed `prWinProbability`/normal-CDF PR-point path). Removed dead `simulateExact`/`findChampion`. **PR-based leagues (Doubling/UBC) secondary tiebreak is now a per-run Mean PR**: each iteration accumulates the same drawn PRs into `prSum` (seeded from `playedPRSum = leagueMeanPR·gamesPlayed`) and divides by `finalGames` — replacing the old static `tiebreakerPR` blend (which now serves only the X=0 season-complete path, where it collapses to the real recorded Mean PR). **Sampler:** production default is an inverse-CDF LUT (`gaussianLUT`, 4096-cell probit table via Acklam, ~32KB, lazy-built, RAM-only) + interpolated table lookup — chosen after a 12-run/1M-sim A/B on real June data showed identical rankings (maxΔ ≤ 0.06 pts, below MC noise) at ~30% less wall-time vs polar. `simOpts = { iterationsOverride, useLUT, useInterp }` keeps polar + round-lookup reachable for A/B; defaults `useLUT:true, useInterp:true`. **Iteration floor:** `estimateIterations` STEP lowered 200k→50k (both the rounding granularity and the floor) — large leagues (where the 500ms budget buys < STEP) pin to 50k. Measured on JUNE (25 players, ~220 remaining): ~0.8s @ MoE ±0.42% (was ~3.6s @ ±0.21% at the 200k floor); rankings stayed stable across 50k/100k/200k. Small leagues stay time-bound above the floor (unaffected). | ◯ pending in v2 (predictor phase) | Port `championshipPredictor.js` and the `crossLeague` Last-300 helpers verbatim. Key invariants for v2: predictor PR source must pool all non-regular leagues (not the dashboard league's type); engine is Monte-Carlo-only with per-match per-iteration PR draws feeding the interpolated table; REGULAR needs the a→b→c→alphabetical cascade and must receive played matches (with scores) to seed the pairwise tables. Numeric regression check available: the 4-player tie scenario in this session resolves P1>P2>P3>P4 deterministically. |
| 2026-06-05 | (staged) | **League-table REGULAR tiebreak — full cascade (matches the simulator).** File: `js/compute/rankings.js`. The actual standings table now resolves Win-Rate ties with the same cascade as the predictor: `buildH2H` replaced by `buildRegularTables` (pairWins + pairDiff + totalDiff from real `scoreA/scoreB`) and a recursive `resolveRegularTie` implementing **(a)** head-to-head wins → **(b)** internal points-diff → **(c)** total points-diff vs league → **alphabetical**, narrowing over the still-tied subgroup. Tie groups are now keyed on **WinRate only** (previously required equal WinRate *and* wins, and only did criterion (a) + alphabetical). PR leagues (Doubling/UBC) are unchanged — they already tiebreak on the real recorded Mean PR via the secondary sort. | ● complete | Mirrored verbatim into `v2/src/compute/rankings.js`; `v2/tests/unit/rankings.test.js` extended with a 4-way-tie cascade test (8 tests pass). The pre-existing 2-player H2H test still passes (criterion (a) decides it). |
| 2026-06-06 | (staged) | **Admin: Pending-Changes consolidation + CSV import compatibility/preview overhaul + F5 table.** Files: `js/admin/stagingStore.js`, `js/admin/render/adminPage.js`, `js/admin/leagueManager.js`, `js/admin/playerManager.js`, `js/admin/csvEditor.js`, `js/admin/roundEditor.js`, `js/admin/overridesList.js`, `js/admin/excelImporter.js`, NEW `js/admin/csvValidation.js`, `admin.html`, `table-lab/{lab.js,lab-loader.js,index.html}`. **(1) Pending-Changes:** single staged change per logical action via shared `group` (create-league, edit-players, create/edit-player fold flag+photo into the metadata group); a category-driven label formatter (`CATEGORY_META` + `renderLabel` in `adminPage.js`) gives every row `{icon}  <b>{subject}</b> · {action}{ — detail}` — drive labels off a semantic `category` field on each `addChange`, NOT off the file path (so the future DB write target swaps cleanly). **(2) Manual overrides are delta-staged:** each staged `manual_overrides.json` carries `baselineOverrides` (the published set); `diffOverrides` returns `{added, changed, removed}` and the UI/badge show only the delta (⚖️ added / ✏️ edited / ➖ removed), each individually cancellable (`removeOverrideFromChange` for added, `restoreOverrideToChange` reverts edited/removed to the published value). All 4 override write-sites route through `stageManualOverrides`. **(3) CSV import compatibility report** (`csvValidation.js`): player-count/roster diff, Levenshtein typo suspects, fewer-matches regression warning, and override-collision warning (CSV results shadowed by a manual override won't apply — overrides win via `applyOverrides`). Rendered directly under the drop zone, never blocks. **(4) F5 — CSV Import Preview** table: read-only **MF** (`mountMFTable`, `font-small`, `stickyCols:1`) showing only the "N updates" (played-in-upload, not already played, not override-covered) from `report.newMatches`; `admin.html` loads `table-lab/formats/mf/mf.css`; catalogued in the lab + `docs/TABLE-DESIGN.md` (F5) + `docs/plans/table-lab-unification.md`. | ◯ pending in v2 (Phase 8 admin + Phase 5 lab F5) | Port `csvValidation.js` + the `excelImporter.js` preview wiring + the `stagingStore.js` group/category/override-delta model. v2 admin is read-only until Phase 8, so this lands then; the F5 lab preset lands in Phase 5 alongside the other presets (`buildF5`). Keep the category-based label formatter (path-agnostic) — it is the seam for the eventual DB-backed write target. |
| 2026-06-06 | (staged) | **F6 — Medals & Prizes table moved onto the FF format (Edit League + Add New League).** Files: `js/admin/leagueManager.js` (new shared `ffMedalsTableHTML` builder; both Edit and Add call it), `css/admin.css` (bespoke `.medal-prize-table` chrome removed → replaced by the shared FF chrome `.ff-wrap` + `.admin-table.font-large` with `data-mf-table-id="F6"`; only F6-specific bits kept: equal Count/Prize column widths `[data-mf-table-id="F6"] *:nth-child(n+2){width:28%}` + `.medal-cell` inline-flex/colour), `docs/TABLE-DESIGN.md` (F6 added to the F-table list + FF usage + §FF note), `docs/plans/table-lab-unification.md` (F6 added to the Phase-8 FF scope + 8.1 inventory), `js/render/typoEditor.js` (`f6-table` entry targeting `[data-mf-table-id="F6"]`). Display medal cell (icon + colored name) + two Edit cells (Count, Prize number inputs keep stable ids so the Save/Create handlers read them unchanged). **Font:** FF chrome is keyed to `.admin-table.font-large`, so F6 is **font-large** (was bespoke font-small); the Count/Prize inputs keep responsive font-small via `.edit-card-sm .form-group input`. **Lab not yet wired:** like F1–F4, F6 is hand-built FF chrome — `mountFFTable` rewiring is deferred to Phase 8 (the table-lab integration was intentionally NOT done now). | ◯ pending in v2 (Phase 8 admin + Phase 5 lab FF) | When v2 builds the admin Edit/Add League pages (Phase 8) and the FormTable lab catalog (Phase 5), render F6 through `FormTable`/`mountFFTable` with a Medals preset (Display medal col + Count/Prize Edit cols). Decide then whether to add a font-small FF chrome variant so the medals table can be font-small in v2; otherwise keep it font-large like the other FF tables. Shares the FF format with F1/F2/F2b/F4. |
| 2026-06-06 | (staged) | **Favicon — league logo as browser-tab icon on every page.** New tracked asset `assets/favicon.png` (copy of `assets/logo/logo.png`; placed under `assets/` because the repo-root `/*.png` .gitignore rule silently drops any `favicon.png` at root). `<link rel="icon" type="image/png" href="assets/favicon.png">` added to all v1 pages: `index.html`, `league.html`, `player.html`, `admin.html`, `dashboard.html`, `player_general.html`, `typo-editor.html`, `design-lab.html`, `design-catalogue.html`, and `table-lab/index.html` (relative `../assets/favicon.png`). **Also: link-preview meta** (Open Graph `og:*` + Twitter `summary` card) pointing `og:image`/`twitter:image` at the **absolute** URL `https://golan.me.uk/assets/favicon.png` (640×640), plus `<meta name="description">`, added to the 5 public pages only — `index/league/player/dashboard/player_general` (skipped admin + dev tools intentionally). | ◯ pending across Phases 5–8 | v2 is a Vite app: drop the logo at `v2/public/favicon.png` (Vite serves `public/` at the site root) and add `<link rel="icon" type="image/png" href="/favicon.png">` to each page `<head>` as it is built — landing/league/dashboard/player/playerGeneral (Phase 6), tableLab (Phase 5), designLab/typoEditor (Phase 7), admin (Phase 8), catalogue (Phase 1+). No per-page relative paths needed since `/favicon.png` resolves from root. For the **link-preview** tags: `og:image`/`twitter:image` MUST stay an absolute URL (`https://golan.me.uk/...`) — relative paths are not resolved by social scrapers; replicate the OG + Twitter `summary` block on the 5 public pages only. Watch the `/*.png` root .gitignore does not also exist in `v2/` — if it does, `v2/public/` is exempt anyway. |
| 2026-06-04 | (staged) | **Path-X canonization sweep — units policy + 5 px→em violations.** New `Units policy` doc-block at top of `table-lab/formats/base/base.css` (the load-bearing rule: em for sizing-with-font, px for hairlines/shadows/viewport-caps/breakpoints/JS-fallbacks). Canonical `.flag` and `.show-more-btn` rules added to `base.css` and mirrored into `css/components.css` + `css/admin.css` (admin doesn't load base). 5 violation classes eliminated: (1) flag size/margin/border-radius converted to em across base+mf+sf+exp+ff canon AND production mirrors `dashboard.css`, `index-dashboard.css`, `player-general.css`; (2) `.show-more-btn` consolidated to base.css em-based — duplicates removed from mf+sf+index-dashboard+player-general+dashboard.css; (3) predictor/whatif pct bars em-based in mf.css + dashboard.css; (4) exp container (`.pg-rank-expanded`) em-based; (5) sort-icon, level-cell letter-spacing, mobile matrix compression padding all em. `image-rendering:crisp-edges` removed from `.pg-matches-table .flag` (was forcing nearest-neighbor scaling on small thumbnails) — all `.flag` declarations now explicit `image-rendering:auto`. Phase 7.1 wiring landed alongside: `<link rel="stylesheet" href="table-lab/formats/{sf,exp}/...css">` added to `league.html`, `player.html`, `player_general.html`, `dashboard.html`. | ◯ pending in v2 Phase 5 | v2 Phase 5 (`src/tables/{MFTable,SFTable,ExpandableTable,FormTable}/`) should source from the canonized v1 lab files directly — `table-lab/formats/{base,mf,sf,exp,ff}/*.css` are now authoritative (the legacy components.css/dashboard.css/index-dashboard.css/player-general.css copies live alongside but lose by cascade in production). The Units policy block at the top of `base.css` should port verbatim into the v2 table CSS architecture as a non-negotiable foundation rule. The canonical `.flag` rule should land in v2 as a single shared atom (likely `src/components/Flag/flag.css` or a shared table primitive). |
