/**
 * teams.js — the five answer tiles, in order.
 *
 * Option N of every question is always tile N: a player matches the colour and
 * crest on their phone to the one beside the answer on the projected screen.
 * The crest files are named by colour, so swapping the artwork is a matter of
 * replacing five files in a set's folder (assets/teams/, assets/catan/, …)
 * and nothing here changes.
 */
import { h } from './dom.js';

export const TILES = [
    { key: 'red', label: 'אדום' },
    { key: 'blue', label: 'כחול' },
    { key: 'yellow', label: 'צהוב' },
    { key: 'black', label: 'שחור' },
    { key: 'purple', label: 'סגול' },
];

/** The mark sets a question can use (`gk_items.marks`). Each image set is a
 *  folder of five pictures named by tile colour — assets/<set>/<colour>.svg —
 *  drawn by scripts/gevkahoot-marks.mjs (the teams are the original crests).
 *  'emoji' has no folder: the author picks one per answer (`symbols`), and an
 *  answer left without one falls back to the teams. */
export const MARK_SETS = [
    { key: 'teams', label: 'קבוצות' },
    { key: 'emoji', label: 'אימוג׳י' },
    { key: 'catan', label: 'קטאן' },
    { key: 'circuit', label: 'אלקטרוניקה' },
];
const IMAGE_SETS = new Set(['teams', 'catan', 'circuit']);

/** The mark on a tile: the set's emblem, or — when the question's author
 *  picked one for this answer — an emoji. The tile's COLOUR never changes, so
 *  "red is the first answer" stays true whatever the mark. */
export function crest(index, symbol = null, marks = 'teams') {
    const tile = TILES[index];
    if (symbol) return h('span', { class: 'gk-crest gk-crest--emoji', 'aria-hidden': 'true' }, h('span', { text: symbol }));
    const set = IMAGE_SETS.has(marks) ? marks : 'teams';
    return h('span', { class: 'gk-crest', dataset: { marks: set } },
        h('img', { src: `assets/${set}/${tile.key}.svg`, alt: '', draggable: 'false' }));
}

/** A tile. `text` is shown on the projected screen only — the phone gets the
 *  colour and crest alone, so `text` is omitted there and the label carries
 *  the colour name for screen readers. */
export function tile(index, { tag = 'div', text = null, symbol = null, marks = 'teams', ...attrs } = {}) {
    const def = TILES[index];
    return h(tag, { class: 'gk-tile', 'aria-label': text === null ? def.label : null, ...attrs,
        dataset: { tile: def.key, ...(attrs.dataset || {}) } },
        crest(index, symbol, marks),
        text !== null && h('span', { class: 'gk-tile-text', dir: 'auto', text }));
}
