# Shabi Israel — v2 (clean-slate rebuild)

This directory is the **parallel rebuild** of the Shabi Israel chess league stats app. It exists alongside the current production code (in the repo root: `css/`, `js/`, `table-lab/`, `*.html`) and grows to feature parity, then takes over via a single cutover commit.

**Plan**: see [`docs/PLAN.md`](docs/PLAN.md) for the full 13-phase plan (also mirrored at `C:\Users\User\.claude\plans\sharded-gliding-locket.md` on the originating machine).

## Current phase

**Phase 0 — Bootstrap.** Scaffolding only. No real code yet.

## ⚠ Before starting Phase 1 (run once per machine)

The repo ships Phase 0 scaffolding only. No `node_modules/` is committed. Before any later phase can run:

```bash
cd v2
npm install     # installs Vite, Stylelint, ESLint, Vitest, Playwright (~200 MB, 30–90s)
npm run dev     # verifies the dev server boots → http://localhost:5173
```

If `npm install` fails, check Node version (Vite 5 requires Node ≥18). If `npm run dev` boots but the page is blank, that's expected for Phase 0 — placeholders only.

When both succeed, you're ready for **Phase 1 — Tokens + base + themes**.

## Quick start

```bash
cd v2
npm install                  # one-time
npm run dev                  # → http://localhost:5173
```

v1 keeps running independently at `http://localhost:8090` (via the existing `npx http-server -p 8090 --cors -c-1` setup from the repo root).

## Architecture

10 cascade layers enforced via a single `@layer` order in `src/index.css`:

```
reset → tokens → themes → base → primitives → components → tables → pages → utilities → overrides
```

Directories:

| Dir | Layer | Role |
|---|---|---|
| `src/tokens/` | 1 | Design tokens (color, typography, icon, space, ...) |
| `src/themes/` | 2 | Token mappings per theme (light, dark, nature, ...) |
| `src/base/` | 3 | Resets + element defaults |
| `src/primitives/` | 4 | Atomic components (Flag, Icon, Badge, ...) |
| `src/components/` | 5 | Composed components (PlayerCell, Navigation, ...) |
| `src/tables/` | 6 | Table system (MFTable, SFTable, ExpandableTable, FF1, FF2) + presets |
| `src/pages/` | 7 | Page-specific layout |
| `src/tools/` | 8 | Developer tools (designLab, typoEditor, tableLab, designCatalogue) |

## Shared data

The `leagues/` directory at the **repo root** is shared between v1 and v2:
- v1 reads via `fetch('leagues/...')` (relative).
- v2 reads via `fetch('/data/...')` — Vite's `shared-data-proxy` plugin in `vite.config.js` serves `../leagues` at `/data`.

This means a league CSV update is immediately visible to both versions. Write paths (admin pages) write to the same files; **avoid simultaneous admin editing in both v1 and v2** during the rebuild — v2 admin is read-only until Phase 8.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `:5173` |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Stylelint + ESLint |
| `npm run test` | Unit tests (vitest) |
| `npm run test:visual` | Playwright visual regression |
| `npm run test:a11y` | axe-core accessibility |
| `npm run test:parity` | v1↔v2 side-by-side parity check |
| `npm run ci` | Full CI suite (lint + test + visual) |
| `npm run data-sync` | Copy `../leagues` → `public/data` (for production build) |
| `npm run cutover` | One-time v1→v2 promotion (Phase 12 only) |

## CI gates

These checks must pass before cutover:

- **Stylelint** — refuses literal `font-size`, `color`, `font-weight` outside `src/tokens/` and `src/themes/`.
- **grep-gates.sh** — refuses `<strong>`/`<b>` for visual styling, refuses `!important` on typography, refuses hex colors outside theme files.
- **inventory-sync.js** — every selector in CSS must have a row in `docs/TYPOGRAPHY-INVENTORY.md`.
- **parity-runner.js** — visual + computed-style match between v1 and v2 within tolerances.

## Cutover

When all 12 phases pass:

```bash
cd ..                        # back to repo root
bash v2/scripts/migrate-v1-to-v2.sh
```

The script archives v1 to `_archive_v1/` and promotes `v2/*` to the repo root. Single atomic commit. Rollback is `git revert HEAD` (archive preserves all v1 files).

## Docs

- `docs/ARCHITECTURE.md` — the layered diagram and rules in detail.
- `docs/TYPOGRAPHY.md` — 7 size + 4 weight + 4 icon token contract.
- `docs/TYPOGRAPHY-INVENTORY.md` — per-page element → token map (auto-managed by typoEditor).
- `docs/TABLE-DESIGN.md` — MF/SF/exp/FF1/FF2 contracts.
- `docs/THEMES.md` — how to add a theme.
- `docs/COMPONENTS.md` — primitive + component API reference.
- `docs/ADMIN.md` — admin data model + override format.
- `docs/MIGRATION-FROM-V1.md` — mapping table from old file → new file (filled phase by phase).
- `docs/PARITY-LOG.md` — MCP verification results (populated each phase).
- `docs/CHANGELOG.md` — phase-by-phase history.
