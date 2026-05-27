# Migration from v1 → v2

Authoritative mapping table. Every v1 source file lands in exactly one v2 destination. This file is filled in incrementally as each phase progresses; by Phase 11 it is complete and used as the cutover checklist.

> Status legend: ◯ pending — ◐ partial — ● complete

## CSS files (15 files in v1, all dissolved into layered structure in v2)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `css/variables.css` | split → `src/tokens/{space,radius,shadow,motion,breakpoints}.css` | ◯ | 1 |
| `css/typography-tokens.css` | `src/tokens/typography.css` + `src/tokens/icon.css` | ◯ | 1 |
| `css/typography-overrides.css` | `src/tools/typoEditor/workspace.css` (gitignored) | ◯ | 7 |
| `css/themes.css` | split → `src/themes/{light,dark,nature,vegas,...}.css` | ◯ | 1 |
| `css/theme.css` | merged into `src/themes/_theme.css` | ◯ | 1 |
| `css/layout.css` | split → `src/base/{reset,root,elements,focus,a11y}.css` + per-page CSS | ◯ | 1, 6 |
| `css/components.css` | dissolved → `src/primitives/*` and `src/components/*` | ◯ | 2, 3 |
| `css/navigation.css` | `src/components/Navigation/navigation.css` | ◯ | 3 |
| `css/dashboard.css` | `src/pages/dashboard/dashboard.css` + extractions | ◯ | 3, 6 |
| `css/league-header.css` | `src/components/LeagueHero/leagueHero.css` | ◯ | 3 |
| `css/player-general.css` | `src/pages/playerGeneral/playerGeneral.css` + `src/components/PlayerHero/` | ◯ | 3, 6 |
| `css/index-dashboard.css` | `src/pages/landing/landing.css` | ◯ | 6 |
| `css/admin.css` | `src/pages/admin/admin.css` + `src/primitives/FormField/` | ◯ | 2, 8 |
| `css/admin-button.css` | `src/components/AdminButton/adminButton.css` | ◯ | 3 |
| `css/theme-picker.css` | `src/components/ThemePicker/themePicker.css` | ◯ | 3 |
| `css/typoEditor.css` | `src/tools/typoEditor/typoEditor.css` | ◯ | 7 |

## JS files

### Data layer (`js/data/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `csvParser.js` | `src/data/csvParser.js` | ◯ | 4 |
| `leagueLoader.js` | `src/data/leagueLoader.js` (paths via `/data/` alias) | ◯ | 4 |
| `playersMetadata.js` | `src/data/playersMetadata.js` | ◯ | 4 |
| `titleConstants.js` (with TIER_COLORS) | **split** → `src/data/titleConstants.js` (data only) + `src/data/titleStyleMap.js` (CSS class map) | ◯ | 3, 4 |

### Compute layer (`js/compute/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `stats.js` | `src/compute/stats.js` | ◯ | 4 |
| `rankings.js` | `src/compute/rankings.js` | ◯ | 4 |
| `colorScale.js` (with hex constants) | `src/compute/colorScale.js` — returns `var(--c-level-*)` references; raw colors move to `src/tokens/color.css` | ◯ | 4 |
| `leagueTypes.js` | `src/compute/leagueTypes.js` | ◯ | 4 |

### Render layer (`js/render/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `landingPage.js` | `src/pages/landing/landing.js` | ◯ | 6 |
| `leaguePage.js` | `src/pages/league/league.js` | ◯ | 6 |
| `dashboardPage.js` | `src/pages/dashboard/dashboard.js` + `src/components/ExportTableImage/` (extracted from B6a/b/c export funcs) | ◯ | 3, 6 |
| `playerPage.js` | `src/pages/player/player.js` | ◯ | 6 |
| `playerGeneralPage.js` | `src/pages/playerGeneral/playerGeneral.js` | ◯ | 6 |
| `navigation.js` | `src/components/Navigation/navigation.js` | ◯ | 3 |
| `themePicker.js` | `src/components/ThemePicker/themePicker.js` | ◯ | 3 |
| `splash.js` | `src/components/Splash/splash.js` | ◯ | 3 |
| `leagueHeader.js` | `src/components/LeagueHero/leagueHero.js` (V13 + V16) | ◯ | 3 |
| `playerBarChart.js` | `src/components/PlayerBarChart/playerBarChart.js` | ◯ | 3 |
| `stickyShadow.js` | `src/tables/MFTable/stickyShadow.js` (internal to table system) | ◯ | 5 |
| `typoEditor.js` | `src/tools/typoEditor/typoEditor.js` (full refactor — 7+4+4 spec) | ◯ | 7 |

### Utils (`js/utils/`)

| v1 file | v2 destination | Status | Phase |
|---|---|---|---|
| `helpers.js` | split → `src/utils/{urlParams,formatting,flagUrl}.js` | ◯ | 4 |

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

## Bug fixes during rebuild

Bug fixes applied to v1 during the rebuild MUST be re-applied to the corresponding v2 destination. Track them here:

| Date | v1 commit | v1 file | v2 status | Notes |
|---|---|---|---|---|
| — | — | — | — | (none yet) |
