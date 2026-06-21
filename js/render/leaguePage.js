/**
 * leaguePage.js — Render league summary table on league.html.
 *
 * Delegates the actual table render to mountMFTable() via the shared D preset
 * (js/presets/leagueTablePreset.js). Page-specific concerns kept here:
 * loading league data, header summary lines, breadcrumbs, image export,
 * and player-cell enrichments (link, title abbreviations, retired mark).
 */

import { loadLeague, loadLeagueOrder, loadAllLeagueParams } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, flagUrl, playerLeagueUrl, leagueUrl, leagueTableUrl } from '../utils/helpers.js';
import { exportTableImage } from '../utils/exportTableImage.js';
import { renderBreadcrumbs } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { startSplash, endSplash } from '../utils/splash.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { buildLeagueTablePreset } from '../presets/leagueTablePreset.js';
import { buildLeagueHeaderData, renderV13Header } from './leagueHeader.js';

export async function renderLeaguePage() {
    const container = document.getElementById('content');
    const leagueId = getQueryParam('league');

    if (!leagueId) {
        container.innerHTML = '<div class="error">No league specified.</div>';
        return;
    }

    container.innerHTML = '<div class="loading">Loading league data...</div>';

    startSplash();
    try {
        const [{ params, matches, lastModified, totalPlayers, allPlayers }, playersMeta, leagueOrder] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata(),
            loadLeagueOrder().catch(() => [])
        ]);
        const folderNames = leagueOrder.map(t => t.replace(' - ', ' '));
        const allParams   = await loadAllLeagueParams(folderNames).catch(() => []);
        const leagueConfig = getLeagueConfig(params);

        const title = params.LeagueTitle || leagueId;
        document.title = title + ' — Shabi Israel';

        // V13 Lichess title bar (production default for the table-D page).
        // omitStartDate=true — the "Last updated …" line already implies
        // the league has started; showing both dates is duplicate.
        renderV13Header(
            document.getElementById('page-title'),
            buildLeagueHeaderData(params, lastModified),
            { omitStartDate: true },
        );

        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: leagueUrl(leagueId) },
            { label: 'League Table' }
        ]);

        installLeagueTableNavArrows({
            leagueId,
            currentType: params.LeagueType || 'doubling',
            allParams,
        });

        const statsMap  = computeAllStats(matches, allPlayers);
        const rankings  = buildRankings(statsMap, leagueConfig, matches);
        const averages  = computeAverages(rankings, leagueConfig);
        // matchStats no longer surfaced in the header — V13 already
        // carries the only timestamp the league-table page needs.

        // Build the export-button shell + a mount point for the table
        container.innerHTML = `
            <div class="img-export-group" style="margin-bottom:var(--space-sm);text-align:right">
                <button class="img-export-btn" id="leagueExportBtn">Export Image</button>
            </div>
            <div class="table-wrapper">
                <div id="league-table-mount"></div>
            </div>`;

        const mountPoint = document.getElementById('league-table-mount');
        const renderTable = () => {
            const preset = buildLeagueTablePreset({
                rankings, averages, params, leagueConfig,
                flagUrl,
                enrich: {
                    isHidden: (name) => !!(playersMeta[name] && playersMeta[name].hidden),
                    playerLink: (name) => ({
                        open:  `<a href="${playerLeagueUrl(leagueId, name)}" title="Open ${name}'s card for this league">`,
                        close: `</a>`,
                    }),
                    playerSuffix: (name) => {
                        const titles = getTitleAbbreviationsHtml(playersMeta[name]);
                        const retired = (params.RetiredPlayers || []).includes(name)
                            ? ' <span class="retired-mark" title="Retired">&#x1F6AA;</span>'
                            : '';
                        return `${titles}${retired}`;
                    },
                },
            });
            mountMFTable(mountPoint, preset);
        };

        renderTable();

        // colorScale reads isDarkTheme at render time, so re-render on theme change
        window.addEventListener('themechange', renderTable);

        const exportBtn = document.getElementById('leagueExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => exportLeagueTableImage(title, mountPoint));
        }
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load league: ${err.message}</div>`;
    } finally {
        endSplash();
    }
}

// ---- Export Image ----
//
// Thin wrapper around the shared exportTableImage() helper. Passes the
// live V13 league-header card as the heading so the export carries the
// same identity bar the user sees on the page.

function exportLeagueTableImage(title, mountPoint) {
    const sourceTable = mountPoint.querySelector('table');
    const headerCard = document.getElementById('page-title')?.querySelector('.lh13-card') || null;
    return exportTableImage({
        sourceTable,
        filename: `${title}_Table`,
        headerNode: headerCard,
        title: headerCard ? undefined : title,
    });
}

// ---- League nav arrows ----
//
// Mirrors the E-page arrows: prev/next within the same LeagueType, ordered by
// landing DisplayOrder. Clicking an arrow stashes the current sort into
// sessionStorage under `mf-sort-pending-D` so the next mount restores it.
// Sort handover is scoped to *these arrows*: any other entry (breadcrumb,
// search, direct URL, theme re-render) gets the preset's default sort.

function installLeagueTableNavArrows({ leagueId, currentType, allParams }) {
    const folders = allParams
        .filter(({ params }) => (params.LeagueType || 'doubling') === currentType)
        .map(({ id }) => id);

    const idx = folders.indexOf(leagueId);
    if (idx === -1) return;

    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.league-nav')) return;

    const prev = idx > 0 ? folders[idx - 1] : null;
    const next = idx < folders.length - 1 ? folders[idx + 1] : null;

    const nav = document.createElement('div');
    nav.className = 'league-nav';
    nav.innerHTML = `
        <a class="nav-arrow ${prev ? '' : 'disabled'}" ${prev ? `href="${leagueTableUrl(prev)}" title="Previous league: ${prev}"` : 'title="No previous league"'}>&lsaquo;</a>
        <a class="nav-arrow ${next ? '' : 'disabled'}" ${next ? `href="${leagueTableUrl(next)}" title="Next league: ${next}"` : 'title="No next league"'}>&rsaquo;</a>
    `;
    (header.querySelector('#page-title') || header.querySelector('h1')).insertAdjacentElement('afterend', nav);

    nav.querySelectorAll('a.nav-arrow:not(.disabled)').forEach(a => {
        a.addEventListener('click', () => stashPendingSort('D'));
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
