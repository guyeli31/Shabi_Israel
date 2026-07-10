# 03 — CSV Parity Verification Plan

Status: **built and run (Phase 0, 2026-07-09)**. `scripts/verify-csv-parity.mjs` exists and produced a clean cutover-proof result — see [Results](#results-phase-0-2026-07-09) below and the archived report at [`verification/cutover-proof-2026-07-09.json`](verification/cutover-proof-2026-07-09.json). This document was updated post-run to reflect two things discovered only by actually executing the script (see the normalization table) — a reminder that a written plan and a run plan are not the same thing.

## Why this exists

After the Supabase cutover (2026-07-06), `leagues/**` became a frozen historical snapshot. This plan proves — with an executable comparison, not a read-through — that the 10 closed leagues in Supabase are byte-for-byte equivalent (post-normalization) to the CSVs that used to be the source of truth, and that the running league is a superset. This is the direct answer to the PR-3.01-vs-3.08 incident: a diff a machine checks, not a feeling.

## Script: `scripts/verify-csv-parity.mjs`

**Runtime:** Node ≥20, ESM. Lives in `scripts/` (its `package.json` already has `@supabase/supabase-js`).

**Reused, not reimplemented — the whole point:**
- `js/data/csvParser.js` → `parseCSVAllWithRounds`, `getAllPlayersFromCSV` — pure, fs-readable in Node directly (no browser `fetch` needed; read the CSV file with `fs.readFileSync` and pass the string in).
- `js/data/leagueLoader.js` → `applyOverrides` — pure export, safe to import (its module top level is imports-only).
- `js/compute/matchHistory.js` → `mergeHistoryIntoMatches`, `matchKey`.
- `js/compute/stats.js` → `computeAllStats` (for the level-3 comparison below).
- `js/data/bundleMapper.js` (once it exists, per `01-architecture.md` §A5) for the DB-row → domain-object mapping — so the script's DB-side shape is identical to what pages actually render.

**Explicitly not imported:** `js/data/supabaseLoader.js` — its `supabaseClient.js` dependency pulls `@supabase/supabase-js` from `https://esm.sh/...` at the browser level, which does not resolve in a Node script. As built, the DB side is fetched via the `@supabase/supabase-js` Node package directly against each table (`leagues`, `matches`, `manual_overrides`, `match_history`, `players_metadata`, `landing_settings`), using the same `.range()`-based pagination pattern as `fetchAllRows` in `supabaseLoader.js` — because `get_site_bundle()` doesn't exist yet (that's Phase 1, not started). Once it lands, the DB-fetch section should be swapped for a single RPC call; no other part of the script changes. Run with `--target=local` (default; local Docker Supabase) or `--target=cloud` (requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars — not used for the Phase 0 run below, which targeted local Docker only, per explicit user scoping).

## Normalization table (must be applied before any diff — these are legitimate differences, not defects)

| # | Difference | CSV side | DB side | Normalization |
|---|---|---|---|---|
| 1 | Match identity | file line order | `round, id` order | Key both sides by `matchKey(playerA, playerB)` **alone** — never compare by array index, and never include `round` in the identity key. The league format is round-robin (each pair meets at most once per season), and the app's own `applyOverrides`/`mergeHistoryIntoMatches` key exclusively on player-pair; a `match_history` record can legitimately carry a different `round` value than the original CSV row for the same pair (confirmed empirically during the Phase 0 run — see the cutover-proof report). Compare `round` as a regular field, not as part of the key, so a genuine mismatch still surfaces as a diff. |
| 2 | PR/luck on technical results | coerced to `0` (`parseFloat(...)\|\|0`) | genuine `null` | Normalize: if a row is technical/unplayed on either side, treat PR/luck as equal regardless of `0` vs `null`; otherwise compare exactly |
| 3 | Bye / all-zero rows | dropped at CSV-read time (`parseCSV`) | filtered via DB `played` boolean | Filter the DB side to `played=true` before comparing to CSV's already-filtered rows |
| 4 | `lastModified` | HTTP `Last-Modified` header (RFC 1123) | `leagues.last_updated` (ISO 8601) | Excluded from the diff entirely — not a data-correctness signal, just cache metadata |
| 5 | `landing_settings` key casing | `DisplayOrder`, `logoPath` | `display_order`, `logo_path` | Explicit rename map applied to the DB side before comparing |
| 6 | `allPlayers` source | non-Bye names from 8-column rows, incl. unplayed | union of `player_a`/`player_b` across all rows incl. `played=false` | Should already agree if ingest kept unplayed rows; compare as sets, report any divergence as a finding (not silently normalized) |

## Comparison levels (per league)

- **L1 — raw match sets.** Diff keyed by `(round, matchKey)`: missing on either side, extra on either side, or field-level mismatch (score/PR/luck) after normalization rules 2–3.
- **L2 — league config.** `league_params.json` fields vs mapped `leagues` row (`compareParams`); player set; `landing_settings`; `players_metadata`. **The params comparison was added 2026-07-10** — the original L2 only compared the player set, which is why the GoldCount/SilverCount migration bug (Sept 2025–Mar 2026 leagues seeded 0/0/4 where the app reads 1/1/4) passed as "PASS". Critical rule: the **medal counts** (`GoldCount`/`SilverCount`/`BronzeCount`) are compared **strictly** — `absent (undefined/null)` is treated as **distinct from `0`**, because the render code reads a missing count as `?? 1` but a stored `0` as `0`, so `0`-vs-absent is a real visible divergence that must NOT be normalized away. Other scalars (`MatchLength`/`IssueDate`/`EntryFee`/`Running`/`Hidden`) and objects (`Prizes`/`CustomFlags`/`RetiredPlayers`) normalize absent using each field's shared default before comparing. Verified with a negative control: forcing a Docker `gold_count=0` makes the run FAIL on `GoldCount csv=1 db=0`.
- **L3 — computed stats.** Run `computeAllStats` on both sides' match sets independently and compare per-player `games`, `winRate`, `meanPR`, `meanLuck` exactly. This is the level that would have caught the PR-3.01-vs-3.08 bug even if L1's field-level diff somehow missed it — it catches divergence in the *pipeline*, not just the raw rows.

## Pass criteria

- **10 closed leagues:** exact match at L1, L2, and L3 (post-normalization). Any diff is a **fail**, reported with league/key/field/both values.
- **1 running league (July 2026):** **subset** check — every CSV match must exist identically in the DB; DB rows absent from CSV are expected (new rows since cutover) and listed informationally, not as failures.

## Report format

- Per-league PASS/FAIL summary table.
- One line per diff: `league, matchKey, field, csv=<value>, db=<value>`.
- `--json` flag for machine-readable CI artifacts.
- Exit code 0 (all pass) / 1 (any closed-league failure). Running-league informational diffs never affect exit code.

## Run modes

- **One-time cutover proof (Phase 0):** run once against the frozen CSVs and the newly-built RPC; archive the output under `docs/data-architecture/verification/cutover-proof-<date>.md` (or `.json`) as permanent evidence the migration was correct at cutover.
- **Ongoing drift check (optional, after Phase 0):** a weekly or on-demand run, *not* triggered on every scraper sync — the doc must be explicit that once admins legitimately edit closed-league data post-cutover (corrections, technical wins added later, etc.), CSV parity for those leagues is *expected* to diverge. A `parity-allowlist.json` (league + matchKey + field) records known, reviewed, intentional divergences so the weekly run only flags genuinely new/unexplained drift.
- **CI wiring:** `workflow_dispatch` (manual) + a weekly cron in a GitHub Actions workflow, separate from `sync-source.yml`. Not part of every deploy.

## Results (params-consensus run, 2026-07-10)

After adding the L2 params comparison and fixing the medal-count divergence, a fresh run passes with the enhanced check. Full output: [`verification/params-consensus-proof-2026-07-10.json`](verification/params-consensus-proof-2026-07-10.json). This run also verifies the medal counts (`gold/silver/bronze`), `MatchLength`, `Prizes`, `CustomFlags`, `RetiredPlayers`, `Running`/`Hidden` are all in consensus between the static files and Docker — the layer the 2026-07-09 run did not cover.

**Consensus fixes that produced this result:**
1. Static files: added explicit `GoldCount: 1, SilverCount: 1` to the 7 legacy leagues that omitted them (Sept 2025–Mar 2026), so all 11 are uniformly `1/1/4`.
2. Docker: `UPDATE leagues SET gold_count=1, silver_count=1 WHERE gold_count=0 AND silver_count=0` (7 rows).
3. Seed script (`supabase-migration/migrate-to-supabase.mjs`): defaults changed `?? 0` → `?? 1/1/4` to match `js/admin/supabaseAdmin.js`'s write path and the app's read defaults — so a future re-seed from static files reaches the same values, not 0. (Cloud production not touched — if it carries the same original seed, its medal counts for those 7 leagues need the same `UPDATE`.)

## Results (Phase 0, 2026-07-09)

Run against **local Docker Supabase** (`--target=local`; cloud production was not touched — out of scope for Phase 0 by explicit user decision). Full output: [`verification/cutover-proof-2026-07-09.json`](verification/cutover-proof-2026-07-09.json).

| League | Result |
|---|---|
| 10 closed leagues (Sept 2025 – June 2026) | **PASS** — 0 diffs at L1/L2/L3 |
| July 2026 (running) | **PASS** — 0 diffs, 1 informational note |
| `players_metadata` | **PASS** — 0 diffs |
| `landing_settings` | **PASS** — 0 diffs |

**Overall: PASS.** The 10 closed leagues are exact matches between the frozen CSVs and local Docker Supabase; the running league is a clean superset. The one informational note: a `manual_overrides` row (`type: not_played`, reason "Marked not played") on a July-2026 match that the frozen CSV still shows as played — this is the override system working as designed (see CLAUDE.md's "Overrides not CSV" convention: overrides never touch `leaguedata.csv`), not a defect.

**Two things found only by running the script, not by writing the plan:**

1. **Match identity must be player-pair only, not `(round, player-pair)`** — see normalization table row 1. The first run reported 10 spurious diffs (1 false "missing" match + 4 stats fields × 2 players) because a `match_history` record legitimately carried a different `round` than the original CSV row for the same pair, and the round-inclusive key treated them as two different matches. Fixed by matching the identity model `applyOverrides`/`mergeHistoryIntoMatches` already use elsewhere in the codebase (player-pair only).
2. **A DB-side `not_played` override needs explicit, not silent, handling** — without it, every future admin decision to mark a running-league match "not played" would show up as a hard parity failure forever (since the frozen CSV can never learn about it). The script now cross-references `manual_overrides` and demotes exactly this case to an informational note, for the running league only, with the override's own `reason` field surfaced in the report.

These are exactly the kind of finding this verification effort exists to catch — not because the data was wrong, but because a plan written before execution can't see everything a real run does.

## What this plan does not cover

- It does not re-verify the scraper's scrape-to-CSV step (that's `sync-source.js`'s own regression guard, `getBaselinePlayedCount`, already in place).
- It does not run automatically as part of Phase 1/2/3 of the architecture rollout — it is a standalone proof, run once at Phase 0 and optionally on a schedule afterward.
