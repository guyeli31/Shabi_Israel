// primitives/Icon/icon.js — inline-SVG icon primitive.
//
// A tiny built-in icon library keeps Phase 2 self-contained; later phases
// can register more icons or swap in a sprite (see public/icons/sprite.svg
// in PLAN.md). Each icon is the *inner* SVG markup (no <svg> wrapper);
// render() wraps it in a <svg> with the right viewBox and class.

const ICONS = {
    clock:
        '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    search:
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    "chevron-down":
        '<polyline points="6 9 12 15 18 9"/>',
    "chevron-right":
        '<polyline points="9 6 15 12 9 18"/>',
    check:
        '<polyline points="20 6 9 17 4 12"/>',
    x:
        '<path d="M6 6l12 12M18 6l-12 12"/>',
    user:
        '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
    star:
        '<polygon points="12 2 15 9 22 9.3 16.5 14 18 21 12 17.3 6 21 7.5 14 2 9.3 9 9 12 2"/>',
    trophy:
        '<path d="M8 4h8v3a4 4 0 1 1-8 0V4z"/><path d="M8 4H5v2a3 3 0 0 0 3 3"/><path d="M16 4h3v2a3 3 0 0 1-3 3"/><path d="M10 14h4v3h-4z"/><path d="M7 21h10"/>',
    settings:
        '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.8a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.8-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.4-.8a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.8 2-3.4-2-1.5A7 7 0 0 0 19 12z"/>',
    info:
        '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/>',
};

export function listIcons() {
    return Object.keys(ICONS);
}

/**
 * Render an inline SVG icon element.
 * @param {object} props
 * @param {string} props.name — icon key (see listIcons()).
 * @param {"xs"|"sm"|"md"|"lg"} [props.size]
 * @param {string} [props.label] — accessible label (sets aria-label + role="img").
 *                                 Omit for decorative icons (aria-hidden).
 * @param {boolean} [props.solid] — use filled style.
 * @param {string} [props.className]
 * @returns {SVGSVGElement}
 */
export function render({ name, size, label, solid, className } = {}) {
    const body = ICONS[name];
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    let cls = "icon";
    if (size) cls += " icon--" + size;
    if (solid) cls += " icon--solid";
    if (className) cls += " " + className;
    svg.setAttribute("class", cls);
    if (label) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", label);
    } else {
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
    }
    svg.innerHTML = body ?? '<rect x="3" y="3" width="18" height="18"/>';
    return svg;
}
