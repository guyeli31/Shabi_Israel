/**
 * leaguePage.js — Render league summary table on league.html.
 *
 * Delegates the actual table render to mountMFTable() via the shared D preset
 * (js/presets/leagueTablePreset.js). Page-specific concerns kept here:
 * loading league data, header summary lines, breadcrumbs, image export,
 * and player-cell enrichments (link, title abbreviations, retired mark).
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings, computeAverages } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, flagUrl, playerUrl, dashboardUrl } from '../utils/helpers.js';
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
        const [{ params, matches, lastModified, totalPlayers, allPlayers }, playersMeta] = await Promise.all([
            loadLeague(leagueId),
            loadPlayersMetadata()
        ]);
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
            { label: title, url: dashboardUrl(leagueId) },
            { label: 'League Table' }
        ]);

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
                        open:  `<a href="${playerUrl(leagueId, name)}" title="Open ${name}'s card for this league">`,
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
