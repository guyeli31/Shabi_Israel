# 04 — Performance Budget & Measurement Harness

> ## Wave 2 (2026-08-18) — read this first
>
> A second round of work landed, and it corrected **two measurement errors** in
> everything below. The Phase 0–3 numbers are not wrong about request counts,
> but their millisecond figures describe a journey no visitor makes and stop the
> clock before the user can see anything.
>
> **1. Warm transitions were driven by `page.goto()`, which sends no Referer.**
> The splash's entire defer mechanism is gated on `document.referrer` starting
> with our own origin. With no referrer every warm "navigation" in the old runs
> was treated as a direct hit, so the splash was shown *at once* — a code path a
> real click never takes. The harness now walks the site by clicking real links.
>
> **2. Time-to-table is not time-to-visible.** The ready-selector fires when the
> table enters the DOM; the loading screen is an overlay *on top of it* with a
> minimum-display floor, a ring-close wait and a fade. A transition measured at
> 445ms could stay covered until ~1040ms. The harness now also records whether
> the splash was ever visible, and `msVisible` — when the content was actually
> uncovered.
>
> New results: [Wave 2 results](#wave-2-results-2026-08-18). New acceptance
> test: [`scripts/perf/verify-splash-guarantee.mjs`](../../scripts/perf/verify-splash-guarantee.mjs).
> Admin has its own harness now:
> [`scripts/perf/measure-admin-views.mjs`](../../scripts/perf/measure-admin-views.mjs).

Status: standards binding. **Harness built; "before" baseline captured against production (Phase 0, 2026-07-09); "after" captured against local Docker (Phase 3, 2026-07-10) AND then re-run against production after the cloud deploy (2026-07-10) — closing the one apples-to-apples gap.** Raw output: [`verification/perf-baseline-2026-07-09.json`](verification/perf-baseline-2026-07-09.json) (before, production), [`verification/perf-after-local-2026-07-10.json`](verification/perf-after-local-2026-07-10.json) (after, local Docker), and [`verification/perf-after-production-2026-07-10.json`](verification/perf-after-production-2026-07-10.json) (**after, production — same environment as the before baseline**).

> **The production after-run makes the ms directly comparable.** Both the "before" baseline (2026-07-09) and the production "after" run (2026-07-10) were measured on `golan.me.uk` against the cloud DB — same network, same Postgres. The earlier local-Docker "after" run is kept for the request-count proof but its ms were never cross-comparable (localhost has no network hop). **Use the [production after results](#after-results-production-2026-07-10) for the real before↔after ms delta.**

## Binding standards (from `01-architecture.md` §A6)

| Scenario | Standard |
|---|---|
| Back/forward, bfcache hit | `pageshow.persisted === true`; 0 network requests; interactive < 100ms |
| Back/forward, bfcache miss, warm cache | 0 blocking Supabase requests; ≤1 background version check; time-to-table < 300ms |
| Warm forward nav (page → page) | 0 blocking Supabase requests; time-to-table < 300ms (local harness) / < 500ms (prod budget) |
| Cold entry (empty storage) | exactly 1 blocking request (bundle RPC) + 1 analytics POST; time-to-table < 1500ms |
| Data-changed nav | stale content renders < 300ms; background refetch; re-render without visible scroll jump |

A budget breach on any tracked transition blocks merge once the harness is wired into CI (Phase 3).

## Transition matrix — measured baseline (Phase 0, 2026-07-09) vs. target after Phase 3

Requests columns count Supabase-host responses only (median of 5 runs). "Requests, before" here is the **measured** count, superseding the earlier code-analysis estimate — see note below the table for where and why they differ.

Request columns count *blocking* Supabase responses (median of 5 runs). "before" measured on production; "after" measured on local Docker (ms not cross-comparable — see status note above). Cold = empty localStorage; warm = after seeding index + the "from" page.

| Transition | Requests, before (cold) | Requests, before (warm) | Requests, after (cold) | Requests, after (warm) | ms, before (prod) | ms, after (local) |
|---|---|---|---|---|---|---|
| → index.html | 8 | — | **1** | 0 | 3832 | 856 |
| → league.html | 12 | — | **1** | 0 | 2848 | 1004 |
| → league_table.html | 12 | 8 (from index) | **1** | **0** | 2739 / 1757 | 900 / 244 |
| → player_league.html | 24 | 20 (from league_table) | **1** | **0** | 3206 / 2285 | 903 / 167 |
| → player.html | 14 | 14 (from player_league) | **1** | **0** | 5322 / 4826 | 983 / 500 |
| back-nav, bfcache hit | — | 0 req, **100% hit**, 50–66ms (prod) | 0 | 0 | 50–66 | bfcache disabled by dev server — see caveat 3 |
| nav when data changed | n/a | n/a | — | 2 background + re-render | n/a | not separately measured |
| → analytics.html | 1 RPC | 1 RPC | unchanged | unchanged | not measured | not measured |

**Headline result:** every cold page load drops from **8–24 blocking Supabase requests to exactly 1** (the `get_site_bundle` RPC); every warm forward navigation drops to **0 blocking requests** — served entirely from the localStorage bundle. This is the architectural win the whole redesign targeted, and it is measured, not projected. The worst offenders improved most: `player_league.html` (the old 11-query `ensurePlayerIndex` fan-out, 24 total) and the dashboard (which used to bypass caching entirely) both now cost 1 cold / 0 warm like every other page.

> **Methodology caveat on the "before" counts (retroactive).** The Phase 0 "before" run used the *original* harness, which counted *any* Supabase-host response arriving before render as "blocking" — including the fire-and-forget `analytics_events` POST. The corrected harness (caveat #5 below) excludes that POST by URL. So each "before" cold count in this table may be inflated by up to **+1** relative to the true blocking-*data*-request count, on the same footing the first "after" run was before it was fixed. This does not change the headline (a ±1 on 8–24 is noise against the drop to 1), and the "before" run was never re-taken because the old code is gone — but the before↔after count comparison is "≈1-off honest," not exact-methodology-matched. The *direction and magnitude* (down to 1 cold / 0 warm) are not in doubt; a single unit on the high "before" side might be an analytics POST rather than a data request.

Any new page added per `02-query-standards.md` rule 4 gets a new row here before merge.

**Why measured counts differ from the earlier code-analysis estimate (`00-current-state-map.md`):** the estimate was a manual trace of call sites; the harness counts actual Supabase-host HTTP responses. Some earlier estimates (e.g. `player_league.html` ~18–20) undercounted a bit (measured 24) — the code trace didn't fully account for every parallel loader firing on that page. Others (e.g. `index.html` ~12) overcounted relative to what actually reaches the network, likely because some duplicate calls the code trace flagged are served from an in-flight-request dedupe somewhere in the stack rather than firing twice on the wire. Either way: **the measured numbers in this table are now the authoritative "before," not the estimate** — this is exactly why Phase 0 exists rather than shipping an architecture change on estimated numbers alone.

**back-nav bfcache miss was not observed in this run** — bfcache hit rate was 100% across all 5 scenarios × 5 runs (25/25). The site has no bfcache blockers today (see `00-current-state-map.md` §4), so this is the expected result, not a gap in the harness. A miss scenario (e.g. after a hard reload, or once a real blocking network call exists post-Phase-2) would need to be forced deliberately to get a number for that row.

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

**Three gotchas that must be handled, not discovered mid-run** (the third was found only by actually running the harness — the first version of it reported a false 0% bfcache hit rate before this was diagnosed):
1. **Playwright disables bfcache by default.** The harness must launch with `ignoreDefaultArgs: ['--disable-back-forward-cache']`, or every bfcache assertion silently tests the wrong code path.
2. **`supabaseClient.js` auto-targets local Docker Supabase on `localhost`.** A harness run against a local dev server measures Docker latency, not production latency — so absolute ms from a local run are not comparable to a production baseline. The harness takes `--base-url` / `--supabase-host` flags (default production); the Phase 3 "after" run used them to point at `http://localhost:8090` + `127.0.0.1:54321` deliberately (code not yet deployed to production), which is why the after-ms are local and flagged non-comparable throughout this doc. A true apples-to-apples after run requires the code live on production.
3. **Genuinely headless Chromium does not restore from bfcache in this Playwright build — confirmed empirically, both default headless and explicit `--headless=new`.** The browser must be launched with `headless: false` to observe real bfcache behavior; running headless makes every back-navigation look like a full miss regardless of the site's actual behavior, which is exactly the false negative the first harness run produced. A related sub-gotcha: `page.goBack({ waitUntil: 'load' })` (or `'domcontentloaded'`) **hangs until timeout on a genuine bfcache hit**, because a bfcache restore never fires a new `load`/`domcontentloaded` event (the page is resurrected from a frozen snapshot, not re-parsed) — use `waitUntil: 'commit'` for the back-navigation call, then poll/wait on the ready-selector and the `pageshow.persisted` flag separately. CI implication: running this harness headless (e.g. no Xvfb) will silently under-report bfcache; CI must launch headed via a virtual display, not just drop `--disable-back-forward-cache`.
4. **The local dev server (`http-server -c-1`) sends `Cache-Control: no-store`, which disables bfcache entirely.** `no-store` is a documented Chrome bfcache blocker, so *any* back-navigation against the local dev server is a hard bfcache miss regardless of the page's own behavior — this is why the Phase 3 "after" run shows a 0% bfcache hit rate on localhost even though the identical code path hits 100% on production (which sends `max-age=600`). This is a dev-server-config artifact, **not** a code regression: verified structurally (grep confirms Phase 2/3 added no `unload`/`beforeunload`/`storage` listeners — the only things that could block bfcache) and confirmed by the Phase 0 production baseline's 100% hit rate on the same navigations. To measure bfcache locally you would have to serve the static files with a cache-allowing header; it is simpler to trust the production baseline plus the structural check.
5. **On localhost the `analytics_events` POST and the `site_meta` version-check GET share the Supabase host with the bundle RPC**, so a host-only "blocking" classifier miscounts them by timing (a fast local analytics POST can resolve before render finishes). The harness excludes known fire-and-forget paths (`/analytics_events`, `/rest/v1/site_meta`) from the blocking count by URL, not host+timing — the first "after" run inflated every figure by exactly 1 before this was fixed.

**Cold vs. warm seeding:** cold = fresh Playwright context with storage cleared before the run; warm = seed by visiting `index.html` first and waiting for network idle, then navigate to the target page.

## Baseline results (Phase 0, 2026-07-09)

Run against the deployed site (`https://golan.me.uk`), 5 runs per scenario, headed Chromium. Cold pages: `index.html` 3832ms / league.html 2848ms / league_table.html 2739ms / player_league.html 3206ms / player.html 5322ms (all medians; `player.html`'s 5322ms is the slowest cold entry — it fans out to `loadLeaguesBulk`, consistent with `01-architecture.md`'s prediction). Warm forward navs range 1447–4826ms depending on target page. Back-navigation via bfcache: **100% hit rate across all 25 runs, 50–66ms median** — confirms `00-current-state-map.md`'s claim that the site has no bfcache blockers today, and gives a concrete number for what "already working" looks like before any architecture change. Full data in the transition matrix above and the raw JSON.

## After results (Phase 3, 2026-07-10)

Run against **local Docker** (`http://localhost:8090` + `127.0.0.1:54321`), 5 runs per scenario, headed Chromium, with the store/bundle fully wired in and the old loaders deleted. Raw: [`verification/perf-after-local-2026-07-10.json`](verification/perf-after-local-2026-07-10.json).

- **Cold entry: 1 blocking Supabase request per page** (the `get_site_bundle` RPC), 856–1004ms — down from 8–24 requests on production. Meets the cold budget (exactly 1 blocking request).
- **Warm forward nav: 0 blocking Supabase requests**, 167–500ms — down from 8–20. Meets the warm budget (0 blocking, < 300ms locally for 4 of 5; `player_league → player` at 500ms reflects that page's heavy render, not a data fetch).
- **Warm back-nav: 0 blocking requests, 129–230ms.** bfcache hit rate reads 0% here, but that is caveat #4 above (dev server's `no-store` disables bfcache) — **not** a regression: the code adds no bfcache blocker (structurally verified), and the Phase 0 production baseline measured 100% on these same navigations. On production this code path keeps that 100%.

**What still needs a production run to close out:** the absolute after-ms (localhost is faster than production for network reasons) and the bfcache hit rate (localhost's dev server disables it). Both are measurement-environment limits, not open questions about the code — but an honest "after == before minus the requests, same bfcache" claim on production numbers requires re-running the harness (no flags → defaults to production) once this code is deployed. **This is now done — see below.**

## After results (production, 2026-07-10)

Run against the **deployed production site** (`https://golan.me.uk` + cloud Supabase), 5 runs per scenario, headed Chromium, *after* the SQL was applied to the cloud SQL Editor and the JS was committed + pushed. This is the apples-to-apples closeout: **same environment as the 2026-07-09 "before" baseline**, so the ms below are directly comparable. Raw: [`verification/perf-after-production-2026-07-10.json`](verification/perf-after-production-2026-07-10.json).

| Transition | Requests before → after | ms before (prod) → after (prod) | Improvement |
|---|---|---|---|
| → index.html (cold) | 8 → **1** | 3832 → **2396** | −37% |
| → league.html (cold) | 12 → **1** | 2848 → **2246** | −21% |
| → league_table.html (cold) | 12 → **1** | 2739 → **2425** | −11% |
| → player_league.html (cold) | 24 → **1** | 3206 → **2237** | −30% |
| → player.html (cold) | 14 → **1** | 5322 → **2189** | **−59%** |
| index → league_table (warm fwd) | 8 → **0** | 1757 → **447** | **−75%** |
| league_table → player_league (warm fwd) | 20 → **0** | 2285 → **445** | **−81%** |
| player_league → player (warm fwd) | 14 → **0** | 4826 → **472** | **−90%** |
| league → index (warm fwd) | — → **0** | — → **95** | — |
| index → league (warm fwd) | — → **0** | — → **535** | — |
| back-nav, bfcache hit | 0 → **0** | 50–66 → **39–53** | 100% hit both |

**Closeout result — the redesign delivered on production, measured, same environment before and after:**
- **Cold entry: exactly 1 blocking Supabase request** on every page (was 8–24). The worst offender, `player.html`, went **5322ms → 2189ms (−59%)** — the old `loadLeaguesBulk` fan-out is gone.
- **Warm forward nav: 0 blocking requests**, 95–535ms (was 8–20 requests, 1447–4826ms). The heaviest transition, `player_league → player`, dropped **4826ms → 472ms (−90%)** — served entirely from the localStorage bundle.
- **Back-nav bfcache: 100% hit rate preserved** (25/25), ~39–53ms — the new code added no bfcache blocker, exactly as the structural check predicted. The local-Docker `no-store` 0% reading was confirmed to be a dev-server artifact, not a regression.

Every budget in the standards table is met on production. This closes the last open verification item; the local-Docker "after" run remains on file for the request-count proof but is superseded by this run for ms.

## Standing use

Re-running this harness (default flags → production) after any future change touching the read path is the regression check referenced by `02-query-standards.md` rule 4. A budget breach on any tracked transition blocks merge once the harness is wired into CI (the CI wiring itself — headed via Xvfb per caveat #3 — is not yet done).

---

## Wave 2 results (2026-08-18)

Four runs, per the measurement matrix: production before, Docker before, Docker
after, and production after (pending — it needs the deploy). **The improvement
delta is always Docker→Docker**; the production pair is a separate record of
what live visitors experience across the release.

Raw output: [`verification/perf-prod-before-2026-08-18.json`](verification/perf-prod-before-2026-08-18.json),
[`verification/perf-docker-before-2026-08-18.json`](verification/perf-docker-before-2026-08-18.json),
[`verification/perf-docker-after-2026-08-18.json`](verification/perf-docker-after-2026-08-18.json).

### Warm transitions — real clicks (median of 5)

| Transition | before, table | before, visible | after, table | after, visible | change |
|---|---|---|---|---|---|
| index → league (dashboard) | 4332ms | 4359ms | **728ms** | **744ms** | **−83%** |
| league → league_table | 511ms | 527ms | 480ms | 498ms | −6% |
| league_table → player_league | 369ms | 385ms | 357ms | 373ms | −3% |
| player_league → player | 615ms | 630ms | 600ms | 642ms | −2% |
| back-nav | 298ms | — | 246ms | — | −17% |

Blocking Supabase requests: **0 on every warm transition, before and after** —
the Phase 2 bundle already had that right.

### Cold entry (median of 5)

| Page | before, table | before, visible | after, table | after, visible | change |
|---|---|---|---|---|---|
| league.html (dashboard) | 5093ms | 5132ms | **1449ms** | **1797ms** | **−72%** |
| index.html | 1851ms | 2185ms | 1820ms | 2173ms | −2% |
| league_table.html | 1213ms | 1515ms | 1200ms | 1546ms | ≈0 |
| player_league.html | 1144ms | 1501ms | 1136ms | 1492ms | ≈0 |
| player.html | 1466ms | 1805ms | 1515ms | 1854ms | ≈0 |

Still exactly 1 blocking request cold, 5/5 splash shown — unchanged and correct.

### Splash visibility — the new acceptance metric

| Scenario | before | after |
|---|---|---|
| Warm transition, production (`player_league → player`) | **shown 4/5, 229ms on screen** | *(pending deploy)* |
| Warm transition, Docker, 1× CPU | not shown 0/5 | not shown 0/5 |
| Warm transition, Docker, 4× CPU | — | **not shown** |
| Warm transition, Docker, 10× CPU | — | **not shown** |
| Warm transition, Docker, 20× CPU (30s transition) | — | **not shown** |
| Cold entry | shown 5/5 | shown 5/5 |

The CPU-throttled rows are the ones that matter. The old mechanism was a race —
wait 350ms, show if the page is not done — so on a fast desktop it mostly stayed
hidden and on slower hardware it did not, which is exactly what the production
before-run caught. The splash is now armed by *a blocking fetch starting*, not
by a stopwatch, so no device speed can make it appear over a navigation that has
nothing to fetch. Verified by
[`scripts/perf/verify-splash-guarantee.mjs`](../../scripts/perf/verify-splash-guarantee.mjs),
which also asserts the converse (cold entry must still show it).

### Production, before (2026-08-18, real clicks)

Recorded so the post-deploy run has a same-environment partner.

| Scenario | table | visible | splash |
|---|---|---|---|
| cold index.html | 3329ms | 3574ms | 5/5 |
| cold league.html | 3783ms | 4023ms | 5/5 |
| cold league_table.html | 2774ms | 2817ms | 5/5 |
| cold player_league.html | 2964ms | 3301ms | 5/5 |
| cold player.html | 3167ms | 3501ms | 5/5 |
| warm index → league | 2753ms | 2770ms | 1/5 |
| warm league → league_table | 561ms | 577ms | 0/5 |
| warm league_table → player_league | 629ms | 649ms | 0/5 |
| warm player_league → player | 1041ms | **1250ms** | **4/5, 229ms** |
| back-nav | 103ms | — | bfcache 100% |

**Pending:** re-run against production after the deploy and add the "after"
column — see `02-query-standards.md` rule 4.

### Admin — a full walk through the views

`scripts/perf/measure-admin-views.mjs`. One lap is: Leagues → open league A →
Round Editor → Overrides → back → open league B → same → Players → Pending
Changes → Historical Changes → Sync → Leagues. The lap is walked **twice with
nothing written in between**, so every data call in lap 2 is a re-download of
rows the page provably already had.

The script is read-only by construction: it clicks navigation only, and refuses
any target whose label matches a write verb (save/publish/delete/run/import/…).
That guard is why `Upload CSV` is absent from the journey — opening that tab is
in fact harmless, but a blunt guard is worth more than one extra tab on a script
licensed to run against production.

| | lap 1 | lap 2 (nothing written) |
|---|---|---|
| **production, before** | 86 data calls, 18.2s | **85 data calls**, 17.9s |
| **Docker, before** | 83 data calls, 9.9s | **80 data calls**, 9.8s |
| **Docker, after** | **16 data calls**, 9.8s | **8 data calls + 4 verify**, 10.1s |
| production, after | *(pending deploy)* | *(pending deploy)* |

Lap 2 is the headline: essentially **nothing** was being reused. The single
worst pattern is `leagues`, fetched **11, 12, 14, 15, 16 and 24 times inside one
navigation** on production — one round trip per league, from several modules
that had no idea the others had just done the same. After the change the league
editors cost **0** on reopen, and the whole lap trades ~72 row fetches for 4
one-row version checks.

The 8 data calls remaining in lap 2 are all from **Sync** and **Historical
Changes** — live-status views that are *supposed* to re-poll. They are not
served from the memo and should not be.

Production is meaningfully worse than Docker here (86 vs 83 calls, but 18.2s vs
9.9s) because every one of those repeated fetches pays a real network round
trip. The same fix therefore returns more on production than the Docker figures
alone suggest.

> **A measurement trap worth recording.** The first admin harness clicked only
> between the top-level sidebar views and reported a flat zero *both before and
> after* — those views barely touch the network. The admin read path is
> exercised when a **league editor** opens. A harness pointed at the wrong
> interaction does not report an error; it reports "no difference", which is
> indistinguishable from a change that did nothing. A second version then
> reported zeros again because `networkidle` resolved before the views had
> rendered, and a third because a failed login had silently redirected it to the
> public landing page — `admin.html` redirects when logged out, so the run
> looked healthy while sitting on `index.html`. Log in via `analytics.html`,
> whose gate stays put and reports its own failure.

### Analytics

Measured by the same script, on the same three runs.

| Action | prod before | Docker before | Docker after | prod after |
|---|---|---|---|---|
| Page load | 3 calls | 3 calls | **2 calls** | *(pending)* |
| Each month change | 2 calls | 2 calls | **1 call** | *(pending)* |
| Returning to a month already viewed | 2 calls | 2 calls | **1 call** | *(pending)* |

| Action | before | after |
|---|---|---|
| Month change / exclude-admin toggle | 2 RPCs (`analytics_months` + `analytics_summary`) | **1 RPC** (`analytics_summary`) |
| Page load | 2 RPCs **sequential** + 1 direct `leagues` query | 2 RPCs **in parallel**, `leagues` served from the bundle |

The two RPCs were awaited one after the other though neither needs the other:
the month the page opens on comes from the clock or from the caller, never from
the month list, which only fills the picker. `analytics_months` is now also held
for the life of the page — the set of months with data cannot change while the
operator sits there.

### Still on the table

- `measureScrollWrapStickyCols`'s `write()` is now the dashboard's largest
  remaining JS cost (~130–270ms). It reads `getBoundingClientRect()` and writes
  a CSS variable per scrollable table; a value-guard was added to stop the
  ResizeObserver loop, but the read/write interleave across tables remains.
  Untouched further because it is sticky-column layout code and a regression
  there is visual, not measurable.
- Cold entry outside the dashboard is unchanged (~1.1–1.8s local, ~2.8–3.8s
  production). That cost is the bundle round trip plus parse, and reducing it
  means changing what the bundle carries — a design change, not a fix.
