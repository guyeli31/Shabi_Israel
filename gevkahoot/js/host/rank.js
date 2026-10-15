/**
 * rank.js — the ranking question.
 *
 * All the answers at once, as cards in a column, and a keyword the host chose
 * ("מוקדם", "גדול"): the most <keyword> goes at the top, the least at the
 * bottom. The player drags cards up and down — the others make room, and a
 * card let go drops into the nearest place, as the puzzle's pieces do — then
 * submits. The answer is the whole order (js/scoring.js packs it into one
 * number); only the exact order scores.
 *
 * Unlike the four-colour questions, the answer's TEXT is on the card even on
 * a phone: here the words are what is being put in order, not a colour to
 * match to a projector.
 *
 * Cards are absolutely positioned in equal slots and moved with `top`, so a
 * reorder is one assignment and the CSS transition animates it.
 */
import { h } from '../ui/dom.js';
import { holdTouch } from '../ui/touch.js';
import { crest } from '../ui/teams.js';
import { TILES } from '../ui/teams.js';
import { decodeRank, encodeRank } from '../scoring.js';

/**
 * @param options      the answer texts, in their stored order (option N = tile N)
 * @param keyword      what to rank by, or '' for a plain "top to bottom"
 * @param interactive  a player's copy: cards can be dragged
 * @param onMove       called after a card is dropped somewhere new
 */
export function createRank({ options, keyword, symbols = [], marks = 'teams', interactive, onMove }) {
    const n = options.length;
    let order = options.map((_, i) => i);   // option index in each place, top first
    let locked = false;
    let moved = false;

    const cards = options.map((text, i) => h('div', {
        class: 'rk-card gk-tile', dataset: { tile: TILES[i].key },
        role: interactive ? 'listitem' : null,
    }, crest(i, symbols[i] || null, marks), h('span', { class: 'gk-tile-text', dir: 'auto', text }),
    interactive && h('span', { class: 'rk-grip', 'aria-hidden': 'true', text: '⠿' })));
    const places = options.map((_, i) => h('span', { class: 'rk-place', text: String(i + 1) }));
    const list = h('div', { class: 'rk-list', role: interactive ? 'list' : null }, cards);
    if (interactive) holdTouch(list);
    const numbers = h('div', { class: 'rk-numbers', 'aria-hidden': 'true' }, places);
    const word = keyword ? keyword.trim() : '';
    const root = h('div', { class: 'rk', dataset: interactive ? { live: '' } : {} },
        h('div', { class: 'rk-end', text: word ? `⬆ הכי ${word}` : '⬆ ראשון' }),
        h('div', { class: 'rk-body' }, numbers, list),
        h('div', { class: 'rk-end', text: word ? `⬇ הכי פחות ${word}` : '⬇ אחרון' }));
    const summary = h('p', { class: 'sl-summary', hidden: true });
    root.append(summary);
    // Shown once the cards stand in the right order — so that order is read
    // as THE answer, not as the player's own.
    const truth = h('div', { class: 'rk-truth', hidden: true, text: '✓ הסדר הנכון' });
    root.prepend(truth);

    const slotTop = (place) => `calc(${place} * 100% / ${n})`;
    function place() {
        order.forEach((opt, p) => {
            const card = cards[opt];
            if (card.dataset.dragging === undefined) card.style.top = slotTop(p);
            card.style.height = `calc(100% / ${n} - var(--rk-gap))`;
        });
    }
    place();

    // ---- dragging ------------------------------------------------------------
    if (interactive) {
        cards.forEach((card, opt) => {
            let startY = 0, startPlace = 0, pitch = 0;
            card.addEventListener('pointerdown', (e) => {
                if (locked) return;
                e.preventDefault();
                card.setPointerCapture(e.pointerId);
                card.dataset.dragging = '';
                startY = e.clientY;
                startPlace = order.indexOf(opt);
                pitch = list.clientHeight / n;
            });
            card.addEventListener('pointermove', (e) => {
                if (card.dataset.dragging === undefined) return;
                const dy = e.clientY - startY;
                // The card follows the finger; when its centre crosses into
                // another place, the cards between shift to make room.
                const want = Math.max(0, Math.min(n - 1, Math.round(startPlace + dy / pitch)));
                const now = order.indexOf(opt);
                if (want !== now) {
                    order.splice(now, 1);
                    order.splice(want, 0, opt);
                    place();
                }
                card.style.top = `calc(${slotTop(startPlace)} + ${dy}px)`;
            });
            const drop = () => {
                if (card.dataset.dragging === undefined) return;
                delete card.dataset.dragging;
                const changed = order.indexOf(opt) !== startPlace;
                place();
                if (changed) { moved = true; onMove?.(encodeRank(order)); }
            };
            card.addEventListener('pointerup', drop);
            card.addEventListener('pointercancel', drop);
        });
    }

    function show(code) {
        const o = decodeRank(code, n);
        if (o) { order = o; place(); }
    }

    return {
        el: root,
        /** The order to submit, as its code. Submitting the starting order is allowed. */
        get selected() { return encodeRank(order); },
        get moved() { return moved; },
        lock(picked) {
            locked = true;
            root.toggleAttribute('data-locked', true);
            if (picked !== null && picked !== undefined) show(picked);
        },
        markPicked() {},
        /** The reveal. A player first sees THEIR order, each card ✓/✕ for
         *  whether it stood in its right place; a moment later the cards slide
         *  into the right order under "הסדר הנכון", and every card that was
         *  elsewhere says where the player had put it. The projected screen
         *  goes straight to the right order. */
        reveal({ correct = [], right = 0, answered = 0, picked = null }) {
            locked = true;
            root.toggleAttribute('data-revealed', true);
            const mine = picked === null || picked === undefined ? null : decodeRank(picked, n);
            const known = correct.length === n;
            cards.forEach((card, opt) => {
                if (mine && known) card.dataset.ok = String(mine.indexOf(opt) === correct.indexOf(opt));
            });
            const showTruth = () => {
                if (!known) return;
                order = [...correct]; place();
                truth.hidden = false;
                if (mine) cards.forEach((card, opt) => {
                    if (card.dataset.ok === 'false' && !card.querySelector('.rk-was')) {
                        card.append(h('span', { class: 'rk-was', text: `אצלך: מקום ${mine.indexOf(opt) + 1}` }));
                    }
                });
            };
            if (mine && known) { order = [...mine]; place(); setTimeout(showTruth, 1800); }
            else showTruth();
            summary.hidden = false;
            summary.textContent = answered
                ? `${right === 1 ? 'אחד' : right} מתוך ${answered} סידרו בדיוק נכון`
                : 'אף אחד לא הספיק לסדר';
        },
    };
}
