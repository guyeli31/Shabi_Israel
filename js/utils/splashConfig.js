/**
 * splashConfig.js — shared contract between the Splash Editor
 * (splash-poc.html) and the runtime splash (js/utils/splash.js).
 *
 * Same pattern as the hero banner: the committed JSON file is the source
 * of truth so any port/device sees the saved design, with a localStorage
 * draft layered on top for instant same-origin preview while editing.
 */

export const SPLASH_CONFIG_PATH  = 'assets/splash/splash-config.json';
export const SPLASH_STORAGE_KEY  = 'shabi-splash-config';

export const DEFAULT_SPLASH_CONFIG = {
    version:     1,
    squares:     24,      // ticks around the ring — 24 = a clock face
    tightness:   1,       // 1 = squares perfectly flush
    ringScale:   1,
    logoScale:   1,
    cornerPct:   14,      // square corner radius, % of its own side
    pop:         1.1,     // lit-square overshoot
    cycleSec:    3,       // indeterminate sweep duration
    mode:        'determinate',
    bgSource:    'header',// 'header' = --header-bg pair, 'page' = --color-bg pair
    accentLift:  35,      // % the accent is blended toward the ink
    altShade:    0,       // % the non-accent square is shaded toward the canvas
    veil:        66,      // % of the splash's own colour laid over the page.
                          // Lower = more of the site reads through. Below ~55
                          // the copy starts losing contrast on light themes —
                          // check with the "site behind" toggle in the editor.
    blurPx:      22,      // backdrop blur. Does the legibility work the veil
                          // gives up: destroys detail, keeps colour + shape.
    showSteps:   true,
    showDetail:  true,
    eyebrow:     'Shabi Israel',
    slowAfterMs: 8000
};

/**
 * The load stages, in order. These map 1:1 onto the awaited promises in
 * the page renderers — keep them in sync when the data path changes, or
 * the splash will narrate work the app is no longer doing.
 *
 * `ms` is only used by the editor's simulated playback.
 */
export const SPLASH_STAGES = [
    { key: 'connect',  label: 'Connecting to the database',    chip: 'Connect',  ms:  700 },
    { key: 'settings', label: 'Loading league settings',       chip: 'Settings', ms:  600 },
    { key: 'matches',  label: 'Fetching match history',        chip: 'Matches',  ms: 1500 },
    { key: 'players',  label: 'Loading player profiles',       chip: 'Players',  ms:  800 },
    { key: 'ranking',  label: 'Computing rankings, PR & luck', chip: 'Ranking',  ms: 1100 },
    { key: 'render',   label: 'Rendering tables',              chip: 'Render',   ms:  600 }
];

/** localStorage draft first (live editing), then the committed file. */
export async function loadSplashConfig() {
    try {
        const draft = localStorage.getItem(SPLASH_STORAGE_KEY);
        if (draft) return JSON.parse(draft);
    } catch { /* ignore a corrupt draft and fall through to the file */ }

    try {
        const res = await fetch(SPLASH_CONFIG_PATH, { cache: 'no-store' });
        if (res.ok) return await res.json();
    } catch { /* no committed config yet — defaults apply */ }

    return null;
}

/** Push a config onto a .splash element and its .sp-ring. */
export function applySplashConfig(splashEl, ringEl, cfg) {
    const c = { ...DEFAULT_SPLASH_CONFIG, ...cfg };

    splashEl.dataset.bg = c.bgSource;
    splashEl.style.setProperty('--sp-lift', c.accentLift + '%');
    splashEl.style.setProperty('--sp-alt',  c.altShade + '%');
    splashEl.style.setProperty('--sp-veil', c.veil + '%');
    splashEl.style.setProperty('--sp-blur', c.blurPx + 'px');

    ringEl.dataset.mode = c.mode;
    ringEl.style.setProperty('--n',      c.squares);
    ringEl.style.setProperty('--tight',  c.tightness);
    ringEl.style.setProperty('--scale',  c.ringScale);
    ringEl.style.setProperty('--logo',   c.logoScale);
    ringEl.style.setProperty('--corner', c.cornerPct);
    ringEl.style.setProperty('--pop',    c.pop);
    ringEl.style.setProperty('--cycle',  c.cycleSec + 's');
}

/**
 * (Re)build the squares. Square 0 sits at 12 o'clock; the rest run
 * clockwise. Only the angle and index are written here — the side length
 * is derived in CSS from --n, so this never needs a resize handler.
 */
export function buildRing(ringEl, n) {
    ringEl.querySelectorAll('.sq').forEach(el => el.remove());
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
        const sq = document.createElement('div');
        sq.className = 'sq';
        sq.style.setProperty('--i', i);
        sq.style.setProperty('--a', (i * 360 / n).toFixed(4) + 'deg');
        frag.appendChild(sq);
    }
    ringEl.insertBefore(frag, ringEl.firstChild);
}
