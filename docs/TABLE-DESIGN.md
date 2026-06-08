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
| A7 | Players directory (Notable Figures + Rest of Players) |

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
| F2 | Players (player editing inside Edit League) |
| F3 | Match Results (Round Editor) |
| F4 | View Overrides (manual override list inside Edit League) |
| F5 | CSV Import Preview (Edit League → Import CSV/Excel) |
| F6 | Medals & Prizes (Edit League + Add New League → League Settings) |

---

## Part 2 — Formats

The project has **four** table formats. Each format is owned by `table-lab/` and exposes a dedicated `mount*` function. Production pages do not render tables directly — they call the appropriate format's mount function with a preset.

| Format | Code | Used by |
|---|---|---|
| Main Format | **MF** | A1, A2, D, E, all B, C1, C2, C3, **F5** |
| Secondary Format | **SF** | A3, A4, A5, A6, C4 |
| Expandable Format | **exp** | C0 |
| Form Format | **FF** | F1 (League Manager), F2 (Players), F3 (Round Editor), F4 (View Overrides), F6 (Medals & Prizes) |

> **F5 is the lone admin table on MF** (every other admin table is FF). It is a read-only CSV-import preview, so MF — not the editable FF — is the right format. It renders through `mountMFTable` with `fontClass:'font-small'` (matching B3) and `stickyCols:1` (left column pinned). The MF sticky **header** is a no-op here because `.mf-wrap` is `overflow-y:clip` (never a vertical scroll context) — satisfying the "no floating header" requirement without any change to the shared MF format. `admin.html` loads `table-lab/formats/mf/mf.css` for this one table. The preview shows **only the "N updates"**: matches played in the upload that were not already played and are not override-covered (computed in `js/admin/csvValidation.js`).

### Units policy (load-bearing — applies to ALL four formats)

The CSS canon in `table-lab/formats/` follows a strict unit rule. Read this before adding any new CSS rule to a format file or its production mirror.

| Use **em** for | Use **px** for |
|---|---|
| padding, margin, gap | hairlines (1px / 2px borders) |
| border-radius | drop-shadows (visual decoration, must stay constant) |
| font-size of child elements | viewport caps (max-height, max-width) |
| flag height (via `height: 1em` — see canonical `.flag` rule in `base.css`) | media-query breakpoints |
| button chrome (padding, radius, gap) | JS-measured column-width fallbacks (e.g. `var(--sf-col1-w, 36px)`) |
| select arrow gutter (padding-right, background-position, background-size) | outline markers (`outline: 2px solid …`) |

**Why this matters:** mixing em-based width with px-based padding inside the same sizing chain causes the ratio between text and chrome to collapse at smaller viewports. The 2026-06-03 F3 score-select bug was the canonical retrospective: a `3.2em`-wide select with `18px` right padding left only ~14px for the digit at mobile font scale, hiding the score behind the arrow. The Units policy block at the top of `base.css` records this lesson.

### Canonical `.flag` rule

Defined once in `table-lab/formats/base/base.css` (and mirrored to `css/components.css` + `css/admin.css` for production until Phase 7 closes):

```css
.flag {
    height: 1em;        /* tracks adjacent font (--fs-093 / --fs-085 / …) */
    width: auto;        /* aspect ratio from source — flag PNGs are square */
    margin-right: 0.3em;
    object-fit: contain;
    border-radius: 0.15em;
    vertical-align: middle;
    image-rendering: auto;  /* explicit anti-pixelation guard */
}
```

Per-context overrides (`.dash-table .flag`, `.achv-table .flag`, etc.) carry the same em-based metrics. Source PNGs in `assets/flags/` are 1600×1600 square; rendering at `1em` against the small cell font is heavily downscaled, so `image-rendering: auto` (browser-default bilinear smoothing) is required — `crisp-edges` / `pixelated` would force nearest-neighbor and visibly pixelate the thumbnails.

> **FF — three cell modes per ColDef.** A single FF table can mix freely:
> • **Display** — read-only HTML (text, pills, badges).
> • **Action** — button(s) with `data-*` attrs; caller wires event delegation (used for Edit/Delete/Save-per-match).
> • **Edit** — input/select/toggle in the cell + `getValue` reader; participates in `getDiff()` and optional `validate()`.
> FF1 ("list + action buttons") and FF2 ("edit-in-place") were earlier intermediate names for what is now a single unified format — the distinction is now per-column, not per-table.

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

The compact-records / leaderboards-snippet variant used by: **A3, A4, A5, A6, A7, C4.**

Rendered entirely by `mountSFTable(mountPoint, args)` (`table-lab/formats/sf/mount.js`). The function owns all DOM creation — caller provides a plain empty `<div>` and a configuration object. CSS canon lives in `table-lab/formats/sf/sf.css` (auto-imports `base/base.css`).

> **Status:** format is **implemented and documented**. Production rewiring (replacing the hand-built render code in `landingPage.js` / `playerGeneralPage.js` with `mountSFTable` calls) is tracked as Phase 7 of `docs/plans/table-lab-unification.md`. **A7 (Players directory)** was the first SF call site wired through `mountSFTable` in production — landed 2026-06-08, inside the Players tab on `index.html`.

#### A7 — Players directory (Players tab on index.html)

Two SF tables stacked vertically inside the Players tab:

| Section | Filter | Sort | showTopN |
|---|---|---|---|
| Notable Figures | `hasTitles(meta)` is true | active first, then alphabetical | none (always full) |
| Rest of Players | everything else (non-hidden) | active first, then alphabetical | 15 (toggle reveals all) |

Both use the same `cols`, `tableId: 'A7'`, `fontClass: 'font-small'`, `stickyCols: 1`. The first column (`Player`) is `position: sticky; left: 0` so the leftmost name stays visible while scrolling horizontally on narrow viewports.

Columns (left → right):

| # | Key | Cell |
|---|---|---|
| 1 | `name` | Flag + `playerNameLink(name, meta)` + optional real-name (`.lp-realname`, hidden on mobile) |
| 2 | `status` | `<span class="lp-status lp-status-active\|inactive">` pill with glowing `currentColor` dot. `active` = player appears in any league with `Running: true`. |
| 3 | `lastActiveDate` | `<a class="league-link" href="leagueUrl(id)">Jun 2026</a>` — same quiet hover-underline style as A6's league column. `—` if the player has never appeared (notable-only). |
| 4 | `titleDesc` | `getFullTitleDescription(meta)` in `<em>` — Master/Grandmaster/Champion/etc. `—` for rest-of-players. |

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

### FF (Form Format — Admin tables)

Unified admin table format used by: **F1 (Leagues / League Manager), F2 (Players in Edit League), F3 (Round Editor), F4 (View Overrides), F6 (Medals & Prizes in Edit + Add League) — all on admin.html.**

Rendered by `mountFFTable(mountPoint, args)` (`table-lab/formats/ff/mount.js`). CSS canon lives in `table-lab/formats/ff/ff.css` (auto-imports `base/base.css`). Production rewiring is tracked as Phase 8 of `docs/plans/table-lab-unification.md`; until then, the FF chrome rules are duplicated in `css/admin.css`.

> **Status:** format is **implemented and documented** in the lab. Production currently still renders these tables by hand but uses the FF chrome (the JS writes `<div class="ff-wrap">` + `class="admin-table font-large">` and `css/admin.css` carries the rules). Phase 8 rewires call sites to `mountFFTable`.

> **F6 (Medals & Prizes)** — Display medal cell (icon + colored name) + two Edit cells (Count, Prize number inputs); 3 fixed rows (gold/silver/bronze). Shared by Edit League and Add New League via `ffMedalsTableHTML` in `js/admin/leagueManager.js` (hand-built FF chrome like F1–F4 — `data-mf-table-id="F6"`; the `mountFFTable` rewire rides along in Phase 8). **Font note:** the FF chrome in `ff.css` / `admin.css` is keyed to `.admin-table.font-large`, so every FF table — F6 included — is **font-large**. The Count/Prize `<input>`s keep their own responsive `font-small` sizing via `.edit-card-sm .form-group input`. A genuine font-small FF *variant* would require extending the FF canon (a `.admin-table.font-small` chrome block in `ff.css` + `admin.css`) and is deliberately **not** done here.

**Concept — single format, three cell modes per column.** FF mirrors SF on the 7 shared visual parameters (border-collapse, row hairline, white-space, padding, sticky thead, scroll wrapper, scroll shadow), with admin-specific chrome on top: stronger header typography (uppercase + letter-spacing), `--color-bg` header background tint, and 1-column sticky-left default. The list-vs-edit distinction is per-column, not per-table:

| Cell mode | When | Required ColDef properties | Participates in |
|---|---|---|---|
| **Display** | Read-only data (text, pills, badges) | `format(value, row) → html` returning display HTML | rendering only |
| **Action** | Buttons (Edit, Delete, Save-per-match, etc.) | `format(value, row) → html` returning button HTML with `data-*` attrs; caller wires click via event delegation on the returned `table` | rendering only |
| **Edit** | In-place editor (input/select/toggle) | `format` returns input/select HTML AND `getValue(td, row) → value` AND optional `validate(value, row) → error \| null` | `getDiff()` and (if validate is defined) `validate()` |

A single FF table can mix all three modes freely. F1/F4 use Display + Action only; F2/F3 add Edit-mode cells.

To convert a table to FF in a future session, say:
> "Update table X to use the FF variant. Derive the unique parameters for this table on your own and ask me questions as needed."

---

#### General parameters (shared — no per-table override)

| Parameter | Value |
|---|---|
| Card chrome | NOT owned by FF — caller wraps mountPoint with `.admin-card` (or `.rem-tab-panel`, `.round-card`, etc.) so multi-element cards (heading + msg slot + table + Save + sub-forms) compose freely |
| Scroll context | `.ff-wrap`: `overflow-x: auto; overflow-y: clip; border-radius: var(--radius-sm)` — horizontal scroll only, no height cap. `clip` (not `visible`) is required because `overflow-x: auto` auto-promotes a `visible` `overflow-y` to `auto` per CSS spec, which would intercept window scroll and break sticky thead. With `clip`, sticky col 1 (`left:0`) resolves against the wrap; sticky thead (`top:0`) resolves against the page — tables flow to their natural height in document flow |
| Table width | `width: 100%` — fills the wrap; cells size by content; horizontal scroll engages when total content > wrap width |
| Collapse | `border-collapse: separate; border-spacing: 0` |
| Row hairlines | `box-shadow: inset 0 -1px 0 var(--color-border)` on all `tbody td`; removed on last row |
| Text alignment | `text-align: left` on all `<th>` and `<td>` |
| Wrapping | `white-space: nowrap` on all cells |
| Cell padding | `0.45em 0.5em` — em-based, scales with font-size |
| Sticky header | Always: `thead th { position: sticky; top: 0; z-index: 3 }` |
| Header background | `var(--color-bg)` — subtle tint vs body `--color-surface` |
| Header text | `var(--color-text-secondary)` with `font-weight: 700`, `font-size: var(--fs-078)`, `text-transform: uppercase`, `letter-spacing: 0.05em` (admin-style chrome) |
| Header bottom hairline | `box-shadow: inset 0 -1px 0 var(--color-border)` (no `border-bottom`) |
| Sticky col 1 | Always on — `th:first-child` and `tbody td:first-child` are sticky-left automatically via the canonical CSS (no JS measurement, no class) |
| Sticky col background | `var(--color-surface)` on tbody sticky cells; `var(--color-bg)` on thead corner |
| Sticky-corner z-index | Top-left corner z=4; sticky-thead non-corner z=3; sticky body z=2 (matches MF/SF/exp hierarchy) |
| Hover | `var(--color-hover)` on hovered row's cells (incl. sticky) |
| Scroll shadow | `attachStickyShadow()` toggles `.is-scrolled-x` on the wrap → MF-style drop-shadow on the rightmost sticky col's right edge, only during horizontal scroll |
| Validation marker | Edit-mode cells whose `validate()` returns an error get `cellInvalidClass` (default `.cell-invalid` → `outline: 2px solid var(--color-loss)`). Caller can override |
| Button sizing | All buttons inside `.ff-wrap` are em-based for viewport-fluid scaling. `font-size` in em inherits the cell's clamp-fluid font (so ratios with cells stay constant at every viewport); `padding`, `border-radius`, `gap`, and inter-button `margin` are em-based. Three density tiers: default `.btn` = `0.88em`, `.btn-sm` = `0.85em`, `.btn-xs` = `0.75em`. Variant classes (`.btn-primary` / `.btn-danger` / `.btn-secondary` / `.btn-tech`) keep their color / weight treatment — only sizing is unified |
| Flag thumbnails | Use shared `.flag` atom inside FF cells. `.ff-wrap .flag` overrides only sizing: `height: 1em` (scales with cell font); `width: auto` (preserves source aspect ratio — assets/flags/*.png are 1600×1600 square); `margin-right: 0.3em`; `border-radius: 0.15em`. Callers MUST use `class="flag"` — fixed inline `width × height` (e.g. F2's earlier `width:24px;height:16px`) stretched the square source to 3:2 and is forbidden |
| Mobile pattern | None — horizontal scroll handles narrow viewports |

---

#### Args — simple values

| Arg | Type | Default | Notes |
|---|---|---|---|
| `tableId` | `string \| null` | `null` | Stable id; sets `data-mf-table-id` on mountPoint and table for external CSS targeting |
| `data` | `object[]` | `[]` | Row objects |
| `cols` | `ColDef[]` | `[]` | Column descriptors (Display, Action, or Edit mode — see ColDef) |
| `fontClass` | `'font-small' \| 'font-large'` | `'font-large'` | Sets font enum on the `<table>`. Default `font-large` (admin tables slightly larger than SF) |
| `cellInvalidClass` | `string` | `'cell-invalid'` | CSS class added to `<td>`s whose `ColDef.validate` returned an error |

---

#### ColDef — per-column properties

| Property | Type | Mode | Notes |
|---|---|---|---|
| `key` | `string` | All | Property name on row objects |
| `label` | `string` | All | Header text (may contain HTML) |
| `format` | `(value, row) => html \| null` | All | Display formatter — what's rendered IN the cell. Returns: display HTML (Display) OR button HTML with `data-*` attrs (Action) OR input/select/toggle HTML (Edit) |
| `tdClass` | `string \| null` | All | CSS class on every `<td>` in this column |
| `getValue` | `(td, row) => value` | Edit | Reads the cell's current value from its `<td>`. **Defining this turns the cell into Edit mode** — it then participates in `getDiff()` |
| `originalKey` | `string` | Edit (optional) | Field on `row` to compare against for diff. Default: same as `key` |
| `validate` | `(value, row) => err \| null` | Edit (optional) | Returns error message or null. Cells with errors get `cellInvalidClass` |

(FF intentionally has no click-to-sort, no `getRowClass`, no `buildSummaryRow`, no medal rows. Action button click handlers are wired by the caller via event delegation on the returned `table` element — see Usage.)

---

#### HTML structure

`mountFFTable` creates only the `.ff-wrap` + `<table>` inside `mountPoint`. The caller owns the `.admin-card` (or any other wrapper) and any chrome above/below (heading, Add/Save buttons, message slot, sub-forms).

```
mountPoint  (plain <div> the caller owns; gets data-mf-table-id)
    .ff-wrap                                  ← created internally (scroll container, both axes)
        <table class="admin-table {fontClass}" data-mf-table-id="{tableId}">
            <thead><tr>…</tr></thead>
            <tbody>
                <tr>…</tr>                    ← one tr per row in `data`
            </tbody>
        </table>
```

> **F3 exception.** F3 stacks many FF tables on one screen (one per round) inside `.round-card` wrappers, and each match is rendered as a `<tbody>` with two `<tr>`s + `rowspan="2"` on the EDITED/ACTIONS columns. Until Phase 8, F3 keeps its hand-rolled tbody/rowspan rendering but wears the FF chrome via the same CSS classes. F3-specific reconciliation rules (suppress universal hairline, restore match-block state colors on sticky col, adjust round-card wrap max-height) live in `css/admin.css` under "F3 ↔ FF chrome reconciliation".

---

#### Returns

```ts
{
    wrap:     HTMLElement,           // .ff-wrap (scroll container)
    table:    HTMLElement,           // <table>; use for event delegation
    getDiff:  () => Diff[] | null,   // null when no Edit-mode cols
    validate: () => Error[] | null,  // null when no Edit-mode cols; marks invalid cells with cellInvalidClass
}
```

`getDiff()` runs every Edit-mode column's `getValue` and returns only the cells where `current ≠ original`. The Save button (caller-owned) calls `getDiff()`, posts the changes, and clears state.

---

#### Usage — Display + Action only (F1, F4 today)

```js
const { table } = mountFFTable(mountPoint, {
    tableId:   'F1',
    data:      leagues,
    cols: [
        { key: 'name',   label: 'Name',
          format: (_, r) => `${esc(r.title)}${r.hidden ? hiddenBadge() : ''}` },
        { key: 'type',   label: 'Type',
          format: (v) => `<span class="league-type-pill type-${v}">${LEAGUE_TYPE_LABELS[v]}</span>` },
        { key: 'status', label: 'Status',
          format: (_, r) => r.running
            ? '<span class="status-pill status-running">Running</span>'
            : '<span class="status-pill status-completed">Completed</span>' },
        { key: 'id',     label: 'Actions',
          format: (id, r) => `
            <button class="btn btn-primary btn-sm" data-edit="${id}">Edit</button>
            <button class="btn btn-danger btn-sm"  data-delete="${id}" data-title="${esc(r.title)}">Delete</button>
          ` },
    ],
});

table.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit)   { navigateToEdit(edit.dataset.edit); return; }
    const del  = e.target.closest('[data-delete]');
    if (del)    { confirmAndDelete(del.dataset.delete, del.dataset.title); return; }
});
```

#### Usage — mixed Display + Edit (F2 today)

```js
const { table, getDiff, validate } = mountFFTable(mountPoint, {
    tableId: 'F2',
    data:    players,
    cols: [
        { key: 'name',  label: 'Name',
          format: (v) => `<input type="text" data-field="name" value="${esc(v)}">`,
          getValue: (td) => td.querySelector('input').value.trim(),
          validate: (v) => v ? null : 'Name required' },
        { key: 'flag',  label: 'Flag',
          format: (v, r) => flagSelectHTML(v, r),
          getValue: (td) => td.querySelector('select').value },
        { key: 'retired', label: 'Retired',
          format: (v) => `<input type="checkbox" data-field="retired" ${v ? 'checked' : ''}>`,
          getValue: (td) => td.querySelector('input').checked,
          originalKey: 'retired' },
        { key: 'id',    label: '',
          format: (id) => `<button class="btn btn-danger btn-sm" data-remove="${id}">✕</button>` },
    ],
});

document.getElementById('save-btn').addEventListener('click', async () => {
    const errors = validate();
    if (errors.length) { showMsg(errors[0].error, 'error'); return; }
    const diff = getDiff();
    await save(diff);
});
```
