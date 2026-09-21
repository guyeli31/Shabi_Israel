/**
 * promoNotice.js — the UBC league launch announcement.
 *
 * A one-off, self-expiring modal shown to a visitor who has not yet
 * acknowledged it, inside a date window that lives in the CONFIG, not in this
 * code. Designed in `promo-lab.html` (the Promo Lab), which imports this exact
 * module — so what is previewed there IS what ships, rather than a lookalike
 * that drifts from it.
 *
 * ── THE TWO FILES ───────────────────────────────────────────────────────────
 *   assets/promo/promo-config.json   the design (variant, artwork, treatment,
 *                                    date window). Written by the lab's "Save
 *                                    to site" button — do not hand-edit.
 *   this file                        the copy, the markup, the CSS, and the
 *                                    rules about WHEN it may appear.
 *
 * The copy deliberately does NOT live in the config: duplicating it would give
 * the wording two sources that drift apart, which this project has been bitten
 * by five separate times (see CLAUDE.md § There IS a player registry).
 *
 * ── SHOW-ONCE ───────────────────────────────────────────────────────────────
 * Acknowledging it (any of the three exits) writes one localStorage key, and
 * that is the whole memory. It is per BROWSER PROFILE, not per person: a
 * visitor on both a phone and a laptop sees it twice, and clearing site data
 * brings it back. That is the honest limit of storing nothing about anybody,
 * and it is the reason the notice needs no consent banner — remembering that a
 * visitor dismissed a notice is strictly-necessary functional storage. It is
 * disclosed in js/render/privacyNotice.js, which must stay in step.
 *
 * ── IT EXPIRES ON ITS OWN ───────────────────────────────────────────────────
 * Past `endsOn` it stops rendering even if nobody remembers to remove it.
 * A temporary announcement that outlives its purpose is worse than none — the
 * lesson movedNotice.js was built around. Dates are read on the ISRAEL clock,
 * not the viewer's, so the league's own October is what counts wherever the
 * visitor happens to be.
 *
 * ── HOW IT IS RECORDED ──────────────────────────────────────────────────────
 * The announcement APPEARING is a property of the page view, not an action, so
 * it is the `promo_banner` column (🎉 page-mark in the dashboard) rather than an
 * event of its own — see promoBannerActive() below. Only the three EXITS and the
 * language flags are clicks, because those are things the visitor did.
 *
 * ── HOW TO REMOVE ───────────────────────────────────────────────────────────
 *   1. delete this file, promoWindow.js, assets/promo/promo-config.json and
 *      scripts/build-promo-window.mjs
 *   2. in js/analytics.js: drop both imports, PROMO_BANNER, the promo_banner
 *      line in baseFields(), and the mountPromoNotice() call
 *   3. optional: the 🎉 CLICK_TYPE_ICONS entries + promoMarkHtml in
 *      js/render/analyticsPage.js, the promo_banner column and its projections
 *      in sql/analytics_poc.sql, promo-lab.html, tools/START_PROMO_LAB.bat,
 *      scripts/build-promo-manifest.mjs
 */

import { LEAGUE_TIME_ZONE } from '../compute/leagueDuration.js';
import { getPopupLang, setPopupLang, LANG_FLAGS } from '../utils/popupLang.js';
import { flagUrl, getFlagCode } from '../utils/helpers.js';
import { TIER_COLORS } from '../data/titleConstants.js';
import { buildHeaderTitles } from './playerHeader.js';
import { loadPlayersMetadata, loadAllLeagues } from '../data/store.js';
// GENERATED from assets/promo/promo-config.json by scripts/build-promo-window.mjs.
// A static import, not a fetch, because js/analytics.js needs the window
// SYNCHRONOUSLY — see promoBannerActive() below.
import { PROMO_STARTS_ON, PROMO_ENDS_ON } from './promoWindow.js';

export const PROMO_CONFIG_PATH = 'assets/promo/promo-config.json';
/** Local draft, written by the lab so a design can be previewed before the
 *  config file is committed. The FILE always wins — same contract as
 *  heroBanner.js's loadBannerConfig. */
export const PROMO_STORAGE_KEY = 'shabi-promo-config';
/** "This visitor has acknowledged the announcement." The entire memory.
 *  Deliberately the ONLY key this notice writes: "was it on screen" is no
 *  longer remembered per profile, because it is no longer an event to be fired
 *  once — it is `promo_banner`, stamped on the page's own analytics row (see
 *  promoBannerActive below). */
export const PROMO_DISMISSED_KEY = 'shabi-promo-ubc-dismissed';

/** Every field the modal needs, so a config missing a key still renders. */
export const DEFAULT_CONFIG = {
    variant: 'spotlight',
    treat: 'tint',
    mix: 50,
    top: true,
    backdrop: true,
    x: true,
    flags: true,
    art: { kind: 'builtin', id: 'sunset' },
    artPos: 'center',
    /* The league's professional manager, shown the way the site shows a PLAYER
       in "full name" display mode: flag, then the name, then the title chip.

       Only the USERNAME is stored. He is a real player, so his full name, his
       BMAB title and his flag are looked up from the same data every other
       surface reads (resolveManager below) instead of being copied here — a
       promotion of his rank would otherwise leave this line quietly stale,
       which is exactly the drift CLAUDE.md keeps warning about. Empty disables
       the line entirely. */
    manager: { player: 'boutsky' },

    /* The "Coming Soon" card on the landing page, under Active Leagues. It
       advertises a league that does not exist yet — there is no row in
       `leagues`, no fixtures, no players — so it is described here rather than
       loaded, and it deliberately links nowhere. Same date window as the
       notice: past `endsOn` the section stops rendering with everything else.
       Set to null to drop the section and keep the modal. */
    comingSoon: { title: 'October 2026 UBC', leagueType: 'ubc', artPos: 'lower' },
    // Israel wall-clock dates, inclusive. Taken from the GENERATED
    // js/render/promoWindow.js rather than written here, so the window the
    // modal renders by and the window js/analytics.js stamps `promo_banner` by
    // are the same two strings — see promoBannerActive() below for why
    // analytics cannot wait for the config fetch.
    startsOn: PROMO_STARTS_ON,
    endsOn: PROMO_ENDS_ON,
};

/** Procedural artwork — pure CSS, so a design can ship with no image at all. */
export const BUILT_IN_ART = [
    { id: 'sunset', label: 'Sunset',
      css: 'radial-gradient(120% 90% at 50% 88%, #f2a03c 0%, #d4593a 30%, #8e3b63 58%, #3b2a58 82%, #241d3f 100%)' },
    { id: 'felt', label: 'Felt',
      css: 'radial-gradient(90% 120% at 22% 8%, color-mix(in srgb, var(--color-accent) 70%, #000) 0%, var(--header-bg) 72%)' },
];

/* Which band of the photo to keep when `cover` crops it. Tall photos in a wide
   frame lose their top and bottom, so this is the difference between showing a
   face and showing a torso. The CSS values are two-keyword on purpose —
   `center top` pins the TOP edge, whereas a bare `top` would leave the
   horizontal axis to default and reads as ambiguous next to its siblings. */
export const ART_POSITIONS = [
    { id: 'top',    label: 'Top',    css: 'center 0%' },
    { id: 'upper',  label: 'Upper',  css: 'center 25%' },
    { id: 'center', label: 'Centre', css: 'center 50%' },
    { id: 'lower',  label: 'Lower',  css: 'center 75%' },
    { id: 'bottom', label: 'Bottom', css: 'center 100%' },
];
/* Index of 'center' in the list above — the fallback for an unknown id. Derived
   rather than written as a literal, because a stop added to the scale would
   otherwise silently shift the default to whatever now sits at that index. */
const ART_POS_DEFAULT = ART_POSITIONS.find((p) => p.id === 'center');

export const TREATMENTS = [
    { id: 'none',    label: 'Raw',     blend: 'normal',     filter: 'none' },
    { id: 'tint',    label: 'Tint',    blend: 'color',      filter: 'saturate(.9)' },
    { id: 'duotone', label: 'Duotone', blend: 'color',      filter: 'grayscale(1) contrast(1.12)' },
    { id: 'wash',    label: 'Wash',    blend: 'soft-light', filter: 'none' },
];

/** Which variants carry artwork at all. */
export const VARIANTS = [
    { id: 'card',      label: 'A · Card',      art: false },
    { id: 'hero',      label: 'B · Hero',      art: true  },
    { id: 'spotlight', label: 'C · Spotlight', art: true  },
    { id: 'split',     label: 'D · Split',     art: true  },
    { id: 'marquee',   label: 'E · Marquee',   art: false },
];

export const PROMO_COPY = {
    en: {
        eyebrow: 'Coming this October',
        title: 'So — who is the best player in the league?',
        lead: 'New in <strong>SHABI ISRAEL</strong> leagues: a league played in the <span class="league-type-pill type-ubc">UBC</span> format',
        rule: 'Every match awards two points:',
        ptWin: 'for winning the match',
        ptPlay: 'for the better PR',
        managerRole: 'Under the professional management of',
        when: 'The league opens this coming October',
        contact: 'For further details, please contact the league admins',
        cta: 'Got it',
        close: 'Close',
        marqueeKicker: 'A new format',
        marqueeWhen: 'Opening October 2026',
    },
    he: {
        eyebrow: 'החל מאוקטובר',
        title: 'אז מיהו השחקן הטוב ביותר בליגה?',
        lead: 'חדש בליגות <strong>SHABI ISRAEL</strong>: ליגה בפורמט <span class="league-type-pill type-ubc">UBC</span>',
        rule: 'בכל דו-קרב מחולקות שתי נקודות:',
        ptWin: 'לזוכה בדו-קרב',
        ptPlay: 'לשחקן עם ה-PR הטוב יותר',
        managerRole: 'בניהולו המקצועי של',
        when: 'הליגה תיפתח באוקטובר הקרוב',
        contact: 'לפרטים נוספים יש לפנות למנהלי הליגה',
        cta: 'הבנתי',
        close: 'סגור',
        marqueeKicker: 'פורמט חדש',
        marqueeWhen: 'החל מאוקטובר 2026',
    },
};

/* ── When it may appear ──────────────────────────────────────────────────── */

const _israelDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEAGUE_TIME_ZONE,       // imported, not a fourth hardcoded copy
    year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Today in Israel as 'YYYY-MM-DD'. en-CA is chosen precisely because it
 *  formats as ISO, so the window test below is a plain string comparison and
 *  never goes near Date parsing — `new Date('2026-10-01')` is UTC midnight,
 *  which is the previous evening in Israel and would open the window a day
 *  early for everyone west of Greenwich. */
export function israelToday(now = new Date()) {
    return _israelDay.format(now);
}

export function promoWindowOpen(cfg, now = new Date()) {
    const today = israelToday(now);
    const from = cfg.startsOn || DEFAULT_CONFIG.startsOn;
    const to = cfg.endsOn || DEFAULT_CONFIG.endsOn;
    return today >= from && today <= to;   // both ends inclusive
}

export function isPromoDismissed() {
    try { return !!localStorage.getItem(PROMO_DISMISSED_KEY); }
    catch { return false; }               // private mode — treat as "not yet"
}

export function dismissPromo() {
    try { localStorage.setItem(PROMO_DISMISSED_KEY, '1'); }
    catch { /* private mode: it will show again, which is the safe direction */ }
}

/**
 * "Is the UBC announcement on screen for this page?" — SYNCHRONOUSLY.
 *
 * js/analytics.js calls this once at module load, before the pageview beacon,
 * and stamps the answer on every event as `promo_banner`. The dashboard then
 * marks those pages with 🎉. That is the whole recording mechanism: the
 * announcement is a PROPERTY OF THE PAGE VIEW, not an action the visitor took.
 * It used to be sent as a `UBC promo: shown` click, which inflated click_count
 * and put a row the visitor never caused into the interactions log and the
 * session timeline — the same mistake `Moved notice: shown` made before it
 * became the 📦 page-mark, and the same fix.
 *
 * Synchronous is not a preference, it is the constraint. The pageview is sent
 * at analytics.js module load and analytics is insert-only, so a row can never
 * be amended once written: anything learned after the fetch resolves is
 * learned too late. Hence the two inputs below, both available immediately —
 * a localStorage read, and the dates as CODE constants out of the generated
 * promoWindow.js.
 *
 * It answers about RENDERING, so it stays true on every page of the visit
 * until the visitor dismisses the notice — exactly like movedBannerActive().
 * Reach is therefore "sessions whose entry pageview carries the mark", not a
 * count of these rows.
 */
export function promoBannerActive(now = new Date()) {
    if (isPromoDismissed()) return false;
    const today = israelToday(now);
    return today >= PROMO_STARTS_ON && today <= PROMO_ENDS_ON;
}

/* ── Config ──────────────────────────────────────────────────────────────── */

/** The committed JSON file is the single source of truth (it works across
 *  ports, browsers and devices); a localStorage draft is only a fallback for
 *  a design being previewed before it is saved. Same contract, and the same
 *  ordering, as heroBanner.js's loadBannerConfig. */
export async function loadPromoConfig() {
    let cfg = null;
    try {
        const res = await fetch(PROMO_CONFIG_PATH, { cache: 'no-store' });
        if (res.ok) cfg = await res.json();
    } catch { /* missing / offline — try the draft below */ }
    if (!cfg) {
        try {
            const draft = localStorage.getItem(PROMO_STORAGE_KEY);
            if (draft) cfg = JSON.parse(draft);
        } catch { /* malformed draft */ }
    }
    return { ...DEFAULT_CONFIG, ...(cfg || {}) };
}

/** An artwork reference from the config → what the CSS needs.
 *  References are stored by IDENTITY (builtin id, or filename under
 *  assets/promo/) rather than by any in-memory handle, so they survive a
 *  reload — the lab's drag-and-drop blob URLs deliberately cannot be saved. */
export function resolveArt(ref) {
    if (!ref || ref.kind === 'none') return null;
    if (ref.kind === 'file' && ref.name) {
        return { fallbackCss: 'var(--header-bg)', url: `assets/promo/${ref.name}` };
    }
    // A direct URL. Only the Promo Lab produces this, for a file dragged onto
    // the page (a blob: URL that dies with the page and therefore can never be
    // saved into a config — the lab refuses that write). Handled here so the
    // lab and the site share ONE build path rather than forking on artwork.
    if (ref.kind === 'url' && ref.url) {
        return { fallbackCss: 'var(--header-bg)', url: ref.url };
    }
    const hit = BUILT_IN_ART.find((b) => b.id === (ref.id || ''));
    return hit ? { fallbackCss: hit.css, url: null } : null;
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

/* Injected by this module rather than added to css/ and linked from every
   page's <head>: removing the whole feature is then one file deletion, with no
   orphaned rules left behind in a shared stylesheet. Same call made by
   movedNotice.js and privacyNotice.js. */
const PROMO_CSS = `
.promo-overlay {
    position: fixed; inset: 0;
    z-index: 4000;
    display: grid;
    place-items: center;
    padding: var(--space-md);
    /* Deliberately light. A heavy scrim makes the announcement read as a new
       PAGE rather than as a notice over this one, and a visitor who cannot see
       the site behind the card has no way to tell they are still on it. The
       card's own shadow does the separating instead. */
    background: rgba(0, 0, 0, .34);
    /* The overlay is ITSELF the query container the rules below ask about.
       Without this, every '@container vp' rule silently never matches on a real
       page (a named container query with no such ancestor simply never applies)
       and the modal would have no responsive behaviour at all off the lab
       bench — the one failure that looks fine on a desktop and is invisible
       until a phone loads it. inset:0 makes its inline-size the viewport width,
       so the breakpoints mean what they say. */
    container-type: inline-size;
    container-name: vp;
}
.promo-overlay[hidden] { display: none; }
/* Pinned near the top rather than dead-centre, so it reads as an announcement
   over the page instead of an interruption of it. A fixed px offset, NOT vh,
   so the Promo Lab's device frames stay an honest simulation: vh would measure
   the real browser window even inside a 430px phone frame. */
.promo-overlay[data-anchor="top"] { place-items: start center; padding-top: 56px; }

.promo {
    position: relative;
    width: min(440px, 100%);
    max-height: 100%;
    /* Column flex + a scrolling child (not overflow on the card itself) so the
       × and the flags, which are absolutely positioned against THIS box, stay
       pinned while long copy scrolls under them. With overflow on the card, a
       tall variant on a phone scrolled its own close button off-screen. */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 70px rgba(0, 0, 0, .45);
    animation: promo-in .32s cubic-bezier(.2, .8, .3, 1) both;
}
@keyframes promo-in {
    from { opacity: 0; transform: translateY(-14px) scale(.975); }
}
/* The one scrolling box. min-height:0 is what lets a flex child actually
   shrink below its content height instead of forcing the card taller. */
.promo-scroll { min-height: 0; overflow: hidden auto; }
@media (prefers-reduced-motion: reduce) { .promo { animation: none; } }

/* ── The × ─────────────────────────────────────────────────────────────────
   Physically pinned top-right in EVERY language — same rule the privacy modal
   settled on: the modal itself never flips, only its reading content does. */
.promo-x {
    position: absolute; top: 8px; right: 10px;
    z-index: 3;
    width: 30px; height: 30px; padding: 0;
    display: grid; place-items: center;
    font-size: 21px; line-height: 1;
    border: 0; border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
}
.promo-x:hover { background: var(--color-hover); color: var(--color-text); }
/* Over artwork the × needs its own contrast, independent of the theme. */
.promo[data-variant="spotlight"] .promo-x,
.promo[data-variant="hero"] .promo-x {
    background: rgba(0, 0, 0, .38);
    color: #fff;
    backdrop-filter: blur(3px);
}
.promo[data-variant="spotlight"] .promo-x:hover,
.promo[data-variant="hero"] .promo-x:hover { background: rgba(0, 0, 0, .62); }

/* ── Language flags bar (canonical popup-lang pattern) ───────────────────── */
.promo-lang {
    position: absolute; top: 10px; left: 12px;
    z-index: 3;
    display: flex; gap: 5px;
    direction: ltr;
}
.promo-lang button {
    width: 20px; height: 20px; padding: 0;
    display: inline-flex;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: none;
    opacity: .5;
    cursor: pointer;
    transition: opacity .15s, border-color .15s;
}
.promo-lang button:hover { opacity: .85; }
.promo-lang button.is-active { opacity: 1; border-color: var(--color-accent); }
.promo-lang img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; pointer-events: none; }
.promo[data-variant="spotlight"] .promo-lang button,
.promo[data-variant="hero"] .promo-lang button { border-color: rgba(255,255,255,.55); }

/* ── Artwork ──────────────────────────────────────────────────────────────
   The photo is NOT dropped in raw. Three layers, all theme-derived:
     ①  the image itself (desaturated for the duotone treatment)
     ②  a hue layer — a --header-bg → --color-accent ramp blended into the
        image, so the artwork re-tints with every theme instead of sitting in
        the page like a foreign object
     ③  a scrim, so text laid over it is readable no matter what the photo is
   --art-mix (the Intensity dial) drives ② only; the scrim is separate, because
   readability must not be a design dial. */
.promo-art {
    position: relative;
    overflow: hidden;
    background: var(--art-fallback);
    background-size: cover;
    background-position: var(--art-pos, center);
}
.promo-art-img {
    position: absolute; inset: 0;
    background-image: var(--art-image, none);
    background-size: cover;
    /* WHICH part of the photo survives the crop. background-size:cover fills
       the frame and throws away the overflow, and the frame is much wider than
       it is tall on a phone — so a portrait photo loses most of its height, and
       whether that costs you the subject's head or their feet is decided
       entirely here. A config choice, not a constant: the right answer depends
       on the photo.
       (No backticks in this comment: the whole stylesheet is a template
       literal, and one would end it mid-rule.) */
    background-position: var(--art-pos, center);
    filter: var(--art-filter, none);
}
.promo-art-hue {
    position: absolute; inset: 0;
    background: linear-gradient(140deg, var(--header-bg), var(--color-accent));
    mix-blend-mode: var(--art-blend, color);
    opacity: var(--art-mix, .5);
}
.promo-art-scrim { position: absolute; inset: 0; }

/* ── Content ─────────────────────────────────────────────────────────────── */
/* --promo-gutter is a CHROME GUTTER, not a design margin: the flags (absolute,
   top-left) and the × (absolute, top-right) float over the card, so wherever
   the body is the TOPMOST content its first line has to start below both of
   them. One symmetric value rather than a side-specific one, precisely because
   the content flips and the chrome does not — in English the eyebrow begins at
   the left and ran straight into the flags, while the identical Hebrew layout
   began at the right and looked fine. Clearing the taller of the two (the ×
   ends at 8+30=38px) on both sides is what makes the two languages lay out
   identically instead of only one of them being checked.
   The default is the ordinary padding: in the hero/card/marquee variants the
   artwork or the marquee block sits above the body and takes the overlap
   itself, so a gutter there would just be a band of empty card. */
.promo { --promo-gutter: var(--space-lg); }
.promo-body { padding: var(--promo-gutter) var(--space-lg) var(--space-md); }
/* RTL applies to the READING CONTENT only — the × stays right, the flags stay
   left, in both languages. */
.promo[data-lang="he"] .promo-body,
.promo[data-lang="he"] .promo-foot { direction: rtl; text-align: right; }

.promo-eyebrow {
    display: block;
    margin-bottom: 6px;
    font-size: 11px; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase;
    color: var(--color-accent);
}
.promo-title {
    margin: 0 0 var(--space-sm);
    font-size: clamp(18px, 2.6cqw + 10px, 23px);
    font-weight: 800; line-height: 1.25;
    color: var(--color-text);
}
/* The UBC badge sits INSIDE the sentence, standing in for the word "UBC"
   itself — the league is named by the same pill it carries everywhere else on
   the site (.league-type-pill, components.css), not by a lookalike and not by
   a separate banner row above the copy.
   .88em and the small vertical nudge keep a pill with .2em/.85em padding from
   inflating its own line: at 1em the padding pushed the line box taller than
   its neighbours and the paragraph visibly loosened around that one line. */
.promo-body p .league-type-pill {
    font-size: .88em;
    padding-block: .1em;
    letter-spacing: .06em;
    vertical-align: .04em;
}

.promo-body p { margin: 0 0 .6em; font-size: 13.5px; line-height: 1.55; color: var(--color-text-secondary); }
.promo-body p:last-child { margin-bottom: 0; }
.promo-body p strong { color: var(--color-text); font-weight: 700; }

/* The scoring line is the whole proposition — give it a frame, not a bullet. */
.promo-rule {
    margin: var(--space-sm) 0;
    padding: var(--space-sm) var(--space-md);
    background: var(--color-inset);
    border-inline-start: 3px solid var(--lt-ubc-text);
    border-radius: var(--radius-sm);
}
.promo-rule p { margin: 0; color: var(--color-text); font-size: 13px; }
.promo-rule-pts {
    display: flex; gap: var(--space-md); flex-wrap: wrap;
    margin-top: 7px;
}
.promo-rule-pt { display: flex; align-items: baseline; gap: 6px; font-size: 13px; color: var(--color-text-secondary); }
.promo-rule-pt b {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--lt-ubc-text);
}

.promo-foot {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-md); flex-wrap: wrap;
    padding: var(--space-sm) var(--space-lg) var(--space-md);
}
.promo-foot-note { font-size: 11.5px; color: var(--color-text-muted); max-width: 30ch; }
/* Primary action — --color-primary is the themed dark-bg/light-text PAIR from
   variables.css, so "Got it" stays readable on light-accent themes (Vegas,
   Casino, X22) where a naive --color-accent fill would not. */
.promo-cta {
    flex: none;
    padding: .6em 1.6em;
    font: inherit; font-size: 14px; font-weight: 700;
    color: var(--color-primary-text);
    background: var(--color-primary);
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    cursor: pointer;
}
.promo-cta:hover { filter: brightness(1.14); }
.promo-cta:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

/* ══ VARIANT A — Card ═════════════════════════════════════════════════════ */
.promo[data-variant="card"] { width: min(500px, 100%); }
.promo[data-variant="card"]::before {
    content: ""; display: block; height: 4px; flex: none;
    background: linear-gradient(90deg, var(--lt-ubc-text), var(--color-accent));
}

/* ══ VARIANT B — Hero ═════════════════════════════════════════════════════ */
.promo[data-variant="hero"] .promo-art { aspect-ratio: 16 / 8; }
.promo[data-variant="hero"] .promo-art-scrim {
    background: linear-gradient(to bottom, transparent 55%, var(--color-surface));
}
.promo[data-variant="hero"] .promo-body { padding-top: var(--space-md); }
@container vp (max-width: 560px) {
    .promo[data-variant="hero"] .promo-art { aspect-ratio: 5 / 3; }
}

/* ══ VARIANT C — Spotlight ════════════════════════════════════════════════
   The full card IS the artwork. The only variant whose text sits on the photo
   — so its copy runs on the --header-bg/--header-text pair (a designed
   dark-ground/light-text couple in every theme) rather than on --color-text,
   which would vanish on a light theme over a dark photo. */
/* The body IS the topmost content here (the artwork is an absolute background),
   so it owns the chrome gutter — see --promo-gutter above. */
.promo[data-variant="spotlight"] { width: min(440px, 100%); border-color: transparent; --promo-gutter: 46px; }
.promo[data-variant="spotlight"] .promo-art { position: absolute; inset: 0; }
.promo[data-variant="spotlight"] .promo-art-scrim {
    background:
        linear-gradient(to bottom,
            color-mix(in srgb, var(--header-bg) 62%, transparent) 0%,
            color-mix(in srgb, var(--header-bg) 34%, transparent) 38%,
            color-mix(in srgb, var(--header-bg) 92%, transparent) 100%);
}
.promo[data-variant="spotlight"] .promo-content {
    position: relative; z-index: 2;
    min-height: 330px;
    display: flex; flex-direction: column; justify-content: flex-end;
}
.promo[data-variant="spotlight"] .promo-title,
.promo[data-variant="spotlight"] .promo-body p strong,
.promo[data-variant="spotlight"] .promo-rule p { color: var(--header-text); }
.promo[data-variant="spotlight"] .promo-body p,
.promo[data-variant="spotlight"] .promo-foot-note,
.promo[data-variant="spotlight"] .promo-rule-pt {
    color: color-mix(in srgb, var(--header-text) 78%, transparent);
}
.promo[data-variant="spotlight"] .promo-eyebrow { color: var(--header-text); opacity: .8; }
.promo[data-variant="spotlight"] .promo-rule {
    background: rgba(0, 0, 0, .3);
    backdrop-filter: blur(4px);
    border-inline-start-color: var(--header-text);
}
.promo[data-variant="spotlight"] .promo-rule-pt b { color: var(--header-text); }
.promo[data-variant="spotlight"] .promo-cta {
    background: var(--header-text); color: var(--header-bg);
}
@container vp (max-width: 560px) {
    .promo[data-variant="spotlight"] .promo-content { min-height: 380px; }
}

/* ══ VARIANT D — Split ════════════════════════════════════════════════════ */
.promo[data-variant="split"] { width: min(560px, 100%); --promo-gutter: 46px; }
.promo[data-variant="split"] .promo-content {
    display: grid;
    grid-template-columns: 38% 1fr;
}
.promo[data-variant="split"] .promo-art { min-height: 100%; }
.promo[data-variant="split"] .promo-art-scrim {
    background: linear-gradient(to right, transparent 60%, color-mix(in srgb, var(--color-surface) 55%, transparent));
}
.promo[data-variant="split"] .promo-body { padding-block: var(--space-lg) var(--space-sm); }
@container vp (max-width: 620px) {
    .promo[data-variant="split"] .promo-content { grid-template-columns: 1fr; }
    .promo[data-variant="split"] .promo-art { aspect-ratio: 16 / 7; min-height: 0; }
    .promo[data-variant="split"] .promo-art-scrim {
        background: linear-gradient(to bottom, transparent 55%, var(--color-surface));
    }
}

/* ══ VARIANT E — Marquee ══════════════════════════════════════════════════
   Zero artwork, all typography. The safe fallback — nothing to load, identical
   on every device and every theme. */
.promo[data-variant="marquee"] { width: min(520px, 100%); }
.promo[data-variant="marquee"] .promo-marquee {
    position: relative;
    padding: var(--space-lg) var(--space-lg) var(--space-md);
    background: var(--header-bg);
    color: var(--header-text);
    text-align: center;
    overflow: hidden;
}
/* Two faint dice pips as texture — drawn, not loaded. */
.promo[data-variant="marquee"] .promo-marquee::after {
    content: "⚅ ⚄";
    position: absolute; inset-inline-end: -6px; bottom: -22px;
    font-size: 78px; line-height: 1;
    opacity: .09;
    pointer-events: none;
}
.promo-marquee-kicker {
    display: block;
    font-size: 11px; font-weight: 700;
    letter-spacing: .2em; text-transform: uppercase;
    opacity: .72;
}
.promo-marquee-word {
    display: block;
    margin: 2px 0 4px;
    font-size: clamp(42px, 9cqw + 10px, 64px);
    font-weight: 900; line-height: 1;
    letter-spacing: .04em;
    /* The UBC hue is a PILL colour — tuned as dark ink on a pale chip, not as
       64px of type on the header band. Pulled toward --header-text, every
       theme's designed companion to --header-bg, so the word keeps the UBC
       identity while its contrast is guaranteed by construction. At 55% it
       measured 2.3:1 on Rainbow and 2.7:1 on Nature, both under the 3:1 floor
       for display-size text; 28% clears every theme. */
    color: color-mix(in srgb, var(--lt-ubc-text) 28%, var(--header-text));
}
.promo-marquee-when { display: block; font-size: 13px; opacity: .85; }
.promo[data-variant="marquee"] .promo-eyebrow { display: none; }

/* ── The professional-manager line ────────────────────────────────────────
   Mirrors the in-league player card: flag, name, title chip. The chip's
   geometry follows .pg-v7-chip (player-general.css) — which this page cannot
   simply reuse, because that stylesheet is linked only by player.html and
   player_league.html, while the notice appears on every page. */
/* A normal block, NOT a flex row: flex would impose its own ordering on the
   line and fight the paragraph's direction. Ordinary inline flow lets bidi do
   its job, and the identity island below handles the one part that must not
   mirror. */
/* Selector carries the element too (p.promo-manager): the generic
   ".promo-body p" rule above is one type-selector more specific than a bare
   class, so a plain ".promo-manager" would lose its own margin and
   line-height to it without any warning.
   (No backticks anywhere in this stylesheet — it is a template literal.) */
.promo-body p.promo-manager {
    margin: .2em 0 0;
    font-size: 14.5px;
    line-height: 1.9;
    color: var(--color-text-secondary);
}
/* The gap between the sentence and the name block belongs HERE, not on the
   island. A logical margin resolves against the element's own direction, and
   the island is forced to ltr — so margin-inline-start on it became a LEFT
   margin even in Hebrew, where the island sits to the left of the text and the
   gap was needed on its right. The result was the two touching exactly, with
   6.5px of dead space on the far edge. This span inherits the paragraph's
   direction, so its inline-end is the correct side in both languages. */
.promo-manager-role {
    color: var(--color-text-muted);
    margin-inline-end: .45em;
}
/* flag · username · title — always in this visual order, both languages. */
.promo-manager-id {
    display: inline-flex;
    align-items: center;
    gap: .4em;
    direction: ltr;
    vertical-align: -.1em;
}
.promo-manager-name { font-weight: 700; color: var(--color-text); }
/* The site's own table flag, rule for rule (.flag in components.css, echoed by
   .dash-table .flag) — a rounded rectangle scaled off the surrounding text,
   not a circle. Restated here rather than reused because components.css is
   linked only by index.html, while this notice appears on every page. */
.promo-manager-flag {
    height: 1.15em;
    width: auto;
    object-fit: contain;
    border-radius: 0.15em;
    vertical-align: middle;
    image-rendering: auto;
}
.promo-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.7em;
    font-weight: 700;
    padding: 0.25em 0.7em;
    border-radius: 0.4em;
    white-space: nowrap;
}
.promo-chip-icon { font-size: 1.1em; line-height: 1; }
${Object.entries(TIER_COLORS).map(([tier, c]) => (
    `.promo-tier-${tier} { background: ${c.bg}; color: ${c.text};`
    + (tier === 'white' ? ` border: 1px solid ${c.border};` : '')
    + ` }`
)).join('\n')}
/* Spotlight lays its copy over the photo, where --color-text-* would vanish.
   The chip keeps its own tier colours — that is the point of a tier. */
.promo[data-variant="spotlight"] .promo-manager-name { color: var(--header-text); }
.promo[data-variant="spotlight"] .promo-manager,
.promo[data-variant="spotlight"] .promo-manager-role {
    color: color-mix(in srgb, var(--header-text) 78%, transparent);
}

/* ── "Coming Soon" card (landing page) ────────────────────────────────────
   A .league-card like any other, so it keeps the grid's sizing, radius and
   hover — with the promo artwork behind it and the copy laid over a scrim.
   Text runs on the --header-bg/--header-text pair for the same reason the
   Spotlight modal does: --color-text would vanish on a light theme over a
   dark photo. */
.promo-soon-card {
    position: relative;
    overflow: hidden;
    isolation: isolate;
}
/* The title and the meta row are DIRECT children of .league-card here, exactly
   as they are in a real one (landingPage.js), and carry the same classes — so
   they inherit that card's padding, gap and type and land on the same
   baselines. An earlier version wrapped them in a box of its own with its own
   centring and a min-height floor, which made the card the right height by
   coincidence while putting every line in a different place than its
   neighbours.
   What the card genuinely lacks is the third row: there is no leader, because
   there are no matches yet. So the row is PRESENT but EMPTY — it reserves the
   same box, keeping the card exactly as tall as its siblings and the two rows
   above it at exactly their heights, while showing no "Leader:" label for data
   that does not exist. aria-hidden, since a screen reader has nothing to read
   here.
   Its height is reproduced by CAUSE rather than by a copied number: a real
   leader row is 21.6px because a 16px flag sits on a 0.9em text line and
   vertical-align:middle lifts the line box past the text's own 20.3px. So the
   placeholder carries a zero-width inline box of exactly that flag's height,
   and both rows end up the same height for the same reason. A px min-height
   would have been a measurement frozen at one type scale. */
.promo-soon-leader::before {
    content: '';
    display: inline-block;
    width: 0; height: 16px;
    vertical-align: middle;
}
.promo-soon-art { position: absolute; inset: 0; z-index: 0; }
.promo-soon-card .promo-art-scrim {
    background:
        linear-gradient(to bottom,
            color-mix(in srgb, var(--header-bg) 45%, transparent) 0%,
            color-mix(in srgb, var(--header-bg) 88%, transparent) 100%);
}
.promo-soon-card > .league-card-title,
.promo-soon-card > .league-card-meta,
.promo-soon-card > .league-card-leader { position: relative; z-index: 1; }
/* The league name. A button, not a link: there is nothing to navigate to yet,
   and an <a> with no href would still read as a destination to a screen reader
   and still offer "open in new tab" on a right-click. Styled to match the
   .league-card-title anchors beside it. */
.promo-soon-link {
    appearance: none;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: inherit;
    color: var(--header-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.promo-soon-link:hover { text-decoration: underline; }
.promo-soon-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 2px;
}
/* The status pill's own colours — it is NOT Running and NOT Completed, so it
   borrows neither. Amber, the same signal the admin's "Pending" row uses for
   "queued, not yet published". */
.promo-soon-status {
    background: var(--color-pending-bg);
    color: var(--color-pending);
}
`;

export function injectPromoStyles() {
    if (document.getElementById('promo-notice-styles')) return;
    const style = document.createElement('style');
    style.id = 'promo-notice-styles';
    style.textContent = PROMO_CSS;
    document.head.appendChild(style);
}

/* ── The manager line ────────────────────────────────────────────────────── */

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

/**
 * Look the manager up as the PLAYER he is, from the same data every other
 * surface reads — his title and full name from players_metadata, his flag from
 * the leagues' CustomFlags. Nothing about him is written into the config beyond
 * his username, so a rank change reaches this line on its own.
 *
 * Costs no extra round trip: loadPlayersMetadata() and loadAllLeagues() are
 * both served from the one shared site bundle every page already fetches.
 *
 * Returns null when he cannot be resolved — an unknown username, or metadata
 * that failed to load. The notice then simply omits the line, which is the
 * right direction to fail: a wrong rank against a named real person is worse
 * than no rank.
 */
export async function resolveManager(cfg) {
    const username = cfg?.manager?.player;
    if (!username) return null;

    let meta = null;
    let leagues = null;
    try {
        [meta, leagues] = await Promise.all([loadPlayersMetadata(), loadAllLeagues()]);
    } catch {
        return null;                       // offline / bundle failed — omit the line
    }
    /* No metadata row is NOT a reason to drop the line. players_metadata is
       decoration on an already-existing player (CLAUDE.md § There IS a player
       registry) — a handful of rows against the full roster — so a player with
       no row is perfectly real, just untitled. He then renders as username +
       flag with no chip, instead of vanishing. */
    const m = meta?.[username] || null;

    // buildHeaderTitles is the player card's OWN title builder, so the chip
    // shows exactly what his header shows — championship first, then BMAB —
    // in the FULL label form ("Grandmaster G2"), not the compact "G2" badge
    // that tables and search use.
    const titles = buildHeaderTitles(m);

    /* His flag, newest league first. getFlagCode() (helpers.js) is the one
       function that turns a name + a league's CustomFlags into a code, and it
       already defaults to IL — so an entry nobody overrode resolves the same
       way here as everywhere else.
       Newest-first matters because a player can change flag between seasons
       (the data has exactly that: Moriarty is TZ in one league and GE in a
       later one), and the notice is not bound to any league, so it must show
       the most recent one. */
    const flag = [...(leagues?.values() || [])]
        .filter((p) => p && !p.Hidden && p.CustomFlags?.[username])
        .sort((a, b) => String(b.IssueDate || '').localeCompare(String(a.IssueDate || '')))
        .map((p) => getFlagCode(username, p.CustomFlags))[0] || getFlagCode(username, {});

    return { username, fullName: m?.fullName || '', flag, titles };
}

/** "Under the professional management of  🇮🇱 boutsky ♛ Grandmaster G2" */
function managerHtml(mgr, t) {
    if (!mgr) return '';

    const flag = mgr.flag
        ? `<img class="promo-manager-flag" src="${flagUrl(mgr.flag)}" alt="${escapeHtml(mgr.flag)}" title="${escapeHtml(mgr.flag)}">`
        : '';

    const chips = (mgr.titles || []).map((ti) =>
        `<span class="promo-chip promo-tier-${ti.tier}" title="${escapeHtml(ti.tooltip || ti.label)}">`
            + `<span class="promo-chip-icon">${ti.icon}</span>${escapeHtml(ti.label)}`
        + `</span>`
    ).join('');

    /* The identity is its own LTR island: flag, then username, then title,
       in that visual order in BOTH languages. Without the island the Hebrew
       paragraph's RTL direction would mirror the sequence and the title would
       land before the flag — the same run of characters, read backwards.
       The surrounding sentence still follows the page's reading direction, so
       only the name block is pinned, not the line. */
    return `<p class="promo-manager">`
        + `<span class="promo-manager-role">${escapeHtml(t.managerRole)}</span>`
        + `<span class="promo-manager-id">`
            + flag
            + `<span class="promo-manager-name">${escapeHtml(mgr.username)}</span>`
            + chips
        + `</span>`
    + `</p>`;
}

/* ── The modal ───────────────────────────────────────────────────────────── */

/**
 * Builds the announcement as a detached overlay element.
 *
 * `onExit(reason)` fires for each of the three ways out — 'got it', 'closed',
 * 'backdrop' — and the caller decides what that means. The site records the
 * dismissal and removes the node; the Promo Lab re-renders instead, so a
 * designer can try the next exit without reloading.
 *
 * `onLang(lang)` fires when a flag is clicked. The language itself is the
 * site-wide popup preference (popupLang.js), so switching it here switches
 * every "?" popup too — one language control, not a private one.
 */
export function buildPromoModal(cfg, { lang = getPopupLang(), onExit, onLang, manager = null } = {}) {
    const t = PROMO_COPY[lang] || PROMO_COPY.en;
    const variant = VARIANTS.find((v) => v.id === cfg.variant) || VARIANTS[2];
    const art = variant.art ? resolveArt(cfg.art) : null;
    const treat = TREATMENTS.find((x) => x.id === cfg.treat) || TREATMENTS[1];

    const overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t.title);
    if (cfg.top) overlay.dataset.anchor = 'top';
    if (!cfg.backdrop) overlay.style.background = 'transparent';

    const modal = document.createElement('div');
    modal.className = 'promo';
    modal.dataset.variant = variant.id;
    modal.dataset.lang = lang;

    const artHtml = art ? `
        <div class="promo-art">
            <div class="promo-art-img"></div>
            <div class="promo-art-hue"></div>
            <div class="promo-art-scrim"></div>
        </div>` : '';

    /* Analytics. Every exit is tracked SEPARATELY on purpose: "Got it" is an
       acknowledgement, the × is a deliberate close, and a backdrop click is a
       dismissal by clicking away. Collapsing the three into one number would
       hide whether the announcement actually landed. The dashboard renders the
       family as 🎉 + one glyph (CLICK_TYPE_ICONS, js/render/analyticsPage.js).

       `data-track` is the FIRST branch of the delegated click listener in
       js/analytics.js — which is why the flag buttons below carry one: without
       it they would fall into the generic `.popup-lang-flag` branch and be
       logged as a bare, context-free "Language: he". */
    const flagsHtml = cfg.flags ? `
        <div class="promo-lang">
            ${Object.entries(LANG_FLAGS).map(([code, f]) => `
                <button type="button" data-lang="${code}" title="${f.label}"
                        class="${code === lang ? 'is-active' : ''}"
                        data-track="UBC promo: language ${code}">
                    <img src="${f.icon}" alt="${f.label}" width="20" height="20">
                </button>`).join('')}
        </div>` : '';

    const xHtml = cfg.x
        ? `<button type="button" class="promo-x" aria-label="${t.close}"
                   data-track="UBC promo: closed">&times;</button>`
        : '';

    const bodyHtml = `
        <div class="promo-body">
            <span class="promo-eyebrow">${t.eyebrow}</span>
            <h2 class="promo-title">${t.title}</h2>
            <p>${t.lead}</p>
            <div class="promo-rule">
                <p>${t.rule}</p>
                <div class="promo-rule-pts">
                    <span class="promo-rule-pt"><b>1</b> ${t.ptWin}</span>
                    <span class="promo-rule-pt"><b>1</b> ${t.ptPlay}</span>
                </div>
            </div>
            <p>${t.when}</p>
            ${managerHtml(manager, t)}
        </div>
        <div class="promo-foot">
            <span class="promo-foot-note">${t.contact}</span>
            <button type="button" class="promo-cta"
                    data-track="UBC promo: got it">${t.cta}</button>
        </div>`;

    // The × and the flags sit OUTSIDE .promo-scroll in every variant, so they
    // stay pinned to the card while long copy scrolls beneath them. Spotlight's
    // artwork is outside too — there it is the card's background, not content.
    if (variant.id === 'marquee') {
        modal.innerHTML = `${flagsHtml}${xHtml}
            <div class="promo-scroll">
                <div class="promo-marquee">
                    <span class="promo-marquee-kicker">${t.marqueeKicker}</span>
                    <span class="promo-marquee-word">UBC</span>
                    <span class="promo-marquee-when">${t.marqueeWhen}</span>
                </div>${bodyHtml}
            </div>`;
    } else if (variant.id === 'split') {
        modal.innerHTML = `${flagsHtml}${xHtml}
            <div class="promo-scroll">
                <div class="promo-content">${artHtml}<div>${bodyHtml}</div></div>
            </div>`;
    } else if (variant.id === 'spotlight') {
        modal.innerHTML = `${artHtml}${flagsHtml}${xHtml}
            <div class="promo-scroll"><div class="promo-content">${bodyHtml}</div></div>`;
    } else {
        modal.innerHTML = `${flagsHtml}${xHtml}
            <div class="promo-scroll">${artHtml}${bodyHtml}</div>`;
    }

    // Artwork variables live on the MODAL, not in the stylesheet, so the Promo
    // Lab can render several cards with different images side by side.
    if (art) {
        const pos = ART_POSITIONS.find((p) => p.id === cfg.artPos) || ART_POS_DEFAULT;
        modal.style.setProperty('--art-fallback', art.fallbackCss);
        modal.style.setProperty('--art-image', art.url ? `url("${art.url}")` : 'none');
        modal.style.setProperty('--art-blend', treat.blend);
        modal.style.setProperty('--art-filter', treat.filter);
        modal.style.setProperty('--art-pos', pos.css);
        // The hue layer only means anything over a photo; over a procedural
        // gradient it would just mix the gradient with itself.
        modal.style.setProperty('--art-mix', art.url ? (cfg.mix ?? 50) / 100 : 0);
    }

    modal.querySelectorAll('.promo-lang button').forEach((b) => {
        b.addEventListener('click', () => {
            setPopupLang(b.dataset.lang);   // site-wide, not private to this modal
            onLang?.(b.dataset.lang);
        });
    });
    modal.querySelector('.promo-x')?.addEventListener('click', () => onExit?.('closed'));
    modal.querySelector('.promo-cta')?.addEventListener('click', () => onExit?.('got it'));

    // Clicking away. This one canNOT be a `data-track` attribute on the overlay:
    // js/analytics.js matches with closest('[data-track]'), so an attribute here
    // would also catch every click that merely BUBBLES out of the card — reading
    // a click on the headline as "dismissed by backdrop". Hence the explicit
    // target check plus `shabi:interaction`, the documented channel for an
    // interaction the delegated click listener cannot classify on its own.
    overlay.addEventListener('click', (e) => {
        if (e.target !== overlay) return;
        window.dispatchEvent(new CustomEvent('shabi:interaction', {
            detail: { target: 'UBC promo: backdrop' },
        }));
        onExit?.('backdrop');
    });

    overlay.appendChild(modal);
    return overlay;
}

/* ── "Coming Soon" section (landing page, under Active Leagues) ──────────
   English only, with no language toggle: it is page CHROME, and it sits
   between "Active Leagues" and "Completed Leagues", both of which are English
   on every device. The modal is the only bilingual surface here. */

const COMING_SOON_HEADING = 'Coming Soon';
const COMING_SOON_PILL = 'Coming soon';
/* The tap feedback. Same mechanism as a title chip in the player header:
   `data-tooltip-tap` + a title, picked up globally by js/render/tooltip.js —
   so it is the app's one themed tooltip, not a second popup implementation. */
const COMING_SOON_FEEDBACK = 'Coming soon';
const COMING_SOON_SECTION_CLASS = 'promo-soon-section';

/**
 * Render the Coming Soon section into `container`, if the promo window is open.
 *
 * Independent of the modal's dismissal: acknowledging the announcement should
 * not also remove the league from the page it is advertising. It shares only
 * the date window and the artwork.
 *
 * Idempotent — an existing section is replaced, so a landing-page re-render
 * cannot stack two of them.
 */
export async function mountComingSoonSection(container) {
    if (!container) return;
    container.querySelectorAll('.' + COMING_SOON_SECTION_CLASS).forEach((el) => el.remove());

    const cfg = await loadPromoConfig();
    const soon = cfg.comingSoon;
    if (!soon || !soon.title || !promoWindowOpen(cfg)) return;

    injectPromoStyles();

    const section = document.createElement('div');
    // Same section chrome as Active Leagues / Completed Leagues, so it inherits
    // the page's card, heading and spacing treatment instead of inventing one.
    section.className = `app-section app-section--card dash-section ${COMING_SOON_SECTION_CLASS}`;

    const art = resolveArt(cfg.art);
    const treat = TREATMENTS.find((x) => x.id === cfg.treat) || TREATMENTS[1];
    /* The card gets its OWN crop, and deliberately does not inherit the modal's.
       The two frames have nothing in common: the modal's card is tall and
       portrait-ish, this one is a short 240x107 landscape strip. A setting that
       frames the photo well in one crops badly in the other — "Bottom" suits
       the modal but leaves this strip showing only the bottom edge. Centre is
       the safe default for a short wide frame, since a subject is almost never
       at the very top or bottom of a portrait photo.
       Set to 'lower' (75%) rather than a stop at either extreme: dead centre
       cut above the subject and 'bottom' showed only the very edge, which is
       what prompted widening this scale from three stops to five.
       Overridable per card via comingSoon.artPos if a future image needs it. */
    const pos = ART_POSITIONS.find((p) => p.id === soon.artPos) || ART_POS_DEFAULT;
    const typeClass = `type-${soon.leagueType || 'ubc'}`;
    const typeLabel = String(soon.leagueType || 'ubc').toUpperCase();

    section.innerHTML = `
        <h2 class="app-section-h2">${escapeHtml(COMING_SOON_HEADING)}</h2>
        <div class="active-leagues-wrapper">
            <div class="active-leagues-grid">
                <div class="league-card promo-soon-card" data-league-type="${escapeHtml(soon.leagueType || 'ubc')}">
                    ${art ? `<div class="promo-art promo-soon-art">
                        <div class="promo-art-img"></div>
                        <div class="promo-art-hue"></div>
                        <div class="promo-art-scrim"></div>
                    </div>` : ''}
                    <div class="league-card-title">
                        <button type="button" class="promo-soon-link"
                                data-tooltip-tap
                                title="${escapeHtml(COMING_SOON_FEEDBACK)}"
                                data-track="UBC promo: coming soon card">${escapeHtml(soon.title)}</button>
                    </div>
                    <div class="league-card-meta">
                        <span class="league-type-pill ${typeClass}">${escapeHtml(typeLabel)}</span>
                        <span class="status-pill promo-soon-status">${escapeHtml(COMING_SOON_PILL)}</span>
                    </div>
                    <div class="league-card-leader promo-soon-leader" aria-hidden="true"></div>
                </div>
            </div>
        </div>`;

    if (art) {
        const card = section.querySelector('.promo-soon-card');
        card.style.setProperty('--art-fallback', art.fallbackCss);
        card.style.setProperty('--art-image', art.url ? `url("${art.url}")` : 'none');
        card.style.setProperty('--art-blend', treat.blend);
        card.style.setProperty('--art-filter', treat.filter);
        card.style.setProperty('--art-pos', pos.css);
        card.style.setProperty('--art-mix', art.url ? (cfg.mix ?? 50) / 100 : 0);
    }

    /* Inserted directly after Active Leagues, not appended.
       This function is async and deliberately un-awaited, so by the time its
       config fetch resolves the synchronous Completed Leagues section is
       already in the container — appending would drop the card at the bottom
       of the page, below the completed table, instead of under the active
       leagues it belongs with. Anchoring makes the position independent of who
       finishes first. */
    const anchor = [...container.querySelectorAll('.app-section')].find(
        (s) => s.querySelector('.active-leagues-grid') && !s.classList.contains(COMING_SOON_SECTION_CLASS)
    );
    if (anchor) anchor.after(section);
    else container.appendChild(section);
}

/* ── Site entry point ────────────────────────────────────────────────────── */

/** True while the modal is on screen, so a re-check never stacks a second one. */
let _promoMounted = false;
/** Guards against two overlapping checks each fetching the config. */
let _promoChecking = false;

/**
 * Put the announcement on screen if this visitor should see it, right now.
 * Idempotent and safe to call repeatedly — that is the whole point, since it is
 * the re-check the watcher below runs.
 *
 * Returns true if it mounted on this call.
 */
async function tryMountPromo() {
    // Cheapest checks first — an acknowledged visitor never costs a fetch.
    if (_promoMounted || _promoChecking || isPromoDismissed()) return false;
    _promoChecking = true;
    try {
        return await mountPromoOverlay();
    } finally {
        _promoChecking = false;
    }
}

async function mountPromoOverlay() {
    const cfg = await loadPromoConfig();
    if (!promoWindowOpen(cfg)) return false;
    // Re-checked after the await: a dismissal or another mount can land while
    // the config is in flight.
    if (_promoMounted || isPromoDismissed()) return false;

    injectPromoStyles();

    // Resolved ONCE, before the first build: the same person is shown whichever
    // language the visitor flips to, and a flag click must not re-query.
    const manager = await resolveManager(cfg);

    let overlay;
    const build = (lang) => buildPromoModal(cfg, {
        lang,
        manager,
        // Re-render in the new language, in place. A language pick is NOT a
        // dismissal — the visitor is still reading.
        onLang: (l) => {
            const next = build(l);
            overlay.replaceWith(next);
            overlay = next;
        },
        onExit: () => { dismissPromo(); overlay.remove(); _promoMounted = false; },
    });
    overlay = build(getPopupLang());
    document.body.appendChild(overlay);
    _promoMounted = true;
    announceShown();

    // Escape closes it, like every other modal on the site. Capture phase so it
    // is handled BEFORE navigation.js's global Escape → history.back(), which
    // would otherwise navigate away instead of merely closing the notice.
    const onKey = (e) => {
        if (e.key !== 'Escape' || !overlay.isConnected) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent('shabi:interaction', {
            detail: { target: 'UBC promo: closed' },
        }));
        dismissPromo();
        overlay.remove();
        _promoMounted = false;
        document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
    return true;
}

/**
 * Tell js/analytics.js the announcement is now on screen.
 *
 * NOT an analytics event — the display is still a property of the page, never a
 * click. It exists for the LATE mount only: on an ordinary page load
 * promoBannerActive() has already answered true and every event of that page is
 * stamped, but when the notice appears on a page that was opened before the
 * window opened, that page's own flag was computed false. This flips it, so the
 * rest of that page's events (its dwell time, any click) carry the 🎉 mark.
 *
 * The pageview itself was sent at load and analytics is insert-only, so it
 * cannot be amended — that one row stays unmarked, and the visit is instead
 * counted from the first page that carries the mark. A deliberately small,
 * bounded inaccuracy affecting only visitors who were already mid-visit at the
 * moment the announcement went live.
 */
function announceShown() {
    window.dispatchEvent(new CustomEvent('shabi:promo-shown'));
}

/**
 * Show the announcement, and KEEP WATCHING so it can still appear on a page the
 * visitor is already sitting on. Called once per page load from js/analytics.js
 * — the one module every shareable page already loads, so the notice needs no
 * per-page wiring (the same hook movedNotice.js uses).
 *
 * The watching is the point. Without it, a visitor who opened a league page at
 * 23:55 and left the tab open would see nothing when the window opens at
 * midnight, and nothing at all until they navigated or reloaded — while the
 * league tables on that same screen quietly refresh themselves. The site
 * already promises that what you are looking at stays true without a refresh
 * (js/data/store.js § onVisibleRevalidate); an announcement that only a reload
 * can deliver breaks that promise.
 *
 * It uses the same THREE triggers, and the same 60s cadence, as that
 * revalidation — return-to-visible, bfcache restore, and a poll that stands
 * down entirely while the tab is hidden, so a backgrounded tab costs nothing.
 * Deliberately a re-check of this module's own cheap config fetch rather than a
 * store subscription: the thing that changes here is the CLOCK (and the config
 * file), not the league data, and the two have no reason to be coupled.
 *
 * It never navigates. The modal is appended to whatever page is open, exactly
 * as it would have been on a fresh load there.
 *
 * Deliberately async and un-awaited by its caller: it fetches a config, and
 * nothing about a promotional banner should sit in front of the page render.
 */
export async function mountPromoNotice() {
    const shown = await tryMountPromo();
    if (!shown) watchForPromo();
}

const PROMO_POLL_MS = 60_000;   // js/data/store.js § startVisiblePoll uses the same
let _promoWatching = false;

function watchForPromo() {
    if (_promoWatching || isPromoDismissed()) return;
    _promoWatching = true;

    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
        if (timer) return;
        timer = setInterval(check, PROMO_POLL_MS);
    };

    async function check() {
        // Dismissed in another tab, or the notice is no longer relevant: tear the
        // whole watcher down rather than keep a timer alive for its own sake.
        if (isPromoDismissed()) { stop(); _promoWatching = false; return; }
        const mounted = await tryMountPromo();
        if (!mounted) return;
        stop();
        _promoWatching = false;
        // The landing page's "Coming Soon" card belongs to the same announcement,
        // so it must not wait for a reload either.
        //
        // Keyed off the Active Leagues GRID, not off a page container: the card
        // is defined as "the section after Active Leagues", and on any page that
        // has no such section there is nothing for it to be after. Passing a
        // generic `main` instead put the card at the bottom of a LEAGUE page,
        // because mountComingSoonSection falls back to appending when it cannot
        // find its anchor — a fallback that is right on the landing page (where
        // the anchor may still be rendering) and wrong everywhere else.
        const grid = document.querySelector('.active-leagues-grid');
        if (grid) {
            const host = grid.closest('.app-tabpanel, main') || document.body;
            mountComingSoonSection(host).catch(() => { /* card is optional */ });
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { start(); check(); } else stop();
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
    window.addEventListener('pagehide', stop);
    if (document.visibilityState === 'visible') start();
}
