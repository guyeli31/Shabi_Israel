# Mobile Matrix + Compression (Step 6.6 — Replaces 6.5)

> **Status:** approved 2026-04-16, ready for implementation.
> **Source:** master copy lives at `C:\Users\User\.claude\plans\mighty-roaming-ladybug.md`; this file mirrors it inside the repo for cross-session discoverability.

## Context

The previous approach in Step 6.5 (CSS-only table→cards at ≤640px) was implemented and verified, but the user viewed the result and rejected it as **"distortion"**. Tables on mobile must remain a **matrix** (rows × columns) like on desktop, rendered at **full page width**, **without horizontal scroll by default**. Same applies to high desktop zoom (>200%).

**Visual reference:** the Championship Predictor table in [dashboard.html](../dashboard.html) — the user stated it "looks perfect" on mobile. Its CSS at [css/dashboard.css:411-434](../css/dashboard.css#L411) — `width:100%`, `font-size:0.8-0.9rem`, `padding: xs sm`, `text-align:center`. That is the standard to match.

**Explicit user requirements:**
1. All tables on all pages — matrix at full page width, no horizontal scroll by default.
2. Scroll appears only under zoom-in; when it does, the **2 leftmost columns** (Rank + Player) must be `position: sticky`.
3. Aggressive header abbreviations allowed (WR%, G, W, L, PR).
4. Font as large as possible — shrink only until everything fits.
5. `pg-leagues-table` — exception: horizontal scroll **is** allowed by default, with **sticky-left** on the League-name column. Also: **reorder** — move Rank column from position 9 to position 4 (between Status and Games) on **both** desktop and mobile. Target: 4 columns visible at 375px (LEAGUE sticky + TYPE + STATUS + RANK).
6. `pg-matches-table` — cap at **25 matches** by default on mobile so the chart doesn't overflow page width.
7. Admin-mode Leagues table — same compression.

## Scope (all tables)

| Selector | Page | Typical columns |
|---|---|---|
| `#leagueTable` | league.html | 7–11 (depends on leagueConfig) |
| `#playerTable` | player.html | 8 |
| `.dash-table` × 5 | dashboard.html | Top-5, Historical View, Rounds, Remaining, Prizes, What-If |
| `#predictor-section table` | dashboard.html | **Already correct — sanity-check only** |
| `.completed-leagues-table` | index.html | 4 |
| `.admin-table` | admin.html | Varies (Leagues included) |
| `.pg-rank-table` | player_general.html | ~6 |
| `.pg-leagues-table` | player_general.html | 9 (**exception — sticky+scroll**) |
| `.pg-matches-table` | player_general.html | Varies (**cap to 25**) |
| `.pg-mr-table` | player_general.html | Varies |

---

## Work Breakdown

### A. Revert — remove the card conversion from Step 6.5

**File:** [css/components.css](../css/components.css) lines ~485–770 (`@media (max-width: 640px)`).

**Delete:**
- All `display: grid; grid-template-columns: auto 1fr` on `tr`/`td`.
- All `td::before { content: attr(data-label) }` rules.
- The medal `border-left` stripe (it will still work in matrix form via desktop styles).
- `position: static !important` overrides — we want sticky preserved (conditionally).

**Also delete:** `thead { display: none }` — headers must be visible in matrix mode.

### B. New compression CSS inside `@media (max-width: 640px)`

Principle: **small `font-size`, minimal padding, abbreviated headers, `text-align: center`**. Goal: all columns fit within 375px without `overflow-x`.

**Base rule (starting values):**
```css
@media (max-width: 640px) {
  #leagueTable, #playerTable, .dash-table, .completed-leagues-table,
  .admin-table, .pg-rank-table, .pg-matches-table, .pg-mr-table {
    font-size: 0.7rem;       /* ~10.5px — starting point, shrink as needed */
    width: 100%;
    table-layout: auto;
  }
  [same selectors] thead th { padding: 3px 2px; font-size: 0.65rem; white-space: nowrap; }
  [same selectors] tbody td { padding: 2px 3px; }
  [same selectors] .player-cell { text-align: left; }
}
```

**Iterative process (Playwright-driven):** start at 0.7rem, measure `scrollWidth` at 375px; if > 375 → drop to 0.65 → 0.6 → 0.55. If still not fitting → go to step C.

### C. Header abbreviations (dual-label pattern)

**Files:**
- [js/render/leaguePage.js:92-109](../js/render/leaguePage.js) — `cols` array
- [js/render/playerPage.js](../js/render/playerPage.js) — columns array
- [js/render/dashboardPage.js:466-469](../js/render/dashboardPage.js) — Historical View headers
- [js/render/playerGeneralPage.js:436-444](../js/render/playerGeneralPage.js) — Leagues headers

**Pattern:**
```html
<th scope="col" data-col="0">
  <span class="th-full">Win Rate</span>
  <span class="th-abbr">WR%</span>
</th>
```

```css
.th-abbr { display: none; }
@media (max-width: 640px) {
  .th-full { display: none; }
  .th-abbr { display: inline; }
}
```

**Abbreviation map (user-approved):**
| Full | Abbr |
|---|---|
| Games | G |
| Wins | W |
| Losses | L |
| Win Rate | WR% |
| Mean PR | PR |
| PR Wins | PRW |
| Points | Pts |
| Avg Points | APts |
| Luck | Lk |
| Level | Lv |
| Opponent | Opp |
| Player | (kept — user wants wide) |
| Date | (kept — user wants wide) |

### D. Conditional sticky rank+player (engaged only on zoom/overflow)

**For #leagueTable, #playerTable, .dash-table, .completed-leagues-table, .admin-table, .pg-rank-table:**

```css
@media (max-width: 640px) {
  /* Sticky engages only when parent becomes scrollable (zoom) */
  .table-scroll { overflow-x: auto; }
  [table] tbody td:nth-child(1),
  [table] thead th:nth-child(1) { position: sticky; left: 0; background: var(--color-surface); z-index: 2; }
  [table] tbody td.player-cell,
  [table] thead th:nth-child(2) { position: sticky; left: var(--rank-col-width, 36px); background: var(--color-surface); z-index: 2; }
}
```

Sticky activates only when `overflow-x` kicks in (zoom). At a normal 375px width, the table fits → no scroll → sticky is invisible.

### E. `pg-leagues-table` — reorder + sticky-left + scroll allowed

**Files:** [js/render/playerGeneralPage.js:436-469](../js/render/playerGeneralPage.js#L436) and [css/player-general.css](../css/player-general.css).

**E.1 — Rank column reorder (Desktop + Mobile):**
New 9-column order: **League | Type | Status | Rank | Games | W | L | Primary | Mean PR**.
Rank moves from position 9 to position 4 (after Status, before Games). Required edits:
- `<thead><tr>` at [js/render/playerGeneralPage.js:436-444](../js/render/playerGeneralPage.js#L436): move `<th>Rank</th>` to position 4.
- Data loop at [js/render/playerGeneralPage.js:460-469](../js/render/playerGeneralPage.js#L460): move the `playerRank` `<td>` accordingly.

**E.2 — Sticky-left + scroll (Mobile only):**
```css
@media (max-width: 640px) {
  .pg-leagues-table-wrapper { overflow-x: auto; }
  .pg-leagues-table {
    font-size: 0.65rem;   /* calibrated so ~4 columns visible at 375px */
    min-width: max-content;
  }
  .pg-leagues-table th:first-child,
  .pg-leagues-table td:first-child {
    position: sticky; left: 0;
    background: var(--color-surface);
    box-shadow: 4px 0 6px -4px rgba(0,0,0,0.15);
    z-index: 2;
  }
}
```

**E.3 — Font calibration (Playwright-driven):**
Target at 375px: **4 visible columns** by default — `LEAGUE (sticky)` + `TYPE` + `STATUS` + `RANK`. Calibrate font-size (0.7 → 0.65 → 0.6 → 0.55) until the width of those 4 columns ≤ 375px. The remaining 5 columns (Games, W, L, Primary, Mean PR) are exposed via horizontal scroll.

> Note: in the user's spoken list they said "LEAGUE, TYPE, STATUS, **GAMES**" — but after the reorder, column 4 is RANK (not Games). Interpreted per the new ordering (LEAGUE, TYPE, STATUS, RANK). If the user meant to have Rank hidden with Games appearing first on scroll, the reorder should be cancelled first.

### F. `pg-matches-table` — cap 25 on mobile

**File:** [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js) in the `renderMatchesTable` function (~line 592).

**Pattern:** render **all** matches, but add class `.hidden-mobile` to every row beyond row 25 + an "Show all N matches" button above the table that removes the class.

```css
@media (max-width: 640px) {
  .pg-matches-table tr.hidden-mobile { display: none; }
  .pg-matches-expand { display: inline-block; }
}
@media (min-width: 641px) {
  .pg-matches-expand { display: none; }
}
```

**In addition:** the chart on player_general must get `max-width: 100%` + `overflow: hidden` on mobile. If there's a hard-coded `width: 800px` on the chart — remove and replace with 100%.

### G. `.dash-table` specific fixes

- **Prizes table:** remove `max-width: 400px` at [css/dashboard.css:501](../css/dashboard.css#L501).
- **Rounds / Remaining matches / What-If:** same compression. Some non-critical columns may get further abbreviated ("R" for "Round").
- **Championship Predictor:** already correct — just Playwright sanity-check that the new compression defaults don't regress it.

### H. Desktop zoom > 200%

`@media (max-width: 640px)` activates automatically when effective viewport drops below 640px (= zoom 2× on 1280, or 2.3× on 1440). So the compression from B–G handles this automatically. Verify with Playwright at zoom 2.0 / 2.5 on a 1440 desktop.

### I. Documentation update

**[docs/ui-fix-plan-2026-04.md](ui-fix-plan-2026-04.md):**
- Already flipped: Step 6.5 marker changed from "✅ הושלם" to "🔄 הוחלף — ראה שלב 6.6".
- Step 6.6 added to the summary table pointing to this roadmap.

---

## Recommended execution order

1. **A** — delete card CSS (~5 min).
2. **B** — compression defaults (~15 min).
3. **D** — conditional sticky rank+player (~15 min).
4. **Playwright iteration #1:** measure at 375px across all tables. If still overflowing → continue to C.
5. **C** — header abbreviations + dual-label pattern (~45–60 min).
6. **Playwright iteration #2:** re-measure.
7. **E** — pg-leagues-table reorder + sticky (~15 min).
8. **F** — pg-matches cap 25 + chart max-width (~30 min).
9. **G** — dash-table fixes (~15 min).
10. **Playwright final:** 375/414/768 + zoom 1.5/2.0/2.5 on 1440.
11. **I** — documentation sync.

**Total estimate:** 3–4 hours.

---

## Verification (Playwright MCP)

- [ ] `document.documentElement.scrollWidth === window.innerWidth` at 375/414 on: index, league, player, dashboard, player_general, admin (leagues tab).
- [ ] No visible horizontal scrollbar on any table except `pg-leagues-table-wrapper`.
- [ ] `pg-leagues-table`: left column (League name) stays sticky during horizontal scroll. New column order: League | Type | Status | Rank | Games | W | L | Primary | Mean PR (same on desktop). At 375px — 4 columns visible before scroll.
- [ ] `pg-matches-table`: only 25 rows visible at 375px; "Show all" button reveals the rest.
- [ ] Championship Predictor: no regression — renders as before.
- [ ] Desktop 1440: all tables identical to current. Sticky works as before.
- [ ] Zoom 2.0/2.5 on 1440: behaves like mobile — compression + sticky rank/player.
- [ ] Accessibility: `getComputedStyle(th)::after { content }` doesn't cause duplicate screen-reader output. (Dual-label via `display: none` is safe.)

---

## Critical Files

| File | Change |
|---|---|
| [css/components.css](../css/components.css) | Delete ~280 lines of card CSS; replace with ~80 lines of compression + conditional sticky |
| [css/dashboard.css](../css/dashboard.css) | Add `@media` compression for `.dash-table`; remove `max-width: 400px` |
| [css/player-general.css](../css/player-general.css) | Add `@media` compression + sticky-left for `pg-leagues-table` + chart max-width + matches cap CSS |
| [css/admin.css](../css/admin.css) | Add `@media` compression for `.admin-table` (Leagues) |
| [css/index-dashboard.css](../css/index-dashboard.css) | Add `@media` compression for `.completed-leagues-table` |
| [js/render/leaguePage.js](../js/render/leaguePage.js) | Dual-label headers (full+abbr spans) |
| [js/render/playerPage.js](../js/render/playerPage.js) | Dual-label headers |
| [js/render/dashboardPage.js](../js/render/dashboardPage.js) | Dual-label in Historical View, Rounds, Remaining, What-If |
| [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js) | Dual-label in 4 tables + reorder Rank + cap 25 + expand button |
| [js/render/landingPage.js](../js/render/landingPage.js) | Dual-label in `.completed-leagues-table` |
| [js/render/adminPage.js](../js/render/adminPage.js) (if present) | Dual-label in `.admin-table` Leagues |
| [docs/ui-fix-plan-2026-04.md](ui-fix-plan-2026-04.md) | Status 6.5 → "replaced"; Step 6.6 added |

---

## Risk and rollback

- **Readability risk:** font-size 9–10px may be hard to read for older users or users with vision issues. If this is too severe in Playwright — fallback path: hide secondary columns (Luck, Level) on mobile.
- **Git safety:** create a dedicated branch `mobile-matrix-v2` before starting the revert, so rolling back to cards (Step 6.5) stays a single `git checkout` away if the user changes direction again.
