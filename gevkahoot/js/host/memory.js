/**
 * memory.js — the memory question's picture and its arrows.
 *
 * The picture is shown for the host's number of seconds, then taken away and
 * the question asked. At the reveal it comes back with the arrows the host
 * drew in the editor — as many as they like — pointing at what was asked about.
 *
 * An arrow is { x1, y1, x2, y2 }: tail to tip, as fractions of the picture.
 * They are drawn in an SVG laid exactly over the picture's own pixels and
 * given a viewBox in the picture's natural size, so a head keeps its shape
 * whatever the picture's proportions (a 0-1 viewBox stretched over a wide
 * picture would squash it). The editor draws them with the same code.
 */
import { h, svgEl } from '../ui/dom.js';

/** One arrow's shapes, for a picture of natural size w × hgt. `live` animates
 *  it in: the shaft draws itself, the head lands, the tip pulses. */
export function arrowShapes(arrow, w, hgt, { live = true } = {}) {
    const x1 = arrow.x1 * w, y1 = arrow.y1 * hgt, x2 = arrow.x2 * w, y2 = arrow.y2 * hgt;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const sw = Math.max(4, Math.min(w, hgt) * 0.016);          // shaft width
    const head = Math.min(sw * 4.2, len * 0.6);                  // head length
    const bx = x2 - ux * head, by = y2 - uy * head;              // head base centre
    const px = -uy * head * 0.62, py = ux * head * 0.62;
    const headPts = `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
    const shaft = `M${x1},${y1} L${bx + ux * sw * 0.5},${by + uy * sw * 0.5}`;
    return svgEl('g', { class: live ? 'mm-arrow mm-arrow--live' : 'mm-arrow' },
        live && svgEl('circle', { class: 'mm-ping', cx: x2, cy: y2, r: sw * 2.4 }),
        // A dark edge under a bright fill: readable on a pale sky and on night.
        svgEl('path', { d: shaft, class: 'mm-shaft-edge', 'stroke-width': sw * 1.7, pathLength: 1 }),
        svgEl('polygon', { points: headPts, class: 'mm-head-edge', 'stroke-width': sw * 0.7 }),
        svgEl('path', { d: shaft, class: 'mm-shaft', 'stroke-width': sw, pathLength: 1 }),
        svgEl('polygon', { points: headPts, class: 'mm-head' }));
}

/** The picture, with its arrows over it (none: just the picture). */
export function memoryPicture(src, arrows, { live = true, className = 'st-media-el' } = {}) {
    const img = h('img', { class: className, src, alt: '', draggable: 'false' });
    const svg = svgEl('svg', { class: 'mm-overlay', 'aria-hidden': 'true' });
    const wrap = h('div', { class: 'mm-pic' }, img, svg);
    const draw = () => {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const w = img.naturalWidth || 800, hgt = img.naturalHeight || 600;
        svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
        (arrows || []).forEach((a, i) => {
            const g = arrowShapes(a, w, hgt, { live });
            g.style.setProperty('--i', String(i));   // several arrive one after another
            svg.append(g);
        });
    };
    // The overlay covers the img element's box, which IS the picture: the img
    // is sized by max-width / max-height only, so its box keeps the picture's
    // proportions and there is no letterbox to allow for.
    const place = () => {
        svg.style.left = `${img.offsetLeft}px`;
        svg.style.top = `${img.offsetTop}px`;
        svg.style.width = `${img.offsetWidth}px`;
        svg.style.height = `${img.offsetHeight}px`;
    };
    if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', () => { draw(); place(); }, { once: true });
    new ResizeObserver(place).observe(img);
    return { el: wrap, img, svg, redraw(next) { arrows = next; draw(); place(); } };
}
