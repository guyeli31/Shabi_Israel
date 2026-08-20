/**
 * combobox.js — the ONE canonical search field for the whole project.
 *
 * Replaces the ad-hoc "type → filter → list → pick" logic that used to be
 * re-implemented per search. Every player/entity picker mounts THIS and passes
 * only its own deltas (see the config below); the shared base owns:
 *
 *   • Touch vs non-touch separation — the base decides. On a touch device it
 *     NEVER opens the inline (under-the-field) list; the top search sheet
 *     (searchOverlay.js) is the only UI, and every field feeds it through the
 *     same adapter. On desktop the inline dropdown + keyboard nav work as usual.
 *     The exception is a field that has no list on EITHER platform because its
 *     results are the page (`resultTarget: 'inplace'`) — there touch and desktop
 *     are the same plain filter box, and no sheet opens.
 *   • The mobile sheet's shared chrome: 16px input (no zoom), pinned to the top,
 *     scroll-locked, browse-all on open, and a permanent Clear button.
 *   • Selection = write the value back + notify via a DIRECT `onChange(value)`
 *     callback — NOT a re-dispatched DOM `input` event — so a pick can never
 *     re-trigger the field's own "open on input" and re-open the list under it.
 *   • Standard extension hooks: getOptions/suggest (source), labelFor (display),
 *     decorate (flag / badge / sublabel), onPick (selection behaviour),
 *     resultTarget ('popup' inline list, or 'inplace' — no desktop popup, the
 *     caller renders results elsewhere e.g. filtering a table).
 *
 * Config (all optional):
 *   getOptions()      → (string | {value,label})[]   — sync source, substring-filtered here
 *   suggest(query)    → items | Promise<items>        — full control of matching + order
 *   labelFor(value)   → string                        — display text (default: the value)
 *   altFor(value)     → string                        — the SECOND name for this
 *                       option (for players: whichever of username / full name
 *                       `labelFor` is not showing). Rendered beside the primary
 *                       name AND matched by the filter, so an option can always
 *                       be found and recognised by either form. Not a styling
 *                       choice and not per-site: every player picker passes it.
 *   decorate(value)   → { flagCode?, badge?:{text,kind}, sublabel?, disabled? }
 *                       `disabled: true` keeps the option listed (so the user
 *                       sees WHY it is unavailable — pair it with a badge) but
 *                       makes it unpickable: no click, no Enter, skipped by
 *                       arrow-key navigation, and ignored by the mobile sheet.
 *   flagFor(value)    → html                           — legacy shorthand for a leading flag
 *   onPick(value)                                       — default: write value + onChange
 *   onChange(value)                                     — external notify (filters); direct call
 *   onSelect(value)                                     — legacy post-pick callback (kept)
 *   allowFreeText     — Enter with a non-list value is accepted (default true)
 *   resultTarget      — 'popup' (default) | 'inplace'. 'popup' uses the inline
 *                       list on desktop and the sheet on touch. 'inplace' uses
 *                       NEITHER: the caller renders the results (a filtered
 *                       table), so the field is a filter box on both platforms.
 *   identity          — true: once a value is picked, the FIELD keeps showing that
 *                       player's flag (before the input) and title badges (after
 *                       it), in the same order the dropdown row used. See below.
 *                       NEVER write `input.value` yourself on such a field —
 *                       the text and the chrome are one state. Use the returned
 *                       `setValue(key)` (label + identity together) for a value
 *                       coming from outside the list, or `setIdentity('')` when
 *                       you clear the text yourself. This is enforced, not just
 *                       asked: an identity field intercepts writes to `.value`
 *                       and drops the flag + badges when the text stops matching
 *                       the subject, so the worst a stray write can do is show
 *                       NO identity — never someone else's.
 *   browseOnOpen      — true: entering a FILLED field empties it so the list
 *                       opens on the whole roster instead of filtering to the
 *                       name already there; leaving without picking puts the
 *                       name and its identity back. For fields whose value is a
 *                       standing selection you re-point (a chart's player, one
 *                       side of a pair) rather than a query you refine.
 *
 * ── The permitted variations ────────────────────────────────────────────────
 * "Canonical" here means one generator with declared deltas, not one behaviour.
 * A call site may differ ONLY along these axes, each expressed as config:
 *
 *   what a pick does      onPick / onChange — navigate away, filter a list in
 *                         place, or leave the name in the field for a later
 *                         button. The base never decides this.
 *   identity afterwards   `identity: true` for every field the name STAYS in.
 *                         Omit it only where the field is a filter box (the
 *                         result list carries the identity) or a stepping stone
 *                         to another page. NOT a styling choice.
 *   row extras            decorate() → sublabel (full name), badge (a pill such
 *                         as NOT PLAYED), luckHtml (a measurement), iconHtml
 *                         (avatar / league glyph). Additive; never reordered.
 *   list source           getOptions (browse-all on focus) vs suggest (typed
 *                         query only, or a dependent/ordered list).
 *   popup vs inplace      resultTarget — a dropdown (desktop) / sheet (touch),
 *                         or neither because the caller renders the results
 *                         itself. 'inplace' is one decision for both platforms:
 *                         a field cannot be a filter box on desktop and a
 *                         picker on touch.
 *
 * Font size, flag size, badge markup, spacing, the mobile sheet and the
 * identity chrome are NOT variation points — they come from here and from
 * layout.css so every search reads as the same control.
 *
 * ── The identity chrome, and why it has three rules ─────────────────────────
 * A search ROW gets this for free: the flag and the title badges are children
 * of the row, so `height: 1.05em` and `font-size: 1em` resolve against the
 * row's own text and everything tracks it. Inside a FIELD none of that holds,
 * because an `<input>` can hold text and nothing else — the adornments have to
 * be absolutely-positioned siblings, which puts them outside the input's
 * typographic scope and outside its layout. Three consequences, each of which
 * shipped as a visible bug before it was a rule. Any future adornment layered
 * over a field — a unit suffix, an avatar, a status dot — inherits all three:
 *
 *   1. SIZE comes from the field, not the page. `applyIdentityLayout` copies
 *      the input's computed `font-size` onto both slots. Left alone, their em
 *      resolved against `.app-combo-wrap` (the page's inherited size) and the
 *      badges rendered 15px beside a 13.5px name — and worse as the viewport
 *      narrowed, since `--fs-*` are clamp() tokens that shrink faster than the
 *      root: +11% at 1440px, +31% at 390px, where two badges then ate 87px of
 *      padding out of a 158px field.
 *   2. SPACING has exactly one owner. `BADGE_GAP_EM` sets the name→badge
 *      distance and layout.css zeroes `.title-abbr`'s own `margin-left` inside
 *      the slot. A gap assembled from a JS constant PLUS a margin in a shared
 *      CSS rule is a gap nobody owns: it measured differently depending on a
 *      browser's stylesheet state, and it moved on its own when rule 1 landed.
 *      It is em-relative, never px — a gap after a word is typography, so it
 *      must stay a constant number of characters at every width.
 *   3. It MUST be re-run when the viewport changes, and a `ResizeObserver` on
 *      the field will not tell you. `.app-search-input` is a fixed 300px, so
 *      narrowing the window changes the clamp() font without moving any box:
 *      the observer never fires and the adornments keep the size and offset of
 *      the old width — badges parked 1.8em past a name that shrank, or sitting
 *      ON a name that grew. `onViewportResize` is that second signal.
 */

import { registerSearchAdapter, isTouchDevice, trackVisualViewport } from '../render/searchOverlay.js';
import { searchFlagHtml } from './helpers.js';

/**
 * The canonical "player identity" chip: flag · name · title badges, in that
 * order, exactly as a search row renders them. Use it ANYWHERE a picked player
 * is echoed back outside the field itself — a staged What-If card, a result
 * heading — so the thing you picked still looks like the thing you picked.
 *
 * `titleHtml` is trusted markup (titleConstants.js escapes it); `name` is not.
 * Pass `flagCode: ''` for hidden players — they carry neither flag nor titles
 * anywhere on the site.
 */
export function playerIdentityHtml({ name, flagCode = '', titleHtml = '' } = {}) {
    return `<span class="app-identity">`
        + (flagCode ? searchFlagHtml(flagCode) : '')
        + `<span class="app-identity-name">${escapeHtml(name)}${titleHtml}</span>`
        + `</span>`;
}

/* ── Identity re-layout on viewport change ───────────────────────────────
   An identity field's adornments are sized and positioned from the field's
   COMPUTED FONT SIZE, which is a clamp() token — it changes with the viewport
   width. Nothing about the field's own box does: `.app-search-input` is a fixed
   300px, so narrowing the window from 1277 to 500 shrinks the text from 13.5px
   to 11.05px while the wrap stays exactly 300px wide.

   That is why a `ResizeObserver` on the wrap is the wrong trigger and missed it
   entirely: no box changed, so it never fired, and the badges kept the font AND
   the left offset computed for the old size — 13.5px badges beside 11.05px text,
   sitting 1.8em after a name that had become narrower. Resizing the other way
   parks them ON the name instead. The observer stays for what it was written
   for (a field built inside a hidden panel, 0 → visible); the viewport is a
   separate signal and needs its own.

   One window listener drives every mounted field, coalesced into a frame so a
   drag-resize does not run the layout per pixel. Entries whose wrap has left the
   document are dropped on the next pass — chart panels are removable. */
const identityLayouts = new Set();
let identityResizeBound = false;

function onViewportResize(wrap, relayout) {
    identityLayouts.add({ wrap, relayout });
    if (identityResizeBound) return;
    identityResizeBound = true;
    let pending = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => {
            for (const entry of identityLayouts) {
                if (!entry.wrap.isConnected) identityLayouts.delete(entry);
                else if (entry.wrap.offsetWidth > 0) entry.relayout();
            }
        });
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Normalize an option (string OR {value,label}) to a { value, label } pair.
function normOption(o) {
    if (o && typeof o === 'object') {
        const value = o.value != null ? o.value : (o.label != null ? o.label : '');
        return { value: String(value), label: String(o.label != null ? o.label : value) };
    }
    return { value: String(o), label: String(o) };
}

export function mountSearchField(input, opts = {}) {
    const {
        getOptions, suggest, labelFor, altFor, decorate, flagFor,
        onPick, onChange, onSelect,
        allowFreeText = true,
        resultTarget = 'popup',
        identity = false,
        browseOnOpen = false,
    } = opts;

    const popup = resultTarget !== 'inplace';
    const touch = isTouchDevice();

    const wrap = document.createElement('div');
    wrap.className = 'app-combo-wrap' + (identity ? ' app-combo-wrap--identity' : '');
    input.replaceWith(wrap);
    wrap.appendChild(input);

    // Identity chrome — the picked player's flag and title badges, rendered as
    // adornments INSIDE the field: flag against the leading edge, titles against
    // the trailing one, in the same order a dropdown row uses (flag · name ·
    // titles). They are overlays, not siblings, because an <input> cannot hold
    // markup — so the input's own padding is grown to exactly their width and
    // the typed text can never run underneath them. Both are pointer-events:none
    // in CSS, so clicking a badge still focuses the field. aria-hidden because
    // the input's value already announces the name; a screen reader re-reading
    // the flag code adds nothing.
    let identityFlagEl = null;
    let identityTitlesEl = null;
    let basePadLeft = 0;
    let basePadRight = 0;
    let baseMeasured = false;
    if (identity) {
        identityFlagEl = document.createElement('span');
        identityFlagEl.className = 'app-combo-identity-flag';
        identityFlagEl.setAttribute('aria-hidden', 'true');
        identityTitlesEl = document.createElement('span');
        identityTitlesEl.className = 'app-combo-identity-titles';
        identityTitlesEl.setAttribute('aria-hidden', 'true');
        wrap.appendChild(identityFlagEl);
        wrap.appendChild(identityTitlesEl);
    }

    // Grow the input's padding to clear whichever adornments are showing. Called
    // after every paint AND again once the flag image has loaded, because an
    // <img> with `width:auto` measures 0 until it has its intrinsic size — the
    // first pass would otherwise reserve no room for it.
    // Width of `text` as this input will actually render it — same font, same
    // size — measured on a shared offscreen canvas rather than a probe element,
    // so nothing is inserted into the document to find out.
    let _measureCtx = null;
    function textWidth(text) {
        if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
        const cs = getComputedStyle(input);
        _measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return _measureCtx.measureText(text).width;
    }

    // The field's OWN padding — the inset the flag lines up with. Measured
    // lazily, and only once the field is actually in the document: a caller may
    // mount the combobox on an element it has not appended yet (the player
    // page's comparison row builds its whole panel first), and getComputedStyle
    // on a detached node reports 0, which parked the flag flush against the
    // border while every other field sat at 12px. Our own inline padding is
    // cleared for the read so the base value can never accumulate.
    function measureBasePadding() {
        if (baseMeasured || !input.isConnected) return;
        const prevLeft = input.style.paddingLeft;
        const prevRight = input.style.paddingRight;
        input.style.paddingLeft = '';
        input.style.paddingRight = '';
        const cs = getComputedStyle(input);
        basePadLeft = parseFloat(cs.paddingLeft) || 0;
        basePadRight = parseFloat(cs.paddingRight) || 0;
        input.style.paddingLeft = prevLeft;
        input.style.paddingRight = prevRight;
        baseMeasured = true;
    }

    // How much air each adornment gets.
    //
    // The badge gap is expressed in EM of the field's own text, never in px: a
    // gap after a word is typography, so it has to be a constant number of
    // characters at every viewport, exactly as it is in a table cell — where the
    // badge follows the name inline and `.title-abbr`'s `margin-left: 0.5em`
    // sets it (0.5em = 1.83 space characters in this font). A fixed px gap looks
    // identical to an em one at the width you happen to check, then drifts: the
    // field's font is a clamp() token, so 12px is 0.89em at 1440px and 1.20em at
    // 390px — the same distance reading as a wider and wider space as the type
    // shrinks.
    //
    // 0.75em rather than the table's 0.5em, because the same distance reads
    // tighter here: the table's badge is baseline-aligned after the text, while
    // the field's is a filled pill centred on the field, so its box overshoots
    // the name's ink above and below and crowds it. Whatever the number, it is
    // the ONLY thing setting the name→badge distance — layout.css zeroes
    // `.title-abbr`'s own margin inside the slot, because a gap assembled from a
    // JS constant PLUS a margin in a shared CSS rule is a gap nobody owns: it
    // measured differently depending on which stylesheet state a browser had,
    // and it moved on its own when the slot's font-size was corrected.
    //
    // The flag keeps a plain px gap: it is a picture, not text, with its own
    // margin of white baked into the image, and it aligns to the field's padding
    // rather than to a character.
    const FLAG_GAP = 6;
    const BADGE_GAP_EM = 0.75;

    function applyIdentityLayout() {
        measureBasePadding();
        const gap = FLAG_GAP;
        // The adornments are em-sized (`.title-abbr` is `font-size: 1em`, the flag
        // `height: 1.05em`) so that a badge always matches the text it belongs to
        // — the same rule that makes them look right inside a table cell, where
        // they are children of the cell and the em resolves against the cell's
        // font. Here they CANNOT be children: an <input> holds text and nothing
        // else, so they are absolutely-positioned SIBLINGS, and their em resolved
        // against `.app-combo-wrap` — the page's inherited size — instead of the
        // field's own `var(--fs-090)`. Same badge, same class, measuring a
        // different neighbour: 15px beside a 13.5px name in the field, against a
        // perfect 12.75/12.75 in the table two rows below.
        //
        // The gap WIDENS as the viewport narrows, because `--fs-*` are clamp()
        // tokens that shrink faster than the root: +11% at 1440px, +31% at 390px,
        // where two badges then claimed 87px of padding-right out of a 158px field
        // and left the name 38px to live in.
        //
        // So hand the slots the field's own computed size. Read every pass rather
        // than cached with the base padding: the token is viewport-dependent, and
        // a field may also carry a deliberate skin (the pinned mobile bar forces
        // 16px) — copying the computed value keeps every such case in step with
        // no second rule. Must precede the offsetWidth reads below, which it
        // changes.
        const fieldFontSize = getComputedStyle(input).fontSize;
        identityFlagEl.style.fontSize = fieldFontSize;
        identityTitlesEl.style.fontSize = fieldFontSize;
        // Same font, so one em here is one em of the name the badges trail.
        const badgeGap = (parseFloat(fieldFontSize) || 0) * BADGE_GAP_EM;

        // The flag sits exactly where the field's own text would have started,
        // so it lines up with the value rather than floating in from an
        // arbitrary offset.
        identityFlagEl.style.left = `${basePadLeft}px`;
        const flagW = identityFlagEl.firstChild ? identityFlagEl.offsetWidth : 0;
        const titlesW = identityTitlesEl.firstChild ? identityTitlesEl.offsetWidth : 0;

        // Padding keeps the typed text clear of both adornments.
        const padLeft = flagW ? basePadLeft + flagW + gap : basePadLeft;
        input.style.paddingLeft = flagW ? `${padLeft}px` : '';
        input.style.paddingRight = titlesW ? `${basePadRight + titlesW + badgeGap}px` : '';

        if (!titlesW) return;
        // Title badges belong to the NAME, not to the field: they trail the last
        // character, mirroring the way the flag leads the first one, exactly as a
        // dropdown row renders them. Only when the name is too long to leave
        // room do they fall back to the trailing edge — at which point the text
        // scrolls under its own padding and stops short of them anyway.
        const trailing = padLeft + textWidth(input.value) + badgeGap;
        const pinnedRight = input.clientWidth - basePadRight - titlesW;
        identityTitlesEl.style.right = 'auto';
        identityTitlesEl.style.left = `${Math.min(trailing, Math.max(pinnedRight, padLeft))}px`;
    }

    // The value this field currently STANDS FOR, independent of the text showing
    // in it. `browseOnOpen` empties the text to browse the full list, so the two
    // deliberately come apart; this is what the field goes back to.
    let subject = '';

    /** Paint (or with a falsy value, erase) the identity chrome. Paint only. */
    function paintIdentity(value) {
        if (!identity) return;
        const d = (value && decorate) ? (decorate(value) || {}) : {};
        identityFlagEl.innerHTML = d.flagCode ? searchFlagHtml(d.flagCode) : '';
        identityTitlesEl.innerHTML = d.titleHtml || '';
        applyIdentityLayout();
        // Re-measure next frame as well: the badges trail the field's TEXT, and
        // on the onPick path the caller writes input.value after this returns —
        // so the first pass would place them against the previous value's width.
        requestAnimationFrame(applyIdentityLayout);
        const img = identityFlagEl.querySelector('img');
        if (img && !img.complete) img.addEventListener('load', applyIdentityLayout, { once: true });
    }

    /* A field can be BUILT while its tab panel is still hidden — every chart
       picker on the league page is, because the panel is populated before the
       tab is shown. `display:none` makes offsetWidth 0, so the layout above
       measured a flag of zero width, allocated no padding for it, and then never
       ran again: the flag overlay ended up sitting ON TOP of the first letters
       of the name. `Avi` with a flag over `Av` reads as a lone `i`, which is
       exactly what it looked like — a field that appeared to have lost its name
       until the first click nudged something into re-rendering.

       isConnected does NOT catch this: a hidden element is still connected. The
       thing that actually changes is the box getting a size, so that is what we
       watch. Cheap — one observer per identity field, and the callback is a
       no-op until the size is real.

       It does NOT cover a viewport change — the field is a fixed 300px, so its
       box is unmoved while its clamp() font shrinks. `onViewportResize` below is
       that signal; see its note. No feedback loop from either: the only thing
       the callback writes back to the field is padding, and the input is
       `box-sizing: border-box`, so its width — and the wrap's — is unmoved. */
    if (identity && typeof ResizeObserver !== 'undefined') {
        let lastWidth = -1;
        new ResizeObserver(() => {
            const w = wrap.offsetWidth;
            if (w > 0 && w !== lastWidth) applyIdentityLayout();
            lastWidth = w;
        }).observe(wrap);
    }
    if (identity) onViewportResize(wrap, applyIdentityLayout);

    /**
     * Declare what the field stands for, and paint it. Reads the SAME
     * `decorate()` the dropdown row used, so the flag and badges inside the
     * field can never disagree with the ones you clicked. Callers use this to
     * announce a value they set programmatically (a preselected chart row) or to
     * empty the field (What-If, after staging the pair).
     */
    function setIdentity(value) {
        subject = value || '';
        paintIdentity(subject);
    }

    /**
     * Point the field at a value chosen OUTSIDE the list — a click on a table
     * row, a deep link, a caller's own "jump to this player" control. Writes the
     * display label AND repaints the identity in one call, which is the entire
     * reason it exists: those were two separate steps, and a caller that did only
     * the first left the PREVIOUS player's flag and title badges sitting beside
     * the new name. That shipped — clicking an opponent in the All Opponents
     * table put `YossiEliezer23` in the H2H field with boutsky's G2 still on it.
     *
     * It also writes `labelFor(value)`, not the raw key, so an external jump
     * cannot disagree with what the dropdown would have shown for the same
     * player under the "Show name as" toggle.
     *
     * Deliberately NOT `choose()`: this is not a selection from the list, so it
     * fires neither onPick nor onChange — the caller is already doing whatever
     * its own click means, and re-entering the pick path would double it.
     */
    function setValue(value) {
        writeText(value ? (labelFor ? labelFor(value) : value) : '');
        setIdentity(value);
        close();
    }

    /* Every write to the field's text that this module makes goes through here,
       so the guard below can tell "the combobox moved the text, and the chrome
       with it" from "somebody outside moved the text and left the chrome". */
    let internalValueWrite = false;
    function writeText(text) {
        internalValueWrite = true;
        try { input.value = text; } finally { internalValueWrite = false; }
    }

    /* ── The structural half of "text and chrome are one state" ──────────────
       `setValue()` makes doing it right a single call, but a header rule cannot
       stop the next call site from writing `input.value` directly — which is
       exactly how the H2H field ended up showing one player's name over another
       player's flag and title badges. So an identity field intercepts the write.

       It cannot REPAIR the chrome: the text is a display label and the identity
       is keyed by username, and there is no reliable way back from one to the
       other (two players can share a full name; a caller may write anything).
       What it can do is guarantee the chrome is never WRONG — an outside write
       whose text does not match the current subject's label drops the flag and
       badges, exactly as typing into the field does. A missing flag is a caller
       that should have used `setValue`; a wrong flag is a lie about who this is.

       Instance-level, over the native accessor, so `.value` reads and every
       other input behaviour are untouched. */
    if (identity) {
        const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (native && native.get && native.set) {
            Object.defineProperty(input, 'value', {
                configurable: true,
                enumerable: true,
                get() { return native.get.call(this); },
                set(v) {
                    native.set.call(this, v);
                    if (internalValueWrite) return;
                    const expected = subject ? (labelFor ? labelFor(subject) : subject) : '';
                    if (String(v) !== expected) setIdentity('');
                },
            });
        }
    }

    const dropdown = document.createElement('ul');
    dropdown.className = 'app-combo-dropdown';
    dropdown.hidden = true;
    dropdown.setAttribute('role', 'listbox');
    wrap.appendChild(dropdown);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');

    let filtered = [];   // current [{value,label}]
    let activeIdx = -1;
    let openSeq = 0;
    // Only used by the legacy notify path below (callers with neither onChange
    // nor onPick): guards the field's own open() while we re-emit a DOM `input`.
    let suppressOpen = false;

    // Resolve the item list for a query — `suggest` (may be async) wins, else a
    // substring filter over `getOptions`. Always returns a Promise<normOption[]>.
    function resolveItems(query) {
        const q = query.trim().toLowerCase();
        if (suggest) return Promise.resolve(suggest(query)).then(list => (list || []).map(normOption));
        const all = (getOptions ? getOptions() : []).map(normOption);
        const pool = q ? all.filter(o => matchesQuery(o, q)) : all;
        return Promise.resolve(pool);
    }

    /**
     * Does this option match what was typed? The key, the displayed label, AND
     * the second name — so a player is findable by either form of their name no
     * matter which one the display preference is currently showing. Exported on
     * the returned handle so a call site with its own `suggest` (What-If's
     * dependent opponent list) matches by exactly the same rule instead of
     * restating a weaker one.
     */
    function matchesQuery(o, qLower) {
        const q = qLower ?? '';
        if (!q) return true;
        if (o.value.toLowerCase().includes(q)) return true;
        if (String(displayLabel(o)).toLowerCase().includes(q)) return true;
        const alt = altFor ? (altFor(o.value) || '') : '';
        return !!alt && alt.toLowerCase().includes(q);
    }

    // Per-option display + decorations.
    function displayLabel(o) { return labelFor ? labelFor(o.value) : o.label; }
    function extrasFor(o) {
        const d = decorate ? (decorate(o.value) || {}) : {};
        const flagHtml = d.flagCode ? searchFlagHtml(d.flagCode) : (flagFor ? (flagFor(o.value) || '') : '');
        // titleHtml and luckHtml are trusted markup (BMAB / championship badges
        // from titleConstants.js, the luck figure from utils/playerLuckBadge.js —
        // both already escaped there) — rendered right after the name.
        // The second name is the canonical secondary text; `sublabel` stays for
        // non-player pickers that put something else there (the admin's league
        // preset shows the league type).
        const alt = altFor ? (altFor(o.value) || '') : '';
        return {
            iconHtml: d.iconHtml || '', flagHtml, titleHtml: d.titleHtml || '',
            luckHtml: d.luckHtml || '', badge: d.badge || null, sublabel: alt || d.sublabel || '',
            disabled: !!d.disabled,
        };
    }

    function optionHtml(o, i) {
        const { iconHtml, flagHtml, titleHtml, luckHtml, badge, sublabel, disabled } = extrasFor(o);
        const name = escapeHtml(displayLabel(o));
        const off = disabled ? ' is-disabled' : '';
        const aria = disabled ? ' aria-disabled="true"' : '';
        const rich = !!(iconHtml || flagHtml || titleHtml || luckHtml || badge || sublabel);
        if (!rich) return `<li class="app-combo-option${off}" role="option"${aria} data-idx="${i}">${name}</li>`;
        // Row order is fixed: IDENTITY on the left — flag, primary name with its
        // title badges, then the second name — and INFORMATION on the right —
        // the luck figure, then any pill. Titles live inside the name span
        // because they are part of how a player is addressed; the luck figure
        // and the pill are measurements ABOUT them, so they sit outside it and
        // keep their own colours instead of inheriting the name's.
        return `<li class="app-combo-option app-combo-option--flag${off}" role="option"${aria} data-idx="${i}">`
            + `${iconHtml}${flagHtml}<span class="app-combo-option-name">${name}${titleHtml}</span>`
            + (sublabel ? `<span class="app-combo-option-sub">${escapeHtml(sublabel)}</span>` : '')
            + luckHtml
            + (badge ? `<span class="sf-badge sf-badge--${escapeHtml(badge.kind)}">${escapeHtml(badge.text)}</span>` : '')
            + `</li>`;
    }

    // Arrow-key step that lands on the next SELECTABLE row in `dir`, hopping over
    // disabled ones. Stays put (returns the current index) when there is nothing
    // selectable further along, so the highlight never parks on an unpickable row.
    function nextEnabled(from, dir) {
        // ArrowUp with nothing highlighted yet kept its pre-existing meaning:
        // land on the first row (searching forward), not on nothing.
        if (from < 0 && dir < 0) { from = -1; dir = 1; }
        for (let i = from + dir; i >= 0 && i < filtered.length; i += dir) {
            if (!filtered[i].disabled) return i;
        }
        return from;
    }

    function highlight() {
        const items = dropdown.querySelectorAll('.app-combo-option');
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    // Open the inline list. No-op on touch (the sheet is the only UI there) and
    // for inplace fields (no desktop popup at all).
    function open() {
        if (!popup || touch) return;
        const seq = ++openSeq;
        resolveItems(input.value).then(items => {
            if (seq !== openSeq) return;
            // Resolve `disabled` ONCE per open and cache it on the item, so the
            // click/keyboard guards below agree with what was actually rendered
            // (decorate() reads live state and could otherwise answer differently
            // between render and pick).
            filtered = items.map(o => ({ ...o, disabled: extrasFor(o).disabled }));
            activeIdx = -1;
            if (filtered.length === 0) { close(); return; }
            dropdown.innerHTML = filtered.map(optionHtml).join('');
            dropdown.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        });
    }

    function close() {
        openSeq++;               // cancel any in-flight open()
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        activeIdx = -1;
    }

    // Selection: write the value, close, then notify. The canonical path uses
    // DIRECT callbacks (no DOM `input` event) so a pick can never re-open the
    // list. Callers that pass neither onPick nor onChange (legacy) still get a
    // one-shot DOM `input` event — guarded so it can't self-reopen.
    function choose(value) {
        // Paint first, so an onPick that re-renders its own chrome still sees a
        // field whose identity already matches the pick.
        setIdentity(value);
        if (onPick) { onPick(value); close(); return; }
        writeText(value);
        close();
        if (onChange || onSelect) {
            if (onChange) onChange(value);
            if (onSelect) onSelect(value);
        } else {
            suppressOpen = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            suppressOpen = false;
        }
    }

    // Programmatic reset — used by a caller's own Clear button. Empties the
    // field, closes the list, and notifies (so dependent filters reset) WITHOUT
    // re-focusing (focusing would re-open the list).
    function clear() {
        writeText('');
        setIdentity('');
        close();
        if (onChange) onChange('');
    }

    // Mobile sheet adapter — same source, decorations and pick path. The sheet
    // is told about `browseOnOpen` too, so a tap opens the same full list a
    // click opens on desktop rather than the field's value pre-filtering it.
    registerSearchAdapter(input, {
        // An `inplace` field renders its results in the page, so there is
        // nothing for the sheet to show — the marker makes the overlay's tap
        // interceptor leave it alone and the field filters on touch exactly as
        // it does on desktop. The hooks below stay wired for every other field.
        inplace: !popup,
        browseOnOpen,
        suggest(query) {
            return resolveItems(query).then(items => items.slice(0, 200).map(o => {
                const { iconHtml, flagHtml, titleHtml, luckHtml, badge, sublabel, disabled } = extrasFor(o);
                const item = { label: displayLabel(o), value: o.value, key: o.value };
                if (disabled) item.disabled = true;
                if (iconHtml) item.iconHtml = iconHtml;
                if (flagHtml) item.flagHtml = flagHtml;
                if (titleHtml) item.titleHtml = titleHtml;
                if (luckHtml) item.luckHtml = luckHtml;
                if (badge) item.badge = badge;
                if (sublabel) item.sublabel = sublabel;
                return item;
            }));
        },
        pick(item) { choose(item.value); },
    });

    // Entering the field: with `browseOnOpen`, empty the text first so the list
    // opens on EVERYTHING rather than filtering to the one name already sitting
    // there — the field's value doubles as the query, so a filled field would
    // otherwise open a one-row list of the thing you already chose. `subject`
    // survives, so blur restores the name and its identity if nothing new was
    // picked. Bound to BOTH focus and click: the pick path keeps focus in the
    // field, so a second click fires no focus event at all.
    const enterField = () => {
        if (suppressOpen) return;
        if (browseOnOpen && input.value !== '') {
            writeText('');
            paintIdentity('');       // paint only — `subject` is what we go back to
        }
        open();
    };
    input.addEventListener('focus', enterField);
    input.addEventListener('click', enterField);

    /* ── Touch: the typing surface is always at the top ──────────────────────
       Not an option a call site declares — a rule the base derives, so a field
       cannot lose it by accident. On touch, tapping a field low on the page puts
       it under the on-screen keyboard; the sheet solves that for every field
       that HAS a list, by being pinned. A field with no list gets no sheet, so
       it pins ITSELF: same place on screen, same 16px input, same
       visualViewport tracking (shared, not copied — see trackVisualViewport).

       A spacer of the field's own height takes its place in the flow, so the
       page underneath doesn't jump up by the height of the box the moment it
       lifts out. Deliberately NOT modal: no scrim, no scroll lock, no tap-to-
       close, because the results ARE the page behind it — dimming them, freezing
       them or swallowing taps on them would each break the thing being filtered. */
    if (touch && !popup) {
        let bar = null;
        let anchor = null;
        let untrack = null;

        const unpin = (alsoBlur) => {
            if (!bar) return;
            anchor.before(wrap);          // back into the flow, exactly where it was
            anchor.remove(); anchor = null;
            bar.remove(); bar = null;
            untrack?.(); untrack = null;
            if (alsoBlur) input.blur();
        };

        const pin = () => {
            if (bar) return;
            // A comment node marks the spot the field came from — and NOTHING
            // else. The field is on screen the whole time, just at the top, so
            // holding its old height open would leave a hole in the page and
            // cost a row of the table for no reason: the content simply closes
            // up while the bar is out, and reopens when it returns.
            anchor = document.createComment('pinned-search-field');

            // The wrap is MOVED into the bar rather than being styled as the bar
            // itself, so its box keeps the exact geometry the identity overlays
            // (flag / title badges) are measured against — those are positioned
            // relative to the wrap, and shrinking it to make room for buttons
            // would slide them off the text.
            bar = document.createElement('div');
            bar.className = 'app-pinned-bar';
            wrap.replaceWith(anchor);
            anchor.after(bar);
            bar.appendChild(wrap);

            // The same two controls the sheet carries, so the touch chrome reads
            // as one control whether or not the field has a list. Their MEANING
            // differs with modality, and that difference is the whole point:
            //   Clear — empties the query. Identical to the sheet's.
            //   Done  — unpins and drops the keyboard but KEEPS the filtered
            //           table. The sheet's ✕ abandons, because a sheet you close
            //           leaves nothing behind; here the filtered page IS the
            //           result you were working toward, so throwing it away on
            //           dismiss would delete the user's work.
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'search-sheet-clear';
            clearBtn.textContent = 'Clear';
            clearBtn.setAttribute('aria-label', 'Clear search');

            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className = 'search-sheet-close';
            doneBtn.textContent = '✕';
            doneBtn.setAttribute('aria-label', 'Done searching');

            // pointerdown + preventDefault: a plain click would blur the input
            // first, which unpins the bar and removes the button out from under
            // the finger before its own click ever fires.
            clearBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                clear();
                input.focus();
            });
            doneBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                unpin(true);
            });

            bar.appendChild(clearBtn);
            bar.appendChild(doneBtn);
            untrack = trackVisualViewport(bar);

            // Re-parenting the wrap took the input out of the document for an
            // instant, and a browser BLURS an input that leaves the tree — which
            // fired the blur handler below and tore the bar down again ~120ms
            // after it appeared: tap the field, watch the bar flash and vanish.
            // Restoring focus is what makes the move survivable, and it must
            // happen here, synchronously after the move.
            input.focus();
        };

        input.addEventListener('focus', pin);
        input.addEventListener('blur', () => {
            // After a button's pointerdown has had its turn (it re-focuses).
            setTimeout(() => { if (document.activeElement !== input) unpin(false); }, 120);
        });
    }
    input.addEventListener('blur', () => {
        if (!browseOnOpen) return;
        // After the dropdown's own mousedown-pick has had time to land.
        setTimeout(() => {
            if (!subject || input.value !== '') return;
            writeText(labelFor ? labelFor(subject) : subject);
            paintIdentity(subject);
        }, 160);
    });
    input.addEventListener('input', () => {
        if (suppressOpen) return;
        // Real user typing: the text no longer necessarily names the player whose
        // flag is showing, so drop the identity rather than let it go stale.
        setIdentity('');
        // Open the list (desktop) and notify filters live.
        open();
        if (onChange) onChange(input.value);
    });

    input.addEventListener('keydown', (e) => {
        if (dropdown.hidden) {
            if (e.key === 'Enter' && allowFreeText && onChange) onChange(input.value);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = nextEnabled(activeIdx, 1);
            highlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = nextEnabled(activeIdx, -1);
            highlight();
        } else if (e.key === 'Enter') {
            if (activeIdx >= 0 && filtered[activeIdx] && !filtered[activeIdx].disabled) {
                e.preventDefault();
                e.stopImmediatePropagation();
                choose(filtered[activeIdx].value);
            }
        } else if (e.key === 'Escape') {
            close();
        }
    });

    // mousedown (not click) so selection fires before the input's blur closes the list
    dropdown.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.app-combo-option');
        if (!li) return;
        e.preventDefault();          // keep focus in the field even on a dead row
        const item = filtered[Number(li.dataset.idx)];
        if (!item || item.disabled) return;
        choose(item.value);
    });

    input.addEventListener('blur', () => setTimeout(close, 150));

    return { close, clear, wrap, dropdown, setIdentity, setValue, matchesQuery };
}

// Backward-compatible alias — existing callers keep working unchanged.
export const mountCombobox = mountSearchField;
