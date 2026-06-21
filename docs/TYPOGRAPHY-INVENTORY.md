# Typography Inventory — Per-Page Element Mapping

Companion to [TYPOGRAPHY.md](./TYPOGRAPHY.md). Authoritative cross-reference for every textual element on every page, with its assigned **size token** (one of 7) and **weight token** (one of 3).

> This file is **binding**. No textual element ships to production without an entry here. PRs that add a new component must update this inventory in the same commit. Audits compare the live page against this file.

---

## How to read this document

Each section is one page. Each row is one textual element identified by:
- **Element** — short human description.
- **Selector** — CSS selector for measurement / refactor.
- **Size** — assigned size token (`--fs-micro` / `--fs-small` / `--fs-large` / `--fs-xl` / `--fs-2xl` / `--fs-3xl` / `--fs-display`).
- **Weight** — assigned weight token (`--fw-regular` / `--fw-subheading` / `--fw-heading`).
- **Notes** — optional context (semantics, why this choice).

**Empty sections below are intentional placeholders.** Fill them as the migration progresses. The inventory becomes complete and binding when every page's table is populated and reflects the live DOM.

---

## Landing — `design-lab.html?view=home` (production index)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| _to be filled_ | | | | |

---

## League Dashboard — `league.html` / `league_table.html`

### Navigation chrome

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Brand "Shabi Israel" | `.nav-home` | | | |
| Leagues dropdown button | `.nav-leagues-btn` | | | |
| Dropdown items | `.nav-leagues-dropdown a` | | | |
| Search input | `.nav-search input` | | | |
| Search result item | `.nav-search-results a` | | | |
| Admin avatar chip | `.nav-admin-user` | | | |

### League hero (V13 / V16)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Hero card root | `.lh13-card` / `.lh16-hero` | | | |
| League name | `.lh13-name` / `.lh16-display` | | | |
| Type pill ("Doubling" / "UBC" / "Regular") | `.league-type-pill` | | | |
| Status pill ("Running" / "Completed") | `.status-pill` | | | |
| Meta line ("Last updated …") | `.lh13-meta` / `.lh16-statlbl` | | | |
| Stat value (V16 only) | `.lh16-statval` | | | |

### Breadcrumbs

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Regular item | `.breadcrumbs li:not(.current)` | | | |
| Current item | `.breadcrumbs .current` | | | |

### Dashboard cards (B-series KPIs)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Card label | `.dash-card-label` | | | |
| Card value | `.dash-card-value` | | | |
| Card subtext | `.dash-card-subtext` | | | |

### Controls

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Section heading h2 | `.dash-section h2` | | | |
| Control label | `.dash-controls label` | | | |
| Control select/button | `.dash-controls select`, `.dash-controls button` | | | |
| Forward / back link | `.forward-link`, `.back-link` | | | |

### Tables on this page (Table Mapping codes from TABLE-DESIGN.md)

| Table | Cell type | Selector | Size | Weight |
|---|---|---|---|---|
| B1 Prizes & Medals | Header `<th>` | `table.font-small th` | | |
| B1 Prizes & Medals | Data `<td>` | `table.font-small td` | | |
| B1 Prizes & Medals | Player cell | `td.player-cell` | | |
| B2 Historical view | Header | | | |
| B2 Historical view | Data | | | |
| B3 Championship Predictor | _to be filled_ | | | |
| B4 What If Simulator | _to be filled_ | | | |
| B5 Rounds | _to be filled_ | | | |
| B6a–c Remaining tables | _to be filled_ | | | |

### Matchup card

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Selector label | `.matchup-selector-label` | | | |
| Search input | `.matchup-search-input` | | | |
| Count badge | `.matchup-count-badge` | | | |
| Best PR cell | `.matchup-pr-best` | | | data emphasis |
| Best Luck cell | `.matchup-luck-best` | | | data emphasis |

### Export / image

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Export Image button | `#leagueExportBtn` / `.img-export-btn` | | | |

---

## League Table — `league_table.html` (Table D)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Header `<th>` | `#leagueTable th` | | | |
| Data `<td>` (numbers) | `#leagueTable td:not(.player-cell)` | | | |
| Player name `<td>` | `#leagueTable td.player-cell` | | | |
| Average row `<td>` | `#leagueTable tr.avg-row td` | | | data emphasis |
| Medal rank rows | `tr.rank-gold`, `tr.rank-silver`, `tr.rank-bronze` | | | (cell weight inherited; row tint is via background only) |
| Last-5 status icons | `.status-pill .lh-dot` | | | non-text |

(Other elements on `league_table.html` — nav, hero, breadcrumbs — share rows from §"League Dashboard" above.)

---

## Player Profile — `player_league.html` (Table E)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Header `<th>` | `#playerTable th` | | | |
| Data `<td>` | `#playerTable td` | | | |
| _additional player-page elements_ | | | | |

---

## Player General — `player.html` (Tables C0–C5)

### Header (V7 / V12)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Hero card root | `.pg-v7-card` / `.pg-v12-hero` | | | |
| Display name | `.pg-v7-name` / `.pg-v12-display` | | | |
| Real name (italic) | `.pg-v7-realname` / `.pg-v12-real` | | | |
| Title ribbon | `.pg-v12-titleribbon` | | | |
| Status chip | `.pg-v12-statuschip` | | | |
| Stat label | `.pg-v12-statlbl` | | | |
| Stat value | `.pg-v12-statnum` | | | |

### PR card (G3)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Card root | `.pg-pr-card` | | | |
| Type pill | `.pg-pr-type` | | | |
| Metric label | `.pg-pr-label` | | | |
| Metric value | `.pg-pr-value` | | | data emphasis |
| Level badge | `.pg-level-badge` | | | |
| Rank line | `.pg-pr-rank` | | | |

### Achievements tiles (G6)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Tile root | `.pg-tile` | | | |
| Tile title | `.pg-tile-title` | | | |
| Tile rank | `.pg-tile-rank` | | | |
| Tile value | `.pg-tile-value` | | | data emphasis |
| Tile subtitle | `.pg-tile-sub` | | | |

### Tables on player_general

| Table | Cell type | Selector | Size | Weight |
|---|---|---|---|---|
| C0 Expandable (PR/Achievements) | _to be filled_ | | | |
| C1 Leagues | `.pg-leagues-table` cells | | | |
| C2 Match History | `.pg-matches-table` cells | | | |
| C3 Matchup | `.matchup-table` cells | | | |
| C4 All Opponents (H2H) | `[data-mf-table-id="C4"]` cells | | | |
| C5 Match Records | _to be filled_ | | | |

---

## Admin — `admin.html` (Admin Mode)

> The admin page must also follow the unified scale. Forms, tooltips, modals, table headers — all elements assigned to one of 7 sizes + one of 3 weights, recorded below.

### Header & navigation

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Page title | `.admin-large-title` | | | |
| Section title | `.admin-section-title` | | | |
| Subtitle | `.admin-subtitle` | | | |
| Sidebar item | `.admin-sidebar` | | | |

### Form controls

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Form label | `.admin-input-label` | | | |
| Form field | `.admin-form-field` | | | |
| Form text | `.admin-form-text` | | | |
| Help text | `.admin-help-text` | | | |
| Small label | `.admin-label-small` | | | |

### Buttons

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Primary button | `.admin-button-text` | | | |
| Secondary button | `.admin-button-secondary` | | | |
| Small button | `.admin-button-small` | | | |

### Tables (F1 League Manager, F2 Round Editor)

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Header `<th>` | `.admin-table-header` | | | |
| Data `<td>` | `.admin-table-cell` | | | |

### Status / tooltips / modals

| Element | Selector | Size | Weight | Notes |
|---|---|---|---|---|
| Status text | `.admin-status` | | | |
| Tooltip | `.admin-tooltip` | | | |
| Error message | `.admin-error` | | | |
| Warning message | `.admin-warning` | | | |
| Note / footer | `.admin-note`, `.admin-footer-text` | | | |

---

## Audit checklist

For each page above, after migration:

- [ ] Every row in the inventory has a Size and a Weight value.
- [ ] Measured `font-size` (px) on the live page matches the resolved value of the assigned token at the test viewport width.
- [ ] Measured `font-weight` matches the assigned token (400 / 600 / 700, never 500 / 800 / 900).
- [ ] Two elements that share a size token measure **identical px** at every viewport.
- [ ] `css/typography-overrides.css` is empty (no overrides remain).
- [ ] `grep -rn "font-size:" css/ table-lab/` returns only `var(--fs-*)` references (no literal `clamp()` / `rem` / `px`).
- [ ] `grep -rn "font-weight:" css/ table-lab/` returns only `var(--fw-*)` references.
- [ ] `grep -rn "!important" css/` returns nothing from typography rules.
