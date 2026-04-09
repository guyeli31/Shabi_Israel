# Plan: Hidden Leagues Filtering + UI Fixes

## Context
Multiple issues where HIDDEN leagues are not excluded from public-facing statistics, plus several UI/UX fixes needed in the player general card and league dashboard.

---

## Issue 1: HIDDEN leagues included in player stats, achievements, match history

**Root cause:** `loadAllLeagues()` (`crossLeague.js:21`) loads ALL leagues. Downstream consumers don't filter Hidden.

**Affected functions:**
- `loadPlayerAcrossLeagues()` — `crossLeague.js:68`
- `collectMedalsByType()` — `crossLeague.js:324`
- `flattenAllMatches()` — `crossLeague.js:498`
- `buildAllTimeRankings()` — `allTimeRankings.js:23`
- `listYearRanking()` — `crossLeague.js:196`
- `buildPlayerIndex()` — `navigation.js:174`

**Fix:**
1. In `crossLeague.js`, add a helper after `loadAllLeagues()`:
   ```js
   export async function loadVisibleLeagues() {
       const all = await loadAllLeagues();
       return all.filter(l => !l.params.Hidden);
   }
   ```
2. Update `loadPlayerAcrossLeagues()` to use `loadVisibleLeagues()` instead of `loadAllLeagues()`
3. Update `buildAllTimeRankings()` in `allTimeRankings.js` to add `!l.params.Hidden` to the existing filter at line 28-30
4. Update `listYearRanking()` in `crossLeague.js` to use `loadVisibleLeagues()`
5. Update `buildPlayerIndex()` in `navigation.js` to filter hidden leagues (it already loads from leagueIndex which has hidden flag — just add filter)
6. Landing page already filters correctly at `landingPage.js:67-71` — no change needed there

**Files to modify:**
- `js/compute/crossLeague.js`
- `js/compute/allTimeRankings.js`
- `js/render/navigation.js`

---

## Issue 2: PR Statistics ranking should be ALL-TIME, not 2026-scoped

**Current behavior:** PR values (Total PR, Last 300 PR) are correctly computed from all history. But the RANKING next to them uses `rankWithinYear(CURRENT_YEAR)` which only ranks players based on 2026 matches. This causes "No 2026 data" for players who haven't played in 2026.

**Fix:** Change the ranking to be all-time instead of year-scoped:
1. Create `listAllTimeRanking(leagueType, metric)` in `crossLeague.js` — like `listYearRanking` but without year filter
2. Create `rankAllTime(playerName, leagueType, metric)` wrapper
3. In `playerGeneralPage.js:198-200`, replace `rankWithinYear` calls with `rankAllTime` calls
4. Update `rankToggleHtml` at line 235 to show "All-time" label instead of year

**Files to modify:**
- `js/compute/crossLeague.js` — add all-time ranking functions
- `js/render/playerGeneralPage.js` — use all-time ranking

---

## Issue 3: Player with 2026 league registration gets gray dot instead of orange

**Current logic** (`playerGeneralPage.js:107-127`):
- GREEN: in a Running league
- ORANGE: not in Running league but has matches with `updatedAt` in current year
- GRAY: no matches in current year

**Problem:** A player like sasha_er registered in a 2026 league (in `allPlayers`) but with no played matches (or matches lacking `updatedAt`) gets gray.

**Fix:** Expand the orange condition to also check if the player is registered in any league that started in the current year (check `StartDate` from params):
```js
const inCurrentYearLeague = perLeague.some(e => {
    const sd = e.league.params?.StartDate;
    return sd && new Date(sd).getFullYear() === CURRENT_YEAR;
});
```
Then use `playedThisYear || inCurrentYearLeague` for the orange condition.

**File to modify:**
- `js/render/playerGeneralPage.js` — lines 107-127

---

## Issue 4: Achievements are ALL-TIME (confirmation + Hidden fix)

The user confirms achievements and PR Leaders in main dashboard should be from ALL history across all league types. Current code already computes all-time (no year filter). The only fix needed is Issue 1's Hidden filtering, which will exclude hidden leagues from these calculations.

**No additional changes beyond Issue 1.**

---

## Issue 5: Leading Player click in league dashboard

**Current:** `dashboardPage.js:155-160` renders leading player as plain text.

**Fix:** Use `playerNameLink()` from `playerNameInteraction.js`:
1. Import `playerNameLink` and `attachPlayerNameInteractions` in `dashboardPage.js`
2. Replace plain HTML with `playerNameLink(leader.player, flagCode)` at line 159
3. After rendering summary cards (~line 182), call `attachPlayerNameInteractions(container, leagueId)` to wire up left-click (→ general card) and right-click context menu (→ choose general or league card)

**File to modify:**
- `js/render/dashboardPage.js`

---

## Implementation Order
1. Issue 1 — Hidden filtering (foundation)
2. Issue 4 — Verified by Issue 1 (no extra work)
3. Issue 2 — All-time PR ranking
4. Issue 3 — Status dot fix
5. Issue 5 — Leading Player click

## Verification
- Load as non-admin, confirm hidden leagues don't appear in player general stats/achievements/match history
- Load as admin, confirm hidden leagues still visible in admin panel
- Check PR Statistics section shows all-time ranking (no "No 2026 data" for players with history)
- Check sasha_er gets orange dot (registered in 2026 league)
- Click Leading Player in dashboard → goes to general card; right-click → shows context menu
- Check main dashboard achievements exclude hidden leagues