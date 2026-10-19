/**
 * analytics.js — what a PLAYER does on index.html, live or in the demo, sent
 * to gk_track() (sql/gevkahoot_analytics.sql) and read by an admin on
 * analytics.html. The host's pages (host.html, editor.html) do not load it.
 *
 * The main site's beacon (shabi-israel/js/analytics.js) is the model, and its
 * rules hold here unchanged:
 *   - no IP; the route is chosen by the browser's own timezone. Asia/Jerusalem
 *     (or a signed-in operator) gets a per-TAB visit id in sessionStorage, so a
 *     visit can be followed; everyone else sends independent events carrying
 *     only a continent, and nothing is written to their device;
 *   - only coarse, categorical fields (device type, OS, browser, referrer kind,
 *     visible dwell time) — never a URL or a screen size;
 *   - ONE exception, by the host's decision: the NAME a player chose (live
 *     and demo alike) is recorded as `player_name`, on every row from the
 *     moment they joined — it is what the player submitted to play under, and
 *     the host wants each game tied to who played it. It is the only free
 *     text here; nothing else a player types is sent;
 *   - NEVER the device token (localStorage['gevkahoot:device']) or its hash —
 *     it persists across visits, the one thing this beacon refuses to do;
 *   - `admin_user` names the OPERATOR (an admin trying the quiz), never a player;
 *   - `localStorage['shabi:no-analytics']` silences it — the same key as the
 *     main site, on the same origin, so `?notrack` once covers both projects.
 *
 * Silent in the editor's preview frames (they are the real page, fed by
 * postMessage — every edit would otherwise count as a visit).
 *
 * A LIVE quiz sends almost nothing: the server already records every join and
 * answer (gk_analytics_runs reads them). Per-screen 'stage' events are the
 * demo's only record, since the demo has no backend.
 */
import { supabase, resolvedUrl, resolvedAnonKey } from '../../../shabi-israel/js/data/supabaseClient.js';
import { hasUrlFlag } from '../../../shabi-israel/js/utils/queryString.js';

const ENDPOINT = resolvedUrl ? `${resolvedUrl}/rest/v1/rpc/gk_track` : null;
const NO_TRACK_KEY = 'shabi:no-analytics';

const SUPPRESSED = (() => {
    if (hasUrlFlag('preview')) return true;
    try {
        if (hasUrlFlag('track')) localStorage.removeItem(NO_TRACK_KEY);
        if (hasUrlFlag('notrack')) localStorage.setItem(NO_TRACK_KEY, '1');
        const off = localStorage.getItem(NO_TRACK_KEY) === '1';
        if (off) console.info('[gk analytics] suppressed for this browser profile (%s). Add ?track to a URL to re-enable.', NO_TRACK_KEY);
        return off;
    } catch {
        return false;
    }
})();

const TIMEZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
const IS_LOCAL = TIMEZONE === 'Asia/Jerusalem';
const REGIONS = ['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'];
const region = () => (REGIONS.includes(TIMEZONE.split('/')[0]) ? TIMEZONE.split('/')[0] : 'Other');

function visitId() {
    const make = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    try {
        let id = sessionStorage.getItem('gk_sid');
        if (!id) { id = make(); sessionStorage.setItem('gk_sid', id); }
        return id;
    } catch {
        return make();
    }
}

// The operator's own name (email local part), or null. Resolved once and
// kept current; events wait for the first answer so the pageview is labelled.
let adminUser = null;
const adminReady = supabase.auth.getSession()
    .then(({ data }) => { adminUser = data?.session?.user?.email?.split('@')[0] || null; })
    .catch(() => {});
supabase.auth.onAuthStateChange((_e, session) => { adminUser = session?.user?.email?.split('@')[0] || null; });

function device() {
    const ua = navigator.userAgent;
    const device_type = /Mobi|Android(?!.*Tablet)|iPhone/i.test(ua) ? 'mobile' : /Tablet|iPad/i.test(ua) ? 'tablet' : 'desktop';
    const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac OS/i.test(ua) ? 'macOS'
        : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : 'other';
    const browser = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox'
        : /Safari\//i.test(ua) ? 'Safari' : 'other';
    return { device_type, os, browser };
}

function referrer() {
    const raw = document.referrer || '';
    if (!raw) return { referrer_kind: 'direct', from_page: null };
    try {
        const u = new URL(raw);
        if (u.hostname === location.hostname) {
            // Which project, and which page of it — a folder and a file name,
            // never the query string.
            const parts = u.pathname.split('/').filter(Boolean);
            return { referrer_kind: 'internal', from_page: parts.slice(-2).join('/') || 'hub' };
        }
        if (/google|bing|duckduckgo|yahoo/i.test(u.hostname)) return { referrer_kind: 'search', from_page: null };
        if (/facebook|instagram|twitter|x\.com|t\.co|linkedin|whatsapp/i.test(u.hostname)) return { referrer_kind: 'social', from_page: null };
    } catch { /* fall through */ }
    return { referrer_kind: 'other', from_page: null };
}

const DEVICE = device();
const REFERRER = referrer();

// What the page is doing right now — set by gkPlayer.js as it learns it
// (player_name: the name this device is playing under, once it has joined).
let context = { mode: hasUrlFlag('demo') ? 'demo' : 'browse', quiz_id: null, run_id: null, player_name: null };
export function setContext(patch) { context = { ...context, ...patch }; }

let queue = [];
let timer = null;
function flush() {
    timer = null;
    if (!queue.length || !ENDPOINT) { queue = []; return; }
    const batch = queue.splice(0, 25);
    fetch(ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
            apikey: resolvedAnonKey,
            Authorization: `Bearer ${resolvedAnonKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_events: batch }),
    }).catch(() => {});
    if (queue.length) flush();
}

// Synchronous once the session is known, so a pagehide can still queue and
// flush in the same tick; before that, events wait (with the context of the
// moment they happened) and go out together.
let early = [];
adminReady.then(() => { const e = early; early = null; e.forEach(push); });
function push(row) {
    const route = IS_LOCAL || adminUser ? { session_id: visitId() } : { region: region() };
    queue.push({ ...row, ...route, admin_user: adminUser });
    if (!timer) timer = setTimeout(flush, 400);
}
function send(event) {
    if (SUPPRESSED || !ENDPOINT) return;
    const row = { page: 'entry', ...context, ...DEVICE, ...event };
    if (early) early.push(row); else push(row);
}

/** A click or an outcome worth a row: 'Join: ok', 'Demo: restart'. */
export const track = (target, fields = {}) => send({ event_type: 'click', click_target: String(target).slice(0, 120), ...fields });

/** A screen reached: { phase, item_kind, item_no, correct, points }. */
export const stage = (fields) => send({ event_type: 'stage', ...fields });

/** The visit's first row. Sent once, by gkPlayer.js when it knows the mode
 *  (live or just looking), or by the fallback below. */
let viewSent = false;
export function pageview() {
    if (viewSent) return;
    viewSent = true;
    const nav = (() => { try { return performance.getEntriesByType('navigation')[0]?.type; } catch { return null; } })();
    send({ event_type: 'pageview', ...REFERRER });
    if (nav === 'reload') track('Nav: refresh');
    else if (nav === 'back_forward') track(`Nav: ${navDirection()}`);
}
setTimeout(pageview, 4000);

// ---- Back / Forward (as on the main site) -------------------------------------
// The browser says a page was reached by back_forward, not which way. So every
// history entry gets a running index in history.state, and the index we land
// on is compared with the one we were at — both kept in sessionStorage (gone
// with the tab, so nothing links two visits).
const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { return null; } return null; };
function stampIndex() {
    const st = history.state || {};
    if (typeof st.__gk === 'number') return st.__gk;
    const next = parseInt(ss('gk_nav_max') || '-1', 10) + 1;
    try { history.replaceState({ ...st, __gk: next }, ''); } catch { /* fine */ }
    ss('gk_nav_max', String(next));
    return next;
}
const lastIndex = parseInt(ss('gk_nav_pos') ?? '-1', 10);
const hereIndex = stampIndex();
ss('gk_nav_pos', String(hereIndex));
function navDirection(from = lastIndex, to = hereIndex) {
    return to < from ? 'back' : to > from ? 'forward' : 'back/forward';
}
// A Back that the browser served from its page cache: the module did not run
// again, so neither did the pageview above — this is that visit's record.
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const from = parseInt(ss('gk_nav_pos') ?? '-1', 10);
    const to = stampIndex();
    ss('gk_nav_pos', String(to));
    send({ event_type: 'pageview', ...REFERRER });
    track(`Nav: ${navDirection(from, to)}`);
});

// ---- dwell: visible time only ------------------------------------------------
let visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
let banked = 0;
function sendDuration() {
    if (visibleSince !== null) { banked += performance.now() - visibleSince; visibleSince = null; }
    if (banked < 100) return;
    send({ event_type: 'duration', duration_ms: Math.round(banked) });
    banked = 0;
    // pagehide: the timer would never fire, so the queue goes now.
    setTimeout(flush, 0);
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
    else visibleSince = performance.now();
});
window.addEventListener('pagehide', () => { sendDuration(); flush(); });

// ---- clicks ------------------------------------------------------------------
// Only elements that name themselves with data-track. The stage's own tiles and
// pieces are not here on purpose: an answer is recorded by the server (live) or
// by the reveal's 'stage' event (demo), and a per-tap row from thirty phones
// is load with nothing to add. Capture phase, so a stopPropagation() cannot
// hide a click (as on the main site).
document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-track]');
    if (el) track(el.dataset.track);
}, true);
