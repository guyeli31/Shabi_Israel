# 02 — Query Standards (mandatory for all future pages/features)

Status: **binding (Phase 2/3 landed on local Docker).** Rule 1 is enforced by `scripts/check-query-standards.mjs`, which is built and **passing** (scans 83 files under `js/`, 0 violations as of 2026-07-10). The remaining rules are review-checklist items (see rule 10). Their purpose is to stop the pattern that caused this whole effort: a point-fix landing, then the next feature re-introducing the same class of bug because there was no standing rule against it.

Not yet wired into CI / a pre-commit hook — the gate script exists and runs on demand (`node scripts/check-query-standards.mjs`); automating it is a separate follow-up.

`CLAUDE.md` carries a one-line pointer to this file.

## The rules

1. **All public-page data reads go through `js/data/store.js`.** `supabase.from()` / `supabase.rpc()` may appear only in: `js/data/store.js`, `js/data/supabaseLoader.js` and `js/data/supabasePlayersMetadata.js` (the admin-only granular read path — see rule 9), `js/admin/**`, `js/analytics.js`, and `js/render/analyticsPage.js` (the analytics dashboard's own dedicated `analytics_summary` RPC — out of scope for this redesign, see `01-architecture.md` §A7 "Untouched forever"). No file outside that list may import `js/data/supabaseLoader.js` or call the Supabase client directly. Enforced by `scripts/check-query-standards.mjs` (a grep-based gate, built in Phase 3 — see `01-architecture.md` §A7), run in CI and as a pre-commit check.

2. **Any direct PostgREST query anywhere (admin included) must have a deterministic total `ORDER BY` ending in a unique column**, and must either (a) use pagination that accumulates all pages (the existing `fetchAllRows` pattern), or (b) carry a code comment proving the result set is bounded under 1000 rows by a DB constraint (e.g. a singleton table, or a `unique(...)` constraint capping cardinality). This is the rule that would have caught the round-only-order bug and the page-boundary row duplication before either shipped.

3. **New data needs extend the bundle, never add a new per-page query.** Adding a field means: add it to `get_site_bundle()` in `sql/site_bundle.sql`, bump `schema_version`, extend `bundleMapper.js`, update the CSV-parity script's normalization table if the field is CSV-derived. A page-specific query is only acceptable as a documented, dated exception in `01-architecture.md`'s decision log — not as an ad-hoc addition.

4. **Every new page or major feature is added to the performance-budget matrix (`04-performance-budget.md`) before merge**, and inherits the standard budgets by default: warm nav = 0 blocking requests; cold = 1. A page that can't meet this (e.g. a genuinely new external data source) needs an explicit, justified budget row, not silence.

5. **No new ad-hoc client caches.** `store.js`'s localStorage-backed cache is the only cache for Supabase-sourced data. Do not add another `sessionStorage` key, another in-memory memo keyed by page, or another TTL scheme — extend `store.js` instead. (This is what let the dashboard silently bypass the old cache: two competing cache mechanisms existed, and nothing forced every consumer through one.)

6. **Every DB object lives in a `sql/` file with an applied-on date in its header**, following the convention in `sql/supabase_schema.sql`. Any change to the bundle's returned shape bumps `schema_version` in the RPC output, which auto-invalidates every client's cached copy (see `01-architecture.md` §A2) — this must not be skipped even for "small" additions.

7. **No top-level `await` that performs network I/O anywhere in `js/data/**`.** This is what made the old localhost probe a blocking hazard; a per-module top-level network await blocks the entire import graph of every page that (transitively) imports it.

8. **snake_case-to-domain-object mapping exists only in `bundleMapper.js`.** Do not re-derive field-name translations inline in render/compute modules — this is also what makes the mapper reusable by the CSV-parity script (`03-csv-parity-plan.md`), so verification and production share one source of truth for what a "match" or "league" object looks like.

9. **Admin never reads the public cache/store; public pages never import `supabaseLoader.js`.** These are two halves of the same rule (see `01-architecture.md` §A7): admin needs fresh, cache-free reads to see its own writes; public pages must not accidentally acquire a direct, cache-bypassing path back into the old bug class.

10. **PR checklist** (attach to any PR touching data reads or adding a page):
    - [ ] Does every new/changed query have a deterministic `ORDER BY` with a unique tiebreaker, or a proven <1000-row bound? (rule 2)
    - [ ] Does this read go through `store.js`, with no direct `supabase.from()/rpc()` outside the allowed files? (rule 1, 9)
    - [ ] If new data is needed, was it added to the bundle rather than a new query? (rule 3)
    - [ ] Is the new page/feature in the performance-budget matrix with a stated budget? (rule 4)
    - [ ] No new cache mechanism was introduced? (rule 5)
    - [ ] Any new DB object is in a dated `sql/` file, and `schema_version` was bumped if the bundle shape changed? (rule 6)
    - [ ] No new top-level network await in `js/data/**`? (rule 7)
