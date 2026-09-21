/**
 * matchHistory.js — Per-match timeline logic (pure).
 *
 * A history record has the shape:
 *   { playerA, playerB, scoreA, scoreB, prA, prB, luckA, luckB,
 *     round, updatedAt, source }   // source: "csv" | "manual"
 *
 * The history is the source of truth for the "as of date" view. For the live
 * (current) view, history records override matching match rows (if both exist).
 *
 * Loading lives in js/data/{store,supabaseLoader}.js — the `match_history`
 * table. This module holds only the merge/replay logic that runs on top.
 *
 * `updatedAt` is either a full ISO instant or a date-only string, and the two
 * mean different things — see js/utils/matchTime.js. Every comparison here goes
 * through `new Date(...).getTime()`, which reads both identically, so the
 * distinction affects display only and never the replay or the ordering.
 */

import { formatMatchStamp, formatMatchDay, formatMatchAxis } from '../utils/matchTime.js';

export function matchKey(playerA, playerB) {
    return [playerA, playerB].sort().join('|');
}

/**
 * Merge a history record list onto CSV-parsed matches.
 * For each history record, replace the corresponding CSV match (by playerA+playerB
 * unordered key). History matches not present in CSV are appended.
 * Returns a new array; does not mutate inputs.
 */
export function mergeHistoryIntoMatches(csvMatches, historyMatches) {
    if (!historyMatches || historyMatches.length === 0) return csvMatches;
    const result = [...csvMatches];
    const indexByKey = new Map();
    result.forEach((m, i) => indexByKey.set(matchKey(m.playerA, m.playerB), i));

    for (const h of historyMatches) {
        const key = matchKey(h.playerA, h.playerB);
        const prior = indexByKey.has(key) ? result[indexByKey.get(key)] : null;
        const merged = {
            playerA: h.playerA, playerB: h.playerB,
            scoreA: h.scoreA, scoreB: h.scoreB,
            prA: h.prA, prB: h.prB,
            luckA: h.luckA, luckB: h.luckB,
            round: h.round,
            updatedAt: h.updatedAt,
            source: h.source
        };
        // History carries the VALUES, but it can't say how they were derived —
        // `source: 'manual'` covers a plain result override as much as a technical
        // one. applyOverrides() runs before this and already marked the match, so
        // carry its markers across. Dropping them silently un-technicals the match:
        // every `if (m._technical) continue` guard stops firing, and the presets'
        // `luckSelf - luckOpp` turns null - null into a real-looking 0.00.
        if (prior) {
            if (prior._overridden) merged._overridden = true;
            if (prior._technical) merged._technical = true;
            if (prior._draw) merged._draw = true;
        }
        if (indexByKey.has(key)) {
            result[indexByKey.get(key)] = merged;
        } else {
            result.push(merged);
            indexByKey.set(key, result.length - 1);
        }
    }
    return result;
}

/**
 * The league BEFORE anything was played — the oldest point on every league's
 * timeline, and the only one guaranteed to exist. A history built from
 * match_history alone can't express it: its oldest update point is the first
 * batch of results, which for a league imported in one go IS the whole league.
 * So "empty" is a sentinel, not a stored row — there is nothing to store.
 */
export const INITIAL_POINT = '__initial__';

/**
 * THE timeline — the one played-match list every time-aware view is built from:
 * the Played Matches table (B5), the update points offered by the Historical (B2)
 * and What-If (B4) pickers, the as-of replay behind both, and the live merge.
 *
 * It is `match_history` minus the pairings a `not_played` override says never
 * happened. Those must vanish from the PAST as well as the present: an admin who
 * marks a match not-played is saying it was never a result, so the update point
 * it once contributed has to go with it — otherwise the picker offers a point
 * built on a match the site refuses to show anywhere else. The reconcile deletes
 * such rows on the next publish/sync ([matchHistoryReconcile.js]), but a league
 * read between the override and that publish still carries them, and until this
 * filter existed the stale row also resurrected the match through the live merge.
 *
 * @param {{matches:object[]}|object[]} history  the loaded history (or its rows)
 * @param {object[]} overrides                   the league's manual_overrides
 * @param {object[]} [allMatches]                the authoritative with-unplayed
 *   match set (overrides already applied), when the caller has it. A pairing it
 *   marks `played: false` is dropped too — the same guard B5 applies to its own
 *   rows, so the points offered and the matches listed can never disagree.
 */
export function buildMatchTimeline(history, overrides, allMatches) {
    const rows = Array.isArray(history) ? history : (history && history.matches) || [];
    const dropped = new Set();
    for (const o of overrides || []) {
        if (o.type === 'not_played') dropped.add(matchKey(o.playerA, o.playerB));
    }
    for (const m of allMatches || []) {
        if (!m.played) dropped.add(matchKey(m.playerA, m.playerB));
    }
    const kept = dropped.size === 0
        ? rows
        : rows.filter(m => !dropped.has(matchKey(m.playerA, m.playerB)));

    // Stamp each row with its FIXTURE POSITION, the tie-break orderTimeline uses
    // for rows sharing an instant. Copies, never mutation: `history` comes from
    // the memoised store and is one shared array handed to every caller.
    const fixtures = buildFixtureIndex(allMatches);
    if (!fixtures) return kept.slice();
    return kept.map(m => ({ ...m, _fixture: fixtures.get(matchKey(m.playerA, m.playerB)) }));
}

/**
 * pairing → its position in the league's fixture list, i.e. the row it occupies
 * in the Rounds table (B6): round ascending, and within a round the order the
 * fixtures were created.
 *
 * THE POSITION IS DERIVED FROM `id`, NOT FROM ARRAY ORDER, and that distinction
 * is the whole point of this function. The Rounds table renders
 * `allMatchesIncUnplayed.filter(m => m.round === current)` with no sort of its
 * own, so what it shows is whatever order the array arrived in — which for the
 * browser is the site bundle's `order by m.league_id, m.round, m.id`. The Node
 * projection job reads the same table with NO order by at all and gets whatever
 * Postgres hands back. Ordering the timeline by array position would therefore
 * give the browser one sequence and the job another, and the per-point
 * fingerprints would never match again (see orderTimeline's note). Ranking by
 * the stored `id` gives both the same answer from the same rows, in any order.
 *
 * Returns null when the caller passed no fixtures, or fixtures without ids —
 * the sort then falls back to round and the player names.
 */
function buildFixtureIndex(allMatches) {
    if (!allMatches || allMatches.length === 0) return null;
    if (allMatches.some(m => m.id == null)) return null;
    const index = new Map();
    [...allMatches]
        .sort((x, y) => (Number(x.round) - Number(y.round)) || (Number(x.id) - Number(y.id)))
        .forEach((m, i) => index.set(matchKey(m.playerA, m.playerB), i));
    return index;
}

/**
 * Filter the timeline to matches updated on or before the given date (ISO string
 * or Date). Returns matches in the format expected by stats/rankings (no _ flags
 * by default). INITIAL_POINT resolves to no matches at all.
 *
 * Takes the timeline (see buildMatchTimeline), NOT the raw history object — the
 * as-of view and the update-point list have to be built from the same set, or the
 * picker offers points the table can't reproduce.
 */
export function getMatchesAsOf(timeline, pointValue) {
    if (pointValue === INITIAL_POINT) return [];
    if (!pointValue) return timeline.slice();
    const { stamp, ordinal } = parsePointValue(pointValue);
    const cutoff = new Date(stamp).getTime();
    const dated = orderTimeline(timeline);
    const before = dated.filter(m => new Date(m.updatedAt).getTime() < cutoff);
    const group = dated.filter(m => new Date(m.updatedAt).getTime() === cutoff);
    // No ordinal (a plain timestamp — including every link shared before points
    // became per-match) means the whole instant: every match recorded then.
    return before.concat(ordinal == null ? group : group.slice(0, ordinal));
}

/**
 * The timeline in chronological order, dateless rows dropped.
 *
 * THE SORT KEY, in full:   (instant, fixture position, round, player A, player B)
 *
 * The instant is the only part that is real evidence. The rest exists because
 * eleven leagues stamp EVERY match with one instant — the pre-Supabase leagues
 * were reconstructed from CSV long after they were played, and a whole league
 * imported in one go carries one clock reading for all 300 results. Those rows
 * still have to be put in SOME order, and the order is what the chart's X axis,
 * the picker's row sequence and the `#n` ordinal in a shared URL all mean.
 *
 * THE FIXTURE POSITION IS THE ANSWER, because it is the order the league itself
 * already publishes: the Rounds table (B6) lists round 1 before round 2, and
 * within round 1 lists its fixtures in a fixed order. A rewind list that
 * disagreed with that table would be describing a different season. So the
 * timeline replays the fixtures in exactly the order the league shows them —
 * see buildFixtureIndex, which derives that position from `matches.id` rather
 * than from the order an array happened to arrive in.
 *
 * `round` and the names follow only as fallbacks, for a row with no fixture at
 * all: a technical result entered against a pairing nobody ever played has no
 * `matches` row to take a position from (December 2025's retirement rows are the
 * worked example). Names are compared LOWERCASED — the rosters mix "Avi" with
 * "ys", and raw code-unit order puts every capital ahead of every lowercase
 * letter, which is not what alphabetical means to a reader — with the raw
 * strings as a final tie-break so two names differing only in case still order
 * deterministically. Deliberately NOT `localeCompare`: its result depends on the
 * locale and the ICU build, so the browser and the Node job could disagree.
 *
 * ── WHY EVERY TIE-BREAK MUST BE DERIVED FROM THE DATA ──────────────────────
 * The tie-break used to be arrival order, which is stable only within one
 * source. The browser reads match_history from the site bundle (ordered by id);
 * a Node job reads it with no ORDER BY and gets whatever Postgres returns. Same
 * rows, same timestamps, different sequence — so the two disagreed about which
 * match point #1 was, the per-point fingerprints computed from that sequence
 * never matched, and every precomputed projection looked stale to the page that
 * was meant to read it.
 *
 * Deriving the order from the data itself makes it reproducible anywhere, by
 * anyone, forever — which is what a fingerprint, a `#n` ordinal in a URL, and an
 * as-of replay all quietly depend on. Any future tie-break has to clear the same
 * bar: a random draw, a locale-sensitive collation or a row id would each look
 * fine locally and break the projection cache in production.
 */
function cmpName(x, y) {
    const lx = x.toLowerCase(), ly = y.toLowerCase();
    if (lx !== ly) return lx < ly ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
}

function orderTimeline(timeline) {
    return timeline
        .filter(m => m.updatedAt)
        .map(m => ({
            m,
            t: new Date(m.updatedAt).getTime(),
            // No fixture and no round sort LAST within their instant, rather than
            // colliding with position 0 / round 0 as a bare `Number(null)` would.
            f: m._fixture == null ? Number.POSITIVE_INFINITY : m._fixture,
            r: m.round == null ? Number.POSITIVE_INFINITY : Number(m.round),
            a: m.playerA || '',
            b: m.playerB || '',
        }))
        .sort((x, y) => (x.t - y.t) || (x.f - y.f) || (x.r - y.r)
            || cmpName(x.a, y.a) || cmpName(x.b, y.b))
        .map(x => x.m);
}

/** `"<iso>"` or `"<iso>#<n>"` → the instant plus which match within it. */
function parsePointValue(value) {
    const s = String(value);
    const hash = s.lastIndexOf('#');
    if (hash === -1) return { stamp: s, ordinal: null };
    const n = Number(s.slice(hash + 1));
    if (!Number.isInteger(n) || n < 1) return { stamp: s, ordinal: null };
    return { stamp: s.slice(0, hash), ordinal: n };
}

/**
 * Sorted list of unique update dates (ISO date strings, day precision), descending.
 */
export function getUpdateDates(history) {
    const days = new Set();
    for (const m of history.matches) {
        if (!m.updatedAt) continue;
        days.add(m.updatedAt.slice(0, 10));
    }
    return [...days].sort().reverse();
}

/**
 * ONE UPDATE POINT PER PLAYED MATCH, newest first.
 *
 * The invariant this exists to hold: **the number of points equals the number of
 * played matches that are not a retired player's** — plus the synthetic "Initial"
 * the caller adds. Every match the league actually played is a place you can
 * rewind to, and nothing else is. Points used to be grouped by MINUTE, which
 * quietly broke that: a league imported in one go stamps every match with the
 * same instant, so 89 matches offered 3 points. Grouping is gone — a point is a
 * match.
 *
 * Two matches can still share an instant, so a timestamp alone no longer
 * identifies a point. `value` is the timestamp, plus `#n` (1-based, in the
 * arbitrary-but-stable order of orderTimeline) when several matches share it —
 * "the state after the nth match of that instant". A bare timestamp still means
 * the whole instant, so links shared before this change keep working.
 *
 * Each point also carries the `match` it is, so the picker can render it as the
 * match rather than as a bare clock reading. `label` is the plain-text form
 * (also what a filter matches on); `dateLabel` is just the date part.
 *
 * Built from the timeline (see buildMatchTimeline), so a match marked not-played
 * contributes no point. An override's date is the one the admin authored
 * (`edited_at`, stored as local midnight by the Round Editor's date field) — so
 * an edited match moves, in B5 and in this list together.
 *
 * ── RETIREMENT NEEDS NO RULE HERE, AND USED TO HAVE A WRONG ONE ────────────
 * A retired player's fixtures are CANCELLED (`manual_overrides.type =
 * 'cancelled'`), and a cancelled pairing leaves `match_history` entirely in the
 * reconcile — so it never reaches this function at all. The retirement is
 * absent from the timeline as a consequence of the data, not of a filter.
 *
 * What stood here instead was a skip by PLAYER NAME, taking `retiredPlayers`
 * from league_params, and it was wrong in both directions:
 *
 *   - It dropped REAL results. July 2026's fridlich retired after playing, and
 *     24 of that league's update points vanished from the Title Race and the
 *     Historical view — matches that genuinely moved the table.
 *   - It put `retiredPlayers` inside `scheduleFingerprint`, so editing the
 *     retirement list invalidated every cached projection of the league.
 *
 * PREREQUISITE: this depends on the retirement migration having run
 * (sql/retirement_policy.sql). Until a league's retirement is expressed as
 * `cancelled` overrides rather than `technical_win` rows, its technical results
 * ARE still in match_history and will each become a point.
 * See docs/RETIREMENT-POLICY.md §2 and §6.
 *
 * Any other override still gets its point, dated by the admin's `edited_at` — a
 * single technical result is a decision about one match, and a match someone
 * simply failed to turn up for is still a moment in the season.
 *
 * @param {object[]} timeline
 * @returns {{value:string,label:string,dateLabel:string,match:object}[]}
 */
export function getUpdatePoints(timeline) {
    const dated = orderTimeline(timeline);
    const countByStamp = new Map();
    for (const m of dated) countByStamp.set(m.updatedAt, (countByStamp.get(m.updatedAt) || 0) + 1);

    const seen = new Map();
    const points = [];
    for (const m of dated) {
        const n = (seen.get(m.updatedAt) || 0) + 1;
        seen.set(m.updatedAt, n);
        // Date AND time, always. Matches that share an instant (a league imported
        // in one go) therefore share a clock reading too — that is the truth about
        // them: one moment of recording, arbitrary order within it. The row still
        // tells them apart, because it names the match.
        const dateLabel = formatUpdatePoint(m.updatedAt);
        points.push({
            value: countByStamp.get(m.updatedAt) > 1 ? `${m.updatedAt}#${n}` : m.updatedAt,
            dateLabel,
            label: `${dateLabel} — ${describeResult(m)}`,
            match: m,
        });
    }
    return points.reverse();
}

/** "Moriarty beats UziMutsafy" / "ys draws Izhako" — plain text, no markup. */
export function describeResult(m) {
    const { winner, loser, drawn } = resultSides(m);
    return drawn ? `${winner} draws ${loser}` : `${winner} beats ${loser}`;
}

/**
 * Which side won. A technical draw carries `_draw`; otherwise the higher score
 * wins, and equal scores with no `_draw` flag (data we can't read as a result)
 * fall back to the recorded A/B order rather than inventing a winner.
 */
export function resultSides(m) {
    const drawn = !!m._draw || (m.scoreA != null && m.scoreA === m.scoreB);
    const aWon = Number(m.scoreA) > Number(m.scoreB);
    return {
        winner: aWon || drawn ? m.playerA : m.playerB,
        loser: aWon || drawn ? m.playerB : m.playerA,
        drawn,
    };
}

/**
 * The three labels this module hands out are thin re-exports of the site-wide
 * formatters in js/utils/matchTime.js. They stay named after the timeline
 * because that is what their callers are reading, but the rendering rule —
 * a MOMENT follows the viewer's timezone, a DAY follows nobody's — lives in one
 * place for the whole site, not once per page.
 */

/** "9 Jul 2026, 17:39" — date + time for an update-point label. */
export function formatUpdatePoint(ts) {
    return formatMatchStamp(ts);
}

/** "9 Jul 2026" — the date alone. */
export function formatUpdateDay(ts) {
    return formatMatchDay(ts);
}

/**
 * "9 Jul" — the date without the year, for a CHART AXIS.
 *
 * Every tick on such an axis belongs to one league, so the year is identical on
 * all of them: it costs width on every label and distinguishes none of them.
 * Deliberately separate from formatUpdateDay, which labels things that stand on
 * their own (a picker row, a header) and there the year is not derivable from
 * context.
 */
export function formatAxisDay(ts) {
    return formatMatchAxis(ts);
}
