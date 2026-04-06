/**
 * remainingReport.js — Remaining Matches report with export to PNG.
 *
 * Shows how many matches each player still needs to play,
 * color-coded red→green (many remaining = red, few = green).
 * Can be downloaded as PNG or shared via Web Share API.
 */

import { loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from '../compute/stats.js';
import { buildRankings } from '../compute/rankings.js';
import { getLeagueConfig } from '../compute/leagueTypes.js';
import { colorForValueInverted } from '../compute/colorScale.js';
import { getFlagCode, flagUrl } from '../utils/helpers.js';

/**
 * Render the remaining matches report into a container.
 * @param {HTMLElement} container
 * @param {string} leagueId
 */
export async function renderRemainingReport(container, leagueId) {
    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
        const { params, matches, totalPlayers, allPlayers } = await loadLeague(leagueId);
        const leagueConfig = getLeagueConfig(params);
        const statsMap = computeAllStats(matches, allPlayers);
        const rankings = buildRankings(statsMap, leagueConfig);
        const title = params.LeagueTitle || leagueId;
        const n = totalPlayers || rankings.length;

        // Calculate remaining for each player
        const playerRemaining = rankings.map(r => ({
            player: r.player,
            games: r.games,
            remaining: Math.max(0, (n - 1) - r.games),
            flagCode: getFlagCode(r.player, params.CustomFlags)
        }));

        // Sort by remaining DESC (most remaining first)
        playerRemaining.sort((a, b) => b.remaining - a.remaining);

        const maxRemaining = playerRemaining.length > 0 ? playerRemaining[0].remaining : 0;
        const minRemaining = playerRemaining.length > 0 ? playerRemaining[playerRemaining.length - 1].remaining : 0;

        // Build report HTML
        const now = new Date();
        const timestamp = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            + ', ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        let rows = '';
        for (const p of playerRemaining) {
            const color = colorForValueInverted(p.remaining, minRemaining, maxRemaining);
            const isBold = p.remaining === maxRemaining || p.remaining === minRemaining;
            const weight = isBold ? 'font-weight:700' : '';
            rows += `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;${weight}">
                    <img src="${flagUrl(p.flagCode)}" alt="${p.flagCode}" style="height:14px;border-radius:2px">
                    <span style="flex:1">${escHtml(p.player)}</span>
                    <span style="color:${color};min-width:24px;text-align:right">${p.remaining}</span>
                </div>`;
        }

        container.innerHTML = `
            <div id="remaining-report" style="background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08);padding:20px;max-width:400px">
                <h2 style="text-align:center;margin-bottom:4px;font-size:1.1rem">${escHtml(title)}</h2>
                <p style="text-align:center;color:#888;font-size:0.82rem;margin-bottom:12px">Remaining Matches</p>
                <div style="border:1px solid #e2e4e9;border-radius:8px;overflow:hidden">
                    ${rows}
                </div>
                <p style="text-align:center;color:#aaa;font-size:0.75rem;margin-top:10px">${timestamp}</p>
            </div>
            <div style="margin-top:16px;display:flex;gap:8px">
                <button class="btn btn-primary" id="download-report-btn">Download as Image</button>
                ${typeof navigator !== 'undefined' && navigator.share ? '<button class="btn btn-secondary" id="share-report-btn">Share</button>' : ''}
            </div>`;

        // Download button
        document.getElementById('download-report-btn').addEventListener('click', async () => {
            await downloadReportAsImage(title);
        });

        // Share button
        const shareBtn = document.getElementById('share-report-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                await shareReport(title);
            });
        }
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

/**
 * Render a public-facing remaining report button for league.html.
 * Appends a button and modal container after the table.
 */
export function addRemainingReportButton(parentEl, leagueId) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'text-align:center;margin:16px 0';
    wrapper.innerHTML = `<button class="btn btn-secondary" id="public-remaining-btn">Remaining Matches Report</button>`;
    parentEl.appendChild(wrapper);

    const reportContainer = document.createElement('div');
    reportContainer.id = 'public-remaining-container';
    reportContainer.style.cssText = 'display:none;margin:16px auto;max-width:440px';
    parentEl.appendChild(reportContainer);

    document.getElementById('public-remaining-btn').addEventListener('click', async () => {
        const container = document.getElementById('public-remaining-container');
        if (container.style.display === 'none') {
            container.style.display = 'block';
            await renderRemainingReport(container, leagueId);
            document.getElementById('public-remaining-btn').textContent = 'Hide Report';
        } else {
            container.style.display = 'none';
            container.innerHTML = '';
            document.getElementById('public-remaining-btn').textContent = 'Remaining Matches Report';
        }
    });
}

// ---- Image Export ----

async function downloadReportAsImage(title) {
    const el = document.getElementById('remaining-report');
    if (!el) return;

    if (typeof html2canvas === 'undefined') {
        alert('html2canvas library not loaded.');
        return;
    }

    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_remaining.png`;
    a.click();
    URL.revokeObjectURL(url);
}

async function shareReport(title) {
    const el = document.getElementById('remaining-report');
    if (!el || typeof html2canvas === 'undefined') return;

    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], `${title}_remaining.png`, { type: 'image/png' });

    try {
        await navigator.share({
            title: `${title} — Remaining Matches`,
            files: [file]
        });
    } catch {
        // User cancelled or sharing not supported for files — fallback to download
        downloadReportAsImage(title);
    }
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
