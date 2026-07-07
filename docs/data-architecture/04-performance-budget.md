# 04 — Performance Budget & Measurement Harness

Status: standards are binding once [`01-architecture.md`](01-architecture.md) is approved. The measurement harness (`scripts/perf/measure-transitions.mjs`) is **not yet built**; millisecond columns below are intentionally empty. Building the harness and capturing real "before" numbers is **Phase 0** of the roadmap — approved separately from this document, before Phase 1 (DB changes) begins.

## Binding standards (from `01-architecture.md` §A6)

| Scenario | Standard |
|---|---|
| Back/forward, bfcache hit | `pageshow.persisted === true`; 0 network requests; interactive < 100ms |
| Back/forward, bfcache miss, warm cache | 0 blocking Supabase requests; ≤1 background version check; time-to-table < 300ms |
| Warm forward nav (page → page) | 0 blocking Supabase requests; time-to-table < 300ms (local harness) / < 500ms (prod budget) |
| Cold entry (empty storage) | exactly 1 blocking request (bundle RPC) + 1 analytics POST; time-to-table < 1500ms |
| Data-changed nav | stale content renders < 300ms; background refetch; re-render without visible scroll jump |

A budget breach on any tracked transition blocks merge once the harness is wired into CI (Phase 3).

## Transition matrix — request counts (exact, from code analysis) with ms columns to be filled by the Phase 0 harness run

| Transition | Requests, before (cold) | Requests, before (warm ≤60s) | Requests, after (cold) | Requests, after (warm) | ms, before | ms, after |
|---|---|---|---|---|---|---|
| → index.html | ~12 | ~8 | 1 | 0 (≤1 bg check) | *TBD* | *TBD* |
| → league.html | ~13–15 | ~13–15 (cache bypassed) | 1 | 0 | *TBD* | *TBD* |
| → league_table.html | ~8 | ~4 | 1 | 0 | *TBD* | *TBD* |
| → player_league.html | ~18–20 | ~14 | 1 | 0 | *TBD* | *TBD* |
| → player.html | ~9 | ~9 | 1 | 0 | *TBD* | *TBD* |
| back-nav, bfcache hit | 0 | 0 | 0 | 0 | *TBD* | *TBD* |
| back-nav, bfcache miss | = cold column | = warm column | 0 blocking | 0 blocking | *TBD* | *TBD* |
| nav when data changed | n/a | n/a | — | 2 background + re-render | n/a | *TBD* |
| → analytics.html | 1 RPC | 1 RPC | unchanged | unchanged | *TBD* | *TBD* |

Any new page added per `02-query-standards.md` rule 4 gets a new row here before merge.

## Harness specification: `scripts/perf/measure-transitions.mjs`

**Tooling: Playwright + CDP only. No Lighthouse.** The metrics that matter here — Supabase request count, time-to-table, bfcache hit/miss — are custom and specific to this app's request pattern; Lighthouse's generic FCP/TTI under synthetic throttling would add noise without adding a decision anyone needs to make.

**Scenario matrix**, 5 runs each, report median (and note max):
- Cold entry × each of the 5 pages (fresh browser context, cleared storage).
- Warm transitions: `index → league_table`, `league_table → player_league`, `player_league → player`, `league → index`, `index → league`.
- Back-nav: `player_league → back → league_table`, in both a bfcache-hit variant and a forced-non-bfcache variant (reload before `goBack`).
- TTL-expired variant: seed a warm cache, rewrite `checkedAt` to force the 60s window to have elapsed, then navigate — observes the background version-check path specifically.

**Metrics captured per run:**
- Supabase request count, split into "before first render" (blocking) vs. total.
- Bytes transferred to the Supabase host.
- Time-to-table: `fetchStart` → the moment a page's ready-selector first matches in the DOM (per-page selector map, e.g. `league_table.html → '#league-table tbody tr'`), captured via an `addInitScript`-registered `MutationObserver`.
- `pageshow.persisted` flag, captured via `addInitScript` registering `window.addEventListener('pageshow', e => window.__pageshowPersisted = e.persisted)`.

**Two gotchas that must be handled, not discovered mid-run:**
1. **Playwright disables bfcache by default.** The harness must launch with `ignoreDefaultArgs: ['--disable-back-forward-cache']`, or every bfcache assertion silently tests the wrong code path.
2. **`supabaseClient.js` auto-targets local Docker Supabase on `localhost`.** A harness run against a local dev server measures Docker latency, not production latency. Baseline and "after" numbers must run against the **deployed GitHub Pages site** (or a local page explicitly pinned to the cloud project via a harness-only override) — local runs are useful only for regression *direction*, not for filling in the budget table above.

**Cold vs. warm seeding:** cold = fresh Playwright context with storage cleared before the run; warm = seed by visiting `index.html` first and waiting for network idle, then navigate to the target page.

## What Phase 0 delivers into this document

Running the harness fills in every `*TBD*` cell above with a "before" number (current production, unmodified). The same harness, re-run in Phase 3 after the store/bundle lands, fills in the "after" column and becomes the standing regression check referenced by `02-query-standards.md` rule 4.
