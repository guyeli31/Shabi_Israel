# 01 — Architecture: "One Snapshot Everywhere"

Status: **proposed, awaiting approval before any implementation phase begins**. See [`README.md`](README.md) for phase status tracking. Baseline this design fixes: [`00-current-state-map.md`](00-current-state-map.md).

## Context

The site migrated from static CSV/JSON to Supabase. A series of point-fixes to that read path kept uncovering new bugs (silent 1000-row truncation, non-deterministic pagination that duplicated a row and inflated a player's PR from 3.01 to 3.08, a blocking dev-only probe, unmemoized duplicate queries, an 11-query fan-out on the player page). Rather than another spot-fix, this document designs the query strategy from the ground up and is meant to be read and approved as a whole before implementation starts.

**Scope note:** total site data is small — 11 leagues, ~3,850 match rows, ≈500KB raw JSON (~60-80KB gzipped) today. Every architectural choice below leans on that fact; the design also states the point at which that assumption breaks and what changes then.

## A1. Bundle granularity: one site-wide bundle

**Decision:** a single Postgres RPC, `get_site_bundle()`, returns everything — landing settings, all leagues, all matches, all overrides, all match history, all player metadata — as one jsonb value.

**Why not per-league bundles:** the heaviest pages are *cross-league* — the landing page's cross-league sections, `player.html`'s all-time profile, and `player_league.html`'s player index all need every league's matches anyway. Per-league bundles would optimize only `league_table.html` while leaving the worst offenders multi-request, reintroducing per-page query composition — the exact problem being solved.

**Growth math:** ~12 leagues/year × ~350 rows ≈ +4,200 matches/year. Year 3 ≈ 12-13k matches ≈ 1.6MB raw / ~250KB gzipped — still a cheap single fetch and parse (~10-20ms). The size ceiling that actually matters is client storage, not network (see A2).

**Pre-designed split, not built now:** add `archived boolean default false` to `leagues` as part of the same migration; define the RPC signature as `get_site_bundle(include_archived boolean default true)` from day one. Activation trigger (documented, not yet met): raw bundle exceeds ~2MB, or gzipped exceeds ~300KB, or the client observes `localStorage` write failures in the wild. When triggered, the client fetches an "active" bundle (blocking) plus a lazily-fetched "archive" bundle cached under its own version key — `store.js`'s public API does not change.

**Payload trimming, applied now for free:** the RPC strips `created_at`/`updated_at` from `matches`/`manual_overrides` (`to_jsonb(row) - 'created_at' - 'updated_at'`) — those columns are pure audit metadata pages never read — cutting ~25-30% of raw bytes. `leagues.last_updated` and `match_history.updated_at` are kept; pages use them.

## A2. Cache store: localStorage, versioned

**Decision:** `localStorage` key `shabi:bundle:v1` → `{ schemaVersion, dataVersion, checkedAt, fetchedAt, bundle }`.

**Why not IndexedDB:** IndexedDB's only real advantage is quota headroom, which doesn't bind for ~4-5 years at current growth (see A1). Its cost is asynchronicity: the whole point of this design is a *synchronous* read that lets a page render before first paint, and IndexedDB can't do that. It becomes the natural replacement once the archive-split trigger in A1 fires — `store.js` hides persistence behind a 2-function interface (`readPersisted()` / `writePersisted()`) specifically so the backend can be swapped later without touching any page.

**Why not a Service Worker:** on a no-build GitHub Pages static site, a Service Worker buys offline support nobody asked for, at the cost of an update-lifecycle problem (stale SW serving old JS after a deploy, scope/cache invalidation) — and its HTTP-level caching would actively fight the data-version protocol below (two independent staleness mechanisms disagreeing about what's fresh). Rejected.

**Quota / private-mode failure:** wrap `setItem` in try/catch (same pattern already used in `js/data/leagueCache.js`); on failure, degrade to an in-memory-only cache for that page load. The page still renders correctly; only the warm-nav win is lost for that session.

**Schema versioning in the key name** (`:v1`): any future change to the bundle's shape bumps this suffix, which auto-invalidates every old cached copy with zero migration code — old key is simply never read again.

**Cross-tab sync:** a `storage` event listener triggers a re-render from the newly-written bundle in every other open tab.

## A3. Version protocol and check UX: stale-while-revalidate

**DB side:** new singleton table `site_meta(id int primary key check (id=1), data_version bigint not null default 1, updated_at timestamptz)`. A **statement-level** trigger (`after insert or update or delete ... for each statement`, not per-row) on each of the 6 data tables calls `bump_data_version()` — O(1) per statement regardless of how many rows the scraper's bulk write touches. `max(updated_at)` across 6 tables was considered and rejected: it's a 6-table scan versus a 1-row read, and `updated_at` triggers don't fire on `DELETE` anyway. Anon gets `SELECT` on `site_meta`; the version check is a plain PostgREST GET (`~200 bytes`), no RPC needed. The bundle RPC reads `data_version` in the same statement it builds the rest of the payload, so bundle and version are always consistent with each other.

**Client flow, every page load:**
1. Synchronous `localStorage` read → if a bundle is present, render immediately. **Zero blocking requests.**
2. If the last version check was <60s ago, stop here.
3. Otherwise fire a background version GET. On match: just update `checkedAt`. On mismatch: fetch the bundle RPC, persist it, emit an update event so open pages re-render (preserving scroll position — the same discipline the tables already apply for sort re-renders).
4. No cache at all (first-ever visit, or cache evicted) → step 1 has nothing to render, so this becomes **exactly 1 blocking RPC call**, then render.
5. Re-run step 2-3 on `pageshow` with `event.persisted === true` (bfcache restore) and on `visibilitychange → visible`, both still TTL-gated — this makes a tab left open for an hour self-heal without adding latency to the common case.

**Why not block every navigation on a version check:** the scraper updates data at most every ~15 minutes; blocking 100% of navigations on a ~100-300ms round trip to catch a change present in under 1% of them is a bad trade. **Why not a longer TTL:** 60s is short enough that a user actively bouncing between pages during a live scrape still sees fresh data within about one scrape interval, without meaningfully taxing normal browsing. Worst-case staleness = scrape cadence (~15 min) + up to 60s TTL + one background fetch. This is flagged as an open question in §E for the running league during active match days, not decided here.

## A4. Dual data-source path and the localhost probe

**Keep `?datasource=files`** as an explicit escape hatch through the existing facade. In files mode, `store.js` builds an in-memory bundle-shaped object from `leagueLoader.js` and **skips both persistence and version checks** — caching a frozen snapshot under the live cache key would poison it for the next Supabase-mode visit.

**Delete the blocking probe.** `dataSourceConfig.js`'s top-level `await probeSupabaseReachable()` is removed; localhost defaults to `supabase`, exactly like production. A Docker-less dev machine uses `?datasource=files` explicitly instead of relying on an auto-fallback that costs every other dev session up to 2.5 seconds. A non-blocking `console.warn` may fire after load if the bundle fetch fails, suggesting the flag — but nothing in `js/data/**` may perform a blocking network await at module top level again (this becomes a standing rule — see `02-query-standards.md` rule 7).

## A5. Why RPC, not a view or PostgREST resource embedding

**Decision:** `get_site_bundle()` — `language sql`, `stable`, `security invoker`, `grant execute to anon, authenticated`. Sketch (final SQL lives in a new `sql/site_bundle.sql`, following the existing hand-applied convention in `sql/supabase_schema.sql`):

```sql
create or replace function public.get_site_bundle()
returns jsonb language sql stable as $$
select jsonb_build_object(
  'schema_version', 1,
  'data_version', (select data_version from public.site_meta where id = 1),
  'generated_at', now(),
  'landing_settings', (select to_jsonb(ls) from public.landing_settings ls where id = 1),
  'leagues',          (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') from public.leagues l),
  'matches',          (select coalesce(jsonb_agg((to_jsonb(m) - 'created_at' - 'updated_at')
                            order by m.league_id, m.round, m.id), '[]') from public.matches m),
  'manual_overrides', (select coalesce(jsonb_agg((to_jsonb(o) - 'created_at' - 'updated_at')
                            order by o.league_id, o.id), '[]') from public.manual_overrides o),
  'match_history',    (select coalesce(jsonb_agg(to_jsonb(h) order by h.league_id, h.id), '[]') from public.match_history h),
  'players_metadata', (select coalesce(jsonb_agg((to_jsonb(p) - 'created_at' - 'updated_at')
                            order by p.id), '[]') from public.players_metadata p)
); $$;
```

- **Kills the 1000-row-cap bug class structurally.** The response is one row of jsonb — PostgREST's default row cap and `.range()` pagination simply don't apply to the public read path anymore. Determinism (unique tiebreaker in every `order by`) lives in one auditable SQL file instead of being re-derived per JS call site.
- **Resource embedding (`select=*,matches(*)`) loses:** embedded arrays are still subject to PostgREST's `max-rows` limit — reintroducing the exact opaque-truncation risk this design eliminates. `landing_settings` and `players_metadata` have no FK relation to `leagues`, so they can't ride along regardless — extra requests would remain. The query string also becomes effectively unauditable.
- **A plain view loses:** a jsonb-emitting one-row view is an RPC with worse ergonomics — no parameters (needed for the future `include_archived` split) and `security_invoker` view semantics carry their own subtlety. A view over raw rows re-imports the row-cap problem instead of solving it.
- **Grant hygiene:** `security invoker` means the RPC only ever returns what anon's existing RLS `select` policies already allow — no new definer-privilege surface is introduced.
- **Timeout/size:** `jsonb_agg` over ~4k rows executes in tens of milliseconds; Supabase's API statement timeout is orders of magnitude away even at year 10 of growth.
- **Local/cloud parity:** one new hand-applied file, `sql/site_bundle.sql`, following the header convention already used in `sql/supabase_schema.sql` (applied-on date comment). Runs identically against local Docker (`supabase start`) and cloud.

**Mapping stays client-side**, moved into a new pure module `js/data/bundleMapper.js` (the existing `mapDbLeagueToParams` / `mapDbMatch` / `mapDbOverride` from `supabaseLoader.js`, plus override application via the existing pure `applyOverrides` and `mergeHistoryIntoMatches`). Deliberately kept out of SQL so the RPC stays trivially auditable, and — the decisive reason — so the same mapper is importable by the Node CSV-parity script in `03-csv-parity-plan.md`, meaning verification exercises the exact code pages render with, not a re-implementation of it.

## A6. bfcache and back-navigation standard

| Scenario | Standard |
|---|---|
| Back/forward, bfcache hit | `pageshow.persisted === true`; 0 network requests; interactive < 100ms |
| Back/forward, bfcache miss, warm cache | 0 blocking Supabase requests; ≤1 background version check; time-to-table < 300ms |
| Warm forward nav (any page → page) | 0 blocking Supabase requests; time-to-table < 300ms local / < 500ms prod budget |
| Cold entry (empty storage) | exactly 1 blocking request (bundle RPC) + 1 analytics POST; time-to-table < 1500ms |
| Data-changed nav | stale content renders < 300ms; background refetch; re-render without scroll jump |

This table is the binding contract; full measurement procedure lives in `04-performance-budget.md`. bfcache eligibility is preserved by construction: no `unload`/`beforeunload` handlers exist today, analytics already uses `pagehide` + keepalive fetch, and removing the top-level-await probe (A4) removes the one remaining load-path hazard.

## A7. Who keeps direct Supabase access; rollout order

**Admin keeps direct queries.** Exploration found admin modules (`js/admin/csvEditor.js`, `csvValidation.js`, `leagueManager.js`, `roundEditor.js`) already import `dataSourceLoader`/`supabaseLoader` directly. Rather than migrate admin onto the cached store (wrong tradeoff — admin needs fresh, cache-free reads to see its own writes immediately), `supabaseLoader.js`'s granular functions are **retitled admin-only**, not deleted. `02-query-standards.md` rule 9 forbids public render/compute modules from importing it going forward.

**Phased rollout** (each phase is a separate commit, independently revertible; user approves each phase before it starts):

- **Phase 0 — tooling & baseline.** Build and run the perf harness (`04-performance-budget.md`) to fill in real "before" numbers; build and run the CSV-parity script (`03-csv-parity-plan.md`) as a one-time cutover-correctness proof. No product code changes.
- **Phase 1 — DB, additive only.** Apply `sql/site_bundle.sql` (site_meta, bump triggers, the RPC, grants, `leagues.archived`). Old clients are completely unaffected — nothing reads the new objects yet. Verify with a manual `curl`/REST call. Rollback: drop the new objects.
- **Phase 2 — store + page rewiring.** Add `js/data/store.js` and `js/data/bundleMapper.js`. The store initially also exposes the legacy facade function signatures (`loadLeague`, `loadLeaguesBulk`, `loadLandingSettings`, ...) implemented on top of the bundle, so each page's rewiring is a plain import swap: `league_table.html` (simplest, already cache-aware) → `index.html` → `league.html` → `player_league.html` (this is the one that kills the 11-query `ensurePlayerIndex` fan-out) → `player.html`. Each swap is independently revertible.
- **Phase 3 — cleanup + after-numbers.** Delete `leagueCache.js`, the localhost probe, the public-path use of `loadLeaguesBulk`/`fetchAllRows`; dedupe the ×4 `landing_settings` call sites; re-run the Phase 0 harness to record "after" numbers; land the `02-query-standards.md` enforcement grep-gate.

## Request-count summary (before = exact from code analysis; after = by construction)

| Transition | Before, cold | Before, warm (≤60s) | After, cold | After, warm |
|---|---|---|---|---|
| → index.html | ~12 | ~8 | **1** | **0** (≤1 bg check) |
| → league.html | ~13–15 | ~13–15 (cache bypassed) | **1** | **0** |
| → league_table.html | ~8 | ~4 | **1** | **0** |
| → player_league.html | ~18–20 | ~14 | **1** | **0** |
| → player.html | ~9 | ~9 | **1** | **0** |
| back-nav, bfcache hit | 0 | 0 | **0** | **0** |
| back-nav, bfcache miss | = cold column | = warm column | **0 blocking** | **0 blocking** |
| nav when data changed | n/a | n/a | — | 2 background (check + bundle) + re-render |
| → analytics.html | 1 RPC | 1 RPC | unchanged | unchanged |

Millisecond columns intentionally omitted here — see `04-performance-budget.md` for the measurement procedure that fills them in.

## v2 portability note

`CLAUDE.md` names `v2/` (a parallel Vite rebuild) as the eventual end-state; `v2/` currently reads static files only and has no Supabase code path. This design targets v1's `js/data/` because that's where the production pain is today, but every decision above (bundle RPC, versioned localStorage cache, SWR protocol) is framework-agnostic — nothing depends on vanilla JS or the MPA navigation model. `v2/docs/MIGRATION-FROM-V1.md` gets a note (see `README.md` for tracking) that v2 adopts this same store/bundle design once it reaches its own Supabase migration phase, rather than designing a second data layer from scratch.

## Decision log

| Date | Decision | Superseded? |
|---|---|---|
| 2026-07-07 | Single site-wide bundle over per-league bundles | — |
| 2026-07-07 | localStorage over IndexedDB/Service Worker for the cross-page cache | — |
| 2026-07-07 | RPC over view/resource-embedding for the bundle | — |
| 2026-07-07 | Stale-while-revalidate (60s TTL background check) over blocking version check | — |
| 2026-07-07 | Admin keeps direct/fresh queries; `supabaseLoader.js` becomes admin-only | — |

## E. Open questions needing user input before/at each phase's approval

1. **Staleness tolerance for the running league:** up to ~75s beyond scrape delay on warm navs (60s TTL + render-before-check). Acceptable during active match days, or should the running league use a shorter TTL specifically?
2. **Growth assumption check:** ~12 leagues/year × ~350 rows drives the year-4–5 localStorage ceiling and the archive-split trigger in A1 — confirm this matches expected league cadence.
3. **SQL migration tooling:** no Supabase CLI migrations exist today; `sql/site_bundle.sql` follows the existing hand-applied convention. Adopt CLI migrations now, or explicitly defer that separately from this effort?
4. **Analytics POST per page view** stays outside all budgets in `04-performance-budget.md` (1 request, unrelated system) — confirm that's fine to leave alone.
