/**
 * bouncers.js — the quiz's bouncing animation.
 *
 * One cut-out picture (a "sprite"), multiplied, each copy drifting across the
 * stage in a straight line and reflecting off the edges — angle in equals
 * angle out, which for an axis-aligned wall is just flipping the sign of the
 * velocity component that points into it.
 *
 * The copies are <img> elements moved with `transform`, which the compositor
 * handles without layout: thirty of them cost about what one does. Positions
 * are kept as fractions of the stage, so a resize (or the editor's scaled
 * preview) keeps every copy where it was, proportionally.
 *
 * It is decoration and never part of the game: no pointer events, hidden from
 * assistive technology, and still for anyone who asked for reduced motion.
 */
import { h, clear, safeMedia } from '../ui/dom.js';

export function createBouncers(stage) {
    const layer = h('div', { class: 'st-anim', 'aria-hidden': 'true' });
    stage.append(layer);

    let config = null;   // { sprite, count, size, speed, front } or null
    let key = '';
    let bodies = [];     // { el, x, y, vx, vy } — x/y are the centre, 0..1 of the stage
    let aspect = 1;      // sprite width / height
    let last = 0;
    let running = false;
    const still = matchMedia('(prefers-reduced-motion: reduce)');

    /** Sprite box in px, and the stage it lives in. */
    function metrics() {
        const W = stage.clientWidth;
        const H = stage.clientHeight;
        const short = Math.min(W, H);
        // `size` is the sprite's LONGER side, as a percentage of the stage's
        // shorter one — so a tall sprite and a wide one read as the same size.
        const long = short * config.size / 100;
        const w = aspect >= 1 ? long : long * aspect;
        const hgt = aspect >= 1 ? long / aspect : long;
        return { W, H, w, h: hgt };
    }

    function place(m) {
        for (const b of bodies) {
            b.el.style.width = `${m.w}px`;
            b.el.style.height = `${m.h}px`;
            b.el.style.transform = `translate3d(${b.x * m.W - m.w / 2}px, ${b.y * m.H - m.h / 2}px, 0)`;
        }
    }

    function frame(now) {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000 || 0);   // a hidden tab must not teleport them
        last = now;
        const m = metrics();
        if (m.W && m.H) {
            // Speed 1..10 → the stage's shorter side crossed in about 12s..1.2s.
            const px = Math.min(m.W, m.H) * config.speed / 12;
            const halfX = m.w / 2 / m.W;
            const halfY = m.h / 2 / m.H;
            for (const b of bodies) {
                b.x += b.vx * px * dt / m.W;
                b.y += b.vy * px * dt / m.H;
                // Reflect: put the copy back inside by the amount it overshot
                // and reverse the component that was carrying it out.
                if (b.x < halfX) { b.x = halfX + (halfX - b.x); b.vx = Math.abs(b.vx); }
                else if (b.x > 1 - halfX) { b.x = 1 - halfX - (b.x - (1 - halfX)); b.vx = -Math.abs(b.vx); }
                if (b.y < halfY) { b.y = halfY + (halfY - b.y); b.vy = Math.abs(b.vy); }
                else if (b.y > 1 - halfY) { b.y = 1 - halfY - (b.y - (1 - halfY)); b.vy = -Math.abs(b.vy); }
                b.x = Math.min(1 - halfX, Math.max(halfX, b.x));
                b.y = Math.min(1 - halfY, Math.max(halfY, b.y));
            }
            place(m);
        }
        requestAnimationFrame(frame);
    }

    function build(src) {
        clear(layer);
        bodies = Array.from({ length: config.count }, () => {
            // Any direction except nearly along a wall: a copy sliding flat
            // along the top edge forever is not a bounce.
            const quadrant = Math.floor(Math.random() * 4) * Math.PI / 2;
            const angle = quadrant + (0.2 + Math.random() * 0.6) * Math.PI / 2;
            const el = h('img', { class: 'st-anim-sprite', src, alt: '', draggable: 'false' });
            layer.append(el);
            return { el, x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8, vx: Math.cos(angle), vy: Math.sin(angle) };
        });
        const first = bodies[0].el;
        const ready = () => {
            if (first.naturalWidth && first.naturalHeight) aspect = first.naturalWidth / first.naturalHeight;
            const m = metrics();
            if (m.W && m.H) place(m);
        };
        if (first.complete) ready(); else first.addEventListener('load', ready, { once: true });
    }

    function update(next) {
        // `src` is a picture made in this browser (the puzzle's round cut-out, a
        // blob: URL); `sprite` is a media path and is validated as one.
        const src = next && (next.src || safeMedia(next.sprite));
        config = src ? { ...next, count: Math.min(30, Math.max(1, next.count | 0)), size: Math.min(40, Math.max(3, +next.size || 12)), speed: Math.min(10, Math.max(1, +next.speed || 4)) } : null;
        layer.hidden = !config;
        layer.toggleAttribute('data-front', !!config?.front);
        if (!config) { running = false; if (key) { clear(layer); bodies = []; key = ''; } return; }

        // Only a new picture or a new head-count rebuilds; size, speed and
        // layer are read live, so dragging a slider does not reshuffle them.
        const nextKey = `${src}|${config.count}`;
        if (nextKey !== key) { key = nextKey; aspect = 1; build(src); }

        if (still.matches) { running = false; const m = metrics(); if (m.W && m.H) place(m); return; }
        if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    }

    return { update };
}
