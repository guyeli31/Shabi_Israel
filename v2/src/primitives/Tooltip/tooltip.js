// primitives/Tooltip/tooltip.js — small label that appears on hover/focus.
//
// Two entry points:
//   render({ host, text, placement }) → returns a wrapper element with the
//       host wrapped + the tooltip popover already attached. Tooltip appears
//       on :hover or :focus-within of the wrapper.
//   attach(hostEl, opts) → mounts a tooltip popover onto an existing element
//       (which becomes a tooltip host). Returns { show, hide, destroy }.

const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);

/**
 * Wrap a host element in a tooltip-host span and attach a popover.
 * @param {object} props
 * @param {HTMLElement|string} props.host — the anchor element or a text label
 *                                          (then a <span> host is created).
 * @param {string} props.text
 * @param {"top"|"right"|"bottom"|"left"} [props.placement="top"]
 * @param {string} [props.className]
 * @returns {HTMLElement}
 */
export function render({ host, text, placement = "top", className } = {}) {
    if (!PLACEMENTS.has(placement)) placement = "top";

    const wrap = document.createElement("span");
    wrap.className = `tooltip-host tooltip-host--${placement}${className ? " " + className : ""}`;

    if (typeof host === "string") {
        const label = document.createElement("span");
        label.textContent = host;
        wrap.appendChild(label);
    } else if (host instanceof Node) {
        wrap.appendChild(host);
    }

    const pop = document.createElement("span");
    pop.className = "tooltip-pop";
    pop.setAttribute("role", "tooltip");
    pop.textContent = text;
    wrap.appendChild(pop);
    return wrap;
}

/**
 * Convert an existing element into a tooltip host (no DOM wrap).
 * @param {HTMLElement} hostEl
 * @param {{ text: string, placement?: string }} opts
 * @returns {{ show: () => void, hide: () => void, destroy: () => void }}
 */
export function attach(hostEl, { text, placement = "top" } = {}) {
    if (!PLACEMENTS.has(placement)) placement = "top";
    hostEl.classList.add("tooltip-host", `tooltip-host--${placement}`);
    const pop = document.createElement("span");
    pop.className = "tooltip-pop";
    pop.setAttribute("role", "tooltip");
    pop.textContent = text;
    hostEl.appendChild(pop);
    return {
        show: () => hostEl.setAttribute("data-open", "true"),
        hide: () => hostEl.removeAttribute("data-open"),
        destroy: () => {
            pop.remove();
            hostEl.classList.remove("tooltip-host", `tooltip-host--${placement}`);
        },
    };
}
