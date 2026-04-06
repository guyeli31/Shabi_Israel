/**
 * landingPage.js — Render the league list on index.html.
 */

import { loadLeagueOrder, loadAllLeagueParams, loadLeagueMatches } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { leagueUrl, flagUrl, getFlagCode } from '../utils/helpers.js';

export async function renderLandingPage() {
    const container = document.getElementById('content');
    container.innerHTML = '<div class="loading">Loading leagues...</div>';

    try {
        const leagueIds = await loadLeagueOrder();
        // The DisplayOrder contains titles like "Shabi Israel - April 2026"
        // but folder names are like "Shabi Israel April 2026" (no dash).
        // We need to map titles to folder names.
        // The folder names in leagues/ don't have the dash.
        // Let's load params for all folders and match by title.

        // Actually, leagues_order.json DisplayOrder has titles with dash,
        // but folder names don't have dash. Let's derive folder name from title.
        const folderNames = leagueIds.map(title => title.replace(' - ', ' '));

        const leaguesData = await loadAllLeagueParams(folderNames);

        // For each league, we need the leader (rank 1 player).
        // Load matches in parallel for all leagues.
        const leaguesWithLeaders = await Promise.all(
            leaguesData.map(async ({ id, params }) => {
                try {
                    const { matches, allPlayers } = await loadLeagueMatches(id);
                    const leagueConfig = getLeagueConfig(params);
                    const statsMap = computeAllStats(matches, allPlayers);
                    const rankings = buildRankings(statsMap, leagueConfig);
                    const leader = rankings.length > 0 ? rankings[0] : null;
                    return { id, params, leader };
                } catch {
                    return { id, params, leader: null };
                }
            })
        );

        renderTable(container, leaguesWithLeaders);
    } catch (err) {
        container.innerHTML = `<div class="error">Failed to load leagues: ${err.message}</div>`;
    }
}

function renderTable(container, leagues) {
    let html = `
    <div class="table-wrapper">
        <div class="table-scroll">
            <table class="landing-table">
                <thead>
                    <tr>
                        <th>League</th>
                        <th>Status</th>
                        <th>Leader</th>
                    </tr>
                </thead>
                <tbody>`;

    for (const { id, params, leader } of leagues) {
        const title = params.LeagueTitle || id;
        const isRunning = params.Running === true;
        const statusClass = isRunning ? 'status-running' : 'status-completed';
        const statusText = isRunning ? 'Running' : 'Completed';

        let leaderHtml = '—';
        if (leader) {
            const flagCode = getFlagCode(leader.player, params.CustomFlags);
            leaderHtml = `<img class="flag" src="${flagUrl(flagCode)}" alt="${flagCode}"> ${leader.player}`;
        }

        html += `
                    <tr>
                        <td><a href="${leagueUrl(id)}">${title}</a></td>
                        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                        <td>${leaderHtml}</td>
                    </tr>`;
    }

    html += `
                </tbody>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}
