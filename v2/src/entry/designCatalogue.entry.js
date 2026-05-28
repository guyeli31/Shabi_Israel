// Entry point for the design catalogue (Phase 1).
// Loads global token + theme + base CSS, populates each section with
// swatches/samples generated from the live token registry, and wires
// the theme switcher.

import "../index.css";
import "../tools/designCatalogue/catalogue.css";

import { render as Flag }       from "../primitives/Flag/flag.js";
import { render as Icon, listIcons } from "../primitives/Icon/icon.js";
import { render as Badge }      from "../primitives/Badge/badge.js";
import { render as Pill }       from "../primitives/Pill/pill.js";
import { render as Button }     from "../primitives/Button/button.js";
import { render as Link }       from "../primitives/Link/link.js";
import { render as Avatar }     from "../primitives/Avatar/avatar.js";
import { render as Tooltip }    from "../primitives/Tooltip/tooltip.js";
import { render as Chip }       from "../primitives/Chip/chip.js";
import { render as FormField }  from "../primitives/FormField/formField.js";

/* Phase 3 — composed components */
import { render as PlayerCell }    from "../components/PlayerCell/playerCell.js";
import { render as StatusChip }    from "../components/StatusChip/statusChip.js";
import { render as TypePill }      from "../components/TypePill/typePill.js";
import { render as RankBadge }     from "../components/RankBadge/rankBadge.js";
import { classNameForRank }        from "../components/MedalRow/medalRow.js";
import { render as ScoreCell }     from "../components/ScoreCell/scoreCell.js";
import { render as FilterPill }    from "../components/FilterPill/filterPill.js";
import { render as ChartTooltip }  from "../components/ChartTooltip/chartTooltip.js";
import { render as Breadcrumbs }   from "../components/Breadcrumbs/breadcrumbs.js";
import { render as SearchBoxComp } from "../components/SearchBox/searchBox.js";
import { render as Navigation }    from "../components/Navigation/navigation.js";
import { render as ColorScaleRow } from "../components/ColorScale/colorScaleSample.js";
import { render as LeagueHero }    from "../components/LeagueHero/leagueHero.js";
import { render as PlayerHero }    from "../components/PlayerHero/playerHero.js";
import { render as PlayerBarChart } from "../components/PlayerBarChart/playerBarChart.js";
import { render as ThemePicker }   from "../components/ThemePicker/themePicker.js";
import { render as AdminButton }   from "../components/AdminButton/adminButton.js";
import { render as ExportButton }  from "../components/ExportButton/exportButton.js";

/* ── Token registry ─────────────────────────────────────────────
   These lists mirror tokens/*.css. Keeping them here as plain data
   means the gallery rebuilds automatically when this file is edited;
   no parsing of CSS at runtime needed. */

const SEMANTIC_COLORS = [
    "--color-bg",
    "--color-surface",
    "--color-hover",
    "--color-border",
    "--color-text",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-accent",
    "--color-accent-light",
    "--color-gold",
    "--color-gold-bg",
    "--color-gold-text",
    "--color-silver",
    "--color-silver-bg",
    "--color-silver-text",
    "--color-bronze",
    "--color-bronze-bg",
    "--color-bronze-text",
    "--color-running",
    "--color-running-bg",
    "--color-completed",
    "--color-completed-bg",
    "--color-win",
    "--color-loss",
    "--color-draw",
    "--color-avg-bg",
    "--color-avg-border",
    "--color-unplayed-bg",
    "--header-bg",
    "--header-text",
    "--header-bg-hover",
    "--lt-doubling-bg",
    "--lt-doubling-text",
    "--lt-ubc-bg",
    "--lt-ubc-text",
    "--lt-regular-bg",
    "--lt-regular-text",
];

const RAW_COLORS = [
    "--c-white", "--c-black",
    "--c-slate-50", "--c-slate-100", "--c-slate-200", "--c-slate-300",
    "--c-slate-400", "--c-slate-500", "--c-slate-600", "--c-slate-700",
    "--c-slate-800", "--c-slate-900",
    "--c-blue-100", "--c-blue-300", "--c-blue-400", "--c-blue-500", "--c-blue-900",
    "--c-green-100", "--c-green-200", "--c-green-400", "--c-green-600", "--c-green-700",
    "--c-red-300", "--c-red-700",
    "--c-gold-50", "--c-gold-200", "--c-gold-400", "--c-gold-700", "--c-gold-900",
    "--c-silver-100", "--c-silver-200", "--c-silver-400", "--c-silver-700", "--c-silver-900",
    "--c-bronze-50", "--c-bronze-400", "--c-bronze-900",
    "--c-violet-100", "--c-violet-900",
    "--c-teal-100", "--c-teal-400", "--c-teal-900",
    "--c-mint-50", "--c-mint-200",
];

const FONT_SIZES = [
    { token: "--fs-micro",   max: "0.65rem" },
    { token: "--fs-small",   max: "0.85rem" },
    { token: "--fs-large",   max: "0.93rem" },
    { token: "--fs-xl",      max: "1.10rem" },
    { token: "--fs-2xl",     max: "1.35rem" },
    { token: "--fs-3xl",     max: "1.60rem" },
    { token: "--fs-display", max: "2.00rem" },
];

const FONT_WEIGHTS = [
    { token: "--fw-regular",    value: 400 },
    { token: "--fw-medium",     value: 500 },
    { token: "--fw-subheading", value: 600 },
    { token: "--fw-heading",    value: 700 },
];

const ICON_SIZES = [
    { token: "--icon-xs", max: "0.875em" },
    { token: "--icon-sm", max: "1em"     },
    { token: "--icon-md", max: "1.25em"  },
    { token: "--icon-lg", max: "1.5em"   },
];

const SPACES = [
    { token: "--space-xs",  value: "4px"  },
    { token: "--space-sm",  value: "8px"  },
    { token: "--space-md",  value: "16px" },
    { token: "--space-lg",  value: "24px" },
    { token: "--space-xl",  value: "40px" },
    { token: "--space-2xl", value: "64px" },
];

const RADII = [
    { token: "--radius-sm",   value: "6px" },
    { token: "--radius-md",   value: "10px" },
    { token: "--radius-lg",   value: "16px" },
    { token: "--radius-full", value: "9999px" },
];

const SHADOWS = ["--shadow-sm", "--shadow-md", "--shadow-lg"];

/* ── Renderers ───────────────────────────────────────────────── */

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style") Object.assign(node.style, v);
        else node.setAttribute(k, v);
    }
    for (const c of children) {
        if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
}

function colorSwatch(tokenName, opts = {}) {
    const checker = opts.checker ? " dc-swatch-color--checker" : "";
    return el("div", { class: "dc-swatch" }, [
        el("div", {
            class: `dc-swatch-color${checker}`,
            style: { background: `var(${tokenName})` },
        }),
        el("div", { class: "dc-swatch-meta" }, [
            el("div", { class: "dc-swatch-name" }, [tokenName]),
            el("div", { class: "dc-swatch-value", "data-token-value": tokenName }),
        ]),
    ]);
}

function renderColorGrid(containerId, tokens, opts = {}) {
    const container = document.getElementById(containerId);
    for (const token of tokens) container.appendChild(colorSwatch(token, opts));
}

function renderTypography(containerId) {
    const container = document.getElementById(containerId);
    for (const size of FONT_SIZES) {
        for (const weight of FONT_WEIGHTS) {
            const row = el("div", { class: "dc-type-row" }, [
                el("span", { class: "dc-type-token" }, [size.token]),
                el("span", { class: "dc-type-weight" }, [String(weight.value)]),
                el("span", {
                    class: "dc-type-sample",
                    style: {
                        fontSize: `var(${size.token})`,
                        fontWeight: `var(${weight.token})`,
                    },
                }, ["The quick brown fox jumps over the lazy dog."]),
                el("span", { class: "dc-type-meta" }, [`max ${size.max}`]),
            ]);
            container.appendChild(row);
        }
    }
}

const ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v6l4 2"/>
</svg>`;

function renderIcons(containerId) {
    const container = document.getElementById(containerId);
    for (const icon of ICON_SIZES) {
        const cell = el("div", { class: "dc-icon-cell" });
        const wrap = el("div", {
            style: {
                width: `var(${icon.token})`,
                height: `var(${icon.token})`,
                fontSize: "var(--fs-2xl)",
            },
            html: ICON_SVG,
        });
        wrap.firstElementChild.setAttribute("width", "100%");
        wrap.firstElementChild.setAttribute("height", "100%");
        cell.appendChild(wrap);
        cell.appendChild(el("div", { class: "dc-icon-meta" }, [icon.token]));
        cell.appendChild(el("div", { class: "dc-icon-meta" }, [`max ${icon.max}`]));
        container.appendChild(cell);
    }
}

function renderSpace(containerId) {
    const container = document.getElementById(containerId);
    for (const s of SPACES) {
        const row = el("div", { class: "dc-space-row" }, [
            el("span", { class: "dc-space-label" }, [s.token]),
            el("div", { class: "dc-space-bar", style: { width: `var(${s.token})` } }),
            el("span", { class: "dc-space-label" }, [s.value]),
        ]);
        container.appendChild(row);
    }
}

function renderRadii(containerId) {
    const container = document.getElementById(containerId);
    for (const r of RADII) {
        const cell = el("div", { class: "dc-radius-cell" }, [
            el("div", { class: "dc-radius-shape", style: { borderRadius: `var(${r.token})` } }),
            el("div", { class: "dc-icon-meta" }, [r.token]),
            el("div", { class: "dc-icon-meta" }, [r.value]),
        ]);
        container.appendChild(cell);
    }
}

function renderShadows(containerId) {
    const container = document.getElementById(containerId);
    for (const token of SHADOWS) {
        const cell = el("div", { class: "dc-shadow-cell" }, [
            el("div", { class: "dc-shadow-card", style: { boxShadow: `var(${token})` } }),
            el("div", { class: "dc-icon-meta" }, [token]),
        ]);
        container.appendChild(cell);
    }
}

/* ── Theme switcher ─────────────────────────────────────────── */

function updateSwatchValues() {
    // Resolve every colour-token value via getComputedStyle so the swatch
    // meta shows what the active theme actually resolves to.
    const root = document.documentElement;
    const style = getComputedStyle(root);
    for (const node of document.querySelectorAll("[data-token-value]")) {
        const token = node.getAttribute("data-token-value");
        const value = style.getPropertyValue(token).trim();
        node.textContent = value || "—";
    }
}

function setTheme(themeId) {
    if (themeId === "default") {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = themeId;
    }
    try { localStorage.setItem("dc-theme", themeId); } catch (e) { /* ignore */ }

    for (const btn of document.querySelectorAll(".dc-theme-button")) {
        btn.setAttribute("aria-pressed", btn.dataset.theme === themeId ? "true" : "false");
    }

    // Allow CSS to re-paint before re-reading computed values.
    requestAnimationFrame(updateSwatchValues);
}

function wireThemeSwitch() {
    const container = document.getElementById("theme-switch");
    container.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-theme]");
        if (!btn) return;
        setTheme(btn.dataset.theme);
    });

    // Apply saved theme on load
    const saved = (() => {
        try { return localStorage.getItem("dc-theme") || "default"; }
        catch (e) { return "default"; }
    })();
    setTheme(saved);
}

/* ── Primitive renderers ─────────────────────────────────────── */

function sampleCell(label, child) {
    const cell = el("div", { class: "dc-sample" });
    cell.appendChild(child);
    cell.appendChild(el("div", { class: "dc-sample-label" }, [label]));
    return cell;
}

function renderFlagSamples(containerId) {
    const c = document.getElementById(containerId);
    const codes = ["IL", "RU", "BE", "TZ", "UN"];
    for (const code of codes) {
        c.appendChild(sampleCell(code, Flag({ code, size: "lg" })));
    }
    // size scale on a single code
    for (const size of ["sm", "md", "lg", "xl"]) {
        c.appendChild(sampleCell(`IL · ${size}`, Flag({ code: "IL", size })));
    }
}

function renderIconSamples(containerId) {
    const c = document.getElementById(containerId);
    const names = listIcons();
    // Show all icons at md, then size sweep for one icon
    for (const name of names) {
        c.appendChild(sampleCell(name, Icon({ name, size: "md" })));
    }
    for (const size of ["xs", "sm", "md", "lg"]) {
        const w = el("span", { style: { fontSize: "var(--fs-2xl)", color: "var(--color-accent)" } });
        w.appendChild(Icon({ name: "clock", size }));
        c.appendChild(sampleCell(`clock · ${size}`, w));
    }
}

function renderBadgeSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("default",  Badge({ text: 7 })));
    c.appendChild(sampleCell("accent",   Badge({ text: 12, variant: "accent" })));
    c.appendChild(sampleCell("neutral",  Badge({ text: 3, variant: "neutral" })));
    c.appendChild(sampleCell("gold",     Badge({ text: 1, variant: "gold",   circle: true })));
    c.appendChild(sampleCell("silver",   Badge({ text: 2, variant: "silver", circle: true })));
    c.appendChild(sampleCell("bronze",   Badge({ text: 3, variant: "bronze", circle: true })));
    c.appendChild(sampleCell("sm",       Badge({ text: "NEW", variant: "accent", size: "sm" })));
    c.appendChild(sampleCell("lg",       Badge({ text: "NEW", variant: "accent", size: "lg" })));
}

function renderPillSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("running",   Pill({ text: "Running",   variant: "running" })));
    c.appendChild(sampleCell("completed", Pill({ text: "Completed", variant: "completed" })));
    c.appendChild(sampleCell("doubling",  Pill({ text: "Doubling",  variant: "doubling", uppercase: true })));
    c.appendChild(sampleCell("regular",   Pill({ text: "Regular",   variant: "regular",  uppercase: true })));
    c.appendChild(sampleCell("ubc",       Pill({ text: "UBC",       variant: "ubc",      uppercase: true })));
    c.appendChild(sampleCell("accent",    Pill({ text: "Featured",  variant: "accent" })));
    c.appendChild(sampleCell("sm",        Pill({ text: "Small",     variant: "running", size: "sm" })));
    c.appendChild(sampleCell("lg",        Pill({ text: "Large",     variant: "running", size: "lg" })));
}

function renderButtonSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("primary",   Button({ label: "Primary",   variant: "primary"   })));
    c.appendChild(sampleCell("secondary", Button({ label: "Secondary", variant: "secondary" })));
    c.appendChild(sampleCell("ghost",     Button({ label: "Ghost",     variant: "ghost"     })));
    c.appendChild(sampleCell("danger",    Button({ label: "Danger",    variant: "danger"    })));
    c.appendChild(sampleCell("disabled",  Button({ label: "Disabled",  variant: "primary", disabled: true })));
    c.appendChild(sampleCell("sm",        Button({ label: "Small",     variant: "primary", size: "sm" })));
    c.appendChild(sampleCell("lg",        Button({ label: "Large",     variant: "primary", size: "lg" })));
    c.appendChild(sampleCell("pill",      Button({ label: "Pill",      variant: "secondary", pill: true })));
    c.appendChild(sampleCell("icon",      Button({ variant: "ghost", iconOnly: true, ariaLabel: "Search", iconLeft: Icon({ name: "search", size: "md" }) })));
    c.appendChild(sampleCell("icon+text", Button({ label: "Search", variant: "primary", iconLeft: Icon({ name: "search", size: "sm" }) })));
}

function renderLinkSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("default", Link({ href: "#", text: "Default" })));
    c.appendChild(sampleCell("quiet",   Link({ href: "#", text: "Quiet", variant: "quiet" })));
    c.appendChild(sampleCell("strong",  Link({ href: "#", text: "Strong", variant: "strong" })));
    c.appendChild(sampleCell("muted",   Link({ href: "#", text: "Muted",  variant: "muted" })));
}

function renderAvatarSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("initials",  Avatar({ name: "Guy Eliyahu" })));
    c.appendChild(sampleCell("single",    Avatar({ name: "Anna" })));
    c.appendChild(sampleCell("sm",        Avatar({ name: "Guy Eliyahu", size: "sm" })));
    c.appendChild(sampleCell("md",        Avatar({ name: "Guy Eliyahu", size: "md" })));
    c.appendChild(sampleCell("lg",        Avatar({ name: "Guy Eliyahu", size: "lg" })));
    c.appendChild(sampleCell("xl",        Avatar({ name: "Guy Eliyahu", size: "xl" })));
    c.appendChild(sampleCell("online",    Avatar({ name: "Guy Eliyahu", size: "lg", status: "online" })));
    c.appendChild(sampleCell("idle",      Avatar({ name: "Guy Eliyahu", size: "lg", status: "idle" })));
    c.appendChild(sampleCell("away",      Avatar({ name: "Guy Eliyahu", size: "lg", status: "away" })));
}

function renderTooltipSamples(containerId) {
    const c = document.getElementById(containerId);
    for (const placement of ["top", "right", "bottom", "left"]) {
        const btn = Button({ label: placement, variant: "secondary" });
        c.appendChild(sampleCell(`hover · ${placement}`,
            Tooltip({ host: btn, text: "Tooltip!", placement })));
    }
}

function renderChipSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(sampleCell("default",  Chip({ text: "Filter" })));
    c.appendChild(sampleCell("accent",   Chip({ text: "Accent",   variant: "accent" })));
    c.appendChild(sampleCell("muted",    Chip({ text: "Muted",    variant: "muted" })));
    c.appendChild(sampleCell("selected", Chip({ text: "Selected", variant: "selected" })));
    c.appendChild(sampleCell("remove",   Chip({ text: "Removable", removable: true, onRemove: () => {} })));
    c.appendChild(sampleCell("selected×",Chip({ text: "Tag",      variant: "selected", removable: true, onRemove: () => {} })));
    c.appendChild(sampleCell("sm",       Chip({ text: "Small",    size: "sm" })));
    c.appendChild(sampleCell("lg",       Chip({ text: "Large",    size: "lg" })));
}

function renderFormFieldSamples(containerId) {
    const c = document.getElementById(containerId);
    c.appendChild(FormField({ label: "Player name", placeholder: "e.g. Guy Eliyahu", hint: "Used as the table heading", required: true }));
    c.appendChild(FormField({ label: "Email",       type: "email", value: "user@example.com" }));
    c.appendChild(FormField({ label: "Score",       type: "number", value: "12", hint: "Enter a number 0–999" }));
    c.appendChild(FormField({ label: "Country",     type: "select", value: "IL", options: [
        { value: "IL", label: "Israel" },
        { value: "RU", label: "Russia" },
        { value: "BE", label: "Belgium" },
    ] }));
    c.appendChild(FormField({ label: "Notes",       type: "textarea", placeholder: "Free-form notes…", hint: "Visible to admins only" }));
    c.appendChild(FormField({ label: "Disabled",    type: "text", value: "Read-only", disabled: true }));
    c.appendChild(FormField({ label: "With error",  type: "text", value: "abc", error: "Must contain at least one digit." }));
}

/* ── Bootstrap ───────────────────────────────────────────────── */

renderColorGrid("grid-colors-semantic", SEMANTIC_COLORS);
renderColorGrid("grid-colors-raw", RAW_COLORS);
renderTypography("grid-typography");
renderIcons("grid-icons");
renderSpace("grid-space");
renderRadii("grid-radius");
renderShadows("grid-shadow");

renderFlagSamples("row-flag");
renderIconSamples("row-icon");
renderBadgeSamples("row-badge");
renderPillSamples("row-pill");
renderButtonSamples("row-button");
renderLinkSamples("row-link");
renderAvatarSamples("row-avatar");
renderTooltipSamples("row-tooltip");
renderChipSamples("row-chip");
renderFormFieldSamples("row-formfield");

/* ── Phase 3 samples ────────────────────────────────────────── */

function renderPlayerCellSamples() {
    const tbody = document.querySelector("#row-player-cell tbody");
    const rows = [
        { name: "Guy Eliyahu",  flagCode: "IL", titles: [] },
        { name: "Anna",         flagCode: "RU", titles: [
            { abbr: "GM", tier: "gold",   kind: "bmab" },
        ] },
        { name: "Carlos",       flagCode: "BE", titles: [
            { abbr: "WC", tier: "gold",   kind: "champ", tooltip: "World Champion" },
            { abbr: "IM", tier: "silver", kind: "bmab" },
        ] },
        { name: "Dorian",       flagCode: "TZ", titles: [
            { abbr: "NC", tier: "bronze", kind: "champ", tooltip: "National Champion" },
        ] },
    ];
    for (const r of rows) {
        const tr = document.createElement("tr");
        tr.appendChild(PlayerCell({ ...r, href: "#" }));
        tbody.appendChild(tr);
    }
}

function renderStatusChipSamples() {
    const c = document.getElementById("row-status-chip");
    c.appendChild(sampleCell("running",   StatusChip({ status: "running" })));
    c.appendChild(sampleCell("completed", StatusChip({ status: "completed" })));
    c.appendChild(sampleCell("recent",    StatusChip({ status: "recent" })));
    c.appendChild(sampleCell("inactive",  StatusChip({ status: "inactive" })));
}

function renderTypePillSamples() {
    const c = document.getElementById("row-type-pill");
    c.appendChild(sampleCell("doubling", TypePill({ type: "doubling" })));
    c.appendChild(sampleCell("regular",  TypePill({ type: "regular" })));
    c.appendChild(sampleCell("ubc",      TypePill({ type: "ubc" })));
}

function renderMedalRowSamples() {
    const tbody = document.getElementById("row-medal-row");
    const rows = [
        { rank: 1, name: "Guy",   wr: 0.78 },
        { rank: 2, name: "Anna",  wr: 0.72 },
        { rank: 3, name: "Carlos", wr: 0.66 },
        { rank: 4, name: "Dorian", wr: 0.58 },
        { rank: 5, name: "Eli",   wr: 0.50 },
    ];
    for (const r of rows) {
        const tr = document.createElement("tr");
        const cls = classNameForRank(r.rank);
        if (cls) tr.className = cls;
        const td1 = document.createElement("td");
        td1.appendChild(RankBadge({ rank: r.rank }));
        const td2 = document.createElement("td");
        td2.appendChild(PlayerCell({ name: r.name, tag: "span", href: "#" }));
        const td3 = document.createElement("td");
        td3.style.textAlign = "right";
        td3.textContent = (r.wr * 100).toFixed(1) + "%";
        tr.append(td1, td2, td3);
        tbody.appendChild(tr);
    }
}

function renderScoreCellSamples() {
    const tbody = document.getElementById("row-score-cell");
    const values = [-3.2, -1.4, 0.0, 1.1, 2.3, 4.8, 7.2];
    const min = Math.min(...values);
    const max = Math.max(...values);
    for (const v of values) {
        const tr = document.createElement("tr");
        const lbl = document.createElement("td");
        lbl.textContent = "PR";
        tr.appendChild(lbl);
        tr.appendChild(ScoreCell({ value: v, min, max }));
        tbody.appendChild(tr);
    }
}

function renderFilterPillSamples() {
    const c = document.getElementById("row-filter-pill");
    c.appendChild(sampleCell("idle",     FilterPill({ text: "Running" })));
    c.appendChild(sampleCell("selected", FilterPill({ text: "Completed", selected: true })));
    c.appendChild(sampleCell("doubling", FilterPill({ text: "Doubling",  selected: true })));
    c.appendChild(sampleCell("toggle",   FilterPill({ text: "Click me",  onChange: () => {} })));
}

function renderChartTooltipSamples() {
    const c = document.getElementById("row-chart-tooltip");
    const t = ChartTooltip();
    t.setItems("#3 vs <b>Anna</b>", [
        { k: "Score", v: "10 - 7" },
        { k: "PR",    v: "2.45" },
        { k: "Luck",  v: "-0.32" },
        { k: "Date",  v: "14 May 2026" },
    ]);
    c.appendChild(t.el);
}

function renderBreadcrumbsSamples() {
    const c = document.getElementById("row-breadcrumbs");
    c.appendChild(Breadcrumbs({
        crumbs: [
            { label: "Home",     href: "#" },
            { label: "April 2026 League", href: "#" },
            { label: "Guy Eliyahu" },
        ],
    }));
}

function renderSearchBoxSamples() {
    const c = document.getElementById("row-search-box");
    const players = ["Guy Eliyahu", "Anna Karenina", "Carlos Magnus", "Dorian Gray", "Elinor Dashwood"];
    const sb = SearchBoxComp({
        placeholder: "Search player…",
        onQuery: (q) => {
            if (!q) return sb.close();
            const matches = players
                .filter((p) => p.toLowerCase().includes(q.toLowerCase()))
                .map((p) => ({ label: p, href: "#" }));
            sb.setResults(matches);
        },
    });
    c.appendChild(sb.el);
}

function renderNavigationSamples() {
    const c = document.getElementById("row-navigation");
    const nav = Navigation({
        homeLabel: "Shabi Israel",
        leagues: [
            { id: "may-2026", title: "May 2026 League", running: true,  href: "#" },
            { id: "apr-2026", title: "April 2026 League", running: true, href: "#" },
            { id: "mar-2026", title: "March 2026 League", running: false, href: "#" },
            { id: "feb-2026", title: "February 2026 League", running: false, href: "#" },
        ],
        onSearch: () => {},
    });
    // Catalogue preview frame — wrap so the position:sticky bar stays contained.
    const frame = el("div", { style: {
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxHeight: "120px",
    } });
    frame.appendChild(nav.el);
    c.appendChild(frame);
}

function renderColorScaleSamples() {
    const c = document.getElementById("row-color-scale");
    c.appendChild(ColorScaleRow({ steps: 11 }));
}

function renderLeagueHeroSamples() {
    const c = document.getElementById("row-league-hero");
    const wrap1 = el("div", { class: "dc-hero-card", style: { textAlign: "center" } });
    wrap1.appendChild(LeagueHero({
        variant: "v13",
        name: "May 2026 League",
        type: "doubling",
        running: true,
        lastUpdated: "28 May 2026, 09:14",
    }));
    c.appendChild(wrap1);

    const wrap2 = el("div", { class: "dc-hero-card", style: { textAlign: "center" } });
    wrap2.appendChild(LeagueHero({
        variant: "v16",
        name: "April 2026 UBC",
        type: "ubc",
        running: false,
        startDate: "1 Apr 2026",
        lastUpdated: "30 Apr 2026, 22:00",
    }));
    c.appendChild(wrap2);
}

function renderPlayerHeroSamples() {
    const c = document.getElementById("row-player-hero");
    const wrap1 = el("div", { class: "dc-hero-card", style: { textAlign: "center" } });
    wrap1.appendChild(PlayerHero({
        variant: "v7",
        name: "Guy Eliyahu",
        nameHref: "#",
        fullName: "Guy Eliyahu",
        flagCode: "IL",
        joinedFormatted: "May 2024",
        leagueCount: 24,
        titles: [
            { label: "GM", icon: "♛", tier: "gold", tooltip: "Grandmaster" },
        ],
    }));
    c.appendChild(wrap1);

    const wrap2 = el("div", { class: "dc-hero-card", style: { textAlign: "center" } });
    wrap2.appendChild(PlayerHero({
        variant: "v12",
        name: "Anna",
        nameHref: "#",
        fullName: "Anna Karenina",
        flagCode: "RU",
        statusKind: "running",
        statusTitle: "Currently active",
        joinedFormatted: "Jan 2025",
        leagueCount: 12,
        titles: [
            { label: "World Champion",  icon: "♚", tier: "gold",   tooltip: "World Champion 2025", kind: "champ" },
            { label: "GM",              icon: "♛", tier: "silver", tooltip: "Grandmaster",         kind: "bmab" },
        ],
    }));
    c.appendChild(wrap2);
}

function renderPlayerChartSample() {
    const c = document.getElementById("row-player-chart");
    const fake = Array.from({ length: 12 }, (_, i) => ({
        opponent:  ["Anna","Carlos","Dorian","Eli","Frida"][i % 5],
        scoreSelf: 5 + (i % 6),
        scoreOpp:  3 + ((i + 2) % 6),
        prSelf:    (Math.sin(i / 1.5) * 3 + 1.5),
        luckSelf:  (Math.cos(i / 2) * 2),
        updatedAt: new Date(2026, 4, i + 1).toISOString(),
    }));
    const chart = PlayerBarChart({ matches: fake, metric: "pr", totalMatchesPerPlayer: 16 });
    c.appendChild(chart.el);
}

function renderExportButtonSamples() {
    const c = document.getElementById("row-export-button");
    c.appendChild(sampleCell("default", ExportButton({ onClick: () => alert("Export!") })));
    c.appendChild(sampleCell("secondary", ExportButton({ label: "Save PNG", variant: "secondary" })));
}

renderPlayerCellSamples();
renderStatusChipSamples();
renderTypePillSamples();
renderMedalRowSamples();
renderScoreCellSamples();
renderFilterPillSamples();
renderChartTooltipSamples();
renderBreadcrumbsSamples();
renderSearchBoxSamples();
renderNavigationSamples();
renderColorScaleSamples();
renderLeagueHeroSamples();
renderPlayerHeroSamples();
renderPlayerChartSample();
renderExportButtonSamples();

// Mount floating chrome to the body so the catalogue itself uses them.
document.body.appendChild(ThemePicker());
document.body.appendChild(AdminButton({ tooltipText: "Admin Mode (demo)", onClick: () => alert("Admin demo") }));

wireThemeSwitch();
