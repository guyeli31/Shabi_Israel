/**
 * leagueArt.js — a league TYPE's visual identity: the themed artwork behind a
 * UBC league's card on the landing page and its page header.
 *
 * ── IT IS NOT THE PROMOTION ─────────────────────────────────────────────────
 * The UBC launch announcement (js/render/promoNotice.js) happens to use the
 * same photograph, and that is the whole of the relationship. They are separate
 * things with separate lifetimes:
 *
 *   the announcement   a campaign. Self-expiring — modal and "Coming Soon"
 *                      both stop on `endsOn` and the files get deleted.
 *   this file          a property of every UBC league, including ones opened
 *                      years from now with no campaign attached at all.
 *
 * So NOTHING here reads promo-config.json, and the image is this module's own
 * copy under assets/league-art/. An earlier draft did share the promo's config
 * and its file, which read as economy and was actually a trap: editing the
 * campaign's artwork would have silently restyled every UBC league, and
 * deleting the campaign — which its own header instructs you to do — would have
 * stripped the leagues it was advertising.
 *
 * ── ADDING A TYPE ───────────────────────────────────────────────────────────
 * One entry in LEAGUE_ART below. A type with no entry gets no artwork, which is
 * the default for `doubling` and `regular`: they are the ordinary case and look
 * like the rest of the site on purpose.
 */

/** Which part of the photo survives the `cover` crop. A tall photo in a wide
 *  frame loses its top and bottom, so this is the difference between showing a
 *  face and showing a torso. Two-keyword values on purpose — a bare `top`
 *  leaves the horizontal axis to default and reads as ambiguous beside its
 *  siblings. */
export const ART_POSITIONS = [
    { id: 'top',    label: 'Top',    css: 'center 0%' },
    { id: 'upper',  label: 'Upper',  css: 'center 25%' },
    { id: 'center', label: 'Centre', css: 'center 50%' },
    { id: 'lower',  label: 'Lower',  css: 'center 75%' },
    { id: 'bottom', label: 'Bottom', css: 'center 100%' },
];
const ART_POS_DEFAULT = ART_POSITIONS.find((p) => p.id === 'center');

/**
 * The artwork each league type wears. Keyed by the `LeagueType` value in
 * league_params.json, lowercased.
 *
 * `mix` is the strength of the theme-hue layer (0–100); `blend` and `filter`
 * are the treatment applied to the photo. The values here match what the UBC
 * announcement was designed with, because that is the look that was approved —
 * they are copied, not referenced, so the two can now diverge freely.
 *
 * `card` and `hero` carry their own crop: a card is a short 240x107 landscape
 * strip and a header is a tall band, so a setting that frames the subject in
 * one crops badly in the other. This is why the scale above has five stops and
 * not three — dead centre cut above the subject, and `bottom` showed only the
 * very edge of the photo.
 *
 * `show` sets, per shape, how much of the photo's HEIGHT is visible (percent).
 * Without it the shape uses `cover`, which fits the photo's WIDTH to the frame
 * — and a portrait photo in a wide header then shows barely a fifth of itself,
 * a fraction that also shrinks as the screen widens. With it the photo is sized
 * by height instead, so the fraction holds at every width; where the photo ends
 * up narrower than the frame, a blurred `cover` copy of itself fills the sides
 * and the sharp copy fades into it. The position above still picks WHICH slice.
 */
export const LEAGUE_ART = {
    ubc: {
        image: 'assets/league-art/ubc.jpg',
        blend: 'color',
        filter: 'none',
        mix: 50,
        card: 'lower',
        hero: 'lower',
        show: { hero: 40 },
    },
};

export function leagueTypeHasArt(leagueType) {
    return !!LEAGUE_ART[String(leagueType || '').toLowerCase()];
}

/* The two themed layers, and why the photo is not simply dropped in:
     ①  the image itself
     ②  a hue layer — a --header-bg → --color-accent ramp blended into it, so
        the artwork re-tints with every theme instead of sitting in the page
        like a foreign object
   --art-mix drives ②.
   There is deliberately NO scrim (a darkening layer between photo and text).
   One existed and was removed on request: it covered up to ~90% of the photo
   and left these surfaces visibly duller than the "Coming Soon" card, which
   uses the same photo with none.

   Type on artwork runs on the --header-bg/--header-text PAIR and never on
   --color-text — on a light theme over a dark photo that would vanish.

   NO BACKTICKS anywhere below: this is a template literal, and a single one
   ends the string mid-rule. That has already happened three times in this
   project. */
const LEAGUE_ART_CSS = `
.lart-host { position: relative; overflow: hidden; isolation: isolate; }
.lart-layer { position: absolute; inset: 0; z-index: 0; }
/* Whatever the host already contained has to climb above the artwork. A child
   combinator, so nested content rides on its own parent rather than every
   descendant being lifted into a stacking context of its own. */
.lart-host > *:not(.lart-layer) { position: relative; z-index: 1; }
.lart-host, .lart-host a, .lart-host h2 { color: var(--header-text); }
/* Descendant type reads the page's text tokens, not the host's color — a
   leader line on --color-text-secondary, a stat label on --color-text-muted —
   and those are tuned for the page background, so they come out dark over the
   artwork. Re-pointing the TOKENS covers every such element at once, including
   ones added later, where a rule per class would need a new line each time.
   Set on the content, not the host: .lart-hue paints with --color-accent and
   must keep the theme's real one. */
.lart-host > *:not(.lart-layer) {
    --color-text: var(--header-text);
    --color-text-secondary: color-mix(in srgb, var(--header-text) 85%, transparent);
    --color-text-muted: color-mix(in srgb, var(--header-text) 72%, transparent);
    --color-accent: var(--header-text);
}

.lart-img {
    position: absolute; inset: 0;
    background-image: var(--lart-image, none);
    background-size: cover;
    background-position: var(--lart-pos, center);
    filter: var(--lart-filter, none);
}
/* Height-fit mode (see "show" on LEAGUE_ART). The cover image above becomes a
   blurred backdrop — scaled up so the blur's soft edge stays outside the frame
   — and an img sized by height sits over it. An img rather than another
   background, because an img's width follows its own aspect ratio, which is
   what lets the edge-fade mask land on the photo's edges and not the frame's.
   Its top is the same "lower/centre/..." percentage cover would apply:
   (frame - photo) x position. */
.lart-fit .lart-img { transform: scale(1.12); }
.lart-sharp {
    position: absolute; left: 50%;
    height: calc(100% * var(--lart-k));
    top: calc((100% - 100% * var(--lart-k)) * var(--lart-py));
    width: auto; max-width: none;
    transform: translateX(-50%);
    filter: var(--lart-sharp-filter, none);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent);
            mask-image: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent);
}
.lart-hue {
    position: absolute; inset: 0;
    background: linear-gradient(140deg, var(--header-bg), var(--color-accent));
    mix-blend-mode: var(--lart-blend, color);
    opacity: var(--lart-mix, .5);
}
`;

/* Injected from JS rather than added to a shared stylesheet, the same call
   movedNotice.js and privacyNotice.js make: removing the feature is then one
   file deletion with no orphaned rules left behind. */
const STYLE_ID = 'league-art-styles';
export function injectLeagueArtStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = LEAGUE_ART_CSS;
    document.head.appendChild(el);
}

/**
 * Paint a league surface with its type's artwork.
 *
 * Idempotent — re-applying replaces the existing layer, so a page re-render
 * cannot stack two. A no-op for any type with no entry in LEAGUE_ART, so call
 * sites need no condition of their own.
 *
 * Synchronous: everything it needs is a module constant. That is deliberate —
 * it means the artwork is present in the same frame as the markup it sits
 * behind, with no fetch to wait on and no visible restyle afterwards.
 *
 * @param {HTMLElement}   el          the surface to paint behind
 * @param {string}        leagueType  'ubc' | 'doubling' | 'regular' | …
 * @param {'card'|'hero'} [shape]     which crop and visible height to use
 * @returns {boolean} whether artwork was applied
 */
export function applyLeagueTypeArt(el, leagueType, shape = 'card') {
    const art = el && LEAGUE_ART[String(leagueType || '').toLowerCase()];
    if (!art) return false;

    injectLeagueArtStyles();

    el.querySelectorAll(':scope > .lart-layer').forEach((n) => n.remove());
    el.classList.add('lart-host', shape === 'hero' ? 'lart-hero' : 'lart-card');

    const key = shape === 'hero' ? 'hero' : 'card';
    const pos = ART_POSITIONS.find((p) => p.id === art[key]) || ART_POS_DEFAULT;
    const show = Number(art.show?.[key]) || 0;
    const fit = show > 0 && show < 100;
    const ownFilter = art.filter && art.filter !== 'none' ? art.filter : '';

    const layer = document.createElement('div');
    layer.className = fit ? 'lart-layer lart-fit' : 'lart-layer';
    layer.innerHTML = '<div class="lart-img"></div>'
        + (fit ? '<img class="lart-sharp" alt="" aria-hidden="true" decoding="async">' : '')
        + '<div class="lart-hue"></div>';
    layer.style.setProperty('--lart-image', `url("${art.image}")`);
    layer.style.setProperty('--lart-blend', art.blend);
    layer.style.setProperty('--lart-pos', pos.css);
    if (fit) {
        layer.querySelector('.lart-sharp').src = art.image;
        layer.style.setProperty('--lart-k', 100 / show);
        layer.style.setProperty('--lart-py', parseFloat(pos.css.split(' ')[1]) / 100);
        layer.style.setProperty('--lart-sharp-filter', ownFilter || 'none');
        layer.style.setProperty('--lart-filter', `${ownFilter} blur(14px) brightness(.8)`.trim());
    } else {
        layer.style.setProperty('--lart-filter', art.filter);
    }
    layer.style.setProperty('--lart-mix', (art.mix ?? 50) / 100);
    el.prepend(layer);
    return true;
}
