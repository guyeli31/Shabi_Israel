# Plan — Table-Lab as the canonical source for all tables

**Status:** in progress — Phase 1 ✅ Phase 2 ✅ Phase 3 🔄 (partial) Phases 4–9 ⏳
**Owner:** ravivb7
**Created:** 2026-05-11
**Last updated:** 2026-05-15

---

## Goal (final state)

1. **Every table in the project is rendered by calling into `table-lab`.**
   - The lab hosts **five formats**, each with its own dedicated mount function:

     | Format | Code | Used by | Mount fn |
     |---|---|---|---|
     | Main Format | **MF** | A1, A2, D, E, all B, C1, C2, C3 | `mountMFTable` |
     | Secondary Format | **SF** | A3, A4, A5, A6, C4 | `mountSFTable` |
     | Expandable Format | **exp** | C0 | `mountExpTable` |
     | Form Format 1 | **FF1** | F1 (League Manager) | `mountFF1Table` |
     | Form Format 2 | **FF2** | F2 (Round Editor) | `mountFF2Table` |

   - Each table is produced by its own preset module (per `tableId`), bound to one of the five formats. The preset owns the data shape, column config, and any table-specific decorations (sticky cols, medal rows, show-top-N, sort, image-export, inline-edit, etc.).
   - Production pages (`index.html`, `league.html`, `player.html`, `player-general.html`, `dashboard.html`, `admin.html`) consume those functions — they do not own table-rendering code.

2. **The project is free of any vestigial table styling / behavior.**
   - `css/components.css` contains zero table-specific rules — only shared atom components (flags, medals, pills, badges) and non-table UI (matchup card chrome, charts, export buttons).
   - No table-related JS lives outside `table-lab/` and its preset modules.

3. **The lab is modular, accessible, and the single source of truth.**
   - Opening `table-lab/index.html` renders every table type (across all 5 formats) at full width with its real data.
   - Production loads the lab's renderers + CSS as dependencies. No drift possible.
   - Adding a new table = define a preset bound to the appropriate format. Adding a new format = add `table-lab/formats/<name>/`.

---

## Honest decision: which to do first?

**Build the lab catalog first; clean the project second.**

Reasoning:
- The lab already has draft implementations of every table type in `lab-loader.js`. Completing the catalog is small **additive** work, zero risk to production.
- Cleanup is a one-shot rewiring. You want every target to exist as a clean lab function **before** you start flipping production imports — otherwise you stall mid-sweep on missing pieces.
- Visual verification is straightforward when lab is canonical: open lab, see the table, compare with production. If you do cleanup first, lab and production drift while you work.
- The current uncommitted refactor (A1/A2 already migrated, A1 font shrank, A2 "Tot" got bolded) demonstrates the failure mode of cleanup-before-canon — small regressions slip in because the canon isn't frozen.

**Order:** lock lab catalog → lock CSS canon → rewire production → delete old code.

---

## Pre-flight: resolve the uncommitted-state deltas

The current working tree has an unfinished refactor that already migrated A1 and A2 onto `mountMFTable` but introduced visual/behavior changes. Before any further work, each delta gets an explicit keep/revert decision:

| # | Where | Old | New (uncommitted) | Decision |
|---|---|---|---|---|
| 1 | A1 font | `font-large` | `font-small` | **TBD** |
| 2 | A2 "Tot" header | `Tot` | `<b>Tot</b>` | **TBD** |
| 3 | A2 show-top-N | `applyShowTopN(t)` (default) | `showTopN: 5` | **TBD** |
| 4 | A2 sticky col measurement | `measureLeaderboardStickyCols(w)` | not called | **TBD** — likely a regression to fix |
| 5 | A2 column sortability | none | many columns sortable | **TBD** |
| 6 | Matchup wrapper visual | `radius-sm` + border + no shadow | `.mf-wrap` (`radius-md` + no border + `shadow-md`) | **TBD** |

Items confirmed safe (dead code in HEAD): `data-label="..."` attrs on A1 cells, `class="row-type-${type}"` on A1 rows. No CSS consumed them.

---

## CSS classification (groundwork for the canon split)

`css/components.css` selectors are classified into three groups. Group A moves to the lab; Groups B and C stay where they are.

### Group A — Pure table internals → move to `table-lab/`

Group A is **split into two sub-groups** so that SF and exp formats (Phases 5–6) can reuse the truly-shared base rules without duplicating them, and the destructive deletion from `components.css` (Phase 7) is safe.

#### Group A-base → `table-lab/formats/_base/base.css`

Rules shared by **every** table format (MF + SF + exp; FF1/FF2 may opt in). Loaded by every format's CSS via `@import` (or stacked `<link>` tags in the lab and in production).

- `table.font-large`, `table.font-small` (font enum — used by all formats)
- Generic `table { width, border-collapse, border-spacing, font-size }`
- `thead { position: sticky; top: 0; z-index: 3 }`
- `thead th { background, color, padding, font-weight, text-align, white-space, cursor, user-select, transition }`
- `thead th:hover`
- `tbody td { padding, text-align: center, box-shadow hairline, white-space }`
- `tbody tr:hover`
- `tbody tr:last-child td { box-shadow: none }`
- `td.player-cell` + its `a` styles (color, hover, no-underline)
- `tr.unplayed` + descendants (`td`, `td.player-cell`, `td.player-cell a`)
- `tr.retired` (opacity)
- `tr.rank-gold`, `tr.rank-silver`, `tr.rank-bronze` row tint + their `:hover` variants
- `.level-cell`
- `.color-scaled`
- Mobile `.pg-mr-table` matrix-compression rules (used by C-series tables across formats)

#### Group A-MF → `table-lab/formats/mf/mf.css`

Rules exclusive to the MF format (`.mf-wrap` wrapper and its specific layouts).

- `.mf-wrap` (wrapper card: `overflow-x: auto`, `overflow-y: clip`, `min-width: 0`, optional `border-radius`, `box-shadow`)
- `.mf-wrap thead th`, `.mf-wrap tbody td` (text-align override: left, per Iron Rule 7)
- `.mf-wrap .flag` (flag-height variable hookup)
- `.mf-wrap .total-col`, `.mf-wrap .player-col`, `.mf-wrap .month-col` (col-layout helpers — only meaningful in MF tables)
- `.mf-wrap tbody tr.rank-gold/silver/bronze td` (medal-row backgrounds — they need wrapper scope so they don't bleed to SF/exp)
- `.mf-wrap tbody tr.avg-row td`, `.mf-wrap tbody tr.unplayed td` (MF-wrapper-scoped variants if any)
- `.mf-wrap.is-scrolled-x` sticky-shadow rules
- `.mf-wrap tbody tr.player-remaining-divider`, `.mf-wrap tbody tr.b6b-bold` (B6b/B6c MF-only row variants)
- `thead th .sort-icon`, `thead th.sorted .sort-icon` (sort-arrow UI — currently MF-only; if SF ends up sortable too, promote to A-base later)
- `tr.avg-row`, `tr.avg-row td`, `tr.stat-row`, `tr.stat-row td` (summary rows — MF-specific currently)
- `#leagueTable` sticky-col rules (D table — MF-exclusive)
- `#playerTable` sticky-col rules (E table — MF-exclusive)
- `.is-scrolled-x #leagueTable *`, `.is-scrolled-x #playerTable *` (sticky shadow on D/E)
- `.show-more-btn` (Show-all toggle that lives just below `.mf-wrap`)

**Note on `#leagueTable`/`#playerTable` ID selectors:** these stay in `mf.css` as-is for the first pass. The long-term refactor target is `[data-mf-table-id="D"]` / `[data-mf-table-id="E"]` — tracked as tech debt, not in scope for this plan.

### Group B — Shared atoms → stay in `css/components.css`

Used **both** inside tables and on standalone landing/player/admin pages. Tables consume them via class names; we don't relocate them.

| Atom | Non-table call sites |
|---|---|
| `.flag` | `landingPage.js:659` (Notable Figures), `playerGeneralPage.js:588` |
| `.flag-title` | `playerPage.js:66`, `playerGeneralPage.js:161` (profile headers) |
| `.medal`, `.medal-gold/silver/bronze` | demo HTML, hero badges (potential) |
| `.status-pill`, `.status-running`, `.status-completed` | `dashboardPage.js:69`, `landingPage.js:712`, `admin/leagueManager.js` |
| `.league-type-pill`, `.type-doubling/regular/ubc` | `landingPage.js:711`, `admin/leagueManager.js` |
| `.title-abbr*` (gold/silver/bronze/white/champ) | `titleConstants.js` — used next to player names everywhere |
| `.retired-badge`, `.retired-mark`, `.player-hidden` | `playerPage.js:44`, other player areas |
| `.result-win/loss/draw` | result coloring in non-table contexts |
| Mobile-block overrides on `.medal` / `.flag` sizes | same atoms |

### Group C — Not table material → stay in `css/components.css`

- `:focus-visible` global a11y rules
- `.img-export-btn` (button next to tables, not part of them)
- `.landing-table` legacy styling
- `.last-updated`, `.games-played` page meta text
- All `.matchup-*` card chrome (header, search dropdown, empty state). **Edge case:** `table.matchup-table` rules are arguably Group A but the matchup table is not yet on the `.mf-wrap` pipeline — unify in a later pass.
- `.chart-panel`, `.bar-chart-canvas`, `.chart-info-panel*` (charts, not tables)

---

## Phase 1 — Lock the MF lab catalog (additive, no production risk)

**Scope:** **MF format only.** SF, exp, FF1, FF2 are handled in later phases.

**Outcome:** every MF-format table the project renders has a dedicated lab function and preset with full visual fidelity.

### 1.1 Inventory existing lab coverage
Walk through `table-lab/lab-loader.js` and list `buildA1`, `buildA2`, ..., `buildE`. For each, verify it produces a preset that matches the production look exactly.

### 1.2 Identify gaps
For each MF table (A1, A2, B1–B6c, C1, C2, C3, D, E):
- Is there a lab `build<X>` function?
- Does it render with the right columns, sticky cols, font class, medal rows, show-top-N, sort behavior, image-export hook?
- Side-by-side visual comparison with production.

### 1.3 Fill gaps
For each missing MF table, add a `build<X>` function to `lab-loader.js` and a tab to `table-lab/index.html`. Use the existing presets in `js/presets/` as data-shape references.

### 1.4 Polish: lab as a design surface
- Each table gets its own preset module under `table-lab/presets/` (mirrors `js/presets/` structure).
- Each preset exports `buildX(input)` returning `{ tableId, data, cols, fontClass, stickyCols, medalRows, medalCounts, showTopN, mfMb, flagSize, ... }`.
- `lab-loader.js` becomes a thin orchestrator that fetches real data and hands it to the preset.

### 1.5 Acceptance gate
- Every MF production table has a working tab in the lab.
- Visual diff against production: pixel-identical (modulo any deltas from the pre-flight section that were intentionally accepted).
- Sort, hover, sticky shadow, show-top-N, image export all behave identically.

---

## Phase 2 — Build the lab's CSS canon (additive only — no deletions)

**Outcome:** the lab owns canonical CSS files for the base layer and the MF format. `components.css` is **untouched**.

### 2.1 Create `table-lab/formats/_base/base.css`
Copy every Group A-base selector from `css/components.css` into this new file. Preserve order and comments.

### 2.2 Create `table-lab/formats/mf/mf.css`
Copy every Group A-MF selector from `css/components.css` (and from `table-lab/lab.css`'s `.mf-wrap` block) into this new file. The file starts with `@import url("../_base/base.css");` so MF consumers get the base layer automatically.

### 2.3 Keep duplicates intentionally
- **Do NOT delete anything from `css/components.css` yet.** Production still loads it; cascade-equal duplication is safe (lab + components.css have identical rules).
- Delete the `.mf-wrap` block from `table-lab/lab.css` only (it's lab-internal — no production effect).

### 2.4 Update lab to load the canon
`table-lab/index.html`:
```html
<link rel="stylesheet" href="../css/variables.css">
<link rel="stylesheet" href="../css/themes.css">
<link rel="stylesheet" href="./formats/mf/mf.css">   <!-- MF (auto-imports _base) -->
<link rel="stylesheet" href="./lab.css">             <!-- lab chrome only -->
<link rel="stylesheet" href="../css/theme-picker.css">
```
Stop loading `../css/components.css` from the lab.

### 2.5 Verify lab still looks correct
Run lab, walk every preset tab, confirm visual identity.

### 2.6 Promote `mountMFTable` to live in the lab
Move `js/render/mountMFTable.js` → `table-lab/formats/mf/mount.js` (default-export `mountMFTable`). Convert `js/render/mountMFTable.js` into a re-export shim (`export * from '../../table-lab/formats/mf/mount.js'`) for transitional compatibility. Production keeps working unchanged.

---

## Phase 3 — Rewire production MF tables to the lab (additive — no deletions)

**Outcome:** production MF tables render via the lab path. `components.css` is **still untouched.**

### 3.1 CSS — production loads the lab canon
Each production HTML adds (alongside the existing `<link>` to `components.css`):
```html
<link rel="stylesheet" href="table-lab/formats/mf/mf.css">
```
After this, production has Group A rules from **two** sources: `components.css` and `mf.css` (which auto-imports `base.css`). Cascade-equal, no visual change.

### 3.2 JS — production imports from the lab
Replace every direct `import` of `js/render/mountMFTable.js` with `import { mountMFTable } from '../table-lab/formats/mf/mount.js'`.

Replace every hand-built `<table>` HTML for an MF table in production render modules with a `mountMFTable(mountPoint, preset)` call, using the appropriate lab preset.

MF touch points:
- `js/render/landingPage.js` — A1, A2
- `js/render/leaguePage.js` — D
- `js/render/playerPage.js` — E
- `js/render/playerGeneralPage.js` — C1, C2, C3
- `js/render/dashboardPage.js` — B1–B6c

**Out of scope here:** A3–A6 (SF — Phase 5), C0 (exp — Phase 6), C4 (SF — Phase 5). These keep their current render path; the duplicate `components.css` rules keep them styled.

### 3.3 Acceptance gate
- All MF tables in production render via the lab.
- Visual diff against the pre-refactor baseline: pixel-identical (modulo accepted deltas).
- Sort, hover, sticky, show-top-N, image export, context menus all behave identically.
- `components.css` is unchanged from pre-refactor state (verify with `git diff`).

---

## Phase 4 — MF JS-side cleanup (still no `components.css` deletion)

**Outcome:** MF table JS is fully consolidated in the lab; legacy JS paths removed. `components.css` is **still untouched** because SF and exp aren't locked yet.

### 4.1 Delete the `mountMFTable` shim
Remove `js/render/mountMFTable.js`. Update any stragglers that still imported from the old path so they import from `table-lab/formats/mf/mount.js`.

### 4.2 Delete legacy MF table-render JS
Any code in `js/render/*.js` that built MF tables by hand-concatenating HTML is removed. The render modules for MF tables become orchestrators that wire data → preset → `mountMFTable`.

### 4.3 Defer CSS deletion
**Intentionally:** Group A still lives in `css/components.css` because SF (A3–A6, C4) and exp (C0) still depend on the shared base rules (`table`, `thead`, `tbody td`, font enum, `td.player-cell`, etc.). Destructive deletion happens in Phase 7, after every format is locked.

### 4.4 Sanity check
- `grep` for `js/render/mountMFTable.js` imports → expect zero hits.
- `grep` for hand-built `<table>` HTML in production MF render code → expect zero hits.
- `components.css` is unchanged from pre-refactor state (verify with `git diff`).

---

## Risks and open questions

1. **Matchup table is a parallel system.** It has its own `table.matchup-table` rules and doesn't currently go through `.mf-wrap`. Unifying it is a non-trivial sub-project — recommend deferring to a Phase 5 unless the user wants it bundled.

2. **`#leagueTable` and `#playerTable` use ID selectors.** Group A includes these as-is, but the proper long-term form is `[data-mf-table-id="D"]` / `[data-mf-table-id="E"]`. Plan to refactor in Phase 2.5 or note as tech debt.

3. **Admin tables (`leagueManager.js`).** They use `.league-type-pill` and `.status-pill` but render their own table HTML with `data-label` mobile pattern. They are **outside** the MF table system intentionally. Confirm with the user that admin stays separate.

4. **`landing-table` legacy class.** Currently Group C (stays). Is it dead code? Worth a grep — if no production HTML uses it, delete in Phase 4.

5. **Phase 1.4 design surface ambition.** Splitting `lab-loader.js` into per-table preset modules is nice-to-have but adds scope. Could be deferred.

6. **No automated visual regression tests.** Every acceptance gate relies on manual side-by-side inspection. If the user wants screenshot-diff coverage, add a small Playwright script in Phase 1.5.

---

## Phase 5 — SF format (Secondary Format)

**Scope:** A3, A4, A5, A6, C4.

**Outcome:** SF is the canonical format for compact records / leaderboards-snippet tables. Each of A3–A6 and C4 is rendered through `mountSFTable` with a dedicated preset.

### 5.1 Inventory current SF-target tables
Read the existing render code for A3, A4, A5, A6, C4. Catalog:
- DOM shape produced today
- CSS rules each table relies on
- Interactions (sort? show-top-N? row hover? click-through?)
- Data shape consumed

### 5.2 Define SF args schema
Based on the inventory, derive the args schema for `mountSFTable` and document it in `docs/TABLE-DESIGN.md` under the SF section (currently stubbed).

### 5.3 Implement `table-lab/formats/sf/`
- `mount.js` — `mountSFTable(mountPoint, args)`
- `sf.css` — canonical SF styles (own wrapper class, e.g. `.sf-wrap`). Starts with `@import url("../_base/base.css");` so SF reuses the shared base layer.
- Add each A3/A4/A5/A6/C4 preset under `table-lab/presets/`
- Add tabs to `table-lab/index.html`

### 5.4 Acceptance gate
- Every SF table renders in the lab with real data, pixel-identical to current production.
- Sort/show-top-N/hover work identically.

### 5.5 Production rewire (deferred to Phase 7 sweep)
Production migration happens in Phase 7 alongside MF cleanup — keeps the lab work pure and reversible.

---

## Phase 6 — exp format (Expandable Format)

**Scope:** C0.

**Outcome:** exp is the canonical format for collapsible-row / expandable-content tables. C0 is rendered through `mountExpTable` with a dedicated preset.

### 6.1 Inventory C0
Read the existing C0 render code. Catalog DOM shape, expand/collapse interaction model, expandable content schema (what goes inside an expanded row?), CSS rules.

### 6.2 Define exp args schema
Derive the args schema for `mountExpTable`, including the `renderExpansion(row)` callback or similar. Document in `docs/TABLE-DESIGN.md` under the exp section.

### 6.3 Implement `table-lab/formats/exp/`
- `mount.js` — `mountExpTable(mountPoint, args)`
- `exp.css` — canonical exp styles. Starts with `@import url("../_base/base.css");` so exp reuses the shared base layer.
- C0 preset under `table-lab/presets/`
- Tab in `table-lab/index.html`

### 6.4 Acceptance gate
- C0 renders in the lab with real data, pixel-identical to current production.
- Expand/collapse interaction works identically.

---

## Phase 7 — SF + exp production rewire, then the **only destructive sweep**

**Outcome:** all non-admin tables in production are rendered through `table-lab/`. `css/components.css` no longer contains table-specific rules. This is the only phase that deletes from `components.css`.

### 7.1 Add SF + exp CSS to production
Each production HTML that currently consumes A3–A6, C4, or C0 adds:
```html
<link rel="stylesheet" href="table-lab/formats/sf/sf.css">    <!-- if SF tables on this page -->
<link rel="stylesheet" href="table-lab/formats/exp/exp.css">  <!-- if C0 on this page -->
```
Both files `@import` `_base/base.css`, so production now has Group A-base rules from **two** sources: `components.css` and the lab. Cascade-equivalent — no visual change.

### 7.2 JS rewiring for SF + exp
Replace direct rendering for the remaining tables:
- SF tables (A3, A4, A5, A6, C4) → `mountSFTable`
- exp tables (C0) → `mountExpTable`

Touch points:
- `js/render/landingPage.js` — A3, A4, A5, A6 (SF)
- `js/render/playerGeneralPage.js` — C0 (exp), C4 (SF)

After this step, every non-admin table in production renders through the lab.

### 7.3 Pre-deletion grep gate (mandatory)
Before any selector is removed from `components.css`, prove it is no longer needed:

For each selector slated for deletion (from the Group A list — both A-base and A-MF):
1. Confirm the selector exists in `table-lab/formats/_base/base.css` OR in a format-specific CSS file (`mf/mf.css`, `sf/sf.css`, `exp/exp.css`).
2. `grep` the project for any consumer that loads `components.css` but **not** the relevant lab CSS file. Expect zero — production HTML pages were all updated in Phase 7.1.

Selectors that fail either check are **not deleted** — they belong to Group B or C and must stay. Update the classification document if the analysis was wrong.

### 7.4 Delete Group A from `css/components.css`
Only after the gate passes: remove every selector classified as Group A (both A-base and A-MF) from `components.css`. Group B (shared atoms) and Group C (non-table UI) remain untouched.

### 7.5 Acceptance gate
- Every production page loads and renders correctly.
- Visual diff against pre-refactor baseline: pixel-identical (modulo accepted deltas).
- Zero hand-built `<table>` HTML in `js/render/` for non-admin tables.
- `grep` for `.mf-wrap`, `.sf-wrap`, table-class selectors in `css/components.css` → expect zero hits.

---

## Phase 8 — FF1 / FF2 formats (Admin tables)

**Scope:** F1 (League Manager), F2 (Round Editor).

**Outcome:** admin tables are also rendered through `table-lab/`. The lab becomes the canonical source for *every* table in the project.

> **Note:** admin tables are CRUD editors, not display tables. Migrating them to the lab is genuinely useful (single source of truth for table look-and-feel across the whole app) but is materially more complex than MF/SF/exp because they involve inline editing, validation, and per-row save/delete actions. This phase is **optional** if scope needs to be cut — admin tables can keep their current render path indefinitely without affecting the lab's role as canon for display tables.

### 8.1 FF1 — League Manager
- Inventory `js/admin/leagueManager.js` table-rendering code.
- Define FF1 args schema (must include: inline-edit cells, save callback, delete callback, status/type pills, mobile `data-label` card pattern).
- Implement `table-lab/formats/ff1/mount.js` + `ff1.css`.
- Add F1 preset under `table-lab/presets/`.
- Add tab to lab.
- Rewire `leagueManager.js` to use `mountFF1Table`.

### 8.2 FF2 — Round Editor
- Inventory `js/admin/roundEditor.js` table-rendering code.
- Define FF2 args schema (must include: round/match data model, score input handlers, per-cell validation, result inference).
- Implement `table-lab/formats/ff2/mount.js` + `ff2.css`.
- Add F2 preset under `table-lab/presets/`.
- Add tab to lab.
- Rewire `roundEditor.js` to use `mountFF2Table`.

### 8.3 Acceptance gate
- F1 and F2 render in the lab and in production with full functionality.
- Edit / save / delete / validation behave identically to pre-refactor.
- `css/admin.css` no longer contains FF1/FF2 table-specific rules.

---

## Phase 9 — Final cleanup

**Outcome:** zero residue of the pre-refactor table system anywhere.

- Delete duplicated lab styles in `table-lab/lab.css` (anything that was a copy of a format CSS).
- Delete legacy render code (anything in `js/render/*.js` that built tables by hand-concatenating HTML).
- Final sweep: `grep` for `.mf-wrap`, table-class names, hand-built `<table>` HTML across the project → expect hits only inside `table-lab/`.

---

## Phase summary

`components.css` is touched **only in Phase 7**. Every prior phase is additive (or JS-only).

| Phase | What | Scope | Touches `components.css`? | Risk | Reversibility |
|---|---|---|---|---|---|
| Pre-flight | Resolve 6 uncommitted deltas | All | No | Low — design decisions only | n/a |
| 1 | MF lab catalog complete | MF | No | None (additive) | Trivial |
| 2 | Create `_base/base.css` + `mf/mf.css` (copy, not move) + promote `mountMFTable` to lab | MF | No (duplicate rules in lab) | Low | Delete new lab files |
| 3 | Production MF tables also load lab CSS + import lab JS | MF | No (added `<link>`) | Low | Remove the added `<link>` and revert imports |
| 4 | Remove `mountMFTable` shim + legacy MF render JS | MF | No | Low | git revert |
| 5 | SF format in lab (`formats/sf/`) | SF | No | None (additive) | Trivial |
| 6 | exp format in lab (`formats/exp/`) | exp | No | None (additive) | Trivial |
| 7 | SF + exp production rewire, **pre-deletion grep gate**, **delete Group A from `components.css`** | SF, exp + CSS sweep | **YES — only here** | Medium (gated) | git revert deletion commit |
| 8 | FF1 + FF2 (admin) | FF1, FF2 (optional) | No (admin CSS lives in `admin.css`) | High — touches admin CRUD | Per-file revert |
| 9 | Final cleanup (lab.css de-duplication, residue sweep) | All | No | Low | git revert |

---

## Acceptance — overall

When all phases complete:

- ☐ `table-lab/index.html` renders every table in the project (across MF, SF, exp, FF1, FF2) with real data.
- ☐ `table-lab/formats/<format>/` is the only place each format's styling and rendering lives.
- ☐ Each table has a dedicated preset module in `table-lab/presets/`.
- ☐ `css/components.css` contains only shared atoms and non-table UI.
- ☐ `css/admin.css` contains no FF1/FF2 table-specific rules (after Phase 8).
- ☐ Production pages load the lab's CSS and import from `table-lab/`.
- ☐ Pixel-identical to pre-refactor baseline (modulo accepted deltas).
- ☐ Zero hand-built table HTML anywhere outside `table-lab/`.
