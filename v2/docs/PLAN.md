# Shabi Israel v2 — Clean-Slate Rebuild Plan

## Context

The current codebase has organically grown into a patchwork: ~290 `font-size` declarations across 15 CSS files, duplicated table rules between `components.css` and `mf.css`, color leaks in `js/data/titleConstants.js`, the `typo-editor.html` legacy T1–T7 tier system, sticky-cell cascade fights, and a `typography-overrides.css` file that masks underlying drift. The audits showed the structural bones are sound (data/compute layers are clean, theme system works, table presets are declarative) but the CSS layer and the typo-editor are misaligned with the spec in [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md).

The user has chosen the **clean-slate rebuild** route over the in-place refactor. This plan defines exactly how to produce that rebuild safely: a parallel `v2/` directory grown to feature-parity with the current production, verified per-page via Playwright MCP, then cut over in a single scripted commit. The current production code is **never touched** until cutover — every commit during the rebuild is purely additive under `v2/`. Rollback at any point is `git rm -rf v2/`.

Decisions locked in via earlier conversation:
- **Branch**: stays on `development` (current branch). No new branch.
- **Location**: `c:\WORKSPACE\Shabi_Israel\v2\`.
- **Coexistence**: v1 keeps running on `http://localhost:8090`; v2 runs on `http://localhost:5173` (Vite dev). Both alive throughout the rebuild.
- **Stack**: vanilla ES modules + CSS `@layer` + Vite (multi-page build). No framework lock-in.
- **Data**: shared by reference — `leagues/`, `landing_settings.json`, admin metadata files all live at the repo root and are read by both v1 and v2. v2 reaches them via a Vite alias / dev-time symlink.
- **Editor write target**: hybrid — `typography-tokens.css` ships with defaults; the typo-editor overlays a versioned user save history on top; a "Publish" action bakes the overlay into the source tokens or component CSS.
- **Inventory**: auto-discovered by the editor + human-curated. Editor writes to `v2/docs/TYPOGRAPHY-INVENTORY.md`.

---

## 1. Architecture — three-layer, cascade-enforced

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: DESIGN TOKENS (single source of truth per concern)     │
│ v2/src/tokens/        — color, typography, icon, space, ...     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: THEMES (token → semantic var mappings)                  │
│ v2/src/themes/        — light, dark, nature, vegas, ...         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: PRIMITIVES → COMPONENTS → TABLES (consume tokens only)  │
│ v2/src/primitives/    — Flag, Icon, Badge, Pill, Button, ...    │
│ v2/src/components/    — PlayerCell, StatusChip, Navigation, ... │
│ v2/src/tables/        — MFTable, SFTable, exp, FF + presets     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4: PAGES (compose primitives + components + tables)        │
│ v2/src/pages/         — landing, league, dashboard, player, ... │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 5: TOOLS (consume same primitives; never duplicate them)   │
│ v2/src/tools/         — designLab, typoEditor, tableLab, ...    │
└─────────────────────────────────────────────────────────────────┘
```

Cascade is enforced via a single `@layer` order declared in `v2/src/index.css`:

```css
@layer reset, tokens, themes, base, primitives, components, tables, pages, utilities, overrides;
```

A primitive's CSS can never beat a token. A page's CSS can never beat a primitive. Stylelint rules (configured in `v2/.stylelintrc.json`) refuse PRs containing literal `font-size`/`color`/hex values in component CSS — only `var(--*)` references pass.

---

## 2. Full directory tree (target state of `v2/`)

```
v2/
├── README.md                            # how to run, current migration status
├── package.json
├── vite.config.js                       # multi-page entries; aliases to ../leagues
├── .stylelintrc.json                    # forbids literals (font-size, color, etc.)
├── .eslintrc.json
├── .gitignore                           # node_modules, dist, .vite
├── .editorconfig
├── index.html                           # Vite root entry → redirects to landing
│
├── src/
│   ├── index.css                        # @layer order + token + theme imports
│   │
│   ├── tokens/                          ── Layer 1 ──
│   │   ├── color.css                    # --c-* palette (raw values)
│   │   ├── typography.css               # --fs-{micro,small,large,xl,2xl,3xl,display}
│   │   │                                # --fw-{regular,medium,subheading,heading}
│   │   ├── icon.css                     # --icon-{xs,sm,md,lg}
│   │   ├── space.css                    # --space-{1..12}
│   │   ├── radius.css
│   │   ├── shadow.css
│   │   ├── motion.css
│   │   └── breakpoints.css              # custom media @media (--bp-sm) etc.
│   │
│   ├── themes/                          ── Layer 2 ──
│   │   ├── _theme.css                   # semantic var names: --color-bg, --color-text
│   │   ├── light.css
│   │   ├── dark.css
│   │   ├── nature.css
│   │   ├── vegas.css
│   │   ├── ocean.css
│   │   ├── sunset.css
│   │   ├── forest.css
│   │   └── monochrome.css
│   │
│   ├── base/                            ── Layer 3 ──
│   │   ├── reset.css
│   │   ├── root.css                     # fluid html font-size
│   │   ├── elements.css                 # h1-h6, p, button, input defaults
│   │   ├── focus.css
│   │   └── a11y.css
│   │
│   ├── primitives/                      ── Layer 4 ──
│   │   ├── Flag/{flag.css, flag.js}
│   │   ├── Icon/{icon.css, icon.js}
│   │   ├── Badge/{badge.css, badge.js}
│   │   ├── Pill/{pill.css, pill.js}
│   │   ├── Button/{button.css, button.js}
│   │   ├── Link/{link.css, link.js}
│   │   ├── Avatar/{avatar.css, avatar.js}
│   │   ├── Tooltip/{tooltip.css, tooltip.js}
│   │   ├── Chip/{chip.css, chip.js}
│   │   └── FormField/{formField.css, formField.js}  # input + label + error
│   │
│   ├── components/                      ── Layer 5 ──
│   │   ├── Tabs/                        # canonical segmented app-tab bar — ports v1 mountAppTabs
│   │   │                                #   (ARIA tablist + roving keyboard + ?tab= URL state + 1-N
│   │   │                                #   hotkeys) PLUS per-tab decorative icon (emoji or inline SVG,
│   │   │                                #   aria-hidden) via a shared tabIcons.js id→icon map. ONE source
│   │   │                                #   for the landing / league / player main bars (concepts share
│   │   │                                #   icons: Leagues=table-glyph reused from SearchBox, Matches=🎲,
│   │   │                                #   Records=📜). Was missing from this inventory; added 2026-06-25.
│   │   ├── PlayerCell/                  # flag + name + realname (ONE source)
│   │   ├── StatusChip/                  # Running / Completed / This year
│   │   ├── TypePill/                    # Doubling / Regular / UBC
│   │   ├── MedalRow/                    # gold/silver/bronze row tinting
│   │   ├── RankBadge/
│   │   ├── ScoreCell/
│   │   ├── ChartTooltip/
│   │   ├── Breadcrumbs/
│   │   ├── Navigation/                  # top bar + leagues dropdown + search
│   │   ├── ThemePicker/
│   │   ├── AdminButton/
│   │   ├── ExportButton/
│   │   ├── SearchBox/
│   │   ├── FilterPill/
│   │   ├── LeagueHero/                  # V13 + V16 variants
│   │   ├── PlayerHero/                  # V7 + V12 variants
│   │   ├── PlayerBarChart/
│   │   ├── ColorScale/                  # heat-map cell coloring
│   │   ├── Splash/
│   │   └── ExportTableImage/            # extracted from current dashboardPage.js
│   │
│   ├── tables/                          ── Layer 6 ──
│   │   ├── _table.css                   # shared base
│   │   ├── _table.js                    # shared utils (sortAdapter, formatCell)
│   │   ├── MFTable/
│   │   │   ├── mfTable.css
│   │   │   ├── mfTable.js               # mount(el, args) → controller
│   │   │   ├── stickyShadow.js
│   │   │   ├── sortAdapter.js
│   │   │   ├── argsSchema.js            # lab reads this to build form
│   │   │   └── README.md                # MF iron rules
│   │   ├── SFTable/{sfTable.css, sfTable.js, argsSchema.js, README.md}
│   │   ├── ExpandableTable/{expandableTable.css, expandableTable.js, argsSchema.js, README.md}
│   │   ├── FormTable/{formTable.css, formTable.js, argsSchema.js, README.md}
│   │   │                                 # Unified FF format covering all 4 admin tables.
│   │   │                                 # Three cell modes per ColDef: Display (read-only),
│   │   │                                 # Action (button + data-attrs), Edit (input/select
│   │   │                                 # + getValue). A single FormTable instance can mix
│   │   │                                 # all three freely. Returns { wrap, table, getDiff,
│   │   │                                 # validate }. See docs/TABLE-DESIGN.md §FF.
│   │   └── presets/
│   │       ├── A1_completedLeagues.js   (MF)
│   │       ├── A2_annualLeaderboard.js  (MF)
│   │       ├── A3_achievements.js       (SF)
│   │       ├── A4_prLeaders.js          (SF)
│   │       ├── A5_matchRecords.js       (SF)
│   │       ├── A6_leagueRecords.js      (SF)
│   │       ├── A7_playersDirectory.js   (SF — Notable Figures + Rest of Players, stacked; sticky Player col; fixed sort: status → alpha)
│   │       ├── B1_prizesAndMedals.js    (MF)
│   │       ├── B2_historicalView.js     (MF)
│   │       ├── B3_championshipPredictor.js (MF)
│   │       ├── B4_whatIfSimulator.js    (MF)
│   │       ├── B5_rounds.js             (MF)
│   │       ├── B6a_allRemaining.js      (MF)
│   │       ├── B6b_remainingReport.js   (MF)
│   │       ├── B6c_remainingPerPlayer.js(MF)
│   │       ├── C0_expandable.js         (exp)
│   │       ├── C1_playerLeagues.js      (MF font-large)
│   │       ├── C2_playerMatchHistory.js (MF)
│   │       ├── C3_matchup.js            (MF)
│   │       ├── C4_matchRecords.js       (SF)
│   │       ├── D_leagueTable.js         (MF — source of slope)
│   │       ├── E_playerMatchHistory.js  (MF)
│   │       ├── F1_leagueManager.js      (FF — Display + Action)
│   │       ├── F2_players.js            (FF — Display + Edit + Action)
│   │       ├── F3_roundEditor.js        (FF — Edit + Action, 2-rows-per-match tbody)
│   │       ├── F4_viewOverrides.js      (FF — Display + Action)
│   │       ├── F5_csvImportPreview.js   (MF — read-only; fontClass:'font-small', stickyCols:1)
│   │       └── F6_medalsAndPrizes.js    (FF — Display medal cell + Edit Count + Edit Prize)
│   │
│   ├── data/                            ── Layer 7: data access (no UI) ──
│   │   ├── csvParser.js                 # ported as-is from js/data/
│   │   ├── leagueLoader.js              # ported; data paths via Vite alias
│   │   ├── playersMetadata.js
│   │   ├── settingsLoader.js
│   │   ├── titleConstants.js            # PURE tier semantics (no colors)
│   │   ├── titleStyleMap.js             # tier → CSS class mapping
│   │   └── adminWriter.js               # NEW: writes to admin overrides files
│   │
│   ├── compute/                         ── Layer 8: pure functions ──
│   │   ├── stats.js
│   │   ├── rankings.js                  # REGULAR Win-Rate tie cascade: H2H → internal pts-diff → total pts-diff → alpha
│   │   ├── colorScale.js                # returns CSS var name, not raw hex
│   │   ├── leagueTypes.js
│   │   ├── matchupAnalysis.js
│   │   ├── championshipPredictor.js     # Monte-Carlo only (no exact/Gray-code path). Per-match per-iteration N(μ,σ) PR draws + interpolated win-prob LUT. REGULAR uses same Last-300 pool + tie cascade as rankings.js. Sampler: inverse-CDF LUT (gaussianLUT, 4096-cell Acklam probit, ~32KB, lazy). Iteration floor 50k. simOpts={iterationsOverride,useLUT,useInterp}.
│   │   ├── crossLeague.js               # batchLast300PRForSimulator(names) pools all non-REGULAR leagues (doubling+ubc) into one Last-300 window; shared core computeLast300Map. The dashboard predictor uses this regardless of the league's own type.
│   │   └── whatIfSimulator.js
│   │
│   ├── pages/                           ── Layer 9: page composition ──
│   │   ├── _shell.html                  # shared head/nav/footer fragment
│   │   ├── landing/{landing.html, landing.css, landing.js}
│   │   ├── league/{league_table.html, league.css, league.js}
│   │   ├── dashboard/{league.html, dashboard.css, dashboard.js}
│   │   ├── player/{player_league.html, player.css, player.js}
│   │   ├── playerGeneral/{playerGeneral.html, playerGeneral.css, playerGeneral.js}
│   │   └── admin/
│   │       ├── admin.html
│   │       ├── admin.css
│   │       ├── admin.js
│   │       ├── playerManager.js
│   │       ├── roundEditor.js
│   │       ├── leagueManager.js
│   │       └── excelImporter.js
│   │
│   ├── tools/                           ── Layer 10: dev tools ──
│   │   ├── designLab/{designLab.html, designLab.css, designLab.js}
│   │   ├── typoEditor/
│   │   │   ├── typoEditor.html
│   │   │   ├── typoEditor.css
│   │   │   ├── typoEditor.js
│   │   │   ├── inventoryParser.js       # reads/writes TYPOGRAPHY-INVENTORY.md
│   │   │   └── publish.js               # workspace → source tokens
│   │   ├── tableLab/
│   │   │   ├── tableLab.html
│   │   │   ├── tableLab.css
│   │   │   ├── tableLab.js
│   │   │   ├── catalog.js               # auto-discovers presets
│   │   │   ├── argsForm.js
│   │   │   ├── presetPicker.js
│   │   │   ├── codeSnippet.js
│   │   │   ├── ironRulesPanel.js
│   │   │   ├── themeBridge.js
│   │   │   └── previewMount.js
│   │   └── designCatalogue/{catalogue.html, catalogue.js}
│   │
│   ├── utils/
│   │   ├── urlParams.js
│   │   ├── formatting.js
│   │   ├── flagUrl.js
│   │   ├── debounce.js
│   │   ├── eventBus.js
│   │   └── domHelpers.js
│   │
│   ├── i18n/
│   │   ├── en.json
│   │   ├── he.json
│   │   └── i18n.js
│   │
│   └── entry/                           # per-page Vite entries
│       ├── landing.entry.js
│       ├── leagueTable.entry.js
│       ├── league.entry.js
│       ├── playerLeague.entry.js
│       ├── player.entry.js
│       ├── admin.entry.js
│       ├── designLab.entry.js
│       ├── typoEditor.entry.js
│       ├── tableLab.entry.js
│       └── designCatalogue.entry.js
│
├── public/
│   ├── icons/{sprite.svg, flags/, medals/, status/, ui/}
│   ├── fonts/{Inter/, BebasNeue/, PlayfairDisplay/}
│   └── data/                            # Vite alias → ../../leagues (see §3)
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── TYPOGRAPHY.md                    # copied + updated from root docs/
│   ├── TYPOGRAPHY-INVENTORY.md
│   ├── TABLE-DESIGN.md
│   ├── THEMES.md
│   ├── COMPONENTS.md
│   ├── ADMIN.md                         # admin data model + override format
│   ├── MIGRATION-FROM-V1.md             # v1 file → v2 file mapping table
│   ├── PARITY-LOG.md                    # MCP verification results per page
│   └── CHANGELOG.md
│
├── tests/
│   ├── unit/                            # vitest: compute, data parsers
│   ├── visual/                          # playwright: screenshot diffs
│   ├── a11y/                            # axe-core
│   ├── parity/                          # v1↔v2 side-by-side checks
│   └── e2e/
│
└── scripts/
    ├── inventory-sync.js                # CI gate
    ├── grep-gates.sh                    # forbidden literal patterns
    ├── icon-sprite-build.js
    ├── data-sync.js                     # copy ../leagues → public/data (fallback)
    ├── parity-runner.js                 # runs MCP parity checks, writes PARITY-LOG.md
    └── migrate-v1-to-v2.sh              # one-time cutover script
```

---

## 3. Shared DATA architecture (v1 + v2 read/write the same sources)

The data layer must remain shared so that any league update, admin edit, or override applies to both v1 and v2 simultaneously. Three categories of data:

### 3.1 Read-only league data
- **Location**: `c:\WORKSPACE\Shabi_Israel\leagues\` (current root path; untouched)
- **Files**: `landing_settings.json`, `leagues/{league-id}/leaguedata.csv`, `leagues/{league-id}/league_params.json`
- **v1 access**: `fetch('leagues/...')` (relative to v1 root)
- **v2 access**: Vite serves via alias. `vite.config.js`:
  ```js
  export default {
    publicDir: false,
    server: {
      fs: { allow: ['..', '../leagues'] }
    },
    resolve: {
      alias: {
        '@data': path.resolve(__dirname, '../leagues'),
      }
    },
    plugins: [
      {
        name: 'data-proxy',
        configureServer(server) {
          server.middlewares.use('/data', sirv(path.resolve(__dirname, '../leagues')));
        }
      }
    ]
  }
  ```
  In v2 code: `fetch('/data/Shabi Israel May 2026/leaguedata.csv')` resolves to the same file v1 reads.
- **For production build**: `scripts/data-sync.js` copies `../leagues/` → `v2/public/data/` at build time. Deployed v2 ships with its own data snapshot.

### 3.2 Admin-editable data
Today's admin pages write to several sources:

| Data | Current location | v2 access |
|---|---|---|
| Player metadata (titles, custom flags, real names) | `leagues/{league}/league_params.json` `CustomFlags`, separate per-league | Same file; v2 reads/writes via `adminWriter.js` |
| Round scores | `leagues/{league}/leaguedata.csv` (CSV rewrite) | Same file; FileSystemAPI write |
| Landing display order | `leagues/landing_settings.json` | Same |
| Player profile metadata (cross-league) | `leagues/players_metadata.json` (single file) | Same |

**Rule**: writes are exclusive — only ONE of v1 or v2 should be used for editing at any time during the rebuild. Reads are always safe in parallel. The admin tab in v2 ships disabled until the admin pages are fully ported (Phase 8). Until then, admin edits happen exclusively in v1.

### 3.3 Editor / tool overrides
Two override-style files exist:

| File | Owner | Format | v1 ↔ v2 |
|---|---|---|---|
| `css/typography-overrides.css` | typo-editor (v1) | CSS with version JSON in comment | v1 keeps owning during rebuild. After cutover, v2's typo-editor takes over and writes to `v2/src/tools/typoEditor/workspace.css` (which is `@imported` last in dev mode). |
| `localStorage['shabi-theme']`, `localStorage['shabi-custom-vars']` | browser per-domain | JSON strings | Shared across v1 and v2 because both run on `localhost`. Theme picker behavior identical. |

### 3.4 Data write conflict avoidance during the rebuild
- v2 admin pages start as **read-only stubs** until Phase 8.
- Phase 8 introduces v2 admin with a banner: "⚠️ Editing in v2 — close any v1 admin tabs."
- After cutover, v1 is archived and no longer accessible; v2 becomes the sole writer.

---

## 4. Tool interfaces (how the tools consume the same production code)

### 4.1 designLab (`v2/src/tools/designLab/`)
- **Purpose**: preview any production page inside lab chrome (variant switcher, viewport selector, theme selector).
- **Implementation**: iframe loads the actual production page (`/league_table.html?league=X`); lab chrome is sibling. Lab CSS is scoped to `.dl-*` selectors only.
- **Production parity**: 100% — what the lab shows IS production.
- **Differs from v1**: lab chrome no longer has its own duplicated styles. `.dl-*` selectors use the same tokens.

### 4.2 typoEditor (`v2/src/tools/typoEditor/`)
- **Purpose**: live UI to manage the 7 size + 4 weight + 4 icon-size system per the spec in `v2/docs/TYPOGRAPHY.md`.
- **Reads**: `v2/src/tokens/typography.css` (defaults), `v2/src/tokens/icon.css` (icon defaults), `v2/docs/TYPOGRAPHY-INVENTORY.md` (element registry).
- **Writes**:
  - Workspace overlay → `v2/src/tools/typoEditor/workspace.css` (gitignored or empty between sessions).
  - "Publish" action → rewrites token values in `v2/src/tokens/typography.css` and/or element rules in component CSS files, then clears workspace.
  - Inventory updates → `v2/docs/TYPOGRAPHY-INVENTORY.md` (appended when user confirms a newly-discovered element).
- **Controls per element**:
  - Size: 7-option dropdown (`--fs-micro` … `--fs-display`)
  - Weight: 4-option dropdown (`--fw-regular`/medium/subheading/heading = 400/500/600/700)
  - Icon-size (for icon elements only): 4-option dropdown + "inherit (em)"
- **Save history**: versioned snapshots in localStorage + JSON-in-comment of the workspace file. Restore any prior version.
- **Validation**: rejects raw rem/px input; rejects `!important`; warns on cross-page inconsistency.

### 4.3 tableLab (`v2/src/tools/tableLab/`)
- **Purpose**: preview every preset of every table variant, with live args editor and code snippet generator.
- **Implementation**: auto-discovers presets via `import.meta.glob('../tables/presets/*.js')`. Sidebar groups by `variant` declared in each preset. Right panel auto-generates form controls from the variant's `argsSchema.js`.
- **Production parity**: mounts the actual production `mountMFTable()` / `mountSFTable()` / etc. — never reimplements.
- **Code snippet panel**: outputs ready-to-paste import + mount call for the current args.
- **Iron rules panel**: renders the variant's `README.md` live next to the preview.

### 4.4 designCatalogue (`v2/src/tools/designCatalogue/`)
- **Purpose**: gallery of every primitive + component in every state (default, hover, focus, disabled, active).
- **Implementation**: auto-discovers primitives/components, renders each with all variants from its `argsSchema.js`.
- **Useful for**: visual regression baseline; reviewing tokens × themes coverage.

### 4.5 admin (`v2/src/pages/admin/`)
- **Purpose**: production admin UI (player manager, round editor, league manager, Excel importer, overrides list, CSV-validation report).
- **Consumes**: the unified `FormTable` (FF format) used by 5 admin tables — F1 Leagues, F2 Players (incl. F2b Add-League shared via `ffPlayersTableHTML`), F3 Round Editor, F4 View Overrides, F6 Medals & Prizes (shared between Edit + Add League via `ffMedalsTableHTML`). Cell mode chosen per-column (Display / Action / Edit); same data layer (`adminWriter.js`). The Excel importer additionally renders **F5 (CSV Import Preview)** as a read-only **MF** table (not FF) — `mountMFTable` with `fontClass:'font-small'`, `stickyCols:1`, showing only the "N updates" (played-in-upload, not already played, not override-covered) from `csvValidation.report.newMatches`.
- **Pending-Changes consolidation**: every admin write routes through `stagingStore.addChange` with a shared `group` per logical action (create-league, edit-players, create/edit-player folds flag+photo into the metadata group). A category-driven label formatter (`CATEGORY_META` + `renderLabel`) gives every row `{icon}  <b>{subject}</b> · {action}{ — detail}`. Manual overrides are **delta-staged**: each staged `manual_overrides.json` carries `baselineOverrides`; `diffOverrides` returns `{added, changed, removed}` and the UI shows only the delta (⚖️ added / ✏️ edited / ➖ removed). Labels drive off a semantic `category` field on each `addChange`, NOT the file path — this is the seam for the eventual DB-backed write target.
- **Phase**: ships disabled until Phase 8 to avoid write conflicts with v1 admin.

---

## 5. Phased execution (12 phases, each independently verifiable)

Each phase ends with a commit and an MCP verification checkpoint. If a phase fails verification, it's reworked before the next phase starts.

### Phase 0 — Bootstrap (1–2 hours)
- Create `v2/` directory.
- Initialize `package.json`, install Vite + Stylelint + ESLint + Vitest + Playwright.
- Write `vite.config.js` (multi-page entries pointing to placeholder HTMLs).
- Write `v2/.stylelintrc.json` with rules forbidding literal `font-size`, `color`, `font-weight` outside token files.
- Write `v2/README.md` and `v2/docs/MIGRATION-FROM-V1.md` (initial scaffolding).
- Set up `v2/scripts/data-sync.js` and the Vite alias for `../leagues`.
- Create empty `index.html` placeholders for each page.
- **Verification**: `cd v2 && npm run dev` boots, `http://localhost:5173/` serves a blank page. Vite hot-reload works.

### Phase 1 — Tokens + base + themes (3–4 hours)
- Port `css/variables.css` → split into `v2/src/tokens/{space,radius,shadow,motion,breakpoints}.css`.
- Create `v2/src/tokens/color.css` with the raw palette extracted from `css/themes.css`.
- Create `v2/src/tokens/typography.css` with 7 size + 4 weight tokens (per the slope formula).
- Create `v2/src/tokens/icon.css` with 4 icon-size tokens.
- Port `css/themes.css` + `css/theme.css` → `v2/src/themes/{light,dark,nature,vegas,ocean,sunset,forest,monochrome}.css` (one file per theme, each mapping `--c-*` raw colors to `--color-*` semantic names).
- Write `v2/src/base/{reset,root,elements,focus,a11y}.css`.
- Write `v2/src/index.css` with `@layer` order + all imports.
- Create `v2/src/tools/designCatalogue/catalogue.html` rendering all tokens as swatches.
- **MCP verification**: open `/designCatalogue.html` in v2 at 3 viewport widths × 8 themes. Take screenshots. Compare against v1's color swatches (theme picker in v1 → spot-check 5 themes). Record results in `v2/docs/PARITY-LOG.md`.

### Phase 2 — Primitives (4–5 hours)
- Build `v2/src/primitives/{Flag, Icon, Badge, Pill, Button, Link, Avatar, Tooltip, Chip, FormField}/`.
- Each primitive: one CSS file (token-only), one JS file with a single `render(props)` export.
- Each primitive: corresponding `*.test.js` if behavior is non-trivial (Button, Tooltip).
- Extend `designCatalogue` to render every primitive in every state.
- **MCP verification**: screenshot every primitive at 3 viewports × 8 themes. Compare against equivalent rendering in v1 (open v1 league_table.html, find a `.flag`, take a screenshot, compare). Allow ~2% pixel diff for sub-pixel rendering.

### Phase 3 — Components (5–6 hours)
- Build `v2/src/components/{Tabs, PlayerCell, StatusChip, TypePill, MedalRow, RankBadge, ScoreCell, ChartTooltip, Breadcrumbs, Navigation, ThemePicker, AdminButton, ExportButton, SearchBox, FilterPill, LeagueHero, PlayerHero, PlayerBarChart, ColorScale, Splash, ExportTableImage}/`.
- **`Tabs`** (added 2026-06-25, previously missing) ports v1 `js/render/appTabs.js` (`mountAppTabs`) + `css/tabs.css` as the canonical segmented app-tab bar consumed by the landing / league / player pages in Phase 6 — it must NOT be re-derived per page. Contract: `mount({ tabs:[{id,label,icon?}], urlKey, ariaLabel, … }) → { root, panels, activate }` with ARIA tablist + roving tabindex, `?tab=` URL state, 1-N hotkeys, and a per-tab **decorative `icon`** (emoji or inline SVG) rendered `aria-hidden` before an `.app-tab-label`. Ship a shared `tabIcons.js` (id→icon map) so shared concepts use one icon everywhere (Leagues = the table/grid SVG glyph reused from `SearchBox`/search results via `currentColor`; Matches = 🎲; Records = 📜; Leaderboard = 👑; Player insights = 📈). CSS is token-only under `@layer components` (port the `--color-surface`/`--color-hover`/`--shadow-sm` chrome + the per-theme dark-strip overrides). See the v1 form in [MIGRATION-FROM-V1.md](MIGRATION-FROM-V1.md) (2026-06-25 tab-icons row).
- Each component composes primitives + adds layout. CSS uses tokens only.
- Extract from `js/data/titleConstants.js` (TIER_COLORS) into `v2/src/data/titleStyleMap.js` (returns class names) + corresponding CSS classes in the title-related component CSS.
- Extract export-table rendering from `js/render/dashboardPage.js` (the B6a/B6b/B6c export functions) into `v2/src/components/ExportTableImage/`.
- Extend `designCatalogue`.
- **MCP verification**: each component screenshotted in catalogue × 8 themes. Side-by-side comparison with v1 equivalents.

### Phase 4 — Data + compute layers (2–3 hours)
- Port `js/data/{csvParser,leagueLoader,playersMetadata,settingsLoader}.js` → `v2/src/data/` (paths updated to use `/data/` Vite alias).
- Port `js/compute/{stats,rankings,leagueTypes,matchupAnalysis,championshipPredictor,whatIfSimulator}.js` → `v2/src/compute/` (unchanged logic).
- Rewrite `js/compute/colorScale.js` → returns CSS variable references (`var(--c-level-expert)`) instead of raw hex; move the actual color values to `v2/src/tokens/color.css`.
- Split `js/utils/helpers.js` into `v2/src/utils/{urlParams,formatting,flagUrl}.js`.
- Write unit tests in `v2/tests/unit/` for stats, rankings, color scale.
- **Verification**: `npm run test:unit` passes. Load a league via the data layer in a small test page; output matches v1.

### Phase 5 — Table system (6–8 hours)
- Build `v2/src/tables/{MFTable, SFTable, ExpandableTable, FormTable}/`. `FormTable` is the unified FF format covering 5 admin tables (three cell modes per ColDef: Display / Action / Edit).
- Each variant: own CSS (token-only), own JS (`mount(el, args)`), own `argsSchema.js`, own `README.md` with iron rules.
- Port all 23 presets to `v2/src/tables/presets/{A1..A7,B1..B6c,C0..C4,D,E,F1,F2,F3,F4,F5,F6}_*.js`. Each declares `export const variant = '...'` for lab auto-discovery. F1/F2/F3/F4/F6 use `variant: 'FF'`; **F5 is MF** (read-only CSV Import Preview — `mountMFTable`, `fontClass:'font-small'`, `stickyCols:1`); **A7 is SF** (Players directory — two stacked instances with shared cols, `tableId: 'A7'`, `fontClass: 'font-small'`, `stickyCols: 1`, second instance has `showTopN: 15`).
- Source files are the **canonized** v1 lab files at `table-lab/formats/{base,mf,sf,exp,ff}/*.css` (Path-X canonization landed 2026-06-04; legacy mirrors in `css/components.css` etc. lose by cascade). The `Units policy` doc-block at the top of `base.css` (em for sizing-with-font; px for hairlines/shadows/viewport-caps/breakpoints/JS-fallbacks) ports verbatim into v2 as a non-negotiable foundation rule.
- Build `v2/src/tools/tableLab/` with auto-discovery, args form, theme bridge, code snippet, iron rules panel.
- **MCP verification**: open `/tableLab.html` in v2; for each preset, screenshot the preview at 3 viewports × dark+light themes. Open the same preset in v1 (e.g., open v1 league_table.html for D, league.html for B-series). Pixel diff per cell — allow ≤2% delta for font rendering.

### Phase 6 — Pages: landing → league → dashboard → player → playerGeneral (8–10 hours)
- Build each page under `v2/src/pages/{name}/`. HTML composes shell + components + tables. CSS only contains page-specific layout. JS imports primitives/components/tables and wires data.
- One page at a time. After each page is built, run MCP parity check (see §6) against v1's equivalent page.
- Admin page deferred to Phase 8.
- **MCP verification per page**:
  1. Open v1 page in browser tab A, v2 page in tab B (same data).
  2. Match viewport (360 / 720 / 1440).
  3. Take screenshot of each.
  4. Measure font-size, font-weight, font-family, color, layout box for 10 representative elements per page using `getComputedStyle()`.
  5. Allowed delta: font-size identical to 0.01px; color identical to RGB integer; font-family identical; box position ≤2px diff.
  6. Record results in `v2/docs/PARITY-LOG.md`.

### Phase 7 — typoEditor + designLab (4–5 hours)
- Build `v2/src/tools/typoEditor/` per the typography spec: 7-size + 4-weight + 4-icon dropdowns; inventory-driven element registry; save-history; publish action; auto-discovery scanner.
- Build `v2/src/tools/designLab/` shell (iframe + chrome).
- Initial run of typoEditor's auto-discovery against each v2 page → populates `v2/docs/TYPOGRAPHY-INVENTORY.md`.
- **Verification**: editor round-trip — change a size assignment, save, reload, assignment persists. Click Publish, source tokens file updates, workspace empties.

### Phase 8 — Admin page (5–6 hours)
- Port `js/admin/{playerManager,roundEditor,leagueManager,overridesList,excelImporter,csvValidation,stagingStore}.js` to `v2/src/pages/admin/`.
- Wire 5 admin tables through the unified `FormTable` mount fn built in Phase 5: F1 Leagues, F2 Players (incl. F2b Add-League), F3 Round Editor, F4 View Overrides, F6 Medals & Prizes (shared between Edit + Add League). Decide at port time whether to extend `FormTable` to support F3's multi-row records (2-rows-per-match tbody with rowspan) or keep F3 hand-rolled while sharing FF chrome via CSS classes.
- Wire F5 CSV Import Preview as a read-only MF table inside the Excel importer (`mountMFTable`, `fontClass:'font-small'`, `stickyCols:1`) showing `csvValidation.report.newMatches` only.
- Implement `v2/src/data/adminWriter.js` using FileSystemAPI for browser writes (same as v1 uses). Adopt the Pending-Changes consolidation (`stagingStore` group/category, delta-staged overrides) — labels drive off semantic `category`, not file path, so the future DB-write seam is clean.
- Port the External Source sync admin card (Edit-League → External Source Sync) + the checkbox/radio scoped reset (currently in `css/admin.css`) into `src/primitives/FormField/`. NOTE: the "Sync together with" UI in `09e91af` was reverted by `4105779` (workflow now takes a LEAGUES JSON input directly) — do NOT port it. The CI infrastructure (`scripts/sync-source.js`, `.github/workflows/sync-source.yml`) lives outside v2 entirely.
- Show a prominent banner at top of v2 admin: "⚠️ Editing in v2 active. Close any v1 admin tabs."
- **MCP verification**: parity check against v1 admin. Test each admin action (add player, edit score, change league params, import Excel, edit medals/prizes) → confirm v2 and v1 produce identical file output by diff'ing the written files.

### Phase 9 — i18n extraction (3–4 hours)
- Sweep all v2 HTML/JS for Hebrew/English strings → extract to `v2/src/i18n/{he,en}.json`.
- Replace inline strings with `t('key')` calls.
- Add language switcher to nav (default: Hebrew, matching current behavior).
- **Verification**: switch language → all UI strings change; no untranslated strings remain (lint rule: `grep -rn '[֐-׿]' src/ --exclude-dir=i18n` returns nothing).

### Phase 10 — Tests + CI gates (3–4 hours)
- Visual regression suite: Playwright takes a screenshot per page × viewport × theme; compared against committed baselines.
- A11y: axe-core run per page.
- Parity suite: `scripts/parity-runner.js` does the v1↔v2 side-by-side check; runs nightly.
- Stylelint gate: no literal font-size, color, font-weight outside token files.
- Grep gate: `scripts/grep-gates.sh` (forbidden patterns: `!important` on typography, `<strong>`/`<b>` for visual styling, etc.).
- Inventory gate: every textual element appears in `TYPOGRAPHY-INVENTORY.md`.
- **Verification**: `npm run ci` passes all gates.

### Phase 11 — Documentation finalization (2 hours)
- Complete `v2/docs/{ARCHITECTURE,TYPOGRAPHY,TABLE-DESIGN,THEMES,COMPONENTS,ADMIN,MIGRATION-FROM-V1,CHANGELOG}.md`.
- Update root `CLAUDE.md` with a "v2 cutover imminent" note.
- Final review of `PARITY-LOG.md`: every page must show full parity.

### Phase 12 — Cutover (1 hour)
- Final MCP parity sweep (all pages × all viewports × all themes).
- Run `v2/scripts/migrate-v1-to-v2.sh`:
  ```bash
  mkdir -p _archive_v1
  mv css js table-lab admin.html league.html league_table.html \
     player_league.html player.html design-lab.html typo-editor.html \
     design-catalogue.html index.html docs _archive_v1/
  mv v2/* v2/.* .  2>/dev/null || true
  rmdir v2
  npm run build
  npm run test
  ```
- Single commit: `feat(rebuild): cut over from v1 to v2 (clean architecture)`.
- 24-hour soak period observing production.
- If stable: separate cleanup commit removes `_archive_v1/`.

---

## 6. MCP verification protocol (per-page parity check)

This is the heartbeat of safety — repeated after every page is built and at every cutover gate. Implemented in `v2/scripts/parity-runner.js` which uses Playwright MCP.

### 6.1 Per-page protocol
```
For each page (landing, league, dashboard, player, playerGeneral, admin):
  For each viewport (360, 720, 1440 px):
    For each theme (light, dark, nature, vegas, ocean, sunset, forest, monochrome):
      1. Navigate v1 to http://localhost:8090/{page}.html?{params}
      2. Navigate v2 to http://localhost:5173/{page}.html?{params}
      3. Set viewport size on both
      4. Set theme on both
      5. Wait for network idle
      6. Take screenshot of each
      7. For each of N sentinel selectors per page:
         - getBoundingClientRect()
         - getComputedStyle() → font-size, font-weight, font-family, color
         - Assert v1 == v2 (within tolerances)
      8. Pixel-diff screenshots (allow 2% delta)
      9. Append result to PARITY-LOG.md
```

### 6.2 Sentinel selectors per page (initial set; grows as needed)
| Page | Selectors |
|---|---|
| landing | `.idash-card-title`, `.completed-leagues-table td`, `.annual-leaderboard-table td.player-cell`, `.nav-home` |
| league | `#leagueTable td`, `#leagueTable th`, `#leagueTable td.player-cell`, `#leagueTable tr.avg-row td`, `.lh13-card`, `.lh13-name`, `.breadcrumbs .current`, `.nav-home`, `.league-type-pill`, `.status-pill` |
| dashboard | `.dash-card-value`, `.dash-card-label`, `.dash-section h2`, `.matchup-pr-best`, `.matchup-table td`, `.breadcrumbs .current` |
| player | `#playerTable td`, `#playerTable th`, `.pg-v7-name`, `.pg-pr-value`, `.pg-tile-value` |
| playerGeneral | `.pg-v12-display`, `.pg-pr-card`, `.pg-tile-title`, `.pg-leagues-table td`, `.pg-matches-table td` |
| admin | `.admin-large-title`, `.admin-input-label`, `.admin-table-cell`, `.admin-button-text` |

### 6.3 Tolerances
| Property | Allowed delta |
|---|---|
| font-size (px) | 0.01px |
| font-weight | exact match |
| font-family | exact match |
| color (RGB) | exact match |
| box width/height | ≤2px |
| box position | ≤2px |
| pixel diff (screenshot) | ≤2% of pixels differ; no diff > 8 RGB units |

### 6.4 Parity log format
`v2/docs/PARITY-LOG.md`:
```markdown
# Parity Log

## 2026-05-26 — league_table.html @ vw=720 × theme=dark
| Selector | Property | v1 | v2 | Δ | Pass |
|---|---|---|---|---|---|
| #leagueTable td | fontSize | 12.036px | 12.036px | 0 | ✓ |
| #leagueTable td | color | rgb(248,250,252) | rgb(248,250,252) | 0 | ✓ |
| ... | ... | ... | ... | ... | ✓ |

Screenshot diff: 0.4% — PASS
```

### 6.5 Verification gates
- **Per phase**: at minimum, the pages touched in that phase pass parity at 3 viewports × 2 themes (light + dark).
- **Pre-cutover**: every page passes parity at 3 viewports × all 8 themes. Zero failures allowed.

---

## 7. Critical files / paths summary

**Created (under `v2/`):**
- Everything under `v2/`. ~150 files total at the end.

**Modified (outside `v2/`):**
- `c:\WORKSPACE\Shabi_Israel\CLAUDE.md` — add v2 section (Phase 0).
- `c:\WORKSPACE\Shabi_Israel\.gitignore` — add `v2/node_modules/`, `v2/dist/`, `v2/.vite/` (Phase 0).

**Untouched until cutover:**
- All existing root files: `css/`, `js/`, `table-lab/`, `leagues/`, `docs/`, all `*.html`, `landingPage` redirect, `.mcp.json`.

**Cutover commit:**
- One scripted commit moves v1 files to `_archive_v1/` and promotes `v2/` contents to root.

---

## 8. Risk register

| Risk | Probability | Mitigation |
|---|---|---|
| v1 keeps drifting during 4–5-week rebuild | Medium | Hold v1 feature freeze; bug fixes ported into `v2/docs/MIGRATION-FROM-V1.md` and re-applied to v2 |
| Admin write collision (v1 + v2 both edit data) | Low if disciplined | v2 admin is read-only until Phase 8; visible warning banner thereafter |
| Hidden edge case in compute lost in port | Medium | Unit tests of compute functions in Phase 4; spot-check key league outputs match v1 |
| Vite multi-page config quirk | Low | Phase 0 ends with a working `npm run dev` + a working `npm run build` |
| Cutover script fails mid-execution | Low | Script is idempotent; archive-first design means files are preserved even on partial failure; rehearse on a copy of the repo |
| Visual regression I miss | Medium | MCP parity check on every page × every viewport × every theme; ≤2% pixel diff tolerance |
| User opens admin in v1 after v2 admin ships | Low | Banner + after cutover v1 is archived; localStorage flag warns of stale tabs |
| Themes look subtly different (sub-pixel font rendering, color profile) | Low–medium | Visual regression with tolerance; if a theme diverges, regenerate it from v1's computed values |
| Time overrun (4–5 weeks → 8 weeks) | Medium | Phases are independently shippable; we can cut over partial v2 and complete remaining pages incrementally if needed |

---

## 9. Time estimate

| Phase | Time | Cumulative |
|---|---|---|
| 0 — Bootstrap | 1–2h | 2h |
| 1 — Tokens/themes | 3–4h | 6h |
| 2 — Primitives | 4–5h | 11h |
| 3 — Components | 5–6h | 17h |
| 4 — Data/compute | 2–3h | 20h |
| 5 — Table system | 6–8h | 28h |
| 6 — Pages (5 of them) | 8–10h | 38h |
| 7 — typoEditor + designLab | 4–5h | 43h |
| 8 — Admin | 5–6h | 49h |
| 9 — i18n | 3–4h | 53h |
| 10 — Tests/CI | 3–4h | 57h |
| 11 — Docs | 2h | 59h |
| 12 — Cutover | 1h | 60h |

**Total**: ~60 hours of focused work. Spread over real-time: 2–3 weeks if dedicated full-time; 5–6 weeks at 2–3 hours/day.

---

## 10. Exit criteria (definition of "done")

Cutover proceeds only when ALL of these are true:

- [ ] All 5 production pages + admin parity-verified at 3 viewports × 8 themes (zero failures).
- [ ] All 23 table presets (A1-A7, B1-B6c, C0-C4, D, E, F1-F6) render in tableLab matching v1.
- [ ] typoEditor round-trips: read defaults, overlay, save history, publish, inventory write — all confirmed working.
- [ ] `npm run ci` passes: Stylelint gates, grep gates, inventory gate, unit tests, visual regression suite, a11y.
- [ ] `v2/docs/PARITY-LOG.md` shows green across the board.
- [ ] `v2/docs/MIGRATION-FROM-V1.md` is complete (every v1 file mapped to a v2 destination).
- [ ] CLAUDE.md updated for the post-cutover world.
- [ ] Cutover script rehearsed on a temp copy of the repo.

If any criterion fails, the failing scope is re-worked; cutover is deferred. The rebuild is reversible at any time before the cutover commit lands; after cutover, `git revert HEAD` restores v1 from `_archive_v1/`.
