// primitives/Chip/chip.js — inline tag with optional remove button.

/**
 * @param {object} props
 * @param {string} props.text
 * @param {"accent"|"muted"|"selected"} [props.variant]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {boolean} [props.removable]
 * @param {(e: Event) => void} [props.onRemove]
 * @param {string} [props.className]
 * @returns {HTMLSpanElement}
 */
export function render({ text, variant, size, removable, onRemove, className } = {}) {
    const span = document.createElement("span");
    let cls = "chip";
    if (variant) cls += " chip--" + variant;
    if (size) cls += " chip--" + size;
    if (className) cls += " " + className;
    span.className = cls;

    const label = document.createElement("span");
    label.className = "chip__label";
    label.textContent = String(text ?? "");
    span.appendChild(label);

    if (removable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip__close";
        btn.setAttribute("aria-label", `Remove ${text ?? ""}`);
        btn.textContent = "✕"; // ✕
        if (onRemove) btn.addEventListener("click", onRemove);
        span.appendChild(btn);
    }
    return span;
}
