// primitives/Pill/pill.js — fully-rounded inline tag (status, league type).

/**
 * Render a pill element.
 * @param {object} props
 * @param {string} props.text
 * @param {"running"|"completed"|"doubling"|"regular"|"ubc"|"accent"} [props.variant]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {boolean} [props.uppercase]
 * @param {string} [props.className]
 * @returns {HTMLSpanElement}
 */
export function render({ text, variant, size, uppercase, className } = {}) {
    const span = document.createElement("span");
    let cls = "pill";
    if (variant) cls += " pill--" + variant;
    if (size) cls += " pill--" + size;
    if (uppercase) cls += " pill--uppercase";
    if (className) cls += " " + className;
    span.className = cls;
    span.textContent = String(text ?? "");
    return span;
}
