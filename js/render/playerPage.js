/**
 * playerPage.js — Render player match history table on player.html.
 * Uses mountMFTable via E preset; page-specific concerns (header card,
 * "also plays in" links) live here.
 */

import { loadLeague, loadLeagueOrder, loadAllLeagueParams } from '../data/leagueLoader.js';
import { getPlayerMatches } from '../data/csvParser.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, flagUrl, getFlagCode, playerUrl, dashboardUrl, leagueUrl, playerGeneralUrl, getLeagueYear } from '../utils/helpers.js';
import { renderBreadcrumbs, ensurePlayerIndex } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleBadgesHtml, getHighestTier, getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { attachPlayerNameInteractions } from './playerNameInteraction.js';
import { startSplash, endSplash } from '../utils/splash.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { buildPlayerMatchHistoryPreset } from '../presets/playerMatchHistoryPreset.js';

export async function renderPlayerPage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');
    const playerName = getQueryParam('player');

    if (!leagueId || !playerName) {
        container.innerHTML = '<div class="error">Missing league or player parameter.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading player data...</div>';

    startSplash();
    try {
        const [{ params, matches, allPlayers }, allMeta, playerIndex, leagueOrder] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata(),
            ensurePlayerIndex(),
            loadLeagueOrder().catch(() => [])
        ]);
        const folderNames = leagueOrder.map(t => t.replace(' - ', ' '));
        const allParams = await loadAllLeagueParams(folderNames).catch(() => []);

        const leagueConfig = getLeagueConfig(params);
        const title = params.LeagueTitle || leagueId;
        const flagCode = getFlagCode(playerName, params.CustomFlags);
        const meta = allMeta[playerName] || {};

        const retiredPlayers = params.RetiredPlayers || [];
        const isRetired = retiredPlayers.includes(playerName);
        const retiredBadge = isRetired ? ' <span class="retired-badge">Retired</span>' : '';

        const CURRENT_YEAR = new Date().getFullYear();
        const { dotClass, dotTitle } = computePlayerStatusDot({
            playerName, playerIndex, allParams,
            currentLeagueId: leagueId, currentParams: params,
            currentYear: CURRENT_YEAR
        });
        const dotHtml = `<span class="pg-dot-wrap" tabindex="0" data-tip="${escapeHtml(dotTitle)}"><span class="${dotClass}" aria-label="${escapeHtml(dotTitle)}"></span></span>`;

        const avatarHtml = meta.photoPath
            ? `<img class="pg-avatar" src="${escapeHtml(meta.photoPath)}" alt="${escapeHtml(playerName)}">`
            : '';

        const flagHtml = `<img class="flag-title" src="${flagUrl(flagCode)}" alt="${flagCode}" title="${flagCode}">`;
        const titleBadgesHtml = getTitleBadgesHtml(meta);
        const aliasHtml = meta.fullName
            ? `<div class="pg-player-alias">${escapeHtml(meta.fullName)}</div>`
            : '';
        const highestTier = getHighestTier(meta);

        const badgesHtml = (titleBadgesHtml || retiredBadge)
            ? `<div class="pg-badges-line">${titleBadgesHtml}${retiredBadge}</div>`
            : '';
        const pageTitle = document.getElementById('page-title');
        pageTitle.innerHTML = `
            <div class="pg-header-row">
                ${avatarHtml}
                <div class="pg-header-text">
                    <div class="pg-name-line">
                        ${dotHtml} ${flagHtml}
                        <a class="player-name-link pg-player-name" href="${playerGeneralUrl(playerName)}" title="Open general player card">${escapeHtml(playerName)}</a>
                    </div>
                    ${badgesHtml}
                    ${aliasHtml}
                </div>
            </div>
        `;
        pageTitle.classList.remove('pg-titled-gold', 'pg-titled-silver', 'pg-titled-bronze', 'pg-titled-white');
        if (highestTier) pageTitle.classList.add(`pg-titled-${highestTier}`);

        document.getElementById('league-subtitle').textContent = title;
        document.title = `${playerName} — ${title}`;

        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: dashboardUrl(leagueId) },
            { label: playerName }
        ]);

        installPlayerLeagueNavArrows({
            leagueId, playerName,
            currentType: params.LeagueType || 'doubling',
            playerIndex, allParams
        });

        const playerMatches = getPlayerMatches(matches, playerName, allPlayers);

        container.innerHTML = `
            <div class="dash-controls">
                <a class="open-full-btn" href="${leagueUrl(leagueId)}" title="Back to the full league table">&lsaquo; Back to full table</a>
            </div>
            <div class="table-wrapper">
                <div id="player-table-mount"></div>
            </div>`;

        const mountPoint = document.getElementById('player-table-mount');
        const renderTable = () => {
            const preset = buildPlayerMatchHistoryPreset({
                playerMatches, leagueConfig, params, flagUrl,
                enrich: {
                    isHidden: (name) => !!(allMeta[name] && allMeta[name].hidden),
                    opponentLink: (name) => ({
                        open:  `<a href="${playerUrl(leagueId, name)}" class="player-name-link" data-player="${escapeHtml(name)}">`,
                        close: `</a>`,
                    }),
                    opponentSuffix: (name) => getTitleAbbreviationsHtml(allMeta[name]),
                },
            });
            mountMFTable(mountPoint, preset);
            attachPlayerNameInteractions(mountPoint, leagueId);
        };

        renderTable();
        window.addEventListener('themechange', renderTable);

        renderAlsoPlaysIn(container, playerName, leagueId);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load player data: ${err.message}</div>`;
    } finally {
        endSplash();
    }
}

function installPlayerLeagueNavArrows({ leagueId, playerName, currentType, playerIndex, allParams }) {
    const playerLeagueIds = new Set((playerIndex.get(playerName) || []).map(l => l.leagueId));
    if (playerLeagueIds.size === 0) return;

    const folders = allParams
        .filter(({ params }) => (params.LeagueType || 'doubling') === currentType)
        .map(({ id }) => id)
        .filter(id => playerLeagueIds.has(id));

    const idx = folders.indexOf(leagueId);
    if (idx === -1) return;

    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.league-nav')) return;

    const prev = idx > 0 ? folders[idx - 1] : null;
    const next = idx < folders.length - 1 ? folders[idx + 1] : null;

    const nav = document.createElement('div');
    nav.className = 'league-nav';
    nav.innerHTML = `
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${playerUrl(prev, playerName)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${playerUrl(next, playerName)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    header.querySelector('h1').insertAdjacentElement('afterend', nav);
}

function computePlayerStatusDot({ playerName, playerIndex, allParams, currentLeagueId, currentParams, currentYear }) {
    const paramsById = new Map(allParams.map(({ id, params }) => [id, params]));
    paramsById.set(currentLeagueId, currentParams);

    const playerLeagueIds = new Set((playerIndex.get(playerName) || []).map(l => l.leagueId));
    playerLeagueIds.add(currentLeagueId);

    let inRunning = false;
    let inCurrentYearLeague = false;
    for (const id of playerLeagueIds) {
        const p = paramsById.get(id);
        if (!p) continue;
        if (p.Running === true) inRunning = true;
        if (getLeagueYear({ params: p, id }) === currentYear) inCurrentYearLeague = true;
    }

    if (inRunning) {
        return { dotClass: 'pg-dot pg-dot-green', dotTitle: 'Active in a running league' };
    }
    if (inCurrentYearLeague) {
        return { dotClass: 'pg-dot pg-dot-orange', dotTitle: `Played this year (${currentYear}), not in a running league` };
    }
    return { dotClass: 'pg-dot pg-dot-gray', dotTitle: `Inactive in ${currentYear}` };
}

async function renderAlsoPlaysIn(container, playerName, currentLeagueId) {
    try {
        const index = await ensurePlayerIndex();
        const leagues = index.get(playerName) || [];
        const otherLeagues = leagues.filter(l => l.leagueId !== currentLeagueId);
        if (otherLeagues.length === 0) return;
        const div = document.createElement('div');
        div.className = 'also-plays-in';
        div.innerHTML = `
            <h3>Also plays in</h3>
            <div class="also-plays-links">
                ${otherLeagues.map(l =>
                    `<a href="${playerUrl(l.leagueId, playerName)}">${escapeHtml(l.title)}</a>`
                ).join('')}
            </div>
        `;
        container.appendChild(div);
    } catch {
        // Silently fail — non-critical feature
    }
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
}
