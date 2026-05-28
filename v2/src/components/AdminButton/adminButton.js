// components/AdminButton/adminButton.js — floating gear button. The
// click handler is wired by the caller; the modal/login flow lives in
// the admin page (Phase 8), not here, so this component stays
// dependency-free.

const GEAR_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>';

/**
 * @param {object} [props]
 * @param {string} [props.tooltipText="Admin Mode"]
 * @param {() => void} [props.onClick]
 * @returns {HTMLDivElement}
 */
export function render({ tooltipText = "Admin Mode", onClick } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-button";

    const tooltip = document.createElement("span");
    tooltip.className = "admin-button__tooltip";
    tooltip.textContent = tooltipText;
    wrapper.appendChild(tooltip);

    const btn = document.createElement("button");
    btn.className = "admin-button__toggle";
    btn.setAttribute("aria-label", tooltipText);
    btn.innerHTML = GEAR_SVG;
    if (onClick) btn.addEventListener("click", onClick);
    wrapper.appendChild(btn);

    return wrapper;
}
