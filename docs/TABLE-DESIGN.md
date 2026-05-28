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
| `fontClass` | `'font-small' \| 'font-large'` | `'font-small'` | Class on `<table>`; both use the unified fluid token family (`font-small` = `var(--fs-085)` max 0.85rem; `font-large` = `var(--fs-093)` max 0.93rem). All textual elements site-wide share the same slope profile, so table cells "breathe" in lockstep with headings, KPI numbers, and chrome — ratios between any two elements stay constant at every viewport width. |
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

Rendered entirely by `mountSFTable(mountPoint, args)` (`table-lab/formats/sf/mount.js`). The function owns all DOM creation — caller provides a plain empty `<div>` and a configuration object. CSS canon lives in `table-lab/formats/sf/sf.css` (auto-imports `base/base.css`).

> **Status:** format is **implemented and documented**. Production rewiring (replacing the hand-built render code in `landingPage.js` / `playerGeneralPage.js` with `mountSFTable` calls) is tracked as Phase 7 of `docs/plans/table-lab-unification.md`.

To convert a table to SF in a future session, say:
> "Update table X to use the SF variant. Derive the unique parameters for this table on your own and ask me questions as needed."

---

#### General parameters (shared — no per-table override)

| Parameter | Value |
|---|---|
| Collapse | `border-collapse: separate; border-spacing: 0` |
| Row hairlines | `inset 0 -1px 0 var(--color-border)` on all `tbody td`; removed on last row (inherited from `base.css`) |
| Text alignment | `text-align: left` on all `<th>` and `<td>` |
| Wrapping | `white-space: nowrap` on all cells |
| Cell padding | `0.45em 0.5em` — em-based, scales with font-size |
| Sticky header | `thead th { position: sticky; top: 0; z-index: 3 }` — resolves against `.achv-table-wrapper`'s internal scroll |
| Header background | `var(--color-surface)` (same as body — header distinguished by typography, not background) |
| Header text | `var(--color-text-muted)` with `font-weight: 600` |
| Card chrome | `.achv-table-card`: `background: var(--color-surface)`, `border: 1px solid var(--color-border)`, `border-radius: var(--radius-md)`, `padding: var(--space-md)` |
| Card title | Optional `<h3>` inside the card, above the wrapper |
| Wrapper | `.achv-table-wrapper`: `max-height: 360px; overflow-x: auto; overflow-y: auto` — single scroll container in both axes |
| Sticky col background | `var(--color-surface)` — explicit so non-sticky content doesn't bleed through |
| Hover | `var(--color-hover)` on hovered row's cells |
| Scroll shadow | `attachStickyShadow()` toggles `.is-scrolled-x` on the wrapper → MF-style drop-shadow on the rightmost sticky col's right edge, only during horizontal scroll |
| Frame shadow | None on the wrapper (card border provides the frame) |
| Flag size | `1em` height (scales with font-size) |

---

#### Args — simple values

| Arg | Type | Default | Notes |
|---|---|---|---|
| `tableId` | `string \| null` | `null` | Stable id; sets `data-mf-table-id` on mountPoint and table for external CSS targeting |
| `data` | `object[]` | `[]` | Row objects |
| `cols` | `ColDef[]` | `[]` | Column descriptors |
| `title` | `string \| null` | `null` | Optional `<h3>` heading rendered inside the card (`null` = no heading element) |
| `fontClass` | `'font-small' \| 'font-large'` | `'font-small'` | Sets font enum on the `<table>` |
| `stickyCols` | `0 \| 1 \| 2 \| 3` | `0` | Number of leftmost cols pinned. Adds class `sf-sticky-N` on the `<table>` |
| `showTopN` | `number \| null` | `null` | If set, hide rows after N and append a Show-all button inside the card |

---

#### Args — functions

| Arg | Signature | Notes |
|---|---|---|
| `format` (per col) | `(value, row) => html-string \| null` | See ColDef below |

(SF intentionally has no `getRowClass` / `buildSummaryRow` / sort callbacks — SF tables render in a fixed semantic order and don't carry summary rows. Port from MF if a future SF table needs them.)

---

#### ColDef — per-column properties

| Property | Type | Notes |
|---|---|---|
| `key` | `string` | Property name on row objects |
| `label` | `string` | Header text (may contain HTML, e.g. `'Luck %ile'`) |
| `format` | `(value, row) => html-string \| null` | Display formatter; `null` = raw value |
| `tdClass` | `string \| null` | CSS class on every `<td>` in this column (e.g. `'na'`, `'result-win'`) |

(SF intentionally omits `sortable`, `colorFn`, `boldExtreme`, `sortKey`, `type` from MF's ColDef. Add them if needed.)

---

#### HTML structure

`mountSFTable` creates all DOM inside `mountPoint`:

```
mountPoint  (plain <div>, caller owns; gets data-mf-table-id)
    .achv-table-card                ← created internally
        <h3>{title}</h3>            ← only if title is non-null
        .achv-table-wrapper         ← scroll container (both axes)
            <table class="achv-table {fontClass} [sf-sticky-N]" data-mf-table-id="{tableId}">
                <thead><tr>…</tr></thead>
                <tbody>
                    <tr>…</tr>      ← data rows
                </tbody>
            </table>
        <button class="show-more-btn">  ← appended after the wrapper if showTopN
```

---

#### Usage

```js
mountSFTable(mountPoint, {
    tableId:    'A4',
    data,
    cols: [
        { key: 'rank',   label: '#' },
        { key: 'player', label: 'Player', format: (_, r) => `${flag(r.flag)} ${r.player}` },
        { key: 'pr',     label: 'PR',     format: (v) => formatNumber(v) },
        { key: 'level',  label: 'Level',  format: (v) => `<span class="level-cell">${v}</span>` },
    ],
    title:      'Total PR',
    fontClass:  'font-small',
    stickyCols: 1,
    showTopN:   10,
});
```

---

### exp (Expandable Format)

Collapsible-row / expandable-content variant used by: **C0** (Expandable tables in PR Statistics and Achievements cards on player-general).

Rendered entirely by `mountExpTable(mountPoint, args)` (`table-lab/formats/exp/mount.js`). The function owns the inner DOM (wrap + table); the visible expand/collapse panel itself (`.pg-rank-expanded`) is owned by the caller. CSS canon lives in `table-lab/formats/exp/exp.css` (auto-imports `base/base.css`).

> **Status:** format is **implemented and documented**. Production rewiring (replacing `renderRankTable` + `applyC0StickyAndScroll` in `playerGeneralPage.js` with `mountExpTable` calls) is tracked as Phase 7 of `docs/plans/table-lab-unification.md`.

**Concept.** exp tables are rank-list-style data tables that live inside an expansion panel that opens / closes in response to a caller-owned trigger (a button on a sibling card). The panel hugs the table width and centres horizontally; the table inside scrolls (both axes) within the panel rather than the page. The viewer's "self" row is highlighted in a theme-aware way and is scroll-centred within the panel on every open.

To convert a table to exp in a future session, say:
> "Update table X to use the exp variant. Derive the unique parameters for this table on your own and ask me questions as needed."

---

#### General parameters (shared — no per-table override)

| Parameter | Value |
|---|---|
| Outer panel | `.pg-rank-expanded`: `width: fit-content; max-width: 100%; margin: 10px auto 0; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 6px` — caller-owned visibility via `hidden` attribute |
| Scroll context | `.pg-rank-table-wrap`: `overflow: auto; max-height: 360px` — single scroll container for BOTH axes (so sticky thead `top:0` AND sticky cols `left:0` resolve against the same element) |
| Wrap chrome | `background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm)` |
| Table width | `width: max-content; max-width: 100%` — sum of column intrinsic widths (content + em padding), excess overflow handled by the wrap's scroll |
| Collapse | `border-collapse: separate; border-spacing: 0` |
| Row hairlines | `inset 0 -1px 0 var(--color-border)` on all `tbody td`; removed on last row (inherited from `base.css`) |
| Text alignment | `text-align: left` on all `<th>` and `<td>` |
| Wrapping | `white-space: nowrap` on all cells |
| Cell padding | `0.45em 0.5em` — em-based, scales with font-size |
| Sticky header | Always: `thead th { position: sticky; top: 0; z-index: 3 }` resolves against `.pg-rank-table-wrap` |
| Header background | `var(--color-bg)` — subtle tint vs body `--color-surface` so header doesn't blend in |
| Header text | `var(--color-text-muted)` with `font-weight: 700` |
| Sticky cols | Always 2 leftmost cols pinned; col-2 offset uses JS-measured `--c0-col1-w` |
| Sticky col background | `var(--color-surface)` on tbody sticky cells (matches body) |
| Hover | `var(--color-hover)` on hovered row's cells (incl. sticky) |
| Self-row highlight | `var(--color-accent-light)` background + `font-weight: 700` — theme-aware (every theme defines `--color-accent-light` with readable contrast against its `--color-text`). No per-theme override needed |
| Scroll-to-centre | On every mount: `wrap.scrollTop = selfRow.offsetTop − (wrap.clientHeight − selfRow.offsetHeight) / 2`, clamped to `≥ 0` |
| Scroll shadow | `attachStickyShadow()` toggles `.is-scrolled-x` on the wrap → MF-style drop-shadow on col-2's right edge, only during horizontal scroll |

---

#### Args — simple values

| Arg | Type | Default | Notes |
|---|---|---|---|
| `tableId` | `string \| null` | `null` | Stable id; sets `data-mf-table-id` on mountPoint and table |
| `data` | `object[]` | `[]` | Row objects |
| `cols` | `ColDef[]` | `[]` | Column descriptors (typically 4: `# / Player / Leagues / Value`) |
| `selfKey` | `string \| null` | `null` | Row field whose value identifies the "self" row, e.g. `'name'` |
| `selfValue` | `*` | `null` | Value to match against `row[selfKey]`. If either is null, no row is highlighted |
| `fontClass` | `'font-small' \| 'font-large'` | `'font-small'` | Sets font enum on the `<table>` |
| `stickyCols` | `0 \| 1 \| 2` | `2` | Number of leftmost cols pinned. Default 2 matches C0's standard layout |

---

#### Args — functions

| Arg | Signature | Notes |
|---|---|---|
| `format` (per col) | `(value, row) => html-string \| null` | See ColDef below |

(exp intentionally has no `getRowClass`, `buildSummaryRow`, sort, or color-gradient callbacks. The self-row class is automatic; row-level decorations are not part of the format.)

---

#### ColDef — per-column properties

| Property | Type | Notes |
|---|---|---|
| `key` | `string` | Property name on row objects |
| `label` | `string` | Header text (may contain HTML) |
| `format` | `(value, row) => html-string \| null` | Display formatter; `null` = raw value |
| `tdClass` | `string \| null` | CSS class on every `<td>` in this column |

---

#### HTML structure

`mountExpTable` creates the wrap + table inside `mountPoint`. The visible expansion panel (`.pg-rank-expanded`) is the caller's responsibility — it sets the panel's visibility and the centring/width chrome via CSS.

```
mountPoint  (e.g. .pg-rank-expanded — caller owns visibility and outer chrome)
    .pg-rank-table-wrap                ← created internally; single scroll container
        <table class="pg-rank-table {fontClass}" data-mf-table-id="{tableId}">
            <thead><tr>…</tr></thead>
            <tbody>
                <tr>…</tr>             ← data rows
                <tr class="pg-rank-self">…</tr>   ← if selfKey/selfValue match
            </tbody>
        </table>
```

---

#### Usage

```js
mountExpTable(mountPoint, {
    tableId:   'C0',
    data:      rows,     // [{ rank, name, leagues, value }, ...]
    cols: [
        { key: 'rank',    label: '#' },
        { key: 'name',    label: 'Player',  format: (_, r) => `${flag(r.flag)} ${nameLink(r.name)}` },
        { key: 'leagues', label: 'Leagues' },
        { key: 'value',   label: 'Total PR', format: (v) => formatNumber(v) },
    ],
    selfKey:   'name',
    selfValue: playerName,
});
```

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
