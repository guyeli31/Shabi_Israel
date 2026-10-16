/**
 * dom.js — the one way GevKahoot builds DOM.
 *
 * Every string on these screens that did not come from this codebase came from
 * a stranger: a player's chosen name, or question text typed into the editor.
 * h() only ever routes strings through text nodes and setAttribute — there is
 * no innerHTML anywhere in gevkahoot/, so a name like `<img onerror=…>` is
 * shown on the projector as exactly those characters.
 */

export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'text') el.textContent = value;
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key === 'style') Object.assign(el.style, value);
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            // `value` is a property, not an attribute, on a <textarea>.
            else if (key === 'value') el.value = value;
            else if (key in el && typeof value !== 'string') el[key] = value;
            else el.setAttribute(key, value === true ? '' : value);
        }
    }
    append(el, children);
    return el;
}

/** An SVG element. Attributes are numbers and fixed names written in this
 *  codebase — never a stranger's text — so setAttribute is all it needs. */
export function svgEl(tag, attrs = {}, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.setAttribute('class', value);
        else el.setAttribute(key, String(value));
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) append(el, child);
        else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/** Replace el's content, but only when `key` differs from the last render —
 *  a poll that changes nothing must not restart a running CSS animation or a
 *  playing video. Returns true when it rebuilt. */
export function renderKeyed(el, key, build) {
    if (el.dataset.viewKey === key) return false;
    el.dataset.viewKey = key;
    clear(el);
    append(el, [build()]);
    return true;
}

/**
 * A media path is only ever a file inside gevkahoot/media/: `media/<folder>/`
 * followed by ONE file name. The name may be Hebrew or contain spaces; it may
 * not contain a slash, a backslash, `? # % :` or a leading dot — nothing that
 * could turn a name into a different path or a URL. The database enforces the
 * same pattern with a CHECK (sql/gevkahoot.sql §1b); repeating it here means a
 * path is validated at the point of use too, whatever fed the state (the
 * preview frame is fed by postMessage, not by the database).
 */
const MEDIA_RE = /^media\/(images|videos|audio|backgrounds|sprites|animations)\/[^./\\?#%:*"<>|\u0000-\u001f][^/\\?#%:*"<>|\u0000-\u001f]*$/;

/*
 * Each media file's version — a hash of its content, from media/manifest.json
 * (scripts/gevkahoot-media-manifest.mjs) — goes into its address as `?v=…`.
 * A file replaced under the same name then has a NEW address, so no browser
 * (the host's, a player's) keeps showing the old picture from its cache; one
 * that did not change keeps its address and stays cached. Loaded once, before
 * any module that draws can run (top-level await), so the very first screen
 * already asks for the right versions. No manifest (a script, offline): plain
 * paths, exactly as before.
 */
let VERSIONS = {};
try {
    const res = await fetch(new URL('../../media/manifest.json', import.meta.url), { cache: 'no-store' });
    if (res.ok) VERSIONS = (await res.json()).versions || {};
} catch { /* plain paths */ }

const VERSION_RE = /\?v=[0-9a-f]{10}$/;
export function safeMedia(path) {
    if (typeof path !== 'string') return null;
    // Idempotent: an address that already carries its version is checked bare.
    const bare = path.replace(VERSION_RE, '');
    if (!MEDIA_RE.test(bare)) return null;
    const v = VERSIONS[bare.slice('media/'.length)];
    return v ? `${bare}?v=${v}` : bare;
}

export const fmtSeconds = (ms) => (ms / 1000).toFixed(1);
