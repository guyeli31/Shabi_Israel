// components/StatusChip/statusChip.js — status pill with glowing dot.

const LABELS = {
    running:   "Running",
    completed: "Completed",
    recent:    "This year",
    inactive:  "Inactive",
};

/**
 * @param {object} props
 * @param {"running"|"completed"|"recent"|"inactive"} props.status
 * @param {string} [props.text] — overrides the default label.
 * @param {string} [props.title] — tooltip text.
 * @returns {HTMLSpanElement}
 */
export function render({ status = "running", text, title } = {}) {
    const span = document.createElement("span");
    span.className = "status-chip status-chip--" + status;
    if (title) span.title = title;

    const dot = document.createElement("span");
    dot.className = "status-chip__dot";
    span.appendChild(dot);
    span.append(text ?? LABELS[status] ?? status);
    return span;
}
