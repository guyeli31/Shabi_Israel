/**
 * overridesList.js — "View Overrides" panel: lists all manual overrides
 * staged/published for a league with a per-row Remove action.
 */

import { getStagedContent, stageManualOverrides } from './stagingStore.js';
import { thLabel } from '../utils/helpers.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { revealMsg } from './msgScroll.js';

export async function renderOverridesList(container, leagueId, refreshBadge) {
    container.innerHTML = '<div class="loading">Loading overrides...</div>';

    try {
        const encoded = encodeURIComponent(leagueId);
        const path = `leagues/${encoded}/manual_overrides.json`;

        let overrides = [];
        let staged = false;
        const stagedContent = getStagedContent(path);
        if (stagedContent) {
            try { overrides = JSON.parse(stagedContent).overrides || []; staged = true; } catch { }
        } else {
            const resp = await fetch(path);
            if (resp.ok) {
                const data = await resp.json();
                overrides = data.overrides || [];
            }
        }

        if (overrides.length === 0) {
            container.innerHTML = '<p style="color:var(--color-text-muted)">No manual overrides for this league.</p>';
            return;
        }

        let rows = '';
        for (let i = 0; i < overrides.length; i++) {
            const o = overrides[i];
            const time = o.timestamp ? new Date(o.timestamp).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            }) : '—';
            rows += `
                <tr>
                    <td>${esc(o.playerA)} vs ${esc(o.playerB)}</td>
                    <td>${esc(o.type)}</td>
                    <td>${esc(o.reason || '')}</td>
                    <td>${time}</td>
                    <td><button class="btn btn-danger btn-sm" data-del-override="${i}">Remove</button></td>
                </tr>`;
        }

        const stagedBanner = staged
            ? `<div class="admin-msg admin-msg-info" style="margin-bottom:var(--space-sm)">Showing staged (unpublished) overrides. Publish from the changes drawer to commit.</div>`
            : '';

        container.innerHTML = `
            <div id="overrides-msg"></div>
            ${stagedBanner}
            <div class="ff-wrap">
                <table class="admin-table font-large">
                    <thead><tr>
                        <th scope="col">${thLabel('Match', 'Match')}</th>
                        <th scope="col">${thLabel('Type', 'T')}</th>
                        <th scope="col">${thLabel('Reason', 'Why')}</th>
                        <th scope="col">${thLabel('Date', 'Date')}</th>
                        <th scope="col"></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        attachStickyShadow(container.querySelector('.ff-wrap'));

        container.querySelectorAll('[data-del-override]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.delOverride);
                overrides.splice(idx, 1);

                await stageManualOverrides(leagueId, overrides);

                if (refreshBadge) refreshBadge();
                showMsg('Override removal staged.', 'success');
                setTimeout(() => renderOverridesList(container, leagueId, refreshBadge), 800);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showMsg(message, type) {
    const el = document.getElementById('overrides-msg');
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
    if (message) revealMsg(el);
}
