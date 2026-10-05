# Retirement policy — how a retired player is recorded and shown

Binding standard. Any new page, table or query that touches a league with a
retired player must satisfy it. Verified by
`node scripts/audit-retirement-data.mjs` (census of how retirement is actually
recorded) and `node scripts/report-retirement-impact.mjs` (what a change costs).

---

## 1. Two concepts, deliberately separate

The single source of every problem in the old data is that one flag was doing
two jobs. It is split:

| Concept | Where it lives | What it decides |
|---|---|---|
| **The person retired** | `leagues.retired_players` (text[]) | **Display only.** The RETIRED tag, the grey row, the locked editor. |
| **The match is cancelled** | `manual_overrides.type = 'cancelled'` | **All logic.** What is counted, replayed, ranked, projected. |

No computation may branch on `retired_players`. Every consequence of retirement
reaches the compute layer as cancelled matches and nothing else.

Why this split and not the flag alone: `getUpdatePoints` used to skip any match
**by player name**, which silently dropped 24 legitimate update points from
July 2026's timeline, and put `retiredPlayers` inside `scheduleFingerprint` —
so editing the list invalidated every cached projection of the league. Once
cancellation is a property of the match, both disappear.

---

## 2. What is written where

Retiring player P in league L writes exactly one thing: a `cancelled` override
for **every fixture P appears in**, played or not.

```
matches              UNTOUCHED. The fixture row stays, with whatever the source
                     delivered. This is the memory of "what it was before", and
                     it is what `public.players_registry` derives a player's
                     existence from — see §5, rule "never delete the player".

manual_overrides     one row per fixture:  type = 'cancelled'
                     No score, no PR, no luck, no winner.

match_history        the pairing is REMOVED (the same path `not_played` takes in
                     computeMatchHistoryReconcile). A cancelled match changed
                     nothing, so it is not a moment in the league's history.
```

### One act in the admin

The two writes are stored apart, but the admin never performs them apart. Both
entry points — the **Retired** tick in Edit League ▸ Players, and the **Retire**
bar in the Round Editor — go through `js/admin/retirementStaging.js`, which
stages the flag and the `cancelled` overrides into the same publish. Un-ticking
Retired stages the inverse.

They used to be two independent edits joined by a reminder message. October
2026 UBC was published with the flag alone: the player wore `RETIRED` in D
while his 14 fixtures were still listed as matches to be played. Saving the
Players tab reconciles **every** retired player of the league, so a league left
in that state is completed by its next save.

The database enforces the same thing for every other path
(`sql/retirement_flag_sync.sql`): a trigger on `leagues.retired_players` writes
the `cancelled` overrides when a name is added and removes them when it leaves,
in the same transaction. The flag alone is therefore always enough — a
hand-run `UPDATE`, the sync job or a future client cannot produce half a
retirement. Computations still read only `cancelled` (§1); the trigger only
guarantees it is never missing.

### The invariant this preserves

```
match_history  ==  matches + manual_overrides
```

It holds in 16 of 17 leagues today; July 2026 breaks it in 25 pairings, which is
exactly the league whose retirement was typed straight into `match_history` with
no override behind it. Restoring the invariant is the migration's real goal.

### Why `cancelled` and not the existing `not_played`

`not_played` sets `played: false`, and four consumers read `!played` as
**"still to come"**:

| Consumer | What `not_played` would do |
|---|---|
| `dashboardPage.js` → `renderRemainingMatches` (B7) | list the retired player's fixtures as matches still to be played, forever |
| `dashboardPage.js` → `renderChampionshipPredictor` (B3) | simulate a full remaining season for him |
| `dashboardPage.js` → `renderWhatIfSimulator` (B4) | offer him as a fixture to stage |
| `drawMatchTable` (B6) | render the row as `unplayed` rather than `CANCELLED` |

"Cancelled" and "not played yet" are opposite states sharing one boolean, so
cancellation needs its own type. It behaves like `not_played` where that is
right (out of history, out of the timeline, out of the stats) and differs where
it is not: **a cancelled match is never a remaining match.**

---

## 3. Every surface, and what it shows

Table codes per `docs/TABLE-DESIGN.md`.

### The player himself

| Surface | Behaviour |
|---|---|
| **D — League Table** | A grey row **at the bottom**, below every active player. Name, flag, `RETIRED` tag. Every numeric column `—`. **No rank number.** He is not ranked because he has no results to rank. |
| **E — Player Match History** | His cancelled matches **are listed**, struck through and tagged `CANCELLED`. They contribute to no total, no summary row, no H2H. |
| **C2 — Match History (player-general)** | Same as E: the cancelled matches shown and tagged. |
| **C1 — Leagues (player-general)** | The league **row appears**, tagged `RETIRED`, with `—` in every stat column. It contributes 0 to every aggregate above it. |
| **A7 — Players directory** | He appears. He is a player of the system and is never removed from it. |
| **A1 — Completed Leagues** | **He counts in the league's player total** — a 25-player league stays a 25-player league. He was on the roster; cancelling his fixtures does not rewrite who took part. This needs no code: `loadLeagueMatches` derives `totalPlayers` from every `matches` row, cancelled ones included. |
| **Search** | Findable, like any player. |

### Where he does not appear at all

| Surface | Reason |
|---|---|
| **B3 — Championship Predictor** | He cannot win the league. Not a row, not a line, not in the roster. |
| **B4 — What If Simulator** | Not selectable, and no fixture of his can be staged. |
| **B5 — Played Matches** | He played none. |
| **B7a/b/c — Remaining Matches** | A cancelled match is not a remaining one. |
| **B1 — Prizes & Medals** | He has no standing to be awarded from — **including a medal already awarded in a league that has ended.** Retiring withdraws it, and the prize row is re-resolved for the players below him. |
| **Every chart** | B2's plotted set, Title Race, and every other league chart. |
| **`league_projections.roster`** | The stored projection must not carry him; the browser fallback must not either. |
| **A2, A3, A4, A5, A6** | Cross-league. The league he retired from contributes **nothing** for him — not a match, not a PR sample, not a record, not a leaderboard point. |
| **C3, C4, C5, C6** | H2H and record tables. A cancelled match is not evidence of anything. |

### Where the match appears, and only there

| Surface | Behaviour |
|---|---|
| **B6 — Rounds** | The fixture **is listed**, in its own round, tagged `CANCELLED`. Score `—`, PR `—`, Luck `—`, Date `—`. This is the league's schedule, and the schedule is what happened to it. |
| **F3 — Round Editor** | The fixture is shown and **locked** — not editable, not clickable. A cancelled match has no result to edit. |
| **F4 — View Overrides** | The `cancelled` overrides are listed like any other override, and are individually removable (that is the un-retire path — see §4). |

### His opponents

Each opponent simply has one fewer match: nothing is added to their record, and
every total, rate and average is computed over the matches that remain. In
December 2025, barak100 reads `23 games · 34.8% wins`.

Their **match list** does show the fixture, tagged `CANCELLED` — because E lists
every opponent whether or not the match happened, so the row exists regardless
and has to say something. `Not played` would be a lie (it will never be
played), and a blank row would leave the reader unable to account for the
missing game. The mark is the only honest option, and it explains the 23.

What they do NOT get is the retirement itself: no `RETIRED` badge, no grey
player row in D. That belongs to the person who retired.

---

## 4. Cases and responses

| # | Case | Response |
|---|---|---|
| 1 | Player never played a single match, then retired (`Emergi`, `Meir65`, April's two) | All fixtures cancelled. D shows a grey `RETIRED` row with no numbers. Nothing else changes anywhere. |
| 2 | Player played real matches, then retired (`Yehuda` Dec: 3, `fridlich` Jul: 1) | **Those real results are cancelled too.** The opponent loses that win. The `matches` row keeps the real score and PR; nothing on the site reads it. |
| 3 | Two retired players face each other (April: `Yehuda` v `Danny_kondrea`) | One fixture, one `cancelled` override. Counted once — April is 47 cancellations, not 48. |
| 4 | Retirement in a `regular` league (`Meir65`) | Identical. PR is not tracked there, so only wins/losses change. Never infer "technical" from `pr = 0` in a regular league: 21 of those rows are genuinely played games. |
| 5 | League still running when the player retires | The other players' **remaining** counts drop by one each (B7, B3, B4). Their fixture against him is gone, not pending. |
| 6 | The player is un-retired (came back, or flagged by mistake) | Delete the `cancelled` overrides and clear him from `retired_players`. The reconcile's revert rule restores each pairing from `matches` — which is exactly why `matches` is never edited — **and the recording dates come back with it** (see below). |
| 7 | An import re-delivers a cancelled match (F5 CSV/Excel) | The override still stands, so the pairing stays cancelled. The import must not silently resurrect it; if the source now carries a result, F5 flags a conflict rather than applying it. |
| 8 | The player plays other leagues, active or later | Completely unaffected. Retirement is **per league**. His other leagues count normally everywhere, cross-league tables included. |
| 9 | Every league of his ends in retirement | He still exists: `players_registry` derives appearances from `public.matches`, and those rows were never deleted. He is in A7 and findable, with no stats. |
| 10 | A historical/as-of view (B2) of a moment before he retired | He is still absent. Cancellation is not dated — a cancelled match never happened, at any point on the timeline. |
| 11 | An opponent has 1–2 technical losses of their own, scattered between real matches | **Not retirement.** An ordinary no-show. Leave it exactly as it is — `technical_win` stays the right record for a match someone missed and then kept playing. |
| 12 | A fixture was deleted outright rather than cancelled (December's 21) | The fixture is **restored** and given a `cancelled` override, and the orphan `match_history` row is removed. Without the fixture there is nothing for B6 or E to show, and the player loses 21 registry appearances. |

### Undo must give back the MOMENT, not just the result

Cancelling a played match deletes its `match_history` row, and that row held the
only record of *when* the result was entered. `matches` holds the result, so
undoing restores the score and the PR perfectly — and would date every restored
match to the moment of the undo, because the reconcile sees a pairing with no
stored row and treats it as new.

Measured on September 2026 before the fix, retiring a player with 16 played
matches and then un-retiring them:

```
RESULTS (score + PR)   16 / 16 identical
DATES   (updated_at)   16 / 16 CHANGED    1–5 Sep  →  the moment of the undo
Title Race X axis      not identical
history row count      identical
schedule fingerprint   identical
```

**Nothing announced it.** The count and the fingerprint both came back clean,
so the Title Race, the Historical view's as-of replay and every shared
`?asof=…#n` link were wrong with no signal at all.

The date is therefore parked on the fixture — `matches.history_updated_at`,
written by a `before delete` trigger on `match_history` — and taken back when
the pairing returns. A trigger rather than application code because three paths
delete history rows (the migration, the admin publish, the sync job) and one of
them would have been forgotten. After the fix the same run reports 78/78 dates
identical and an identical Title Race axis.

Re-check it with `node scripts/verify-retirement-cycle.mjs` (local Docker only;
it backs the league up and restores it whatever it finds).

### The line between case 11 and retirement

Not a count. The test is **zero real matches**, or real matches only before an
unbroken tail of technical losses. Measured on the live data, a "3 or more
technical losses" rule flagged four players and was wrong about three of them:

```
July 2026 Regular / Meir65      19 fixtures, 0 real, 19 technical   → retirement
December 2025    / barak100     23 fixtures, 20 real, technical at rounds 14/17/19,
                                 and he kept playing through round 25 → no-shows
June 2026        / Avi          21 real, technical at 3/11/21        → no-shows
June 2026        / ynonhagag    20 real, technical at 5/15/22        → no-shows
```

---

## 5. Standing rules

1. **Never delete the player, and never delete his fixtures.** `matches` is both
   the revert source and the definition of who exists
   (`public.players_registry` → `appearances`).
2. **`retired_players` never reaches a computation.** If a compute module needs
   to know, the answer is a cancelled match, not a name.
3. **Never infer cancellation from `pr = 0`.** 27 of the 174 `pr = 0` fixture
   rows are genuinely played matches. The signal is a `cancelled` override; the
   signal for *technical* is null PR in the merged view, per `stats.js`.
4. **A cancelled match is never a remaining match.** Every `!played` filter must
   exclude cancelled explicitly.
5. **`match_history == matches + manual_overrides`,** always. A history row with
   no override behind it is a defect, not a shortcut.

---

## 6. Migration of the existing data

Six players across five leagues. Measured impact: **0 rank changes, 0 champion
changes** — every cancellation removes a win from an opponent who also loses the
game from their denominator, and the order survives it.

| League | Player | Action |
|---|---|---|
| December 2025 | Yehuda | restore 21 deleted fixtures · convert 27 `technical_win` → `cancelled` · delete 21 orphan history rows · cancel his 3 real results |
| April 2026 | Yehuda, Danny_kondrea | convert 47 `technical_win` → `cancelled` |
| February 2026 | Emergi | convert 24 `technical_win` → `cancelled` |
| July 2026 | fridlich | **write the 24 missing overrides** as `cancelled` · remove the 24 hand-typed history rows · restores the `match_history == matches + overrides` invariant |
| July 2026 Regular | **Meir65** | **add to `retired_players`** (currently missing) · convert 19 `technical_win` → `cancelled` |

Untouched: the ~35 technical results belonging to players who did not retire.

### Re-verification after migration

```
node scripts/audit-retirement-data.mjs      # expect: 0 orphan history rows,
                                            #   no league diverging from
                                            #   matches + overrides
node scripts/report-retirement-impact.mjs   # expect: 0 matches left to cancel
node scripts/check-players-registry.mjs     # the roster definition still single
```

---

## 7. The mark

One visual language, D's, reused everywhere — a reader should recognise the
state without learning a second convention per table.

| Where | Mark |
|---|---|
| **D** | The player's row: grey, at the bottom, tagged `RETIRED`. |
| **B6, E, C2** | The match's row: the same grey treatment as D's row, tagged `CANCELLED`. |

The **styling** is shared; the **word** is not, and must not be. `RETIRED`
describes a person, `CANCELLED` describes a match, and the whole design rests on
those being two different statements (§1). A match row tagged `RETIRED` would
re-merge the two concepts in the one place a reader can see them.

Build it as one shared component rather than per-table CSS — the existing
`.retired-mark` / `.retired-badge` stems are the starting point, and this
project's standing rule is that a repeated treatment gets one module every call
site uses, never a second copy.
