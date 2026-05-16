/**
 * playerPage.js — Render player match history table on player.html.
 * Uses mountMFTable via E preset; page-specific concerns (header card,
 * "also plays in" links) live here.
 */

import { loadLeague } from '../data/leagueLoader.js';
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
        const [{ params, matches, allPlayers }, allMeta] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata()
        ]);
        const leagueConfig = getLeagueConfig(params);
        const title = params.LeagueTitle || leagueId;
        const flagCode = getFlagCode(playerName, params.CustomFlags);
        const meta = allMeta[playerName] || {};

        const retiredPlayers = params.RetiredPlayers || [];
        const isRetired = retiredPlayers.includes(playerName);
        const retiredBadge = isRetired ? ' <span class="retired-badge">Retired</span>' : '';

        const running = params.Running === true;
        const CURRENT_YEAR = new Date().getFullYear();
        const leagueYear = getLeagueYear({ params, id: leagueId });
        let dotClass, dotTitle;
        if (running) {
            dotClass = 'pg-dot pg-dot-green';
            dotTitle = 'Active in this running league';
        } else if (leagueYear === CURRENT_YEAR) {
            dotClass = 'pg-dot pg-dot-orange';
            dotTitle = `League from ${CURRENT_YEAR}, now completed`;
        } else {
            dotClass = 'pg-dot pg-dot-gray';
            dotTitle = 'Completed league';
        }
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
                        open:  `<a href="${playerUrl(leagueId, name)}" class="player-name-link" data-name="${escapeHtml(name)}">`,
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
