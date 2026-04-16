# Data Model

## League Discovery — `landing_settings.json`

The file `leagues/landing_settings.json` is the **single source of truth** for which leagues exist, their display order, and the landing page chrome (title, subtitle, logo).

```json
{
  "title": "Shabi Israel",
  "subtitle": "By Marcel Dana and Avshalom Yaish",
  "logoPath": "assets/logo/logo.png",
  "DisplayOrder": [
    "Shabi Israel - April 2026",
    "Shabi Israel - March 2026",
    "Shabi Israel - February 2026"
  ]
}
```

**Title-to-folder mapping:** Titles in `DisplayOrder` use `" - "` (space-dash-space), but the actual folder names use a plain space. The landing page converts titles to folder names via:

```
"Shabi Israel - April 2026"  →  "Shabi Israel April 2026"
```

This is handled by `title.replace(' - ', ' ')` in `landingPage.js`.

---

## CSV Match Data — `leaguedata.csv`

Each league folder contains a `leaguedata.csv` file with match results. The CSV has **8 columns per row**, representing both sides of a match.

### Column Format

```
Player A, PR_A, Luck_A, Score_A, Player B, PR_B, Luck_B, Score_B
```

| Column | Type | Meaning |
|--------|------|---------|
| Player A / B | string | Player name |
| PR_A / PR_B | float | Performance Rating (lower = better) |
| Luck_A / Luck_B | float | Luck factor (positive = lucky, negative = unlucky) |
| Score_A / Score_B | integer | Match score (typically 0–7) |

### Example

```csv
Player, PR, Luck, Score, Player, PR, Luck, Score
Idan1986, 17.07, -2.83, 2, bardak65, 11.4, 0.33, 7
Aviado, 5.24, 1.12, 7, Moriarty, 8.91, -0.45, 3
```

### Multi-Round Structure

A single CSV may contain multiple rounds of matches. Rounds are separated by **repeated header rows** (lines starting with "player", case-insensitive). The parser skips all header rows automatically.

### Special Row Types

| Type | How to Identify | Handling |
|------|----------------|----------|
| Header rows | Start with "player" (case-insensitive) | Skipped |
| Bye entries | Either player name is "Bye" | Skipped entirely — not counted in any stats |
| Unplayed matches | All 8 values are 0 | Filtered out during parsing |
| Empty rows | Blank line | Skipped |

---

## League Configuration — `league_params.json`

Each league folder contains a `league_params.json` with configuration.

### Example

```json
{
  "LeagueTitle": "Shabi Israel - April 2026",
  "BronzeCount": 4,
  "PR": true,
  "UBC": true,
  "Running": true,
  "CustomFlags": {
    "Moriarty": "TZ",
    "Danny_kondrea": "UN"
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `LeagueTitle` | string | Display name (with `" - "` separator) |
| `BronzeCount` | integer | Number of bronze medals awarded (ranks 3 to 2+BronzeCount). Default: 4 |
| `PR` | boolean | Whether PR stats are displayed |
| `UBC` | boolean | Configuration flag (reserved) |
| `Running` | boolean | `true` = league is ongoing (green status pill); `false` = completed (gray pill) |
| `CustomFlags` | object | Map of `playerName → countryCode` for non-default flags |

### Custom Flags

By default, all players display the **IL** (Israel) flag. The `CustomFlags` object overrides this per player:

```json
"CustomFlags": {
  "Moriarty": "TZ",
  "Danny_kondrea": "UN"
}
```

Available flag codes correspond to PNG files in `assets/flags/`: `IL`, `TZ`, `RU`, `BE`, `UN`.

---

## Edge Cases

### Draws

When `Score_A === Score_B`, the match is a **draw**. Draws are counted in `games` but increment neither `wins` nor `losses`. This means:

```
winRate = wins / games    (not wins / (wins + losses))
```

A player with 5 wins, 3 losses, 2 draws has: games=10, winRate=50%.

### Unplayed Opponents

On the player page, `getPlayerMatches()` generates records for **all** opponents — including those the player hasn't faced yet. These appear as grayed "Not played" rows with `played: false`. This ensures the full round-robin matrix is visible.

### Zero-Game Players

If a player has 0 games, all stats default to 0. They appear at the bottom of rankings with the "Beginner" skill level (since meanPR = 0, which is below the 2.5 threshold — effectively "World Champ" level, but in practice these players haven't played).