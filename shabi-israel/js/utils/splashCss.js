/**
 * splashCss.js — turns a splash config into the stylesheet that makes the
 * saved design correct on the FIRST PAINT.
 *
 * The config also travels as JSON, but that fetch measured ~330ms — long
 * enough for the splash to appear in css/splash.css's fallback design and
 * then visibly restyle itself. So the visual half of the config is emitted
 * as `--sp-*-cfg` custom properties on :root, linked from every page's
 * <head> ahead of any script.
 *
 * Deliberately free of Node and DOM APIs: both the browser (splash-poc.html,
 * on Save) and Node (scripts/build-splash-css.js) import this module, so the
 * editor's output and a rebuild from the committed JSON can never drift.
 */

/** The JSON key → CSS custom property mapping, and the only definition of it. */
export const CSS_VAR_MAP = [
    ['veil',       '--sp-veil-cfg',   v => v + '%'],
    ['blurPx',     '--sp-blur-cfg',   v => v + 'px'],
    ['accentLift', '--sp-lift-cfg',   v => v + '%'],
    ['altShade',   '--sp-alt-cfg',    v => v + '%'],
    ['squares',    '--sp-n-cfg',      v => String(v)],
    ['tightness',  '--sp-tight-cfg',  v => String(v)],
    ['ringScale',  '--sp-scale-cfg',  v => String(v)],
    ['logoScale',  '--sp-logo-cfg',   v => String(v)],
    ['cornerPct',  '--sp-corner-cfg', v => String(v)],
    ['pop',        '--sp-pop-cfg',    v => String(v)],
    ['cycleSec',   '--sp-cycle-cfg',  v => v + 's']
];

/** Path every page links, and the editor writes. */
export const SPLASH_CSS_PATH = 'assets/splash/splash-vars.css';

export function splashCss(cfg) {
    const lines = CSS_VAR_MAP
        .filter(([key]) => cfg[key] !== undefined && cfg[key] !== null)
        .map(([key, cssVar, fmt]) => `    ${cssVar}: ${fmt(cfg[key])};`);

    return `/* GENERATED — do not edit.
 * Source: assets/splash/splash-config.json
 * Rebuild: node scripts/build-splash-css.js
 *
 * Linked from every page's <head> so the saved splash design is in effect on
 * the first paint, instead of arriving ~330ms later with the JSON and
 * restyling the loading screen in front of the user. See css/splash.css.
 */
:root {
${lines.join('\n')}
}
`;
}
