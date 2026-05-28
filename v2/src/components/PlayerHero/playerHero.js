// components/PlayerHero/playerHero.js — V7 (Lichess card) + V12 (hero
// banner) player headers. The data shape mirrors v1 renderV7Header /
// renderV12Header so the page renderers in Phase 6 can swap one import.

import { flagUrl }           from "../../primitives/Flag/flag.js";
import { render as StatusChip } from "../StatusChip/statusChip.js";

const TIER_RANK = { gold: 0, silver: 1, bronze: 2, white: 3 };

export function getInitials(name, fullName) {
    if (fullName) {
        const parts = String(fullName).trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    }
    if (name) {
        const caps = name.match(/[A-Z]/g) || [];
        if (caps.length >= 2) return (caps[0] + caps[caps.length - 1]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }
    return "";
}

/** Compute watermark layers (giant tier-coloured ♛/⚜ glyphs) for V12. */
export function watermarkLayers(titles = []) {
    if (titles.length === 0) return [];
    const bestByKind = {};
    for (const t of titles) {
        const rank = TIER_RANK[t.tier] ?? 99;
        const cur = bestByKind[t.kind];
        if (!cur || rank < cur.rank) bestByKind[t.kind] = { tier: t.tier, rank };
    }
    const layers = [];
    if (bestByKind.bmab)  layers.push({ icon: "⚜︎", tier: bestByKind.bmab.tier,  kind: "bmab" });
    if (bestByKind.champ) layers.push({ icon: "♛︎", tier: bestByKind.champ.tier, kind: "champ" });
    if (layers.length === 1) layers[0].role = "solo";
    else {
        const primary = layers.find((l) => l.kind === "champ") || layers[0];
        const secondary = layers.find((l) => l !== primary);
        primary.role = "pair-1";
        secondary.role = "pair-2";
    }
    return layers;
}

function cardTier(layers) {
    if (!layers.length) return null;
    const champ = layers.find((l) => l.kind === "champ");
    return (champ || layers[0]).tier;
}

/**
 * Render the player hero card.
 * @param {object} props
 * @param {"v7"|"v12"} props.variant
 * @param {string} props.name
 * @param {string} [props.nameHref]
 * @param {string} [props.fullName]
 * @param {string} [props.photoPath]
 * @param {string} [props.flagCode]
 * @param {"running"|"recent"|"inactive"} [props.statusKind]
 * @param {string} [props.statusTitle]
 * @param {Array<{label:string, icon:string, tier:"gold"|"silver"|"bronze"|"white", tooltip?:string}>} [props.titles]
 * @param {string} [props.joinedFormatted]
 * @param {number} [props.leagueCount]
 * @param {boolean} [props.inLeague]
 * @returns {HTMLDivElement}
 */
export function render(props) {
    return props.variant === "v7" ? renderV7(props) : renderV12(props);
}

function renderV7(d) {
    const card = document.createElement("div");
    card.className = "player-hero player-hero--v7";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "player-hero__avatar-wrap";

    if (d.photoPath) {
        const img = document.createElement("img");
        img.className = "player-hero__avatar-img";
        img.src = d.photoPath;
        img.alt = d.name;
        avatarWrap.appendChild(img);
    } else {
        const av = document.createElement("div");
        av.className = "player-hero__avatar";
        av.textContent = getInitials(d.name, d.fullName);
        avatarWrap.appendChild(av);
    }
    card.appendChild(avatarWrap);

    const info = document.createElement("div");
    info.className = "player-hero__info";

    const nameLine = document.createElement("div");
    nameLine.className = "player-hero__name-line";

    if (d.flagCode) {
        const flag = document.createElement("img");
        flag.className = "player-hero__flag";
        flag.src = flagUrl(d.flagCode);
        flag.alt = d.flagCode;
        nameLine.appendChild(flag);
    }

    const nameEl = d.nameHref ? document.createElement("a") : document.createElement("span");
    if (d.nameHref) nameEl.href = d.nameHref;
    nameEl.className = "player-hero__name" + (d.nameHref ? " player-hero__name-link" : "");
    nameEl.textContent = d.name;
    nameLine.appendChild(nameEl);

    for (const t of (d.titles || [])) {
        const chip = document.createElement("span");
        chip.className = "player-hero__chip player-hero__chip--" + t.tier;
        if (t.tooltip) chip.title = t.tooltip;
        chip.innerHTML = `<span class="player-hero__chip-icon">${t.icon}</span>${escapeHtml(t.label)}`;
        nameLine.appendChild(chip);
    }
    info.appendChild(nameLine);

    const meta = document.createElement("div");
    meta.className = "player-hero__meta";
    const parts = [];
    if (d.fullName) parts.push(`<span class="player-hero__realname">${escapeHtml(d.fullName)}</span>`);
    if (!d.inLeague && d.joinedFormatted) parts.push(`Joined ${escapeHtml(d.joinedFormatted)}`);
    if (!d.inLeague && typeof d.leagueCount === "number") {
        parts.push(`<span class="player-hero__leagues">${d.leagueCount} ${d.leagueCount === 1 ? "league" : "leagues"}</span>`);
    }
    meta.innerHTML = parts.join(' <span class="player-hero__sep">·</span> ');
    info.appendChild(meta);

    card.appendChild(info);
    return card;
}

function renderV12(d) {
    const layers = watermarkLayers(d.titles);
    const ct = cardTier(layers);

    const card = document.createElement("div");
    card.className = "player-hero player-hero--v12" + (ct ? " player-hero--" + ct : "");

    for (const l of layers) {
        const wm = document.createElement("div");
        wm.className = `player-hero__watermark player-hero__watermark--${l.tier} player-hero__watermark--${l.role}`;
        wm.textContent = l.icon;
        card.appendChild(wm);
    }

    const top = document.createElement("div");
    top.className = "player-hero__top";

    const ribbons = (d.titles || []).map((t) =>
        `<span class="player-hero__ribbon player-hero__ribbon--${t.tier}" title="${escapeHtml(t.tooltip || "")}">` +
            `<span class="player-hero__chip-icon">${t.icon}</span>${escapeHtml((t.label || "").toUpperCase())}` +
        `</span>`
    ).join("");
    if (ribbons) {
        const titlesRow = document.createElement("div");
        titlesRow.className = "player-hero__ribbons";
        titlesRow.innerHTML = ribbons;
        top.appendChild(titlesRow);
    } else {
        top.appendChild(document.createElement("span"));
    }

    const chip = StatusChip({
        status: d.statusKind || "inactive",
        title: d.statusTitle,
    });
    top.appendChild(chip);
    card.appendChild(top);

    // Body row
    const body = document.createElement("div");
    body.className = "player-hero__body";

    if (d.photoPath) {
        const img = document.createElement("img");
        img.className = "player-hero__photo-img";
        img.src = d.photoPath;
        img.alt = d.name;
        body.appendChild(img);
    } else {
        const photo = document.createElement("div");
        photo.className = "player-hero__photo";
        photo.textContent = getInitials(d.name, d.fullName);
        body.appendChild(photo);
    }

    const nameWrap = document.createElement("div");
    const display = document.createElement("h3");
    display.className = "player-hero__display";
    if (d.flagCode) {
        const flag = document.createElement("img");
        flag.className = "player-hero__flag";
        flag.src = flagUrl(d.flagCode);
        flag.alt = d.flagCode;
        display.appendChild(flag);
    }
    if (d.nameHref) {
        const a = document.createElement("a");
        a.className = "player-hero__name-link";
        a.href = d.nameHref;
        a.textContent = d.name;
        display.appendChild(a);
    } else {
        display.appendChild(document.createTextNode(d.name));
    }
    nameWrap.appendChild(display);
    if (d.fullName) {
        const real = document.createElement("div");
        real.className = "player-hero__real";
        real.textContent = d.fullName;
        nameWrap.appendChild(real);
    }
    body.appendChild(nameWrap);
    card.appendChild(body);

    if (!d.inLeague) {
        const grid = document.createElement("div");
        grid.className = "player-hero__statgrid";
        grid.appendChild(statTile("Joined", d.joinedFormatted ?? ""));
        grid.appendChild(statTile("Leagues", String(d.leagueCount ?? 0)));
        card.appendChild(grid);
    }

    return card;
}

function statTile(label, value) {
    const wrap = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.className = "player-hero__statlbl";
    lbl.textContent = label;
    const val = document.createElement("div");
    val.className = "player-hero__statnum";
    val.textContent = value;
    wrap.append(lbl, val);
    return wrap;
}

function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
}
