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

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './data/supabaseConfig.js';

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

// Only a coarse category is kept — never the raw referrer URL (which could
// carry identifying query-string content) and never used to link events.
function detectReferrer() {
    const raw = document.referrer || '';
    if (!raw) return { referrer_kind: 'direct', from_page: null };
    try {
        const refUrl = new URL(raw);
        if (refUrl.hostname === location.hostname) {
            return { referrer_kind: 'internal', from_page: pageFromPathname(refUrl.pathname) };
        }
        if (/google|bing|duckduckgo|yahoo/i.test(refUrl.hostname)) return { referrer_kind: 'search', from_page: null };
        if (/facebook|instagram|twitter|x\.com|t\.co|linkedin|whatsapp/i.test(refUrl.hostname)) return { referrer_kind: 'social', from_page: null };
        return { referrer_kind: 'other', from_page: null };
    } catch {
        return { referrer_kind: 'other', from_page: null };
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
    const { from_page, ...fields } = baseFields();
    send({ ...fields, event_type: 'duration', duration_ms: Math.round(accumulatedMs) }, { useBeacon: true });
    accumulatedMs = 0;
}

window.addEventListener('pagehide', sendDuration);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
});

// ---- clicks (delegated) ----
document.addEventListener('click', (e) => {
    const trackEl = e.target.closest('[data-track]');
    const linkEl = e.target.closest('a');
    if (!trackEl && !linkEl) return;

    const clickTarget = trackEl
        ? trackEl.dataset.track
        : (linkEl.textContent || '').trim().slice(0, 80) || linkEl.href;

    const { from_page, ...fields } = baseFields();
    send({ ...fields, event_type: 'click', click_target: clickTarget });
});
