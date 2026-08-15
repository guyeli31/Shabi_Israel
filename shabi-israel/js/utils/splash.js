/**
 * splash.js — the runtime full-screen loading screen.
 *
 * The markup is STATIC in each page's HTML, not built here: this module is
 * an ES module, so it is deferred, and anything it creates would paint after
 * the first frame. Painting the splash from the HTML means the very first
 * frame is already the branded screen instead of a bare "Loading…" line —
 * which was the whole reason for the rewrite.
 *
 * This module therefore only ANIMATES what is already on screen: it builds
 * the ring's squares, tracks stage progress, and takes the splash away.
 *
 * Public API:
 *   startSplash()        — begin; the splash is already visible
 *   splashStage(key)     — advance to a stage from the page's stage set
 *                          (`data-stages` on .splash; see SPLASH_STAGE_SETS)
 *   endSplash()          — fade out and remove
 *   updateSplashLogo(src)— swap the centre logo (per-league logos)
 */

import {
    DEFAULT_SPLASH_CONFIG, SPLASH_STAGES, stagesFor,
    loadSplashConfig, applySplashConfig, buildRing
} from './splashConfig.js';

/** Once shown, hold it at least this long — a splash that flashes for 80ms
 *  on a warm cache reads as a glitch, not as a loading screen. This is the
 *  second half of the delay/minimum pair; the delay itself is applied in the
 *  page's inline script (see `sp-defer` in css/splash.css). */
const MIN_VISIBLE_MS = 450;
/** How long the ring creeps toward the current stage's ceiling. Long on
 *  purpose: it should still be visibly moving through a slow fetch, not
 *  arrive in a third of a second and then sit frozen looking hung. */
const CREEP_MS = 2600;

let el = null;
let ringEl = null;
/** The active stage list. Chosen from `data-stages` on the .splash element,
 *  so each surface narrates its own work — see SPLASH_STAGE_SETS. */
let stages = SPLASH_STAGES;
let cfg = { ...DEFAULT_SPLASH_CONFIG };
let shownAt = 0;
let stageIdx = -1;
let progress = 0;
let creepRaf = null;
let slowTimer = null;
let ended = false;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * When the splash actually became visible.
 *
 * Read live, never cached: on an internal navigation the head script first
 * publishes an ESTIMATE (now + 350ms), then overwrites it with the real moment
 * once the splash is revealed. Caching the estimate would make the
 * minimum-display timer and the "was it ever seen?" test reason about a moment
 * that never happened.
 */
const revealedAt = () => window.__splashRevealAt || shownAt;

/* ── Painting ─────────────────────────────────────────────────── */

/* How many squares are lit right now, and how many we are heading toward. The
   two are separate on purpose — see paintProgress(). */
let litShown = 0;
let litTarget = 0;
let litRaf = null;
/** Time budget for catching up a backlog of squares. */
const CLOSE_MS = 260;

/**
 * Light squares one at a time, never in a batch.
 *
 * The obvious version — `toggle('is-lit', i < round(progress * n))` on every
 * frame — is correct but not safe, because it is only as smooth as the main
 * thread. Rendering the dashboard blocks that thread for a couple of seconds,
 * during which nothing paints; the moment it frees up, the ring jumps from
 * (measured) 4 lit squares to 24 on a single frame. Every one of those squares
 * also scales up as it lights, so the ring detonates — and the exit animation
 * starts in the same breath. That flash at the end is what a user sees as the
 * loading screen "blinking off".
 *
 * So the target moves instantly and the DISPLAY chases it: at most one square
 * per frame, a backlog cleared inside CLOSE_MS. A jump becomes a sweep.
 */
function driveLit() {
    litRaf = null;
    if (!ringEl) return;
    const squares = ringEl.querySelectorAll('.sq');
    if (litShown !== litTarget) {
        litShown += Math.sign(litTarget - litShown);
        squares.forEach((sq, i) => sq.classList.toggle('is-lit', i < litShown));
    }
    if (litShown !== litTarget) {
        // Pace the catch-up so a large backlog still closes inside the budget.
        const per = Math.max(1, Math.floor(CLOSE_MS / Math.abs(litTarget - litShown)));
        litRaf = requestAnimationFrame(() => setTimeout(driveLit, per > 16 ? per - 16 : 0));
    }
}

function paintProgress() {
    if (!ringEl) return;
    litTarget = Math.round(progress * ringEl.querySelectorAll('.sq').length);
    if (litRaf === null && litShown !== litTarget) driveLit();
}

/** True once the ring has actually caught up with the progress it represents. */
const ringSettled = () => litShown === litTarget;

function paintDetail() {
    const detail = el?.querySelector('.sp-detail');
    if (!detail || stageIdx < 0) return;
    detail.textContent =
        `Step ${stageIdx + 1} of ${stages.length} · ${Math.round(progress * 100)}%`;
}

function paintSteps() {
    const list = el?.querySelector('.sp-steps');
    if (!list) return;
    [...list.children].forEach((li, i) => {
        li.classList.toggle('is-done',   i <  stageIdx);
        li.classList.toggle('is-active', i === stageIdx);
    });
}

function buildSteps() {
    const list = el?.querySelector('.sp-steps');
    if (!list) return;
    // The chips are in the page's static HTML so they are there in the first
    // paint — see the markup comment. Rewriting identical markup would throw
    // away the painted row and flash it back in, which is the exact pop this
    // exists to avoid. Only rebuild if the page's copy has actually drifted
    // from the stage list (someone edited SPLASH_STAGE_SETS and not the HTML).
    const current = [...list.children].map(li => li.textContent.trim());
    const wanted  = stages.map(s => s.chip);
    if (current.length === wanted.length && current.every((c, i) => c === wanted[i])) return;
    list.innerHTML = stages
        .map(s => `<li><span class="dot"></span>${s.chip}</li>`).join('');
}

/**
 * Ease progress from wherever it is toward the current stage's ceiling,
 * stopping just short of it. Real stage boundaries are the only thing that
 * closes that last sliver — so the ring keeps moving during a slow fetch
 * without ever claiming a step finished before it did.
 */
function creepTo(target) {
    cancelAnimationFrame(creepRaf);
    const from = progress;
    const span = target - from;
    if (span <= 0) return;
    const t0 = performance.now();
    const tick = (now) => {
        const t = clamp01((now - t0) / CREEP_MS);
        progress = from + span * (1 - Math.pow(1 - t, 3));   // ease-out cubic
        paintProgress();
        paintDetail();
        if (t < 1 && !ended) creepRaf = requestAnimationFrame(tick);
    };
    creepRaf = requestAnimationFrame(tick);
}

/* ── Public API ───────────────────────────────────────────────── */

let started = false;

/**
 * Called automatically on import (see the bottom of this file) and again by
 * each renderer. Renderers reach their own `startSplash()` only after their
 * page's `await`s — `await initNavBar()` on the landing page can be blocked
 * on the network for seconds — which would leave the static splash sitting
 * there with an empty ring. Importing this module is the earliest moment any
 * of our JS runs, so that is when the ring gets built.
 */
export function startSplash() {
    if (started) return;
    el = document.getElementById('logo-splash');
    if (!el) return;                       // page opted out of the splash
    started = true;
    ringEl = el.querySelector('.sp-ring');
    // Which surface's work are we narrating? Declared in the markup so the
    // page's own <head> already knows it — see SPLASH_STAGE_SETS.
    stages = stagesFor(el.dataset.stages);
    ended = false;
    // On a deferred (internal-navigation) load the splash is transparent until
    // __splashRevealAt, so the minimum-visible clock starts there, not now.
    shownAt = window.__splashRevealAt || performance.now();
    progress = 0;
    stageIdx = -1;

    // How late this module runs is the whole ball game — everything above this
    // line is CSS and static markup precisely because this can be a second or
    // more behind the first paint. Keep the mark: this failure mode (a splash
    // that visibly comes alive) is invisible without a timestamp.
    performance.mark('sp:ready');

    buildSteps();

    // The ring's mode is NOT switched here, and the markup ships as
    // "determinate" on purpose.
    //
    // There was briefly a handoff: the markup started as "indeterminate" (a
    // pure-CSS sweep needing no JS) and this line flipped it to determinate.
    // It backfired. The sweep lights squares all round the ring; determinate
    // starts from one lit square. So the switch emptied a full, moving ring
    // back to almost nothing — read as the animation running, switching off,
    // and starting again. That is the "double animation", and it lived inside
    // a SINGLE page load, which is why counting navigations and opacity never
    // found it.
    //
    // It is not needed any more either: this module used to execute ~2.4s in,
    // long after the splash appeared, so the ring needed something to do
    // without JS. It now runs at domInteractive (~0.1-0.4s), before the splash
    // is even revealed, so the fill is driving from the first visible frame.
    // One animation, from empty, forwards only.

    // Deliberately NOT calling applySplashConfig() here. `cfg` is still
    // DEFAULT_SPLASH_CONFIG at this point, and applying it would write those
    // defaults as INLINE styles — which outrank the saved design that
    // splash-vars.css already put on :root. The splash would jump from the
    // saved look to the default one and back when the JSON lands ~330ms
    // later, i.e. the user's own settings would be the thing that flickers
    // away. The ring likewise stays exactly as the page's inline script built
    // it: that script sizes it from --n, so it is already the saved count.
    splashStage(stages[0].key);

    // The saved design is ALREADY applied at this point: assets/splash/
    // splash-vars.css is a blocking stylesheet in <head>, so the first paint
    // is correct without us. This fetch is for the settings CSS can't carry
    // (mode, eyebrow, slowAfterMs) and as the backstop if that generated file
    // is stale or missing — the JSON stays the source of truth.
    //
    // Normally, then, this changes nothing visible. It must never be awaited
    // before showing the splash: the fetch measured ~330ms, and a loading
    // screen that waits for its own config is a loading screen that loads.
    loadSplashConfig().then((saved) => {
        if (!saved || ended || !el || !ringEl) return;
        cfg = { ...DEFAULT_SPLASH_CONFIG, ...saved };
        applySplashConfig(el, ringEl, cfg);
        // Compare against what is actually on screen, not against the previous
        // cfg: the ring was built by the page's inline script, so cfg has never
        // described it. Rebuilding when the count already matches would throw
        // away the painted ring for an identical one.
        if (ringEl.querySelectorAll('.sq').length !== cfg.squares) {
            buildRing(ringEl, cfg.squares);
        }
        paintProgress();
        restartSlowTimer();
    }).catch(() => {});

    const retry = el.querySelector('.sp-slow button');
    if (retry) retry.addEventListener('click', () => location.reload());

    restartSlowTimer();
}

function restartSlowTimer() {
    clearTimeout(slowTimer);
    const slow = el?.querySelector('.sp-slow');
    if (!slow) return;
    const elapsed = performance.now() - revealedAt();
    slowTimer = setTimeout(
        () => slow.classList.add('is-shown'),
        Math.max(0, cfg.slowAfterMs - elapsed)
    );
}

/** Advance to a named stage. Going backwards is ignored, so callers can fire
 *  stages from concurrent promises without ordering them. */
export function splashStage(key) {
    if (!el || ended) return;
    const idx = stages.findIndex(s => s.key === key);
    if (idx < 0 || idx <= stageIdx) return;
    stageIdx = idx;

    const label = el.querySelector('.sp-stage');
    if (label && label.textContent !== stages[idx].label) {
        label.classList.remove('is-swapping');
        void label.offsetWidth;                       // restart the swap
        label.classList.add('is-swapping');
        setTimeout(() => {
            if (!ended && label) label.textContent = stages[idx].label;
        }, 150);
    }

    paintSteps();
    // Creep to just short of this stage's ceiling — see creepTo().
    creepTo(((idx + 0.92) / stages.length));
}

export function updateSplashLogo(src) {
    if (!src || !el) return;
    const img = el.querySelector('.sp-logo img');
    if (img) img.src = src;
}

export function endSplash() {
    if (!el || ended) return;
    ended = true;
    cancelAnimationFrame(creepRaf);
    clearTimeout(slowTimer);

    const node = el;
    el = null;
    ringEl = null;
    node.dataset.done = '1';                          // stops the HTML fail-safe

    // Never actually seen: the page loaded inside the defer window, so the
    // splash was still transparent. Remove it outright — no minimum-visible,
    // no fade. Fading out something the user never saw is the flicker we set
    // out to remove.
    if (performance.now() < revealedAt()) {
        document.documentElement.classList.remove('sp-defer');
        node.remove();
        return;
    }

    const list = node.querySelector('.sp-steps');
    if (list) [...list.children].forEach(li => { li.classList.add('is-done'); li.classList.remove('is-active'); });

    // Close the ring so the last thing seen is a complete circle, not the
    // arbitrary arc the progress happened to reach. `.is-closing` gives every
    // square a per-index transition-delay, so this single batch of class
    // changes still ARRIVES in sequence — see the CSS. Doing the stagger from
    // JS was tried and does not survive: the page is rendering right now, and a
    // per-frame loop gets starved and leaves the ring half full.
    litShown = litTarget = node.querySelectorAll('.sq').length;
    node.classList.add('is-closing');
    node.querySelectorAll('.sq').forEach(sq => sq.classList.add('is-lit'));

    // Let the circle finish closing before the exit starts, on top of the
    // minimum-display floor. Without this wait the fade begins over a ring
    // still lighting up, which is the flash all of the above is avoiding.
    const wait = Math.max(CLOSE_MS, MIN_VISIBLE_MS - (performance.now() - revealedAt()));
    setTimeout(() => {
        node.classList.add('is-leaving');
        node.addEventListener('animationend', () => node.remove(), { once: true });
        // Belt-and-braces: if the animation never fires (reduced motion,
        // background tab), take it away anyway.
        setTimeout(() => node.remove(), 900);
    }, wait);
}

// Start as early as any of our JS can possibly run — see startSplash().
// Safe on pages without the markup: it returns immediately when #logo-splash
// is absent, so importing this module never creates anything on its own.
startSplash();
