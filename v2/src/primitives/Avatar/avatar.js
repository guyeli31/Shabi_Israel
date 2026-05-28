// primitives/Avatar/avatar.js — circular avatar primitive.

function initialsOf(name) {
    if (!name) return "?";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * @param {object} props
 * @param {string} [props.src] — image source. If absent, renders initials.
 * @param {string} [props.name] — used for initials fallback + alt text.
 * @param {"sm"|"md"|"lg"|"xl"} [props.size]
 * @param {"online"|"idle"|"away"} [props.status] — adds a status dot.
 * @param {string} [props.className]
 * @returns {HTMLSpanElement}
 */
export function render({ src, name, size, status, className } = {}) {
    const wrap = document.createElement("span");
    let cls = "avatar";
    if (size) cls += " avatar--" + size;
    if (className) cls += " " + className;
    wrap.className = cls;
    if (name) wrap.title = name;

    if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = name ?? "";
        img.loading = "lazy";
        wrap.appendChild(img);
    } else {
        wrap.textContent = initialsOf(name);
        wrap.setAttribute("aria-label", name ?? "user");
    }

    if (status) {
        const dot = document.createElement("span");
        dot.className = "avatar__dot" + (status !== "online" ? " avatar__dot--" + status : "");
        wrap.appendChild(dot);
    }
    return wrap;
}
