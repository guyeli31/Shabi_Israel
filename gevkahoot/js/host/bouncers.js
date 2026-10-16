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
 * Besides a media sprite there are BUILT-IN animations (anim_sprite =
 * 'builtin:<name>'): a set of pictures in assets/, one copy of each in turn,
 * which may also spin. The gnomes (scripts/gevkahoot-gnomes.mjs) drift like the
 * shapes behind a Kahoot! lobby, each turning on itself.
 *
 * It is decoration and never part of the game: no pointer events, hidden from
 * assistive technology, and still for anyone who asked for reduced motion.
 */
import { h, clear, safeMedia } from '../ui/dom.js';

export const BUILTIN_ANIMS = {
    'builtin:gnomes': {
        label: '🧙 גמדים צבעוניים (מובנה)',
        srcs: ['red', 'blue', 'yellow', 'green', 'purple', 'orange'].map((c) => `assets/gnomes/${c}.svg`),
        spin: true,
    },
};

export function createBouncers(stage) {
    const layer = h('div', { class: 'st-anim', 'aria-hidden': 'true' });
    stage.append(layer);

    let config = null;   // { sprite, count, size, speed, front } or null
    let key = '';
    let bodies = [];     // { el, x, y, vx, vy, rot, vr } — x/y are the centre, 0..1 of the stage
    let spin = false;    // the copies turn on themselves (a built-in set that asks for it)
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
            b.el.style.transform = `translate3d(${b.x * m.W - m.w / 2}px, ${b.y * m.H - m.h / 2}px, 0)${spin ? ` rotate(${b.rot.toFixed(1)}deg)` : ''}`;
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
            // A spinning copy needs room for its longer side in every direction.
            const reach = spin ? Math.max(m.w, m.h) / 2 : 0;
            const halfX = (reach || m.w / 2) / m.W;
            const halfY = (reach || m.h / 2) / m.H;
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
                if (spin) b.rot = (b.rot + b.vr * dt) % 360;
            }
            place(m);
        }
        requestAnimationFrame(frame);
    }

    function build(srcs) {
        clear(layer);
        bodies = Array.from({ length: config.count }, (_, i) => {
            const src = srcs[i % srcs.length];
            // Any direction except nearly along a wall: a copy sliding flat
            // along the top edge forever is not a bounce.
            const quadrant = Math.floor(Math.random() * 4) * Math.PI / 2;
            const angle = quadrant + (0.2 + Math.random() * 0.6) * Math.PI / 2;
            const el = h('img', { class: 'st-anim-sprite', src, alt: '', draggable: 'false' });
            layer.append(el);
            // A full turn every 2.5-6 seconds, either way round.
            const vr = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 84);
            return { el, x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8, vx: Math.cos(angle), vy: Math.sin(angle), rot: Math.random() * 360, vr };
        });
        // A copy that must set off from a known place (the puzzle's detail,
        // from where it sat in the picture).
        if (config.start) { bodies[0].x = config.start.x; bodies[0].y = config.start.y; }
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
        // blob: URL); `sprite` is a built-in set's name, or a media path and
        // validated as one.
        const builtin = next && !next.src ? BUILTIN_ANIMS[next.sprite] : null;
        const src = next && (next.src || (builtin ? next.sprite : safeMedia(next.sprite)));
        // A sprite's size is the host's 3-40% setting; a cut-out (`src`) keeps
        // the size it had in its picture, which may be larger.
        const [minSize, maxSize] = next?.src ? [1, 95] : [3, 40];
        config = src ? { ...next, count: Math.min(30, Math.max(1, next.count | 0)), size: Math.min(maxSize, Math.max(minSize, +next.size || 12)), speed: Math.min(10, Math.max(1, +next.speed || 4)) } : null;
        layer.hidden = !config;
        layer.toggleAttribute('data-front', !!config?.front);
        if (!config) { running = false; if (key) { clear(layer); bodies = []; key = ''; } return; }

        // Only a new picture or a new head-count rebuilds; size, speed and
        // layer are read live, so dragging a slider does not reshuffle them.
        const nextKey = `${src}|${config.count}|${config.start ? `${config.start.x},${config.start.y}` : ''}`;
        if (nextKey !== key) { key = nextKey; aspect = 1; spin = !!builtin?.spin; build(builtin ? builtin.srcs : [src]); }

        if (still.matches) { running = false; const m = metrics(); if (m.W && m.H) place(m); return; }
        if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    }

    return { update };
}
