/**
 * supabasePlayersMetadata.js — Supabase-backed equivalent of playersMetadata.js.
 *
 * Public read-path only (admin still reads leagues/players_metadata.json via
 * the original playersMetadata.js, unaffected by this file). Same keyed-object
 * shape and the same synchronous cache-accessor pattern nameDisplay.js depends on.
 */

import { supabase } from './supabaseClient.js';

let _cache = null;

export async function loadPlayersMetadata() {
    if (_cache) return _cache;
    const { data, error } = await supabase.from('players_metadata').select('*');
    if (error || !data) {
        _cache = {};
        return _cache;
    }
    _cache = {};
    for (const row of data) {
        _cache[row.id] = {
            fullName: row.full_name || undefined,
            bmabTitle: row.bmab_title || undefined,
            championshipTitles: row.championship_titles || [],
            hidden: row.hidden === true,
            photoPath: row.photo_path || undefined,
            inactive: row.inactive === true,
            joined: row.joined || undefined,
        };
    }
    return _cache;
}

export function clearPlayersMetadataCache() {
    _cache = null;
}

/** Synchronous cache accessor — mirrors playersMetadata.js's getCachedPlayerMeta.
 *  Returns null if the metadata hasn't been loaded yet (cache cold). */
export function getCachedPlayerMeta(name) {
    if (!_cache) return null;
    return _cache[name] || null;
}
