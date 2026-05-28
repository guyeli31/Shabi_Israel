// primitives/Link/link.js — text-link primitive.

/**
 * @param {object} props
 * @param {string} props.href
 * @param {string} props.text
 * @param {"default"|"quiet"|"strong"|"muted"} [props.variant="default"]
 * @param {"_blank"|"_self"|"_parent"|"_top"} [props.target]
 * @param {string} [props.className]
 * @returns {HTMLAnchorElement}
 */
export function render({ href, text, variant = "default", target, className } = {}) {
    const a = document.createElement("a");
    let cls = "link";
    if (variant && variant !== "default") cls += " link--" + variant;
    if (className) cls += " " + className;
    a.className = cls;
    a.href = href;
    if (target) {
        a.target = target;
        if (target === "_blank") a.rel = "noopener noreferrer";
    }
    a.textContent = text ?? href;
    return a;
}
