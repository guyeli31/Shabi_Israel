/**
 * stickyShadow.js — toggle `.is-scrolled-x` on a scroll container.
 *
 * Used by sticky-column tables (A1, A2, D, E) to show a Google-style
 * right-edge drop-shadow only while the user is actually scrolling the
 * non-sticky columns under the sticky one. In static state — no shadow,
 * no visible separator between sticky and non-sticky columns.
 */

function update(el) {
    if (el.scrollLeft > 0) el.classList.add('is-scrolled-x');
    else el.classList.remove('is-scrolled-x');
}

export function attachStickyShadow(el) {
    if (!el || el.dataset.stickyShadowAttached === '1') return;
    el.dataset.stickyShadowAttached = '1';
    update(el);
    el.addEventListener('scroll', () => update(el), { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => update(el));
        ro.observe(el);
    }
}
