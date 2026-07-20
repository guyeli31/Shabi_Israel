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

const PAGE_BY_FILENAME = {
    'index.html': 'landing',
    'league.html': 'league',
    'league_table.html': 'league_table',
    'player.html': 'player',
    'player_league.html': 'player_league',
    'admin.html': 'admin',
};

const ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/analytics_events` : null;

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

// Israel route only. Private-mode fallback (sessionStorage throws) keeps a
// per-page id in memory — tracking never breaks, it just can't span pages.
const SESSION_ID = (() => {
    if (!IS_LOCAL) return null;
    try {
        let sid = sessionStorage.getItem('shabi_sid');
        if (!sid) { sid = newId(); sessionStorage.setItem('shabi_sid', sid); }
        return sid;
    } catch {
        return newId();
    }
})();

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
    return PAGE_BY_FILENAME[filename] || null;
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
    return {
        path: location.pathname,
        page: pageFromPathname(location.pathname),
        league_id: params.get('league') || null,
        player: params.get('player') || null,
        ...detectDevice(),
        ...detectReferrer(),
    };
}

function send(event) {
    if (!ENDPOINT) return; // no-config = silent no-op

    // Israel → session-linked; everyone else → zero-correlation + coarse region.
    const routed = IS_LOCAL
        ? { ...event, session_id: SESSION_ID }
        : { ...event, region: coarseRegion(TIMEZONE) };

    // Applied to BOTH routes: this labels the operator, not the audience.
    const enriched = { ...routed, admin_user: currentAdminUser() };

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
    const tabEl = e.target.closest('[role="tab"]');
    const menuEl = e.target.closest('aside a, aside button');
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
    if (!trackEl && !exportBtn && !tabEl && !menuEl && !actionBtn && !navArrowEl && !breadcrumbEl && !privacyEl && !infoEl && !linkEl) return;

    // The "Leagues" nav is a 2-level flyout (Leagues > Dashboard/Table >
    // <league name>). Only the final league selection is a real navigation —
    // "Leagues"/"Dashboard"/"Table" are just submenu toggles, so they're
    // skipped entirely rather than logged as their own meaningless clicks.
    if (menuEl && menuEl.matches('.site-nav-group') &&
        ['leagues', 'leagues-dashboard', 'leagues-table'].includes(menuEl.dataset.group)) {
        return;
    }

    let clickTarget;
    if (trackEl) {
        clickTarget = trackEl.dataset.track;
    } else if (exportBtn) {
        clickTarget = 'Export: image';
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
        const rawLabel = labelEl ? labelOf(labelEl) : labelOf(menuEl);
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
});

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
