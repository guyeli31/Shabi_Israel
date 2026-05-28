// components/SearchBox/searchBox.js — input + popover results list.
//
// The caller wires the actual data: pass `onQuery(text)` to receive
// keystrokes and call `setResults(items, renderItem?)` to populate the
// list. The component handles open/close, escape, and click-outside.

/**
 * @param {object} props
 * @param {string} [props.placeholder]
 * @param {(text: string) => void} [props.onQuery]
 * @param {string} [props.ariaLabel]
 * @returns {{
 *   el: HTMLDivElement,
 *   input: HTMLInputElement,
 *   setResults: (items: Array<any>, renderItem?: (item:any) => HTMLLIElement) => void,
 *   clear: () => void,
 *   close: () => void
 * }}
 */
export function render({ placeholder = "Search…", onQuery, ariaLabel } = {}) {
    const root = document.createElement("div");
    root.className = "search-box";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "search-box__input";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    if (ariaLabel) input.setAttribute("aria-label", ariaLabel);

    const results = document.createElement("ul");
    results.className = "search-box__results";
    results.hidden = true;

    root.append(input, results);

    const close = () => { results.hidden = true; };
    const clear = () => { input.value = ""; results.innerHTML = ""; close(); };

    function setResults(items, renderItem) {
        results.innerHTML = "";
        if (!items || items.length === 0) {
            const li = document.createElement("li");
            li.className = "search-box__empty";
            li.textContent = "No results";
            results.appendChild(li);
        } else {
            for (const item of items) {
                const li = renderItem
                    ? renderItem(item)
                    : defaultRenderItem(item);
                li.classList.add("search-box__option");
                results.appendChild(li);
            }
        }
        results.hidden = false;
    }

    input.addEventListener("input", () => {
        if (onQuery) onQuery(input.value.trim());
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { close(); input.blur(); }
    });
    document.addEventListener("click", (e) => {
        if (!root.contains(e.target)) close();
    });

    return { el: root, input, setResults, clear, close };
}

function defaultRenderItem(item) {
    const li = document.createElement("li");
    if (item && typeof item === "object" && item.href) {
        const a = document.createElement("a");
        a.href = item.href;
        a.textContent = item.label ?? String(item);
        li.appendChild(a);
    } else {
        li.textContent = item?.label ?? String(item);
    }
    return li;
}
