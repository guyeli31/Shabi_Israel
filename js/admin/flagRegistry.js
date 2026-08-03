/**
 * flagRegistry.js — the set of flag codes an admin can pick from.
 *
 * This used to be a hard-coded literal duplicated in leagueManager.js and
 * playerManager.js (`['BE','IL','RU','TZ','UN']`). It drifted the moment a flag
 * was uploaded: ES/GB/GE all exist in `assets/flags/` and are already in use by
 * published leagues, yet no dropdown offered them — the only way to re-pick a
 * flag a player already had was to retype it under "Custom...".
 *
 * So the list is DERIVED instead of declared, from every place a flag code can
 * legitimately come from:
 *   1. the PNGs shipped in `assets/flags/`      (BUILTIN_FLAGS below)
 *   2. the `flags` storage bucket               (codes uploaded since)
 *   3. every league's CustomFlags               (what leagues actually use)
 *   4. players_metadata defaultFlag             (a player's own flag)
 *   5. staged, not-yet-published flag uploads   (so it's pickable immediately)
 *
 * KNOWN_FLAGS is a live array shared by both admin views: `ensureFlagCodes()`
 * fills it once per session and `registerFlagCode()` appends a just-uploaded
 * code, so every table rendered afterwards sees it.
 */

import { supabase } from '../data/supabaseClient.js';
import { loadLeagueOrder, loadAllLeagueParams } from '../data/supabaseLoader.js';
import { loadPlayersMetadata } from '../data/supabasePlayersMetadata.js';
import { getChanges } from './stagingStore.js';

/** PNGs committed under assets/flags/ — the floor, always offered. */
const BUILTIN_FLAGS = ['BE', 'ES', 'GB', 'GE', 'IL', 'RU', 'TZ', 'UN'];

/** Live, shared list. Import it; don't copy it. */
export const KNOWN_FLAGS = [...BUILTIN_FLAGS];

let loaded = null; // in-flight / settled promise, so concurrent callers share one load

function add(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c || KNOWN_FLAGS.includes(c)) return;
    KNOWN_FLAGS.push(c);
}

/** Sort in place: IL (the default) first, then alphabetical. */
function resort() {
    KNOWN_FLAGS.sort((a, b) => (a === 'IL' ? -1 : b === 'IL' ? 1 : a.localeCompare(b)));
}

/**
 * Populate KNOWN_FLAGS from all five sources. Best-effort per source — a flag
 * dropdown must still render if Supabase is unreachable. Runs once per session.
 * @returns {Promise<string[]>} KNOWN_FLAGS (same array instance)
 */
export function ensureFlagCodes() {
    if (loaded) return loaded;
    loaded = (async () => {
        // 2. storage bucket
        try {
            const { data } = await supabase.storage.from('flags').list('', { limit: 1000 });
            for (const f of data || []) {
                const m = /^(.+)\.png$/i.exec(f.name || '');
                if (m) add(m[1]);
            }
        } catch { /* bucket unreadable → builtins only */ }

        // 3. every league's CustomFlags
        try {
            const ids = await loadLeagueOrder();
            const entries = await loadAllLeagueParams(ids.map(t => t.replace(' - ', ' ')));
            for (const e of entries) {
                for (const code of Object.values(e.params?.CustomFlags || {})) add(code);
            }
        } catch { /* ignore */ }

        // 4. players_metadata defaultFlag
        try {
            const meta = await loadPlayersMetadata();
            for (const m of Object.values(meta || {})) if (m?.defaultFlag) add(m.defaultFlag);
        } catch { /* ignore */ }

        // 5. staged uploads (pickable before they are published)
        try {
            for (const c of getChanges()) {
                if (c.target?.kind === 'flag_asset') add(c.target.code);
            }
        } catch { /* ignore */ }

        resort();
        return KNOWN_FLAGS;
    })();
    return loaded;
}

/** Register a code uploaded during this session so later renders can pick it. */
export function registerFlagCode(code) {
    add(code);
    resort();
}
