# Mobile Design System — Tables, Layout & Sticky Columns

**Scope:** reusable patterns for mobile-first rendering of data tables, forms, and navigation on web apps. Extracted from the Shabi Israel project (Steps 6.1–6.6b). Portable — drop into any vanilla HTML/CSS/JS project, React, or Vue with minor adaptation.

**Purpose:** produce a consistent, legible, non-overflowing mobile experience for dense data UIs without sacrificing desktop density.

---

## 1. Target Viewports & Width Budget

| Device class | Width | Budget rule |
|---|---|---|
| iPhone SE (smallest iOS) | **320 px** | Must fit. Never overflow the viewport unintentionally. |
| iPhone 12/13/14 mini | **375 px** | Primary design target. Layouts must look balanced here. |
| iPhone Plus/Pro Max, modern Android | **414–430 px** | Extra breathing room — no layout change vs 375. |
| Tablet portrait | **641–900 px** | Desktop rules apply (out of mobile breakpoint). |

**Breakpoint:** `@media (max-width: 640px)` is the single mobile gate. Everything below is mobile; above is desktop. Do not introduce intermediate breakpoints unless a specific component requires it.

**Safe horizontal budget at 375 px** after typical page padding (`12–16 px` each side) = **~345 px** for content. Design tables to fit this; sticky/scroll patterns are fallbacks, not defaults.

---

## 2. Typography Scale (mobile)

| Role | Size | Notes |
|---|---|---|
| Table body cell | `0.7 rem` (~11.2 px) | Floor for legibility. |
| Table header cell | `0.65 rem` (~10.4 px) | Slightly smaller than body — headers use abbreviations (see §4). |
| Dense secondary table (e.g., leaderboard grid) | `0.65 rem` body | Only when compression is required to fit. |
| Abbreviated title badge / inline tag | `0.55 rem` | For `.title-abbr` style micro-chips. |
| Form input (mobile table) | `0.7 rem` | Match cell size. |
| Page heading | keep desktop scale | Don't shrink — they anchor the layout. |

**Never go below `0.55 rem` (~8.8 px).** Below this, users pinch-zoom, which defeats the sticky and compression work.

---

## 3. Spacing / Padding Scale (mobile)

| Role | Padding |
|---|---|
| `thead th` | `3 px 2 px` |
| `tbody td` | `2 px 3 px` |
| Input inside cell | `1 px 3 px` |
| Admin form group gap | collapse to `gap: 8 px` or less |
| Card (when tables convert to cards) | `8–10 px` |

Apply `white-space: nowrap` to headers and most cells; let only a dedicated `.player-cell` (or equivalent "long text" column) wrap with `white-space: normal; word-break: break-word`.

---

## 4. The Dual-Label Pattern

**Problem:** full column headers (`Win Rate`, `Issue Date`, `Luck`) don't fit at 375 px, but abbreviating them on desktop looks cheap.

**Solution:** render both spans, toggle visibility by breakpoint.

### Helper
```js
// utils/helpers.js
export function thLabel(full, abbr) {
    const a = (abbr == null || abbr === '') ? full : abbr;
    return `<span class="th-full">${full}</span><span class="th-abbr">${a}</span>`;
}
```

### CSS (ship this globally in the component CSS)
```css
.th-abbr { display: none; }

@media (max-width: 640px) {
    .th-full { display: none; }
    .th-abbr { display: inline; }
}
```

### Renderer usage
```js
`<th scope="col">${thLabel('Issue Date', 'Date')}</th>`
`<th scope="col">${thLabel('Win Rate', 'WR')}</th>`
`<th scope="col">${thLabel('Actions', 'Act')}</th>`
```

### Abbreviation conventions
- 2–4 characters. Preserve vowels only if needed for disambiguation.
- Pair abbreviations (e.g., two "PR" columns for Player A / Player B) are fine — column order disambiguates.
- When full label is already ≤4 chars (`Type`, `Name`), pass the same value twice or omit the abbr — the helper treats empty as "reuse full."

---

## 5. Matrix Compression (primary table pattern)

When a table's columns can fit in the width budget after compression, this is the preferred pattern. No scroll, no card conversion — just shrunk typography and padding.

```css
@media (max-width: 640px) {
    .my-table {
        font-size: 0.7rem;
        width: 100%;
        table-layout: auto;          /* let browser distribute remaining width */
    }
    .my-table thead th {
        padding: 3px 2px;
        font-size: 0.65rem;
        white-space: nowrap;
    }
    .my-table tbody td {
        padding: 2px 3px;
        white-space: nowrap;
    }
    /* Exception: allow long-text column to wrap */
    .my-table tbody td.text-cell {
        white-space: normal;
        word-break: break-word;
    }
    /* Override any desktop fixed column widths */
    .my-table thead th,
    .my-table tbody td {
        min-width: 0;
        max-width: none;
    }
}
```

**Rule of thumb:** up to **~6 columns** of mostly numeric or 2–4-char data fits at 375 px with this pattern. Beyond that, pick sticky (§6), horizontal scroll (§7), or cards (§9).

---

## 6. Sticky Columns (conditional engagement)

**When to use:** the table *almost* fits, but users occasionally zoom in (pinch) or the table is critical for row-tracking. Sticky lets the anchor column(s) stay visible during horizontal scroll.

**Key pattern — "conditional sticky":** sticky CSS is always declared, but engages only when the parent scroll container actually overflows. At 375 px with a compressed table that fits, sticky is a no-op. At 200% zoom it saves the user.

```css
@media (max-width: 640px) {
    /* Rank column — 1st sticky anchor */
    .my-table thead th:nth-child(1) {
        position: sticky;
        left: 0;
        z-index: 4;
        background: var(--header-bg);
    }
    .my-table tbody td:nth-child(1) {
        position: sticky;
        left: 0;
        z-index: 2;
        background: var(--color-surface);
    }

    /* Player column — 2nd sticky anchor, offset by 1st column's width */
    .my-table thead th:nth-child(2) {
        position: sticky;
        left: 28px;         /* must equal col-1 rendered width */
        z-index: 4;
        background: var(--header-bg);
    }
    .my-table tbody td:nth-child(2) {
        position: sticky;
        left: 28px;
        z-index: 2;
        background: var(--color-surface);
    }
}
```

### Rules & pitfalls
- **Always set an explicit background** on sticky cells — otherwise scrolled content shows through.
- **`left: <Npx>`** on the 2nd sticky column must equal the 1st column's rendered width (force via `width/min-width/max-width: 28px`).
- **`z-index`**: headers > bodies; sticky cells > non-sticky. Typical stack: thead non-sticky `3`, thead sticky `4`, tbody non-sticky `1`, tbody sticky `2`.
- **Zebra/row-state tints** (e.g., `.rank-gold`, `.selected`) must be re-applied to sticky cells explicitly — `background` on the sticky rule overrides row-level tint:
  ```css
  .my-table tbody tr.rank-gold td:nth-child(1),
  .my-table tbody tr.rank-gold td:nth-child(2) { background: var(--color-gold-bg); }
  ```

---

## 7. Horizontal-Scroll Fallback (wide tables)

For tables with >8 columns or inputs per cell (editors, match tables): compression still leaves cells too cramped to type in. Wrap in a scroll container.

```html
<div class="table-scroll">
    <table class="wide-table"> ... </table>
</div>
```

```css
@media (max-width: 640px) {
    .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .wide-table { min-width: max-content; }
}
```

Combine with sticky on the first 1–2 columns (§6) so users don't lose context while scrolling.

---

## 8. Forms — 1-Column Stacking

Desktop multi-column forms must collapse to a single column on mobile.

### Grid form
```css
.my-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;   /* desktop */
    gap: 12px;
}
@media (max-width: 640px) {
    .my-form-grid { grid-template-columns: 1fr; }
}
```

### Flex form with inline groups (legacy)
When inline styles like `style="flex:1; min-width:100px"` live in the renderer, defeat them in the media query:
```css
@media (max-width: 640px) {
    .form-group {
        flex: 1 1 100% !important;
        min-width: 0 !important;
    }
}
```
`!important` is acceptable here because the selector is guarded by the media query — desktop is unaffected.

---

## 9. Card-Per-Row Alternative (when compression fails)

If a table has >8 columns of mixed text+numeric content that would render unreadably at 0.7 rem, convert the row to a stacked card *on mobile only*.

### Pattern
```html
<!-- Desktop: table rendering -->
<table class="league-table">...</table>

<!-- Mobile: same data as cards -->
<div class="league-cards">
    <article class="league-card">
        <header class="league-card-title">Row title</header>
        <dl class="league-card-stats">
            <dt>WR</dt><dd>64%</dd>
            <dt>PR</dt><dd>1.02</dd>
            <dt>Luck</dt><dd>+3</dd>
        </dl>
    </article>
</div>
```

```css
.league-cards { display: none; }

@media (max-width: 640px) {
    .league-table { display: none; }
    .league-cards {
        display: grid;
        gap: 8px;
    }
    .league-card {
        padding: 10px;
        border-radius: 8px;
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
    }
    .league-card-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);   /* 3 stats per row */
        gap: 4px 8px;
        font-size: 0.7rem;
    }
    .league-card-stats dt { color: var(--color-muted); }
    .league-card-stats dd { font-weight: 600; }
}
```

**When to choose cards over compression:**
- \>8 columns with mixed types.
- Rows need a visual hierarchy (title + metadata) that a 5-px-padded cell can't convey.
- The table is read for trend-scanning, not row-by-row comparison (scrolling through cards is fine).

**When to stick with compression:**
- All-numeric tables (stats matrices).
- Row-by-row comparison is the point (rankings, leaderboards).
- Sticky + horizontal scroll already solves it.

---

## 10. Integration Checklist (per app shell)

A project may have multiple HTML entry points that each load a different subset of CSS files (e.g., a public shell and an admin shell). **Every shell must load a CSS file that includes the mobile rules, or render in a page that inherits them.**

| Shell | Required | Watch out for |
|---|---|---|
| Public | `components.css` (or wherever §4 + §5 live) | Don't rely on it being loaded transitively — declare explicitly in the `<head>`. |
| Admin | Same rules, either via shared CSS or a standalone block in admin-only CSS | If isolating to avoid style collision, duplicate the §4 dual-label toggle verbatim. |

**Verification on every shell:**
1. Open page at 375 × 812 (DevTools or real device).
2. Inspect a `.th-full` element → `display: none`.
3. Inspect a `.th-abbr` element → `display: inline`.
4. No horizontal scrollbar on `<body>`.
5. Re-test at 1440 × 900 → reverse: `.th-full` visible, `.th-abbr` hidden.

---

## 11. Decision Tree

```
Does the table have ≤6 columns of mostly numeric/short-text data?
├─ YES → Matrix Compression (§5) + Dual-Labels (§4)
│         └─ Still tight at 320 px? Add Sticky (§6) on anchor columns.
│
└─ NO (7+ columns, or inputs per cell)
    ├─ Row-by-row comparison critical?
    │   └─ YES → Horizontal Scroll (§7) + Sticky anchor (§6)
    │
    └─ Users skim rows, not compare?
        └─ YES → Card-Per-Row (§9)
```

---

## 12. Implementation Order (for retrofitting an existing app)

1. **Add the dual-label toggle CSS** (§4) to the global component stylesheet. Zero-risk — invisible until `thLabel()` is used.
2. **Add the `thLabel()` helper** to a utils module. Export, don't use yet.
3. **Pick one table at a time.** Import `thLabel`, wrap each `<th>`. Verify at 375 px.
4. **Add the `@media (max-width: 640px)` compression block** (§5) with the table's selectors.
5. **Test at 375 / 414 / 320 / 1440.** Iterate.
6. **If it still overflows:** add sticky (§6) or cards (§9).
7. **Never `components.css` → `admin.css` cross-contaminate.** If admin has its own shell, duplicate the dual-label rule inside admin's own CSS (see §10).

---

## 13. Anti-Patterns

- ❌ **Using `@media (max-width: 768px)` as the mobile gate.** Too broad — catches tablets that have full desktop width.
- ❌ **`overflow-x: scroll` on `<body>`.** Always wrap in a `.table-scroll` container.
- ❌ **Sticky without background.** Scrolled content bleeds through.
- ❌ **Font-size below `0.55 rem`.** Users zoom; your sticky CSS then fails to engage as designed.
- ❌ **Card conversion for stats-comparison tables.** Breaks the reader's ability to scan a column.
- ❌ **Relying on desktop fixed column widths (`width: 120px`) to carry over.** Always override to `min-width: 0; max-width: none` inside the mobile media query.
- ❌ **Forgetting the admin/public shell distinction.** If `admin.html` doesn't load `components.css`, its tables will not respond to the mobile rules even though the markup uses `thLabel()`.

---

## 14. Reference Implementation

Live in this repo:
- `js/utils/helpers.js` — `thLabel()`
- `css/components.css` (§5, §6 — public tables) — `@media (max-width: 640px)` block at L478
- `css/admin.css` (§4, §5 — admin tables) — standalone block at L853
- `css/index-dashboard.css` (§5 — dashboard tables) — L624, L891
- `css/player-general.css` (§6 — player page sticky) — L542
- `docs/ui-fix-plan-2026-04.md` — full rollout history (Steps 6.1–6.6b)

---

## 15. Packaging as a Skill

To lift this document into a portable Claude Code / Agent SDK skill:

1. Copy this file (`mobile-design-system.md`) into a skill directory.
2. Add frontmatter:
   ```yaml
   ---
   name: mobile-design-system
   description: Use when building or retrofitting mobile-friendly data tables, forms, and sticky columns for web apps. Covers 640 px breakpoint, dual-label headers, matrix compression, sticky anchors, horizontal scroll fallback, and card-per-row conversion.
   ---
   ```
3. Add a SKILL.md entry point that references sections §1–§13 and points to the §14 reference implementation.
4. The §4 `thLabel` helper and §5/§6 CSS blocks are copy-pasteable — each section is self-contained.

---

## 16. Companion Skills (recommended workflow)

This skill is a **reference/implementation** skill — it tells you *what* to build. Pair it with these process skills (all used during the rollout of this system in the reference project) for a complete workflow:

| Skill | When to pair | How it complements |
|---|---|---|
| **`superpowers:brainstorming`** | Before starting a mobile retrofit — user says "make it mobile friendly" but hasn't scoped what that means. | Forces a decision between matrix compression (§5), sticky (§6), scroll (§7), or cards (§9) per table *before* coding. Prevents mid-implementation pivots. |
| **`superpowers:writing-plans`** | Any retrofit touching >2 tables or multiple shells (public + admin). | Produces a stepwise plan you can hand to `executing-plans`. The Step 6.x rollout in `docs/ui-fix-plan-2026-04.md` is an example output. |
| **`superpowers:executing-plans`** | Right after `writing-plans` — to carry out the stepwise plan. | Enforces sequential execution, verification between steps, and stop-on-blocker discipline. Critical when touching both CSS and renderers. |
| **`superpowers:finishing-a-development-branch`** | After all mobile work is verified, before merge. | Handles final test pass, PR-readiness check, and merge/cleanup. |
| **`frontend-design:frontend-design`** | When building something *new* (not retrofitting) and aesthetics are open — e.g., designing a dashboard's mobile view from scratch. | Pushes for a distinctive aesthetic direction (typography, motion, spatial composition) so the mobile design isn't generic. Don't invoke for pure compression work on existing tables — overkill. |
| **Playwright MCP** (not a skill, but a tool pattern) | For every table you touch — after implementation. | Script the §10 verification checklist (viewport resize → check `.th-full`/`.th-abbr` display → inspect overflow → check sticky engagement under zoom). Catches regressions cheaper than manual DevTools. |

### Typical workflow

```
1. brainstorming          → scope the work, pick pattern per table
2. writing-plans          → produce stepwise plan
3. executing-plans        → carry out, using THIS skill (mobile-design-system) as reference
   └─ Playwright MCP      → verify each table after CSS/renderer changes
4. finishing-a-development-branch → merge
```

### Anti-pattern

Don't invoke `frontend-design` for mobile *compression* work on existing tables — it biases toward bold aesthetic choices that may conflict with the project's established design language. This skill is the correct reference: precise, restraint-first, production-oriented.
