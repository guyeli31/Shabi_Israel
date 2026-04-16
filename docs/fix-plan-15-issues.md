# Fix Plan — 15 UI Issues (Split into 4 Phases)

---

## Phase 1: League Table Core (Fixes 1, 2, 4, 14, 15)
**Domain:** League table rendering, sorting, export, color scale, bold logic, column widths.

### Fix 1: Export Image — Column Reversal
- **Problem:** Exported PNG has reversed columns.
- **File:** `js/render/leaguePage.js:387-433` (`exportLeagueTableImage`)
- **Fix:** Add `direction: ltr` to the offscreen clone wrapper's `cssText`.

### Fix 2: Theme Change Doesn't Refresh Color Scale (Mobile)
- **Problem:** After theme switch, red-green colors stay stale until a sort.
- **Files:** `js/render/leaguePage.js`, `js/render/themePicker.js:53`, `js/compute/colorScale.js`
- **Root cause:** `colorScale.js` reads `isDarkTheme()` at render time. Theme change dispatches `themechange` event but `leaguePage.js` never listens to it.
- **Fix:** Add `window.addEventListener('themechange', ...)` in `renderLeaguePage()` that calls `sortAndRerender()` with current sort state to re-compute inline colors.

### Fix 4: Disable Rank Column Sort + Always 1..N + Sticky Medal Colors
- **Problem:** (a) Rank column should not be sortable. (b) # should always be 1..N top-to-bottom. (c) Medal row colors stick to original winners.
- **File:** `js/render/leaguePage.js:208-383`
- **Current:** Line 261 shows `getMedalHtml(r.originalRank, ...)` and line 225 uses `getRankClass(r.originalRank, ...)` — medal colors already stick. But rank cell shows `originalRank` not display position.
- **Fix:**
  1. In `setupSorting` (line 342): skip click listener for `col === 0`.
  2. In `renderDataRows`: change loop to track index `i`. Rank cell shows `i + 1` (display position). Row class still uses `getRankClass(r.originalRank, ...)`. Medal badge stays on original winners via `originalRank`.

### Fix 14: Bold Extreme Values — Level Column Bug
- **Problem:** Level column is entirely bold; shouldn't be. Games/Wins/Losses correctly excluded from bold logic.
- **Root cause:** `css/components.css:456-459` — `.level-cell { font-weight: 700 }` makes ALL level cells bold via CSS.
- **JS bold logic** at `leaguePage.js:211` correctly limits to `['winRate', 'meanPR', 'luck', 'avgPoints']`.
- **Fix:** Remove `font-weight: 700` from `.level-cell` in CSS.

### Fix 15: GAMES Column Too Wide on Desktop
- **Problem:** GAMES column wider than needed.
- **File:** `css/components.css:171-177` — currently `width: 44px; min-width: 44px; max-width: 44px`.
- **Fix:** Reduce to `width: 36px; min-width: 36px; max-width: 36px`. Also reduce padding for this column to `3px`.

**Skills:** `Playwright MCP` (verify table export, theme switch colors, sort behavior, bold styling, column widths).

---

## Phase 2: Mobile Layout & Styling (Fixes 3, 5, 7, 9)
**Domain:** Mobile-specific layout, font sizes, grid positioning.

### Fix 3: Averages Row — Inconsistent Color on Mobile
- **Problem:** First 2 cells of avg-row have different background on mobile.
- **Root cause:** Medal-tint CSS at `css/components.css:611-616` applies to `nth-child(1)` and `nth-child(2)`. The avg-row might inherit these tints.
- **Fix:** Add explicit `#leagueTable tr.avg-row td { background: var(--color-avg-bg) !important; }` in the mobile section of `components.css`.

### Fix 5: Smaller Font in Mobile League Table
- **Problem:** Need more space in player cells for title icons.
- **File:** `css/components.css:486` (currently `0.7rem`), line 548 (`0.7rem` for numeric cols)
- **Fix:** Reduce table font to ~`0.65rem`, numeric columns to ~`0.62rem`.

### Fix 7: Leaderboard Tables — Font Uniformity on Mobile
- **Problem:** Inconsistent font sizes in leaderboard tables; need player cell space for title icons.
- **Files:** `css/index-dashboard.css` (leaderboard styles), `js/render/landingPage.js:971-1048`
- **Fix:** Set uniform ~`0.65rem` for all cells in `.leaderboard-table` on mobile. Abbreviate headers if needed.

### Fix 9: Player Card — Move AVG RANK Tile on Mobile
- **Problem:** AVG RANK should be to the right of WIN RATE (swap order).
- **File:** `js/render/playerGeneralPage.js:415-422`
- **Current order:** Gold, Silver, Bronze, Avg Rank, Win Rate
- **Fix:** Swap last two `tile()` calls → Gold, Silver, Bronze, Win Rate, Avg Rank.

**Skills:** `Playwright MCP` (verify all changes at 375px mobile viewport).

---

## Phase 3: Dashboard & Historical View (Fixes 6, 8, 12, 13)
**Domain:** League dashboard cards, leaderboards, historical view, What-If simulator.

### Fix 6: What-If Simulator — Table Overflow
- **Problem:** Results table overflows page to the right.
- **Files:** `css/dashboard.css:753-826`, `js/render/dashboardPage.js:873-880`
- **Fix:**
  1. Add `overflow-x: auto` to `.whatif-output`.
  2. Add `table-layout: fixed` to `.whatif-table`.
  3. Reduce body font from `0.9rem` to ~`0.78rem`.
  4. Shorten headers: "Championship %" → "Champ%".
  5. Reduce `.whatif-pct-cell` width and bar `min-width`.

### Fix 8: Medal Icons in Leaderboard Headers
- **Problem:** Gold/Silver/Bronze leaderboard headers have no medal icons.
- **File:** `js/render/landingPage.js:1020-1027`
- **Fix:** Map `lb.typeName` to medal emoji and prepend to title:
  ```
  const medalMap = { Gold: '🥇', Silver: '🥈', Bronze: '🥉' };
  const title = `${medalMap[lb.typeName] || ''} ${lb.year} ${lb.typeName} Leaderboard`;
  ```

### Fix 12: Hide Average PR Card for Regular Leagues
- **Problem:** Dashboard shows "Average PR" for regular leagues where PR doesn't exist.
- **File:** `js/render/dashboardPage.js:347-353`
- **Fix:** Make `cards` array conditional — only push "Average PR" card when `leagueConfig.showPR` is true. Need to pass `leagueConfig` into the rendering context (check if `ctx.leagueConfig` is available).

### Fix 13: UBC Historical View — Add PR Wins + Avg Points Columns
- **Problem:** Historical table for UBC only shows G, W, L, WR%, PR. Missing PRW and APts.
- **File:** `js/render/dashboardPage.js:466-481` (`drawHistTable`)
- **Fix:** After losses column:
  ```js
  if (leagueConfig.showPRWins) html += `<th>${thLabel('PR Wins','PRW')}</th><th>${thLabel('Avg Points','APts')}</th>`;
  ```
  And in data rows:
  ```js
  if (leagueConfig.showPRWins) html += `<td>${r.prWins}</td><td>${r.avgPoints != null ? formatNumber(r.avgPoints) : 'N/A'}</td>`;
  ```
  Verify that `buildRankings` for UBC populates `prWins` and `avgPoints`.

**Skills:** `Playwright MCP` (navigate to dashboard for doubling/regular/UBC leagues, run What-If, verify historical view).

---

## Phase 4: Theme Styling & Admin (Fixes 10, 11)
**Domain:** Theme-aware colors, admin image upload.

### Fix 10: Theme-Aware Tab Styling (Achievements + Match Records)
- **Problem:** `.pg-tab.active` is hard-coded dark blue (`--accent-color, #1c4e80`) for all themes.
- **File:** `css/player-general.css:338-351`
- **Context:** League type pills (`.pg-lt-*`) already have per-theme colors via `--lt-*-bg/text` CSS variables defined in `css/variables.css:92-131`.
- **Fix:** Replace `var(--accent-color, #1c4e80)` with `var(--color-accent)` for the active tab color. Additionally, style the active tab with a subtle background tint. Consider matching the tab color to the league type it represents (doubling=blue, ubc=purple, regular=teal) using the existing `--lt-*` variables.

### Fix 11: Support All Image Types in Admin Upload (Including iPhone HEIC)
- **Problem:** Flag upload restricts to `.png` only.
- **Files:**
  - `js/admin/leagueManager.js:227` — `accept=".png"` (new league flag)
  - `js/admin/leagueManager.js:770` — `accept=".png"` (edit flag)
  - `js/admin/playerManager.js:228` — `accept="image/*"` (player photo, already OK)
- **Fix:**
  1. Change flag upload `accept` to `"image/*"` in both locations.
  2. After file selection, convert non-PNG images to PNG using Canvas API (`drawImage` + `toBlob('image/png')`) before storing as base64.
  3. For HEIC from iPhone: modern Safari/Chrome can render HEIC to canvas. Add a try/catch — if canvas conversion fails, show user-friendly error asking to share as JPEG.

**Skills:** `frontend-design` (theme color choices for Fix 10), `Playwright MCP` (verify tab colors across themes, test upload).

---

## Example Prompts for Each Phase

### Phase 1 prompt:
```
Read docs/fix-plan-15-issues.md and implement Phase 1 (League Table Core — Fixes 1, 2, 4, 14, 15). Use Playwright MCP to verify each fix. Files: js/render/leaguePage.js, css/components.css, js/compute/colorScale.js. Start local server with `npx http-server -p 8080 --cors -c-1` and test on a doubling league.
```

### Phase 2 prompt:
```
Read docs/fix-plan-15-issues.md and implement Phase 2 (Mobile Layout — Fixes 3, 5, 7, 9). Use Playwright MCP to verify at 375px mobile viewport. Files: css/components.css, css/index-dashboard.css, js/render/playerGeneralPage.js, js/render/landingPage.js. Start local server with `npx http-server -p 8080 --cors -c-1`.
```

### Phase 3 prompt:
```
Read docs/fix-plan-15-issues.md and implement Phase 3 (Dashboard & Historical — Fixes 6, 8, 12, 13). Use Playwright MCP to verify. Files: js/render/dashboardPage.js, js/render/landingPage.js, css/dashboard.css. Start local server with `npx http-server -p 8080 --cors -c-1`. Test on doubling, regular, and UBC league dashboards.
```

### Phase 4 prompt:
```
Read docs/fix-plan-15-issues.md and implement Phase 4 (Theme & Admin — Fixes 10, 11). Use frontend-design skill for theme color decisions. Use Playwright MCP to verify. Files: css/player-general.css, css/variables.css, js/admin/leagueManager.js, js/admin/playerManager.js. Start local server with `npx http-server -p 8080 --cors -c-1`. Test across all 8 themes.
```
