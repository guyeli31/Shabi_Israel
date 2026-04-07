# Polish Phase — Unified Backlog (Post-Phase H)

> Synced from `~/.claude/plans/wiggly-wiggling-corbato.md` so it travels with the repo.
> Update the **Status** section below as chunks progress.

---

## Status

| Chunk | Title | Status |
|-------|-------|--------|
| 1 | Data model & league params | ✅ Done |
| 2 | Cross-league rankings & all-time tables | ✅ Done |
| 3 | Main dashboard polish | ✅ Done |
| 4 | League dashboard polish | ⏳ Next |
| 5 | Player cards polish | ⬜ Pending |
| 6 | Charts | ⬜ Pending |
| 7 | Admin edit-mode for landing page | ⬜ Pending |
| 8 | Themes redesign session | ⬜ Pending |

Last updated: 2026-04-08

---

## Context
Phase H has been committed. The user is documenting a polish/finishing phase that combines (a) the original 6 fixes recorded earlier and (b) 14 new items raised after Phase H. The goal of this file is to be a single source of truth for everything to be implemented in the polish phase, broken into coherent work chunks so it can be executed incrementally rather than in one massive change.

---

## Strategy

The 20 items naturally cluster by subsystem. Implementing chunk-by-chunk lets each piece be reviewed, committed, and validated independently. Suggested order is bottom-up: data/compute foundations first (so UI changes have something to render), then UI polish, then admin edit features last (they touch the broadest surface).

### Suggested chunks
1. **Chunk 1 — Data model & league params** (items 12, 2, 5)
   New params (entry fee, prize amounts), issue-date field for completed leagues, "active league excluded from achievements" rule. Foundational; everything else can build on the new params shape.
2. **Chunk 2 — Cross-league rankings & all-time tables** (items NEW-4, NEW-7, OLD-4)
   Build the all-time gold/silver/bronze/avg-rank tables per league type, the PR Leaders tables (Total PR + Last 300 PR), the Win Rate achievement field, and the trophy logo asset wiring. This is the biggest compute change and unblocks several UI pieces.
3. **Chunk 3 — Main dashboard polish** (items NEW-1, NEW-4 UI, NEW-10, OLD-5)
   Replace PDF export with image export + row-count input, add Achievements section with tabs, add PR Leaders tables, remove redundant Search Player block, add "Last Updated" + league-type column with row tinting on Completed Leagues table.
4. **Chunk 4 — League dashboard polish** (items NEW-3, OLD-1, NEW-9 partial)
   Leading Player clickability, themed placement colors (deferred to a design session), chart axis legends + tick marks (shared with chunk 6).
5. **Chunk 5 — Player cards polish** (items NEW-6, NEW-7, NEW-8, NEW-11, NEW-13, NEW-14, OLD-3)
   League column visited-link styling fix, Match History 20-row scroll cap, achievement Win Rate field + links, RANK column medal coloring/bold, league player card date column with sort, opponent click-through, moving-average bug fix, global player search routing.
6. **Chunk 6 — Charts** (item NEW-9, NEW-13)
   Axis legends, evenly spaced tick marks, fix moving-average to be cumulative-history-correct. Single pass over `playerBarChart.js`.
7. **Chunk 7 — Admin edit-mode for landing page** (item OLD-2)
   Logo upload, title/subtitle editing, drag-and-drop league reorder, decide fate of `leagues_order.json`. Largest UI surface — do last.
8. **Chunk 8 — Themes redesign session** (item OLD-6, OLD-3)
   Dedicated working session, no code yet.

---

## Backlog — Items

Numbering: `NEW-n` = items from current request; `OLD-n` = items from the original 6-item backlog.

### NEW-1 — Image export from main dashboard (replaces PDF)
The user previously asked for PDF export from the main dashboard. That was a misstatement — they want **image export**, exactly like the "remaining games report" in admin (PNG via html2canvas).
- Single button to generate the image.
- Second input box for the user to type **how many top rows** to include in the image.
- Files: [js/render/landingPage.js](../../js/render/landingPage.js) (replace `exportLeaderboardPDF` lines ~568–616), [js/admin/remainingReport.js](../../js/admin/remainingReport.js) (reuse html2canvas pattern), [index.html](../../index.html) (drop jsPDF script tag at line ~37–38 if no longer used).

### NEW-2 — Completed Leagues date = league issue date
Currently the date column on the Completed Leagues table is parsed from the folder name. Replace with an explicit **issue date** field.
- Display as a calendar date, no time.
- Editable later by the admin.
- Likely a new `IssueDate` field in `league_params.json`. Add to all existing files as part of the migration.
- Files: [js/render/landingPage.js](../../js/render/landingPage.js) lines 270–333 + `parseLeagueDate` lines 40–46, [js/data/leagueLoader.js](../../js/data/leagueLoader.js), every `leagues/*/league_params.json`.

### NEW-3 — League dashboard top placement colors (design session)
Top placement colors on the league dashboard can change as long as they fit the theme. Defer to the themes redesign session (OLD-6).
- Files: [js/render/dashboardPage.js](../../js/render/dashboardPage.js) `rankClass` lines 248–253, [css/theme.css](../../css/theme.css).

### NEW-4 — Achievements area on the main dashboard + PR Leaders tables
Add an **Achievements** area on the main landing page mirroring the structure inside the global player card.
- Tabs per league type (same as global player card).
- Each tab exposes the underlying ranking tables: gold count, silver count, bronze count, **AVG RANK**.
- Tables include **all players, all-time** that ever played in a league of that type.
- The "4th / 52" style text inside individual player cards must become **clickable links** to the corresponding all-time table.
- Add a new **PR Leaders** table on the main dashboard:
  - Only for non-`regular` league types.
  - Two variants: **Total PR** (mean over all-time) and **Last 300 PR**.
  - All-time, all players.
  - Must also be reachable from the global player card, where the player's "rank X / Y" appears with a link to the table.
- Files: [js/render/landingPage.js](../../js/render/landingPage.js), [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js) (`renderAchievements` lines 193–257), [js/compute/crossLeague.js](../../js/compute/crossLeague.js) (`collectMedalsByType` lines 260–334, `aggregatePR` lines 131–179 — already computes Total PR and Last 300 PR; reuse), [js/compute/leagueTypes.js](../../js/compute/leagueTypes.js).
- New module likely: `js/compute/allTimeRankings.js` to centralize the all-time tables consumed by both the dashboard and the player card.

### NEW-5 — Active league players excluded from Achievements
If a league is still active (`params.Running === true`), players currently in top placements **must not** receive an achievement (medal) for that league yet.
- Update `collectMedalsByType` in [js/compute/crossLeague.js](../../js/compute/crossLeague.js) to skip leagues where `Running === true`.
- This must propagate everywhere medal counts are read.

### NEW-6 — Global player card visited-link styling
In global player cards, the LEAGUE column text turns purple after clicking (default visited-link color), which looks unpolished. Match the styling used in the main dashboard tables.
- Same fix needed in the **Match History** table.
- Plus: cap the Match History table at **20 rows visible**, with scroll for the rest.
- Files: [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js) `renderLeaguesTable` lines 261–306, `renderMatchHistory` lines 310+, [css/components.css](../../css/components.css).

### NEW-7 — Win Rate achievement field on global player card
In the global player card, inside Achievements, for each league type, add a **5th field — WIN RATE** showing the player's win rate across the entire history of that league type, with a link to the corresponding all-time table.
- Files: [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js) `showAchievementType` lines 228–257, [js/compute/crossLeague.js](../../js/compute/crossLeague.js).

### NEW-8 — Medal coloring on global player card Leagues table RANK column
In the Leagues table inside the global player card, color the RANK cell (text or background) when the player finished with a medal, and also make it **bold** for first-place finishes.
- Files: [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js) `renderLeaguesTable` lines 261–306, [css/components.css](../../css/components.css).

### NEW-9 — Chart axis legends + tick marks
The Match History bar charts (both league dashboard and player cards) need:
- Axis legends.
- Evenly spaced intermediate tick marks so the X axis is navigable even with ~100 entries. Pick a sensible spacing.
- Files: [js/render/playerBarChart.js](../../js/render/playerBarChart.js) (custom Canvas chart, lines 16+).

### NEW-10 — Remove duplicate Search Player from main dashboard
The main dashboard has a Search Player block (`renderPlayerSearch` lines 139–188 in [js/render/landingPage.js](../../js/render/landingPage.js)) which duplicates the search already shown in the top-right header. Remove the dashboard one.

### NEW-11 — Date column on league player card games table
On the **league** player card, the games table needs a **Date Updated** column, sortable like the others.
- Files: [js/render/playerPage.js](../../js/render/playerPage.js) `renderMatchTable` / `renderMatchRows` lines 87+.
- May require carrying the date from the CSV row through to the renderer.

### NEW-12 — League fees parameters
Add new league params:
- **Entry fee**.
- **Prize amounts** for gold / silver / bronze.
Update every relevant rendering surface and dashboards. **Not relevant** to the main landing dashboard. Profit-based ranking is **out of scope** for now.
- Files: every `leagues/*/league_params.json`, [js/data/leagueLoader.js](../../js/data/leagueLoader.js), [js/render/dashboardPage.js](../../js/render/dashboardPage.js), [js/render/leaguePage.js](../../js/render/leaguePage.js), [js/render/playerPage.js](../../js/render/playerPage.js), [js/admin/leagueManager.js](../../js/admin/leagueManager.js) (admin editor for the new fields).

### NEW-13 — Moving Average must be cumulative
The Moving Average line in the bar charts currently doesn't converge as more X-axis values are added. It should reflect the **full history up to that point** (cumulative mean), not a fixed-window 5-bar average.
- Files: [js/render/playerBarChart.js](../../js/render/playerBarChart.js) lines ~201–209.

### NEW-14 — Opponent click-through in global player card Match History
In the global player card's Match History, the OPPONENT cell should be clickable and navigate to **that opponent's global player card**.
- Files: [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js) match history rendering lines 280–304.

### OLD-1 — League Dashboard: clickable Leading Player
Leading Player on the league dashboard should be clickable and navigate to the player card, like every other player name.
- Files: [js/render/dashboardPage.js](../../js/render/dashboardPage.js) `renderSummaryCards` lines 148–183, [js/render/playerNameInteraction.js](../../js/render/playerNameInteraction.js).

### OLD-2 — Admin Edit Mode on the main landing page
Admin should be able to open the landing dashboard in **Edit Mode** and:
- Replace the main logo by uploading a local image file.
- Edit the main title and subtitle.
- Reorder leagues via drag-and-drop (overrides chronological default).
- Decision: drop or restructure [leagues/leagues_order.json](../../leagues/leagues_order.json) — recommend folding it into a per-deployment `landing_settings.json` (logo path, title, subtitle, ordered league list) committed via the existing GitHub-publish flow in [js/admin/githubApi.js](../../js/admin/githubApi.js).
- Files: [js/render/landingPage.js](../../js/render/landingPage.js), [js/admin/render/adminPage.js](../../js/admin/render/adminPage.js), [js/admin/leagueManager.js](../../js/admin/leagueManager.js), [js/admin/githubApi.js](../../js/admin/githubApi.js), [js/admin/stagingStore.js](../../js/admin/stagingStore.js).

### OLD-3 — Global player search from main dashboard
Searching for a player from the main dashboard should land on the player's **global** card (cross-league), not a league-specific one.
- Files: [js/render/landingPage.js](../../js/render/landingPage.js) `renderPlayerSearch` (or its replacement after NEW-10), [js/render/navigation.js](../../js/render/navigation.js), [player_general.html](../../player_general.html).
- Note: NEW-10 removes the dashboard search box, so this becomes about ensuring the **header search** routes to the global card.

### OLD-4 — Trophy logos per league type (Gold/Silver/Bronze)
For each league type, ship 3 trophy/championship-plate logos (gold, silver, bronze).
- Display on the player card whenever the player won that placement.
- Display as the league logo in the leagues list.
- Files: [css/components.css](../../css/components.css), [js/render/landingPage.js](../../js/render/landingPage.js), [js/render/playerGeneralPage.js](../../js/render/playerGeneralPage.js), [js/compute/leagueTypes.js](../../js/compute/leagueTypes.js), new asset folder under `assets/trophies/`.

### OLD-5 — Leagues list enhancements (Completed Leagues table)
- Add a **Last Updated** column.
- Leader name supports left-click and right-click like elsewhere.
- Add a **league type** column.
- Tint each row with a color matching its league type. Palette TBD during the themes session.
- Note: NEW-2 changes the existing Date column to an issue date — Last Updated is a separate column.
- Files: [js/render/landingPage.js](../../js/render/landingPage.js), [css/components.css](../../css/components.css), [css/theme.css](../../css/theme.css).

### OLD-6 — Themes redesign session
Dedicated working session to redesign themes from scratch. Bundle NEW-3 into this session.
- Files: [css/variables.css](../../css/variables.css), [css/theme.css](../../css/theme.css).

---

## Verification (per chunk)
- Run locally: `npx http-server -p 8080 --cors -c-1`.
- For each chunk: load main landing, open at least one league of each type (`doubling`, `regular`, `ubc`), open at least one player from each, exercise sortable tables, run admin mode where applicable.
- For chunks touching params (Chunk 1, NEW-12), validate every league still loads — missing fields must default safely.
- For Chunk 2 (cross-league), spot-check totals against current Phase H output for at least one well-known player to confirm no regressions.

## Notes
- Implementation order is bottom-up: data → compute → UI → admin → themes.
- Each chunk should be its own commit/PR for reviewability.
- Themes session (Chunk 8) may unblock final color choices in NEW-3 and OLD-5 retroactively.
