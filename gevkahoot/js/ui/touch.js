/**
 * touch.js — dragging on a phone, and the page's zoom while playing.
 *
 * `touch-action: none` in the CSS is what tells a browser "this area's
 * touches are the page's, not a scroll or a zoom" — and iOS Safari does not
 * always honour it: a sideways drag on the slider moved nothing, and a pinch
 * that zoomed the page in over the puzzle could not be undone, because every
 * touch then landed on the puzzle and the puzzle kept them. The one thing
 * every browser honours is a cancelled `touchmove`, so each drag area goes
 * through holdTouch() as well as its CSS.
 *
 * The page is not zoomable while a quiz is being played (lockZoom): nothing on
 * it needs zooming — the stage scales itself — and a zoomed page leaves part of
 * a question off the screen. If it got zoomed anyway (before the lock, or by a
 * browser that ignores it), resetZoom() brings it back to 1.
 */

/** Keep a drag area's touches from scrolling or zooming the page. */
export function holdTouch(el) {
    el.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}

let locked = false;
/** No pinch or double-tap zoom on the player's page while `on`. */
export function lockZoom(on) {
    if (on === locked) return;
    locked = on;
    document.documentElement.toggleAttribute('data-nozoom', on);
    if (on) resetZoom();
}
// WebKit's own pinch events; cancelling them is what stops a pinch in Safari.
for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, (e) => { if (locked) e.preventDefault(); }, { passive: false });
}
// A pinch elsewhere (two fingers on the page) is a zoom: refuse it too.
document.addEventListener('touchmove', (e) => { if (locked && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });

/** Back to scale 1: the viewport is briefly capped at 1, which iOS obeys at once. */
export function resetZoom() {
    const vv = window.visualViewport;
    if (!vv || vv.scale <= 1.01) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const was = meta.getAttribute('content');
    meta.setAttribute('content', `${was}, maximum-scale=1`);
    setTimeout(() => meta.setAttribute('content', was), 300);
}
