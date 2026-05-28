// primitives/Button/button.js — actionable button primitive.
//
// Accepts an optional onClick + props. Renders a <button> by default;
// pass `href` to render an anchor that visually matches the button (for
// link-styled actions like "Open admin").

/**
 * @param {object} props
 * @param {string} props.label
 * @param {"primary"|"secondary"|"ghost"|"danger"} [props.variant]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {"button"|"submit"|"reset"} [props.type="button"]
 * @param {string} [props.href] — render as <a> if provided.
 * @param {string} [props.target]
 * @param {boolean} [props.block]
 * @param {boolean} [props.iconOnly]
 * @param {boolean} [props.pill]
 * @param {boolean} [props.disabled]
 * @param {Node} [props.iconLeft]
 * @param {Node} [props.iconRight]
 * @param {(e: Event) => void} [props.onClick]
 * @param {string} [props.ariaLabel] — required if iconOnly.
 * @param {string} [props.className]
 * @returns {HTMLButtonElement|HTMLAnchorElement}
 */
export function render(props = {}) {
    const {
        label, variant, size, type = "button", href, target,
        block, iconOnly, pill, disabled,
        iconLeft, iconRight, onClick, ariaLabel, className,
    } = props;

    const isAnchor = typeof href === "string";
    const el = document.createElement(isAnchor ? "a" : "button");

    let cls = "btn";
    if (variant) cls += " btn--" + variant;
    if (size)    cls += " btn--" + size;
    if (block)   cls += " btn--block";
    if (iconOnly) cls += " btn--icon";
    if (pill)    cls += " btn--pill";
    if (className) cls += " " + className;
    el.className = cls;

    if (isAnchor) {
        el.href = href;
        if (target) {
            el.target = target;
            if (target === "_blank") el.rel = "noopener noreferrer";
        }
        if (disabled) el.setAttribute("aria-disabled", "true");
    } else {
        el.type = type;
        if (disabled) el.disabled = true;
    }

    if (ariaLabel) el.setAttribute("aria-label", ariaLabel);

    if (iconLeft)  el.appendChild(iconLeft);
    if (label && !iconOnly) {
        const span = document.createElement("span");
        span.className = "btn__label";
        span.textContent = label;
        el.appendChild(span);
    }
    if (iconRight) el.appendChild(iconRight);

    if (onClick) el.addEventListener("click", onClick);
    return el;
}
