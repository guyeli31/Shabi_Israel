/**
 * analytics.js — first-party, IP-free analytics beacon with a
 * privacy-differentiated, timezone-routed identity model.
 *
 * No IP is ever read, sent, or stored — region routing is derived purely
 * client-side from the browser's own timezone. Two routes:
 *
 *   • Israel (timezone === 'Asia/Jerusalem') — a per-visit random session id
 *     is kept in sessionStorage so a visit's click sequence can be
 *     reconstructed. sessionStorage survives page-to-page navigation within
 *     the tab but is wiped the moment the tab closes, so there is no
 *     cross-visit linkage and no returning-visitor identity.
 *   • Everyone else — fully zero-correlation: independent events, NO id,
 *     nothing written to the device for analytics (the legal equivalent of
 *     an anonymous server access log). Carries only a COARSE continent tag
 *     (e.g. "Europe") for regional traffic measurement — never the full
 *     city-level IANA string, which with device_type could act as an
 *     incidental fingerprint for a small audience.
 *
 * Beyond identity, only bucketed/categorical fields are collected (coarse
 * device type, referrer category, dwell-time bucket) — never raw referrer
 * URLs or exact screen/viewport pixel dimensions.
 *
 * admin_user is the one named field, and it names the site OPERATOR, never a
 * visitor — see currentAdminUser() below. It rides both routes and is null for
 * every ordinary visitor.
 *
 * Transport: fetch(..., {keepalive:true}) only — works across the whole
 * lifecycle including unload, and can set the headers Supabase needs.
 * navigator.sendBeacon was tried for the unload path but is NOT usable here:
 * sendBeacon always sends with credentials included, and Supabase's REST
 * endpoint answers CORS preflight with a wildcard Access-Control-Allow-Origin,
 * which browsers refuse to pair with credentialed requests — every beacon
 * was silently dropped before reaching the network.
 *
 * No-config = silent no-op (kept as a guard even though config is populated
 * today, in case a fork/local checkout doesn't have it wired up).
 */

// resolvedUrl/resolvedAnonKey (not the raw SUPABASE_URL/ANON_KEY constants)
// so local/dev testing writes to the local Docker project, matching every
// other data path in the app — never polluting production analytics.
import { resolvedUrl as SUPABASE_URL, resolvedAnonKey as SUPABASE_ANON_KEY } from './data/supabaseClient.js';
// Statically imported despite auth.js's top-level await (it resolves
// getSession() before any importer's body runs): this module ALREADY blocks on
// supabaseClient.js, which fetches supabase-js from esm.sh over the network and
// runs createClient(). getSession() on top of that is a localStorage read with
// no network at all for anyone who isn't a logged-in admin — nothing measurable
// against a chain the beacon already pays for. The lazy alternative (a dynamic
// import populating a module-level var) would leave admin_user null on the
// FIRST pageview of every load, which is the event most worth attributing.
import { isLoggedIn, getUsername } from './admin/auth.js';
// TEMPORARY — delete these imports together with js/render/movedNotice.js after
// 2026-08-27. It hangs here only because analytics.js is the one module every
// shareable page already loads, so the "we moved" banner needs no per-page wiring.
import { mountMovedNotice, movedBannerActive } from './render/movedNotice.js';

// TEMPORARY (with movedNotice.js). Resolved ONCE, up front, before the pageview
// below: true while the "we moved" banner is on screen this page. Stamped onto
// every event via baseFields so the dashboard marks each such page with 📦 —
// one-to-one with "the banner was shown". Computing it here also runs the flag's
// one-time strip of ?moved before the pageview reads the URL. null (not false) so
// the column stays empty for the overwhelming majority of rows.
const MOVED_BANNER = movedBannerActive() || null;

const PAGE_BY_FILENAME = {
    'index.html': 'landing',
    'league.html': 'league',
    'league_table.html': 'league_table',
    'player.html': 'player',
    'player_league.html': 'player_league',
    'admin.html': 'admin',
};

const ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/analytics_events` : null;

// ── Automated-traffic opt-out ──────────────────────────────────────────────
//
// Performance harnesses drive a REAL browser against the REAL site — that is
// the only way to measure what a visitor actually experiences — so every page
// they open fires a real beacon. On 2026-08-18 a "before" measurement run put
// **151 pageviews across 103 sessions into one hour** of production analytics,
// because each measurement uses a fresh browser profile and so registers as its
// own visit. The numbers were not wrong; they were simply not people.
//
// So automation declares itself, and this file goes silent for it. Two ways in,
// for the two kinds of automation:
//
//   • `localStorage['shabi:no-analytics'] = '1'` — what a Playwright script
//     sets via context.addInitScript(), before the first navigation. Nothing a
//     real browser ever runs, so a visitor cannot acquire it by accident.
//
//   • `?notrack` on any URL — for hand-driven browser automation that cannot
//     inject a script before the first page load. It writes the localStorage
//     key, so it survives the navigation that follows: without that, the flag
//     would cover exactly one pageview and every click after it would be
//     recorded, which is the trap a per-URL override always sets.
//
// `?track` clears it again. A console line is printed while suppression is
// active, deliberately: a site that has silently stopped counting itself is a
// worse failure than one that counts too much, and the message is the only
// thing that would ever reveal it.
const NO_TRACK_KEY = 'shabi:no-analytics';
const SUPPRESSED = (() => {
    try {
        const params = new URLSearchParams(location.search);
        if (params.has('track')) localStorage.removeItem(NO_TRACK_KEY);
        if (params.has('notrack')) localStorage.setItem(NO_TRACK_KEY, '1');
        const off = localStorage.getItem(NO_TRACK_KEY) === '1';
        if (off) console.info('[analytics] suppressed for this browser profile (%s). Add ?track to a URL to re-enable.', NO_TRACK_KEY);
        return off;
    } catch {
        return false; // private mode / storage blocked — behave normally
    }
})();

// ── Privacy-differentiated identity (see sql/analytics_poc.sql header) ─────
// Timezone is the ONLY signal used to route — never IP (no IP is read, sent,
// or stored anywhere in this file).
const TIMEZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
    catch { return ''; }
})();
const IS_LOCAL = TIMEZONE === 'Asia/Jerusalem';

// Coarse continent only ("Europe", "America", "Asia", …). "UTC"/"GMT"/"Etc/*"
// or any string without a recognised region prefix collapses to "Other", so
// no city-level granularity ever leaves the browser.
const KNOWN_REGIONS = ['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'];
function coarseRegion(tz) {
    if (!tz) return 'Other';
    const region = tz.split('/')[0];
    return KNOWN_REGIONS.includes(region) ? region : 'Other';
}

// crypto.randomUUID on https/localhost (GitHub Pages is https); Math.random
// fallback keeps id generation from ever throwing on an odd runtime.
function newId() {
    try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// A per-visit random id kept in sessionStorage (wiped on tab close, so no
// cross-visit linkage). Created LAZILY — only when a session is actually sent,
// i.e. for an Israel visitor OR a signed-in user (see send()). An anonymous
// non-Israel visitor never calls this, so NOTHING is written to their device,
// preserving the zero-correlation half of the two-route model. Private-mode
// fallback (sessionStorage throws) keeps a per-page id in memory — tracking
// never breaks, it just can't span pages.
function ensureSessionId() {
    try {
        let sid = sessionStorage.getItem('shabi_sid');
        if (!sid) { sid = newId(); sessionStorage.setItem('shabi_sid', sid); }
        return sid;
    } catch {
        return newId();
    }
}

// The site OPERATOR's own username, or null for every ordinary visitor. This is
// deliberately outside the timezone routing above: it identifies whoever is
// logged into Admin, not the audience, so it rides both routes (an admin
// browsing from abroad is on the global route and should still be labelled).
//
// Read fresh per event rather than captured once: an admin can log in or out
// mid-visit, and auth.js keeps its cache current via onAuthStateChange.
//
// Only the local part of the address is kept — it separates admins from each
// other and from visitors just as well as a full address, while keeping an
// addressable identifier out of a table whose whole premise (see header) is
// bucketed/categorical data. getUsername() returns '' (NOT null) when logged
// out, and an empty-string admin_user would read as "some admin" in the
// dashboard and hash to a real colour, so it must normalise to null.
function currentAdminUser() {
    if (!isLoggedIn()) return null;
    return getUsername().split('@')[0] || null;
}

function pageFromPathname(pathname) {
    const filename = pathname.split('/').pop() || 'index.html';
    const type = PAGE_BY_FILENAME[filename] || null;
    // The domain hub (golan.me.uk/) and the app landing (golan.me.uk/shabi-israel/)
    // are BOTH index.html — same filename, different page — told apart only by
    // depth: the hub sits at the domain root, the app one folder down. Count the
    // path's folder segments (ignoring the file itself); 0 → hub, ≥1 → app landing.
    // Depth-based, not folder-name-coupled, so a future app-folder rename can't
    // silently reclassify the hub.
    if (type === 'landing') {
        const depth = pathname.split('/').filter((s) => s && !s.includes('.')).length;
        return depth === 0 ? 'hub' : 'landing';
    }
    return type;
}

// The in-page view/tab, derived from the URL so the log can say WHICH section of
// a page the event was on — never just the page type. Three shapes, one per
// routing style the site uses (see the URL contract in CLAUDE.md):
//   • site pages    → the ?tab= slug; null for the DEFAULT tab, which the contract
//                     omits from the URL (so null reads as "the page's default").
//   • league_table  → 'historical' when ?asof= is present (that page has no tabs,
//                     so the historical view is the only non-default state).
//   • admin.html    → the top hash segment (hash routing): '#sync' → 'sync',
//                     '#leagues/edit/<id>/overrides' → 'leagues'; null for the
//                     empty hash (the default Leagues view).
function currentTab(page, params) {
    if (page === 'admin') return (location.hash || '').replace(/^#/, '').split('/')[0] || null;
    if (page === 'league_table') return params.has('asof') ? 'historical' : null;
    return params.get('tab') || null;
}

function detectDevice() {
    const ua = navigator.userAgent;
    let deviceType = 'desktop';
    if (/Mobi|Android(?!.*Tablet)|iPhone/i.test(ua)) deviceType = 'mobile';
    else if (/Tablet|iPad/i.test(ua)) deviceType = 'tablet';

    let os = 'other';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'other';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

    return { device_type: deviceType, os, browser };
}

// Only a coarse category is kept — never the raw referrer URL. The one
// exception is league/player query params when the referrer is internal:
// those are the same non-identifying content identifiers (public league
// names, player nicknames) already stored for the CURRENT page — reading
// them off the referrer's own query string is symmetric, not a new category
// of data, and lets "page-to-page flow" show which league/player the visitor
// came from, not just which page type.
function detectReferrer() {
    const raw = document.referrer || '';
    if (!raw) return { referrer_kind: 'direct', from_page: null, from_league_id: null, from_player: null };
    try {
        const refUrl = new URL(raw);
        if (refUrl.hostname === location.hostname) {
            const refParams = new URLSearchParams(refUrl.search);
            return {
                referrer_kind: 'internal',
                from_page: pageFromPathname(refUrl.pathname),
                from_league_id: refParams.get('league') || null,
                from_player: refParams.get('player') || null,
            };
        }
        if (/google|bing|duckduckgo|yahoo/i.test(refUrl.hostname)) return { referrer_kind: 'search', from_page: null, from_league_id: null, from_player: null };
        if (/facebook|instagram|twitter|x\.com|t\.co|linkedin|whatsapp/i.test(refUrl.hostname)) return { referrer_kind: 'social', from_page: null, from_league_id: null, from_player: null };
        return { referrer_kind: 'other', from_page: null, from_league_id: null, from_player: null };
    } catch {
        return { referrer_kind: 'other', from_page: null, from_league_id: null, from_player: null };
    }
}

function baseFields() {
    const params = new URLSearchParams(location.search);
    const page = pageFromPathname(location.pathname);
    return {
        path: location.pathname,
        page,
        league_id: params.get('league') || null,
        player: params.get('player') || null,
        tab: currentTab(page, params),
        moved_banner: MOVED_BANNER,
        ...detectDevice(),
        ...detectReferrer(),
    };
}

function send(event) {
    if (!ENDPOINT) return;  // no-config = silent no-op
    if (SUPPRESSED) return; // automated traffic — see NO_TRACK_KEY above

    const admin = currentAdminUser();
    // Session-linked for an Israel visitor OR any signed-in user; everyone else
    // (an anonymous visitor abroad) stays zero-correlation with only a coarse
    // region. A signed-in user has IDENTIFIED themselves by logging in, so
    // correlating THEIR own visit is not the anonymous-visitor tracking the
    // two-route model refuses — and it lets a registered admin abroad appear as a
    // Journey, not just as scattered global rows. `admin != null` covers every
    // registered user regardless of timezone.
    const routed = (IS_LOCAL || admin != null)
        ? { ...event, session_id: ensureSessionId() }
        : { ...event, region: coarseRegion(TIMEZONE) };

    // Applied to BOTH routes: this labels the operator, not the audience.
    const enriched = { ...routed, admin_user: admin };

    const body = JSON.stringify(enriched);

    fetch(ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal', // required: insert-only RLS can't SELECT the inserted row back
        },
        body,
    }).catch(() => {}); // best-effort, never surface analytics failures to the user
}

// ---- pageview ----
{
    const { from_page, ...fields } = baseFields();
    send({ ...fields, from_page, event_type: 'pageview' });
}

// ---- browser navigation: Back / Forward / Refresh ----
// A Back/Forward/Refresh is not a DOM click the delegated listener can catch, but
// it IS a deliberate navigation the audience performs, so each is recorded as a
// click event carrying nav_type ('back'|'forward'|'reload') plus the page it came
// FROM (from_page) and landed ON (page). That makes it (a) count as an interaction
// (click_count / clicks log), (b) appear in the session timeline as its own row +
// time, and (c) show as a from→to row in the page-to-page transitions log — a
// Refresh as a same-page A→A. The ARRIVAL itself stays an ordinary pageview (fired
// just above on a real load, or on bfcache restore below), so a Back/Forward visit
// is counted like any other — this only ADDS the interaction record, never a view.
//
// Direction (back vs forward) is derived with NO new identifier: every history
// entry is stamped with a monotonic index in history.state, and the index we land
// on is compared to the index we were at — both held in sessionStorage (wiped on
// tab close, so no cross-visit linkage). PerformanceNavigationTiming distinguishes
// reload/back_forward/navigate on a full load; the index disambiguates back vs
// forward and also drives the in-page (tab) case via popstate, where there is no
// navigation-timing entry at all.
const NAV_POS_KEY = 'shabi_nav_pos'; // index of the history entry we are AT
const NAV_MAX_KEY = 'shabi_nav_max'; // highest index handed out so far
const NAV_CTX_KEY = 'shabi_nav_ctx'; // index -> {page,league,player} (source lookup)

function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

// The CURRENT page's identity, in the same shape stored as a nav source.
function currentNavCtx() {
    const params = new URLSearchParams(location.search);
    const page = pageFromPathname(location.pathname);
    return { page, league: params.get('league') || null, player: params.get('player') || null };
}

// 'navigate' | 'reload' | 'back_forward' | 'prerender' | null — the browser's own
// classification of how THIS document was reached (Navigation Timing Level 2).
function navTimingType() {
    try {
        const e = performance.getEntriesByType('navigation')[0];
        return e ? e.type : null;
    } catch { return null; }
}

function ctxMapGet() { try { return JSON.parse(ssGet(NAV_CTX_KEY) || '{}'); } catch { return {}; } }
function recordNavCtx(idx) {
    const m = ctxMapGet();
    m[idx] = currentNavCtx();
    // Bound the map — only the recent past is ever looked up as a source.
    const keys = Object.keys(m).map(Number).sort((a, b) => a - b);
    while (keys.length > 50) delete m[keys.shift()];
    try { ssSet(NAV_CTX_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// Ensure the CURRENT history entry carries an analytics index; return it. Merges
// into whatever state the app already set (never replaces it), so appTabs' own
// popstate state survives.
function stampNavIdx() {
    const st = history.state || {};
    if (typeof st.__ai === 'number') return st.__ai;
    const next = parseInt(ssGet(NAV_MAX_KEY) || '-1', 10) + 1;
    try { history.replaceState({ ...st, __ai: next }, ''); } catch { /* ignore */ }
    ssSet(NAV_MAX_KEY, String(next));
    return next;
}

// Emit the nav click. `src` is the source page ctx (null → fall back to referrer).
// `alsoPageview` fires the arrival pageview too — needed only on bfcache restore,
// where the module did NOT re-run and so the top-of-file pageview never fired.
function sendNav(navType, src, { alsoPageview = false } = {}) {
    const { from_page, from_league_id, from_player, ...fields } = baseFields();
    if (alsoPageview) send({ ...fields, from_page, event_type: 'pageview' });
    const label = navType === 'reload' ? 'Refresh' : navType === 'forward' ? 'Forward' : 'Back';
    send({
        ...fields,
        event_type: 'click',
        nav_type: navType,
        click_target: label,
        from_page: src ? src.page : from_page,
        from_league_id: src ? src.league : null,
        from_player: src ? src.player : null,
    });
}

// Patch history so EVERY entry — including appTabs' own tab pushes — carries a
// monotonic index, merged into (never replacing) the app's state. This is what
// lets popstate tell back from forward across tab navigation without each call
// site cooperating (the canonical shared fix, not a per-caller change).
for (const name of ['pushState', 'replaceState']) {
    const orig = history[name];
    history[name] = function (state, ...rest) {
        let s = state;
        try {
            if (name === 'pushState') {
                const next = parseInt(ssGet(NAV_MAX_KEY) || '-1', 10) + 1;
                s = { ...(state || {}), __ai: next };
                ssSet(NAV_MAX_KEY, String(next));
                ssSet(NAV_POS_KEY, String(next)); // a push moves us forward onto it
            } else if (!state || typeof state.__ai !== 'number') {
                // replaceState keeps the current entry's index if it has one.
                const cur = history.state && typeof history.state.__ai === 'number' ? history.state.__ai : null;
                if (cur !== null) s = { ...(state || {}), __ai: cur };
            }
        } catch { /* fall through with original state */ }
        return orig.call(this, s, ...rest);
    };
}

// Full-load classification (fresh load, reload, or a back/forward that reloaded).
{
    const destIdx = stampNavIdx();
    const lastPos = ssGet(NAV_POS_KEY);
    const lastIdx = lastPos === null ? null : parseInt(lastPos, 10);
    const t = navTimingType();
    const map = ctxMapGet();
    if (t === 'reload') {
        sendNav('reload', currentNavCtx()); // source == dest (same page)
    } else if (t === 'back_forward' && lastIdx !== null && destIdx !== lastIdx) {
        sendNav(destIdx < lastIdx ? 'back' : 'forward', map[lastIdx] || null);
    }
    // 'navigate' / first-ever load → no nav event; the pageview above is the record.
    recordNavCtx(destIdx);
    ssSet(NAV_POS_KEY, String(destIdx));
}

// In-page Back/Forward (a tab change via popstate) — no reload, module stays
// alive, so no navigation-timing entry; the index is the only signal.
window.addEventListener('popstate', () => {
    const st = history.state || {};
    const destIdx = typeof st.__ai === 'number' ? st.__ai : stampNavIdx();
    const lastIdx = parseInt(ssGet(NAV_POS_KEY) || '-1', 10);
    if (destIdx !== lastIdx) {
        sendNav(destIdx < lastIdx ? 'back' : 'forward', ctxMapGet()[lastIdx] || null);
    }
    recordNavCtx(destIdx);
    ssSet(NAV_POS_KEY, String(destIdx));
});

// bfcache restore (the common mobile Back): the module did NOT re-run, so neither
// the pageview above nor the full-load block fired — do both here. persisted=false
// is a normal load, already handled, so it is skipped.
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const st = history.state || {};
    const destIdx = typeof st.__ai === 'number' ? st.__ai : stampNavIdx();
    const lastIdx = parseInt(ssGet(NAV_POS_KEY) || '-1', 10);
    const dir = destIdx !== lastIdx ? (destIdx < lastIdx ? 'back' : 'forward') : 'back';
    sendNav(dir, ctxMapGet()[lastIdx] || null, { alsoPageview: true });
    recordNavCtx(destIdx);
    ssSet(NAV_POS_KEY, String(destIdx));
});

// ---- dwell time ----
let visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
let accumulatedMs = 0;

function bankVisibleTime() {
    if (visibleSince !== null) {
        accumulatedMs += performance.now() - visibleSince;
        visibleSince = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        bankVisibleTime();
    } else if (document.visibilityState === 'visible') {
        visibleSince = performance.now();
    }
});

function sendDuration() {
    bankVisibleTime();
    if (accumulatedMs < 100) return; // negligible dwell — skip noise
    const { from_page, from_league_id, from_player, ...fields } = baseFields();
    send({ ...fields, event_type: 'duration', duration_ms: Math.round(accumulatedMs) });
    accumulatedMs = 0;
}

window.addEventListener('pagehide', sendDuration);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
});

// ---- clicks (delegated) ----
// Every click_target starts with the button/element TYPE so the "All clicks &
// interactions" log reads consistently at a glance:
//   What if / Export / Tab / Menu / Player link / League link / Link
// `.img-export-btn` matches every "Export Image" button across dashboardPage/
// leaguePage/landingPage/typoEditor generically — no need to touch each call
// site. Run Simulation is handled via `[data-track]` instead: dashboardPage.js
// sets that button's `data-track` to "What if: ..." (a per-click summary of
// the staged scenario) right before this event bubbles up, so the summary
// comes along for free through the data-track path below. `[role="tab"]`
// matches every app-tabs button generically (js/render/appTabs.js) —
// `dataset.tab` is the stable tab id, not the display label, so it survives
// label/icon changes. `aside a, aside button` matches every sidebar nav item
// and flyout entry (leagues/table/records/settings/theme/admin-login) — the
// whole site sidebar lives in a single <aside>, so this needs no per-item
// wiring. Plain content links are split into player/league by their own href
// query params (the same params baseFields() already reads off the CURRENT
// page — reading them off a link's own target URL is symmetric, not new
// data), falling back to a generic link label/href.
function labelOf(el) {
    return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

document.addEventListener('click', (e) => {
    const trackEl = e.target.closest('[data-track]');
    const exportBtn = e.target.closest('.img-export-btn');
    // "Show all (N)" table-expanders (landing leaderboards + player page) and the
    // EN/HE language toggle inside "?" popups — both <button>s with their own
    // class, matched by no other branch. Like .img-export-btn, one class each
    // covers every call site.
    const showMoreEl = e.target.closest('.show-more-btn');
    const langFlagEl = e.target.closest('.popup-lang-flag');
    const tabEl = e.target.closest('[role="tab"]');
    // A sidebar SEARCH-RESULT link is a player/league navigation that merely lives
    // inside <aside>; caught here so it does NOT fall into the menu branch below,
    // which would log "Menu: <avatar-initials + name + league-count>" (the whole
    // row's textContent — messy, and with no flag). It becomes a clean "Search
    // player/league: <id>" that the dashboard renders with the player's flag +
    // single name, and reads as a pick FROM the search box (the preceding
    // "Search: results found" event already records that a search happened).
    const searchPickEl = e.target.closest('.nav-search-results a');
    const menuEl = searchPickEl ? null : e.target.closest('aside a, aside button');
    // `.btn-success`/`.btn-primary` is the admin panel's own consistent
    // convention for its primary action per screen (Publish to Site, Create
    // League, Save Settings, Save Player Changes, Confirm & Stage, per-row
    // Save, etc. — js/admin/*.js) — matching the classes generically covers
    // every admin action without touching each call site, the same idea as
    // `.img-export-btn` above. These only exist on admin.html, so they're
    // always "(Admin Mode)".
    const actionBtn = e.target.closest('.btn-success, .btn-primary');
    // Prev/next chronological arrows between leagues (dashboardPage.js/
    // leaguePage.js) or a player's adjacent leagues (playerPage.js) all share
    // this one class — checked before the generic link branch so the
    // direction (not which specific league/player) is what's tracked.
    const navArrowEl = e.target.closest('a.nav-arrow:not(.disabled)');
    // Home ▸ League ▸ Player breadcrumb (js/render/navigation.js's
    // renderBreadcrumbs, up to 3 levels) — its own category distinct from a
    // plain content link, checked before the generic link branch.
    const breadcrumbEl = e.target.closest('nav.breadcrumbs a');
    // The passive "Privacy" transparency link (js/render/privacyNotice.js) is a
    // plain <button> in the footer — matched by its stable data-action so any
    // privacy trigger is tracked, not just the current footer link.
    const privacyEl = e.target.closest('[data-action="privacy"]');
    // Every "?" info trigger (`.predictor-tooltip`) across the site — the
    // dashboard section explainers (Predictor, What If, PR-correlation …) and
    // the landing luck popup. It's a <span>, so it matches none of the branches
    // above; caught here generically and named by its own section heading, so
    // any future "?" section is tracked with no extra wiring.
    const infoEl = e.target.closest('.predictor-tooltip');
    const linkEl = e.target.closest('a');
    if (!trackEl && !exportBtn && !showMoreEl && !langFlagEl && !searchPickEl && !tabEl && !menuEl && !actionBtn && !navArrowEl && !breadcrumbEl && !privacyEl && !infoEl && !linkEl) return;

    // Submenu TOGGLES only open a flyout, they aren't a destination — so log the
    // final leaf, never the toggle. Covers both sidebars: the "Leagues" 2-level
    // flyout (Leagues > Dashboard/Table > <league>), "Records", "Settings", the
    // nested "Theme Customize" (settings-theme) and "Show name as" (settings-name).
    // Their leaves (Achievements/PR/Match, a league, a theme swatch, Username/Full
    // name) are NOT .site-nav-group and stay tracked.
    if (menuEl && menuEl.matches('.site-nav-group') &&
        ['leagues', 'leagues-dashboard', 'leagues-table',
         'records', 'settings', 'settings-theme', 'settings-name'].includes(menuEl.dataset.group)) {
        return;
    }

    let clickTarget;
    if (trackEl) {
        clickTarget = trackEl.dataset.track;
    } else if (exportBtn) {
        clickTarget = 'Export: image';
    } else if (showMoreEl) {
        clickTarget = 'Expand: show all';
    } else if (langFlagEl) {
        // dataset.lang is the stable slug ('en'/'he'); label is a translation-prone
        // fallback only if a flag ever ships without it.
        clickTarget = `Language: ${langFlagEl.dataset.lang || labelOf(langFlagEl)}`;
    } else if (searchPickEl) {
        // Read the player/league off the result's OWN href (the same params it
        // navigates to), so the log names the entity, not the row's visible text.
        let sp;
        try { sp = new URL(searchPickEl.getAttribute('href') || '', location.href).searchParams; } catch { sp = new URLSearchParams(); }
        const spPlayer = sp.get('player');
        const spLeague = sp.get('league');
        clickTarget = spPlayer ? `Search player: ${spPlayer}`
            : spLeague ? `Search league: ${spLeague}`
            : `Search pick: ${labelOf(searchPickEl)}`;
    } else if (tabEl) {
        clickTarget = `Tab: ${tabEl.dataset.tab || labelOf(tabEl)}`;
    } else if (menuEl) {
        // Sidebar items keep their icon and label in separate spans
        // (.site-nav-icon / .site-nav-label|.site-nav-flyout-label — see
        // js/render/siteSidebar.js) specifically so the label alone can be
        // read here without the icon glyph folded into the same string —
        // analyticsPage.js maps this clean label back to that same icon for
        // display, rather than guessing from embedded text.
        const labelEl = menuEl.querySelector('.site-nav-label, .site-nav-flyout-label');
        // Text-less sidebar controls (a theme colour swatch is a <button> with
        // only a background colour) have no readable text, so labelOf() returns
        // '' and this used to log a nameless "Menu: " with no icon. Fall back to
        // the control's own aria-label/title (the swatch carries "<Theme> theme")
        // so the click is named; if it is STILL nameless, skip it rather than
        // record an empty entry.
        const rawLabel = labelEl ? labelOf(labelEl)
            : (labelOf(menuEl) || (menuEl.getAttribute('aria-label') || menuEl.getAttribute('title') || '').trim());
        if (!rawLabel) return;
        // A league entry under Leagues > Dashboard or Leagues > Table needs
        // its parent section named too ("Dashboard: July 2026"), since the
        // league name alone is ambiguous between the two destinations.
        const label = menuEl.closest('[data-flyout="leagues-dashboard"]') ? `Dashboard: ${rawLabel}`
            : menuEl.closest('[data-flyout="leagues-table"]') ? `Table: ${rawLabel}`
            : rawLabel;
        // Only the admin's OWN sidebar (admin.html, class "admin-sidebar" —
        // see js/admin/render/adminSidebarNav.js) is admin-exclusive; the
        // public site sidebar shares the same markup/classes but is not, so
        // an admin browsing the public site never gets tagged "(Admin Mode)".
        const isAdminSidebar = !!menuEl.closest('.admin-sidebar');
        clickTarget = `Menu: ${label}${isAdminSidebar ? ' (Admin Mode)' : ''}`;
    } else if (actionBtn) {
        clickTarget = `Action: ${labelOf(actionBtn)} (Admin Mode)`;
    } else if (navArrowEl) {
        // "‹"/"›" (&lsaquo;/&rsaquo;) is the only text content — direction is
        // all that's meaningful here, not which specific league/player it
        // landed on (the resulting pageview already records that).
        clickTarget = `Nav: ${navArrowEl.textContent.trim() === '‹' ? 'previous' : 'next'}`;
    } else if (breadcrumbEl) {
        clickTarget = `Breadcrumb: ${labelOf(breadcrumbEl)}`;
    } else if (privacyEl) {
        clickTarget = 'Privacy: opened notice';
    } else if (infoEl) {
        // Name the "?" by its section heading (the "?" glyph lives inside it).
        const heading = infoEl.closest('.app-section-h2, h2, h3, h4');
        const name = heading ? labelOf(heading).replace(/[?\s]+$/, '').trim() : '';
        clickTarget = `Info: ${name || 'section'}`;
    } else {
        let params;
        try { params = new URL(linkEl.getAttribute('href') || '', location.href).searchParams; } catch { params = new URLSearchParams(); }
        const player = params.get('player');
        const league = params.get('league');
        clickTarget = player
            ? `Player link: ${player}`
            : league
            ? `League link: ${league}`
            : `Link: ${labelOf(linkEl) || linkEl.href}`;
    }

    const { from_page, from_league_id, from_player, ...fields } = baseFields();
    send({ ...fields, event_type: 'click', click_target: clickTarget });
// Capture phase (3rd arg `true`): this runs BEFORE any element's own click
// handler, so a stopPropagation() elsewhere in the tree can no longer swallow the
// click and hide it from analytics. Several controls legitimately stop the bubble
// (the leaderboard Export group so it doesn't toggle the collapsible, sidebar
// theme swatches, the search overlay, comboboxes) — in the bubble phase every one
// of those clicks went untracked. Tracking only READS the event (it never
// preventDefaults or stops anything), so running first is side-effect-free.
}, true);

/**
 * navigation.js dispatches this (debounced — once per pause in typing, not
 * per keystroke) when a search was performed. A custom DOM event, not a
 * direct import, since navigation.js is also used by pages (design-lab.html)
 * that deliberately don't load this module — this listener simply does
 * nothing there. Deliberately does NOT record the query text itself: unlike
 * page/league/player, search input is free text a visitor could type
 * anything into, so only a coarse outcome is kept — same "categorical, never
 * raw" principle as referrer_kind/device_type elsewhere in this file. A
 * resulting click-through (player/league link) is already fully tracked via
 * the delegated click listener above.
 */
window.addEventListener('shabi:search-performed', (e) => {
    const { from_page, from_league_id, from_player, ...fields } = baseFields();
    send({ ...fields, event_type: 'click', click_target: e.detail.foundResults ? 'Search: results found' : 'Search: no results' });
});

/**
 * Non-click interactions that still deserve a click-log entry — a dropdown /
 * stepper change is not a DOM click the delegated listener above can catch. Used
 * by the dashboard's Historical snapshot picker (B2) and the What-If baseline
 * picker (B4). Same custom-event pattern as the search event above; the
 * dispatcher owns the human-readable, non-identifying target string (a public
 * snapshot label — same category of data as league/player names already stored).
 */
window.addEventListener('shabi:interaction', (e) => {
    const target = String((e.detail && e.detail.target) || '').slice(0, 120);
    if (!target) return;
    const { from_page, from_league_id, from_player, ...fields } = baseFields();
    send({ ...fields, event_type: 'click', click_target: target });
});

// TEMPORARY — remove with js/render/movedNotice.js after 2026-08-27. Tells a
// visitor who arrived via an old golan.me.uk/ link that the address changed.
mountMovedNotice();
