# Adding a New League

## Step-by-Step

### 1. Create the league folder

Create a new folder under `leagues/` with the league name:

```
leagues/Shabi Israel May 2026/
```

### 2. Add match data — `leaguedata.csv`

Create `leaguedata.csv` inside the folder with this format:

```csv
Player, PR, Luck, Score, Player, PR, Luck, Score
PlayerA, 12.5, -1.2, 5, PlayerB, 8.3, 0.7, 7
PlayerC, 6.1, 2.0, 7, PlayerD, 15.4, -0.5, 3
```

- One row per match, 8 columns
- Add header rows between rounds (they are auto-skipped)
- Use "Bye" as a player name for rounds where a player sits out
- Leave all values as 0 for unplayed matches (they are auto-filtered)

### 3. Add configuration — `league_params.json`

Create `league_params.json` inside the folder:

```json
{
  "LeagueTitle": "Shabi Israel - May 2026",
  "BronzeCount": 4,
  "PR": true,
  "UBC": true,
  "Running": true,
  "CustomFlags": {}
}
```

- Set `"Running": true` while the league is ongoing, change to `false` when complete
- Add entries to `CustomFlags` for any non-Israeli players:

```json
"CustomFlags": {
  "PlayerName": "RU",
  "AnotherPlayer": "BE"
}
```

Available flag codes: `IL` (default), `TZ`, `RU`, `BE`, `UN`.

### 4. Register the league — `landing_settings.json`

Add the league title to the `DisplayOrder` array in `leagues/landing_settings.json` in the desired display position:

```json
{
  "title": "Shabi Israel",
  "subtitle": "By Marcel Dana and Avshalom Yaish",
  "logoPath": "assets/logo/logo.png",
  "DisplayOrder": [
    "Shabi Israel - May 2026",
    "Shabi Israel - April 2026",
    "Shabi Israel - March 2026"
  ]
}
```

**Important:** Use `" - "` (space-dash-space) in the title, even though the folder name uses a plain space. The app handles this conversion automatically.

### 5. Add new flags (if needed)

If a player needs a flag not yet in `assets/flags/`, add a PNG file named with the country code (e.g., `FR.png`).