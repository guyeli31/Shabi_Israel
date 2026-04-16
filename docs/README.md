# Shabi Israel — Project Documentation

## Motivation

Shabi Israel is a chess league statistics platform created by **Marcel Dana** and **Avshalom Yaish**. It tracks match results across monthly leagues, computing player rankings, performance ratings, and luck metrics — then presenting everything in interactive, color-coded tables.

The project was originally built with MATLAB, which processed CSV match data and generated static HTML files. It has been rebuilt as a **pure client-side web application** — vanilla HTML, CSS, and JavaScript with ES modules — requiring no build step, no server-side logic, and no MATLAB. The site is deployed on **GitHub Pages**.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Vanilla JavaScript (ES modules) |
| Styling | CSS with custom properties |
| Markup | Semantic HTML5 |
| Data | CSV files + JSON configuration |
| Hosting | GitHub Pages |
| Build | None — zero dependencies |

## Quick Start

```bash
cd Shabi_Israel
npx http-server -p 3000 --cors -c-1
```

Open `http://localhost:3000` in your browser. On Windows, double-click `start.bat` to launch automatically.

> **Note:** A local HTTP server is required because the app uses ES modules and `fetch()`, which browsers block under the `file://` protocol.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | File structure, SPA navigation, JS/CSS module layers |
| [Data Model](data-model.md) | CSV format, JSON config, league discovery, edge cases |
| [Statistics & Rankings](statistics-and-rankings.md) | Stat formulas, ranking algorithm, skill levels, medals |
| [Rendering & Tables](rendering-and-tables.md) | Page layouts, table columns, sorting, color coding |
| [Design System](design-system.md) | CSS tokens, color palette, responsive design, components |
| [Adding a League](adding-a-league.md) | Step-by-step guide to add new league data |

## Data Flow

```
User opens page
  → JS reads URL query parameters
  → Fetches landing_settings.json (or specific league CSV + JSON)
  → csvParser.js parses raw CSV into match objects
  → stats.js computes per-player statistics
  → rankings.js sorts players, assigns ranks and skill levels
  → colorScale.js calculates color gradients for values
  → Render module builds the DOM (tables, badges, colors)
  → User sees the interactive page
```

## Navigation Flow

```
index.html                          Landing page — list of all leagues
  └─→ league.html?league=X         League summary — ranked player table
        └─→ player.html?league=X&player=Y   Player detail — match history
              └─→ (back to league)
        └─→ (back to index)
```