// primitives/Flag/flag.js — render a country-flag image.
// `code` is the ISO 3166-1 alpha-2 country code (e.g. "IL"). Assets are
// served at /assets/flags/<CODE>.png by the dev-mode shared-assets-proxy
// in vite.config.js. The default flag is IL (Israel), matching v1.

const DEFAULT_CODE = "IL";
const FLAG_BASE = "/assets/flags";

export function flagUrl(code) {
    const c = (code || DEFAULT_CODE).toUpperCase();
    return `${FLAG_BASE}/${c}.png`;
}

/**
 * Render a flag image element.
 * @param {object} props
 * @param {string} [props.code="IL"] — ISO 3166-1 alpha-2.
 * @param {"sm"|"md"|"lg"|"xl"} [props.size="md"]
 * @param {string} [props.alt] — defaults to the code itself.
 * @param {string} [props.className] — additional class names.
 * @returns {HTMLImageElement}
 */
export function render({ code = DEFAULT_CODE, size = "md", alt, className } = {}) {
    const img = document.createElement("img");
    img.className = `flag flag--${size}${className ? " " + className : ""}`;
    img.src = flagUrl(code);
    img.alt = alt ?? code;
    img.loading = "lazy";
    img.decoding = "async";
    return img;
}
