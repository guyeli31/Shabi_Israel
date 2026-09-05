/**
 * store.js — single client-side cache + read API for Supabase-sourced data.
 * Spec: docs/data-architecture/01-architecture.md §A2, A3, A5.
 *
 * One cached bundle (get_site_bundle() RPC) instead of the old per-page
 * granular-query fan-out: a page's first data request triggers exactly one
 * network round trip; every subsequent call on that page (and on every later
 * page navigation within the localStorage cache's lifetime) is served from
 * the in-memory/localStorage copy with zero additional requests. See
 * docs/data-architecture/02-query-standards.md rule 1 — this file (plus
 * bundleMapper.js) is the ONLY place allowed to call supabase.from()/rpc()
 * for the public read path; admin keeps using supabaseLoader.js directly
 * (rule 9), always reading fresh, never through this cache.
 *
 * Every public render/compute module imports from here directly.
 *
 * There is no static-file fallback. The repo's leagues/** snapshot and the
 * ?datasource=files escape hatch that read it are gone: the snapshot froze when
 * publishing moved to Supabase, so "falling back" to it meant silently serving
 * months-old data under folder names that no longer match any league id.
 */

import { supabase } from './supabaseClient.js';
import { mergeHistoryIntoMatches, buildMatchTimeline } from '../compute/matchHistory.js';
import { applyOverrides as applyOverridesPure } from './applyOverrides.js';
import * as mapper from './bundleMapper.js';
// URL-flag + localStorage reads only; no admin state reaches the public path.
import { stagedPlayersMetadata } from '../admin/previewMode.js';

const CACHE_KEY = 'shabi:bundle:v1';
/**
 * Tiny companion to CACHE_KEY, holding only what a page needs to answer ONE
 * question before any module has loaded: "will this page have to go to the
 * network, or is it already served?"
 *
 * It exists because that question has to be answered in the <head>, and the
 * only honest answer lives inside CACHE_KEY — whose value is the entire site
 * bundle. Reading it is one localStorage hit, but JSON.parse()ing megabytes
 * synchronously in the <head> to check two numbers would cost far more than
 * the decision saves. So the two numbers are also written out on their own.
 *
 * The receipt is a HINT, never a source of truth: it is only ever used to
 * decide whether to arm the loading screen. Every real read still goes through
 * readPersisted(), which validates the actual bundle. A receipt that lies (the
 * bundle was evicted by quota pressure while the receipt survived) costs a
 * loading screen that arms slightly late — see the fetch-start event below,
 * which is what actually reveals it.
 *
 * Its shape and the rule for judging it are mirrored by hand in every page's
 * inline head script; scripts/check-splash-arming.mjs fails the build if the
 * two drift apart.
 */
const RECEIPT_KEY = 'shabi:bundle:receipt';
/**
 * Fired on `window` the moment a BLOCKING bundle fetch starts — i.e. only on
 * the cold path, where the page genuinely has nothing to render yet. This is
 * the signal that arms the loading screen (see js/utils/splash.js).
 *
 * A custom event rather than an import so the data layer never reaches into a
 * UI module: store.js announces a fact about itself, and whoever cares
 * listens. The background revalidation fetch deliberately does NOT fire it —
 * that one has a fully-rendered page in front of it and nothing to cover.
 */
const FETCH_START_EVENT = 'shabi:bundle-fetch-start';
/**
 * The freshness contract: **every page load version-checks, and a change always
 * repaints.** No visitor should ever need a second refresh to see data that is
 * already in the database.
 *
 * This deliberately replaces an earlier 60s "check TTL" that gated the check
 * itself. That gate was a freshness gate wearing a performance costume: a
 * refresh inside the window skipped the check entirely, so the page could not
 * update no matter how many times it was reloaded. The check is one row of one
 * column from a one-row table and never blocks a render — there is nothing to
 * save by skipping it, and correctness to lose.
 *
 * What remains is a pure burst-coalescer: several store consumers boot in
 * sequence on one page, and alt-tabbing fires visibilitychange repeatedly.
 * Those are the same instant, not separate questions.
 */
const CHECK_COALESCE_MS = 3_000;
/**
 * While the tab is visible and the user is looking at it, re-ask on this
 * cadence. This is what lets a tab left open on a league table pick up a match
 * that was just applied WITHOUT any refresh at all — one tiny request a minute,
 * suspended entirely while the tab is hidden.
 */
const POLL_MS = 60_000;
// The bundle shape this client build understands (mirrors the RPC's
// schema_version). A persisted entry stamped with any other value is from a
// different deploy and is discarded on read rather than fed to a mapper that
// may expect different fields.
const EXPECTED_SCHEMA_VERSION = 1;
// Hard retention ceiling for the cached bundle. Past this the entry is evicted
// on read and refetched fresh — bounds how long a visitor's device holds the
// (public, id-less) league data after their last visit, and stops a very stale
// snapshot from lingering if the version-check path never runs. Scoped to the
// CACHE_KEY entry ONLY — never localStorage.clear(), which would also wipe
// analytics' sessionStorage id and display preferences.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Hard ceiling on any single network round trip. Without it, a mobile socket
// frozen when the tab is backgrounded leaves the fetch neither resolved nor
// rejected — the promise hangs forever and the page stays stuck on "Loading…"
// until a manual reload. With it, the request REJECTS, which lets ready()'s
// callers show a real error (and lets the poison-reset below re-arm a retry).
const FETCH_TIMEOUT_MS = 10_000;
const VERSION_CHECK_TIMEOUT_MS = 5_000;
// After a hard cold-fetch failure, briefly fail fast instead of re-fetching.
// The poison-reset (see ready()) nulls _bundlePromise so a later retry can
// re-attempt — but a page loads several store consumers in sequence (navbar,
// then the page render, then the sidebar). Without this cooldown, during a
// real outage each one would start its own fresh FETCH_TIMEOUT, stacking into
// N×10s before any error surfaced. The window is short so a genuine later
// retry (a tab-refocus re-render, a user action) still gets a live attempt.
const FAIL_COOLDOWN_MS = 3_000;

let _bundlePromise = null; // per-page-load memo, like crossLeague.js's allLeaguesPromise
let _cachedEntry = null;   // { schemaVersion, dataVersion, checkedAt, fetchedAt, bundle }
let _lastFailAt = 0;       // timestamp of the last hard cold-fetch failure (see FAIL_COOLDOWN_MS)
let _checkInFlight = null; // the version check currently in the air, shared by concurrent callers
let _lastCheckAt = 0;      // in-memory only, reset by every page load (see refreshIfChanged)
let _metaCache = null;
const _updateListeners = [];

// ---- persistence (localStorage, try/catch — quota/private-mode degrades
// to in-memory-only for the page's lifetime) ----

/** Remove ONLY the bundle cache entry. Deliberately targeted (never
 *  localStorage.clear()) so analytics' sessionStorage session id and the
 *  display-preference keys are never touched. */
function evictPersisted() {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(RECEIPT_KEY); } catch { /* ignore */ }
}

/** Parse and VALIDATE a stored entry: reject a foreign schema (different
 *  deploy) or one past MAX_AGE, evicting it so the caller falls through to a
 *  fresh fetch. Returns the entry only if it is safe to serve. */
function parseValidEntry(raw) {
    if (!raw) return null;
    let entry;
    try { entry = JSON.parse(raw); } catch { return null; }
    if (!entry || !entry.bundle) return null;
    if (entry.schemaVersion !== EXPECTED_SCHEMA_VERSION) return null;
    if (typeof entry.fetchedAt !== 'number' || Date.now() - entry.fetchedAt > MAX_AGE_MS) return null;
    return entry;
}

function readPersisted() {
    let raw;
    try { raw = localStorage.getItem(CACHE_KEY); } catch { return null; }
    if (!raw) return null;
    const entry = parseValidEntry(raw);
    if (!entry) { evictPersisted(); return null; } // stale shape / too old / corrupt
    return entry;
}

function writePersisted(entry) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
        // quota exceeded or private browsing — page still works, just
        // without a cross-page cache for this session.
        //
        // The receipt must NOT be written when the bundle was not: a receipt
        // without a bundle claims the next page needs no network, which would
        // suppress the loading screen on a page that then fetches from cold.
        // (The fetch-start event still reveals it, so the failure mode is a
        // late splash rather than none — but there is no reason to create it.)
        return;
    }
    // Deliberately AFTER the bundle write, and deliberately its own try/catch:
    // the receipt is a hint, so failing to record it must never fail the write
    // that matters.
    try {
        localStorage.setItem(RECEIPT_KEY, JSON.stringify({
            schemaVersion: entry.schemaVersion,
            fetchedAt: entry.fetchedAt,
        }));
    } catch { /* ignore — worst case the next page arms its splash */ }
}

/** AbortSignal that fires after `ms`, tolerant of runtimes without
 *  AbortSignal.timeout(). Never leaks the timer once the request settles. */
function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return { signal: AbortSignal.timeout(ms), clear() {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return { signal: controller.signal, clear() { clearTimeout(timer); } };
}

async function fetchBundle() {
    const t = timeoutSignal(FETCH_TIMEOUT_MS);
    try {
        const { data, error } = await supabase.rpc('get_site_bundle').abortSignal(t.signal);
        if (error) throw new Error(`get_site_bundle failed: ${error.message}`);
        return data;
    } finally {
        t.clear();
    }
}

async function fetchServerVersion() {
    const t = timeoutSignal(VERSION_CHECK_TIMEOUT_MS);
    try {
        const { data, error } = await supabase.from('site_meta').select('data_version').eq('id', 1).abortSignal(t.signal).single();
        if (error || !data) return null;
        return data.data_version;
    } catch {
        return null; // timeout/offline — background check is best-effort
    } finally {
        t.clear();
    }
}

function toEntry(bundle) {
    return {
        schemaVersion: bundle.schema_version,
        dataVersion: bundle.data_version,
        checkedAt: Date.now(),
        fetchedAt: Date.now(),
        bundle,
    };
}

/** Sibling caches built ON TOP of the bundle — crossLeague.js's per-league
 *  computed entries, navigation.js's search indexes. They register a reset
 *  callback here so a refresh can clear them WITHOUT store.js importing them
 *  (which would be circular: they already import store.js). */
const _memoInvalidators = [];
export function registerMemoInvalidator(fn) {
    if (typeof fn === 'function') _memoInvalidators.push(fn);
}

function invalidateSiblingMemos() {
    for (const fn of _memoInvalidators) { try { fn(); } catch { /* keep going */ } }
}

/** Swap a freshly-fetched bundle in everywhere the old one lived: the persisted
 *  entry, the in-memory promise, the players-metadata map, and every sibling
 *  memo. Then notify onUpdate subscribers. Used by both the background check and
 *  the visibility revalidation. */
function applyNewBundle(bundle) {
    _cachedEntry = toEntry(bundle);
    writePersisted(_cachedEntry);
    _bundlePromise = Promise.resolve(bundle);
    _metaCache = null; // rebuilt lazily from the new bundle on next read
    invalidateSiblingMemos();
    for (const cb of _updateListeners) { try { cb(bundle); } catch { /* ignore */ } }
}

/**
 * The one implementation of "is what I am showing still true?" — shared by the
 * page-load check, the tab-return check and the visible-tab poll, so those three
 * can never drift into three different answers.
 *
 * Asks the server for the current data_version; if it differs from the cached
 * one, fetches the new bundle, swaps it in, AND REPAINTS. That last step is the
 * whole point: an earlier version of this code did everything up to the swap and
 * then notified only onUpdate — a subscriber list no page had ever joined. The
 * fresh data landed in localStorage and the visitor kept reading the old render
 * until they reloaded a second time. Refreshing the cache without refreshing the
 * screen is not a refresh.
 *
 * Never blocks a render: callers fire and forget, so warm navigation stays at
 * zero blocking requests. Failures keep serving the copy we have.
 */
function refreshIfChanged() {
    if (!_cachedEntry) return Promise.resolve(false);
    // Share a check that is already in the air — this is what stops the several
    // store consumers that boot in sequence on one page (navbar, page render,
    // sidebar) from firing three identical requests.
    if (_checkInFlight) return _checkInFlight;
    // Only then fall back to a time gap, for bursts that arrive just after one
    // finished (alt-tabbing, a poll tick racing a tab-return).
    //
    // Both gates are IN-MEMORY and reset by a page load, deliberately. An
    // earlier draft gated on the persisted entry's own checkedAt, which meant a
    // reload moments after the previous page had checked inherited that
    // timestamp and skipped its check entirely — a fresh reload showing stale
    // data, which is precisely the bug this file is fixing, reintroduced at a
    // smaller scale. A new page load always asks.
    if (Date.now() - _lastCheckAt < CHECK_COALESCE_MS) return Promise.resolve(false);
    _checkInFlight = doCheck().finally(() => { _checkInFlight = null; _lastCheckAt = Date.now(); });
    return _checkInFlight;
}

async function doCheck() {
    const serverVersion = await fetchServerVersion();
    if (serverVersion == null) return false;          // offline / timed out — keep what we have
    if (serverVersion === _cachedEntry.dataVersion) return false; // nothing changed: zero further cost

    applyNewBundle(await fetchBundle());
    await rerenderAll();
    return true;
}

/** Fire-and-forget wrapper for the page-load path. */
function maybeCheckInBackground() {
    refreshIfChanged().catch(() => { /* best-effort; keep serving the stale copy */ });
}

/** Ensures the bundle is loaded, returns it. Cold (no cache): exactly one
 *  blocking RPC call. Warm: synchronous localStorage read, zero requests. */
function ready() {
    if (_bundlePromise) return _bundlePromise;

    // Fail fast during a recent outage: if a cold fetch just hard-failed and
    // there is still no cache to serve, don't make this sequential consumer pay
    // another full FETCH_TIMEOUT — reject immediately so the page's error path
    // fires promptly instead of stacking N×10s. readPersisted() guards the rare
    // case where another tab wrote a cache in the meantime.
    if (Date.now() - _lastFailAt < FAIL_COOLDOWN_MS && !readPersisted()) {
        return Promise.reject(new Error('get_site_bundle recently failed; retry shortly'));
    }

    _bundlePromise = (async () => {
        const persisted = readPersisted();
        if (persisted) {
            _cachedEntry = persisted;
            maybeCheckInBackground();
            return persisted.bundle;
        }
        // Nothing to serve: this page is about to wait on the network, and
        // this is the ONLY place in the whole read path where that is true.
        // Announcing it here is what lets the loading screen exist exactly
        // when there is a wait to cover and never otherwise — see
        // FETCH_START_EVENT.
        try { window.dispatchEvent(new CustomEvent(FETCH_START_EVENT)); } catch { /* non-DOM host */ }
        const bundle = await fetchBundle();
        _cachedEntry = toEntry(bundle);
        writePersisted(_cachedEntry);
        return bundle;
    })();

    // Poison-reset: if the cold fetch rejects (timeout, offline, RPC error),
    // don't leave a permanently-rejected promise memoized in _bundlePromise —
    // that would make every LATER ready() call return the same dead rejection
    // until a full page reload (the exact "only refresh frees it" symptom).
    // Clearing it re-arms a fresh attempt on the next call (a nav, a retry, or
    // the visibilitychange re-render added in a later wave); _lastFailAt gates
    // that retry behind FAIL_COOLDOWN_MS so sequential consumers fail fast. The
    // current caller still receives THIS rejection, so error handling is
    // unchanged.
    _bundlePromise.catch(() => { _bundlePromise = null; _lastFailAt = Date.now(); });

    return _bundlePromise;
}

/** Subscribe to bundle updates found by the background revalidation check
 *  (see maybeCheckInBackground). Opt-in for pages that want a data-changed
 *  hook; see 01-architecture.md §A3. Most pages use onVisibleRevalidate below
 *  instead, which additionally re-renders. */
export function onUpdate(cb) {
    _updateListeners.push(cb);
}

// ---- self-heal on tab-return / bfcache restore (01-architecture.md §A3 step 5) ----

const _revalidateHandlers = [];
let _autoRevalidateInit = false;
let _revalidating = false;
let _pendingRerender = false; // a repaint arrived before any handler existed (see rerenderAll)

/** Register a page's re-render function to run when the tab becomes visible
 *  again (or is restored from bfcache) AND either the data changed on the
 *  server or a previously-failed load can now succeed. This is what makes a tab
 *  left open for hours self-heal: on return it silently version-checks and,
 *  only if something actually changed, refreshes the bundle and re-renders in
 *  place (scroll preserved). The trigger is return-to-visible, never a timer —
 *  a tab the user is actively looking at is never yanked out from under them.
 *  The first caller installs the listeners; later callers just add a handler. */
export function onVisibleRevalidate(reRenderFn) {
    if (typeof reRenderFn === 'function') _revalidateHandlers.push(reRenderFn);
    // Flush a repaint that the page-load check produced while this page was
    // still doing its first render (see rerenderAll).
    if (_pendingRerender) { _pendingRerender = false; rerenderAll(); }
    if (_autoRevalidateInit) return;
    _autoRevalidateInit = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runRevalidate();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) runRevalidate();
    });
    startVisiblePoll();
    // Cross-tab sync: when another tab refreshes the bundle, the `storage` event
    // fires HERE (it never fires in the tab that made the write). Adopt the
    // newer bundle with zero network of our own and re-render, so several open
    // tabs converge on the same data instead of drifting apart. Only reacts to
    // OUR cache key and only to a genuinely different data_version.
    window.addEventListener('storage', (e) => {
        if (e.key !== CACHE_KEY) return;
        if (!e.newValue) return; // eviction/removal in another tab — keep serving what we have
        const incoming = parseValidEntry(e.newValue);
        if (!incoming) return;
        if (_cachedEntry && incoming.dataVersion === _cachedEntry.dataVersion) return;
        adoptCachedEntry(incoming);
        rerenderAll();
    });
}

async function runRevalidate() {
    if (_revalidating) return; // coalesce overlapping triggers (visibility + pageshow + poll)
    _revalidating = true;
    try {
        if (!_cachedEntry) {
            // Previous load failed or never completed — attempt it now. Success
            // heals a page stuck on its error/spinner with no manual refresh
            // (the exact symptom that started this work). Deliberately NOT
            // coalesce-gated: a broken page should retry on every return.
            try { await ready(); } catch { return; }
            if (!_cachedEntry) return;
            invalidateSiblingMemos();
            await rerenderAll();
            return;
        }
        await refreshIfChanged();
    } catch {
        /* keep serving the copy we have */
    } finally {
        _revalidating = false;
    }
}

/** Poll while the tab is visible; stand down entirely while it is hidden, so a
 *  backgrounded tab costs nothing and a returning one is caught by
 *  visibilitychange anyway. */
function startVisiblePoll() {
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
        if (timer) return;
        timer = setInterval(() => { runRevalidate(); }, POLL_MS);
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') start(); else stop();
    });
    window.addEventListener('pagehide', stop);
    if (document.visibilityState === 'visible') start();
}

/** Re-run every registered page re-render handler, preserving scroll position
 *  across the DOM rebuild. Shared by the visibility revalidation and the
 *  cross-tab storage adoption below. */
async function rerenderAll() {
    // A page registers its re-render function only AFTER its first render has
    // finished — but the page-load version check starts before that and can come
    // back mid-render. Landing a repaint on an empty handler list would drop it
    // silently and leave exactly the stale page this whole path exists to
    // prevent, so remember it and let registration flush it instead.
    if (_revalidateHandlers.length === 0) { _pendingRerender = true; return; }
    _pendingRerender = false;
    for (const fn of _revalidateHandlers) {
        const y = window.scrollY;
        try { await fn(); } catch { /* a page's own render error is its to surface */ }
        requestAnimationFrame(() => window.scrollTo(0, y));
    }
}

/** Adopt a bundle another tab already fetched and wrote to localStorage — no
 *  network of our own. Like applyNewBundle but it does NOT re-persist (the
 *  value is already in storage, having come from there) and takes a full entry
 *  so checkedAt/fetchedAt carry over from the tab that fetched it. */
function adoptCachedEntry(entry) {
    _cachedEntry = entry;
    _bundlePromise = Promise.resolve(entry.bundle);
    _metaCache = null;
    invalidateSiblingMemos();
    for (const cb of _updateListeners) { try { cb(entry.bundle); } catch { /* ignore */ } }
}

// ---- league data ----

export async function loadLandingSettings() {
    const bundle = await ready();
    return mapper.mapLandingSettingsRow(bundle.landing_settings);
}

export async function loadLeagueOrder() {
    const settings = await loadLandingSettings();
    return settings.displayOrder;
}

export async function loadLeagueParams(leagueId) {
    const bundle = await ready();
    const row = bundle.leagues.find((l) => l.id === leagueId);
    if (!row) throw new Error(`Failed to load params for "${leagueId}"`);
    return mapper.mapLeagueRow(row);
}

export async function loadLeagueMatches(leagueId) {
    const bundle = await ready();
    const rows = bundle.matches.filter((m) => m.league_id === leagueId);
    const allPlayers = new Set();
    for (const row of rows) {
        allPlayers.add(row.player_a);
        allPlayers.add(row.player_b);
    }
    const matches = rows.filter((r) => r.played).map(mapper.mapMatchRow);
    return { matches, totalPlayers: allPlayers.size, allPlayers };
}

export async function loadLeagueMatchesAll(leagueId) {
    const bundle = await ready();
    const rows = bundle.matches.filter((m) => m.league_id === leagueId);
    const matches = rows.map(mapper.mapMatchRowAll);
    const allPlayers = new Set();
    for (const m of matches) {
        allPlayers.add(m.playerA);
        allPlayers.add(m.playerB);
    }
    return { matches, allPlayers };
}

export async function loadOverrides(leagueId) {
    const bundle = await ready();
    return bundle.manual_overrides.filter((o) => o.league_id === leagueId).map(mapper.mapOverrideRow);
}

export async function loadMatchHistory(leagueId) {
    const bundle = await ready();
    const matches = bundle.match_history.filter((h) => h.league_id === leagueId).map(mapper.mapHistoryRow);
    return { matches };
}

/**
 * A league's precomputed Title Race projections, or null when none are stored.
 *
 * DELIBERATELY NOT IN THE SITE BUNDLE, and the reason is a quota rather than a
 * preference. The bundle is fetched on every page and persisted to
 * localStorage, which has a hard ~5 MB ceiling; the projections are ~50–170 KB
 * per league and serve exactly one section of one league. Carrying them in the
 * bundle would spend a large share of that ceiling on data most visits never
 * look at — and the failure mode of exceeding it is the cache silently refusing
 * to persist, i.e. every page load in the site becoming a cold load.
 *
 * So this is its own request, made only when the Title Race section is actually
 * on screen (see js/render/dashboardPage.js → renderTitleRace). It lands in page
 * memory and is gone on refresh. Rule 1 of 02-query-standards still holds: the
 * query lives here in store.js, not at the call site.
 *
 * @returns {Promise<{roster:string[], points:object[], iterations:number}|null>}
 */
export async function loadLeagueProjections(leagueId) {
    const { data, error } = await supabase
        .from('league_projections')
        .select('roster, points, iterations, computed_at')
        .eq('league_id', leagueId)
        .maybeSingle();
    // A missing table (the SQL not applied yet) or a missing row are the same
    // thing to the caller: nothing stored, compute locally. Never an error the
    // page has to show — the chart has a working fallback either way.
    if (error || !data) return null;
    return data;
}

export function applyOverrides(matches, overrides) {
    return applyOverridesPure(matches, overrides);
}

export async function loadLeague(leagueId) {

    const [params, matchData, overrides, history] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId),
        loadOverrides(leagueId),
        loadMatchHistory(leagueId),
    ]);
    const withOverrides = applyOverridesPure(matchData.matches, overrides);
    // The timeline — history minus the pairings a not_played override erases —
    // is what every time-aware view replays, and what the live merge folds in.
    // Merging the RAW history here resurrected a match the admin had just marked
    // not-played, because the stale history row outranked the override.
    const timeline = buildMatchTimeline(history, overrides);
    const mergedMatches = mergeHistoryIntoMatches(withOverrides, timeline);

    return {
        id: leagueId,
        params,
        matches: mergedMatches,
        lastModified: params.LastUpdated || null,
        totalPlayers: matchData.totalPlayers,
        allPlayers: matchData.allPlayers,
        history,
        timeline,
    };
}

/**
 * Every league in the bundle, as Map<leagueId, params>.
 *
 * Distinct from loadAllLeagueParams(ids), which answers "these leagues, in this
 * order" and silently drops ids the bundle does not carry. Callers that need
 * the whole set — the analytics dashboard labelling arbitrary league ids that
 * appear in its event rows, including ones absent from the landing page's
 * display order — need every league, keyed for lookup.
 *
 * Added rather than letting the caller run its own `from('leagues')` query
 * (02-query-standards rule 3: new data needs extend the shared read path, they
 * do not get their own query).
 */
export async function loadAllLeagues() {
    const bundle = await ready();
    return new Map(bundle.leagues.map((row) => [row.id, mapper.mapLeagueRow(row)]));
}

export async function loadAllLeagueParams(leagueIds) {
    const bundle = await ready();
    const byId = new Map(bundle.leagues.map((row) => [row.id, mapper.mapLeagueRow(row)]));
    return leagueIds.filter((id) => byId.has(id)).map((id) => ({ id, params: byId.get(id) }));
}

/** Same Map<leagueId, league> shape as supabaseLoader.js's loadLeaguesBulk,
 *  but every league is filtered from the ONE already-fetched bundle instead
 *  of firing its own paginated round trips — this is what collapses the
 *  landing page's 4-query loadLeaguesBulk + the player page's 11-query
 *  ensurePlayerIndex fan-out down to the single ready() call every other
 *  shim above already shares. */
export async function loadLeaguesBulk(leagueIds) {
    await ready(); // ensure the shared bundle is loaded before the per-league loop below
    const results = new Map();
    for (const leagueId of leagueIds) {
        try {
            results.set(leagueId, await loadLeague(leagueId));
        } catch {
            // league row missing from the bundle — matches loadLeague() throwing.
        }
    }
    return results;
}

// ---- players_metadata ----

export async function loadPlayersMetadata() {
    if (_metaCache) return _metaCache;
    const bundle = await ready();
    _metaCache = {};
    for (const row of bundle.players_metadata) {
        _metaCache[row.id] = mapper.mapPlayerMetaRow(row);
    }
    // Preview mode (?preview): a staged players_metadata edit has no URL for
    // previewMode.js's fetch interceptor to shadow — metadata comes from the
    // bundle, not from disk — so the staged registry is overlaid here instead.
    // Without it the admin's "Live preview" iframe rendered the published title
    // while the form beside it showed the edited one. The staged content is the
    // whole registry, and its entries already use this same camelCase shape.
    const staged = stagedPlayersMetadata();
    if (staged) _metaCache = staged;
    return _metaCache;
}

export function clearPlayersMetadataCache() {
    _metaCache = null;
}

/**
 * The player registry (public.players_registry, sql/players_registry.sql) — the
 * single answer to "who is a player", shared by the Players tab and the mail
 * queue's diagnostics instead of each deriving its own.
 *
 * Returns null on a database that predates sql/players_registry.sql, where the
 * bundle simply has no `players` key. Callers fall back to deriving the roster
 * themselves, exactly as they did before — so this can ship ahead of the SQL.
 */
export async function loadPlayersRegistry() {
    const bundle = await ready();
    if (!Array.isArray(bundle.players)) return null;
    return bundle.players.map(mapper.mapPlayerRegistryRow);
}

/**
 * The set of player names the PUBLIC site may offer — a player who appears in
 * at least one non-hidden, non-archived league and is not hidden themselves.
 *
 * This is the rule every cross-league player search already applied, each with
 * its own copy of the same nested loop (the sidebar/mobile search index, the
 * H2H opponent picker, the What-If picker, the Players tab). Four copies of one
 * rule is four chances to drift, and the same class of drift — one caller
 * counting running leagues where another counted all of them — is what let the
 * mail queue call a five-season regular an unknown player.
 *
 * Returns null on a database predating sql/players_registry.sql, so each caller
 * keeps its own derivation as the fallback and this can ship ahead of the SQL.
 * An in-LEAGUE picker is a different question and must not use this: it offers
 * that league's roster, not the site's.
 */
export async function loadVisiblePlayerNames() {
    const registry = await loadPlayersRegistry();
    if (!registry) return null;
    return new Set(registry.filter((p) => p.visibleLeagues > 0 && !p.hidden).map((p) => p.id));
}

export function getCachedPlayerMeta(name) {
    if (!_metaCache) return null;
    return _metaCache[name] || null;
}
