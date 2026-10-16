/**
 * slider.js — the slider question.
 *
 * The same picture-with-an-object-taken-out as "complete the picture", but one
 * piece instead of several, always drawn where the object was, and a slider
 * that sets its SIZE live on the picture. The player stops when it looks
 * right and submits. The answer is the slider's position, 0-1000; the server
 * turns it into the area deviation and the points (js/scoring.js has the
 * formula and the reasons for it).
 *
 * The slider starts at 50%, and "submit" is offered only once it has been
 * moved: a player who never touched it has not answered anything.
 *
 * An optional emoji rides on the slider's handle and grows and shrinks in the
 * same ratio as the object — the host's choice, per question (symbols[0]).
 *
 * The frame is sized in pixels to the picture's proportions (as in complete.js),
 * so the piece, positioned in fractions of the picture, lands on the same spot
 * at any size.
 */
import { h, safeMedia } from '../ui/dom.js';
import { holdTouch } from '../ui/touch.js';
import { SLIDER, sliderSize, sliderCorrect, sliderScale } from '../scoring.js';

/** Linear size of the piece at position v, relative to the real object. */
const linearAt = (v, scale) => Math.max(0, sliderSize(v, scale));
/** Where on the track position v is, as a CSS length (the handle's centre). */
const onTrack = (v) => `calc(var(--sl-thumb) / 2 + (100% - var(--sl-thumb)) * ${v / SLIDER.max})`;

/**
 * @param image        the picture with the gap (a validated media path)
 * @param slot         {x, y, w, h} — where the object was, in fractions of the picture
 * @param piece        the cut-out (a validated media path)
 * @param symbol       an emoji for the handle, or null
 * @param interactive  a player's copy: the slider moves
 * @param onMove       called with the position after the player moves it
 */
export function createSlider({ image, slot, piece, symbol, interactive, onMove, scale = null, showValue = false }) {
    // the author's scale (size at 0, where it is exact) — see js/scoring.js
    const linear = (v) => linearAt(v, scale);
    const picture = h('img', { class: 'cp-img', src: image, alt: '', draggable: 'false' });
    const shown = h('img', { class: 'cp-piece sl-piece', src: piece, alt: '', draggable: 'false' });
    // After the reveal: this player's size, as a ghost behind the real one.
    const ghost = h('img', { class: 'cp-piece sl-ghost', src: piece, alt: '', draggable: 'false', hidden: true });
    const frame = h('div', { class: 'cp-frame' }, picture, ghost, shown);
    const box = h('div', { class: 'cp-stage' }, frame);

    const input = h('input', { class: 'sl-input', type: 'range', min: '0', max: String(SLIDER.max), step: '1',
        value: String(SLIDER.start), disabled: !interactive, 'aria-label': 'גודל העצם' });
    const rider = symbol ? h('span', { class: 'sl-rider', 'aria-hidden': 'true', text: symbol }) : null;
    const marks = h('div', { class: 'sl-marks', 'aria-hidden': 'true' });
    const track = h('div', { class: 'sl-track', dir: 'ltr' }, marks, input, rider);
    // − / + step by 1% — the precise way to the very ends, where a finger or a
    // touchpad easily stops a few pixels short.
    const endBtn = (text, step, label) => h(interactive ? 'button' : 'span', {
        class: `sl-end${step > 0 ? ' sl-end--big' : ''}`, type: interactive ? 'button' : null, text,
        'aria-label': interactive ? label : null, 'aria-hidden': interactive ? null : 'true',
        onclick: interactive ? () => moveTo(Number(input.value) + step) : null });
    const control = h('div', { class: 'sl-control', dir: 'ltr' },
        endBtn('−', -10, 'קטן יותר'), track, endBtn('+', 10, 'גדול יותר'));
    const summary = h('p', { class: 'sl-summary', hidden: true });
    // The editor's try-out only (showValue): where the slider stands, and how
    // big the object is there — a player is never shown either.
    const readout = showValue ? h('p', { class: 'sl-readout', 'aria-live': 'polite' }) : null;
    const root = h('div', { class: 'cp sl', dataset: interactive ? { live: '' } : {} }, box, readout, control, summary);

    let ratio = 4 / 3;
    let moved = false;
    let locked = false;

    for (const el of [shown, ghost]) {
        el.style.left = `${(slot.x + slot.w / 2) * 100}%`;
        el.style.top = `${(slot.y + slot.h / 2) * 100}%`;
    }
    const sizeAt = (el, v) => { el.style.width = `${slot.w * linear(v) * 100}%`; };

    function set(v) {
        input.value = String(v);
        sizeAt(shown, v);
        if (readout) readout.textContent = `הסליידר ב-${Math.round(v / SLIDER.max * 100)}% · גודל העצם ${Math.round(linear(v) * 100)}% מהאמיתי`;
        if (rider) {
            rider.style.left = onTrack(v);
            // The emoji keeps the object's proportion: at the real size it is
            // its normal size, at a third of the area 58% of it.
            rider.style.transform = `translate(-50%, -50%) scale(${linear(v)})`;
        }
    }
    set(SLIDER.start);

    /** The player moved it (any way): clamp, draw, report. */
    function moveTo(v) {
        if (locked) return;
        const next = Math.max(0, Math.min(SLIDER.max, Math.round(v)));
        moved = true;
        set(next);
        onMove?.(next);
    }
    // The keyboard (arrows, Home, End) still goes through the native input.
    input.addEventListener('input', () => moveTo(Number(input.value)));

    // Dragging is handled on the whole track rather than by the native
    // handle: the press may land anywhere on it — on the emoji riding the
    // handle (drawn larger than the input's own strip), above or below it —
    // and the pointer may run past either end, which then clamps to exactly
    // 0% or 100%. The handle's centre maps to the value, as the native one does.
    if (interactive) {
        holdTouch(track);
        const valueAt = (clientX) => {
            const r = track.getBoundingClientRect();
            const t = input.offsetHeight;   // the handle's width (it is round)
            const v = ((clientX - r.left - t / 2) / Math.max(1, r.width - t)) * SLIDER.max;
            // The last 2% at either end snap to it: a finger is not a mouse,
            // and the very ends were the places a phone could not reach.
            return v <= SLIDER.max * 0.02 ? 0 : v >= SLIDER.max * 0.98 ? SLIDER.max : v;
        };
        // A FINGER is followed with touch events: iOS Safari delivers every
        // touchmove to the element the touch began on, wherever the finger
        // goes — while its pointer events for a touch could stop part-way
        // (the slider on an iPhone 17 would not reach either end). The
        // pointer path below is for a mouse or a pen, and skips touches.
        const end = () => { delete track.dataset.dragging; };
        track.addEventListener('touchstart', (e) => {
            if (locked) return;
            e.preventDefault();
            track.dataset.dragging = '';
            moveTo(valueAt(e.touches[0].clientX));
        }, { passive: false });
        track.addEventListener('touchmove', (e) => {
            if (!('dragging' in track.dataset)) return;
            e.preventDefault();
            moveTo(valueAt(e.touches[0].clientX));
        }, { passive: false });
        track.addEventListener('touchend', end);
        track.addEventListener('touchcancel', end);
        track.addEventListener('pointerdown', (e) => {
            if (locked || e.button > 0 || e.pointerType === 'touch') return;
            e.preventDefault();
            track.setPointerCapture(e.pointerId);
            track.dataset.dragging = '';
            input.focus({ preventScroll: true });
            moveTo(valueAt(e.clientX));
        });
        track.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && 'dragging' in track.dataset) moveTo(valueAt(e.clientX)); });
        track.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') end(); });
        track.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') end(); });
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

    const mark = (v, kind) => {
        const el = h('span', { class: 'sl-mark', dataset: { kind } });
        el.style.left = onTrack(v);
        marks.append(el);
    };
    let pickedShown = null;

    return {
        el: root,
        /** The position to submit — null until the slider has been moved. */
        get selected() { return moved ? Number(input.value) : null; },
        /** Freeze it on `picked` (this player's answer, or null if none). */
        lock(picked) {
            locked = true;
            input.disabled = true;
            for (const b of control.querySelectorAll('button')) b.disabled = true;
            root.toggleAttribute('data-locked', true);
            if (picked !== null && picked !== undefined && Number(input.value) !== picked) set(picked);
        },
        markPicked(picked) {
            if (picked === pickedShown || picked === null || picked === undefined) return;
            pickedShown = picked;
            marks.querySelector('[data-kind="mine"]')?.remove();
            mark(picked, 'mine');
            ghost.hidden = false;
            sizeAt(ghost, picked);
        },
        /** The reveal: the object at its real size, this player's size as a
         *  ghost, and every position the room chose marked on the track. */
        reveal({ values = [], picked = null }) {
            locked = true;
            input.disabled = true;
            for (const b of control.querySelectorAll('button')) b.disabled = true;
            root.toggleAttribute('data-revealed', true);
            const target = sliderScale(scale).target;
            set(target);
            for (const v of values) mark(v, sliderCorrect(v, scale) ? 'good' : 'room');
            mark(target, 'target');
            this.markPicked(picked);
            if (values.length) {
                const mean = values.reduce((n, v) => n + Math.abs(sliderSize(v, scale) - 1), 0) / values.length;
                const hits = values.filter((v) => sliderCorrect(v, scale)).length;
                summary.hidden = false;
                summary.textContent = `סטייה ממוצעת ${Math.round(mean * 100)}% · ${hits === 1 ? 'אחד פגע' : `${hits} פגעו`} (עד 5%)`;
            }
        },
    };
}
