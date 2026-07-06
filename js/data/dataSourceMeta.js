/**
 * dataSourceMeta.js — facade in front of supabasePlayersMetadata.js /
 * playersMetadata.js (the original static-file version), mirroring
 * dataSourceLoader.js. See dataSourceConfig.js for the switch mechanism.
 *
 * Each underlying module keeps its OWN in-memory cache; the facade always
 * resolves to the same implementation for the lifetime of a page load (the
 * flag doesn't change mid-session), so getCachedPlayerMeta reads from
 * whichever cache loadPlayersMetadata() actually populated — no mismatch.
 */

import { getDataSource } from './dataSourceConfig.js';
import * as supabaseImpl from './supabasePlayersMetadata.js';
import * as filesImpl from './playersMetadata.js';

function impl() {
    return getDataSource() === 'files' ? filesImpl : supabaseImpl;
}

export function loadPlayersMetadata(...args) { return impl().loadPlayersMetadata(...args); }
export function clearPlayersMetadataCache(...args) { return impl().clearPlayersMetadataCache(...args); }
export function getCachedPlayerMeta(...args) { return impl().getCachedPlayerMeta(...args); }
