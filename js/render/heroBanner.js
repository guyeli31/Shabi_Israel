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

/* Google Fonts specs per family the editor offers — including the weight AND
   italic axes the banner actually uses (e.g. Playfair Display 400 italic for
   the credit line). Pages hosting the banner don't ship these <link>s, so the
   renderer injects exactly the families in use. `system-ui` needs no load. */
const GOOGLE_FONT_SPECS = {
    'Montserrat':        'Montserrat:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,600',
    'Poppins':           'Poppins:ital,wght@0,400;0,600;0,800;1,400',
    'Oswald':            'Oswald:wght@400;600;700',
    'Anton':             'Anton',
    'Bebas Neue':        'Bebas+Neue',
    'Rubik':             'Rubik:ital,wght@0,400;0,600;0,800;1,400',
    'Heebo':             'Heebo:wght@400;600;800',
    'Assistant':         'Assistant:wght@400;600;800',
    'Playfair Display':  'Playfair+Display:ital,wght@0,400;0,600;0,800;1,400;1,600;1,800',
};

/** Inject a single Google Fonts <link> for exactly the families this config
 *  uses. Idempotent: updates the href if the set changes, no-ops otherwise. */
function ensureBannerFonts(config) {
    const specs = new Set();
    (config.els || []).forEach(el => {
        const m = /^\s*'([^']+)'/.exec(el.font || '');
        if (m && GOOGLE_FONT_SPECS[m[1]]) specs.add(GOOGLE_FONT_SPECS[m[1]]);
    });
    if (specs.size === 0) return;

    const href = 'https://fonts.googleapis.com/css2?'
        + [...specs].map(s => 'family=' + s).join('&') + '&display=swap';

    let link = document.getElementById('hero-banner-fonts');
    if (link) { if (link.getAttribute('href') !== href) link.href = href; return; }

    if (!document.getElementById('hero-fonts-pre1')) {
        const p1 = document.createElement('link');
        p1.id = 'hero-fonts-pre1'; p1.rel = 'preconnect'; p1.href = 'https://fonts.googleapis.com';
        document.head.appendChild(p1);
        const p2 = document.createElement('link');
        p2.id = 'hero-fonts-pre2'; p2.rel = 'preconnect';
        p2.href = 'https://fonts.gstatic.com'; p2.crossOrigin = 'anonymous';
        document.head.appendChild(p2);
    }
    link = document.createElement('link');
    link.id = 'hero-banner-fonts'; link.rel = 'stylesheet'; link.href = href;
    document.head.appendChild(link);
}

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
    ensureBannerFonts(config);
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
