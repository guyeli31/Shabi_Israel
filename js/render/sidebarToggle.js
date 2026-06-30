/**
 * sidebarToggle.js — Universal sidebar hamburger toggle.
 *
 * One affordance, one behaviour, in every viewport AND every page type
 * (public site, admin panel). The same DOM (`button.site-hamburger` +
 * `div.site-backdrop`) and the same body class (`body.site-sidebar-closed`)
 * drive both `.site-sidebar` (public) and `.admin-sidebar` (admin) via the
 * shared CSS rules in css/site-sidebar.css + css/admin.css.
 *
 * Default state:
 *   • Desktop (≥ 768px) → sidebar OPEN
 *   • Mobile  (< 768px) → sidebar CLOSED (off-canvas drawer)
 *   • Resizing across the breakpoint snaps to the matching default so a
 *     half-open desktop sidebar isn't left behind after a mobile rotation.
 */

const MOBILE_MEDIA = '(max-width: 767px)';
const HAMBURGER_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

let _hamburgerEl = null;
let _backdropEl = null;

/**
 * Mount the universal hamburger + backdrop. Idempotent — calling twice
 * reuses the existing DOM.
 *
 * @param {object} [opts]
 * @param {string} [opts.ariaControlsId='site-sidebar'] — the id of the
 *        sidebar element that this button controls (for aria-controls).
 */
export function mountSidebarToggle(opts = {}) {
    if (_hamburgerEl) return;

    const hamburger = document.createElement('button');
    hamburger.className = 'site-hamburger';
    hamburger.type = 'button';
    hamburger.setAttribute('aria-label', 'Toggle navigation');
    hamburger.setAttribute('aria-controls', opts.ariaControlsId || 'site-sidebar');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.innerHTML = HAMBURGER_SVG;
    _hamburgerEl = hamburger;
    document.body.appendChild(hamburger);

    const backdrop = document.createElement('div');
    backdrop.className = 'site-backdrop';
    _backdropEl = backdrop;
    document.body.appendChild(backdrop);

    hamburger.addEventListener('click', toggleSidebar);
    backdrop.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isMobile() && !document.body.classList.contains('site-sidebar-closed')) {
            closeSidebar();
        }
    });

    if (isMobile()) document.body.classList.add('site-sidebar-closed');
    syncAria();

    const mq = window.matchMedia(MOBILE_MEDIA);
    const onChange = ev => {
        if (ev.matches) document.body.classList.add('site-sidebar-closed');
        else            document.body.classList.remove('site-sidebar-closed');
        syncAria();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
}

export function isMobile() { return window.matchMedia(MOBILE_MEDIA).matches; }

export function toggleSidebar() {
    document.body.classList.toggle('site-sidebar-closed');
    syncAria();
}

export function closeSidebar() {
    document.body.classList.add('site-sidebar-closed');
    syncAria();
}

export function openSidebar() {
    document.body.classList.remove('site-sidebar-closed');
    syncAria();
}

function syncAria() {
    if (!_hamburgerEl) return;
    const isOpen = !document.body.classList.contains('site-sidebar-closed');
    _hamburgerEl.setAttribute('aria-expanded', String(isOpen));
}
