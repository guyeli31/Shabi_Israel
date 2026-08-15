/**
 * nameDisplay.js — Global preference: render player names as 'username'
 * (the name as it appears in the CSV) or as the player's 'full' name from
 * players_metadata.json. Default = 'username'.
 *
 * The preference is consulted by playerNameLink() so every place that emits
 * a player anchor reflects the choice without per-call argument plumbing.
 */

import { getCachedPlayerMeta } from '../data/store.js';

const STORAGE_KEY = 'shabi-name-display';
const VALID = new Set(['username', 'full']);

export function getNameDisplayMode() {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : 'username';
}

export function setNameDisplayMode(mode) {
    if (!VALID.has(mode)) return;
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent('namedisplaychange', { detail: { mode } }));
}

/**
 * Pick the displayed string for a player given metadata.
 * Falls back to the username when full name is missing or hidden.
 *
 * When `meta` is omitted, the cached players_metadata.json is consulted
 * (sync) — so call sites in presets/charts/pickers don't have to thread
 * metadata through. Cold cache → falls back to username.
 */
export function displayPlayerName(username, meta) {
    if (getNameDisplayMode() === 'full') {
        const effectiveMeta = meta ?? getCachedPlayerMeta(username);
        const full = effectiveMeta?.fullName?.trim();
        if (full) return full;
    }
    return username;
}

/**
 * The player's OTHER name — whichever of the two forms `displayPlayerName`
 * is not currently returning. Empty string when the player has only one name.
 *
 * Every player search shows this beside the primary name and matches typing
 * against it, so a player can always be found and recognised by either form
 * regardless of which one the display preference is showing. Without it the two
 * modes were asymmetric: in 'full' mode the username was still searchable (it is
 * the option's key), while in 'username' mode the full name was searchable
 * nowhere — even on rows that were displaying it.
 */
export function alternateName(username, meta) {
    const effectiveMeta = meta ?? getCachedPlayerMeta(username);
    const full = effectiveMeta?.fullName?.trim();
    if (!full || full === username) return '';
    return getNameDisplayMode() === 'full' ? username : full;
}
