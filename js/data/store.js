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

let _bundlePromise = null; // per-page-load memo, like crossLeague.js's allLeaguesPromise
let _cachedEntry = null;   // { schemaVersion, dataVersion, checkedAt, fetchedAt, bundle }
let _metaCache = null;
const _updateListeners = [];

function isFilesMode() {
    return getDataSource() === 'files';
}

// ---- persistence (localStorage, try/catch — quota/private-mode degrades
// to in-memory-only for the page's lifetime) ----
function readPersisted() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writePersisted(entry) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
        // quota exceeded or private browsing — page still works, just
        // without a cross-page cache for this session.
    }
}

async function fetchBundle() {
    const { data, error } = await supabase.rpc('get_site_bundle');
    if (error) throw new Error(`get_site_bundle failed: ${error.message}`);
    return data;
}

async function fetchServerVersion() {
    const { data, error } = await supabase.from('site_meta').select('data_version').eq('id', 1).single();
    if (error || !data) return null;
    return data.data_version;
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

/** Fire-and-forget: revalidate in the background if the last check is stale.
 *  Never blocks the caller — this is what makes warm navigation 0-blocking. */
function maybeCheckInBackground() {
    if (!_cachedEntry) return;
    if (Date.now() - _cachedEntry.checkedAt < CHECK_TTL_MS) return;
    _cachedEntry.checkedAt = Date.now();
    writePersisted(_cachedEntry);

    fetchServerVersion().then((serverVersion) => {
        if (serverVersion == null || serverVersion === _cachedEntry.dataVersion) return;
        return fetchBundle().then((bundle) => {
            _cachedEntry = toEntry(bundle);
            writePersisted(_cachedEntry);
            _bundlePromise = Promise.resolve(bundle);
            for (const cb of _updateListeners) cb(bundle);
        });
    }).catch(() => { /* best-effort revalidation; keep serving the stale copy */ });
}

/** Ensures the bundle is loaded, returns it. Cold (no cache): exactly one
 *  blocking RPC call. Warm: synchronous localStorage read, zero requests. */
function ready() {
    if (_bundlePromise) return _bundlePromise;

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

    return _bundlePromise;
}

/** Subscribe to bundle updates found by the background revalidation check
 *  (see maybeCheckInBackground). Not wired into any page's render pipeline
 *  yet — opt-in for pages that want live refresh; see 01-architecture.md §A3. */
export function onUpdate(cb) {
    _updateListeners.push(cb);
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
