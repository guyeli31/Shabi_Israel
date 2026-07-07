# Data Architecture — Query Strategy Redesign

This directory is the complete, self-contained plan for redesigning the Supabase query strategy for Shabi Israel (v1). It was written after a series of point-fixes to the post-migration read path kept uncovering new bugs (silent 1000-row truncation, non-deterministic pagination that inflated a player's PR from 3.01 to 3.08, a blocking dev-only probe, redundant queries, an 11-query fan-out). Nothing in this directory has been implemented yet except where the status table below says so — this is documentation only, committed so the plan is available from any machine after `git pull`.

## Reading order

1. **[`00-current-state-map.md`](00-current-state-map.md)** — what the site does today: per-page request inventory, caching behavior, known bugs. Read this first to understand the problem.
2. **[`01-architecture.md`](01-architecture.md)** — the proposed design ("one snapshot everywhere": a single Postgres RPC + versioned localStorage cache). **This is the document to approve before any implementation phase starts.**
3. **[`02-query-standards.md`](02-query-standards.md)** — mandatory rules for all future pages/features, so the same bug classes can't come back. Becomes binding once `01` is approved.
4. **[`03-csv-parity-plan.md`](03-csv-parity-plan.md)** — spec for a script proving Supabase data matches the frozen pre-cutover CSVs.
5. **[`04-performance-budget.md`](04-performance-budget.md)** — binding before/after performance standards and the measurement harness spec that will fill in real numbers.

## Implementation status

| Phase | What it does | Status |
|---|---|---|
| 0 | Build + run perf harness (real "before" numbers); build + run CSV-parity script (cutover proof) | not started |
| 1 | Apply `sql/site_bundle.sql` (additive: `site_meta`, bump triggers, `get_site_bundle()` RPC, grants, `leagues.archived`) | not started |
| 2 | Add `js/data/store.js` + `js/data/bundleMapper.js`; rewire pages one at a time (`league_table` → `index` → `league` → `player_league` → `player`) | not started |
| 3 | Delete `leagueCache.js`, the localhost probe, public bulk loaders; dedupe `landing_settings` call sites; re-run harness for "after" numbers; land the `02` enforcement grep-gate | not started |

Each phase is a separate, independently-revertible commit and requires its own explicit approval before starting — this suite documents the whole plan, but does not itself authorize starting any phase.

## Scope note

This round of work produced documentation only: no product code, no DB objects, no scripts were built or executed, and no performance numbers were measured (the `04` matrix's ms columns are placeholders by design). The one pre-existing uncommitted change in the working tree, `js/data/supabaseLoader.js` (a pagination tiebreaker fix), predates this effort and is left as the user's own in-progress work — it is superseded once Phase 2 lands, not touched by this suite.

## Portability

Once these files (and the pending `js/data/supabaseLoader.js` change, if desired) are committed and pushed, any other machine has everything needed to review or continue this plan after a `git pull` — the suite has no dependency on local session memory or any file outside this repository.

## Related, out-of-repo context

- `CLAUDE.md` (repo root) carries a pointer to `02-query-standards.md`.
- `v2/docs/MIGRATION-FROM-V1.md` carries a note that v2 adopts this same store/bundle design at its own Supabase migration phase.
