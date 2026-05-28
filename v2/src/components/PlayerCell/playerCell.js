// components/PlayerCell/playerCell.js — composed player-row cell
// (flag · name · optional title badges). Returns a <td>.

import { flagUrl } from "../../primitives/Flag/flag.js";

/**
 * @param {object} props
 * @param {string} props.name
 * @param {string} [props.href] — if provided, name renders as <a>.
 * @param {string} [props.flagCode] — ISO 3166-1 alpha-2; default "IL".
 * @param {Array<{abbr:string, tier:"gold"|"silver"|"bronze"|"white", kind?:"champ"|"bmab", tooltip?:string}>} [props.titles]
 * @param {string} [props.tag="td"] — element to create.
 * @param {string} [props.className]
 * @returns {HTMLElement}
 */
export function render({ name, href, flagCode = "IL", titles = [], tag = "td", className } = {}) {
    const el = document.createElement(tag);
    el.className = "player-cell" + (className ? " " + className : "");

    const flag = document.createElement("img");
    flag.className = "player-cell__flag";
    flag.src = flagUrl(flagCode);
    flag.alt = flagCode;
    flag.loading = "lazy";
    flag.decoding = "async";
    el.appendChild(flag);

    const nameEl = href ? document.createElement("a") : document.createElement("span");
    if (href) nameEl.href = href;
    nameEl.className = "player-cell__link";
    nameEl.textContent = name ?? "";
    el.appendChild(nameEl);

    if (titles.length > 0) {
        const wrap = document.createElement("span");
        wrap.className = "player-cell__titles";
        for (const t of titles) {
            const b = document.createElement("span");
            let cls = "title-abbr";
            if (t.tier) cls += " title-abbr--" + t.tier;
            if (t.kind === "champ") cls += " title-abbr--champ";
            b.className = cls;
            if (t.tooltip) b.title = t.tooltip;
            b.textContent = t.abbr ?? "";
            wrap.appendChild(b);
        }
        el.appendChild(wrap);
    }

    return el;
}
