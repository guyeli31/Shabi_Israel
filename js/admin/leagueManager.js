/**
 * leagueManager.js — Admin league management: list, create, edit, delete leagues + player editing.
 */

import { loadLeagueOrder, loadLeagueParams, loadLeagueMatches, loadLandingSettings } from '../data/leagueLoader.js';
import { getFile } from './githubApi.js';
import { addChange, getStagedContent } from './stagingStore.js';
import { getAllPlayersFromCSV } from '../data/csvParser.js';
import { renderCsvEditor } from './csvEditor.js';
import { renderRemainingReport } from './remainingReport.js';
import { ensurePlayerIndex } from '../render/navigation.js';

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
            rows += `<tr><td>${esc(lg.id)}</td><td colspan="5" style="color:var(--color-loss)">Failed to load</td></tr>`;
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
                <td data-label="Name">${esc(p.LeagueTitle || lg.id)}${hiddenBadge}</td>
                <td data-label="Type">${esc(p.LeagueType || 'doubling')}</td>
                <td data-label="Issue Date">${p.IssueDate ? formatAdminDate(p.IssueDate) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                <td data-label="Status">${statusPill}</td>
                <td data-label="Actions">
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
                    <tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Issue Date</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
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

async function renderAddLeagueForm(container, displayOrder) {
    // Local state for the new league
    const state = {
        players: [], // [{ name, flag, retired }]
        customFlags: {},
        csvText: null // if set, overrides round-robin generation
    };

    container.innerHTML = `
        <h1>Add New League</h1>
        <button class="btn btn-secondary" id="cancel-new-league" style="margin-bottom:var(--space-lg)">&larr; Back to Leagues</button>
        <div id="add-msg"></div>

        <div class="add-league-grid">
            <div class="admin-card">
                <h2>League Settings</h2>
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
                <div class="add-league-row">
                    <div class="form-group">
                        <label for="new-issue-date">Issue Date</label>
                        <input type="date" id="new-issue-date">
                    </div>
                    <div class="form-group">
                        <label for="new-entry-fee">Entry Fee</label>
                        <input type="number" id="new-entry-fee" value="0" min="0">
                    </div>
                    <div class="form-group">
                        <label for="new-match-length">Match Length</label>
                        <input type="number" id="new-match-length" value="7" min="1" max="25" step="2">
                    </div>
                </div>
            </div>

            <div class="admin-card">
                <h2>Medals & Prizes</h2>
                <div class="add-league-row">
                    <div class="form-group">
                        <label for="new-gold-count">Gold Count</label>
                        <input type="number" id="new-gold-count" value="1" min="0" max="20">
                    </div>
                    <div class="form-group">
                        <label for="new-prize-gold">Prize Gold</label>
                        <input type="number" id="new-prize-gold" value="0" min="0">
                    </div>
                </div>
                <div class="add-league-row">
                    <div class="form-group">
                        <label for="new-silver-count">Silver Count</label>
                        <input type="number" id="new-silver-count" value="1" min="0" max="20">
                    </div>
                    <div class="form-group">
                        <label for="new-prize-silver">Prize Silver</label>
                        <input type="number" id="new-prize-silver" value="0" min="0">
                    </div>
                </div>
                <div class="add-league-row">
                    <div class="form-group">
                        <label for="new-bronze-count">Bronze Count</label>
                        <input type="number" id="new-bronze-count" value="4" min="0" max="20">
                    </div>
                    <div class="form-group">
                        <label for="new-prize-bronze">Prize Bronze</label>
                        <input type="number" id="new-prize-bronze" value="0" min="0">
                    </div>
                </div>
            </div>

            <div class="admin-card full">
                <h2>Players & Data</h2>
                <div class="add-league-row" style="margin-bottom:var(--space-md)">
                    <div class="form-group">
                        <label for="upload-csv">Upload CSV / Excel</label>
                        <div style="display:flex;gap:var(--space-sm);align-items:center">
                            <input type="file" id="upload-csv" accept=".csv,.xlsx">
                            <button class="btn btn-secondary btn-sm" id="upload-csv-btn">Load File</button>
                        </div>
                    </div>
                </div>
                <div class="add-league-row" style="margin-bottom:var(--space-md);align-items:flex-end">
                    <div class="form-group" style="flex:2;position:relative">
                        <label for="manual-player-name">Add Player Manually</label>
                        <input type="text" id="manual-player-name" placeholder="Player name" autocomplete="off">
                        <ul class="player-autocomplete" id="manual-player-autocomplete" hidden></ul>
                    </div>
                    <div class="form-group" style="flex:1">
                        <label for="manual-player-flag">Flag</label>
                        <select id="manual-player-flag">
                            ${KNOWN_FLAGS.map(f => `<option value="${f}" ${f === 'IL' ? 'selected' : ''}>${f}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="flex:0">
                        <button class="btn btn-primary btn-sm" id="add-manual-player-btn">Add</button>
                    </div>
                </div>
                <div style="margin-bottom:var(--space-md)">
                    <h3 style="font-size:0.95rem;margin-bottom:var(--space-sm)">Upload Custom Flag</h3>
                    <div class="form-group">
                        <label>Flag Code + PNG file</label>
                        <div style="display:flex;gap:var(--space-sm);align-items:center">
                            <input type="text" id="new-upload-flag-code" placeholder="XX" style="width:60px">
                            <input type="file" id="new-upload-flag-file" accept=".png">
                            <button class="btn btn-secondary btn-sm" id="new-upload-flag-btn">Upload</button>
                        </div>
                    </div>
                    <div id="new-flag-upload-msg"></div>
                </div>
                <div id="csv-source-msg" style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:var(--space-sm)"></div>
                <table class="admin-table" id="new-players-table">
                    <thead><tr><th scope="col">Name</th><th scope="col">Flag</th><th scope="col">Retired</th><th scope="col"></th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>

        <div style="display:flex;gap:var(--space-sm)">
            <button class="btn btn-success" id="save-new-league">Create League</button>
            <button class="btn btn-secondary" id="cancel-new-league-2">Cancel</button>
        </div>`;

    function rerenderPlayers() {
        const tbody = container.querySelector('#new-players-table tbody');
        if (state.players.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="color:var(--color-text-muted);text-align:center">No players yet</td></tr>';
            return;
        }
        tbody.innerHTML = state.players.map((pl, i) => `
            <tr>
                <td><input type="text" data-pi="${i}" data-field="name" value="${esc(pl.name)}" style="width:160px;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px"></td>
                <td>
                    <select data-pi="${i}" data-field="flag" style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                        ${KNOWN_FLAGS.map(f => `<option value="${f}" ${f === pl.flag ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" data-pi="${i}" data-field="retired" ${pl.retired ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td><button class="btn btn-danger btn-sm" data-remove-pi="${i}">Remove</button></td>
            </tr>`).join('');

        tbody.querySelectorAll('input[data-field],select[data-field]').forEach(el => {
            el.addEventListener('change', () => {
                const i = parseInt(el.dataset.pi);
                const f = el.dataset.field;
                state.players[i][f] = f === 'retired' ? el.checked : el.value;
            });
        });
        tbody.querySelectorAll('[data-remove-pi]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.players.splice(parseInt(btn.dataset.removePi), 1);
                rerenderPlayers();
            });
        });
    }
    rerenderPlayers();

    function setCsvSourceMsg(msg) {
        document.getElementById('csv-source-msg').textContent = msg || '';
    }

    // Cancel
    const cancel = () => renderLeagueAdmin(container, refreshBadgeFn);
    document.getElementById('cancel-new-league').addEventListener('click', cancel);
    document.getElementById('cancel-new-league-2').addEventListener('click', cancel);

    // Manual add
    document.getElementById('add-manual-player-btn').addEventListener('click', () => {
        const name = document.getElementById('manual-player-name').value.trim();
        const flag = document.getElementById('manual-player-flag').value;
        if (!name) return;
        if (state.players.some(p => p.name === name)) {
            showMsg('add-msg', `Player "${name}" already in list.`, 'error');
            return;
        }
        state.players.push({ name, flag, retired: false });
        document.getElementById('manual-player-name').value = '';
        rerenderPlayers();
    });

    // Custom flag upload (create form)
    document.getElementById('new-upload-flag-btn').addEventListener('click', async () => {
        const code = document.getElementById('new-upload-flag-code').value.trim().toUpperCase();
        const fileInput = document.getElementById('new-upload-flag-file');
        if (!code || code.length < 2) {
            showMsg('new-flag-upload-msg', 'Enter a valid flag code (2+ chars).', 'error');
            return;
        }
        if (!fileInput.files || fileInput.files.length === 0) {
            showMsg('new-flag-upload-msg', 'Select a PNG file.', 'error');
            return;
        }
        const file = fileInput.files[0];
        if (!file.name.toLowerCase().endsWith('.png')) {
            showMsg('new-flag-upload-msg', 'Only PNG files are accepted.', 'error');
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
        if (!KNOWN_FLAGS.includes(code)) KNOWN_FLAGS.push(code);
        if (refreshBadgeFn) refreshBadgeFn();
        showMsg('new-flag-upload-msg', `Flag ${code}.png staged for upload.`, 'success');
        rerenderPlayers();
    });

    // Smart autocomplete for manual player input
    let _acPlayerNames = null;
    const acInput = document.getElementById('manual-player-name');
    const acList = document.getElementById('manual-player-autocomplete');

    acInput.addEventListener('input', async () => {
        const q = acInput.value.trim().toLowerCase();
        if (q.length < 2) { acList.hidden = true; return; }

        if (!_acPlayerNames) {
            try {
                const index = await ensurePlayerIndex();
                _acPlayerNames = [...index.keys()].sort();
            } catch { _acPlayerNames = []; }
        }

        const existing = new Set(state.players.map(p => p.name));
        const matches = _acPlayerNames
            .filter(n => n.toLowerCase().includes(q) && !existing.has(n))
            .slice(0, 10);

        if (matches.length === 0) { acList.hidden = true; return; }

        acList.innerHTML = matches.map(n => `<li data-name="${esc(n)}">${esc(n)}</li>`).join('');
        acList.hidden = false;
    });

    acList.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-name]');
        if (!li) return;
        acInput.value = li.dataset.name;
        acList.hidden = true;
        acInput.focus();
    });

    document.addEventListener('click', (e) => {
        if (!acInput.contains(e.target) && !acList.contains(e.target)) {
            acList.hidden = true;
        }
    });

    // Upload CSV / Excel
    document.getElementById('upload-csv-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('upload-csv');
        if (!fileInput.files || fileInput.files.length === 0) {
            showMsg('add-msg', 'Select a CSV or Excel file first.', 'error');
            return;
        }
        const file = fileInput.files[0];
        try {
            let csvText;
            if (file.name.toLowerCase().endsWith('.csv')) {
                csvText = await file.text();
            } else if (file.name.toLowerCase().endsWith('.xlsx')) {
                if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded.');
                const buffer = await file.arrayBuffer();
                const wb = XLSX.read(buffer, { type: 'array' });
                csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
            } else {
                showMsg('add-msg', 'Unsupported file. Use .csv or .xlsx', 'error');
                return;
            }

            state.csvText = csvText;
            const playerSet = getAllPlayersFromCSV(csvText);
            const names = [...playerSet].sort();
            state.players = names.map(n => ({ name: n, flag: 'IL', retired: false }));
            rerenderPlayers();
            setCsvSourceMsg(`Loaded CSV with ${names.length} players. The uploaded file will be used as leaguedata.csv.`);
            showMsg('add-msg', `CSV loaded with ${names.length} players.`, 'success');
        } catch (err) {
            showMsg('add-msg', `Load failed: ${err.message}`, 'error');
        }
    });

    // Save
    document.getElementById('save-new-league').addEventListener('click', async () => {
        const name = document.getElementById('new-league-name').value.trim();
        const type = document.getElementById('new-league-type').value;

        if (!name) {
            showMsg('add-msg', 'Please enter a league name.', 'error');
            return;
        }

        const options = {
            issueDate: document.getElementById('new-issue-date').value || null,
            entryFee: parseInt(document.getElementById('new-entry-fee').value) || 0,
            matchLength: parseInt(document.getElementById('new-match-length').value) || 7,
            goldCount: parseInt(document.getElementById('new-gold-count').value) || 1,
            silverCount: parseInt(document.getElementById('new-silver-count').value) || 1,
            bronzeCount: parseInt(document.getElementById('new-bronze-count').value) || 4,
            prizes: {
                Gold: parseInt(document.getElementById('new-prize-gold').value) || 0,
                Silver: parseInt(document.getElementById('new-prize-silver').value) || 0,
                Bronze: parseInt(document.getElementById('new-prize-bronze').value) || 0
            },
            players: state.players,
            csvText: state.csvText
        };

        await stageAddLeague(name, type, displayOrder, options);
        showMsg('add-msg', `League "${name}" staged. Go to Pending Changes to publish.`, 'success');
        setTimeout(() => renderLeagueAdmin(container, refreshBadgeFn), 1200);
    });
}

/**
 * Generate a round-robin CSV (header + empty match rows) from a player list.
 */
function generateRoundRobinCSV(players) {
    const header = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B\n';
    const rows = [];
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            rows.push(`${players[i]},,,,${players[j]},,,,`);
        }
    }
    return header + rows.join('\n') + (rows.length > 0 ? '\n' : '');
}

async function stageAddLeague(name, type, displayOrder, options = {}) {
    // Folder name: title without dash
    const folderName = name.replace(' - ', ' ');
    const encoded = encodeURIComponent(folderName);

    const players = options.players || [];
    const customFlags = {};
    const retiredPlayers = [];
    for (const pl of players) {
        if (pl.flag && pl.flag !== 'IL') customFlags[pl.name] = pl.flag;
        if (pl.retired) retiredPlayers.push(pl.name);
    }

    // league_params.json
    const params = {
        LeagueTitle: name,
        LeagueType: type,
        GoldCount: options.goldCount ?? 1,
        SilverCount: options.silverCount ?? 1,
        BronzeCount: options.bronzeCount ?? 4,
        Running: true,
        StartDate: new Date().toISOString(),
        CustomFlags: customFlags
    };
    if (options.issueDate) params.IssueDate = options.issueDate;
    if (options.entryFee) params.EntryFee = options.entryFee;
    if (options.matchLength) params.MatchLength = options.matchLength;
    if (options.prizes && (options.prizes.Gold || options.prizes.Silver || options.prizes.Bronze)) {
        params.Prizes = options.prizes;
    }
    if (retiredPlayers.length > 0) params.RetiredPlayers = retiredPlayers;

    addChange({
        type: 'create',
        path: `leagues/${encoded}/league_params.json`,
        content: JSON.stringify(params, null, 2),
        description: `Create league: ${name}`
    });

    // CSV: uploaded text wins; otherwise round-robin from players; otherwise header only
    let csvContent;
    if (options.csvText) {
        csvContent = options.csvText;
    } else if (players.length > 1) {
        csvContent = generateRoundRobinCSV(players.map(p => p.name));
    } else {
        csvContent = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B\n';
    }
    addChange({
        type: 'create',
        path: `leagues/${encoded}/leaguedata.csv`,
        content: csvContent,
        description: `Create CSV for: ${name}`
    });

    // Update leagues_order.json + landing_settings.json
    const newOrder = [name, ...displayOrder];
    addChange({
        type: 'update',
        path: 'leagues/leagues_order.json',
        content: JSON.stringify({ DisplayOrder: newOrder }, null, 2),
        description: `Add "${name}" to league order`
    });

    // Keep landing_settings.json in sync
    try {
        const settings = await loadLandingSettings();
        settings.displayOrder = newOrder;
        addChange({
            type: 'update',
            path: 'leagues/landing_settings.json',
            content: JSON.stringify({
                title: settings.title,
                subtitle: settings.subtitle,
                logoPath: settings.logoPath,
                DisplayOrder: settings.displayOrder
            }, null, 2),
            description: `Add "${name}" to landing settings`
        });
    } catch { /* landing_settings.json may not exist yet */ }

    if (refreshBadgeFn) refreshBadgeFn();
}

async function stageDeleteLeague(leagueId, title, displayOrder) {
    const encoded = encodeURIComponent(leagueId);
    const groupId = `delete-${leagueId}`;
    const groupDescription = `Delete league: ${title}`;

    addChange({
        type: 'delete',
        path: `leagues/${encoded}/league_params.json`,
        content: null,
        description: `Delete league params: ${leagueId}`,
        group: groupId,
        groupDescription
    });

    addChange({
        type: 'delete',
        path: `leagues/${encoded}/leaguedata.csv`,
        content: null,
        description: `Delete league CSV: ${leagueId}`,
        group: groupId,
        groupDescription
    });

    // Update order
    const newOrder = displayOrder.filter(t => t !== title);
    addChange({
        type: 'update',
        path: 'leagues/leagues_order.json',
        content: JSON.stringify({ DisplayOrder: newOrder }, null, 2),
        description: `Remove "${title}" from league order`,
        group: groupId,
        groupDescription
    });

    // Keep landing_settings.json in sync
    try {
        const settings = await loadLandingSettings();
        settings.displayOrder = newOrder;
        addChange({
            type: 'update',
            path: 'leagues/landing_settings.json',
            content: JSON.stringify({
                title: settings.title,
                subtitle: settings.subtitle,
                logoPath: settings.logoPath,
                DisplayOrder: settings.displayOrder
            }, null, 2),
            description: `Remove "${title}" from landing settings`,
            group: groupId,
            groupDescription
        });
    } catch { /* landing_settings.json may not exist yet */ }

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
    const issueDate = p.IssueDate ? String(p.IssueDate).slice(0, 10) : '';
    const entryFee = p.EntryFee ?? 0;
    const prizes = p.Prizes || { Gold: 0, Silver: 0, Bronze: 0 };

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
                <td><button class="btn btn-danger btn-sm player-remove-btn" data-remove-player="${esc(player)}" title="Remove player">&#10005;</button></td>
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
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:140px">
                    <label for="edit-issue-date">Issue Date</label>
                    <input type="date" id="edit-issue-date" value="${issueDate}">
                </div>
                <div class="form-group" style="flex:1;min-width:120px">
                    <label for="edit-entry-fee">Entry Fee</label>
                    <input type="number" id="edit-entry-fee" value="${entryFee}" min="0" step="1">
                </div>
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-match-length">Match Length</label>
                    <input type="number" id="edit-match-length" value="${p.MatchLength || 7}" min="1" max="25" step="2">
                </div>
            </div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:90px">
                    <label for="edit-prize-gold">Prize Gold</label>
                    <input type="number" id="edit-prize-gold" value="${prizes.Gold || 0}" min="0" step="1">
                </div>
                <div class="form-group" style="flex:1;min-width:90px">
                    <label for="edit-prize-silver">Prize Silver</label>
                    <input type="number" id="edit-prize-silver" value="${prizes.Silver || 0}" min="0" step="1">
                </div>
                <div class="form-group" style="flex:1;min-width:90px">
                    <label for="edit-prize-bronze">Prize Bronze</label>
                    <input type="number" id="edit-prize-bronze" value="${prizes.Bronze || 0}" min="0" step="1">
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
                    <tr><th scope="col">Name</th><th scope="col">Flag</th><th scope="col">Retired</th><th scope="col"></th></tr>
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
        const encoded = encodeURIComponent(leagueId);
        const stagedJson = getStagedContent(`leagues/${encoded}/league_params.json`);
        const baseParams = stagedJson ? JSON.parse(stagedJson) : params;
        const newParams = { ...baseParams };
        newParams.LeagueTitle = document.getElementById('edit-title').value.trim();
        newParams.LeagueType = document.getElementById('edit-type').value;
        newParams.Running = document.getElementById('edit-status').checked;
        newParams.Hidden = document.getElementById('edit-hidden').checked;
        newParams.GoldCount = parseInt(document.getElementById('edit-gold').value) || 1;
        newParams.SilverCount = parseInt(document.getElementById('edit-silver').value) || 1;
        newParams.BronzeCount = parseInt(document.getElementById('edit-bronze').value) || 4;
        const issueDateVal = document.getElementById('edit-issue-date').value;
        if (issueDateVal) newParams.IssueDate = issueDateVal;
        else delete newParams.IssueDate;
        newParams.EntryFee = parseInt(document.getElementById('edit-entry-fee').value) || 0;
        newParams.MatchLength = parseInt(document.getElementById('edit-match-length').value) || 7;
        newParams.Prizes = {
            Gold: parseInt(document.getElementById('edit-prize-gold').value) || 0,
            Silver: parseInt(document.getElementById('edit-prize-silver').value) || 0,
            Bronze: parseInt(document.getElementById('edit-prize-bronze').value) || 0
        };

        // Remove Hidden if false (keep JSON clean)
        if (!newParams.Hidden) delete newParams.Hidden;

        addChange({
            type: 'update',
            path: `leagues/${encoded}/league_params.json`,
            content: JSON.stringify(newParams, null, 2),
            description: `Update settings: ${newParams.LeagueTitle}`
        });

        if (refreshBadgeFn) refreshBadgeFn();
        showMsg('edit-msg', 'Settings staged. Go to Pending Changes to publish.', 'success');
    });

    // Remove player buttons
    const removedPlayers = new Set();
    container.querySelectorAll('.player-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const player = btn.dataset.removePlayer;
            if (!confirm(`Remove "${player}" from this league? CSV match data will remain.`)) return;
            removedPlayers.add(player);
            const row = btn.closest('tr');
            if (row) row.remove();
            showMsg('players-msg', `"${player}" marked for removal. Click "Save Player Changes" to apply.`, 'success');
        });
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

            // Update params — use staged version as base if it exists
            const paramsPath = `leagues/${encodeURIComponent(leagueId)}/league_params.json`;
            const stagedPlayerJson = getStagedContent(paramsPath);
            const playerBaseParams = stagedPlayerJson ? JSON.parse(stagedPlayerJson) : params;
            const updatedParams = { ...playerBaseParams };
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

function formatAdminDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
}
