# Statistics & Rankings

## Per-Player Statistics

Computed by `js/compute/stats.js` → `computeAllStats(matches)`.

For each player, the system calculates:

| Stat | Formula | Description |
|------|---------|-------------|
| `games` | Count of all matches played | Total matches (wins + losses + draws) |
| `wins` | Count where `scoreSelf > scoreOpp` | Matches won |
| `losses` | Count where `scoreSelf < scoreOpp` | Matches lost |
| `winRate` | `wins / games` | Win percentage (0–1). Draws reduce this since they add to games but not wins |
| `meanPR` | `sum(allPRs) / games` | Average Performance Rating. **Lower = better** |
| `highestPR` | `min(allPRs)` | Best (lowest) PR achieved in any single match |
| `lowestPR` | `max(allPRs)` | Worst (highest) PR in any single match |
| `oppMeanPR` | `sum(opponentPRs) / games` | Average PR of opponents faced |
| `luck` | `mean(playerLuck) - mean(opponentLuck)` | Luck differential. **Positive = lucky**, negative = unlucky |

### Example

Player "Aviado" played 8 matches: 6 wins, 1 loss, 1 draw.

```
games    = 8
wins     = 6
losses   = 1
winRate  = 6/8 = 0.75 (75%)
meanPR   = average of 8 PR values = 6.2
luck     = avg(Aviado's luck) - avg(opponents' luck) = 1.3
```

---

## Ranking Algorithm

Computed by `js/compute/rankings.js` → `buildRankings(statsMap)`.

### Sort Order

Players are ranked by two criteria, applied in order:

1. **Win Rate — descending** (highest first)
2. **Mean PR — ascending** (lowest/better first) — used as tiebreaker

```
Rank 1: Player A — WR 70%, PR 8.5
Rank 2: Player B — WR 70%, PR 9.2   ← same WR, worse PR
Rank 3: Player C — WR 60%, PR 5.0   ← lower WR
```

### Rank Assignment

After sorting, each player receives a sequential rank number (1, 2, 3, ...).

> **Note:** When the user sorts the league table by a different column (e.g., clicking "Mean PR"), the displayed rank numbers are **recalculated** based on the new sort order. The original ranking is only applied on initial page load.

---

## Skill Levels

Each player is assigned a skill level based on their Mean PR. Defined in `rankings.js`:

| Level | Mean PR Threshold | Color |
|-------|------------------|-------|
| World Champ | ≤ 2.5 | `#00C853` (bright green) |
| World Class | ≤ 5.0 | `#2E7D32` (dark green) |
| Expert | ≤ 7.5 | `#558B2F` (olive green) |
| Advanced | ≤ 12.5 | `#9E9D24` (olive yellow) |
| Intermediate | ≤ 17.5 | `#F57F17` (amber) |
| Casual Player | ≤ 22.5 | `#E65100` (deep orange) |
| Beginner | ≤ 30.0 | `#BF360C` (orange-red) |
| Distracted | > 30.0 | `#B71C1C` (dark red) |

The first threshold that the player's Mean PR falls within determines their level. Lower PR = better level.

---

## Medal System

Medals are awarded based on rank position, configured per league via `BronzeCount` in `league_params.json`.

| Medal | Ranks | Default |
|-------|-------|---------|
| Gold | Rank 1 | Always 1 player |
| Silver | Rank 2 | Always 1 player |
| Bronze | Ranks 3 to (2 + BronzeCount) | Default BronzeCount=4 → Ranks 3–6 |

Medals appear as **circular badges** (22px) next to the rank number in the league table. Medal rows also have highlighted background colors (gold/silver/bronze tints).

---

## League-Wide Averages

Computed by `rankings.js` → `computeAverages(rankings)`.

The averages row at the bottom of the league table shows the **mean** of all players' stats:

- Average Games
- Average Wins
- Average Losses
- Average Win Rate
- Average Mean PR
- Average Luck

---

## Match Statistics

Computed by `rankings.js` → `computeMatchStats(rankings)`.

| Metric | Formula | Meaning |
|--------|---------|---------|
| Played Matches | `totalGames / 2` | Each match is counted twice (once per player), so divide by 2 |
| Total Matches | `n × (n-1) / 2` | Round-robin formula: every pair plays once |
| Played Ratio | `played / total` | Percentage of scheduled matches completed |

Displayed in the stats row below the averages row in the league table.