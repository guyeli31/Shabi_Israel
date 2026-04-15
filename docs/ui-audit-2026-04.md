# UI/UX Audit — Shabi Israel

**Date:** 2026-04-14
**Scope:** 4 pages (index, league, player, admin) × 3 themes (current, dark, vegas) × 2 viewports (1440×900, 375×667) = 24 screenshots
**Methodology:** Playwright MCP + axe-core (WCAG 2 A/AA + WCAG 2.1 A/AA) + DOM metrics
**Screenshots:** [docs/audit-2026-04/screenshots/](audit-2026-04/screenshots/)
**Status:** Audit only — no code changes. Implementation decisions pending user approval.

---

## Findings — Prioritized

### 🔴 Critical (fix before anything else)

#### C1. Sticky avg-row + stat-row broken on league page
**File:** [css/components.css:155-189](../css/components.css#L155-L189)
**Evidence:** Scrolled league page to bottom @ 375×667; measured `avg-row.top = 713.8px`, `stat-row.top = 750.2px` — both **below** viewport height (667px). Rows do not stick.
**Root cause:** `position: sticky` on `<tr>` is unreliable in Safari/Firefox. Must be applied to the `<td>` cells instead.
**Impact:** Users scrolling a long league table lose the "Averages" / "Stats" context row — the exact Phase A complaint.

#### C2. Horizontal page overflow on index.html @ 375
**Evidence:** `document.documentElement.scrollWidth = 824px` with `innerWidth = 375px` — the **whole page** scrolls sideways.
**Root cause:** `.completed-leagues-table` renders at 504px natural width without being wrapped in `.table-scroll`. Element overflows viewport by 137px.
**Impact:** Landing page shows sideways-scroll on every phone. Violates mobile-first basics.

#### C3. Color contrast — 34-35 serious violations on every page
**Evidence:** axe-core (WCAG AA) flagged 34 nodes on league/vegas, 35 nodes on index/current, 5 on player/vegas.
**Impact:** Muted/secondary text and colored stat values fail 4.5:1 contrast. Affects readability for all users; blocker for WCAG AA.
**Scope:** Not theme-specific — `current` theme is as bad as `vegas`. Likely sources: `--color-text-muted`, the `color-scaled` green/red stat values, and badge text on tinted backgrounds.

#### C4. Admin sidebar consumes 45.8% of mobile viewport
**Evidence:** Screenshot [p1-admin-current-375.png](audit-2026-04/screenshots/p1-admin-current-375.png) — sidebar stacks above content; "Leagues" heading pushed to y≈322 on a 667px screen. Actions column (Edit/Delete buttons) clipped off the right edge of the leagues table.
**Impact:** Admin on mobile is unusable without heavy scrolling + horizontal swipe to reach action buttons.

#### C5. Search input triggers iOS zoom
**Evidence:** `input` (search player) computed `font-size = 11.05px`. iOS Safari auto-zooms any input under 16px on focus, breaking layout.
**Fix:** `font-size: 16px` on focusable inputs (can visually compensate with `transform: scale(0.7)` if 11px is design-critical).

---

### 🟠 High

#### H1. 37+ touch targets below 44×44px
**Evidence:** On player page @ 375 alone, 37 focusable elements measured `<44px` in at least one dimension. Examples:
- Nav "Shabi Israel" link: 70×21
- "Leagues ▾" dropdown button: 80×23
- Breadcrumb "Home": 30×18
- Player-name links in table rows: 17-120px wide × **17px tall**
**Standard:** Apple HIG 44×44pt, Material 48dp.

#### H2. Zero `<th scope="col">` on any page
**Evidence:** `document.querySelectorAll('th[scope="col"]').length === 0` with 8 `<th>` total on player page. Screen readers can't associate data cells with headers.

#### H3. No skip-to-main-content link
**Evidence:** `querySelector('a.skip-link, a[href="#main"]')` returns null on every page. Keyboard users must tab through full nav on every page.

#### H4. `lang="he"` with `dir="ltr"` — mismatch
**Evidence:** `<html lang="he" dir="ltr">`. The UI is actually English/LTR. Either change `lang` to `en` or add `dir="rtl"` for Hebrew content sections.

#### H5. `:focus-visible` styles missing / incomplete
**Observation (screenshots):** No visible focus ring on sortable headers, theme picker button, or floating buttons. Not yet measured programmatically — flag for manual review after fix.

#### H6. Floating buttons (gear, theme toggle) overlap table content on mobile
**Evidence:** Visible in [p1-league-current-375.png](audit-2026-04/screenshots/p1-league-current-375.png) — gear icon at left edge and brightness icon at right edge sit **on top of** table rows 9-10. Also lack safe-area padding — will be hidden by iOS Safari URL bar.

#### H7. Date column on player page is always "—"
**Evidence:** [p1-player-current-375.png](audit-2026-04/screenshots/p1-player-current-375.png) — every row shows "—" in the Date column, wasting ~20% of mobile width. Should be hidden when all cells are empty.

---

### 🟡 Medium

#### M1. 404 noise in console for optional files
**Evidence:** Per page load, 9-17 404 errors for `manual_overrides.json`, `match_history.json`, `players_metadata.json` across all leagues.
**Status:** Not functionally broken — [js/data/leagueLoader.js:103-113](../js/data/leagueLoader.js#L103-L113) already handles failure gracefully with try/catch. Marked "optional" in [docs/architecture.md:44-45](architecture.md#L44-L45). But noise pollutes devtools and hides real errors.
**Fix options:** (a) HEAD check before fetch, (b) cache "does not exist" per league, (c) accept as cosmetic.

#### M2. Player-name links have no hit-area padding
Clicking exactly on 17px-tall text is fragile. Add `padding: 8px 0; display: inline-block;` to `td.player-cell a`.

#### M3. No `prefers-reduced-motion` handling
Transitions run full-speed for users who request reduced motion.

#### M4. No `prefers-color-scheme` default
Dark theme must be manually selected; new visitors on dark-mode devices get the light default.

#### M5. Stat-row sticky offset is hardcoded (`bottom: 30px`)
Assumes stat-row height = 30px. Any typography change breaks it. Related to C1 fix.

---

### 🟢 Nice-to-have

- N1. Skeleton loaders instead of blank during CSV fetch
- N2. `scroll-behavior: smooth` on in-page anchors
- N3. Tabular-nums on all stat columns (`font-variant-numeric: tabular-nums`)
- N4. Export Image button moved inline with table header on mobile (currently pushes off-edge)
- N5. `aria-live="polite"` on search results + sort state

---

## Phase A Verification

Verified in [js/render/leaguePage.js](../js/render/leaguePage.js) (431 lines read):

| Issue | Status | Note |
|---|---|---|
| Sticky avg-row + stat-row | **BROKEN** (C1) | CSS-only, no JS — `position:sticky` on `<tr>` fails |
| Games column X/Y ratio | ✅ Clean | Line 243 renders plain count |
| Last-Updated placement | ✅ Clean | Line 81 appends to `.page-header`, outside `stat-row` |

---

## Design Vision — "Editorial Chess" (approved)

Magazine-inspired direction with theme renames (Newsprint / Evening Edition / Letterpress / Garden Section / Sports Section / Late Night / Weekend Magazine / Board Room). Typography: **Fraunces** (display) + **Inter Tight** (body) + tabular-nums. Mobile strategy: auto-scale + hide low-priority columns (Level, Luck) below 480px. Admin: hamburger + slide-in drawer.

Detailed direction preserved in plan: `C:\Users\User\.claude\plans\whimsical-noodling-graham.md`.

---

## Recommended fix order

1. **C2** — wrap `.completed-leagues-table` in `.table-scroll` (5 min, unblocks all mobile testing)
2. **C5** — bump input `font-size` to 16px (trivial)
3. **C1** — move sticky from `<tr>` to `<td>` in [components.css:155-189](../css/components.css#L155-L189)
4. **C3** — contrast audit per theme, fix tokens in [css/variables.css](../css/variables.css) + [css/themes.css](../css/themes.css)
5. **C4** — admin hamburger drawer component
6. **H1/H2/H3/H4** — bulk accessibility pass
7. **H6/H7** — mobile polish
8. Design Vision implementation (Editorial Chess)

---

## Verification gates for the fix pass

- axe-core: 0 serious/critical violations on all pages × themes
- `document.documentElement.scrollWidth === window.innerWidth` at 360/375/412
- Every `button/a/input` ≥ 44×44px via BoundingClientRect
- Sticky avg/stat rows visible when scrolled to bottom of league table
- iOS Safari simulator: no input zoom on focus
