/**
 * previewMode.js — Preview staged changes on the live site via fetch interception.
 *
 * When preview mode is active (?preview), this module:
 * 1. Overrides window.fetch to return staged content for matching paths
 * 2. Injects a visual banner reminding the admin they're in preview
 * 3. Rewrites internal links to preserve the ?preview flag
 */

import { hasUrlFlag } from '../utils/queryString.js';

const STAGING_KEY = 'shabi-admin-staging';

/**
 * The public URL a staged change is served from, or null when it has none.
 *
 * Only real static assets (flags, player photos) are still fetched from disk —
 * league data, params, overrides and metadata are read from Supabase, so a
 * staged change to those has nothing for this interceptor to shadow. Kept in
 * sync with stagingStore.js's targetUrl(); duplicated rather than imported so
 * preview mode stays a standalone drop-in on the public pages.
 */
function targetUrl(t) {
    if (!t) return null;
    if (t.kind === 'flag_asset') return `assets/flags/${t.code}.png`;
    if (t.kind === 'player_photo') return `assets/players/${t.filename}`;
    return null;
}

/**
 * Check if the current page is in preview mode.
 * Presence-only flag — see hasUrlFlag() in js/utils/queryString.js.
 */
export function isPreviewMode() {
    return hasUrlFlag('preview');
}

/**
 * The staged players_metadata registry ({[nickname]: meta}), or null when
 * nothing is staged / the page is not in preview mode.
 *
 * Player metadata is read from Supabase, so a staged change to it has no URL
 * for the fetch interceptor above to shadow — which is why the Players view's
 * "Live preview" kept rendering the PUBLISHED title, full name and hidden flag
 * while the form above it already showed the new ones. The staged change
 * carries the WHOLE registry as its JSON content (see playerManager.js's
 * savePlayer), so the preview can simply read it instead of fetching.
 *
 * Consumed by store.js's loadPlayersMetadata() — the one place every public
 * page reads metadata from, so the overlay lands on all of them at once.
 */
export function stagedPlayersMetadata() {
    if (!isPreviewMode()) return null;
    // One change per target (stagingStore's addChange supersedes in place).
    const change = loadStagedChanges().find(c => c.target?.kind === 'players_metadata');
    if (!change || change.type === 'delete' || change.content == null) return null;
    try {
        const parsed = JSON.parse(change.content);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Install the fetch interceptor and preview banner.
 * Call this BEFORE any data-loading code runs.
 */
export function installPreviewInterceptor() {
    const staged = loadStagedChanges();
    if (staged.length === 0) return;

    // Build a lookup map: normalized path → content, for the staged changes that
    // actually correspond to a fetchable asset.
    const pathMap = new Map();
    const deletedPaths = new Set();
    for (const change of staged) {
        const url = targetUrl(change.target);
        if (!url) continue;
        if (change.type === 'delete') {
            deletedPaths.add(normalizePath(url));
        } else if (change.content != null) {
            pathMap.set(normalizePath(url), { content: change.content, binary: change.binary || false });
        }
    }
    if (pathMap.size === 0 && deletedPaths.size === 0) {
        // Nothing fetchable is staged — still show the banner + link rewriting.
        injectBanner();
        preservePreviewParam();
        return;
    }

    // Override fetch
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        const url = (input instanceof Request) ? input.url : String(input);
        const requestPath = normalizePath(urlToRelativePath(url));

        // Check if this path has a staged version
        if (pathMap.has(requestPath)) {
            const entry = pathMap.get(requestPath);
            const contentType = guessContentType(requestPath);
            let body = entry.content;

            // Binary content (e.g., flag PNGs) is base64-encoded
            if (entry.binary) {
                const binary = atob(body);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                body = bytes;
            }

            return Promise.resolve(new Response(body, {
                status: 200,
                headers: { 'Content-Type': contentType }
            }));
        }

        // Deleted files → 404
        if (deletedPaths.has(requestPath)) {
            return Promise.resolve(new Response('Not found', { status: 404 }));
        }

        return originalFetch.call(window, input, init);
    };

    // Inject preview banner
    injectBanner();

    // Rewrite links to preserve the ?preview flag
    preservePreviewParam();

    // Build data: URLs for staged binary images so <img src> picks them up
    // (img loads bypass window.fetch and need DOM-level rewriting).
    const imgDataUrls = new Map();
    for (const [path, entry] of pathMap.entries()) {
        if (!entry.binary) continue;
        const ct = guessContentType(path);
        if (!ct.startsWith('image/')) continue;
        imgDataUrls.set(path, `data:${ct};base64,${entry.content}`);
    }
    if (imgDataUrls.size > 0) interceptImages(imgDataUrls);
}

function interceptImages(imgDataUrls) {
    const rewrite = (img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) return;
        const path = normalizePath(urlToRelativePath(new URL(src, window.location.href).href));
        if (imgDataUrls.has(path)) {
            const dataUrl = imgDataUrls.get(path);
            if (img.src !== dataUrl) img.src = dataUrl;
        }
    };
    document.querySelectorAll('img').forEach(rewrite);
    const obs = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === 'attributes' && m.target.tagName === 'IMG') rewrite(m.target);
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === 'IMG') rewrite(n);
                else n.querySelectorAll && n.querySelectorAll('img').forEach(rewrite);
            }
        }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}

// ---- Internal helpers ----

function loadStagedChanges() {
    const raw = localStorage.getItem(STAGING_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function normalizePath(p) {
    // Remove leading ./ or / , decode URI components
    let s = decodeURIComponent(p);
    s = s.replace(/^\.\//, '').replace(/^\//, '');
    return s;
}

function urlToRelativePath(url) {
    try {
        const u = new URL(url, window.location.origin);
        // Get pathname relative to the app root
        let path = u.pathname;
        // Remove base path prefix (e.g., if served from /Shabi_Israel/)
        const base = window.location.pathname.replace(/\/[^/]*$/, '/');
        if (path.startsWith(base)) {
            path = path.slice(base.length);
        }
        return path;
    } catch {
        return url;
    }
}

function guessContentType(path) {
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.csv')) return 'text/csv';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.html')) return 'text/html';
    return 'text/plain';
}

function injectBanner() {
    // Inline CSS — self-contained, no external file needed
    const style = document.createElement('style');
    style.textContent = `
        .preview-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 99999;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            font-family: var(--font-main, system-ui, sans-serif);
            font-size: 0.85rem;
            font-weight: 700;
            color: #000;
            background: repeating-linear-gradient(
                -45deg,
                #f59e0b,
                #f59e0b 10px,
                #fbbf24 10px,
                #fbbf24 20px
            );
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            letter-spacing: 0.5px;
        }
        .preview-banner-exit {
            background: #000;
            color: #fbbf24;
            border: none;
            padding: 4px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 600;
        }
        .preview-banner-exit:hover {
            background: #222;
        }
        body.preview-active {
            padding-top: 44px !important;
        }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.className = 'preview-banner';
    banner.innerHTML = `
        <span>PREVIEW MODE — Changes not yet published</span>
        <button class="preview-banner-exit" id="preview-exit-btn">Exit Preview</button>
    `;
    document.body.prepend(banner);
    document.body.classList.add('preview-active');

    banner.querySelector('#preview-exit-btn').addEventListener('click', () => {
        window.location.href = 'admin.html';
    });
}

function preservePreviewParam() {
    // Rewrite existing links
    rewriteLinks();

    // Watch for dynamically added links
    const observer = new MutationObserver(() => rewriteLinks());
    observer.observe(document.body, { childList: true, subtree: true });
}

function rewriteLinks() {
    document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        // Only rewrite local page links (not external, not #anchors, not javascript:)
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http')) return;
        // Don't rewrite admin links
        if (href.includes('admin.html')) return;
        // Skip if already flagged — in either the current valueless form or the
        // pre-2026-08 `preview=true` one, which older markup may still carry.
        if (/[?&]preview(=|&|$)/.test(href)) return;

        const separator = href.includes('?') ? '&' : '?';
        a.setAttribute('href', href + separator + 'preview');
    });
}
