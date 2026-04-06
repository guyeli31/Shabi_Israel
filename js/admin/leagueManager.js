/**
 * leagueManager.js — Admin league management: list, create, edit, delete leagues + player editing.
 */

import { loadLeagueOrder, loadLeagueParams, loadLeagueMatches } from '../data/leagueLoader.js';
import { getFile } from './githubApi.js';
import { addChange } from './stagingStore.js';
import { getAllPlayersFromCSV } from '../data/csvParser.js';
import { renderCsvEditor } from './csvEditor.js';
import { renderRemainingReport } from './remainingReport.js';

// Known flag codes (from assets/flags/)
const KNOWN_FLAGS = ['BE', 'IL', 'RU', 'TZ', 'UN'];

let refreshBadgeFn = null;

/**
 * Main entry: render the leagues admin view.
 */
export async function renderLeagueAdmin(container, refreshBadge) {
    refreshBadgeFn = refreshBadge;
    container.innerHTML = '<h1>Leagues</h1><div class="loading">Loading leagues...</div>';

    try {
        const displayOrder = await loadLeagueOrder();
        const folderNames = displayOrder.map(title => title.replace(' - ', ' '));

        const leagues = await Promise.all(
            folderNames.map(async (id, i) => {
                try {
                    const params = await loadLeagueParams(id);
                    return { id, title: displayOrder[i], params };
                } catch {
                    return { id, title: displayOrder[i], params: null };
                }
            })
        );

        renderLeagueList(container, leagues, displayOrder);
    } catch (err) {
        container.innerHTML = `<h1>Leagues</h1><div class="admin-msg admin-msg-error">Failed to load: ${err.message}</div>`;
    }
}

// ---- League List ----

function renderLeagueList(container, leagues, displayOrder) {
    let rows = '';
    for (const lg of leagues) {
        if (!lg.params) {
            rows += `<tr><td>${esc(lg.id)}</td><td colspan="4" style="color:var(--color-loss)">Failed to load</td></tr>`;
            continue;
        }
        const p = lg.params;
        const running = p.Running === true;
        const hidden = p.Hidden === true;
        const statusPill = running
            ? '<span class="status-pill status-running">Running</span>'
            : '<span class="status-pill status-completed">Completed</span>';
        const hiddenBadge = hidden ? ' <span style="color:var(--color-text-muted);font-size:0.8rem">(Hidden)</span>' : '';

        rows += `
            <tr>
                <td>${esc(p.LeagueTitle || lg.id)}${hiddenBadge}</td>
                <td>${esc(p.LeagueType || 'doubling')}</td>
                <td>${statusPill}</td>
                <td>
                    <button class="btn btn-primary btn-sm" data-edit="${lg.id}">Edit</button>
                    <button class="btn btn-danger btn-sm" data-delete="${lg.id}" data-title="${esc(lg.title)}">Delete</button>
                </td>
            </tr>`;
    }

    container.innerHTML = `
        <h1>Leagues</h1>
        <div style="margin-bottom:var(--space-md)">
            <button class="btn btn-success" id="add-league-btn">+ Add League</button>
        </div>
        <div class="admin-card">
            <table class="admin-table">
                <thead>
                    <tr><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    // Add league
    document.getElementById('add-league-btn').addEventListener('click', () => {
        renderAddLeagueForm(container, displayOrder);
    });

    // Edit buttons
    container.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => renderEditLeague(container, btn.dataset.edit, displayOrder));
    });

    // Delete buttons
    container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.delete;
            const title = btn.dataset.title;
            if (confirm(`Delete league "${id}"? This will remove all league files.`)) {
                stageDeleteLeague(id, title, displayOrder);
                renderLeagueAdmin(container, refreshBadgeFn);
            }
        });
    });
}

// ---- Add League ----

function renderAddLeagueForm(container, displayOrder) {
    container.innerHTML = `
        <h1>Add New League</h1>
        <div class="admin-card">
            <div id="add-msg"></div>
            <div class="form-group">
                <label for="new-league-name">League Name</label>
                <input type="text" id="new-league-name" placeholder="e.g. Shabi Israel - May 2026">
            </div>
            <div class="form-group">
                <label for="new-league-type">League Type</label>
                <select id="new-league-type">
                    <option value="doubling">Doubling (Win Rate)</option>
                    <option value="regular">Regular (Wins only)</option>
                    <option value="ubc">UBC (PR Wins + Points)</option>
                </select>
            </div>
            <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-success" id="save-new-league">Create League</button>
                <button class="btn btn-secondary" id="cancel-new-league">Cancel</button>
            </div>
        </div>`;

    document.getElementById('cancel-new-league').addEventListener('click', () => {
        renderLeagueAdmin(container, refreshBadgeFn);
    });

    document.getElementById('save-new-league').addEventListener('click', () => {
        const name = document.getElementById('new-league-name').value.trim();
        const type = document.getElementById('new-league-type').value;

        if (!name) {
            showMsg('add-msg', 'Please enter a league name.', 'error');
            return;
        }

        stageAddLeague(name, type, displayOrder);
        showMsg('add-msg', `League "${name}" staged. Go to Pending Changes to publish.`, 'success');
        setTimeout(() => renderLeagueAdmin(container, refreshBadgeFn), 1200);
    });
}

function stageAddLeague(name, type, displayOrder) {
    // Folder name: title without dash
    const folderName = name.replace(' - ', ' ');
    const encoded = encodeURIComponent(folderName);

    // league_params.json
    const params = {
        LeagueTitle: name,
        LeagueType: type,
        BronzeCount: 4,
        Running: true,
        CustomFlags: {}
    };

    addChange({
        type: 'create',
        path: `leagues/${encoded}/league_params.json`,
        content: JSON.stringify(params, null, 2),
        description: `Create league: ${name}`
    });

    // Empty CSV with header
    const csvHeader = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B\n';
    addChange({
        type: 'create',
        path: `leagues/${encoded}/leaguedata.csv`,
        content: csvHeader,
        description: `Create CSV for: ${name}`
    });

    // Update leagues_order.json
    const newOrder = [name, ...displayOrder];
    addChange({
        type: 'update',
        path: 'leagues/leagues_order.json',
        content: JSON.stringify({ DisplayOrder: newOrder }, null, 2),
        description: `Add "${name}" to league order`
    });

    if (refreshBadgeFn) refreshBadgeFn();
}

function stageDeleteLeague(leagueId, title, displayOrder) {
    const encoded = encodeURIComponent(leagueId);

    addChange({
        type: 'delete',
        path: `leagues/${encoded}/league_params.json`,
        content: null,
        description: `Delete league params: ${leagueId}`
    });

    addChange({
        type: 'delete',
        path: `leagues/${encoded}/leaguedata.csv`,
        content: null,
        description: `Delete league CSV: ${leagueId}`
    });

    // Update order
    const newOrder = displayOrder.filter(t => t !== title);
    addChange({
        type: 'update',
        path: 'leagues/leagues_order.json',
        content: JSON.stringify({ DisplayOrder: newOrder }, null, 2),
        description: `Remove "${title}" from league order`
    });

    if (refreshBadgeFn) refreshBadgeFn();
}

// ---- Edit League ----

async function renderEditLeague(container, leagueId, displayOrder) {
    container.innerHTML = '<h1>Edit League</h1><div class="loading">Loading...</div>';

    try {
        const params = await loadLeagueParams(leagueId);
        let players = [];
        try {
            const { allPlayers } = await loadLeagueMatches(leagueId);
            players = [...allPlayers].sort();
        } catch { /* no CSV yet */ }

        renderEditLeagueForm(container, leagueId, params, players, displayOrder);
    } catch (err) {
        container.innerHTML = `<h1>Edit League</h1><div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

function renderEditLeagueForm(container, leagueId, params, players, displayOrder) {
    const p = params;
    const running = p.Running === true;
    const hidden = p.Hidden === true;
    const goldCount = p.GoldCount || 1;
    const silverCount = p.SilverCount || 1;
    const bronzeCount = p.BronzeCount || 4;
    const customFlags = p.CustomFlags || {};
    const retiredPlayers = p.RetiredPlayers || [];

    // Player rows
    let playerRows = '';
    for (const player of players) {
        const flagCode = customFlags[player] || 'IL';
        const isRetired = retiredPlayers.includes(player);
        const flagOptions = KNOWN_FLAGS.map(f =>
            `<option value="${f}" ${f === flagCode ? 'selected' : ''}>${f}</option>`
        ).join('');

        playerRows += `
            <tr>
                <td>
                    <input type="text" class="player-name-input" data-original="${esc(player)}" value="${esc(player)}"
                        style="width:140px;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px">
                        <img class="flag-preview" src="assets/flags/${flagCode}.png" alt="${flagCode}" style="width:24px;height:16px">
                        <select class="player-flag-select" data-player="${esc(player)}" style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                            ${flagOptions}
                            <option value="__custom" ${!KNOWN_FLAGS.includes(flagCode) ? 'selected' : ''}>Custom...</option>
                        </select>
                        <input type="text" class="player-flag-custom" placeholder="Code" style="width:50px;padding:2px 4px;border:1px solid var(--color-border);border-radius:4px;display:${KNOWN_FLAGS.includes(flagCode) ? 'none' : 'inline'}"
                            value="${!KNOWN_FLAGS.includes(flagCode) ? flagCode : ''}">
                    </div>
                </td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" class="player-retired-check" data-player="${esc(player)}" ${isRetired ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </td>
            </tr>`;
    }

    container.innerHTML = `
        <h1>Edit: ${esc(p.LeagueTitle || leagueId)}</h1>
        <button class="btn btn-secondary" id="back-to-leagues" style="margin-bottom:var(--space-lg)">&larr; Back to Leagues</button>

        <div class="admin-card">
            <h2>League Settings</h2>
            <div id="edit-msg"></div>
            <div class="form-group">
                <label for="edit-title">League Name</label>
                <input type="text" id="edit-title" value="${esc(p.LeagueTitle || leagueId)}">
            </div>
            <div class="form-group">
                <label for="edit-type">League Type</label>
                <select id="edit-type">
                    <option value="doubling" ${p.LeagueType === 'doubling' ? 'selected' : ''}>Doubling</option>
                    <option value="regular" ${p.LeagueType === 'regular' ? 'selected' : ''}>Regular</option>
                    <option value="ubc" ${p.LeagueType === 'ubc' ? 'selected' : ''}>UBC</option>
                </select>
            </div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-status">Status</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="edit-status" ${running ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <small style="color:var(--color-text-muted)">${running ? 'Running' : 'Completed'}</small>
                </div>
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-hidden">Hidden</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="edit-hidden" ${hidden ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <small style="color:var(--color-text-muted)">${hidden ? 'Hidden from public' : 'Visible'}</small>
                </div>
            </div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:80px">
                    <label for="edit-gold">Gold Count</label>
                    <input type="number" id="edit-gold" value="${goldCount}" min="0" max="20">
                </div>
                <div class="form-group" style="flex:1;min-width:80px">
                    <label for="edit-silver">Silver Count</label>
                    <input type="number" id="edit-silver" value="${silverCount}" min="0" max="20">
                </div>
                <div class="form-group" style="flex:1;min-width:80px">
                    <label for="edit-bronze">Bronze Count</label>
                    <input type="number" id="edit-bronze" value="${bronzeCount}" min="0" max="20">
                </div>
            </div>
            <button class="btn btn-primary" id="save-league-settings">Save Settings</button>
        </div>

        ${players.length > 0 ? `
        <div class="admin-card">
            <h2>Players (${players.length})</h2>
            <div id="players-msg"></div>
            <table class="admin-table">
                <thead>
                    <tr><th>Name</th><th>Flag</th><th>Retired</th></tr>
                </thead>
                <tbody>${playerRows}</tbody>
            </table>
            <div style="margin-top:var(--space-md)">
                <button class="btn btn-primary" id="save-players">Save Player Changes</button>
            </div>
            <div style="margin-top:var(--space-md)">
                <h3 style="font-size:0.95rem;margin-bottom:var(--space-sm)">Upload Custom Flag</h3>
                <div class="form-group">
                    <label>Flag Code + PNG file</label>
                    <div style="display:flex;gap:var(--space-sm);align-items:center">
                        <input type="text" id="upload-flag-code" placeholder="XX" style="width:60px">
                        <input type="file" id="upload-flag-file" accept=".png">
                        <button class="btn btn-secondary btn-sm" id="upload-flag-btn">Upload</button>
                    </div>
                </div>
                <div id="flag-upload-msg"></div>
            </div>
        </div>
        ` : '<div class="admin-card"><p style="color:var(--color-text-muted)">No players yet. Upload a CSV first.</p></div>'}

        <div class="admin-card" id="csv-editor-section">
            <div id="csv-editor-container"></div>
        </div>

        <div class="admin-card">
            <h2>Reports</h2>
            <button class="btn btn-secondary" id="remaining-report-btn">Remaining Matches Report</button>
            <div id="remaining-report-container" style="margin-top:var(--space-md)"></div>
        </div>
    `;

    // CSV editor
    const csvContainer = document.getElementById('csv-editor-container');
    if (csvContainer) {
        renderCsvEditor(csvContainer, leagueId, refreshBadgeFn);
    }

    // Remaining report
    const reportBtn = document.getElementById('remaining-report-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', () => {
            renderRemainingReport(document.getElementById('remaining-report-container'), leagueId);
        });
    }

    // Status toggle label update
    document.getElementById('edit-status').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Running' : 'Completed';
    });

    // Hidden toggle label update
    document.getElementById('edit-hidden').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Hidden from public' : 'Visible';
    });

    // Flag select change — show/hide custom input + preview
    container.querySelectorAll('.player-flag-select').forEach(sel => {
        sel.addEventListener('change', function() {
            const row = this.closest('tr');
            const customInput = row.querySelector('.player-flag-custom');
            const preview = row.querySelector('.flag-preview');
            if (this.value === '__custom') {
                customInput.style.display = 'inline';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
                preview.src = `assets/flags/${this.value}.png`;
                preview.alt = this.value;
            }
        });
    });

    // Back
    document.getElementById('back-to-leagues').addEventListener('click', () => {
        renderLeagueAdmin(container, refreshBadgeFn);
    });

    // Save settings
    document.getElementById('save-league-settings').addEventListener('click', () => {
        const newParams = { ...params };
        newParams.LeagueTitle = document.getElementById('edit-title').value.trim();
        newParams.LeagueType = document.getElementById('edit-type').value;
        newParams.Running = document.getElementById('edit-status').checked;
        newParams.Hidden = document.getElementById('edit-hidden').checked;
        newParams.GoldCount = parseInt(document.getElementById('edit-gold').value) || 1;
        newParams.SilverCount = parseInt(document.getElementById('edit-silver').value) || 1;
        newParams.BronzeCount = parseInt(document.getElementById('edit-bronze').value) || 4;

        // Remove Hidden if false (keep JSON clean)
        if (!newParams.Hidden) delete newParams.Hidden;

        const encoded = encodeURIComponent(leagueId);
        addChange({
            type: 'update',
            path: `leagues/${encoded}/league_params.json`,
            content: JSON.stringify(newParams, null, 2),
            description: `Update settings: ${newParams.LeagueTitle}`
        });

        if (refreshBadgeFn) refreshBadgeFn();
        showMsg('edit-msg', 'Settings staged. Go to Pending Changes to publish.', 'success');
    });

    // Save players
    if (document.getElementById('save-players')) {
        document.getElementById('save-players').addEventListener('click', async () => {
            const newCustomFlags = {};
            const newRetired = [];
            const renames = []; // { from, to }

            // Collect player changes
            container.querySelectorAll('.player-name-input').forEach(input => {
                const original = input.dataset.original;
                const newName = input.value.trim();
                if (newName !== original && newName) {
                    renames.push({ from: original, to: newName });
                }
            });

            container.querySelectorAll('.player-flag-select').forEach(sel => {
                const player = sel.dataset.player;
                // Resolve name after renames
                const rename = renames.find(r => r.from === player);
                const finalName = rename ? rename.to : player;

                let flagCode;
                if (sel.value === '__custom') {
                    const row = sel.closest('tr');
                    flagCode = row.querySelector('.player-flag-custom').value.trim().toUpperCase();
                } else {
                    flagCode = sel.value;
                }

                if (flagCode && flagCode !== 'IL') {
                    newCustomFlags[finalName] = flagCode;
                }
            });

            container.querySelectorAll('.player-retired-check').forEach(chk => {
                if (chk.checked) {
                    const player = chk.dataset.player;
                    const rename = renames.find(r => r.from === player);
                    newRetired.push(rename ? rename.to : player);
                }
            });

            // Update params
            const updatedParams = { ...params };
            updatedParams.CustomFlags = newCustomFlags;
            if (newRetired.length > 0) {
                updatedParams.RetiredPlayers = newRetired;
            } else {
                delete updatedParams.RetiredPlayers;
            }

            const encoded = encodeURIComponent(leagueId);

            addChange({
                type: 'update',
                path: `leagues/${encoded}/league_params.json`,
                content: JSON.stringify(updatedParams, null, 2),
                description: `Update players: ${leagueId}`
            });

            // Handle renames in CSV
            if (renames.length > 0) {
                try {
                    const { matches } = await loadLeagueMatches(leagueId);
                    // Re-read raw CSV to do string-level rename
                    const csvResp = await fetch(`leagues/${encodeURIComponent(leagueId)}/leaguedata.csv`);
                    let csvText = await csvResp.text();

                    for (const { from, to } of renames) {
                        // Replace player name at start of field (column 0 or column 4)
                        csvText = csvText.split('\n').map(line => {
                            const parts = line.split(',');
                            if (parts.length >= 8) {
                                if (parts[0].trim() === from) parts[0] = to;
                                if (parts[4].trim() === from) parts[4] = to;
                            }
                            return parts.join(',');
                        }).join('\n');
                    }

                    addChange({
                        type: 'update',
                        path: `leagues/${encoded}/leaguedata.csv`,
                        content: csvText,
                        description: `Rename players in CSV: ${renames.map(r => `${r.from} → ${r.to}`).join(', ')}`
                    });
                } catch (err) {
                    showMsg('players-msg', `Warning: Could not update CSV for renames: ${err.message}`, 'error');
                }
            }

            if (refreshBadgeFn) refreshBadgeFn();
            showMsg('players-msg', 'Player changes staged.', 'success');
        });
    }

    // Upload custom flag
    if (document.getElementById('upload-flag-btn')) {
        document.getElementById('upload-flag-btn').addEventListener('click', async () => {
            const code = document.getElementById('upload-flag-code').value.trim().toUpperCase();
            const fileInput = document.getElementById('upload-flag-file');

            if (!code || code.length < 2) {
                showMsg('flag-upload-msg', 'Enter a valid flag code (2+ chars).', 'error');
                return;
            }
            if (!fileInput.files || fileInput.files.length === 0) {
                showMsg('flag-upload-msg', 'Select a PNG file.', 'error');
                return;
            }

            const file = fileInput.files[0];
            if (!file.name.endsWith('.png')) {
                showMsg('flag-upload-msg', 'Only PNG files are accepted.', 'error');
                return;
            }

            const buffer = await file.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

            addChange({
                type: 'create',
                path: `assets/flags/${code}.png`,
                content: base64,
                binary: true,
                description: `Upload flag: ${code}.png`
            });

            // Add to known flags for this session
            if (!KNOWN_FLAGS.includes(code)) KNOWN_FLAGS.push(code);

            if (refreshBadgeFn) refreshBadgeFn();
            showMsg('flag-upload-msg', `Flag ${code}.png staged for upload.`, 'success');
        });
    }
}

// ---- Helpers ----

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
}
