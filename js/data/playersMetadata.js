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
