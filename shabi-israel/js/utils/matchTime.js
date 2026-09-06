/**
 * matchTime.js — the ONE place that turns a stored moment into text.
 *
 * Two kinds of value reach the screen, and they must be rendered differently:
 *
 *   • A MOMENT — "recorded at 16:49". Real, absolute, and therefore relative to
 *     whoever is looking: 16:49 in Israel is 14:49 in London. Rendered in the
 *     viewer's own timezone.
 *   • A DAY — "1 Oct 2025", with no time behind it. The ten pre-Supabase
 *     leagues, and every league's opening date. It must read the SAME for every
 *     viewer, because there is no instant to convert.
 *
 * Pushing a day through a timezone conversion moves it. `2025-10-01T00:00:00Z`
 * renders "1 Oct 2025" in Israel and "30 Sept 2025, 20:00" in New York — the
 * league appears to have opened the month before. That is the bug this module
 * exists to make impossible, and it was live in two of the site's tables.
 *
 * ── HOW A VALUE SAYS WHICH IT IS ───────────────────────────────────────────
 * By its LENGTH. A date-only string ("2025-10-01", ≤ 10 chars) is a day; a full
 * ISO timestamp is a moment. This is not a new convention — `leagueDuration.js`
 * and `dashboardPage.js` already read `IssueDate` this way, because a `date`
 * column arrives from PostgREST as exactly that.
 *
 * The database says it explicitly (`match_history.has_exact_time`, see
 * sql/match_time_precision.sql) and `stampFromHistoryRow()` below is where the
 * boolean becomes the string form. Everything downstream — twenty-odd render
 * sites, the timeline, the presets — carries one field, `updatedAt`, exactly as
 * it always has. A second field threaded through every object shape would have
 * been forgotten in one of them, and a forgotten flag renders a wrong date
 * silently.
 *
 * ── WHY A DAY IS STORED AT UTC MIDNIGHT ────────────────────────────────────
 * So that both kinds can go through the same Intl formatter, the only
 * difference being `timeZone: 'UTC'` for a day. Same month names, same
 * separators, same widths — a table mixing the two cannot end up mixing
 * "1 Oct 2025" with "1 Oct, 2025" or "Sep" with "Sept".
 *
 * Sorting is unaffected: "2025-10-01" and "2025-10-01T00:00:00+00:00" are the
 * same instant to `new Date()`, so `orderTimeline()` and every already-shared
 * `?asof=` link keep meaning what they meant.
 */

const DAY_OPTS  = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_OPTS = { hour: '2-digit', minute: '2-digit' };
const AXIS_OPTS = { day: 'numeric', month: 'short' };

/**
 * True when the value names a DAY rather than a moment — no time behind it, so
 * it must be shown identically to every viewer.
 */
export function isDayOnly(value) {
    return typeof value === 'string' && value.trim().length <= 10;
}

/** Formatter options, pinned to UTC for a day so no conversion can occur. */
function opts(value, base) {
    return isDayOnly(value) ? { ...base, timeZone: 'UTC' } : base;
}

function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d;
}

/**
 * "1 Oct 2025, 00:00" — the full reading, date and clock.
 *
 * A day renders `00:00` rather than dropping the time: the column then has one
 * shape, and a blank where every other row shows a clock reads as missing data
 * rather than as "no time is known".
 */
export function formatMatchStamp(value, fallback = '—') {
    const d = toDate(value);
    if (!d) return fallback;
    return d.toLocaleDateString('en-GB', opts(value, DAY_OPTS))
        + ', ' + d.toLocaleTimeString('en-GB', opts(value, TIME_OPTS));
}

/** "1 Oct 2025" — the date alone, for places with no room for a clock. */
export function formatMatchDay(value, fallback = '—') {
    const d = toDate(value);
    if (!d) return fallback;
    return d.toLocaleDateString('en-GB', opts(value, DAY_OPTS));
}

/**
 * "9 Jul" — day and month, for a CHART AXIS.
 *
 * Every tick belongs to one league, so the year is identical on all of them and
 * the clock would double each label's width. Deliberately separate from
 * formatMatchDay, which labels things that stand on their own.
 */
export function formatMatchAxis(value, fallback = '—') {
    const d = toDate(value);
    if (!d) return fallback;
    return d.toLocaleDateString('en-GB', opts(value, AXIS_OPTS));
}

/**
 * A `match_history` row → the value every downstream consumer carries as
 * `updatedAt`. Called by BOTH mappers (bundleMapper.js for the site bundle,
 * supabaseLoader.js for the admin's granular read) so the two cannot drift.
 *
 * `has_exact_time === false` collapses the stored timestamp to its UTC date.
 * The strict `=== false` is deliberate: a database that predates the column
 * yields `undefined`, and those rows are treated as exact — the same opt-out
 * shape `InLeaderboard` and `DurationMode` use.
 */
export function stampFromHistoryRow(row) {
    const iso = row && row.updated_at;
    if (!iso) return iso;
    if (row.has_exact_time === false) {
        const d = toDate(iso);
        return d ? d.toISOString().slice(0, 10) : iso;
    }
    return iso;
}

/**
 * The current moment as the Round Editor's `datetime-local` input wants it:
 * "YYYY-MM-DDTHH:mm" in ISRAEL wall-clock, whatever the admin's own machine is
 * set to. The league is played on Israeli evenings and an admin abroad must not
 * stamp results with their local clock.
 *
 * Built from formatToParts, not from an offset arithmetic: the offset is +2 or
 * +3 depending on the date, and hand-rolling that is how a one-hour error hides
 * for six months until the clocks change.
 */
const IL_PARTS = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
});

export function israelNowForInput(now = new Date()) {
    const p = Object.fromEntries(IL_PARTS.formatToParts(now).map(x => [x.type, x.value]));
    // Intl can emit "24" for midnight in some engines; the input wants "00".
    const hour = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/**
 * A `datetime-local` value ("2026-09-06T21:14") → the instant it names in
 * ISRAEL, as an ISO string.
 *
 * `new Date("2026-09-06T21:14")` would read it in the BROWSER's timezone — the
 * admin abroad again. Resolving it against Asia/Jerusalem is what makes the
 * picker mean the same thing wherever it is used.
 */
export function israelInputToISO(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
    if (!m) return null;
    const [, y, mo, d, h, mi] = m.map(Number);
    // Guess UTC, then correct by however far that guess lands from the wanted
    // Israel wall-clock. One correction suffices: the error is the offset, and
    // the offset is constant across the minutes involved except at the DST
    // boundary itself, where a second pass settles it.
    let guess = Date.UTC(y, mo - 1, d, h, mi);
    for (let i = 0; i < 2; i++) {
        const p = Object.fromEntries(
            IL_PARTS.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
        const got = Date.UTC(+p.year, +p.month - 1, +p.day,
                             p.hour === '24' ? 0 : +p.hour, +p.minute);
        const want = Date.UTC(y, mo - 1, d, h, mi);
        if (got === want) break;
        guess += want - got;
    }
    return new Date(guess).toISOString();
}

/**
 * An ISO instant → the `datetime-local` value showing it in ISRAEL wall-clock.
 * The inverse of israelInputToISO, for loading a stored stamp back into the
 * picker.
 */
export function isoToIsraelInput(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const p = Object.fromEntries(IL_PARTS.formatToParts(d).map(x => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}
