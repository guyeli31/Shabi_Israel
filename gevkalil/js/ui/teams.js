/**
 * teams.js — the five answer tiles, in order.
 *
 * Option N of every question is always tile N: a player matches the colour and
 * crest on their phone to the one beside the answer on the projected screen.
 * The crest files are named by colour, so swapping the artwork is a matter of
 * replacing five files in assets/teams/ and nothing here changes.
 */
import { h } from './dom.js';

export const TILES = [
    { key: 'red', label: 'אדום' },
    { key: 'blue', label: 'כחול' },
    { key: 'yellow', label: 'צהוב' },
    { key: 'black', label: 'שחור' },
    { key: 'purple', label: 'סגול' },
];

export function crest(index) {
    const tile = TILES[index];
    return h('span', { class: 'gk-crest' },
        h('img', { src: `assets/teams/${tile.key}.svg`, alt: '', draggable: 'false' }));
}

/** A tile. `text` is shown on the projected screen only — the phone gets the
 *  colour and crest alone, so `text` is omitted there and the label carries
 *  the colour name for screen readers. */
export function tile(index, { tag = 'div', text = null, ...attrs } = {}) {
    const def = TILES[index];
    return h(tag, { class: 'gk-tile', 'aria-label': text === null ? def.label : null, ...attrs,
        dataset: { tile: def.key, ...(attrs.dataset || {}) } },
        crest(index),
        text !== null && h('span', { class: 'gk-tile-text', dir: 'auto', text }));
}
