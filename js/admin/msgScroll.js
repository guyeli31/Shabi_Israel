/**
 * msgScroll.js — shared "reveal the staged-confirmation message" helper.
 *
 * Admin messages sit at the top of their section/panel. When the user triggers a
 * Save from far down (e.g. a match deep in the Round Editor), the message can be
 * off-screen and go unnoticed. Call this after rendering a message to bring it
 * into view — but only when it's actually off-screen, and honour reduced-motion.
 *
 * @param {HTMLElement|null} el - the message container that was just populated.
 */
export function revealMsg(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < 0 || rect.bottom > viewH) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
}
