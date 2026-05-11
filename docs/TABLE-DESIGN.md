# Table Design

Single source of truth for table design rules and table code mapping.
When defining or modifying a table: read this document, compare with what the user provided, and explicitly ask about any required parameter that was not defined.

---

## Part 1 — Table Mapping

Table code mapping for the app. All future references to a table use the code below.

### A — Index (index.html)

| Code | Table name |
|---|---|
| A1 | Completed Leagues |
| A2 | Annual Leaderboards |
| A3 | Achievements |
| A4 | PR Leaders |
| A5 | Match Records |
| A6 | League Records |

### B — Dashboard / League overview (dashboard.html)

| Code | Table name |
|---|---|
| B1 | Prizes & Medals |
| B2 | Historical view |
| B3 | Championship Predictor |
| B4 | What If Simulator |
| B5 | Rounds |
| B6a | All Remaining |
| B6b | Remaining Report |
| B6c | Remaining Per Player |

### C — Player General (player-general.html)

| Code | Table name |
|---|---|
| C0 | Expandable tables in PR STATISTICS and ACHIEVEMENTS cards |
| C1 | Leagues |
| C2 | Match History |
| C3 | Matchup (sub-section of Match History) |
| C4 | Match Records |

### D — League Table (league.html)

| Code | Table name |
|---|---|
| D | League Table |

### E — Player Match History (player.html)

| Code | Table name |
|---|---|
| E | Player Match History |

### F — Admin (admin.html)

| Code | Table name |
|---|---|
| F1 | Leagues (League Manager) |
| F2 | Match Results (Round Editor) |

---

## Part 2 — Formats

The project has **five** table formats. Each format is owned by `table-lab/` and exposes a dedicated `mount*` function. Production pages do not render tables directly — they call the appropriate format's mount function with a preset.

| Format | Code | Used by |
|---|---|---|
| Main Format | **MF** | A1, A2, D, E, all B, C1, C2, C3 |
| Secondary Format | **SF** | A3, A4, A5, A6, C4 |
| Expandable Format | **exp** | C0 |
| Form Format 1 | **FF1** | F1 (League Manager) |
| Form Format 2 | **FF2** | F2 (Round Editor) |

---

### MF (Main Format)

The standard table variant used by: **A1, A2, D, E, all B, C1, C2, C3.**

Rendered entirely by `mountMFTable(mountPoint, args)` (`table-lab/mount-mf-table.js`). The function owns all DOM creation — caller provides a plain empty `<div>` and a configuration object. No post-call wiring needed.

To convert a table to MF in a future session, say:
> "Update table X to use the MF variant. Derive the unique parameters for this table on your own and ask me questions as needed."

---

#### General parameters (shared — no per-table override)

| Parameter | Value |
|---|---|
| Collapse | `border-collapse: separate; border-spacing: 0` |
| Row hairlines | `inset 0 -1px 0 var(--color-border)` on all cells; removed on last row |
| Text alignment | `text-align: left` |
| Wrapping | `white-space: nowrap` |
| Table background | `var(--color-surface)` on all `tbody td` (prevents non-sticky content bleeding through on scroll) |
| Text color | `var(--color-text)` |
| Header background | `var(--header-bg)` |
| Header text | `var(--header-text)` |
| Border / hairline color | `var(--color-border)` |
| Hover | `var(--color-hover)` — applied to all cells in the hovered row, including sticky |
| Cell padding | `0.45em var(--space-md)` — vertical scales proportionally with font-size |
| Sticky header | `thead { position: sticky; top: 0 }` |
| Scroll shadow | `attachStickyShadow()` toggles `.is-scrolled-x` → drop-shadow on sticky col boundary, only during horizontal scroll |
| Frame shadow | `box-shadow: var(--shadow-sm)` on wrapper — no `border-radius` |
| Wrapper overflow | `overflow-x: auto; overflow-y: clip` — `clip` is required: `overflow-x: auto` forces `overflow-y: auto` per CSS spec if it was `visible`, making the wrapper the vertical scroll container and breaking `thead`/`avg-row` sticky |
| Max width | `width: 100%; max-width: 1100px` on wrapper |

---

#### Args — simple values

| Arg | Type | Default | Notes |
|---|---|---|---|
| `fontClass` | `'font-small' \| 'font-large'` | `'font-small'` | Class on `<table>`; `font-small` = 0.85rem |
| `stickyCols` | `0 \| 1 \| 2` | `1` | Pinned left columns; col 2 offset JS-measured via `--sticky-col-1-width` |
| `medalRows` | `boolean` | `false` | Gold/silver/bronze tints on rows; all cells including sticky |
| `medalCounts` | `{ gold, silver, bronze }` | `{ 1, 1, 1 }` | Rows per medal tier; only relevant when `medalRows: true`; read from `league_params.json` for D |
| `showTopN` | `number \| null` | `null` | Initially hide rows after N; Show All button reveals the rest; `null` = always show all |
| `mfWidth` | `string \| null` | `null` | CSS `width` on wrapper; `null` = `100%` |
| `mfMb` | `string \| null` | `null` | CSS `margin-bottom` on wrapper; `null` = `var(--space-lg)` |
| `mfBg` | `string \| null` | `null` | CSS `background` on wrapper; use `var(--color-surface)` for opaque card tables |
| `flagSize` | `string \| null` | `null` | CSS `height` for flag images; `null` = `16px` |

---

#### Args — functions

| Arg | Signature | Notes |
|---|---|---|
| `getRowClass` | `(row, index) => string \| null` | Extra CSS class per data row (e.g. `'unplayed'`); merged with medal class |
| `buildSummaryRow` | `(data) => object` | Receives all data rows, returns a summary object; values rendered as-is (pre-formatted strings); produces `tr.avg-row` sticky at bottom |

---

#### ColDef — per-column properties

Each object in `cols[]` drives rendering and interaction for that column:

| Property | Type | Notes |
|---|---|---|
| `key` | `string` | Property name on row objects |
| `label` | `string` | Header text (may contain HTML, e.g. `<b>Tot</b>`) |
| `type` | `'number' \| 'string'` | Affects sort comparator |
| `sortable` | `boolean` | Enables click-to-sort on the column header |
| `sortKey` | `(row) => value \| null` | Custom sort value override; `null` = sort by `row[key]` (e.g. Level column sorted by `row.meanPR`) |
| `colorFn` | `(v, min, max) => css-color \| null` | Cell text color gradient; min/max computed internally across all data rows |
| `boldExtreme` | `boolean` | Wraps the min and max numeric value in `<b>` |
| `format` | `(value, row) => html-string \| null` | Display formatter; `null` = raw value |
| `tdClass` | `string \| null` | CSS class on every `<td>` in this column (e.g. `'total-col'` for bold totals) |

---

#### HTML structure

`mountMFTable` creates all DOM inside `mountPoint`:

```
mountPoint  (plain <div>, caller owns)
    .mf-wrap                ← created internally; CSS vars applied here
        <table class="font-small">
            <thead><tr>…</tr></thead>
            <tbody>
                <tr>…</tr>          ← data rows (medal / getRowClass classes)
                <tr class="avg-row">… ← summary row, if buildSummaryRow provided
            </tbody>
    <button class="show-more-btn">  ← appended to mountPoint, after .mf-wrap
```

---

#### Usage

```js
mountMFTable(mountPoint, {
    data, cols,
    fontClass:       'font-small',
    stickyCols:      2,
    medalRows:       true,
    medalCounts:     { gold: 1, silver: 1, bronze: 3 },
    showTopN:        null,
    mfWidth:         null,
    mfMb:            null,
    mfBg:            null,
    flagSize:        null,
    getRowClass:     (row, i) => row.result === 'unplayed' ? 'unplayed' : null,
    buildSummaryRow: (data) => ({ pr: avg(data, 'pr'), luck: avg(data, 'luck') }),
});
```

---

### SF (Secondary Format)

The compact-records / leaderboards-snippet variant used by: **A3, A4, A5, A6, C4.**

Rendered by `mountSFTable(mountPoint, args)` (`table-lab/formats/sf/mount.js` — to be created). Same contract as MF: caller provides an empty `<div>` and a configuration object; the function owns all DOM creation.

> **Status:** format is **declared** but not yet implemented. Per-table parameters, args schema, and visual rules to be derived from the existing render code for A3, A4, A5, A6, C4 during Phase 1 of the table-lab unification plan (see `docs/plans/table-lab-unification.md`).

#### General parameters
*To be defined when SF is canonicalized in Phase 1. Source material: current render code for A3 (Achievements), A4 (PR Leaders), A5 (Match Records), A6 (League Records), C4 (Match Records on player-general).*

#### Args
*To be defined.*

#### ColDef
*To be defined.*

#### HTML structure
*To be defined.*

#### Usage
*To be defined.*

---

### exp (Expandable Format)

Collapsible-row / expandable-content variant used by: **C0** (Expandable tables in PR STATISTICS and ACHIEVEMENTS cards on player-general).

Rendered by `mountExpTable(mountPoint, args)` (`table-lab/formats/exp/mount.js` — to be created).

> **Status:** format is **declared** but not yet implemented. Per-table parameters, args schema, and visual rules to be derived from the existing C0 render code during Phase 1 of the table-lab unification plan.

#### General parameters
*To be defined when exp is canonicalized in Phase 1.*

#### Args
*To be defined — must include an `expand`/`collapse` row interaction model.*

#### ColDef
*To be defined.*

#### HTML structure
*To be defined.*

#### Usage
*To be defined.*

---

### FF1 (Form Format 1 — League Manager)

Admin CRUD table used by: **F1 (League Manager on admin.html).**

Rendered by `mountFF1Table(mountPoint, args)` (`table-lab/formats/ff1/mount.js` — to be created). FF1 is purpose-built for the League Manager — inline-edit cells, Save/Delete actions, mobile `data-label` card pattern, status/type pills.

> **Status:** format is **declared** but not yet implemented. Per-table parameters, args schema, and visual rules to be derived from `js/admin/leagueManager.js` during a later phase (admin tables are not in scope for the initial table-lab MF migration — see plan).

#### General parameters
*To be defined.*

#### Args
*To be defined — must include edit-mode wiring, save/delete callbacks, and validation hooks.*

#### ColDef
*To be defined.*

#### HTML structure
*To be defined.*

#### Usage
*To be defined.*

---

### FF2 (Form Format 2 — Round Editor)

Admin match-results editor used by: **F2 (Round Editor on admin.html).**

Rendered by `mountFF2Table(mountPoint, args)` (`table-lab/formats/ff2/mount.js` — to be created). FF2 is purpose-built for the Round Editor — score-entry cells, result inference, per-row validation, round navigation.

> **Status:** format is **declared** but not yet implemented. Per-table parameters, args schema, and visual rules to be derived from `js/admin/roundEditor.js` during a later phase (admin tables are not in scope for the initial table-lab MF migration — see plan).

#### General parameters
*To be defined.*

#### Args
*To be defined — must include round/match data model, score input handlers, and per-cell validation.*

#### ColDef
*To be defined.*

#### HTML structure
*To be defined.*

#### Usage
*To be defined.*
