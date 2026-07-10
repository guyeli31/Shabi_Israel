# Data Architecture — Query Strategy Redesign

This directory is the complete, self-contained plan for redesigning the Supabase query strategy for Shabi Israel (v1), and the record of its implementation. It was written after a series of point-fixes to the post-migration read path kept uncovering new bugs (silent 1000-row truncation, non-deterministic pagination that inflated a player's PR from 3.01 to 3.08, a blocking dev-only probe, redundant queries, an 11-query fan-out). **All four implementation phases are done on local Docker** (see the status table below); production cutover + CI automation remain. Committed so the plan and its results are available from any machine after `git pull`.

## Reading order

1. **[`00-current-state-map.md`](00-current-state-map.md)** — what the site does today: per-page request inventory, caching behavior, known bugs. Read this first to understand the problem.
2. **[`01-architecture.md`](01-architecture.md)** — the proposed design ("one snapshot everywhere": a single Postgres RPC + versioned localStorage cache). **This is the document to approve before any implementation phase starts.**
3. **[`02-query-standards.md`](02-query-standards.md)** — mandatory rules for all future pages/features, so the same bug classes can't come back. Becomes binding once `01` is approved.
4. **[`03-csv-parity-plan.md`](03-csv-parity-plan.md)** — spec for a script proving Supabase data matches the frozen pre-cutover CSVs.
5. **[`04-performance-budget.md`](04-performance-budget.md)** — binding before/after performance standards and the measurement harness spec that will fill in real numbers.

## Implementation status

| Phase | What it does | Status |
|---|---|---|
| 0 | Build + run perf harness (real "before" numbers); build + run CSV-parity script (cutover proof) | **done (2026-07-09)** — see [`03-csv-parity-plan.md`](03-csv-parity-plan.md#results-phase-0-2026-07-09) and [`04-performance-budget.md`](04-performance-budget.md#baseline-results-phase-0-2026-07-09) |
| 1 | Apply `sql/site_bundle.sql` (additive: `site_meta`, bump triggers, `get_site_bundle()` RPC, grants, `leagues.archived`) | **done, local Docker only (2026-07-10)** — verified additive (old `supabaseLoader.js` queries unaffected), RPC returns correct 11-league/3255-match bundle via the anon key, `data_version` bump confirmed on a live write. Not applied to cloud production. |
| 2 | Add `js/data/store.js` + `js/data/bundleMapper.js`; rewire pages one at a time (`league_table` → `index` → `league` → `player_league` → `player`) | **done, local Docker only (2026-07-10)** — all 5 pages + their shared infra (`navigation.js`, `siteSidebar.js`, `crossLeague.js`, `nameDisplay.js`) rewired; zero remaining public imports of `dataSourceLoader.js`/`dataSourceMeta.js`. Browser-verified via Playwright against local Docker: every page renders correct real data, zero console errors, and warm navigation shows **0 blocking Supabase requests** exactly as designed (confirmed live — `league_table.html`, `league.html`, `player_league.html`, `player.html` all fired only the dev probe + analytics beacon on a warm nav). The `?datasource=files` escape hatch still works (verified on `league_table.html`, same rendered data as the DB path — consistent with the Phase 0 parity result). `admin.html` unaffected (still redirects to index when logged out, as before) — `js/admin/**` was not touched. |
| 3 | Delete dead code; simplify the data-source config; re-run harness for "after" numbers; land the `02` enforcement grep-gate | **done, local Docker only (2026-07-10)** — deleted `js/data/leagueCache.js`, `js/data/dataSourceLoader.js`, `js/data/dataSourceMeta.js`, and the dead `loadLeague`/`loadLeaguesBulk`/`fetchAllRows` block from `supabaseLoader.js` (now admin-only); removed the blocking localhost probe + top-level `await` from `dataSourceConfig.js` (now a synchronous, instant `getDataSource()`). Built `scripts/check-query-standards.mjs` (rule-1 gate) — **passing**, 0 violations across 83 `js/` files. Re-ran the perf harness → measured **1 blocking request cold / 0 warm** per page (down from 8–24), see [`04-performance-budget.md`](04-performance-budget.md#after-results-phase-3-2026-07-10). Browser-reverified all 5 pages + `?datasource=files` + admin after the deletions — 0 console errors. |

Each phase is a separate, independently-revertible commit and requires its own explicit approval before starting — this suite documents the whole plan, but does not itself authorize starting any phase.

**All four phases are complete on local Docker.** What remains before this ships to users: (a) apply `sql/site_bundle.sql` to cloud production and deploy the JS changes, then (b) re-run the perf harness against production (default flags) to confirm the after-ms and the 100% bfcache hit rate hold there (localhost can't measure either — see `04`'s caveats), and (c) optionally wire `check-query-standards.mjs` + the harness into CI. None of these touch the design; they are the production-cutover + automation steps.

## Scope note

Phase 0 is done: `scripts/verify-csv-parity.mjs` and `scripts/perf/measure-transitions.mjs` exist and were run — see their results linked above, plus two genuine findings the runs surfaced that a written-only plan couldn't have caught (a match-identity bug in the parity script itself, and a headless-Chromium bfcache limitation in the perf harness). Phase 0 touched **local Docker Supabase only** (cloud production untouched, by explicit user scoping) and produced no DB schema or product-code changes — those begin at Phase 1, not yet started. The one pre-existing uncommitted change in the working tree, `js/data/supabaseLoader.js` (a pagination tiebreaker fix), predates this effort and is left as the user's own in-progress work — it is superseded once Phase 2 lands, not touched by this suite.

Separately from the redesign itself, this session also applied two direct data edits at the user's request (not part of the architecture plan): `Hummus`'s `bmabTitle` M1→M2 in both the static `leagues/players_metadata.json` and local Docker's `players_metadata` table, and a full replace of local Docker's July-2026 `matches` rows from the static `leaguedata.csv`. Both are unstaged in `leagues/**`, pending the user's own commit.

**Observation worth flagging (pre-existing, not introduced here):** the app loads `@supabase/supabase-js` from `https://esm.sh` at runtime (`js/data/supabaseClient.js`). During Phase 3 testing a transient `esm.sh` `ERR_CONNECTION_CLOSED` left a page fully blank (0 table rows) — when that CDN hiccups, the entire Supabase read path fails to initialize. This is an existing architectural fragility independent of the query redesign (the old `supabaseLoader.js` path had the identical dependency), but the single-RPC design concentrates all reads behind that one import, so it may be worth bundling supabase-js locally (or self-hosting it) as a separate hardening task.

## Portability

Once these files (and the pending `js/data/supabaseLoader.js` change, if desired) are committed and pushed, any other machine has everything needed to review or continue this plan after a `git pull` — the suite has no dependency on local session memory or any file outside this repository.

## Related, out-of-repo context

- `CLAUDE.md` (repo root) carries a pointer to `02-query-standards.md`.
- `v2/docs/MIGRATION-FROM-V1.md` carries a note that v2 adopts this same store/bundle design at its own Supabase migration phase.
