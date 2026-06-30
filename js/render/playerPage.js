/**
 * playerPage.js — Render player match history table on player.html.
 * Uses mountMFTable via E preset; page-specific concerns (header card,
 * "also plays in" links) live here.
 */

import { loadLeague, loadLeagueOrder, loadAllLeagueParams } from '../data/leagueLoader.js';
import { getPlayerMatches } from '../data/csvParser.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, flagUrl, getFlagCode, playerLeagueUrl, leagueUrl, leagueTableUrl, playerUrl, getLeagueYear, parseLeagueDate } from '../utils/helpers.js';
import { renderBreadcrumbs, ensurePlayerIndex } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleBadgesHtml, getHighestTier, getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { renderV7Header, buildHeaderTitles, formatJoinedShort } from './playerHeader.js';
import { attachPlayerNameInteractions } from './playerNameInteraction.js';
import { displayPlayerName } from '../utils/nameDisplay.js';
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

        const CURRENT_YEAR = new Date().getFullYear();
        const { dotClass: statusDotClass, dotTitle: statusDotTitle } = computePlayerStatusDot({
            playerName, playerIndex, allParams,
            currentLeagueId: leagueId, currentParams: params,
            currentLeaguePlayers: allPlayers,
            currentYear: CURRENT_YEAR
        });

        // ── Aggregate the player's leagues (current + all known) to
        //    derive joined date and total league count. The cross-league
        //    index doesn't include the current league if we are the only
        //    page that has loaded it, so union the two. ──
        const indexedLeagueIds = new Set(
            (playerIndex.get(playerName) || []).map(l => l.leagueId)
        );
        indexedLeagueIds.add(leagueId);
        const dated = [...indexedLeagueIds]
            .map(id => {
                const d = parseLeagueDate(id);
                return { id, year: d.year, monthIndex: d.monthIndex };
            })
            .filter(x => x.year != null && x.monthIndex >= 0)
            .sort((a, b) => (a.year - b.year) || (a.monthIndex - b.monthIndex));

        const joinedFormatted = (meta.joined
            ? (() => {
                const [y, m] = String(meta.joined).split('-').map(x => parseInt(x, 10));
                return formatJoinedShort(y, m - 1);
            })()
            : (dated.length ? formatJoinedShort(dated[0].year, dated[0].monthIndex) : '')
        );

        const pageTitle = document.getElementById('page-title');
        renderV7Header(pageTitle, {
            name: playerName,
            nameHref: playerUrl(playerName),
            fullName: meta.fullName,
            photoPath: meta.photoPath,
            flagCode,
            statusDotClass,
            statusDotTitle,
            titles: buildHeaderTitles(meta),
            // inLeague=true drops "Joined …" + "N leagues" from the meta
            // row — those belong on the cross-league general profile,
            // not on the per-league surface (table E).
            inLeague: true,
            joinedFormatted,
            leagueCount: indexedLeagueIds.size,
            extraMetaHtml: isRetired ? '<span class="retired-badge">Retired</span>' : '',
        });

        const highestTier = getHighestTier(meta);
        pageTitle.classList.remove('pg-titled-gold', 'pg-titled-silver', 'pg-titled-bronze', 'pg-titled-white');
        if (highestTier) pageTitle.classList.add(`pg-titled-${highestTier}`);

        document.getElementById('league-subtitle').textContent = title;
        const displayName = displayPlayerName(playerName, meta);
        document.title = `${displayName} — ${title}`;

        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: leagueUrl(leagueId) },
            { label: displayName }
        ]);

        installPlayerLeagueNavArrows({
            leagueId, playerName,
            currentType: params.LeagueType || 'doubling',
            playerIndex, allParams
        });

        const playerMatches = getPlayerMatches(matches, playerName, allPlayers);

        container.innerHTML = `
            <div class="dash-controls">
                <a class="open-full-btn" href="${leagueTableUrl(leagueId)}" title="Back to the full league table">&lsaquo; Back to full table</a>
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
                        open:  `<a href="${playerLeagueUrl(leagueId, name)}" class="player-name-link" data-player="${escapeHtml(name)}">`,
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
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${playerLeagueUrl(prev, playerName)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${playerLeagueUrl(next, playerName)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    (header.querySelector('#page-title') || header.querySelector('h1')).insertAdjacentElement('afterend', nav);

    // Sort handover — only nav-arrow clicks carry E's current sort to the
    // next league. Any other entry (breadcrumb, search, direct URL,
    // theme re-render) gets the preset default. See mountMFTable's
    // one-shot pending-sort contract.
    nav.querySelectorAll('a.nav-arrow:not(.disabled)').forEach(a => {
        a.addEventListener('click', () => stashPendingSort('E'));
    });
}

function stashPendingSort(tableId) {
    if (typeof sessionStorage === 'undefined') return;
    const table = document.querySelector(`table[data-mf-table-id="${tableId}"]`);
    if (!table) return;
    const colKey = table.dataset.sortColKey;
    const dir    = table.dataset.sortDir;
    if (!colKey) return;
    try {
        sessionStorage.setItem(`mf-sort-pending-${tableId}`, JSON.stringify({ colKey, dir }));
    } catch { /* quota / disabled — ignore */ }
}

function computePlayerStatusDot({ playerName, playerIndex, allParams, currentLeagueId, currentParams, currentLeaguePlayers, currentYear }) {
    const paramsById = new Map(allParams.map(({ id, params }) => [id, params]));
    paramsById.set(currentLeagueId, currentParams);

    const playerLeagueIds = new Set((playerIndex.get(playerName) || []).map(l => l.leagueId));
    // Only count the current league if the player is actually in its
    // roster — otherwise viewing a non-participant on a Running league
    // would falsely report them as "Active in a running league".
    if (currentLeaguePlayers?.has(playerName)) {
        playerLeagueIds.add(currentLeagueId);
    }

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
                    `<a href="${playerLeagueUrl(l.leagueId, playerName)}">${escapeHtml(l.title)}</a>`
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
