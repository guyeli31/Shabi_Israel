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
| `sql/league_projections.sql` | The table, the queue, the trigger on `match_history`, RLS + grants |
| `scripts/project-title-race.js` | The writer. Claims queued leagues, projects, upserts |
| `.github/workflows/project-title-race.yml` | Runs the writer — dispatch, schedule, or the Run button |
| `js/compute/topXTimeline.js` | The projection itself + the fingerprint. Shared by the job and the browser |
| `js/data/store.js` → `loadLeagueProjections()` | The read, deliberately outside the site bundle |
| `js/render/dashboardPage.js` → `renderTitleRace()` | Prefers stored points; computes only what is missing |

---

## Deploy order

Each step is independently revertible, and steps 1–3 change nothing a visitor
sees.

### 1. Apply the schema (additive; nothing reads it yet)

```bash
psql "$DATABASE_URL" -f sql/league_projections.sql
```

Safe to re-run. The teardown is at the bottom of that file.

Verify:

```sql
select count(*) from public.league_projections;   -- 0
select count(*) from public.projection_queue;     -- 0
-- The trigger coalesces: many rows in one statement must queue ONE entry.
update public.match_history set round = round where league_id = '<a league>';
select league_id, reason from public.projection_queue;   -- exactly 1 row
delete from public.projection_queue;
```

### 2. Add the GitHub secrets

The workflow needs the two the sync job already uses. If `Sync External Source`
runs today, both exist and nothing is needed:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — service role, because RLS allows writes to no
  one else.

### 3. Commit, push, and make the workflow reachable

```bash
git commit
git push origin development
```

That ships the JS: the site is served straight from the branch (Pages "deploy
from a branch"), so there is no build step — `.github/workflows/deploy-pages.yml`
is deliberately dormant and unrelated.

**The workflow needs one more thing, and it is a trap worth understanding.**
GitHub will only offer a workflow — the Run button, and any `schedule` — if the
file exists on the repository's **default branch**. Here that is `main`, which
is a stale snapshot from before the `shabi-israel/` folder move: 197 commits
behind, no `scripts/`, no `js/compute/`. So:

| Trigger | Needs the file on `main`? | Which code runs |
|---|---|---|
| `workflow_dispatch` (the Run button) | yes — the `.yml` only | the branch picked in the dialog |
| `schedule` | yes | **always the default branch** |

A scheduled run would therefore check out `main` and die on the first import.
The workflow pins `ref: development` in its checkout step to make both paths run
the same code regardless.

Two ways to make it reachable:

**a. Put just the workflow file on `main`.** One 80-line file, touching nothing
else there:

```bash
git checkout main
git checkout development -- .github/workflows/project-title-race.yml
git commit -m "ci: add Project Title Race workflow"
git push origin main
git checkout development
```

**b. Make `development` the default branch** — Settings → General → Default
branch. Then nothing needs `main`, now or for any future workflow. This is the
better fix: `main` is not a stable release here, it is a relic that misleads
anyone cloning the repo, sits under every PR as the base, and silently breaks
scheduled triggers. One caveat: check Settings → Pages afterwards, since the
default branch and the Pages source branch are separate settings.

**Order note:** nothing breaks whatever order these steps are taken in. Ship the
JS before the schema and `loadLeagueProjections()` gets a "relation does not
exist", returns null, and the chart computes locally exactly as it does today.
Ship it before the backfill and the same happens until the job has run. The only
cost of a wrong order is a temporarily slower chart, never a broken one.

### 4. Backfill once, by hand, watching it

GitHub → Actions → **Project Title Race** → Run workflow → tick **all**.

Expect ~80 s per league that has match history, and seconds for those without.
The log prints progress every 10 s and a per-league summary line.

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

### 5. Nothing — it is already automatic

A result is published → `match_history` changes → the trigger queues the league
**and dispatches this workflow immediately**, over the same Vault-PAT + `pg_net`
path the External Source sync already uses. The chart is current about ninety
seconds later.

The dispatch is debounced: five corrections published in a row queue one entry
per league and fire **one** workflow run, not five.

The hourly `schedule` in the workflow is a safety net, not the mechanism. It
exists for the case where a dispatch never lands — GitHub unreachable, the Vault
PAT rotated, `pg_net` disabled. The queue survives all of those, and the next
scheduled run drains it. A run with an empty queue costs ~10 seconds.

**This requires the `github_dispatch_pat` Vault secret**, which the sync job
already uses. If it is missing the dispatch logs a warning, the work stays
queued, and the hourly run picks it up — the feature degrades to "up to an hour
late" rather than breaking.

#### The queue's three timestamps

Worth knowing when debugging, because conflating any two of them breaks it — the
first version of this did exactly that:

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

The projections must never load on a page that does not show them, and never
enter the shared cache.

1. Open DevTools → Network, filter `league_projections`.
2. Load `index.html`. **Expect zero requests.**
3. Open a league dashboard, Standings tab. **Still zero** — the section is on
   Predictor, and the query waits for it to be on screen.
4. Switch to Predictor and scroll to Title Race. **Exactly one request**, ~85 KB
   for a 89-point league.
5. Switch tabs away and back, then to another league and back. **No repeat
   request** for a league already fetched in this page; **one** for a new league.

Fail conditions: a request on a page with no chart, more than one per league per
page, or any request at all before the section is visible.

### B. What the browser stores

```js
// DevTools console, after viewing a chart:
Object.keys(localStorage).forEach(k =>
  console.log(k, (localStorage.getItem(k).length / 1024).toFixed(1) + ' KB'));
```

**`shabi:bundle:v1` must not grow.** The projections are page memory only and
must appear in no storage key. If the bundle grows by ~85 KB per league, the
data leaked into `get_site_bundle` and the ~5 MB localStorage ceiling is now in
play — the failure mode there is the cache silently refusing to persist, turning
every page load in the site into a cold load.

### C. CPU on the visitor's machine

DevTools → Performance, record while opening the Predictor tab and scrolling to
the chart.

- **Expect: no long task from the projection.** The whole point is that nothing
  is computed. The Predictor's own table still runs its 50 000-iteration Monte
  Carlo — that is pre-existing and unrelated.
- Console must show **no** `[title race] N/89 points not yet projected` line. If
  it does, those points are missing or stale server-side — check the queue and
  the last workflow run.

### D. The database

```sql
-- Total footprint, and its share of the free tier's 500 MB.
select pg_size_pretty(pg_total_relation_size('public.league_projections')) as projections,
       pg_size_pretty(pg_database_size(current_database()))                as whole_db;

-- Bloat: each recompute rewrites a league's row and leaves the old version
-- behind until autovacuum runs. Transient, but this is where to look if the
-- table ever seems large.
select relname, n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables where relname in ('league_projections','projection_queue');

-- The queue must drain. A permanently non-empty queue means dispatches are not
-- reaching the workflow.
select * from public.projection_queue where dispatched_at is null;
```

Measured locally for one 89-point, 25-player league: **51 KB stored**
(110 KB raw, ×2.2), 120 KB including index and TOAST scaffolding. A full
300-match league extrapolates to ~170 KB stored.

### E. Egress and Actions minutes

- **Egress**: ~85 KB per visitor who opens the chart. At the site's ~300
  sessions/month, under 30 MB — well inside the 5 GB free allowance. Supabase
  dashboard → Settings → Usage.
- **Actions**: ~80 s per league recomputed. The 30-minute schedule with an empty
  queue costs ~10 s per run (~8 minutes/day). Public repositories have unlimited
  minutes; on a private repo this would be ~4 hours/month against the 2 000-minute
  free allowance — if that matters, drop the schedule to hourly or rely purely on
  dispatch.

### The number that says it all

Same league, same chart, before and after:

| | Before | After |
|---|---|---|
| Time until the chart has data | ~8 s (progressive) | **~1.1 s** |
| CPU on the visitor's machine | 89 Monte Carlo projections | **none** |
| Accuracy | 5 000 iterations | **50 000** |
| Numbers stable between visitors | no (Monte Carlo is random) | **yes** |

---

## Rolling back

Any step can be undone on its own:

- **The JS**: revert the commit. The chart returns to computing locally; the
  stored rows are simply ignored.
- **The workflow**: disable it in the Actions tab. Stored data stays; it goes
  stale slowly, and stale points fall back to local computation per point.
- **The schema**: the teardown block at the end of `sql/league_projections.sql`
  drops the triggers, functions and both tables. The site keeps working.

---

## What was found while building this

Two defects the implementation exposed, both fixed, both worth remembering:

**1. "Arbitrary but stable" ordering was not stable.** `orderTimeline()` broke
ties — matches sharing one recorded instant — by arrival order. That is stable
only within one source: the browser reads `match_history` from the site bundle
(ordered by id), while the Node job reads it with no `ORDER BY` and gets
whatever Postgres returns. Same rows, same timestamps, **different sequence** —
so the two disagreed about which match point #1 was, every fingerprint differed,
and all 89 precomputed points looked stale to the page meant to read them. The
tie-break is now the pairing, alphabetically: derived from the data, so
reproducible anywhere. A `#n` ordinal in a shared URL depended on this too, and
nobody would have noticed until two people compared links.

**2. An 80-second synchronous compute kills the database connection.** The first
write after projecting a league failed every time with a bare
`TypeError: fetch failed`: Node's event loop is blocked throughout, every pooled
socket to Supabase goes stale, and the HTTP client tries to reuse one the server
closed long ago. A retry establishes a fresh connection. Any long CPU-bound job
that talks to a network service afterwards has this bug waiting in it.
