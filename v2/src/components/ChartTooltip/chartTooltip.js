// components/ChartTooltip/chartTooltip.js — info panel for charts. The
// caller drives the contents via setMatch/setMA/setPlaceholder methods.

const PLACEHOLDER_HTML = '<span class="chart-info__placeholder">Hover or click a point to see details</span>';

/**
 * @param {object} [props]
 * @param {string} [props.placeholder] — text shown when nothing is selected.
 * @returns {{ el: HTMLDivElement, set: (html:string)=>void, setItems: (title:string, items:Array<{k:string,v:string|number}>)=>void, clear: ()=>void }}
 */
export function render({ placeholder } = {}) {
    const el = document.createElement("div");
    el.className = "chart-info";
    const placeholderHtml = placeholder
        ? `<span class="chart-info__placeholder">${placeholder}</span>`
        : PLACEHOLDER_HTML;
    el.innerHTML = placeholderHtml;

    return {
        el,
        set(html) { el.innerHTML = html; },
        setItems(title, items) {
            const rows = items.map((it) =>
                `<span class="chart-info__item"><span class="chart-info__k">${it.k}</span><span class="chart-info__v">${it.v}</span></span>`
            ).join("");
            el.innerHTML =
                `<div class="chart-info__title">${title}</div>` +
                `<div class="chart-info__row">${rows}</div>`;
        },
        clear() { el.innerHTML = placeholderHtml; },
    };
}
