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
import { buildRankings, computeAverages, computeMatchStats } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { getQueryParam, formatPercent, flagUrl, playerUrl, dashboardUrl, appendExportCredit } from '../utils/helpers.js';
import { renderBreadcrumbs } from './navigation.js';
import { loadPlayersMetadata } from '../data/playersMetadata.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { startSplash, endSplash } from '../utils/splash.js';
import { mountMFTable } from './mountMFTable.js';
import { buildLeagueTablePreset } from '../presets/leagueTablePreset.js';

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
        document.getElementById('page-title').textContent = title;
        document.title = title + ' — Shabi Israel';

        renderBreadcrumbs([
            { label: 'Home', url: 'index.html' },
            { label: title, url: dashboardUrl(leagueId) },
            { label: 'League Table' }
        ]);

        if (leagueConfig.type === 'ubc') {
            document.querySelector('.page-container').classList.add('wide-table');
        }

        const statsMap  = computeAllStats(matches, allPlayers);
        const rankings  = buildRankings(statsMap, leagueConfig, matches);
        const averages  = computeAverages(rankings, leagueConfig);
        const matchStats = computeMatchStats(rankings, totalPlayers);

        renderGamesPlayed(matchStats);
        renderLastUpdated(lastModified);

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

function renderLastUpdated(lastModified) {
    if (!lastModified) return;
    const date = new Date(lastModified);
    const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = 'last-updated';
    el.textContent = `Last updated: ${formatted}`;
    document.querySelector('.page-header').appendChild(el);
}

function renderGamesPlayed(matchStats) {
    if (!matchStats) return;
    const pct = formatPercent(matchStats.playedRatio);
    const el = document.createElement('div');
    el.className = 'games-played';
    el.textContent = `Games Played: ${matchStats.playedMatches} / ${matchStats.totalMatches} (${pct})`;
    document.querySelector('.page-header').appendChild(el);
}

// ---- Export Image ----

async function exportLeagueTableImage(title, mountPoint) {
    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }
    const tableEl = mountPoint.querySelector('table');
    if (!tableEl) return;

    const bodyStyle = getComputedStyle(document.body);
    const themeBg = bodyStyle.backgroundColor;
    const themeColor = bodyStyle.color;
    const themeFont = bodyStyle.fontFamily;
    const tableWidth = tableEl.offsetWidth;

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;padding:24px;background:${themeBg};color:${themeColor};font-family:${themeFont};width:${tableWidth + 48}px;box-sizing:border-box;direction:ltr;`;
    const heading = document.createElement('h3');
    heading.style.cssText = 'margin:0 0 12px 0;font-size:20px;';
    heading.textContent = title;
    wrap.appendChild(heading);

    const tableClone = tableEl.cloneNode(true);
    tableClone.querySelectorAll('tr.avg-row, tr.stat-row').forEach(tr => {
        tr.style.position = 'static';
        tr.style.bottom = 'auto';
    });
    tableClone.querySelectorAll('thead th, tbody td').forEach(cell => {
        cell.style.position = 'static';
        cell.style.left = 'auto';
    });
    tableClone.style.width = tableWidth + 'px';
    const scroll = document.createElement('div');
    scroll.style.cssText = 'max-height:none;overflow:visible;';
    scroll.appendChild(tableClone);
    wrap.appendChild(scroll);
    document.body.appendChild(wrap);
    appendExportCredit(wrap);

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: null, useCORS: true });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_Table.png`;
        a.click();
        URL.revokeObjectURL(url);
    } finally {
        wrap.remove();
    }
}
