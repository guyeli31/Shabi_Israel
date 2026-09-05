# 05 — Projection Cache: the title race, computed once

**Status: IMPLEMENTED on local Docker; not applied to cloud production.**
See [`05b-projection-rollout.md`](05b-projection-rollout.md) for the deploy
order and the live cost-verification plan.

Measured after implementation, on the real data rather than the synthetic rows
used while designing: a league's stored points compress **×2.2**, not the ×19.5
the fabricated data suggested — the fake values repeated far more than real
projections do. One 89-point, 25-player league stores **51 KB** (110 KB raw),
120 KB with index and TOAST scaffolding; a full 300-match league extrapolates to
~170 KB. Every figure below that came from synthetic rows is optimistic by
roughly that factor; the conclusion is unchanged, since even the corrected
number is a fraction of a percent of the quota.

---

## 1. The problem, in one measurement

The Title Race chart asks, for every update point in a league: *what were each
player's odds of finishing in the top X, as things stood then?* That answer is
not stored anywhere — it is a Monte Carlo projection over the matches still
unplayed at that moment, the same engine the Predictor already runs for today.

Measured on July 2026 (25 players, 89 update points, Chrome, local Docker):

| Iterations | Per point | Whole league | Deviation vs 50 000 |
|---|---|---|---|
| 50 000 (Predictor default) | 1106 ms | **98 s** | — |
| 10 000 | 195 ms | 17.4 s | 1.11 % |
| 5 000 | 90 ms | 8.0 s | 0.93 % |
| 2 000 | 35 ms | 3.1 s | 1.53 % |
| 1 000 | 18 ms | 1.6 s | 2.83 % |

Every visitor currently pays that cost, and pays it again on every visit, to
reach an answer that is identical for all of them.

**And it is not quite identical, which is the real defect.** Monte Carlo is
random: two people looking at the same historical point see slightly different
percentages, and a refresh gives a third. A number about the past should be a
fact that can be quoted, not a draw.

## 2. The shift

Compute each point **once, server-side, when the data changes**, store the
result, and let the page read it.

The timeline is effectively append-only: a new match does not change the
projection at any earlier point — the schedule has not moved, and what had been
played before that point is unchanged. So the steady-state cost is **one
projection per new match**, not one per point per visitor. Because it runs once
in the background, it runs at the full 50 000 iterations: **faster for the
visitor and more accurate than anything achievable in the browser.**

---

## 3. What the table holds

```sql
-- ONE ROW PER LEAGUE. The chart reads a whole league or nothing, so that is the
-- unit stored. See "Why one row per league" below — this was reversed once,
-- after a measurement turned out to be counting transient garbage.
create table public.league_projections (
  league_id  text   primary key references public.leagues(id) on delete cascade,
  -- Position i means the same player for the life of the league. APPEND-ONLY.
  roster     text[] not null,
  -- One entry per update point, oldest first:
  --   { at, ord, hash, ranks: [[P(top 1) … P(top 10)] × 1000, per roster position] }
  -- `hash` is per point (§ 6) so staleness stays exact even though the row is one.
  points     jsonb  not null,
  iterations int    not null,
  computed_at timestamptz not null default now()
);
```

### Why one row per league

Three shapes were measured against each other on realistic data (300 points, 25
players, depth 10), each after `VACUUM` — because the first comparison was run
on un-vacuumed tables and got the answer backwards:

| Shape | Rows | Size |
|---|---|---|
| row per (point, player) | 7 500 | 616 KB |
| row per point | 300 | 144 KB |
| **row per league** | **1** | **56 KB** |

The packed form compresses 308 KB of raw values to ~16 KB, because the
repetition across 300 points is exactly what pglz exploits — repetition the
per-row forms cannot see, since each row is compressed alone.

**The cost that made this look wrong at first.** Postgres never updates in
place: appending a match rewrites the whole value and abandons the previous
version, so a 300-match season leaves 2 688 KB of dead versions behind — 18× the
per-point table. That figure is *transient*: `VACUUM` reclaims it to 56 KB, and
autovacuum runs on its own. The write itself measures 4 ms per match against
0.03 ms, and the job doing it is free background CPU. Neither is a cost anyone
pays.

**What the packed form must carry to be equivalent.** Staleness has to stay
per-point (§ 6, § 8), so each entry in `points` holds its own `hash`. The client
compares point by point exactly as it would with per-point rows: an edit at match
30 of 250 leaves points 1–29 live and flags only 30–250. A single league-level
hash would flag the whole chart, including the parts that are correct, and that
is the one thing this shape may not give up.

**What is genuinely lost.** Partial writes: recomputing points 30–250 rewrites
all 250. At 4 ms and free CPU, that is a number without a consequence.

**Why the full rank distribution and not a percentage.** Every "top X" question
is a prefix sum over a player's array, so the Show control switches between
top‑1, top‑3 and top‑10 with no recomputation and no extra rows. Storing one
percentage per X would multiply the table by the player count; storing a single
X would make the control a lie.

**Why ×1000 integers.** A probability needs three significant digits at most —
the chart renders one decimal. Integers keep the jsonb compact and compress well
in TOAST, because the values repeat heavily across players and points.

### Depth: ten places stored, medals offered

Only the first ten places are stored, and the array holds the **cumulative**
top‑X values directly (`[P(top 1), P(top 2), …]`), so a read is an index rather
than a sum. "What are my odds of finishing 14th of 25" is a question nobody
asks; the Historical table (B2) already restricts itself to the medal positions
for the same reason.

**But the depth is NOT the medal count, and that separation is deliberate.**
Medal places are admin-editable — `getMedalPlaces()` reads the league's prize
configuration, extra prize rows included (every league today is 1+1+4 = 6; May
2026 already carries an extra Gold row). If the stored depth tracked that
number, **adding one prize row would invalidate every point in the league** and
force a full recompute, making prize configuration an input to the projection
cache. There is no reason to create that coupling.

So: a fixed depth of 10 covers any realistic prize layout, and the Show control
offers up to the league's own medal limit. Storage decided once; presentation
decided per league.

**And the depth is very nearly free — storage is NOT linear in it, and below a
point it runs backwards.** Measured, one point row, 25 players:

| Depth stored | Raw text | Stored | Ratio |
|---|---|---|---|
| top 1 | 491 B | **824 B** | ×1.68 — *inflates* |
| top 3 | 741 B | **1 424 B** | ×1.92 — *inflates* |
| top 6 | 1 116 B | 201 B | ×0.18 |
| **top 10** | 1 591 B | **227 B** | ×0.14 |
| top 15 | 2 241 B | 262 B | ×0.12 |
| top 25 | 3 441 B | 375 B | ×0.11 |

Two effects meet in the middle of that range. `jsonb` is a binary form with a
header per key and per element, so when the arrays are tiny the headers outweigh
the data and the value ends up **larger than the text it came from**. And
Postgres only compresses a value once it passes a size threshold — above it,
these repetitive numeric arrays compress 7–9×.

The practical consequence: from depth 6 upward, **4× the data costs 1.9× the
space**. Over a full 300-match league, trimming 10 → 6 saves ~8 KB; extending
10 → 25 costs ~44 KB. Storing *only* the medal places, or only top 1, would cost
**more** than storing ten.

Depth is therefore chosen for meaning, not for bytes. This table exists so the
"let's trim it to save space" question is answered once, with measurements,
rather than re-argued from intuition later.

### Zeros stay. Removing them makes the table BIGGER.

Most values are 0 — a mid-table player's chance of first place is zero at every
point of the season. The obvious saving is to drop them. Measured on realistic
data (300 points, 25 players, depth 10: five contenders, eight mid, twelve who
never contend):

| Variant | Raw text | **Stored** | Full league |
|---|---|---|---|
| **A — dense, zeros kept** | 1 026 B | **199 B** | **104 KB** |
| B — an all-zero player becomes `[]` | 690 B | 1 768 B | 632 KB |
| C — zeros written as `null` | 1 431 B | 201 B | 104 KB |
| D — zeros dropped from the arrays | 630 B | 1 384 B | 512 KB |

**The smallest raw form is the largest on disk, by 7–9×.** B and D shrink the
text by a third and are punished for it: the value falls *below* Postgres'
compression threshold, so it is stored raw — and raw `jsonb` is bigger than the
text it came from. A run of zeros, meanwhile, is the single most compressible
thing that can be in the array: pglz collapses it to nearly nothing. The zeros
were already free. C confirms the mechanism from the other side — swapping 0 for
`null` makes the value *longer*, stays above the threshold, and lands within
2 bytes of the dense form.

**The rule this table lives by: stay above the compression threshold.** Three
separate design questions — depth, keys, zeros — have now been decided by it,
each time against the intuition that less input means less storage. Anything
that shrinks the value before Postgres sees it risks pushing it under the line
where compression stops, which costs far more than the bytes it saved.

Realistic data also measures *better* than the random data used elsewhere in
this document: **199 B per point, 104 KB per full league.** The figures below are
the conservative ones.

### A correction worth recording

This section originally argued the opposite — that packing a league into one row
should be refused, on the strength of a table showing it 18× larger. That figure
was measured **before vacuum**: it was counting dead row versions awaiting
cleanup, not stored data. After `VACUUM` the packed form is 56 KB against 144 KB
— 2.6× *smaller*, not 18× larger.

Three objections broke the original argument, and all three were right:

1. *Garbage gets cleaned.* Autovacuum reclaims it; the bloat is a window between
   runs, not a footprint.
2. *The visitor is never shown a wrong number either way.* The difference was
   how much of the chart greys out during a rare, minutes-long window — a
   preference presented as a correctness matter. And it is recoverable anyway,
   by keeping per-point hashes inside the packed row.
3. *Nobody pays for the rewrite.* 4 ms per match, on free background CPU.

Recorded rather than quietly edited, because the mistake is instructive: a
measurement can be technically accurate and still answer the wrong question. The
number was real; "table size" simply does not mean "storage used" on a table
that has just been updated 300 times.

### Shape: positional arrays, roster stored once

`ranks` holds one array per player **by position**, not an object keyed by name.
The roster sits once in the league's own row, not repeated per point. Measured
per point (full league, 25 players, depth 10): keyed by name 226 B, positional
118 B — the names cost as much as the data.

**The invariant this requires: the roster is APPEND-ONLY.** Position *i* must
mean the same player forever, or every stored point silently re-points to the
wrong people. A player joining mid-league is appended; nobody is reordered and
nobody is removed. An older point simply holds fewer entries than the current
roster, which reads correctly as "they were not in that projection". This is the
one piece of bookkeeping the compact shape costs, and the writer must enforce it
rather than assume it.

### Does the instance carry it? (disk, memory, egress)

Postgres keeps tables on **disk** and pages into RAM what is read — nothing
forces this table into memory. Against the instance's actual settings:

| | Measured |
|---|---|
| `shared_buffers` (Postgres' page cache) | 128 MB |
| `work_mem` (one query's allowance) | 4 MB |
| The whole table, every league complete | ~670 KB — **0.5 % of the buffer pool** |
| One query (one league) | 56 KB on disk, ~310 KB expanded — **within `work_mem`** |

**Egress**, which is the tighter of the two quotas in practice. Live analytics
show ~300 sessions a month (August 2026: 303 sessions / 1 477 pageviews).
Assuming the extreme — every session opens the chart and pulls a *complete*
league:

```
300 sessions × ~310 KB ≈ 93 MB/month ≈ 1.9 % of the 5 GB free-tier allowance
```

| | Free | Pro |
|---|---|---|
| Database size | 500 MB (35 MB used today; +0.7 MB here → 7 %) | 8 GB |
| Egress | 5 GB/month (≈1 % used here) | 250 GB |

Comfortable on the free tier, on all three measures.

### The memory constraint this design DOES avoid

There is one store in this project where even this would have mattered: the
`localStorage` bundle cache (`shabi:bundle:v1`), which every page loads and
which lives under a hard ~5 MB browser quota. Putting projections in
`get_site_bundle` would have spent a fifth of that quota on data serving one
section of one league — and the failure mode of exceeding it is the cache
silently refusing to persist, i.e. every page load becoming a cold load.

That, more than load time, is why § 3 keeps this out of the bundle. The separate
query lands ~310 KB in page memory only, for the league being viewed, and is gone
on refresh.

Storage is not a constraint on this design, at any scale this project will
reach. It is recorded here so that stays a measured fact rather than an
assumption.

**Not in `get_site_bundle`.** The bundle loads on *every* page of the site; this
data serves one section of one league. Adding it would trade a chart's cost for
a site-wide one. It gets its own loader in `store.js`, called when the section
becomes visible — the same deferral the Predictor already uses.

---

## 4. Who computes it

Not Postgres. 50 000 simulations of a full season is not a query; in plpgsql it
would take hours rather than a second. The work runs in Node.

**`scripts/sync-source.js`, on GitHub Actions** — the job that already owns
`match_history`. It already imports modules straight from `shabi-israel/js/`
(lines 13–18), and `js/compute/topXTimeline.js` is pure (no DOM, no fetch), so
it runs there unchanged. The 6-hour Actions ceiling is far above the worst case
(§ 7).

Rejected alternatives:

- **Supabase Edge Function** — starts instantly, but has a hard wall-clock
  limit that a full-league recompute (minutes) would exceed. Chunking it is
  complexity bought for nothing while the Actions path already exists.
- **The admin's browser at publish time** — this is the 98-second freeze moved
  from a random visitor onto the league admin.

---

## 5. What triggers it

The chain already exists in this repo for the External Source sync
(`sql/external_source_scheduler.sql`: pg_cron + pg_net → GitHub
`workflow_dispatch` → `sync-source.js` → writes back):

```
a result is published / synced
        ↓
match_history changes                       ← the reconcile already runs here
        ↓
trigger fires one workflow_dispatch          ← existing pg_net + Vault PAT path
        ↓
sync-source.js projects the missing points at 50 000 iterations
        ↓
league_projections is written
        ↓
the visitor's page reads it. No computation.
```

**The projection write lives in the same function as the `match_history`
reconcile.** Not "also called from there" — in it. Two stores describing the
same fact, separated by any distance in the code, drift; that is precisely the
bug class this repo has already paid for (see `js/data/matchHistoryReconcile.js`
and the flag-merge and override-revert defects it documents). The distance
between "history changed" and "projections changed" must be zero lines.

**Coalescing.** An admin publishing five corrections must not queue five full
recomputes. A dispatch arriving while one is in flight replaces the queued run
rather than joining it — one pending run per league, at most.

---

## 6. The invalidation rule, and the fingerprint

### The rule

A stored projection for point *P* is valid iff the set of played matches as of
*P*, and the schedule it was projected over, are unchanged.

- **A new match appended** → every earlier point stays valid. One new row set.
- **An old result edited** (score corrected, technical result applied) → the
  edit re-dates that match, so it moves in the timeline. Every point from its
  new position onward is invalid; everything before it stands.
- **A match marked `not_played`** → it leaves the timeline entirely (see
  `buildMatchTimeline`), so its own point disappears and every later point is
  invalid.
- **The schedule changes** (a fixture added or removed) → *all* points are
  invalid: the remaining-match set is an input at every one of them.

### The fingerprint

Staleness must be a property of the **data**, not an inference about whether a
job happens to be running. A flag someone forgets to set, or a job that fails
silently, both end with a wrong number displayed as if it were right.

So each row stores `inputs_hash`: a hash over the ordered list of
`(playerA, playerB, scoreA, scoreB)` played as of that point, plus the pairing
list of the schedule. The client already holds the timeline and the schedule, so
**it can compute the same hash itself** and compare. No round trip, no trust in
the writer's bookkeeping.

That gives the read path an exact answer per point: *this row describes the data
I am looking at*, or *it does not*.

---

## 7. Cost

| Event | Points recomputed | Server time |
|---|---|---|
| One new match | 1 | ~1.1 s |
| Edit at the last round | a few | seconds |
| Edit at round 3 of 30 | ~90 % of the league | ~1.5 min (July 2026 scale) |
| Schedule change / first build | all | 98 s per 89 points |

The worst case is a background job, not a user-facing wait. It is also rare: an
admin correcting an old result is an exception, which is exactly why it must be
*correct* rather than fast.

---

## 8. The three states a visitor can see

Per point, decided by the fingerprint — never by a global spinner:

| State | When | What the chart shows |
|---|---|---|
| **Ready** | stored row, hash matches | The value. Normal line, normal dot. |
| **Missing** | no stored row (a brand-new match; a league the job has not reached) | The line stops short. The panel says the point is not computed yet. No interpolation across the gap — a straight segment over missing data is a claim nobody made. |
| **Recomputing** | stored row, hash does **not** match | The point is drawn as stale (muted / dashed) and labelled `recomputing`. The old number is never shown as current. |

The third row is the edge case raised in review: *an admin corrects an early
round while the league is at a late one, and a visitor lands before the job
finishes.* Rare, and it must still not lie.

---

## 9. What happens to the client-side path

It stays, as a fallback only. When a league has no stored rows at all — right
after deploy, or a league the job has not yet touched — the page computes
locally exactly as it does today (Web Worker, 5 000 iterations, progressive
fill) and says so. The feature must not depend on a background job having
succeeded.

`js/compute/topXTimeline.js` is unchanged by this plan: it becomes the job's
engine as well as the fallback's. `js/compute/topXTimelineWorker.js` is used
only by the fallback.

---

## 10. Rollout

Each step is separately revertible and separately approved.

| Step | What | Risk |
|---|---|---|
| 1 | `sql/league_projections.sql` — table, index, grants. Additive; nothing reads it yet. | none |
| 2 | Projection writer in `sync-source.js`, inside the reconcile. Run manually against local Docker; verify hashes and values against a browser-side run. | none (writes a table nothing reads) |
| 3 | Read path: `store.js` loader + the chart preferring stored rows, with the three states. Fallback still present. | low — fallback covers every gap |
| 4 | Trigger + coalescing on `match_history`. | medium — touches an existing table's write path |
| 5 | Backfill every existing league once, off-hours. | none (idempotent) |

**Verification before step 3 ships:** for one league, every stored point must
match a fresh 50 000-iteration browser run within its own margin of error, and
every fingerprint must round-trip (client-computed hash equals stored hash) for
all points. A mismatch anywhere means the input definition is wrong, and that is
cheaper to find with nothing reading the table.

---

## 11. Open questions

1. **Does the trigger fire per league or per write?** A publish touching three
   leagues should dispatch three coalesced runs, not one run that recomputes
   everything.
2. **Retention.** Projections for an archived league are dead weight; do they
   get dropped, or kept because the chart still renders for old leagues? (Kept,
   presumably — the section's whole point is history.)
3. **Iterations as data.** `iterations` is stored per row so a future raise
   (100 000?) can be rolled out point-by-point without invalidating everything.
   Should a lower-iteration row count as stale once the standard rises, or as
   valid-but-coarse?
