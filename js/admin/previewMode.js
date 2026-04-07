/**
 * previewMode.js — Preview staged changes on the live site via fetch interception.
 *
 * When preview mode is active (?preview=true), this module:
 * 1. Overrides window.fetch to return staged content for matching paths
 * 2. Injects a visual banner reminding the admin they're in preview
 * 3. Rewrites internal links to preserve the ?preview=true param
 */

const STAGING_KEY = 'shabi-admin-staging';

/**
 * Check if the current page is in preview mode.
 */
export function isPreviewMode() {
    return new URLSearchParams(window.location.search).has('preview');
}

/**
 * Install the fetch interceptor and preview banner.
 * Call this BEFORE any data-loading code runs.
 */
export function installPreviewInterceptor() {
    const staged = loadStagedChanges();
    if (staged.length === 0) return;

    // Build a lookup map: normalized path → content
    const pathMap = new Map();
    for (const change of staged) {
        if (change.type === 'delete') continue; // deleted files should 404
        if (change.content == null) continue;
        // Normalize: strip leading slash, decode URI components for comparison
        const normalized = normalizePath(change.path);
        pathMap.set(normalized, { content: change.content, binary: change.binary || false });
    }

    // Also track deleted paths
    const deletedPaths = new Set();
    for (const change of staged) {
        if (change.type === 'delete') {
            deletedPaths.add(normalizePath(change.path));
        }
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

    // Rewrite links to preserve ?preview=true
    preservePreviewParam();
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
        // Skip if already has preview param
        if (href.includes('preview=true')) return;

        const separator = href.includes('?') ? '&' : '?';
        a.setAttribute('href', href + separator + 'preview=true');
    });
}
