// components/FilterPill/filterPill.js — toggleable filter chip. Composes
// primitive Chip with a click handler that flips its selected variant.

import { render as Chip } from "../../primitives/Chip/chip.js";

/**
 * @param {object} props
 * @param {string} props.text
 * @param {boolean} [props.selected]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {(selected:boolean) => void} [props.onChange]
 * @returns {HTMLSpanElement}
 */
export function render({ text, selected = false, size, onChange } = {}) {
    const chip = Chip({
        text,
        size,
        variant: selected ? "selected" : "muted",
    });
    chip.classList.add("filter-pill");
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-pressed", String(selected));
    chip.tabIndex = 0;

    const toggle = () => {
        const next = chip.getAttribute("aria-pressed") !== "true";
        chip.setAttribute("aria-pressed", String(next));
        chip.classList.remove("chip--selected", "chip--muted");
        chip.classList.add(next ? "chip--selected" : "chip--muted");
        if (onChange) onChange(next);
    };

    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
        }
    });
    return chip;
}
