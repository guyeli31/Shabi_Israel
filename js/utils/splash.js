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
 *   splashStage(key)     — advance to a stage from SPLASH_STAGES
 *   endSplash()          — fade out and remove
 *   updateSplashLogo(src)— swap the centre logo (per-league logos)
 */

import {
    DEFAULT_SPLASH_CONFIG, SPLASH_STAGES,
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
let cfg = { ...DEFAULT_SPLASH_CONFIG };
let shownAt = 0;
let stageIdx = -1;
let progress = 0;
let creepRaf = null;
let slowTimer = null;
let ended = false;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ── Painting ─────────────────────────────────────────────────── */

function paintProgress() {
    if (!ringEl) return;
    const squares = ringEl.querySelectorAll('.sq');
    const lit = Math.round(progress * squares.length);
    squares.forEach((sq, i) => sq.classList.toggle('is-lit', i < lit));
}

function paintDetail() {
    const detail = el?.querySelector('.sp-detail');
    if (!detail || stageIdx < 0) return;
    detail.textContent =
        `Step ${stageIdx + 1} of ${SPLASH_STAGES.length} · ${Math.round(progress * 100)}%`;
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
    list.innerHTML = SPLASH_STAGES
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
    ended = false;
    // On a deferred (internal-navigation) load the splash is transparent until
    // __splashRevealAt, so the minimum-visible clock starts there, not now.
    shownAt = window.__splashRevealAt || performance.now();
    progress = 0;
    stageIdx = -1;

    buildSteps();
    if (ringEl) {
        // The page's inline script has already built a default ring so it can
        // paint without us. Only rebuild if the count actually differs.
        if (ringEl.querySelectorAll('.sq').length !== cfg.squares) {
            buildRing(ringEl, cfg.squares);
        }
        applySplashConfig(el, ringEl, cfg);
    }
    splashStage(SPLASH_STAGES[0].key);

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
        const next = { ...DEFAULT_SPLASH_CONFIG, ...saved };
        const countChanged = next.squares !== cfg.squares;
        cfg = next;
        applySplashConfig(el, ringEl, cfg);
        if (countChanged) buildRing(ringEl, cfg.squares);
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
    const elapsed = performance.now() - shownAt;
    slowTimer = setTimeout(
        () => slow.classList.add('is-shown'),
        Math.max(0, cfg.slowAfterMs - elapsed)
    );
}

/** Advance to a named stage. Going backwards is ignored, so callers can fire
 *  stages from concurrent promises without ordering them. */
export function splashStage(key) {
    if (!el || ended) return;
    const idx = SPLASH_STAGES.findIndex(s => s.key === key);
    if (idx < 0 || idx <= stageIdx) return;
    stageIdx = idx;

    const label = el.querySelector('.sp-stage');
    if (label && label.textContent !== SPLASH_STAGES[idx].label) {
        label.classList.remove('is-swapping');
        void label.offsetWidth;                       // restart the swap
        label.classList.add('is-swapping');
        setTimeout(() => {
            if (!ended && label) label.textContent = SPLASH_STAGES[idx].label;
        }, 150);
    }

    paintSteps();
    // Creep to just short of this stage's ceiling — see creepTo().
    creepTo(((idx + 0.92) / SPLASH_STAGES.length));
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
    if (performance.now() < shownAt) {
        document.documentElement.classList.remove('sp-defer');
        node.remove();
        return;
    }

    // Finish the ring before leaving, so the last thing seen is a complete
    // circle rather than an arbitrary arc frozen mid-fill.
    progress = 1;
    const squares = node.querySelectorAll('.sq');
    squares.forEach(sq => sq.classList.add('is-lit'));
    const list = node.querySelector('.sp-steps');
    if (list) [...list.children].forEach(li => { li.classList.add('is-done'); li.classList.remove('is-active'); });

    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
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
