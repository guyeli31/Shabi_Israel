/**
 * errorScreen.js — full-page failure screen, in the same visual family as
 * the loading splash.
 *
 * Replaces the bare `<div class="error">Failed to load params for "X"</div>`
 * lines that used to be dropped into #content. Those were the internal
 * exception text shown verbatim: they name a function's concern ("params"),
 * not the user's, and they carry no way forward.
 *
 * The shape here is: a plain-language headline saying what could not be
 * done, one sentence on what it means or what to try, the technical text
 * folded away for debugging, and at least one action.
 *
 * See the error-screen block in css/splash.css for why it reuses the splash
 * surface but never animates.
 */

import { escapeHtml } from './sanitize.js';

/** Squares in the (unlit) ring — matches the splash's default. */
const RING_N = 24;

/* A no-entry mark: filled disc + horizontal bar. Drawn inline so it is
   themeable via currentColor and costs no request. */
const NO_ENTRY_SVG = `
<svg viewBox="0 0 100 100" role="img" aria-label="Blocked">
    <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="8"/>
    <rect x="26" y="45" width="48" height="10" rx="5" fill="currentColor"/>
</svg>`;

/**
 * Render the error screen into a container.
 *
 * @param {HTMLElement} container      where to render (usually #content)
 * @param {object}      opts
 * @param {string}      opts.title     plain-language headline — what failed,
 *                                     in the user's terms
 * @param {string}     [opts.message]  one sentence of context or advice
 * @param {Error|string} [opts.error]  the original error, folded away
 * @param {Array}      [opts.actions]  [{ label, href?, onClick?, primary? }]
 *                                     defaults to Reload + Home
 */
export function renderErrorScreen(container, { title, message, error, actions } = {}) {
    if (!container) return;

    const detail = error && (error.message || String(error));
    const acts = actions || [
        { label: 'Try again', primary: true, onClick: () => location.reload() },
        { label: 'Back to leagues', href: 'index.html' }
    ];

    const squares = Array.from({ length: RING_N }, (_, i) =>
        `<div class="sq" style="--i:${i};--a:${(i * 360 / RING_N).toFixed(4)}deg"></div>`
    ).join('');

    const actionsHtml = acts.map((a, i) => a.href
        ? `<a href="${escapeHtml(a.href)}"${a.primary ? ' class="is-primary"' : ''}>${escapeHtml(a.label)}</a>`
        : `<button type="button" data-act="${i}"${a.primary ? ' class="is-primary"' : ''}>${escapeHtml(a.label)}</button>`
    ).join('');

    container.innerHTML = `
    <div class="splash is-error" role="alert">
        <div class="splash-core">
            <div class="sp-copy">
                <p class="sp-eyebrow"><span></span><em>Shabi Israel</em></p>
                <p class="sp-stage">${escapeHtml(title || 'Something went wrong')}</p>
                ${message ? `<p class="sp-detail">${escapeHtml(message)}</p>` : ''}
            </div>
            <div class="sp-ring" data-mode="determinate">
                ${squares}
                <div class="sp-mark">${NO_ENTRY_SVG}</div>
            </div>
            <div class="sp-actions">${actionsHtml}</div>
            ${detail ? `<details class="sp-tech">
                <summary>Technical details</summary>
                <code>${escapeHtml(detail)}</code>
            </details>` : ''}
        </div>
    </div>`;

    container.querySelectorAll('.sp-actions button[data-act]').forEach(btn => {
        const a = acts[+btn.dataset.act];
        if (a && a.onClick) btn.addEventListener('click', a.onClick);
    });

    fitToContentArea(container.querySelector('.splash.is-error'));
}

/**
 * The error screen is `position: fixed` so it fills the content area edge to
 * edge, but it must not cover the navigation — that is the only way out of a
 * failed page. Rather than hardcoding the sidebar width (which changes when
 * it collapses to a rail, and becomes a top bar on narrow screens), measure
 * whatever chrome is actually rendered and inset by it.
 */
function fitToContentArea(el) {
    if (!el) return;

    const apply = () => {
        let start = 0, top = 0;

        // A side rail: pinned to the inline start, taller than it is wide.
        const side = document.querySelector('.site-sidebar');
        if (side) {
            const r = side.getBoundingClientRect();
            const atStart = document.dir === 'rtl'
                ? Math.abs(r.right - window.innerWidth) < 2
                : Math.abs(r.left) < 2;
            if (r.width > 0 && r.height > window.innerHeight * 0.5 && atStart) {
                start = r.width;
            }
        }

        // A top bar: full-width strip at the top.
        for (const sel of ['.site-mobile-topbar', '.site-topbar']) {
            const bar = document.querySelector(sel);
            if (!bar) continue;
            const r = bar.getBoundingClientRect();
            if (r.height > 0 && r.width > window.innerWidth * 0.6 && Math.abs(r.top) < 2) {
                top = Math.max(top, r.height);
            }
        }

        el.style.setProperty('--sp-chrome-start', start + 'px');
        el.style.setProperty('--sp-chrome-top', top + 'px');
    };

    apply();
    // The sidebar can collapse/expand without a reload.
    const ro = new ResizeObserver(apply);
    const side = document.querySelector('.site-sidebar');
    if (side) ro.observe(side);
    ro.observe(document.documentElement);
    window.addEventListener('resize', apply);
}

/**
 * Compact failure notice for ONE section that failed while the rest of the
 * page is fine — a chart, a table inside a tab. A full-page error screen
 * would be wrong here: the page itself loaded.
 *
 * @param {string} title  what could not be shown, in the user's terms
 * @param {Error|string} [error]  folded away for debugging
 * @returns {string} HTML
 */
export function inlineErrorHtml(title, error) {
    const detail = error && (error.message || String(error));
    return `
    <div class="sp-inline-error" role="alert">
        <span class="sp-inline-mark" aria-hidden="true">${NO_ENTRY_SVG}</span>
        <div>
            <p class="sp-inline-title">${escapeHtml(title)}</p>
            ${detail ? `<details class="sp-tech">
                <summary>Technical details</summary>
                <code>${escapeHtml(detail)}</code>
            </details>` : ''}
        </div>
    </div>`;
}

/**
 * Turn a thrown error into a user-facing sentence.
 *
 * The loaders throw messages written for us, not for the reader — e.g.
 * `Failed to load params for "X"` names an internal file/column. This maps
 * the recognisable ones onto something a person can act on, and otherwise
 * says plainly that we don't know, rather than dressing the raw text up as
 * an explanation.
 */
export function explainError(error, { leagueId, playerName } = {}) {
    const raw = (error && (error.message || String(error))) || '';

    if (/load params for|not found|no rows/i.test(raw)) {
        return {
            title: leagueId ? `We couldn't find the league "${leagueId}"` : "We couldn't find that league",
            message: 'It may have been renamed or removed. Pick one from the league list.',
            actions: [{ label: 'Browse leagues', href: 'index.html', primary: true }]
        };
    }
    if (/failed to fetch|networkerror|load failed/i.test(raw)) {
        return {
            title: 'No connection to the database',
            message: 'The site could not reach the server. Check your connection and try again.'
        };
    }
    if (/matches for/i.test(raw)) {
        return {
            title: leagueId ? `The matches for "${leagueId}" couldn't be loaded` : "The matches couldn't be loaded",
            message: 'The league exists, but its match data did not come back.'
        };
    }
    if (/landing settings|site_bundle|get_site_bundle/i.test(raw)) {
        return {
            title: "The league list couldn't be loaded",
            message: 'This is the data every page starts from, so nothing else can be shown until it loads.'
        };
    }
    if (playerName && /player/i.test(raw)) {
        return {
            title: `We couldn't load ${playerName}'s data`,
            message: 'The player may not have played in this league.'
        };
    }
    return {
        title: 'Something went wrong loading this page',
        message: 'This one is unexpected. Reloading often clears it.'
    };
}
