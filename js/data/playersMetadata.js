/**
 * playersMetadata.js — Optional global player metadata.
 *
 * File: leagues/players_metadata.json
 * Shape: { [playerName]: { fullName?, bmabTitle?, photoPath? } }
 *
 * The file is optional — a missing/404 file resolves to {} so callers can
 * always do `meta[name] || {}`.
 */

const PATH = 'leagues/players_metadata.json';

let _cache = null;

export async function loadPlayersMetadata() {
    if (_cache) return _cache;
    try {
        const res = await fetch(PATH, { cache: 'no-store' });
        if (!res.ok) {
            _cache = {};
            return _cache;
        }
        _cache = await res.json();
        if (!_cache || typeof _cache !== 'object') _cache = {};
    } catch {
        _cache = {};
    }
    return _cache;
}

export function clearPlayersMetadataCache() {
    _cache = null;
}

/**
 * Synchronous cache accessor for callers that can't await — used by
 * `displayPlayerName` so the global "Show name as" toggle can resolve
 * the full name without each call site having to plumb metadata through.
 * Returns `null` if the metadata hasn't been loaded yet (cache cold).
 */
export function getCachedPlayerMeta(name) {
    if (!_cache) return null;
    return _cache[name] || null;
}
