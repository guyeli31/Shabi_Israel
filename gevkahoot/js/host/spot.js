/**
 * spot.js — "spot it": a picture whose answers are places in it.
 *
 * The host draws rectangles on a picture (around each face in a team photo,
 * say) and marks which are right. A player sees the picture with those
 * rectangles outlined, taps one, and confirms. Region N is simply option N of
 * a question, which is all the server ever hears about.
 *
 * The frame is sized here, in pixels, to the largest box of the picture's own
 * proportions that fits — so the rectangles, which are stored as fractions of
 * the picture, can be placed with plain percentages and stay glued to what
 * they outline at any size.
 */
import { h } from '../ui/dom.js';

/**
 * @param image        a validated media path
 * @param regions      [{x, y, w, h}] in fractions of the picture
 * @param interactive  a player's copy: regions are buttons
 * @param onSelect     called with the tapped region's index (not yet an answer —
 *                     the stage offers "submit" for the current selection)
 */
export function createSpot({ image, regions, interactive, onSelect }) {
    const img = h('img', { class: 'sp-img', src: image, alt: '', draggable: 'false' });
    const frame = h('div', { class: 'sp-frame' }, img);
    const root = h('div', { class: 'sp', dataset: interactive ? { live: '' } : {} }, frame);
    let ratio = 4 / 3;
    let selected = null;
    let locked = false;

    const boxes = regions.map((r, i) => {
        const el = h(interactive ? 'button' : 'div', {
            class: 'sp-box', type: interactive ? 'button' : null, 'aria-label': `אזור ${i + 1}`,
            onclick: interactive ? () => { if (!locked) { select(i); onSelect?.(i); } } : null,
        }, h('span', { class: 'sp-num', text: String(i + 1) }));
        // Clamp to the picture: a rectangle saved partly outside it must not
        // push the frame's edge or be unclickable off-screen.
        const x = Math.min(Math.max(+r.x || 0, 0), 1), y = Math.min(Math.max(+r.y || 0, 0), 1);
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${Math.min(+r.w || 0, 1 - x) * 100}%`;
        el.style.height = `${Math.min(+r.h || 0, 1 - y) * 100}%`;
        frame.append(el);
        return el;
    });

    function select(index) {
        selected = index;
        boxes.forEach((el, i) => el.toggleAttribute('data-selected', i === index));
    }

    function layout() {
        const W = root.clientWidth, H = root.clientHeight;
        if (!W || !H) return;
        const w = Math.min(W, H * ratio);
        frame.style.width = `${w}px`;
        frame.style.height = `${w / ratio}px`;
    }
    img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight) { ratio = img.naturalWidth / img.naturalHeight; layout(); }
    });
    new ResizeObserver(layout).observe(root);

    return {
        el: root,
        get selected() { return selected; },
        /** Freeze it on `picked` (this player's answer, or null if none). */
        lock(picked) {
            locked = true;
            root.toggleAttribute('data-locked', true);
            select(picked);
            for (const el of boxes) if (el.tagName === 'BUTTON') el.disabled = true;
        },
        /** Ring this player's own pick. Separate from reveal(): on a phone the
         *  player's answer (gk_me) can arrive a moment after the reveal itself. */
        markPicked(picked) { boxes.forEach((el, i) => el.toggleAttribute('data-picked', picked === i)); },
        /** The reveal: which regions were right, how the room split, and
         *  (for a player) which one was theirs. */
        reveal({ correct, counts, answered, picked }) {
            locked = true;
            root.toggleAttribute('data-revealed', true);
            boxes.forEach((el, i) => {
                el.dataset.correct = String(correct.includes(i));
                el.toggleAttribute('data-selected', false);
                el.toggleAttribute('data-picked', picked === i);
                if (el.tagName === 'BUTTON') el.disabled = true;
                const pct = answered ? Math.round((counts[i] || 0) / answered * 100) : 0;
                el.append(h('span', { class: 'sp-pct', dir: 'ltr', text: `${pct}%` }));
            });
        },
    };
}
