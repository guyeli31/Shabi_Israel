# Rendering & Tables

Each of the 3 pages has a dedicated render module that fetches data, computes stats, and builds the DOM.

---

## Landing Page (`index.html` → `landingPage.js`)

Displays a list of all leagues with their current status and leader.

### Table Columns

| Column | Content |
|--------|---------|
| League | League title (linked to league page) |
| Status | "Running" (green pill) or "Completed" (gray pill) — from `params.Running` |
| Leader | Flag + name of rank-1 player (computed by loading matches and running rankings) |

### Behavior

- Loads `landing_settings.json` to get league list (and landing page chrome)
- Maps title format (`" - "`) to folder format (space) for fetching
- Loads matches for each league in parallel to determine the leader
- If a league fails to load, leader shows as empty

---

## League Page (`league_table.html` → `leaguePage.js`)

Displays the ranked player table for a single league. This is the most complex renderer.

### Table Columns (9 total)

| # | Column | Color Scale | Bold Rule |
|---|--------|------------|-----------|
| 0 | Rank | — | Medal badge for top ranks |
| 1 | Player | — | Flag + linked name |
| 2 | Games | Fixed (0–25) | — |
| 3 | Wins | Relative (min–max) | Highest value bolded |
| 4 | Losses | Inverted relative | Lowest value bolded |
| 5 | Win Rate | Relative | Highest value bolded |
| 6 | Mean PR | Inverted relative | Lowest value bolded (lower PR = better) |
| 7 | Level | Discrete per level | — |
| 8 | Luck | Relative | Highest value bolded |

### Color Coding

Two modes of color gradient are used:

- **Normal** (`colorForValue`): Higher value → greener. Used for Wins, Win Rate, Luck.
- **Inverted** (`colorForValueInverted`): Lower value → greener. Used for Losses, Mean PR.
- **Fixed scale** (`colorForGames`): Hardcoded 0–25 range. Used for Games.
- **Discrete** (`colorForLevel`): Each skill level maps to a specific hex color. Used for Level.

Relative scales compute min/max from the **current dataset**, so colors adapt to each league.

### Bold Best/Worst Values

In each numeric column, the **best** value is displayed in bold:
- Highest: Wins, Win Rate, Luck
- Lowest: Losses, Mean PR

### Medal Badges

| Rank | Badge | Row Background |
|------|-------|---------------|
| 1 | Gold circle (🥇 styled) | Light amber `#fef3c7` |
| 2 | Silver circle | Light gray `#f3f4f6` |
| 3–(2+BronzeCount) | Bronze circle | Transparent orange |
| Others | Plain number | White |

### Special Rows

- **Averages row** — Sticky at bottom (green background `#ecfdf5`). Shows mean of all stats across players.
- **Stats row** — Below averages. Shows "Games Played: X / Y (Z%)" using the round-robin formula.

### Sorting

- Click any column header to sort ascending
- Click again to toggle descending
- **Rank numbers are recalculated** after each sort (they reflect display order, not original ranking)
- Sort icons (▲) in headers indicate sortable columns

---

## Player Page (`player_league.html` → `playerPage.js`)

Displays head-to-head match results for a single player against all opponents.

### Table Columns (8 total)

| # | Column | Description |
|---|--------|-------------|
| 0 | Opponent | Flag + linked opponent name |
| 1 | Score | Player's match score |
| 2 | Opp Score | Opponent's match score |
| 3 | PR | Player's PR in this match |
| 4 | Opp PR | Opponent's PR |
| 5 | Luck | Player's luck value |
| 6 | Opp Luck | Opponent's luck value |
| 7 | Result | WIN / LOSS / DRAW / Not played |

### Bold Better Values

In each pair of columns, the **better** value is bolded:

| Pair | Bold Rule |
|------|-----------|
| Score vs Opp Score | Higher score bolded |
| PR vs Opp PR | **Lower** PR bolded (lower = better) |
| Luck vs Opp Luck | Higher luck bolded |

### Unplayed Matches

Opponents the player hasn't faced appear as grayed-out rows with:
- CSS class `unplayed` (light gray background, italic text)
- Empty stat cells
- "Not played" in the Result column

### Result Styling

| Result | CSS Class | Color |
|--------|-----------|-------|
| WIN | `result-win` | Green `#059669` |
| LOSS | `result-loss` | Red `#dc2626` |
| DRAW | `result-draw` | Gray `#6b7280` |

### Averages Row

Shows aggregated stats from **played matches only**:
- Win percentage (e.g., "66.7% wins")
- Average PR and Opponent PR
- Average Luck and Opponent Luck
- Total games played

### Sorting

- Click column headers to sort
- Unplayed matches are **always pushed to the bottom** regardless of sort direction
- Result column sorts by: WIN (2) > DRAW (1) > LOSS (0)
- String columns (Opponent) use locale-aware comparison
- Numeric columns use numeric comparison