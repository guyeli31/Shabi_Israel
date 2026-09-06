/**
 * analyticsAggregate.js — computes the analytics dashboard summary IN THE BROWSER
 * from the raw event rows (public.analytics_events_raw), so the audience filter
 * (self / other operators / visitors) can be changed with NO server round trip:
 * the raw rows are fetched once, and every chart/KPI is recomputed locally for any
 * subset of the three audiences.
 *
 * It is a faithful re-implementation of sql/analytics_poc.sql's analytics_summary,
 * key-for-key, and MUST stay in step with it — verified by
 * scripts/check-analytics-aggregate.mjs, which fetches both the RPC summary and
 * the raw rows on the same data and asserts computeSummary() matches. All
 * calendar/hour bucketing is Asia/Jerusalem, exactly like the SQL (never the
 * viewer's own zone), or "today" drifts for events near local midnight.
 */

// Israel-time day / month / hour for a UTC timestamp — the SQL's
// `at time zone 'Asia/Jerusalem'` done in JS. en-CA renders YYYY-MM-DD.
const IL_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
});
function ilParts(iso) {
    const p = Object.fromEntries(IL_FMT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return {
        day: `${p.year}-${p.month}-${p.day}`,     // matches ::date → "YYYY-MM-DD"
        month: `${p.year}-${p.month}-01`,         // date_trunc('month') → first of month
        hour: (+p.hour) % 24,                     // hour12:false can emit "24" at midnight
    };
}

const dwellBucket = (ms) =>
    ms < 10000 ? '<10s' : ms < 30000 ? '10-30' : ms < 60000 ? '30-60' : ms < 300000 ? '1-5m' : '5m+';

// Group rows by a column and count views + distinct Israel sessions, most-viewed
// first (top_pages/leagues/players/by_device/by_referrer). `withSessions=false`
// for by_region, whose SQL row carries only a view count.
function topBy(rows, field, limit, withSessions = true) {
    const m = new Map();
    for (const e of rows) {
        const k = e[field];
        if (k == null) continue;
        let o = m.get(k);
        if (!o) { o = { views: 0, s: new Set() }; m.set(k, o); }
        o.views++;
        if (e.session_id != null) o.s.add(e.session_id);
    }
    const arr = [...m.entries()].map(([k, o]) => {
        const row = { [field]: k, views: o.views };
        if (withSessions) row.sessions = o.s.size;
        return row;
    });
    // Views desc, then the key asc as a DETERMINISTIC tiebreak — the SQL leaves
    // ties arbitrary, but the client re-sorts on every filter change and a stable
    // order keeps rows from jittering when counts are equal.
    arr.sort((a, b) => b.views - a.views || String(a[field]).localeCompare(String(b[field])));
    return limit ? arr.slice(0, limit) : arr;
}

// views + distinct sessions grouped by an arbitrary composite key.
function bucketViews(rows, keyFn) {
    const m = new Map();
    for (const e of rows) {
        const k = keyFn(e);
        let o = m.get(k);
        if (!o) { o = { views: 0, s: new Set() }; m.set(k, o); }
        o.views++;
        if (e.session_id != null) o.s.add(e.session_id);
    }
    return m;
}

const isSelfLoop = (e) =>
    e.from_page === e.page
    && (e.from_league_id ?? null) === (e.league_id ?? null)
    && (e.from_player ?? null) === (e.player ?? null);

/** Chronologically first (or last) non-null value of `field` in a session's
 *  events — the SQL's `(array_agg(field order by created_at) filter (where …))[1]`
 *  pattern. `events` must already be sorted ascending by created_at. */
function firstNonNull(events, field) {
    for (const e of events) if (e[field] != null) return e[field];
    return null;
}

/** The predicate the audience checklist applies to a raw row. The three groups
 *  are disjoint and cover every row: `self` (this viewer's own operator events),
 *  `other` (any OTHER operator), `visitor` (no admin_user). Exported so the clicks
 *  log can filter its full corpus the same way computeSummary does. */
export function audienceKeep(filter) {
    const viewer = filter.viewer || null;
    return (e) => {
        if (e.admin_user == null) return !!filter.visitor;
        return e.admin_user === viewer ? !!filter.self : !!filter.other;
    };
}

/**
 * @param {Array<object>} events   raw rows from analytics_events_raw (any order)
 * @param {{self:boolean, other:boolean, visitor:boolean, viewer:?string}} filter
 * @returns an object shaped exactly like analytics_summary()'s jsonb result.
 */
export function computeSummary(events, filter) {
    const keep = audienceKeep(filter);

    // traffic_mix is computed over the WHOLE range (before the audience filter), so
    // it can always report how much of the range is operator traffic — the number
    // the filter is about. Independent of the checklist, like the SQL's evx.
    const mix = { israel: 0, global: 0, legacy: 0, internal: 0, provably_internal: 0, total: events.length };
    for (const e of events) {
        if (e.session_id != null) mix.israel++;
        if (e.region != null) mix.global++;
        if (e.session_id == null && e.region == null) mix.legacy++;
        if (e.admin_user != null) mix.internal++;
        if (e.page === 'admin' || (e.click_target && e.click_target.includes('(Admin Mode)'))) mix.provably_internal++;
    }

    const ev = events.filter(keep);
    const pv = ev.filter((e) => e.event_type === 'pageview');
    const dur = ev.filter((e) => e.event_type === 'duration');
    const clk = ev.filter((e) => e.event_type === 'click');

    // ── scalars ──
    const total_pageviews = pv.length;
    const sessSet = new Set();
    for (const e of ev) if (e.session_id != null) sessSet.add(e.session_id);
    const total_sessions = sessSet.size;
    const avg_dwell_ms = dur.length
        ? Math.round(dur.reduce((s, e) => s + (e.duration_ms || 0), 0) / dur.length) : 0;
    const bounce_pct = dur.length
        ? Math.round(100 * dur.filter((e) => (e.duration_ms || 0) < 10000).length / dur.length) : 0;
    let last_event_at = null;
    for (const e of ev) if (last_event_at == null || e.created_at > last_event_at) last_event_at = e.created_at;

    // ── breakdowns (pageviews) ──
    const top_pages = topBy(pv, 'page', 20);
    const top_leagues = topBy(pv, 'league_id', 20);
    const top_players = topBy(pv, 'player', 20);
    const by_device = topBy(pv, 'device_type', 0);
    const by_region = topBy(pv, 'region', 0, false);
    const by_referrer = topBy(pv, 'referrer_kind', 0);

    // ── timeseries + heatmaps (Israel time) ──
    const tsMap = bucketViews(pv, (e) => ilParts(e.created_at).day);
    const timeseries = [...tsMap.entries()]
        .map(([day, o]) => ({ day, views: o.views, sessions: o.s.size }))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    const hd = bucketViews(pv, (e) => { const p = ilParts(e.created_at); return `${p.day}|${p.hour}`; });
    const by_hour_day = [...hd.entries()]
        .map(([k, o]) => { const [bucket, hour] = k.split('|'); return { bucket, hour: +hour, views: o.views, sessions: o.s.size }; })
        .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : a.hour - b.hour));

    const hm = bucketViews(pv, (e) => { const p = ilParts(e.created_at); return `${p.month}|${p.hour}`; });
    const by_hour_month = [...hm.entries()]
        .map(([k, o]) => { const [bucket, hour] = k.split('|'); return { bucket, hour: +hour, views: o.views, sessions: o.s.size }; })
        .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : a.hour - b.hour));

    // ── dwell buckets (duration events, per page) ──
    const dwMap = new Map();
    for (const e of dur) {
        if (e.page == null) continue;
        const k = `${e.page}|${dwellBucket(e.duration_ms || 0)}`;
        dwMap.set(k, (dwMap.get(k) || 0) + 1);
    }
    const dwell_buckets = [...dwMap.entries()].map(([k, n]) => {
        const i = k.lastIndexOf('|');
        return { page: k.slice(0, i), bucket: k.slice(i + 1), n };
    });

    // ── transitions (aggregated A→B, pageviews only, self-loops excluded) ──
    const trMap = new Map();
    for (const e of pv) {
        if (e.from_page == null || e.page == null || isSelfLoop(e)) continue;
        const k = [e.from_page, e.from_league_id, e.from_player, e.page, e.league_id, e.player].map((x) => x ?? '').join(' ');
        let o = trMap.get(k);
        if (!o) { o = { from_page: e.from_page, from_league_id: e.from_league_id, from_player: e.from_player, to_page: e.page, to_league_id: e.league_id, to_player: e.player, n: 0, last_seen: e.created_at }; trMap.set(k, o); }
        o.n++;
        if (e.created_at > o.last_seen) o.last_seen = e.created_at;
    }
    const transitions = [...trMap.entries()]
        .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])) // n desc, key asc (stable tiebreak)
        .slice(0, 30).map(([, o]) => o);

    // ── transitions_log (per-occurrence; pageviews + nav; running_count) ──
    // Qualifying rows: a pageview, or a nav click (nav_type set); with both sides
    // present; a pageview self-loop dropped, a nav self-loop kept (Refresh).
    const tlRows = ev.filter((e) =>
        (e.event_type === 'pageview' || (e.event_type === 'click' && e.nav_type != null))
        && e.from_page != null && e.page != null
        && (e.nav_type != null || !isSelfLoop(e)));
    // running_count = cumulative count of the exact (from,to,nav_type) pair up to
    // and including this row, in time order — so partition, sort asc, number.
    const partitions = new Map();
    for (const e of tlRows) {
        const k = [e.from_page, e.from_league_id, e.from_player, e.page, e.league_id, e.player, e.nav_type].map((x) => x ?? '').join(' ');
        (partitions.get(k) || partitions.set(k, []).get(k)).push(e);
    }
    const rc = new Map(); // row → its running count
    for (const rows of partitions.values()) {
        rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        rows.forEach((e, i) => rc.set(e, i + 1));
    }
    const transitions_log = [...tlRows]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, 500)
        .map((e) => ({
            created_at: e.created_at, from_page: e.from_page, from_league_id: e.from_league_id, from_player: e.from_player,
            to_page: e.page, to_league_id: e.league_id, to_player: e.player,
            device_type: e.device_type, nav_type: e.nav_type, running_count: rc.get(e),
        }));

    // ── clicks_log (every click/interaction, newest first) ──
    const clicks_log = [...clk]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, 500)
        .map((e) => ({
            created_at: e.created_at, page: e.page, league_id: e.league_id, player: e.player, tab: e.tab,
            click_target: e.click_target, device_type: e.device_type, session_id: e.session_id, region: e.region,
            admin_user: e.admin_user, moved_banner: e.moved_banner,
            nav_type: e.nav_type, from_page: e.from_page, from_league_id: e.from_league_id, from_player: e.from_player,
        }));

    // ── sessions (Israel route only: session_id present) ──
    const bySession = new Map();
    for (const e of ev) {
        if (e.session_id == null) continue;
        (bySession.get(e.session_id) || bySession.set(e.session_id, []).get(e.session_id)).push(e);
    }
    const sessions = [...bySession.entries()].map(([session_id, list]) => {
        list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        const started_at = list[0].created_at;
        const ended_at = list[list.length - 1].created_at;
        const isPv = (e) => e.event_type === 'pageview';
        // entry_/exit_ are the FIRST/LAST pageview's own values — INCLUDING null
        // (the SQL takes array_agg(...)[1] over pageviews, not the first non-null),
        // so a landing pageview with no player leaves entry_player null. Only
        // device/admin/referrer take the first NON-null (their SQL has that filter).
        const firstPv = list.find(isPv) || null;
        let lastPv = null;
        for (let i = list.length - 1; i >= 0; i--) if (isPv(list[i])) { lastPv = list[i]; break; }
        return {
            session_id, started_at, ended_at,
            duration_ms: Math.round(new Date(ended_at).getTime() - new Date(started_at).getTime()),
            event_count: list.length,
            pageview_count: list.filter(isPv).length,
            click_count: list.filter((e) => e.event_type === 'click').length,
            device_type: firstNonNull(list, 'device_type'),
            admin_user: firstNonNull(list, 'admin_user'),
            entry_referrer: firstNonNull(list, 'referrer_kind'),
            entry_page: firstPv ? firstPv.page : null,
            entry_player: firstPv ? firstPv.player : null,
            entry_league_id: firstPv ? firstPv.league_id : null,
            entry_tab: firstPv ? firstPv.tab : null,
            entry_moved_banner: firstPv ? firstPv.moved_banner : null,
            exit_page: lastPv ? lastPv.page : null,
            exit_player: lastPv ? lastPv.player : null,
            timeline: list.slice(0, 500).map((e) => ({
                created_at: e.created_at, event_type: e.event_type, page: e.page, league_id: e.league_id,
                player: e.player, tab: e.tab, moved_banner: e.moved_banner, click_target: e.click_target,
                duration_ms: e.duration_ms, nav_type: e.nav_type, from_page: e.from_page,
                from_league_id: e.from_league_id, from_player: e.from_player,
            })),
        };
    }).sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0)).slice(0, 200);

    return {
        traffic_mix: mix,
        total_pageviews, total_sessions, avg_dwell_ms, bounce_pct, last_event_at,
        top_pages, top_leagues, top_players, by_device, by_region, by_referrer,
        timeseries, by_hour_day, by_hour_month, dwell_buckets,
        transitions, transitions_log, clicks_log, sessions,
    };
}
