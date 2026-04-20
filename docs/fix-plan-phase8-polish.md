# Phase 8 Polish Pass — 15 Follow-up Items

## Context

Post-Phase-7 UX polish across the Shabi Israel chess-league app. Previous session ([fix-plan-15-issues.md](fix-plan-15-issues.md)) added 4-col sticky to Main-Dashboard Match Records, 3-col sticky to Rounds, 2-col sticky to Player Profile General, and visual unification. This pass addresses **15 follow-up items** that span:

- League-type pill consistency across all pages (including Admin)
- Admin removal flows (photo + title)
- A new AVG PR WIN achievement card
- Show-all limits and pattern standardization
- Mobile ↔ desktop click-behavior swap
- Additional sticky / font / column-width tweaks

**Global rule (carried from last session):** every sticky-on-mobile request also applies on desktop and vice versa.

---

## Files Touched (reference — all paths relative to repo root)

| Area | File |
|---|---|
| Landing render (Main Dashboard) | [js/render/landingPage.js](../js/render/landingPage.js) |
| Landing / Dashboard CSS | [css/index-dashboard.css](../css/index-dashboard.css) |
| League dashboard render | [js/render/dashboardPage.js](../js/render/dashboardPage.js) |
| League dashboard CSS | [css/dashboard.css](../css/dashboard.css) |
| Full league table CSS | [css/components.css](../css/components.css) |
| Player-general render | [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js) |
| Player-general CSS | [css/player-general.css](../css/player-general.css) |
| Click interaction | [js/render/playerNameInteraction.js](../js/render/playerNameInteraction.js) |
| League page render | [js/render/leaguePage.js](../js/render/leaguePage.js) |
| Admin player editor | [js/admin/playerManager.js](../js/admin/playerManager.js) |
| Admin leagues table | [js/admin/leagueManager.js](../js/admin/leagueManager.js) |
| All-time rankings | [js/compute/allTimeRankings.js](../js/compute/allTimeRankings.js) |
| League-type helpers | [js/compute/leagueTypes.js](../js/compute/leagueTypes.js) |

---

## League-Type Label Style (used by Part C)

**No emojis / icons.** Keep the current rounded pill — colored background per type, type label text inside. The only goal for Part C is to unify this same pill style across every location that shows a league-type label, including Admin Mode Leagues.

Reference pill: `.league-type-pill` in [css/index-dashboard.css:251–273](../css/index-dashboard.css) (Main Dashboard). Color tokens `--lt-doubling-bg`, `--lt-ubc-bg`, `--lt-regular-bg` already exist in `css/variables.css` and are also reused by `.pg-lt` on the player-general page.

---

## MCP Verification (applies to every part)

1. Ensure local server is running from repo root: `npx http-server -p 8080 --cors -c-1`
2. Use **Playwright MCP** (`mcp__playwright__browser_*`) at two viewports: **375×812** (mobile) and **1440×900** (desktop).
3. Screenshot → scroll horizontally if sticky-related → screenshot again. Confirm no overlap, correct fonts, sticky regions hold.

---

# PART A — Main Dashboard polish (items 4, 5, 8, 11, 12, 14)

> **Self-contained context for a fresh window:**
> Landing page = `index.html` → render in `renderLandingPage()` at [js/render/landingPage.js](../js/render/landingPage.js). CSS in [css/index-dashboard.css](../css/index-dashboard.css). Sections touched: Notable Figures (render ~line 606), Completed Leagues table (render ~line 745), Match Records tables (render ~line 1430), Show-top-N helper `applyShowTopN` at ~line 1154, show-more button CSS at ~line 1115.

### A1 — Completed Leagues mobile pill smaller + header "Type" (item 4)
- In [css/index-dashboard.css](../css/index-dashboard.css) `.league-type-pill` (~line 251): add a `@media (max-width:640px)` override reducing font-size to match the rest of the row (`0.65rem` — matches the Completed Leagues mobile body after A3) and shrinking padding to `1px 6px`.
- In [js/render/landingPage.js](../js/render/landingPage.js) at the Completed Leagues `<th>` (~line 803), change `thLabel('Type','T')` → `thLabel('Type','Type')`.

### A2 — Notable Figures mobile font reduce (item 5)
- In [css/index-dashboard.css](../css/index-dashboard.css), inside the `@media (max-width:640px)` block, add rules for `.notable-row .player-name-link`, `.notable-row .notable-value`: drop font-size by ~10% (e.g. `0.85rem` → `0.78rem`), and set `white-space: nowrap` on the value to prevent row overflow.

### A3 — Completed Leagues mobile font match tables below (item 8)
- Lower `.completed-leagues-table` mobile font-size at ~line 1082 from `0.7rem` → `0.65rem` (matches Match Records mobile). Keep padding identical.

### A4 — Completed Leagues: DATE column sticky on both viewports (item 11)
- Table columns: `# | League | Type | Players | Date`. Pin **Date** (last column) as right-sticky.
- Define CSS variable `--cl-date-w: 64px mobile / 80px desktop` on `.completed-leagues-table`.
- Add rules for `thead th:last-child` and `tbody td:last-child`: `position: sticky; right: 0; z-index: 2 (body) / 4 (head); background: var(--color-surface)` and `background: var(--header-bg)` respectively.
- Add `border-left: 1px solid var(--color-border)` on that column to mark the sticky boundary.
- Apply on both desktop and mobile (global rule).

### A5 — Completed Leagues limit to 10 + Show All button (item 14)
- In [js/render/landingPage.js](../js/render/landingPage.js) `renderCompletedLeagues()` (~line 743), after injecting the table, call the existing `applyShowTopN(tableEl, 10)` helper (already used by Match Records). Wrap the button + table in the same `.show-more-btn` visual pattern.
- Button label: "Show all (N)" / "Show top 10" — identical copy to Match Records.

### A6 — Match Records: reduce 4-col sticky → 3-col sticky (item 12)
- In [css/index-dashboard.css](../css/index-dashboard.css) lines ~726–770, remove the `nth-child(4)` sticky rules (`.match-records-table thead/tbody td:nth-child(4)`) and the `--mr-col4-w` offset. Keep cols 1–3 sticky: `# | Player | PR/Luck Gap`. Move the `border-right` from col 4 to col 3.
- In the mobile `@media` block at ~line 772, drop `--mr-col4-w`.

### A7 — Verify (Playwright MCP)
1. Navigate to `http://localhost:8080/`.
2. Mobile 375×812 → screenshot hero + Notable Figures + Completed Leagues (scroll horizontally — confirm DATE pinned right) + Match Records (scroll — confirm only 3 cols sticky, 4th scrolls) + confirm Show-All button below Completed Leagues if >10 leagues exist.
3. Desktop 1440×900 → repeat, verify identical sticky behavior.
4. Click **Show all** on Completed Leagues → full list renders, button toggles to "Show top 10".

### Command to run Part A in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART A only (items 4, 5, 8, 11, 12, 14). Stop and summarize after A7 verification."
```

---

# PART B — League Dashboard polish (items 7, 9 verify, 10)

> **Self-contained context for a fresh window:**
> League dashboard page = `dashboard.html?league=<id>` → [js/render/dashboardPage.js](../js/render/dashboardPage.js). CSS in [css/dashboard.css](../css/dashboard.css). Historical View (F2) sits above Predictor/What-If and is the reference for mobile font size (`0.65rem` in [css/components.css:502](../css/components.css)). Full UBC league table uses `#leagueTable` with GAMES column in [css/components.css](../css/components.css) ~line 183.

### B1 — Predictor & What-If mobile font match Historical (item 7)
- In [css/dashboard.css](../css/dashboard.css) ~lines 849–911, inside the `@media (max-width:640px)` block, set both thead and tbody of `.predictor-scroll-wrap` and `.whatif-scroll-wrap` to `font-size: 0.65rem`. Keep existing padding/column-widths intact.

### B2 — Rounds table sticky (item 9) — VERIFY ONLY
- Per previous session, Rounds already has 3-col sticky at [css/dashboard.css:988–1049](../css/dashboard.css).
- Verify by Playwright — if sticky is working, no code change.
- If broken, re-apply the pattern from Part B2 of [fix-plan-15-issues.md](fix-plan-15-issues.md).

### B3 — UBC full league table GAMES column narrower on mobile (item 10)
- Reference: Doubling league `#leagueTable thead th:nth-child(3)` is `width: 36px`. UBC GAMES currently renders wider due to different column order.
- Identify which `nth-child` is GAMES in UBC (check `renderSummaryTable` column order in [js/render/leaguePage.js:136](../js/render/leaguePage.js) and `#leagueTable[data-league-type="ubc"]` selectors in [css/components.css](../css/components.css) ~line 529+).
- Add a mobile override scoped to `#leagueTable[data-league-type="ubc"]` setting GAMES column to `width: 28px; min-width: 28px; max-width: 28px; font-size: 0.62rem`. Header should show `G` abbreviated via `thLabel('Games','G')`.
- Apply on desktop too (keep 36px on desktop if that matches Doubling — confirm visually).

### B4 — Verify (Playwright MCP)
1. Navigate to a UBC-type league at `http://localhost:8080/dashboard.html?league=<UBC id>`.
2. Mobile 375×812 → screenshot Historical + Predictor + What-If; confirm identical font. Scroll Rounds horizontally, confirm 3 left sticky cols hold.
3. Navigate to `league.html?league=<UBC id>` → screenshot table; confirm GAMES column narrow like Doubling's G column.
4. Desktop 1440×900 → same checks.

### Command to run Part B in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART B only (items 7, 9 verify-only, 10). Stop and summarize after B4 verification."
```

---

# PART C — League-type pill unified across all pages (item 1)

> **Self-contained context for a fresh window:**
> Three locations render the league-type label. They must all share **one rounded-pill visual style**, with same color-per-type and same full label text. **Do not add emojis or icons** — just ensure the existing pill is used consistently.
> - **Main Dashboard Completed Leagues**: pill rendered at [landingPage.js:787](../js/render/landingPage.js), CSS `.league-type-pill` in [index-dashboard.css:251–273](../css/index-dashboard.css).
> - **Player-general "Leagues" table**: pill rendered at [playerGeneralPage.js:465](../js/render/playerGeneralPage.js), CSS `.pg-lt` in [player-general.css:275–300](../css/player-general.css). Parallel-but-separate rule — functionally identical but can drift.
> - **Admin Leagues table**: [js/admin/leagueManager.js](../js/admin/leagueManager.js) — grep for `LeagueType`/`Type` column rendering. Today may be plain text with no pill.

### C1 — Audit current state
- Grep the 3 files above for how each renders the type column. Note font-size, padding, border-radius, color mapping.
- If all 3 already use an identical pill → only label consistency remains (C3).
- If not → canonical version is Main Dashboard `.league-type-pill`.

### C2 — Consolidate to a single CSS class + color tokens
- Ensure color tokens live in [css/variables.css](../css/variables.css): `--lt-doubling-bg/-text`, `--lt-ubc-bg/-text`, `--lt-regular-bg/-text`. If they already exist, reuse.
- Keep `.league-type-pill` in [index-dashboard.css](../css/index-dashboard.css) as authoritative. In [player-general.css](../css/player-general.css), either:
  - (a) **(preferred)** delete `.pg-lt*` rules and have `playerGeneralPage.js` render `.league-type-pill` directly; or
  - (b) keep `.pg-lt` but mirror `.league-type-pill` declarations exactly so there's no visual drift.
- Admin: update [leagueManager.js](../js/admin/leagueManager.js) to render the type cell using `<span class="league-type-pill type-${t}">${typeLabel}</span>`. If [css/admin.css](../css/admin.css) doesn't already reach `.league-type-pill`, ensure the stylesheet is loaded on the admin page (check [admin.html](../admin.html) `<link>` tags).

### C3 — Label text consistency
- All 3 must use the exact same labels: `Doubling`, `Regular`, `UBC` (title-cased, no abbreviations on desktop). Mobile column-header abbreviation ("Type") handled separately in Part A1.

### C4 — Verify (Playwright MCP)
1. Landing → Completed Leagues pills: screenshot at mobile + desktop.
2. Player-general page (`player_general.html?player=<name>`) → Leagues table pills: screenshot same viewports.
3. Admin (`admin.html` → Leagues panel) → pills: screenshot.
4. Compare all 3 side-by-side: same border-radius, padding, color per type, text. No emojis.

### Command to run Part C in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART C only (item 1 — unify existing rounded league-type pill across Main Dashboard, player-general Leagues table, and Admin Leagues table). NO emojis — keep the current colored-pill + text-label design, just ensure it's visually identical on all 3 pages. Stop and summarize after C4 verification."
```

---

# PART D — Admin: remove photo/title options (item 2)

> **Self-contained context for a fresh window:**
> Admin player editor in [js/admin/playerManager.js](../js/admin/playerManager.js). Photo upload `pickPhoto()` ~line 225. Form render ~lines 26–250. Save logic `savePlayer()` ~lines 252–338. Championship titles in dynamic list (add button ~line 119, per-row remove ~line 217).

### D1 — Remove existing photo
- Button around line 129 currently only appears if a *new* photo is staged. Extend: also show "Remove existing photo" when the player already has a photo in metadata (even if none staged this session).
- On click: set `_state.removeExistingPhoto = true`. In `savePlayer()`, if the flag is set, stage a binary delete of `assets/players/{safeName}.{ext}` (add a `delete` kind to the binary-change queue if not already supported) and clear the `photo` field in the player entry JSON.

### D2 — Remove existing BMAB title
- BMAB dropdown currently has no explicit clear action beyond selecting "(none)". Confirm a `(none)` / empty option exists — if not, add it. On save, treat empty as "delete title field from JSON entry" (don't write an empty string).

### D3 — Remove existing Championship title (row)
- Dynamic list already has per-row remove (line 217). Verify it also works for *existing* rows loaded from JSON (not just freshly added). If an existing row lacks a working remove button, add one.
- On save, exclude removed rows from the serialized championships array.

### D4 — Verify (Playwright MCP)
1. Navigate to `http://localhost:8080/admin.html`, login, open Players panel, select a player with photo + BMAB + championship.
2. Click "Remove photo" → save → reload → verify photo gone.
3. Set BMAB to "(none)" → save → reload → verify BMAB field cleared in JSON.
4. Remove a championship row → save → reload → verify that championship gone.
5. Desktop viewport only (admin is desktop-focused).

### Command to run Part D in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART D only (item 2 — admin remove photo/title options). Stop and summarize after D4 verification."
```

---

# PART E — AVG PR WIN achievement (item 6)

> **Self-contained context for a fresh window:**
> Main Dashboard Achievements grid is in [js/render/landingPage.js](../js/render/landingPage.js) at `ACHIEVEMENT_METRICS` ~line 1186. All-time computation in [js/compute/allTimeRankings.js](../js/compute/allTimeRankings.js). PR wins already tracked per-league in [js/compute/stats.js](../js/compute/stats.js) at `prWins` ~line 80. Grid layout: mobile stacks vertically, desktop grid — CSS at [index-dashboard.css](../css/index-dashboard.css) ~lines 619–638.

### E1 — Compute all-time PR-win rate across UBC leagues (including running)
- In [js/compute/allTimeRankings.js](../js/compute/allTimeRankings.js): extend the accumulation loop to collect `prWins` and `prGames` across all UBC leagues **whether running or completed**.
- Per-player, output `prWinRate = prWins / prGames` (or `null` if `prGames === 0`).
- Scope this metric to `league.params.LeagueType === 'ubc'` only (user explicitly said "UBC tournaments").

### E2 — Add card to Achievements grid
- Add entry to `ACHIEVEMENT_METRICS`:
  ```js
  { key: 'prWinRate', label: 'AVG PR WIN', fmt: v => formatPercent(v), minGames: 5 /* filter players with too few PR games */ }
  ```
- Position: user spec → on mobile **below** AVG WIN RATE; on desktop **right of** AVG WIN RATE. Grid already flows that way — place the new entry immediately after AVG WIN RATE in the array.

### E3 — Verify (Playwright MCP)
1. Landing page → confirm the 6th card "AVG PR WIN" renders after AVG WIN RATE.
2. Mobile: card stacks below AVG WIN RATE.
3. Desktop: card sits right of AVG WIN RATE in the grid row.
4. Spot-check value: pick a known player with UBC history; manually compute PR-win % from raw CSV vs. card — must match.
5. Confirm including a running league doesn't break the calc (pick a player in both running + completed UBC leagues).

### Command to run Part E in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART E only (item 6 — AVG PR WIN achievement across all-time UBC leagues including running). Stop and summarize after E3 verification."
```

---

# PART F — Player Card General page overhaul (items 3, 13a–13e)

> **Self-contained context for a fresh window:**
> Player card = `player_general.html?player=<name>` → [js/render/playerGeneralPage.js](../js/render/playerGeneralPage.js). CSS [css/player-general.css](../css/player-general.css). Three tables:
> - **Leagues** `.pg-leagues-table` (render ~line 433)
> - **Match History** `.pg-matches-table` (render ~line 583, helper `renderTable()`)
> - **Match Records** `.pg-mr-table` / `.match-records-table` (render via `renderPlayerMatchRecords` ~line 694)
>
> Previous session added 2-col sticky + unified styling — see [fix-plan-15-issues.md PART A](fix-plan-15-issues.md). Show-all button pattern already exists in Main Dashboard `applyShowTopN` at [landingPage.js:1154](../js/render/landingPage.js) and CSS `.show-more-btn` at [index-dashboard.css:1115](../css/index-dashboard.css).

### F1 — Rounded corners match dashboard tables (item 13a)
- In [css/player-general.css:408](../css/player-general.css), change `border-radius: var(--radius-md)` → `var(--radius-lg)` on `.pg-leagues-table, .pg-matches-table, .pg-mr-table` to match `.table-wrapper` in [layout.css:60](../css/layout.css). Keep `overflow: visible` (required for sticky — do NOT add `overflow: hidden`).
- Ensure box-shadow matches dashboard-table style (`var(--shadow-md)` or whatever dashboard uses).

### F2 — Mobile LEAGUE column wider in Leagues table (item 13b)
- In [css/player-general.css:690](../css/player-general.css), increase `--pg-col1-w: 110px` → `150px` on mobile. Keep desktop at current value.

### F3 — Add DATE column as new leftmost, sticky (item 13c)
- **JS:** In [playerGeneralPage.js](../js/render/playerGeneralPage.js) `renderLeaguesTable()` ~line 433, add a DATE column as first (leftmost) header and cell. Source the date from `league.params.IssueDate` (ISO), format using `parseLeagueDate()` in [js/utils/helpers.js](../js/utils/helpers.js) + `toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})` pattern from line 609.
- **CSS:** Update sticky rules at [player-general.css:559–609](../css/player-general.css) so Date (col 1) is sticky at `left:0`, League (col 2, was col 1) is sticky at `left: var(--pg-date-w)`. Drop old col-2 sticky on Type.
- Define `--pg-date-w: 72px mobile / 90px desktop`.
- Apply on both desktop and mobile (global rule).

### F4 — Mobile font size + sticky background fix (item 13d)
- In mobile `@media` block at [player-general.css:687+](../css/player-general.css), set explicit `font-size: 0.65rem` on `.pg-matches-table` and `.pg-mr-table` to match `.pg-leagues-table`.
- Fix sticky-background stripe bleed: on `.pg-leagues-table tbody td:nth-child(1)`, `.pg-leagues-table tbody td:nth-child(2)`, `.pg-matches-table tbody td:nth-child(1)`, `.pg-matches-table tbody td:nth-child(2)` add `background: var(--color-surface) !important;` (overrides row-alt-bg stripe leaking through on scroll). Mirror the Main Dashboard Match Records pattern at [index-dashboard.css:727](../css/index-dashboard.css).

### F5 — Show-all pattern match Main Dashboard (item 13e)
- Remove the existing mobile "SHOW ALL X MATCHES" button from `renderTable` at [playerGeneralPage.js:583](../js/render/playerGeneralPage.js). Delete `hidden-mobile` class logic + the expand button (~lines 619–648).
- Replace with calls to `applyShowTopN()` (import from landingPage or extract to a shared util):
  - **Match Records**: default top-5 (by PR Gap / Luck Gap respectively — already sorted).
  - **Match History**: default top-10 (most recent first — already sorted by date desc).
- Use `.show-more-btn` styling from [index-dashboard.css:1115](../css/index-dashboard.css) — copy or import.
- Apply on both desktop and mobile — same behavior.

### F6 — Desktop Match Records column widths (item 3)
- In [css/index-dashboard.css](../css/index-dashboard.css) (`.match-records-table` also used on player page), widen Player column (`nth-child(2)` — `--mr-col2-w`) by ~16px on desktop so YOSSI ELIEZER's title badge + name fit. Take space proportionally from Opponent/Score/League.
- Verify Title-badge rendering in [js/data/titleConstants.js](../js/data/titleConstants.js) — badge is inline span; ensure cell has `white-space: nowrap` and sufficient width.

### F7 — Verify (Playwright MCP)
1. Navigate to `http://localhost:8080/player_general.html?player=YOSSI%20ELIEZER`.
2. Mobile 375×812 → screenshot each of the 3 tables; scroll horizontally; confirm DATE + LEAGUE both sticky, font-size uniform, backgrounds opaque (no stripe bleed), rounded corners match dashboard tables.
3. Confirm default row counts: Match Records shows 5 rows + "Show all" button, Match History shows 10 rows + "Show all" button. Click each → full list expands, button label flips.
4. Desktop 1440×900 → repeat; confirm YOSSI ELIEZER's title badge no longer overflows Player column.
5. Second player (e.g. AVI, NISSIM B) → confirm no regressions.

### Command to run Part F in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART F only (items 3, 13a–13e — player card general overhaul). Stop and summarize after F7 verification."
```

---

# PART G — Click behavior swap (item 15)

> **Self-contained context for a fresh window:**
> Player-name click handling in [js/render/playerNameInteraction.js](../js/render/playerNameInteraction.js) (lines 1–82). `playerNameLink()` ~line 23 builds the anchor href. `attachPlayerNameInteractions()` ~line 35 wires right-click context menu. Called from [js/render/leaguePage.js:12](../js/render/leaguePage.js). Helpers: `playerUrl(leagueId, name)` and `playerGeneralUrl(name)` in [js/utils/helpers.js](../js/utils/helpers.js).

### G1 — Swap mobile tap and desktop left-click
- Today: left-click (desktop) + single-tap (mobile) both → **general** card. Right-click → context menu with **league-specific** card option.
- Target:
  - **Mobile single-tap** → league-specific card (`playerUrl(leagueId, name)`).
  - **Desktop left-click** → league-specific card.
  - **Right-click / long-press** → context menu with general card option.
- Implementation: change the default `href` in `playerNameLink()` to `playerUrl(leagueId, name)` (requires passing `leagueId` — already passed through `attachPlayerNameInteractions`). Update the right-click context menu option label to "Open general card" with URL `playerGeneralUrl(name)`.

### G2 — Verify (Playwright MCP)
1. Navigate to `http://localhost:8080/league.html?league=<any id>`.
2. Desktop 1440×900 → left-click player name → navigates to `player.html?league=<id>&player=<name>`.
3. Right-click same name → context menu shows "Open general card"; click → navigates to `player_general.html?player=<name>`.
4. Mobile 375×812 → tap player name → navigates to league-specific player page.
5. Long-press / right-click on mobile → context menu shows general-card option.
6. Check Championship Predictor, What-If, Rounds tables — same behavior (all use the same interaction helper).

### Command to run Part G in a fresh window
```
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART G only (item 15 — swap player-name click behavior). Stop and summarize after G2 verification."
```

---

## Execution order & parallelism

All 7 parts are independent — each touches a distinct render/CSS area. They can run in parallel in separate windows. Suggested serial order:

1. **C** (pill unification) — lightweight, low risk; visual output visible elsewhere
2. **A** + **B** (dashboard polish) — can run parallel
3. **F** (player card) — largest; benefits from A's show-top-N reference
4. **E** (achievements) — self-contained
5. **D** (admin) — self-contained
6. **G** (click swap) — interaction layer; independent

## Batch launch (all 7 parallel windows)

Each command below launches a fresh Claude Code window resuming this plan for one part. Run each from repo root (`c:\WORKSPACE\Shabi_Israel`):

```
# Window 1
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART A only."

# Window 2
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART B only."

# Window 3
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART C only."

# Window 4
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART D only."

# Window 5
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART E only."

# Window 6
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART F only."

# Window 7
claude "Resume plan at docs/fix-plan-phase8-polish.md — execute PART G only."
```

---

## Item-to-Part map (cross-reference)

| Item | Short description | Part |
|---|---|---|
| 1 | League-type pill unified (dashboard + player card + admin) | C |
| 2 | Admin: remove existing photo/title | D |
| 3 | Desktop Match Records Player column wider (YOSSI ELIEZER fit) | F6 |
| 4 | Mobile Completed Leagues pill smaller + header "Type" | A1 |
| 5 | Notable Figures mobile font smaller | A2 |
| 6 | AVG PR WIN achievement (UBC, all-time incl. running) | E |
| 7 | Predictor/What-If mobile font = Historical | B1 |
| 8 | Completed Leagues mobile font = tables below | A3 |
| 9 | Rounds 3-col sticky (verify — likely already done) | B2 |
| 10 | UBC GAMES column narrower mobile (match Doubling G) | B3 |
| 11 | Completed Leagues DATE column sticky | A4 |
| 12 | Match Records sticky 4→3 cols | A6 |
| 13a | Player card tables rounded corners | F1 |
| 13b | Player card LEAGUES column wider mobile | F2 |
| 13c | Player card DATE column sticky (new leftmost) | F3 |
| 13d | Player card mobile font + sticky bg stripe fix | F4 |
| 13e | Player card show-all pattern (Records top-5, History top-10) | F5 |
| 14 | Main Dashboard Completed Leagues limit 10 + Show All | A5 |
| 15 | Swap mobile tap ↔ desktop left-click (→ league-specific) | G |
