// components/ExportButton/exportButton.js — "Export Image" CTA. Thin
// composition over primitive Button that knows about a loading state.

import { render as Button } from "../../primitives/Button/button.js";

/**
 * @param {object} props
 * @param {string} [props.label="Export Image"]
 * @param {() => Promise<void> | void} [props.onClick]
 * @param {"primary"|"secondary"} [props.variant="primary"]
 * @param {"sm"|"md"|"lg"} [props.size="sm"]
 * @returns {HTMLButtonElement}
 */
export function render({ label = "Export Image", onClick, variant = "primary", size = "sm" } = {}) {
    const btn = Button({ label, variant, size });
    btn.classList.add("export-button");
    if (onClick) {
        btn.addEventListener("click", async () => {
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = "Exporting…";
            try { await onClick(); }
            finally {
                btn.disabled = false;
                btn.textContent = orig;
            }
        });
    }
    return btn;
}
