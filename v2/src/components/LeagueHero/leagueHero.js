// components/LeagueHero/leagueHero.js — V13 (Lichess title bar) + V16
// (wide hero banner) league headers. Composes TypePill + StatusChip.

import { render as TypePill }   from "../TypePill/typePill.js";
import { render as StatusChip } from "../StatusChip/statusChip.js";

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatStartDate(iso) {
    if (!iso) return "";
    const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return iso;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = m[3] ? parseInt(m[3], 10) : null;
    const mn = MONTHS_SHORT[month - 1] || "";
    return day ? `${day} ${mn} ${year}` : `${mn} ${year}`;
}

export function formatLastUpdated(headerVal) {
    if (!headerVal) return "";
    const d = new Date(headerVal);
    if (isNaN(d)) return headerVal;
    const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${date}, ${time}`;
}

/**
 * @param {object} props
 * @param {"v13"|"v16"} props.variant
 * @param {string} props.name
 * @param {"doubling"|"regular"|"ubc"} props.type
 * @param {boolean} props.running
 * @param {string} [props.startDate] — already formatted.
 * @param {string} [props.lastUpdated] — already formatted.
 * @param {boolean} [props.omitStartDate]
 * @returns {HTMLDivElement}
 */
export function render(props) {
    return props.variant === "v16" ? renderV16(props) : renderV13(props);
}

function renderV13({ name, type, running, startDate, lastUpdated, omitStartDate = true }) {
    const card = document.createElement("div");
    card.className = "league-hero league-hero--v13";

    const nameLine = document.createElement("div");
    nameLine.className = "league-hero--v13__name-line";

    const nameEl = document.createElement("span");
    nameEl.className = "league-hero--v13__name";
    nameEl.textContent = name;
    nameLine.appendChild(nameEl);
    nameLine.appendChild(TypePill({ type }));
    nameLine.appendChild(StatusChip({ status: running ? "running" : "completed" }));

    const meta = document.createElement("div");
    meta.className = "league-hero--v13__meta";
    const parts = [];
    if (!omitStartDate && startDate) parts.push(`Started ${startDate}`);
    if (lastUpdated) parts.push(`Last updated ${lastUpdated}`);
    meta.innerHTML = parts.join(' <span class="sep">·</span> ');

    card.append(nameLine, meta);
    return card;
}

function renderV16({ name, type, running, startDate, lastUpdated, omitStartDate = false }) {
    const card = document.createElement("div");
    card.className = "league-hero league-hero--v16";

    const top = document.createElement("div");
    top.className = "league-hero--v16__top";
    top.appendChild(TypePill({ type }));
    top.appendChild(StatusChip({ status: running ? "running" : "completed" }));

    const display = document.createElement("h2");
    display.className = "league-hero--v16__display";
    display.textContent = name;

    const grid = document.createElement("div");
    grid.className = "league-hero--v16__statgrid";
    if (omitStartDate) grid.style.gridTemplateColumns = "1fr";
    if (!omitStartDate) grid.appendChild(statTile("Start Date", startDate));
    grid.appendChild(statTile("Last Updated", lastUpdated));

    card.append(top, display, grid);
    return card;
}

function statTile(label, value) {
    const wrap = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.className = "league-hero--v16__statlbl";
    lbl.textContent = label;
    const val = document.createElement("div");
    val.className = "league-hero--v16__statval";
    val.textContent = value ?? "";
    wrap.append(lbl, val);
    return wrap;
}
