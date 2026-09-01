/**
 * leagueDuration.js — how long a league runs, and therefore what its calendar
 * window is. ONE definition, shared by the dashboard's League Progress card and
 * by the admin forms that set it, so the bar a visitor sees and the setting an
 * admin picks can never drift apart.
 *
 * Three modes:
 *   'month'     — the CALENDAR MONTH the issue date falls in (the default, and
 *                 what every league created before this setting existed runs
 *                 on). The league runs from its issue date to the last day of
 *                 that month — so it is a month-long league only when it starts
 *                 on the 1st. Issued 21 Feb 2026 it runs 8 days (21→28 Feb);
 *                 issued 31 Aug it runs a single day. The window is the page of
 *                 the wall calendar, not a month counted off from the start.
 *   'days'      — a fixed number of days counted from the start day, inclusive.
 *   'unlimited' — no end at all. There is no window, so nothing that measures
 *                 elapsed time against it can be shown (see the League Progress
 *                 card, which then drops its Days bar entirely).
 *
 * Every window is INCLUSIVE at both ends and pinned to local midnight, so a
 * one-day league is one day long and its own first day already counts.
 */

export const DURATION_MODES = ['month', 'days', 'unlimited'];
export const DEFAULT_DURATION_MODE = 'month';

/** Menu wording — the one place these three options are named for a human. */
export const DURATION_MODE_LABELS = {
    month: 'Calendar month (to the last day)',
    days: 'Fixed number of days',
    unlimited: 'No time limit',
};

/**
 * The mode a league runs on. Anything unrecognised — including a params object
 * from a database that predates the columns — reads as 'month', which is both
 * the default and the mode every pre-existing league is on.
 */
export function durationMode(params) {
    const m = params && params.DurationMode;
    return DURATION_MODES.includes(m) ? m : DEFAULT_DURATION_MODE;
}

/** The day count for a 'days' league (null for any other mode). */
export function durationDays(params) {
    if (durationMode(params) !== 'days') return null;
    const n = parseInt(params && params.DurationDays, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

const _MS_PER_DAY = 86400000;

/** Whole days between two local-midnight dates. */
export function daysBetween(a, b) {
    return Math.round((b - a) / _MS_PER_DAY);
}

/** A league's start day at local midnight, or null when it has no issue date. */
export function leagueStartDate(params) {
    const iso = params && params.IssueDate;
    if (!iso) return null;
    const start = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(start)) return null;
    start.setHours(0, 0, 0, 0);
    return start;
}

/**
 * The league's calendar window as { start, end }, both at local midnight and
 * both inclusive — or null when there is no window to draw:
 *   • the league has no issue date (nothing to count from), or
 *   • it runs unlimited (nothing to count to).
 * Callers must treat null as "show no time-based reading", never as zero.
 */
export function leagueDateWindow(params) {
    const start = leagueStartDate(params);
    if (!start) return null;

    const mode = durationMode(params);
    if (mode === 'unlimited') return null;

    if (mode === 'days') {
        const n = durationDays(params);
        if (!n) return null;             // 'days' without a count is not a window
        const end = new Date(start);
        end.setDate(end.getDate() + n - 1);   // inclusive: day 1 IS the start day
        return { start, end };
    }

    // 'month' — to the last day of the month the league STARTED in. Day 0 of the
    // next month IS that last day. So the length depends on where in the month
    // the league opened: a league issued on the 1st gets the whole month, one
    // issued on the 31st gets that single day.
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { start, end };
}

/**
 * The league's own time zone. A league day starts and ends in Israel, for every
 * viewer, wherever they are: without this the SAME instant on a one-day league
 * read 10.49% in Los Angeles, 52.15% in Israel and 89.65% in Auckland, because
 * each browser measured the day against its own midnight. Same convention the
 * analytics dashboard already uses for its day and month boundaries.
 */
export const LEAGUE_TIME_ZONE = 'Asia/Jerusalem';

const _israelClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: LEAGUE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',   // not hour12:false — that can render midnight as "24"
});

/** An instant as Israel wall-clock numbers: { year, month, day, hour, … }. */
function israelWallClock(now) {
    const parts = {};
    for (const p of _israelClock.formatToParts(now)) {
        if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    return parts;
}

/**
 * How far into its window a league is RIGHT NOW, as { elapsed, total } in days
 * — or null when there is no window (see leagueDateWindow).
 *
 * `elapsed` is fractional, because the time of day is part of the answer: a
 * one-day league is 0.07% through at 00:01 and 99.93% through at 23:59, and
 * reporting both as "day 1 of 1 — 100%" would make its only bar useless. The
 * count is measured against the END of the last day (the midnight that closes
 * it), which is what makes the last day read as 100% only once it is over.
 *
 * Both halves are read off the ISRAEL clock — which calendar day it is there,
 * and how far through that day it is there — so the figure is a property of the
 * league, not of who happens to be looking. Whole days are counted as days and
 * only the current one is a fraction, so a clock change inside the window
 * shifts nothing.
 */
export function elapsedInWindow(params, now = new Date()) {
    const w = leagueDateWindow(params);
    if (!w) return null;
    const total = daysBetween(w.start, w.end) + 1;

    const il = israelWallClock(now);
    // Israel's calendar date, built as a local midnight so it can be differenced
    // against the window's own local-midnight dates — both sides are then plain
    // calendar days and the viewer's offset cancels out.
    const todayInIsrael = new Date(il.year, il.month - 1, il.day);
    todayInIsrael.setHours(0, 0, 0, 0);
    const fractionOfToday = (il.hour * 3600 + il.minute * 60 + il.second) / 86400;

    const raw = daysBetween(w.start, todayInIsrael) + fractionOfToday;
    return { elapsed: Math.min(Math.max(raw, 0), total), total };
}

/** Total days in the window, inclusive, or null when there is no window. */
export function durationTotalDays(params) {
    const w = leagueDateWindow(params);
    return w ? daysBetween(w.start, w.end) + 1 : null;
}

/**
 * Short human phrase for the setting itself — used by the admin's Pending and
 * Historical change descriptions so a duration change reads as words rather
 * than as a column value. Deliberately independent of whether the league has an
 * issue date: it describes the SETTING, not the resulting window.
 */
export function describeDuration(params) {
    const mode = durationMode(params);
    if (mode === 'unlimited') return 'No time limit';
    if (mode === 'days') {
        const n = durationDays(params);
        return n ? `${n} day${n === 1 ? '' : 's'}` : 'Fixed number of days';
    }
    return 'Calendar month';
}
