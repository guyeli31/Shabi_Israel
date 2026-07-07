# 03 — CSV Parity Verification Plan

Status: specification only — `scripts/verify-csv-parity.mjs` is not yet built. Building and running it is **Phase 0** of the roadmap in [`01-architecture.md`](01-architecture.md) §A7, approved separately from this document.

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

**Explicitly not imported:** `js/data/supabaseLoader.js` — its `supabaseClient.js` dependency pulls `@supabase/supabase-js` from `https://esm.sh/...` at the browser level, which does not resolve in a Node script. The DB side is fetched instead via a plain `fetch()`/`supabase-js` (Node package) call to the `get_site_bundle()` RPC — this also doubles as an end-to-end smoke test of the RPC itself.

## Normalization table (must be applied before any diff — these are legitimate differences, not defects)

| # | Difference | CSV side | DB side | Normalization |
|---|---|---|---|---|
| 1 | Match identity | file line order | `round, id` order | Key both sides by `(round, matchKey(playerA, playerB))`; never compare by array index |
| 2 | PR/luck on technical results | coerced to `0` (`parseFloat(...)\|\|0`) | genuine `null` | Normalize: if a row is technical/unplayed on either side, treat PR/luck as equal regardless of `0` vs `null`; otherwise compare exactly |
| 3 | Bye / all-zero rows | dropped at CSV-read time (`parseCSV`) | filtered via DB `played` boolean | Filter the DB side to `played=true` before comparing to CSV's already-filtered rows |
| 4 | `lastModified` | HTTP `Last-Modified` header (RFC 1123) | `leagues.last_updated` (ISO 8601) | Excluded from the diff entirely — not a data-correctness signal, just cache metadata |
| 5 | `landing_settings` key casing | `DisplayOrder`, `logoPath` | `display_order`, `logo_path` | Explicit rename map applied to the DB side before comparing |
| 6 | `allPlayers` source | non-Bye names from 8-column rows, incl. unplayed | union of `player_a`/`player_b` across all rows incl. `played=false` | Should already agree if ingest kept unplayed rows; compare as sets, report any divergence as a finding (not silently normalized) |

## Comparison levels (per league)

- **L1 — raw match sets.** Diff keyed by `(round, matchKey)`: missing on either side, extra on either side, or field-level mismatch (score/PR/luck) after normalization rules 2–3.
- **L2 — league config.** `league_params.json` fields vs mapped `leagues` row; player set; `landing_settings`; `players_metadata`.
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

## What this plan does not cover

- It does not re-verify the scraper's scrape-to-CSV step (that's `sync-source.js`'s own regression guard, `getBaselinePlayedCount`, already in place).
- It does not run automatically as part of Phase 1/2/3 of the architecture rollout — it is a standalone proof, run once at Phase 0 and optionally on a schedule afterward.
