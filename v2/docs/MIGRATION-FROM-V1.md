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
| `css/admin.css` | `src/pages/admin/admin.css` + `src/primitives/FormField/` | ◐ | 2, 8 |
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
| `roundEditor.js` | `src/pages/admin/roundEditor.js` | ◯ | 8 |
| `leagueManager.js` | `src/pages/admin/leagueManager.js` | ◯ | 8 |
| `excelImporter.js` | `src/pages/admin/excelImporter.js` | ◯ | 8 |

### Table-lab (`table-lab/`)

| v1 path | v2 destination | Status | Phase |
|---|---|---|---|
| `formats/base/base.css` | `src/tables/_table.css` | ◯ | 5 |
| `formats/mf/mf.css` + `mf.js` | `src/tables/MFTable/{mfTable.css,mfTable.js}` | ◯ | 5 |
| `mount-mf-table.js` | `src/tables/MFTable/mfTable.js` (`mount(el, args)`) | ◯ | 5 |
| `lab.css` + `index.html` + `lab-loader.js` | `src/tools/tableLab/{tableLab.css,tableLab.html,tableLab.js}` | ◯ | 5 |
| `presets/*.js` (18 presets) | `src/tables/presets/{TableCode}_{name}.js` (rename per convention) | ◯ | 5 |

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
