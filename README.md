# Shabi Israel

Chess league statistics web app by Marcel Dana and Avshalom Yaish.

Pure client-side application (HTML/CSS/JS) that loads CSV match data, computes rankings and statistics, and renders interactive sortable tables with color-coded results.

## How to Run

Serve locally with any HTTP server:

```bash
npx http-server -p 8080 --cors -c-1
```

Then open `http://localhost:8080` in your browser.

## Adding a New League

1. Create a folder under `leagues/` with the league name (e.g., `Shabi Israel May 2026`)
2. Add `leaguedata.csv` with match data and `league_params.json` with configuration
3. Add the league title to `leagues/leagues_order.json` in the desired display position
