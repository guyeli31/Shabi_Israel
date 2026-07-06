/**
 * analytics.js — first-party, fully anonymous analytics beacon.
 *
 * No IP, no cookies, no sessionStorage, no identifier of any kind — every
 * event stands completely alone and cannot be linked to any other event from
 * the same visit. This is deliberate: it rules out per-visit session
 * reconstruction, in exchange for being the legal equivalent of a standard
 * anonymous server access log rather than a behavioural tracker. Only
 * bucketed/categorical fields are collected (coarse device type, referrer
 * category, dwell-time bucket) — never raw referrer URLs or exact
 * screen/viewport pixel dimensions, which could otherwise act as an
 * incidental fingerprint.
 *
 * Transport: fetch(..., {keepalive:true}) is primary (works across the whole
 * lifecycle including unload, and can set the headers Supabase needs).
 * navigator.sendBeacon is the unload-path fallback only (can't set custom
 * headers, so the anon key goes in the query string instead).
 *
 * No-config = silent no-op (kept as a guard even though config is populated
 * today, in case a fork/local checkout doesn't have it wired up).
 */

// resolvedUrl/resolvedAnonKey (not the raw SUPABASE_URL/ANON_KEY constants)
// so local/dev testing writes to the local Docker project, matching every
// other data path in the app — never polluting production analytics.
import { resolvedUrl as SUPABASE_URL, resolvedAnonKey as SUPABASE_ANON_KEY } from './data/supabaseClient.js';

const PAGE_BY_FILENAME = {
    'index.html': 'landing',
    'league.html': 'league',
    'league_table.html': 'league_table',
    'player.html': 'player',
    'player_league.html': 'player_league',
};

const ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/analytics_events` : null;

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

function send(event, { useBeacon = false } = {}) {
    if (!ENDPOINT) return; // no-config = silent no-op

    const body = JSON.stringify(event);

    if (useBeacon && navigator.sendBeacon) {
        const url = `${ENDPOINT}?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`;
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
    }

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
    send({ ...fields, event_type: 'duration', duration_ms: Math.round(accumulatedMs) }, { useBeacon: true });
    accumulatedMs = 0;
}

window.addEventListener('pagehide', sendDuration);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
});

// ---- clicks (delegated) ----
// `.img-export-btn` matches every "Export Image" button across dashboardPage/
// leaguePage/landingPage/typoEditor generically — no need to touch each call
// site. `#whatif-run` (Run Simulation) is handled via `[data-track]` instead:
// dashboardPage.js sets that button's `data-track` to a per-click summary of
// the staged scenario right before this event bubbles up, so the summary
// (which matches were forced, not just "the button was clicked") comes along
// for free through the existing data-track path below.
document.addEventListener('click', (e) => {
    const trackEl = e.target.closest('[data-track]');
    const exportBtn = e.target.closest('.img-export-btn');
    const linkEl = e.target.closest('a');
    if (!trackEl && !exportBtn && !linkEl) return;

    const clickTarget = trackEl
        ? trackEl.dataset.track
        : exportBtn
        ? 'export_image'
        : (linkEl.textContent || '').trim().slice(0, 80) || linkEl.href;

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
    send({ ...fields, event_type: 'click', click_target: e.detail.foundResults ? 'search_performed: results_found' : 'search_performed: no_results' });
});
