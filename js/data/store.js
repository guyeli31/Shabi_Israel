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
 * ?datasource=files still works (dataSourceConfig.js's escape hatch): every
 * exported function below delegates to the original static-file loaders in
 * that mode, unchanged from today's behavior — no bundle, no cache, no
 * version check, matching a frozen local CSV snapshot.
 */

import { supabase } from './supabaseClient.js';
import { getDataSource } from './dataSourceConfig.js';
import { mergeHistoryIntoMatches } from '../compute/matchHistory.js';
import { applyOverrides as applyOverridesPure } from './leagueLoader.js';
import * as filesImpl from './leagueLoader.js';
import { loadMatchHistory as loadMatchHistoryFromFiles } from '../compute/matchHistory.js';
import * as filesMetaImpl from './playersMetadata.js';
import * as mapper from './bundleMapper.js';

const CACHE_KEY = 'shabi:bundle:v1';
const CHECK_TTL_MS = 60_000;
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
let _metaCache = null;
const _updateListeners = [];

function isFilesMode() {
    return getDataSource() === 'files';
}

// ---- persistence (localStorage, try/catch — quota/private-mode degrades
// to in-memory-only for the page's lifetime) ----

/** Remove ONLY the bundle cache entry. Deliberately targeted (never
 *  localStorage.clear()) so analytics' sessionStorage session id and the
 *  display-preference keys are never touched. */
function evictPersisted() {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
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
    }
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

/** Fire-and-forget: revalidate in the background if the last check is stale.
 *  Never blocks the caller — this is what makes warm navigation 0-blocking. */
function maybeCheckInBackground() {
    if (!_cachedEntry) return;
    if (Date.now() - _cachedEntry.checkedAt < CHECK_TTL_MS) return;
    _cachedEntry.checkedAt = Date.now();
    writePersisted(_cachedEntry);

    fetchServerVersion().then((serverVersion) => {
        if (serverVersion == null || serverVersion === _cachedEntry.dataVersion) return;
        return fetchBundle().then((bundle) => applyNewBundle(bundle));
    }).catch(() => { /* best-effort revalidation; keep serving the stale copy */ });
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

/** Register a page's re-render function to run when the tab becomes visible
 *  again (or is restored from bfcache) AND either the data changed on the
 *  server or a previously-failed load can now succeed. This is what makes a tab
 *  left open for hours self-heal: on return it silently version-checks and,
 *  only if something actually changed, refreshes the bundle and re-renders in
 *  place (scroll preserved). The trigger is return-to-visible, never a timer —
 *  a tab the user is actively looking at is never yanked out from under them.
 *  The first caller installs the listeners; later callers just add a handler. */
export function onVisibleRevalidate(reRenderFn) {
    if (isFilesMode()) return; // files mode has no server to revalidate against
    if (typeof reRenderFn === 'function') _revalidateHandlers.push(reRenderFn);
    if (_autoRevalidateInit) return;
    _autoRevalidateInit = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runRevalidate();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) runRevalidate();
    });
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
    if (_revalidating) return; // coalesce overlapping triggers (visibility + pageshow)
    _revalidating = true;
    try {
        let changed = false;
        if (!_cachedEntry) {
            // Previous load failed or never completed — attempt it now. Success
            // heals a page stuck on its error/spinner with no manual refresh
            // (the exact symptom that started this work).
            try { await ready(); changed = !!_cachedEntry; }
            catch { changed = false; }
        } else {
            // Have data: TTL-gate the version check so rapid alt-tabbing doesn't
            // spam it. The failure-heal branch above is deliberately NOT gated —
            // a broken page should retry on every return.
            if (Date.now() - _cachedEntry.checkedAt < CHECK_TTL_MS) return;
            const serverVersion = await fetchServerVersion();
            if (serverVersion != null && serverVersion !== _cachedEntry.dataVersion) {
                try { applyNewBundle(await fetchBundle()); changed = true; }
                catch { /* keep serving the stale copy */ }
            } else {
                _cachedEntry.checkedAt = Date.now(); // record the successful check
                writePersisted(_cachedEntry);
            }
        }
        if (!changed) return;
        // Clear sibling memos (applyNewBundle already did for the data-changed
        // path; the heal-from-failure path above went through ready(), so do it
        // here too) before asking each page to re-render from fresh data.
        invalidateSiblingMemos();
        await rerenderAll();
    } finally {
        _revalidating = false;
    }
}

/** Re-run every registered page re-render handler, preserving scroll position
 *  across the DOM rebuild. Shared by the visibility revalidation and the
 *  cross-tab storage adoption below. */
async function rerenderAll() {
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

export function setLeaguesBase() {} // no-op compat shim, matches supabaseLoader.js/leagueLoader.js

export async function loadLandingSettings() {
    if (isFilesMode()) return filesImpl.loadLandingSettings();
    const bundle = await ready();
    return mapper.mapLandingSettingsRow(bundle.landing_settings);
}

export async function loadLeagueOrder() {
    const settings = await loadLandingSettings();
    return settings.displayOrder;
}

export async function loadLeagueParams(leagueId) {
    if (isFilesMode()) return filesImpl.loadLeagueParams(leagueId);
    const bundle = await ready();
    const row = bundle.leagues.find((l) => l.id === leagueId);
    if (!row) throw new Error(`Failed to load params for "${leagueId}"`);
    return mapper.mapLeagueRow(row);
}

export async function loadLeagueMatches(leagueId) {
    if (isFilesMode()) return filesImpl.loadLeagueMatches(leagueId);
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
    if (isFilesMode()) return filesImpl.loadLeagueMatchesAll(leagueId);
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
    if (isFilesMode()) return filesImpl.loadOverrides(leagueId);
    const bundle = await ready();
    return bundle.manual_overrides.filter((o) => o.league_id === leagueId).map(mapper.mapOverrideRow);
}

export async function loadMatchHistory(leagueId) {
    if (isFilesMode()) return loadMatchHistoryFromFiles(leagueId);
    const bundle = await ready();
    const matches = bundle.match_history.filter((h) => h.league_id === leagueId).map(mapper.mapHistoryRow);
    return { matches };
}

export function applyOverrides(matches, overrides) {
    return applyOverridesPure(matches, overrides);
}

export async function loadLeague(leagueId) {
    if (isFilesMode()) return filesImpl.loadLeague(leagueId);

    const [params, matchData, overrides, history] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId),
        loadOverrides(leagueId),
        loadMatchHistory(leagueId),
    ]);
    const withOverrides = applyOverridesPure(matchData.matches, overrides);
    const mergedMatches = mergeHistoryIntoMatches(withOverrides, history.matches);

    return {
        id: leagueId,
        params,
        matches: mergedMatches,
        lastModified: params.LastUpdated || null,
        totalPlayers: matchData.totalPlayers,
        allPlayers: matchData.allPlayers,
        history,
    };
}

export async function loadAllLeagueParams(leagueIds) {
    if (isFilesMode()) return filesImpl.loadAllLeagueParams(leagueIds);
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
    if (isFilesMode()) return filesImpl.loadLeaguesBulk(leagueIds);
    await ready(); // ensure the shared bundle is loaded before the per-league loop below
    const results = new Map();
    for (const leagueId of leagueIds) {
        try {
            results.set(leagueId, await loadLeague(leagueId));
        } catch {
            // league row missing from the bundle — matches loadLeague() throwing
            // + the legacy Promise.allSettled-based filtering in leagueLoader.js.
        }
    }
    return results;
}

// ---- players_metadata ----

export async function loadPlayersMetadata() {
    if (isFilesMode()) return filesMetaImpl.loadPlayersMetadata();
    if (_metaCache) return _metaCache;
    const bundle = await ready();
    _metaCache = {};
    for (const row of bundle.players_metadata) {
        _metaCache[row.id] = mapper.mapPlayerMetaRow(row);
    }
    return _metaCache;
}

export function clearPlayersMetadataCache() {
    if (isFilesMode()) return filesMetaImpl.clearPlayersMetadataCache();
    _metaCache = null;
}

export function getCachedPlayerMeta(name) {
    if (isFilesMode()) return filesMetaImpl.getCachedPlayerMeta(name);
    if (!_metaCache) return null;
    return _metaCache[name] || null;
}
