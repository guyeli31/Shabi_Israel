/**
 * playerHeader.js — Shared "V7" player header (Player Page Lab).
 *
 * Lichess-enriched horizontal card:
 *   [photo + status-dot overlay] [flag · name · title chips]
 *                                [full-name · Joined Mon YYYY · N leagues]
 *
 * Used by both player.html (cross-league profile) and
 * player_league.html (per-league profile) so the player identity surface is
 * identical across them.
 */

import { flagUrl } from '../utils/helpers.js';
import { getBmabInfo, getChampionshipInfo, getChampionshipTooltip } from '../data/titleConstants.js';

const TIER_ICONS = { gold: '♛', silver: '♜', bronze: '♝', white: '♞' };
const CHAMP_ICON = '♚';
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
}

/* Two-letter monogram fallback for the photo slot.
   Priority: full-name initials → first 2 letters of full-name word →
   first+last capital of camelCase username → first 2 letters of username. */
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
    return '';
}

export function formatJoinedShort(year, monthIndex) {
    if (year == null || monthIndex == null || monthIndex < 0 || monthIndex > 11) return '';
    return `${MONTHS_SHORT[monthIndex]} ${year}`;
}

/* Convert metadata's titles into the [{label, icon, tier, tooltip}]
   shape the V7 chips render from. Short label only — full prose lives
   in the tooltip. */
export function buildHeaderTitles(meta) {
    const out = [];
    for (const t of (meta?.championshipTitles || [])) {
        const info = getChampionshipInfo(t);
        out.push({
            label: t.type === 'world' ? 'World Champion' : 'National Champion',
            icon: CHAMP_ICON,
            tier: info.tier,
            kind: 'champ',
            tooltip: getChampionshipTooltip(t),
        });
    }
    if (meta?.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info) {
            out.push({
                label: info.label,
                icon: TIER_ICONS[info.tier] || '♛',
                tier: info.tier,
                kind: 'bmab',
                tooltip: info.label,
            });
        }
    }
    return out;
}

/* Pick the best (most prestigious) tier per kind and assign solo / pair
   positions for the giant tier-coloured watermark glyphs that sit behind
   V12. Mirrors the lab's logic — bmab uses ⚜, champ uses ♛, both in
   text-presentation form (︎) so iOS respects the tier alpha tint. */
const _TIER_RANK = { gold: 0, silver: 1, bronze: 2, white: 3 };
export function watermarkLayers(titles) {
    if (!titles || titles.length === 0) return [];
    const bestByKind = {};
    for (const t of titles) {
        const rank = _TIER_RANK[t.tier] ?? 99;
        const cur = bestByKind[t.kind];
        if (!cur || rank < cur.rank) bestByKind[t.kind] = { tier: t.tier, rank };
    }
    const layers = [];
    if (bestByKind.bmab)  layers.push({ icon: '⚜︎', tier: bestByKind.bmab.tier,  kind: 'bmab' });
    if (bestByKind.champ) layers.push({ icon: '♛︎', tier: bestByKind.champ.tier, kind: 'champ' });
    if (layers.length === 1) {
        layers[0].role = 'solo';
    } else {
        const primary = layers.find(l => l.kind === 'champ') || layers[0];
        const secondary = layers.find(l => l !== primary);
        primary.role = 'pair-1';
        secondary.role = 'pair-2';
    }
    return layers;
}
export function cardTier(layers) {
    if (!layers || layers.length === 0) return null;
    const champ = layers.find(l => l.kind === 'champ');
    return (champ || layers[0]).tier;
}

/**
 * Render the V7 header card into `target` (typically `<h1 id="page-title">`).
 *
 * @param {HTMLElement} target
 * @param {Object} data
 *   {string}  name              Username (displayed)
 *   {string}  [nameHref]        Optional URL — if present, name renders as <a>
 *   {string}  [fullName]
 *   {string}  [photoPath]
 *   {string}  [flagCode]        ISO country code (defaults to no flag)
 *   {string}  statusDotClass    e.g. 'pg-dot pg-dot-green'
 *   {string}  statusDotTitle    Tooltip text
 *   {Array}   [titles]          [{label, icon, tier, tooltip}]
 *   {string}  [joinedFormatted] e.g. 'May 2026'
 *   {number}  leagueCount
 *   {string}  [extraMetaHtml]   Optional HTML appended at end of the meta row
 */
export function renderV7Header(target, data) {
    if (!target) return;

    const photoHtml = data.photoPath
        ? `<img class="pg-v7-avatar-img" src="${escapeHtml(data.photoPath)}" alt="${escapeHtml(data.name)}">`
        : `<div class="pg-v7-avatar">${escapeHtml(getInitials(data.name, data.fullName))}</div>`;

    const dotHtml =
        `<span class="pg-v7-dot-wrap" tabindex="0" title="${escapeHtml(data.statusDotTitle || '')}">` +
            `<span class="${data.statusDotClass || 'pg-dot pg-dot-gray'}" aria-label="${escapeHtml(data.statusDotTitle || '')}"></span>` +
        `</span>`;

    const flagHtml = data.flagCode
        ? `<img class="pg-v7-flag" src="${flagUrl(data.flagCode)}" alt="${escapeHtml(data.flagCode)}" title="${escapeHtml(data.flagCode)}">`
        : '';

    const chipsHtml = (data.titles || []).map(t =>
        `<span class="pg-v7-chip pg-v7-tier-${t.tier}" title="${escapeHtml(t.tooltip)}">` +
            `<span class="pg-v7-chip-icon">${t.icon}</span>${escapeHtml(t.label)}` +
        `</span>`
    ).join('');

    const nameHtml = data.nameHref
        ? `<a class="pg-v7-name pg-v7-name-link" href="${escapeHtml(data.nameHref)}">${escapeHtml(data.name)}</a>`
        : `<span class="pg-v7-name">${escapeHtml(data.name)}</span>`;

    // When the V7 card sits on a per-league surface (player_league.html, table
    // E), the joined date and league count belong on the cross-league
    // profile instead — pass { inLeague: true } to omit them here.
    const inLeague = data.inLeague === true;
    const metaParts = [
        data.fullName && `<span class="pg-v7-realname">${escapeHtml(data.fullName)}</span>`,
        !inLeague && data.joinedFormatted && `Joined ${escapeHtml(data.joinedFormatted)}`,
        !inLeague && `<span class="pg-v7-leagues">${data.leagueCount} ${data.leagueCount === 1 ? 'league' : 'leagues'}</span>`,
        data.extraMetaHtml || ''
    ].filter(Boolean).join(' <span class="pg-v7-sep">·</span> ');

    target.innerHTML = `
        <div class="pg-v7-card">
            <div class="pg-v7-avatar-wrap">
                ${photoHtml}
                ${dotHtml}
            </div>
            <div class="pg-v7-info">
                <div class="pg-v7-name-line">
                    ${flagHtml}
                    ${nameHtml}
                    ${chipsHtml}
                </div>
                <div class="pg-v7-meta">${metaParts}</div>
            </div>
        </div>
    `;
}

/**
 * Render the V12 hero-banner header into `target`. Used on
 * player.html.
 *
 * Top row: title ribbon(s) (Bebas-Neue Gold/Silver/Bronze gradients
 * driven by tier) on the left + status chip on the right.
 * Body row: 4.5em rounded-square photo (or initials) + display name
 * (Bebas Neue clamp) and the optional realname italics.
 * Bottom: 2-col stat grid (Joined / Leagues), omitted when
 * `data.inLeague === true`.
 *
 * @param {HTMLElement} target  typically <h1 id="page-title">
 * @param {Object} data         same shape as renderV7Header data
 */
export function renderV12Header(target, data) {
    if (!target) return;

    const initials = getInitials(data.name, data.fullName);
    const photoHtml = data.photoPath
        ? `<img class="pg-v12-photo-img" src="${escapeHtml(data.photoPath)}" alt="${escapeHtml(data.name)}">`
        : `<div class="pg-v12-photo">${escapeHtml(initials)}</div>`;

    const ribbons = (data.titles || []).map(t =>
        `<span class="pg-v12-titleribbon pg-tier-${t.tier}" title="${escapeHtml(t.tooltip)}">` +
            `<span class="pg-v12-titleicon">${t.icon}</span> ${escapeHtml((t.label || '').toUpperCase())}` +
        `</span>`
    ).join('');
    const titlesBlock = ribbons
        ? `<div class="pg-v12-titles-row">${ribbons}</div>`
        : '<span></span>';

    // statusDotClass like "pg-dot pg-dot-green" → kind = "green"
    const dotCls = data.statusDotClass || '';
    const statusKind = /pg-dot-(green|orange|gray)/.exec(dotCls)?.[1] || 'gray';
    const statusLabel = statusKind === 'green' ? 'Active'
                      : statusKind === 'orange' ? 'This year'
                      : 'Inactive';
    const statusVariantClass = statusKind === 'green' ? '' : statusKind;

    const flagHtml = data.flagCode
        ? `<img class="pg-v12-flag" src="${flagUrl(data.flagCode)}" alt="${escapeHtml(data.flagCode)}" title="${escapeHtml(data.flagCode)}">`
        : '';

    const nameInner = data.nameHref
        ? `<a class="pg-v12-name-link" href="${escapeHtml(data.nameHref)}">${escapeHtml(data.name)}</a>`
        : escapeHtml(data.name);

    const inLeague = data.inLeague === true;
    const statGrid = inLeague ? '' : `
            <div class="pg-v12-statgrid">
                ${data.joinedFormatted ? `<div class="pg-v12-stat"><div class="pg-v12-statlbl">Joined</div><div class="pg-v12-statnum">${escapeHtml(data.joinedFormatted)}</div></div>` : '<div></div>'}
                <div class="pg-v12-stat"><div class="pg-v12-statlbl">Leagues</div><div class="pg-v12-statnum">${data.leagueCount}</div></div>
            </div>`;

    const layers = watermarkLayers(data.titles);
    const watermarkHtml = layers.map(l =>
        `<div class="pg-watermark-glyph pg-v12-watermark pg-role-${l.role} pg-wm-${l.tier}">${l.icon}</div>`
    ).join('');
    const ct = cardTier(layers);
    const cardTierCls = ct ? ` pg-card-${ct}` : '';

    target.innerHTML = `
        <div class="pg-v12-hero${cardTierCls}">
            ${watermarkHtml}
            <div class="pg-v12-top">
                ${titlesBlock}
                <span class="pg-v12-statuschip ${statusVariantClass}" title="${escapeHtml(data.statusDotTitle || '')}">
                    <span class="pg-v12-dot"></span>${statusLabel}
                </span>
            </div>
            <div class="pg-v12-bodyrow">
                ${photoHtml}
                <div>
                    <h3 class="pg-v12-display">${flagHtml}${nameInner}</h3>
                    ${data.fullName ? `<div class="pg-v12-real">${escapeHtml(data.fullName)}</div>` : ''}
                </div>
            </div>
            ${statGrid}
        </div>
    `;
}
