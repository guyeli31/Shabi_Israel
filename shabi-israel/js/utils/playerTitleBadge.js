/**
 * playerTitleBadge.js — the ONE canonical way a player's TITLE (BMAB rank +
 * championship badges: G0 / S1 / M2 / WC / NC …) is attached to a search result.
 *
 * It does NOT re-implement the badge markup — it reuses the project-wide
 * `getTitleAbbreviationsHtml(meta)` from titleConstants.js (the same helper the
 * league/dashboard/player tables use), so a title looks identical in a search
 * dropdown as it does in a table. The `.title-abbr` CSS is already em-relative,
 * so the badge tracks the surrounding font size per the V2 principles.
 *
 * Player metadata (which carries `bmabTitle` / `championshipTitles`) is loaded
 * once and cached here; `titleHtmlFor()` is a synchronous lookup so it can be
 * called straight from a `mountSearchField` `decorate` hook. Missing metadata
 * (or a load failure) simply yields no badge.
 */

import { loadPlayersMetadata } from '../data/store.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';

let _metaPromise = null;
let _meta = {};

/**
 * Load + cache players metadata once. Fire-and-forget at a search's mount;
 * `titleHtmlFor()` reads the cache synchronously once resolved. Because the
 * combobox re-renders its list on every keystroke, an async prime still lands
 * in time for the first result the user sees.
 */
export function primeTitleMeta() {
    if (!_metaPromise) {
        _metaPromise = Promise.resolve()
            .then(loadPlayersMetadata)
            .then(m => { _meta = m || {}; return _meta; })
            .catch(() => (_meta = {}));
    }
    return _metaPromise;
}

/**
 * Compact title-badge HTML for a player name (BMAB + championships), or '' when
 * the player has no title / metadata isn't loaded yet.
 * @param {string} name
 * @returns {string} HTML (already escaped by titleConstants.js)
 */
export function titleHtmlFor(name) {
    return getTitleAbbreviationsHtml(_meta[name]);
}
