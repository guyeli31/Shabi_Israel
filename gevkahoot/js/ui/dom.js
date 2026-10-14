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
export function safeMedia(path) {
    return typeof path === 'string' && MEDIA_RE.test(path) ? path : null;
}

export const fmtSeconds = (ms) => (ms / 1000).toFixed(1);
