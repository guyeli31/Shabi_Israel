/**
 * tooltip.js — One themed hover tooltip for the whole app.
 *
 * Native `title=""` tooltips are rendered by the OS and can't be styled, so
 * hover hints used to look inconsistent (dark CSS `::after` on status dots,
 * OS tooltips on player names, etc.). This module intercepts ANY element with
 * a `title` (or `data-tooltip`) on hover/focus and shows a single popup styled
 * like `.player-context-menu` (themed surface + border + shadow), so every hover
 * hint shares one theme-aware design. It auto-covers current and future titles
 * with zero changes to the call-sites.
 *
 * Accessibility: when a native `title` is consumed it is moved to `data-tooltip`
 * (so the OS tooltip stops firing) and, for icon-only controls with no visible
 * text, copied to `aria-label` so screen readers keep the hint.
 */

const SHOW_DELAY = 120; // ms — matches a gentle hover intent
let tipEl = null;
let activeTarget = null;
let showTimer = null;

function ensureTipEl() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'app-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
}

/** Pull the tooltip text from an element, consuming a native `title` once. */
function tooltipTextFor(el) {
    const existing = el.getAttribute('data-tooltip');
    if (existing != null) return existing || null;
    const native = el.getAttribute('title');
    if (native == null || native === '') return null;
    // Consume the native title so the OS tooltip never shows.
    el.setAttribute('data-tooltip', native);
    el.removeAttribute('title');
    // Preserve the hint for screen readers on icon-only controls.
    const hasText = (el.textContent || '').trim().length > 0;
    if (!hasText && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', native);
    return native;
}

function positionTip(target) {
    const el = ensureTipEl();
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.bottom + 8;                       // default: below the element
    if (top + th > window.innerHeight - 4) {      // flip above if it would overflow
        top = r.top - th - 8;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - tw - 4)); // clamp to viewport
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
}

function show(target, text) {
    const el = ensureTipEl();
    el.textContent = text;
    el.hidden = false;
    positionTip(target);
    void el.offsetWidth;                          // reflow so the fade-in animates
    el.classList.add('app-tooltip--visible');
    activeTarget = target;
}

function hide() {
    clearTimeout(showTimer);
    if (!tipEl) return;
    tipEl.classList.remove('app-tooltip--visible');
    tipEl.hidden = true;
    activeTarget = null;
}

function handleEnter(target) {
    if (!target || target === activeTarget) return;
    const text = tooltipTextFor(target);
    if (!text) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target, text), SHOW_DELAY);
}

function onOver(e) {
    const t = e.target.closest && e.target.closest('[title], [data-tooltip]');
    if (t) handleEnter(t);
}

function onOut(e) {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t) hide();
}

function onFocusIn(e) {
    const t = e.target.closest && e.target.closest('[title], [data-tooltip]');
    if (t) { const text = tooltipTextFor(t); if (text) show(t, text); }
}

let inited = false;

/** Install the global tooltip once. Safe to call multiple times. */
export function initTooltips() {
    if (inited) return;
    inited = true;
    ensureTipEl();
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('click', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    // Hide if the key Escape is pressed (e.g. keyboard users dismissing it).
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
