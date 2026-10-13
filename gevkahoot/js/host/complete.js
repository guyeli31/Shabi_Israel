/**
 * complete.js — "complete the picture".
 *
 * A picture with one object missing, and a row of candidate pieces. Tapping a
 * candidate drops it into the gap, on the picture itself, so the player judges
 * with their eyes — does this size sit right? — and can swap candidates as
 * often as they like before submitting. Candidate N is option N of a
 * question; that index is all the server hears.
 *
 * Each candidate is its own cut-out image with its own size: `scale` is its
 * width relative to the real object's (1 = exact), and it is drawn centred on
 * `slot`, the place the object was cut from. The row of candidates shows them
 * at their relative sizes too — they ARE the answer buttons — on the same five
 * colours every other question uses.
 *
 * The frame is sized in pixels to the picture's own proportions (as in
 * spot.js), so the gap and the piece, stored as fractions of the picture, land
 * on the same spot at any size.
 */
import { h, safeMedia } from '../ui/dom.js';
import { TILES } from '../ui/teams.js';

/**
 * @param image        the picture with the gap (a validated media path)
 * @param slot         {x, y, w, h} — the gap, in fractions of the picture
 * @param options      [{image, scale}] — the candidates
 * @param interactive  a player's copy: candidates are buttons
 * @param onSelect     called with the tapped candidate's index (not yet an answer)
 */
export function createComplete({ image, slot, options, interactive, onSelect }) {
    const picture = h('img', { class: 'cp-img', src: image, alt: '', draggable: 'false' });
    const piece = h('img', { class: 'cp-piece', alt: '', draggable: 'false', hidden: true });
    const gap = h('div', { class: 'cp-gap', 'aria-hidden': 'true', text: '?' });
    const frame = h('div', { class: 'cp-frame' }, picture, gap, piece);
    const box = h('div', { class: 'cp-stage' }, frame);
    const row = h('div', { class: 'cp-options', dataset: { n: String(options.length) } });
    const root = h('div', { class: 'cp', dataset: interactive ? { live: '' } : {} }, box, row);
    let ratio = 4 / 3;
    let selected = null;
    let locked = false;

    const cx = (slot.x + slot.w / 2) * 100, cy = (slot.y + slot.h / 2) * 100;
    gap.style.left = `${slot.x * 100}%`;
    gap.style.top = `${slot.y * 100}%`;
    gap.style.width = `${slot.w * 100}%`;
    gap.style.height = `${slot.h * 100}%`;
    piece.style.left = `${cx}%`;
    piece.style.top = `${cy}%`;

    // In the row every candidate is drawn at its size relative to the largest
    // one, so "which is bigger" is visible before trying any of them.
    const largest = Math.max(...options.map((o) => +o.scale || 1), 0.01);
    const buttons = options.map((opt, i) => {
        const src = safeMedia(opt.image);
        const thumb = src && h('img', { class: 'cp-thumb', src, alt: '', draggable: 'false' });
        if (thumb) thumb.style.height = `${Math.max(18, (+opt.scale || 1) / largest * 100)}%`;
        const el = h(interactive ? 'button' : 'div', {
            class: 'cp-opt gk-tile', type: interactive ? 'button' : null, dataset: { tile: TILES[i].key },
            'aria-label': `אפשרות ${i + 1}`,
            onclick: interactive ? () => { if (!locked) { show(i); onSelect?.(i); } } : null,
        }, thumb);
        row.append(el);
        return el;
    });

    /** Put candidate `index` into the gap (null = leave the gap open). */
    function show(index) {
        selected = index;
        const opt = index === null ? null : options[index];
        const src = opt && safeMedia(opt.image);
        piece.hidden = !src;
        gap.hidden = !!src;
        if (src) {
            if (piece.getAttribute('src') !== src) piece.setAttribute('src', src);
            piece.style.width = `${slot.w * (+opt.scale || 1) * 100}%`;
        }
        buttons.forEach((el, i) => el.toggleAttribute('data-selected', i === index));
    }

    function layout() {
        const W = box.clientWidth, H = box.clientHeight;
        if (!W || !H) return;
        const w = Math.min(W, H * ratio);
        frame.style.width = `${w}px`;
        frame.style.height = `${w / ratio}px`;
    }
    picture.addEventListener('load', () => {
        if (picture.naturalWidth && picture.naturalHeight) { ratio = picture.naturalWidth / picture.naturalHeight; layout(); }
    });
    new ResizeObserver(layout).observe(box);

    return {
        el: root,
        get selected() { return selected; },
        /** Freeze it on `picked` (this player's answer, or null if none). */
        lock(picked) {
            locked = true;
            root.toggleAttribute('data-locked', true);
            if (selected !== picked) show(picked);
            for (const el of buttons) if (el.tagName === 'BUTTON') el.disabled = true;
        },
        markPicked(picked) { buttons.forEach((el, i) => el.toggleAttribute('data-picked', picked === i)); },
        /** The reveal: the right piece goes into the picture, and the row
         *  shows which candidates were right and how the room split. */
        reveal({ correct, counts, answered, picked }) {
            locked = true;
            root.toggleAttribute('data-revealed', true);
            show(correct.length ? correct[0] : null);
            buttons.forEach((el, i) => {
                el.toggleAttribute('data-selected', false);
                el.dataset.correct = String(correct.includes(i));
                el.toggleAttribute('data-picked', picked === i);
                if (el.tagName === 'BUTTON') el.disabled = true;
                const pct = answered ? Math.round((counts[i] || 0) / answered * 100) : 0;
                el.append(h('span', { class: 'sp-pct', dir: 'ltr', text: `${pct}%` }));
            });
        },
    };
}
