/**
 * heroBanner.js — Canonical renderer for the hybrid hero banner.
 *
 * A single source of truth shared by the production landing header and the
 * standalone banner editor (banner-poc.html), so what you design is exactly
 * what ships. The banner is a photographic board layer (right) plus a live,
 * freely-positioned layer of a logo + arbitrary text elements (left).
 *
 * Config shape (also what the editor's SAVE serialises):
 *   {
 *     version: 1,
 *     photo: "assets/logo/board-clean.jpg",
 *     logo:  { src, size, x, y, show },
 *     els: [ { text, font, weight, size, italic, upper, tracking,
 *              color, accent, accentWord, x, y } ]
 *   }
 * Positions x/y are percentages of the banner box. Sizes are "design px" at
 * DESIGN_W wide; renderHeroBanner scales them by the banner's actual width.
 */

export const DESIGN_W = 1100;
export const BANNER_STORAGE_KEY = 'shabi-banner-config';
export const BANNER_CONFIG_PATH = 'assets/banner/banner-config.json';
// The banner is decorative; its config fetch must fail fast rather than hang
// the (now-decoupled) banner render on a stuck mobile connection.
const BANNER_FETCH_TIMEOUT_MS = 6000;

/* Base banner aspect = the source board crop (1983×560). Any extra height comes
   from config.heightAdd (design px at DESIGN_W, added to the banner top+bottom).
   Keep this ratio in sync with the aspect-ratio fallback in hero-banner.css. */
const HERO_BASE_RATIO = 560 / 1983;

/* The banner's fonts used to be fetched at runtime: this module built a
   fonts.googleapis.com URL from the families a config used and injected a
   <link> (plus two preconnects) into <head>. That was one third-party request
   on every landing-page load, disclosing each visitor's IP and user-agent to
   Google — for a font we can simply ship ourselves.

   Every family the banner editor offers is now self-hosted and declared in
   css/fonts.css, which index.html loads. So there is nothing to fetch and no
   per-config font logic left: a `font` value in banner-config.json just has
   to name a family that css/fonts.css declares.

   To add a family to the editor: add its spec to SPECS in
   scripts/fetch-fonts.js, re-run it, and commit the generated files. Do NOT
   reintroduce a runtime fetch. */

function buildLogo(logo, scale) {
    const img = document.createElement('img');
    img.className = 'hero-el hero-logo';
    img.src = logo.src || 'assets/logo/logo.png';
    img.alt = '';
    img.style.left = (logo.x ?? 4) + '%';
    img.style.top = (logo.y ?? 50) + '%';
    const size = (logo.size ?? 108) * scale;
    img.style.height = size + 'px';
    img.style.width = size + 'px';
    return img;
}

function buildEl(el, scale) {
    const n = document.createElement('div');
    n.className = 'hero-el';
    n.style.left = (el.x ?? 20) + '%';
    n.style.top = (el.y ?? 50) + '%';
    n.style.fontFamily = el.font || "'Montserrat', sans-serif";
    n.style.fontWeight = el.weight ?? 700;
    n.style.fontSize = ((el.size ?? 24) * scale) + 'px';
    n.style.fontStyle = el.italic ? 'italic' : 'normal';
    n.style.textTransform = el.upper ? 'uppercase' : 'none';
    n.style.letterSpacing = el.tracking || 'normal';
    n.style.color = el.color || 'var(--color-text)';

    const text = el.text ?? '';
    if (el.accent && el.accentWord && text.includes(el.accentWord)) {
        const parts = text.split(el.accentWord);
        n.append(document.createTextNode(parts[0]));
        const s = document.createElement('span');
        s.textContent = el.accentWord;
        s.style.color = 'var(--color-accent)';
        n.append(s);
        n.append(document.createTextNode(parts.slice(1).join(el.accentWord)));
    } else {
        n.textContent = text;
    }
    return n;
}

/**
 * Render (or re-render) the banner into a `.hero-banner` element.
 * Rebuilds the photo + content layers from `config`. Safe to call on resize.
 */
export function renderHeroBanner(bannerEl, config) {
    if (!bannerEl || !config) return;
    bannerEl.innerHTML = '';

    const photo = document.createElement('div');
    photo.className = 'hero-photo';
    photo.setAttribute('aria-hidden', 'true');
    if (config.photo) photo.style.backgroundImage = `url('${config.photo}')`;
    bannerEl.appendChild(photo);

    const layer = document.createElement('div');
    layer.className = 'hero-layer';
    bannerEl.appendChild(layer);

    const w = bannerEl.getBoundingClientRect().width || DESIGN_W;
    const scale = w / DESIGN_W;

    // Height = base crop aspect (1983×560) + the config's extra height (design px
    // at DESIGN_W, scaled by width so it stays proportional). Overrides the CSS
    // aspect-ratio/max-height. min-height in CSS still clamps very small widths.
    const add = Math.max(0, Number(config.heightAdd) || 0) * scale;
    bannerEl.style.height = Math.round(w * HERO_BASE_RATIO + add) + 'px';
    bannerEl.style.maxHeight = 'none';

    if (config.logo && config.logo.show !== false) layer.appendChild(buildLogo(config.logo, scale));
    (config.els || []).forEach(el => layer.appendChild(buildEl(el, scale)));
}

/**
 * Load the saved banner config. The committed JSON file is the single source
 * of truth (works across ports, browsers and devices); a localStorage draft is
 * only an offline fallback if the file can't be fetched. Returns null when
 * nothing is saved — callers then keep the classic logo/title header.
 */
export async function loadBannerConfig() {
    try {
        const res = await fetch(BANNER_CONFIG_PATH, {
            cache: 'no-store',
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                ? AbortSignal.timeout(BANNER_FETCH_TIMEOUT_MS)
                : undefined,
        });
        if (res.ok) return await res.json();
    } catch { /* file missing / offline — try the local draft below */ }
    try {
        const draft = localStorage.getItem(BANNER_STORAGE_KEY);
        if (draft) return JSON.parse(draft);
    } catch { /* ignore malformed draft */ }
    return null;
}
