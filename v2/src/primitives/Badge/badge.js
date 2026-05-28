// primitives/Badge/badge.js — small inline tag (medal, count, marker).

/**
 * Render a badge element.
 * @param {object} props
 * @param {string|number} props.text — label content.
 * @param {"gold"|"silver"|"bronze"|"accent"|"neutral"} [props.variant]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {boolean} [props.circle] — fixed-aspect circle (e.g. medals).
 * @param {string} [props.title] — optional tooltip text.
 * @param {string} [props.className]
 * @returns {HTMLSpanElement}
 */
export function render({ text, variant, size, circle, title, className } = {}) {
    const span = document.createElement("span");
    let cls = "badge";
    if (variant) cls += " badge--" + variant;
    if (size) cls += " badge--" + size;
    if (circle) cls += " badge--circle";
    if (className) cls += " " + className;
    span.className = cls;
    if (title) span.title = title;
    span.textContent = String(text ?? "");
    return span;
}
