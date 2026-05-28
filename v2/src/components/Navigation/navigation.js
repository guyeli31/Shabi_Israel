// components/Navigation/navigation.js — site-wide top nav bar.
//
// Data loading lives in src/data/* (Phase 4) so this component takes
// the resolved data directly. Pages do:
//   import { render as Navigation } from "../components/Navigation/navigation.js";
//   document.body.prepend(Navigation({ leagues, onSearch }));

import { render as SearchBox } from "../SearchBox/searchBox.js";

/**
 * @param {object} props
 * @param {string} [props.homeLabel="Shabi Israel"]
 * @param {string} [props.homeHref="/"]
 * @param {Array<{id:string, title:string, running:boolean, href:string}>} [props.leagues]
 * @param {(text:string) => void} [props.onSearch]
 * @returns {{ el: HTMLElement, search: ReturnType<typeof SearchBox> }}
 */
export function render({ homeLabel = "Shabi Israel", homeHref = "/", leagues = [], onSearch } = {}) {
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#main";
    skip.textContent = "Skip to content";

    const nav = document.createElement("nav");
    nav.className = "site-nav";

    const inner = document.createElement("div");
    inner.className = "site-nav__inner";
    nav.appendChild(inner);

    const home = document.createElement("a");
    home.className = "site-nav__home";
    home.href = homeHref;
    home.textContent = homeLabel;
    inner.appendChild(home);

    // Leagues dropdown
    const leaguesWrap = document.createElement("div");
    leaguesWrap.className = "site-nav__leagues";
    const btn = document.createElement("button");
    btn.className = "site-nav__leagues-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = "Leagues ▾";
    const list = document.createElement("ul");
    list.className = "site-nav__leagues-list";
    list.hidden = true;

    const running = leagues.filter((l) => l.running);
    const completed = leagues.filter((l) => !l.running);
    list.innerHTML = sectionHtml("Running", running, "running")
                   + sectionHtml("Completed", completed, "completed");

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = !list.hidden;
        list.hidden = open;
        btn.setAttribute("aria-expanded", String(!open));
    });
    document.addEventListener("click", () => {
        list.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    });

    leaguesWrap.append(btn, list);
    inner.appendChild(leaguesWrap);

    // Search
    const search = SearchBox({
        placeholder: "Search player…",
        ariaLabel: "Search player",
        onQuery: onSearch,
    });
    search.el.classList.add("site-nav__search");
    inner.appendChild(search.el);

    const fragment = document.createDocumentFragment();
    fragment.append(skip, nav);

    const root = document.createElement("div");
    root.appendChild(fragment);
    return { el: root, search };
}

function sectionHtml(label, items, kind) {
    if (items.length === 0) return "";
    const rows = items.map((l) =>
        `<li><a href="${l.href}"><span class="site-nav__dot site-nav__dot--${kind}"></span>${escapeHtml(l.title)}</a></li>`
    ).join("");
    return `<li class="site-nav__section">${label}</li>${rows}`;
}

function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
}
