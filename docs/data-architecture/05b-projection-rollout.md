# 05b — Projection cache: rollout and cost verification

Companion to [`05-projection-cache.md`](05-projection-cache.md) (the design).
This is the operator's page: what to run, in what order, and how to prove
afterwards — on the live site — that nothing here costs more than it should.

Everything below has been executed against local Docker. Nothing has been
applied to cloud production.

---

## What was built

| File | Role |
|---|---|
| `sql/league_projections.sql` | The table, the queue, the triggers, RLS + grants |
| `scripts/project-title-race.js` | The writer. Claims queued leagues, projects, upserts |
| `scripts/clone-league-from-cloud.mjs` | Copies one league cloud → local Docker, so a feature can be tested against real, COMPLETE data |
| `.github/workflows/project-title-race.yml` | Runs the writer — dispatch, schedule, or the Run button |
| `js/compute/last300.js` | **The** Last-300 PR window. One definition; the job and every browser path call it |
| `js/compute/topXTimeline.js` | The projection + the fingerprint. Shared by the job and the browser |
| `js/data/store.js` → `loadLeagueProjections()` | The read, deliberately outside the site bundle |
| `js/render/dashboardPage.js` | Chart, Predictor and What-If all read stored points |

---

## What changed since the first draft of this page

The design in `05` still holds. These are the corrections the implementation
forced, and each one is why a step below reads the way it does.

**Iterations stayed at 50 000.** A plan to raise the job to 100 000 was dropped:
What-If recomputes at 50 000, and one accuracy everywhere beats a better number
in one panel. The gain would have been ±0.44% → ±0.31% for double the time —
√2 for 2×, the usual Monte Carlo trade. The margin of error is now read from the
stored `iterations` column rather than a constant, so a league projected under an
older setting cannot claim an accuracy it does not have.

**Last-300 was wrong in the job, and written four times in all.** The window is
300 units of EXPERIENCE — each match weighted by its own length — not 300
matches, which is what the job took: seven times too wide. The rule also lived
in `crossLeague.js` twice and in `allTimeRankings.js` again, each hand-copied.
They agreed only by accident, because every doubling league in the database is
7 points. All four now call `js/compute/last300.js`. It also clips the boundary
match, so the window is exactly 300 rather than "the first total ≥ 300".

**A retired player's matches are no longer points.** Retirement rewrites every
one of that player's fixtures as a technical loss, all stamped at the league's
opening midnight — December 2025 has 24 such rows. That is one administrative
act, not 24 moments, and left in it opened that league's chart with 24 points on
a single instant. They still appear in `getMatchesAsOf`, so the standings at
every point are unchanged; only the POINT is gone.

**INITIAL is now the first point on the chart.** The league before a ball was
thrown, where everyone's odds are their prior strength alone.

**`depth` went from 10 to the whole roster.** The Show control offers every place
up to the roster size, and a shorter row was clamped silently — "Top 15" drew the
Top 10 curve under a label saying 15.

**Three more inputs entered the fingerprint:** `match_length`, `league_type` and
`retired_players`. They were the one class of change that produced wrong stored
numbers looking perfectly fresh.

**Triggers now cover `matches`, `manual_overrides` and `leagues`.** Only
`match_history` had one. A schedule edit invalidates every point (the fixture
list is in the fingerprint seed) but queued nothing — so the page found the whole
league stale, computed it locally, and stayed that way forever. The `leagues`
trigger is scoped to the three columns that change a number; a title or prize
edit does not spend an hour of Monte Carlo.

**The job reuses points whose hash still matches.** Measured on a 300-match
league: 176 s → **0 s** when nothing changed, 51 s when one mid-season result was
edited. This is what makes a published result cost seconds instead of minutes.

---

## Deploy order

Each step is independently revertible.

### 0. Make `development` the default branch — if it is not already

Settings → General → Default branch.

A `schedule` always runs the workflow from the DEFAULT branch. Here that was
`main`: a stale snapshot from before the `shabi-israel/` folder move, with no
`scripts/` and no `js/compute/`, so a scheduled run would check it out and die on
the first import. The Run button is unaffected either way.

### 1. Apply the schema

Supabase Dashboard → SQL Editor → New query → the whole of
`sql/league_projections.sql` → Run. (Or `psql "$DATABASE_URL" -f …`.)

Safe to re-run. The teardown is at the bottom of that file.

Verify:

```sql
select count(*) from public.league_projections;   -- 0
select count(*) from public.projection_queue;     -- 0
select tgname from pg_trigger
 where tgname like 'projections_%' order by 1;    -- 11 triggers

-- The trigger coalesces: many rows in one statement queue ONE entry.
update public.match_history set round = round where league_id = '<a league>';
select league_id, reason from public.projection_queue;   -- exactly 1 row
delete from public.projection_queue;
```

### 2. Check the secrets

| Where | What |
|---|---|
| GitHub → Settings → Secrets → Actions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service role — RLS allows writes to no one else) |
| Supabase → Vault | `github_dispatch_pat` — for the immediate dispatch |

If `Sync External Source` runs today, all three already exist.

### 3. Commit and push to `development`

That also ships the JS: the site is served straight from the branch (Pages
"deploy from a branch"), so there is no build step.

**From this moment until step 4 finishes, the chart computes locally** — correct
numbers, slow page. Every stored fingerprint from before this change is invalid,
because the window, the point list, the depth and the seed all changed.

### 4. Backfill once, by hand, watching it

GitHub → Actions → **Project Title Race** → Run workflow → tick **all**.

- Measured: **176 s** for a 300-match league at 50 000 iterations. Cost grows
  with the SQUARE of the league's size (more points, and more left to simulate at
  each), so ~17 leagues came to ~39 minutes locally — call it **~58 on a runner**.
- `timeout-minutes` is **120**. Against the old 60 that was a coin toss, and a
  backfill that dies at minute 59 starts over. Minutes are unlimited on a public
  repository, so the ceiling costs nothing.
- Order is **newest league first**, by `issue_date` — not by `id`, which sorts
  April before August before December and is not a chronology at all.
- Each league is written the moment it finishes, so **the running season is live
  after ~3 minutes**, not after the hour. A league not yet reached simply behaves
  as it does today.

Step 4 cannot be reused from step 4 of a previous run: the reuse machinery keys
on hashes, and here none of them match. This is a genuine full recompute, once.

Then confirm what landed:

```sql
select league_id,
       jsonb_array_length(points) as points,
       array_length(roster, 1)    as players,
       iterations,
       pg_size_pretty(pg_column_size(points)::bigint) as stored,
       computed_at
from public.league_projections order by league_id;
```

`points` should be **played matches + 1** (the INITIAL point). December 2025 is
lower on purpose — the 24 retired-player rows are not points.

### 5. Nothing — it is already automatic

A result is published → `match_history` changes → the trigger queues the league
**and dispatches the workflow immediately**, over the same Vault-PAT + `pg_net`
path the External Source sync uses. Because unchanged points are reused, the
chart is current in **seconds**.

The dispatch is debounced: five corrections in a row queue one entry per league
and fire one run.

The hourly `schedule` is a safety net, not the mechanism — for the case where a
dispatch never lands (GitHub unreachable, the PAT rotated, `pg_net` disabled).
The queue survives all of those. A run with an empty queue costs ~10 seconds.

#### The queue's three timestamps

Conflating any two of them breaks it — the first version of this did exactly that:

| Column | Answers |
|---|---|
| `requested_at` | when the data changed |
| `dispatched_at` | when GitHub was last **asked** to run (debounce only) |
| `claimed_at` | when a job actually **took** the work |

A row is deleted only once the projection is safely written
(`complete_projection_work`), so a crashed run leaves its league outstanding
rather than silently dropping it. A claim older than 30 minutes is considered
abandoned and becomes claimable again.

---

## Verifying the cost on the live site

The point of this exercise is that the feature is *cheaper* than what it
replaces. That is a claim to check after deploying, in five places.

### A. Page load, and every page transition

1. DevTools → Network, filter `league_projections`.
2. Load `index.html`. **Expect zero requests.**
3. Open a league dashboard, Standings tab. **Still zero** — the section is on
   Predictor, and the query waits for it to be on screen.
4. Switch to Predictor. **Exactly one request.**
5. Switch tabs away and back, then to another league and back. **No repeat
   request** for a league already fetched in this page; one for a new league.

Note that the Title Race section now arrives EXPANDED. It shipped collapsed
because opening it meant ~90 Monte Carlo runs in the visitor's browser; that
reason is gone, and the section costs one query and no CPU.

### B. What the browser stores

```js
Object.keys(localStorage).forEach(k =>
  console.log(k, (localStorage.getItem(k).length / 1024).toFixed(1) + ' KB'));
```

**`shabi:bundle:v1` must not grow.** The projections are page memory only. If the
bundle grows, the data leaked into `get_site_bundle` and the ~5 MB localStorage
ceiling is now in play — where the failure mode is the cache silently refusing to
persist, turning every page load in the site into a cold load.

### C. CPU on the visitor's machine

DevTools → Performance, record while opening the Predictor tab.

- **Expect no long task from the projection**, and none from the Predictor table
  either — it now reads the newest stored point instead of simulating.
- Console must show **no** `[title race] N/301 points not yet projected`.

### D. The database

```sql
select pg_size_pretty(pg_total_relation_size('public.league_projections')) as projections,
       pg_size_pretty(pg_database_size(current_database()))                as whole_db;

-- Bloat: each recompute rewrites a league's row and leaves the old version
-- behind until autovacuum runs. Transient, but this is where to look if the
-- table ever seems large.
select relname, n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables where relname in ('league_projections','projection_queue');

-- The queue must drain. A permanently non-empty queue means dispatches are not
-- reaching the workflow.
select * from public.projection_queue where claimed_at is null;
```

Measured on a 301-point, 25-player league at full depth: **720 KB raw**. Stored
is smaller (TOAST compresses these integer rows ~2.2× on real data), and the
whole site is a few MB against the free tier's 500.

### E. Egress and Actions minutes

- **Egress**: the projection is fetched once per visitor who opens the chart.
  Supabase dashboard → Settings → Usage.
- **Actions**: ~176 s per league recomputed FROM SCRATCH; a normal incremental
  run is seconds. Public repositories have unlimited minutes.

### The number that says it all

Same league, same chart, before and after:

| | Before | After |
|---|---|---|
| Time until the chart has data | ~22 s of frozen CPU | **~1 s, one query** |
| CPU on the visitor's machine | 90–301 Monte Carlo projections | **none** |
| Accuracy | 5 000 iterations | **50 000** |
| Numbers stable between visitors | no (Monte Carlo is random) | **yes** |
| Predictor vs the chart's last column | two separate runs, differing | **identical** |

---

## Rolling back

- **The JS**: revert the commit. The chart returns to computing locally; the
  stored rows are simply ignored.
- **The workflow**: disable it in the Actions tab. Stored data stays and goes
  stale slowly, point by point, each falling back to local computation.
- **The schema**: the teardown block at the end of `sql/league_projections.sql`
  drops the triggers, functions and both tables. The site keeps working.

---

## What was found while building this

Defects the implementation exposed, all fixed, all worth remembering:

**1. "Arbitrary but stable" ordering was not stable.** `orderTimeline()` broke
ties — matches sharing one recorded instant — by arrival order. That is stable
only within one source: the browser reads `match_history` from the site bundle
(ordered by id), while the Node job reads it with no `ORDER BY`. Same rows, same
timestamps, **different sequence** — so the two disagreed about which match point
#1 was, every fingerprint differed, and all 89 precomputed points looked stale to
the page meant to read them. The tie-break is now the pairing, alphabetically:
derived from the data, so reproducible anywhere. A `#n` ordinal in a shared URL
depended on this too.

**2. An 80-second synchronous compute kills the database connection.** The first
write after projecting a league failed every time with a bare
`TypeError: fetch failed`: Node's event loop is blocked throughout, every pooled
socket goes stale, and the HTTP client reuses one the server closed long ago. A
retry establishes a fresh connection. Any long CPU-bound job that talks to a
network service afterwards has this bug waiting in it.

**3. The local database was a partial snapshot, and it read as a product bug.**
July 2026 locally had 111 played matches but only 89 `match_history` rows, so
every timeline-driven view was computed from a set 20% short — and the W/L column
added to the chart's detail panel is what finally made it visible, because a
countable number disagreed where a Monte Carlo percentage never could.
`scripts/clone-league-from-cloud.mjs` exists so a fixture can be a real,
complete league; it refuses to write anywhere but localhost, and reports whether
`played` and `match_history` agree before cloning.

**4. A stale fixture is indistinguishable from a defect until you count.** The
lesson from 3 generalised: before believing a number is wrong, check that the
data it came from is whole.
