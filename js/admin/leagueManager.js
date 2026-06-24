/**
 * leagueManager.js — Admin league management: list, create, edit, delete leagues + player editing.
 */

import { loadLeagueOrder, loadLeagueParams, loadLeagueMatches, loadLandingSettings } from '../data/leagueLoader.js';
import { getFile } from './githubApi.js';
import { addChange, getStagedContent } from './stagingStore.js';
import { getAllPlayersFromCSV } from '../data/csvParser.js';
import { renderRoundEditor } from './roundEditor.js';
import { renderExcelImporter } from './excelImporter.js';
import { renderOverridesList } from './overridesList.js';
import { ensurePlayerIndex } from '../render/navigation.js';
import { thLabel } from '../utils/helpers.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { revealMsg } from './msgScroll.js';
import { wireSectionCollapse } from '../render/sectionCollapse.js';
import { mountAccordionTabs } from '../render/subTabs.js';
import { filePickerHTML } from './render/formControls.js';

// Known flag codes (from assets/flags/)
const KNOWN_FLAGS = ['BE', 'IL', 'RU', 'TZ', 'UN'];
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

let refreshBadgeFn = null;

/**
 * Convert any image file (jpg, png, gif, webp, heic, etc.) to a PNG base64 string.
 * Uses Canvas to re-encode. HEIC works only where the browser can natively decode it
 * (iOS 17+ Safari, recent Chrome on macOS) — falls back to a friendly error otherwise.
 */
async function fileToPngBase64(file) {
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('decode-failed'));
            im.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode-failed')), 'image/png');
        });
        const buffer = await blob.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    } finally {
        URL.revokeObjectURL(url);
    }
}

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
        const hiddenBadge = hidden ? ' <span style="color:var(--color-text-muted);font-size:0.8em">(Hidden)</span>' : '';

        rows += `
            <tr>
                <td>${esc(p.LeagueTitle || lg.id)}${hiddenBadge}</td>
                <td><span class="league-type-pill type-${esc(p.LeagueType || 'doubling')}">${esc(LEAGUE_TYPE_LABELS[p.LeagueType] || LEAGUE_TYPE_LABELS.doubling)}</span></td>
                <td>${p.IssueDate ? formatAdminDate(p.IssueDate) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
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
        <div class="ff-wrap">
            <table class="admin-table font-large" data-mf-table-id="F1">
                <thead>
                    <tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    attachStickyShadow(container.querySelector('.ff-wrap'));

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
        <button class="btn btn-primary btn-back" id="cancel-new-league" style="margin-bottom:var(--space-lg)">&lsaquo; Back to Leagues</button>
        <div id="add-msg"></div>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">League Settings</h2>
            <div class="collapsible-body">
            <div class="admin-card edit-card-sm">
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
                        <input type="date" id="new-issue-date" class="themed-date">
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
                <div class="form-group">
                    <label>Medals &amp; Prizes</label>
                    ${ffMedalsTableHTML([
                        { medal: 'Gold',   icon: '&#x1F947;', cls: 'medal-gold',   count: 1, countId: 'new-gold-count',   prize: 0, prizeId: 'new-prize-gold' },
                        { medal: 'Silver', icon: '&#x1F948;', cls: 'medal-silver', count: 1, countId: 'new-silver-count', prize: 0, prizeId: 'new-prize-silver' },
                        { medal: 'Bronze', icon: '&#x1F949;', cls: 'medal-bronze', count: 4, countId: 'new-bronze-count', prize: 0, prizeId: 'new-prize-bronze' },
                    ])}
                </div>
            </div>
            </div>
          </div>
        </div>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Players & Data</h2>
            <div class="collapsible-body">
            <div class="admin-card">
                <h3 class="admin-subhead">Players</h3>

                <div class="form-group">
                    <label for="manual-player-name">Add a player</label>
                    <div class="input-action-row">
                        <div class="ac-field">
                            <input type="text" id="manual-player-name" placeholder="Pick an existing player or type a new name…" autocomplete="off">
                            <ul class="player-autocomplete" id="manual-player-autocomplete" hidden></ul>
                        </div>
                        <button class="btn btn-primary btn-sm" id="add-manual-player-btn">Add</button>
                    </div>
                    <small class="form-hint">Existing players autocomplete; a new name is registered when the league is created.</small>
                </div>

                <div class="form-group">
                    <label for="upload-csv">Or import a roster (CSV / Excel)</label>
                    <div class="input-action-row">
                        ${filePickerHTML('upload-csv', { label: 'Choose File', accept: '.csv,.xlsx' })}
                        <button class="btn btn-secondary btn-sm" id="upload-csv-btn">Load File</button>
                    </div>
                    <small class="form-hint">Bulk-add players from a file instead of typing them one by one.</small>
                </div>

                <div id="csv-source-msg" class="form-hint" style="margin-bottom:var(--space-sm)"></div>

                <div id="f2b-mount"></div>

                ${uploadFlagPanelHTML()}
            </div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:var(--space-sm)">
            <button class="btn btn-success" id="save-new-league">Create League</button>
            <button class="btn btn-secondary" id="cancel-new-league-2">Cancel</button>
        </div>`;

    // F6 (Medals & Prizes) sticky-shadow — the F2b players wrap attaches itself in
    // rerenderPlayers(); here we cover the static F6 wrap rendered in the template.
    const medalsWrap = container.querySelector('[data-mf-table-id="F6"]')?.closest('.ff-wrap');
    if (medalsWrap) attachStickyShadow(medalsWrap);

    // F2b — the Add-League players table. Identical FF format to F2 (Edit League)
    // via the shared ffPlayersTableHTML builder; data lives in state.players and
    // rows are keyed by their position in the table.
    function rerenderPlayers() {
        const mount = container.querySelector('#f2b-mount');
        const rows = state.players.map(pl => ({ name: pl.name, flagCode: pl.flag || 'IL', isRetired: !!pl.retired }));
        mount.innerHTML = ffPlayersTableHTML('F2b', rows, 'No players yet');
        attachStickyShadow(mount.querySelector('.ff-wrap'));

        if (state.players.length === 0) return;

        const tbody = mount.querySelector('tbody');
        const rowIndex = el => [...tbody.rows].indexOf(el.closest('tr'));

        // Shared flag preview / custom-code toggle (same handler as F2).
        wireFlagSelectPreview(mount);

        // Name edits → state.players (by row position)
        tbody.querySelectorAll('.player-name-input').forEach(input => {
            input.addEventListener('change', () => {
                const i = rowIndex(input);
                if (state.players[i]) state.players[i].name = input.value.trim();
            });
        });

        // Flag <select> + custom-code input → state.players
        tbody.querySelectorAll('.player-flag-select').forEach(sel => {
            const custom = sel.closest('tr').querySelector('.player-flag-custom');
            const syncFlag = () => {
                const i = rowIndex(sel);
                if (!state.players[i]) return;
                const code = sel.value === '__custom' ? (custom?.value.trim().toUpperCase() || '') : sel.value;
                if (code) state.players[i].flag = code;
            };
            sel.addEventListener('change', syncFlag);
            if (custom) custom.addEventListener('input', syncFlag);
        });

        // Retired toggle → state.players
        tbody.querySelectorAll('.player-retired-check').forEach(chk => {
            chk.addEventListener('change', () => {
                const i = rowIndex(chk);
                if (state.players[i]) state.players[i].retired = chk.checked;
            });
        });

        // Remove ✕ → splice + re-render
        tbody.querySelectorAll('.player-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = rowIndex(btn);
                if (i < 0) return;
                state.players.splice(i, 1);
                rerenderPlayers();
            });
        });
    }
    rerenderPlayers();

    // Upload Custom Flag panel (shared with F2 in Edit League) — stages the PNG +
    // registers the code so it appears in every F2b flag dropdown.
    wireUploadFlagPanel();

    // Collapsible section headers — shared mechanism (css/sections.css +
    // sectionCollapse.js), identical to landing / dashboard / player pages.
    // All sections open by default.
    container.querySelectorAll('.app-section').forEach(s => wireSectionCollapse(s, { defaultOpen: true }));

    function setCsvSourceMsg(msg) {
        document.getElementById('csv-source-msg').textContent = msg || '';
    }

    // Custom file input labels
    container.querySelectorAll('.custom-file-input input[type="file"]').forEach(inp => {
        inp.addEventListener('change', () => {
            const span = inp.parentElement.querySelector('.file-name');
            if (span) span.textContent = inp.files.length ? inp.files[0].name : 'No file chosen';
        });
    });

    // Cancel
    const cancel = () => renderLeagueAdmin(container, refreshBadgeFn);
    document.getElementById('cancel-new-league').addEventListener('click', cancel);
    document.getElementById('cancel-new-league-2').addEventListener('click', cancel);

    // Manual add — existing registry player OR a brand-new name. New names are
    // registered in players_metadata.json when the league is created (stageAddLeague).
    document.getElementById('add-manual-player-btn').addEventListener('click', async () => {
        const name = document.getElementById('manual-player-name').value.trim();
        if (!name) return;
        if (state.players.some(p => p.name === name)) {
            showMsg('add-msg', `Player "${name}" already in list.`, 'error');
            return;
        }
        await ensureAcData();
        const inRegistry = _acPlayerNames.includes(name);
        // Existing players inherit their default flag; new players default to IL.
        let flag = 'IL';
        if (inRegistry) {
            try {
                const { loadPlayersMetadata } = await import('../data/playersMetadata.js');
                const meta = await loadPlayersMetadata();
                if (meta[name]?.defaultFlag) flag = meta[name].defaultFlag;
                // Staged metadata takes precedence
                const stagedRaw = getStagedContent('leagues/players_metadata.json');
                if (stagedRaw) {
                    const stagedMeta = JSON.parse(stagedRaw);
                    if (stagedMeta[name]?.defaultFlag) flag = stagedMeta[name].defaultFlag;
                }
            } catch { /* fallback to IL */ }
        }
        state.players.push({ name, flag, retired: false, isNew: !inRegistry });
        document.getElementById('manual-player-name').value = '';
        document.getElementById('manual-player-autocomplete').hidden = true;
        showMsg('add-msg', inRegistry ? '' : `New player "${name}" added — it will be registered when you create the league.`,
            inRegistry ? '' : 'success');
        rerenderPlayers();
    });

    // Smart autocomplete for manual player input
    let _acPlayerNames = null;
    let _acPlayerMeta = null; // nickname → fullName (for full-name search)
    const acInput = document.getElementById('manual-player-name');
    const acList = document.getElementById('manual-player-autocomplete');

    async function ensureAcData() {
        if (_acPlayerNames) return;
        try {
            const [index, { loadPlayersMetadata }] = await Promise.all([
                ensurePlayerIndex(),
                import('../data/playersMetadata.js')
            ]);
            const meta = await loadPlayersMetadata();
            const names = new Set([...index.keys()]);
            const fullNames = {};
            for (const [n, m] of Object.entries(meta)) {
                if (m && m.inactive) names.add(n);
                if (m?.fullName) fullNames[n] = m.fullName;
            }
            const stagedRaw = getStagedContent('leagues/players_metadata.json');
            if (stagedRaw) {
                try {
                    const stagedMeta = JSON.parse(stagedRaw);
                    for (const [n, m] of Object.entries(stagedMeta)) {
                        if (m && m.inactive) names.add(n);
                        if (m?.fullName) fullNames[n] = m.fullName;
                    }
                } catch { /* ignore parse errors */ }
            }
            _acPlayerNames = [...names].sort();
            _acPlayerMeta = fullNames;
        } catch { _acPlayerNames = []; _acPlayerMeta = {}; }
    }

    acInput.addEventListener('input', async () => {
        const q = acInput.value.trim().toLowerCase();
        if (q.length < 1) { acList.hidden = true; return; }

        await ensureAcData();

        const existing = new Set(state.players.map(p => p.name));
        const matches = _acPlayerNames
            .filter(n => {
                if (existing.has(n)) return false;
                const fl = (_acPlayerMeta?.[n] || '').toLowerCase();
                return n.toLowerCase().includes(q) || fl.includes(q);
            })
            .slice(0, 10);

        if (matches.length === 0) { acList.hidden = true; return; }

        acList.innerHTML = matches.map(n => {
            const fn = _acPlayerMeta?.[n];
            const label = fn ? `${esc(n)} <span class="ac-hint">(${esc(fn)})</span>` : esc(n);
            return `<li data-name="${esc(n)}">${label}</li>`;
        }).join('');
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
 * Generate a round-robin CSV using the circle method with a random initial shuffle.
 * Each player plays every other exactly once. Rounds are separated by repeated
 * header rows (as expected by parseCSVWithRounds).
 * For N players: N-1 rounds (even) or N rounds with one bye skipped (odd).
 */
function generateRoundRobinCSV(playerNames) {
    const header = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B';
    const players = [...playerNames].sort(() => Math.random() - 0.5);
    if (players.length % 2 !== 0) players.push('Bye');
    const n = players.length;
    const lines = [];

    for (let round = 0; round < n - 1; round++) {
        const roundLines = [];
        for (let i = 0; i < n / 2; i++) {
            const a = players[i];
            const b = players[n - 1 - i];
            if (a !== 'Bye' && b !== 'Bye') {
                roundLines.push(`${a},,,,${b},,,,`);
            }
        }
        if (roundLines.length > 0) {
            lines.push(header);
            lines.push(...roundLines);
        }
        // Rotate all except the fixed first player
        players.splice(1, 0, players.pop());
    }

    return lines.join('\n') + '\n';
}

async function stageAddLeague(name, type, displayOrder, options = {}) {
    // Folder name: title without dash
    const folderName = name.replace(' - ', ' ');
    const encoded = encodeURIComponent(folderName);

    // All files that make up a brand-new league are staged under a single group
    // so Pending Changes shows (and the badge counts) the whole creation as ONE item.
    const groupId = `add-${folderName}`;
    const groupDescription = `Create league: ${name}`;

    const players = options.players || [];
    const customFlags = {};
    const retiredPlayers = [];
    for (const pl of players) {
        if (pl.flag && pl.flag !== 'IL') customFlags[pl.name] = pl.flag;
        if (pl.retired) retiredPlayers.push(pl.name);
        // Stage uploaded custom flag PNG
        if (pl.flagData && pl.flag) {
            addChange({
                type: 'create',
                path: `assets/flags/${pl.flag}.png`,
                content: pl.flagData,
                binary: true,
                description: `Upload flag: ${pl.flag}.png`,
                group: groupId,
                groupDescription
            });
        }
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
        description: `Create league: ${name}`,
        category: 'create-league',
        subject: name,
        group: groupId,
        groupDescription
    });

    // CSV: uploaded text wins; otherwise round-robin from players; otherwise header only
    let csvContent;
    if (options.csvText) {
        csvContent = options.csvText;
    } else if (players.length > 1) {
        csvContent = generateRoundRobinCSV(players.map(p => p.name));
        params.ManualEntry = true;
    } else {
        csvContent = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B\n';
    }
    addChange({
        type: 'create',
        path: `leagues/${encoded}/leaguedata.csv`,
        content: csvContent,
        description: `Create CSV for: ${name}`,
        group: groupId,
        groupDescription
    });

    // Register brand-new players into the registry (players_metadata.json) so they
    // enter the "DB" when this league is published — and so the future backend can
    // parse them as known players. Existing players already have records and are
    // left untouched. Build on any already-staged metadata so prior edits survive.
    try {
        const { loadPlayersMetadata } = await import('../data/playersMetadata.js');
        let metadata = {};
        const stagedMeta = getStagedContent('leagues/players_metadata.json');
        if (stagedMeta) {
            try { metadata = JSON.parse(stagedMeta); } catch { metadata = {}; }
        } else {
            try { metadata = await loadPlayersMetadata(); } catch { metadata = {}; }
        }
        const known = new Set(Object.keys(metadata));
        try {
            const index = await ensurePlayerIndex();
            for (const n of index.keys()) known.add(n);
        } catch { /* player index is optional here */ }

        const updated = { ...metadata };
        const added = [];
        for (const pl of players) {
            if (!pl.name || known.has(pl.name)) continue;
            const entry = {};
            if (pl.flag && pl.flag !== 'IL') entry.defaultFlag = pl.flag;
            updated[pl.name] = entry;
            known.add(pl.name);
            added.push(pl.name);
        }
        if (added.length > 0) {
            addChange({
                type: 'update',
                path: 'leagues/players_metadata.json',
                content: JSON.stringify(updated, null, 2),
                description: `Register new players: ${added.join(', ')}`,
                group: groupId,
                groupDescription
            });
        }
    } catch { /* best-effort registry registration — never block league creation */ }

    // Update landing_settings.json
    const newOrder = [name, ...displayOrder];
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
        description: `Add "${name}" to landing settings`,
        group: groupId,
        groupDescription
    });

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
        category: 'delete-league',
        subject: title,
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

    // Update order in landing_settings.json
    const newOrder = displayOrder.filter(t => t !== title);
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

    if (refreshBadgeFn) refreshBadgeFn();
}

// ---- Edit League ----

async function renderEditLeague(container, leagueId, displayOrder) {
    container.innerHTML = '<h1>Edit League</h1><div class="loading">Loading...</div>';

    try {
        let params = await loadLeagueParams(leagueId);
        // Prefer staged (unpublished) params so edits survive a page refresh
        // before they are published via Pending Changes.
        const stagedParams = getStagedContent(`leagues/${encodeURIComponent(leagueId)}/league_params.json`);
        if (stagedParams) {
            try { params = JSON.parse(stagedParams); } catch { /* fall back to file version */ }
        }
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

/**
 * Keep a Save button dormant until something inside `scope` actually changes from
 * its loaded state, then re-enable — mirroring the Round/CSV editors, where Save
 * stays disabled until there's a pending edit. Returns a controller:
 *   - markDirty(): force the dirty state (e.g. a row removed, not an input event)
 *   - markClean(): re-snapshot the current values as the new baseline and disable
 *     (call after a successful save so a fresh edit is needed to re-enable).
 */
function wireDirtySave(scope, saveBtn) {
    if (!scope || !saveBtn) return { markDirty() {}, markClean() {} };
    const snapshot = () => Array.from(scope.querySelectorAll('input, select, textarea'))
        .map(c => (c.type === 'checkbox' || c.type === 'radio') ? (c.checked ? '1' : '0') : c.value)
        .join('');
    let baseline = snapshot();
    let forcedDirty = false;
    const refresh = () => {
        const dirty = forcedDirty || snapshot() !== baseline;
        saveBtn.disabled = !dirty;
        saveBtn.classList.toggle('btn-save-ready', dirty);
    };
    scope.addEventListener('input', refresh);
    scope.addEventListener('change', refresh);
    saveBtn.disabled = true;
    saveBtn.classList.remove('btn-save-ready');
    return {
        markDirty() { forcedDirty = true; refresh(); },
        markClean() { forcedDirty = false; baseline = snapshot(); refresh(); }
    };
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

    // BGStudio automatic-sync settings (stored under p.BGStudioSync in league_params.json).
    const bgSync = p.BGStudioSync || {};
    const bgEnabled = bgSync.enabled === true;
    // Default BGStudio league name = LeagueTitle trimmed at " - " (e.g. "Shabi Israel - June 2026" → "Shabi Israel").
    const bgDefaultName = String(p.LeagueTitle || leagueId).split(' - ')[0].trim();
    const bgName = bgSync.bgstudioLeagueName || bgDefaultName;
    const bgTimes = Array.isArray(bgSync.times) ? bgSync.times.slice() : [];
    const bgStartDate = bgSync.startDate ? String(bgSync.startDate).slice(0, 10) : '';
    const bgEndDate = bgSync.endDate ? String(bgSync.endDate).slice(0, 10) : '';

    // F2 players-table rows (shared builder — see ffPlayersTableHTML).
    const editPlayerRows = players.map(name => ({
        name,
        flagCode: customFlags[name] || 'IL',
        isRetired: retiredPlayers.includes(name)
    }));

    container.innerHTML = `
        <h1>Edit: ${esc(p.LeagueTitle || leagueId)}</h1>
        <button class="btn btn-primary btn-back" id="back-to-leagues" style="margin-bottom:var(--space-lg)">&lsaquo; Back to Leagues</button>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">League Settings</h2>
            <div class="collapsible-body">
            <div class="admin-card edit-card-sm">
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
            <div class="form-group">
                <label>Medals &amp; Prizes</label>
                ${ffMedalsTableHTML([
                    { medal: 'Gold',   icon: '&#x1F947;', cls: 'medal-gold',   count: goldCount,   countId: 'edit-gold',   prize: prizes.Gold   || 0, prizeId: 'edit-prize-gold' },
                    { medal: 'Silver', icon: '&#x1F948;', cls: 'medal-silver', count: silverCount, countId: 'edit-silver', prize: prizes.Silver || 0, prizeId: 'edit-prize-silver' },
                    { medal: 'Bronze', icon: '&#x1F949;', cls: 'medal-bronze', count: bronzeCount, countId: 'edit-bronze', prize: prizes.Bronze || 0, prizeId: 'edit-prize-bronze' },
                ])}
            </div>
            <div class="add-league-row">
                <div class="form-group">
                    <label for="edit-issue-date">Issue Date</label>
                    <input type="date" id="edit-issue-date" class="themed-date" value="${issueDate}">
                </div>
                <div class="form-group">
                    <label for="edit-entry-fee">Entry Fee</label>
                    <input type="number" id="edit-entry-fee" value="${entryFee}" min="0" step="1">
                </div>
                <div class="form-group">
                    <label for="edit-match-length">Match Length</label>
                    <input type="number" id="edit-match-length" value="${p.MatchLength || 7}" min="1" max="25" step="2">
                </div>
            </div>
            <button class="btn btn-primary" id="save-league-settings">Save Settings</button>
            </div>
            </div>
          </div>
        </div>

        ${players.length > 0 ? `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Players (${players.length})</h2>
            <div class="collapsible-body">
            <div class="admin-card">
            <div id="players-msg"></div>
            ${ffPlayersTableHTML('F2', editPlayerRows)}
            <div style="margin-top:var(--space-md)">
                <button class="btn btn-primary" id="save-players">Save Player Changes</button>
            </div>
            ${uploadFlagPanelHTML()}
            </div>
            </div>
          </div>
        </div>
        ` : '<div class="admin-card"><p style="color:var(--color-text-muted)">No players yet. Upload a CSV first.</p></div>'}

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Automatic Sync</h2>
            <div class="collapsible-body">
            <div class="admin-card edit-card-sm">
                <h3 style="margin-bottom:var(--space-md)">Auto-Sync</h3>
                <div id="bgsync-msg"></div>

                <div class="form-group">
                    <label for="bgsync-enabled">Enabled</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="bgsync-enabled" ${bgEnabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="form-group">
                    <label for="bgsync-league-name">Source League Name</label>
                    <input type="text" id="bgsync-league-name" placeholder="${esc(bgDefaultName)}" value="${esc(bgName)}">
                    <small style="color:var(--color-text-muted)">
                        The exact league name as shown on the data source
                    </small>
                </div>

                <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                    <div class="form-group" style="flex:1;min-width:140px">
                        <label for="bgsync-start-date">Start Date</label>
                        <input type="date" id="bgsync-start-date" class="themed-date" value="${bgStartDate}">
                    </div>
                    <div class="form-group" style="flex:1;min-width:140px">
                        <label for="bgsync-end-date">End Date</label>
                        <input type="date" id="bgsync-end-date" class="themed-date" value="${bgEndDate}">
                    </div>
                </div>

                <div class="form-group">
                    <label>Run Times (every day, with &plusmn;1h randomization)</label>
                    <div id="bgsync-times-list"></div>
                    <button class="btn btn-secondary btn-sm" id="bgsync-add-time" type="button">
                        + Add time
                    </button>
                </div>

                <div style="margin-top:var(--space-md);font-size:0.9em;color:var(--color-text-muted)">
                    <div>Last sync: <span id="bgsync-last">&mdash;</span></div>
                    <div>Next window: <span id="bgsync-next">&mdash;</span></div>
                </div>

                <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">
                    <button class="btn btn-primary" id="bgsync-save" type="button">Save Sync Settings</button>
                    <button class="btn btn-secondary" id="bgsync-run-now" type="button">Run now</button>
                </div>
            </div>
            </div>
          </div>
        </div>

        <div class="dash-section" id="match-results-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Match Results</h2>
            <div class="collapsible-body">
            <div id="match-tab-bar"></div>
            <div id="match-panel-rounds" class="subtab-panel" hidden></div>
            ${!params.ManualEntry ? `
            <div id="match-panel-upload" class="subtab-panel" hidden></div>
            <div id="match-panel-overrides" class="subtab-panel" hidden></div>
            ` : ''}
            </div>
          </div>
        </div>

    `;

    // F2 (Players) — sticky-col drop-shadow on horizontal scroll, same as F1/F4 (FF chrome).
    container.querySelectorAll('.ff-wrap').forEach(w => attachStickyShadow(w));

    // Match Results sub-tabs — same pattern as dashboard "Remaining Matches" tabs.
    // Round Editor renders Table F2 for ALL leagues; manual overrides win over CSV.
    setupMatchResultsTabs(leagueId, params, refreshBadgeFn);

    // Collapsible section headers (League Settings / Players / Automatic Sync / Match Results).
    // Shared mechanism (css/sections.css + sectionCollapse.js), identical to the
    // landing / dashboard / player pages. All open by default.
    container.querySelectorAll('.app-section').forEach(s => wireSectionCollapse(s, { defaultOpen: true }));

    // Automatic Sync (BGStudio) — staged into league_params.json under p.BGStudioSync.
    setupBGSync(leagueId, params, bgDefaultName, refreshBadgeFn);

    // Keep "Save Settings" / "Save Player Changes" disabled until something in
    // their section actually changes — same dormant-until-edited behaviour the
    // Round/CSV editors already use. Re-enabled on any edit, re-disabled on save.
    const settingsSaveBtn = document.getElementById('save-league-settings');
    const settingsTracker = wireDirtySave(settingsSaveBtn && settingsSaveBtn.closest('.app-section'), settingsSaveBtn);
    // Scope to the F2 player table only — the "Custom Flag" upload panel in the same
    // section has its own Upload action and must not arm "Save Player Changes".
    const playersSaveBtn = document.getElementById('save-players');
    const playersTracker = wireDirtySave(container.querySelector('[data-ff-table="F2"]'), playersSaveBtn);

    // Status toggle label update
    document.getElementById('edit-status').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Running' : 'Completed';
    });

    // Hidden toggle label update
    document.getElementById('edit-hidden').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Hidden from public' : 'Visible';
    });

    // F2 flag-select preview/custom-code toggle (shared with F2b in Add League).
    wireFlagSelectPreview(container);

    // Back
    document.getElementById('back-to-leagues').addEventListener('click', () => {
        renderLeagueAdmin(container, refreshBadgeFn);
    });

    // Custom file input labels (edit form)
    container.querySelectorAll('.custom-file-input input[type="file"]').forEach(inp => {
        inp.addEventListener('change', () => {
            const span = inp.parentElement.querySelector('.file-name');
            if (span) span.textContent = inp.files.length ? inp.files[0].name : 'No file chosen';
        });
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
            description: `Update settings: ${newParams.LeagueTitle}`,
            category: 'league-settings',
            subject: newParams.LeagueTitle
        });

        if (refreshBadgeFn) refreshBadgeFn();
        settingsTracker.markClean();
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
            playersTracker.markDirty();
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

            // One group so the params + CSV-rename side-effect collapse to a single
            // Pending row instead of two ("Update players" + "Rename players in CSV").
            const editGroupId = `edit-players-${leagueId}`;
            const editGroupDesc = `Players updated: ${leagueId}`;
            const editDetail = renames.length > 0
                ? renames.map(r => `${r.from} → ${r.to}`).join(', ')
                : null;

            addChange({
                type: 'update',
                path: `leagues/${encoded}/league_params.json`,
                content: JSON.stringify(updatedParams, null, 2),
                description: `Update players: ${leagueId}`,
                category: 'league-players',
                subject: leagueId,
                detail: editDetail,
                group: editGroupId,
                groupDescription: editGroupDesc
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
                        description: `Rename players in CSV: ${renames.map(r => `${r.from} → ${r.to}`).join(', ')}`,
                        category: 'league-players',
                        subject: leagueId,
                        detail: editDetail,
                        group: editGroupId,
                        groupDescription: editGroupDesc
                    });
                } catch (err) {
                    showMsg('players-msg', `Warning: Could not update CSV for renames: ${err.message}`, 'error');
                }
            }

            if (refreshBadgeFn) refreshBadgeFn();
            playersTracker.markClean();
            showMsg('players-msg', 'Player changes staged.', 'success');
        });
    }

    // Upload custom flag (shared panel + handler — also used by F2b in Add League).
    wireUploadFlagPanel();
}

// ---- FF Players table (F2 / F2b) ----
// Single source of truth for the unified admin players table so F2 (Players in
// Edit League) and F2b (players in Add New League) are byte-identical in format
// and button chrome, differing only in their data + wiring. See docs/TABLE-DESIGN.md.

/** One F2/F2b row: Name input · Flag (preview + dropdown + custom code) · Retired toggle · ✕ remove. */
function ffPlayerRowHTML(name, flagCode, isRetired) {
    const isKnown = KNOWN_FLAGS.includes(flagCode);
    const flagOptions = KNOWN_FLAGS.map(f =>
        `<option value="${f}" ${f === flagCode ? 'selected' : ''}>${f}</option>`
    ).join('');
    return `
            <tr>
                <td>
                    <input type="text" class="player-name-input" data-original="${esc(name)}" value="${esc(name)}"
                        style="width:140px;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px">
                        <img class="flag" src="assets/flags/${flagCode}.png" alt="${flagCode}">
                        <select class="player-flag-select" data-player="${esc(name)}" style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                            ${flagOptions}
                            <option value="__custom" ${!isKnown ? 'selected' : ''}>Custom...</option>
                        </select>
                        <input type="text" class="player-flag-custom" placeholder="Code" style="width:50px;padding:2px 4px;border:1px solid var(--color-border);border-radius:4px;display:${isKnown ? 'none' : 'inline'}"
                            value="${!isKnown ? flagCode : ''}">
                    </div>
                </td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" class="player-retired-check" data-player="${esc(name)}" ${isRetired ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td><button class="btn btn-danger btn-sm player-remove-btn" data-remove-player="${esc(name)}" title="Remove player">&#10005;</button></td>
            </tr>`;
}

/**
 * Full FF players table (.ff-wrap + .admin-table.font-large).
 * @param {string} tableId   - 'F2' (Edit) or 'F2b' (Add); tagged as data-ff-table.
 * @param {Array<{name:string,flagCode:string,isRetired:boolean}>} rows
 * @param {string} [emptyMessage] - placeholder row shown when rows is empty.
 */
function ffPlayersTableHTML(tableId, rows, emptyMessage) {
    const body = rows.length
        ? rows.map(r => ffPlayerRowHTML(r.name, r.flagCode, r.isRetired)).join('')
        : (emptyMessage ? `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted)">${esc(emptyMessage)}</td></tr>` : '');
    return `
            <div class="ff-wrap">
                <table class="admin-table font-large" data-ff-table="${tableId}">
                    <thead>
                        <tr><th scope="col">${thLabel('Name', 'Name')}</th><th scope="col">${thLabel('Flag', 'Flag')}</th><th scope="col">${thLabel('Retired', 'Ret')}</th><th scope="col"></th></tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
}

/**
 * F6 — Medals & Prizes table. Shared by Edit League and Add New League so both
 * are byte-identical. Uses the unified FF chrome (.ff-wrap + .admin-table
 * .font-large, tagged data-mf-table-id="F6"): a Display cell (medal label+icon)
 * plus two Edit cells (Count, Prize number inputs). Inputs keep stable ids so the
 * Save/Create handlers read them unchanged. Hand-built FF chrome like F1–F4 — the
 * mountFFTable rewire is Phase 8 of docs/plans/table-lab-unification.md.
 * @param {Array<{medal,icon,cls,count,countId,prize,prizeId}>} rows
 */
function ffMedalsTableHTML(rows) {
    const body = rows.map(r => `
            <tr>
                <td><span class="medal-cell ${r.cls}"><span class="medal-icon">${r.icon}</span> ${esc(r.medal)}</span></td>
                <td><input type="number" id="${r.countId}" value="${r.count}" min="0" max="20"></td>
                <td><input type="number" id="${r.prizeId}" value="${r.prize}" min="0" step="1"></td>
            </tr>`).join('');
    return `
            <div class="ff-wrap">
                <table class="admin-table font-large" data-mf-table-id="F6">
                    <thead>
                        <tr><th scope="col">${thLabel('Medal', 'Medal')}</th><th scope="col">${thLabel('Count', 'Count')}</th><th scope="col">${thLabel('Prize', 'Prize')}</th></tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
}

/** The "Upload Custom Flag" panel that accompanies an FF players table. */
function uploadFlagPanelHTML() {
    return `
            <h3 class="admin-subhead">Custom Flag</h3>
            <div class="form-group">
                <label for="upload-flag-code">Flag code + PNG</label>
                <div class="input-action-row">
                    <input type="text" id="upload-flag-code" class="input-code" placeholder="XX" maxlength="3">
                    ${filePickerHTML('upload-flag-file', { label: 'Choose File', accept: 'image/*' })}
                    <button class="btn btn-secondary btn-sm" id="upload-flag-btn">Upload</button>
                </div>
                <small class="form-hint">Register a 2-letter code with a PNG to use a non-default flag.</small>
            </div>
            <div id="flag-upload-msg"></div>`;
}

/** Wire the flag <select> in an FF table: show/hide the custom-code input + swap the preview. */
function wireFlagSelectPreview(scope) {
    scope.querySelectorAll('.player-flag-select').forEach(sel => {
        sel.addEventListener('change', function() {
            const row = this.closest('tr');
            const customInput = row.querySelector('.player-flag-custom');
            const preview = row.querySelector('img.flag');
            if (this.value === '__custom') {
                customInput.style.display = 'inline';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
                if (preview) {
                    preview.src = `assets/flags/${this.value}.png`;
                    preview.alt = this.value;
                }
            }
        });
    });
}

/** Wire the "Upload Custom Flag" panel: stage the PNG + register the code in KNOWN_FLAGS. */
function wireUploadFlagPanel() {
    const btn = document.getElementById('upload-flag-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const code = document.getElementById('upload-flag-code').value.trim().toUpperCase();
        const fileInput = document.getElementById('upload-flag-file');

        if (!code || code.length < 2) {
            showMsg('flag-upload-msg', 'Enter a valid flag code (2+ chars).', 'error');
            return;
        }
        if (!fileInput.files || fileInput.files.length === 0) {
            showMsg('flag-upload-msg', 'Select an image file.', 'error');
            return;
        }

        const file = fileInput.files[0];
        let base64;
        try {
            base64 = await fileToPngBase64(file);
        } catch {
            showMsg('flag-upload-msg', 'Could not read this image. If it is a HEIC from iPhone, please share it as JPEG or PNG.', 'error');
            return;
        }

        addChange({
            type: 'create',
            path: `assets/flags/${code}.png`,
            content: base64,
            binary: true,
            description: `Upload flag: ${code}.png`,
            category: 'flag-upload',
            subject: code,
            detail: `${code}.png`
        });

        // Add to known flags for this session
        if (!KNOWN_FLAGS.includes(code)) KNOWN_FLAGS.push(code);

        if (refreshBadgeFn) refreshBadgeFn();
        showMsg('flag-upload-msg', `Flag ${code}.png staged for upload.`, 'success');
    });
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
    if (message) revealMsg(el);
}

/**
 * Wire up the Match Results sub-tabs (Round Editor / Upload CSV / View Overrides).
 * Round Editor opens by default. Tabs follow the same pattern as the dashboard
 * "Remaining Matches" sub-tabs (one panel open at a time; click again to close).
 */
function setupMatchResultsTabs(leagueId, params, refreshBadge) {
    const bar = document.getElementById('match-tab-bar');
    if (!bar) return;

    const tabs = [{ id: 'match-panel-rounds', label: 'Round Editor' }];
    if (!params.ManualEntry) {
        tabs.push({ id: 'match-panel-upload', label: 'Upload CSV' });
        tabs.push({ id: 'match-panel-overrides', label: 'View Overrides' });
    }

    // Shared accordion sub-tabs (one open at a time; Round Editor open by default).
    mountAccordionTabs(bar, {
        tabs,
        defaultOpenId: 'match-panel-rounds',
        onOpen: (panelId, panel) => {
            if (panelId === 'match-panel-rounds') {
                if (!panel._built) { panel._built = true; renderRoundEditor(panel, leagueId, refreshBadge); }
            } else if (panelId === 'match-panel-upload') {
                // Re-render every open so the drop zone resets cleanly after a previous import.
                renderExcelImporter(panel, leagueId, refreshBadge, () => location.reload());
            } else if (panelId === 'match-panel-overrides') {
                // Re-render every open to reflect the latest overrides file.
                renderOverridesList(panel, leagueId, refreshBadge);
            }
        },
    });
}

/**
 * Wire up the "Automatic Sync" card (BGStudio daily-sync settings).
 * For now this stages the config into league_params.json under `BGStudioSync`.
 * Later the Save / Run now actions will upsert to Supabase / trigger the server.
 *
 * @param {string[]} initialTimes - HH:MM strings to seed the run-times list.
 */
function setupBGSync(leagueId, params, defaultName, refreshBadgeFn) {
    const list = document.getElementById('bgsync-times-list');
    if (!list) return; // card not rendered (shouldn't happen)

    const seed = (params.BGStudioSync && Array.isArray(params.BGStudioSync.times))
        ? params.BGStudioSync.times.slice()
        : [];

    // Keep "Save BGStudio Settings" disabled until the config actually changes from
    // its loaded state — same dormant-until-edited behaviour as the other Edit sections.
    // Assigned just below (after the seed rows are laid down so they form the baseline);
    // add/remove time-row are not input events, so they call markDirty() explicitly.
    let bgTracker = { markDirty() {}, markClean() {} };

    function nowHHMM() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function addTimeRow(value) {
        const row = document.createElement('div');
        row.className = 'bgsync-time-row';
        row.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-xs)';
        row.innerHTML = `
            <input type="time" step="300" class="bgsync-time" value="${esc(value)}">
            <button type="button" class="btn btn-danger btn-sm bgsync-del-time" title="Remove time">&#128465;</button>`;
        row.querySelector('.bgsync-del-time').addEventListener('click', () => {
            const isLast = list.querySelectorAll('.bgsync-time-row').length === 1;
            if (isLast) {
                if (!confirm('Disable sync entirely?')) return;
                const enabled = document.getElementById('bgsync-enabled');
                if (enabled) enabled.checked = false;
            }
            row.remove();
            bgTracker.markDirty();
        });
        list.appendChild(row);
    }

    seed.forEach(t => addTimeRow(t));

    // Snapshot the seeded state as the baseline, then keep Save disabled until it changes.
    const bgSaveBtn = document.getElementById('bgsync-save');
    bgTracker = wireDirtySave(bgSaveBtn && bgSaveBtn.closest('.app-section'), bgSaveBtn);

    document.getElementById('bgsync-add-time').addEventListener('click', () => {
        addTimeRow(nowHHMM());
        bgTracker.markDirty();
    });

    // Save BGStudio settings — stage into league_params.json (base = staged version if present).
    document.getElementById('bgsync-save').addEventListener('click', () => {
        const encoded = encodeURIComponent(leagueId);
        const path = `leagues/${encoded}/league_params.json`;
        const stagedJson = getStagedContent(path);
        const baseParams = stagedJson ? JSON.parse(stagedJson) : params;
        const newParams = { ...baseParams };

        const times = Array.from(list.querySelectorAll('.bgsync-time'))
            .map(inp => inp.value.trim())
            .filter(Boolean);
        const nameVal = document.getElementById('bgsync-league-name').value.trim() || defaultName;
        const startDate = document.getElementById('bgsync-start-date').value;
        const endDate = document.getElementById('bgsync-end-date').value;

        newParams.BGStudioSync = {
            enabled: document.getElementById('bgsync-enabled').checked,
            bgstudioLeagueName: nameVal,
            startDate: startDate || null,
            endDate: endDate || null,
            times
        };

        addChange({
            type: 'update',
            path,
            content: JSON.stringify(newParams, null, 2),
            description: `Update auto-sync: ${leagueId}`,
            category: 'bgsync',
            subject: leagueId
        });

        if (refreshBadgeFn) refreshBadgeFn();
        bgTracker.markClean();
        showMsg('bgsync-msg', 'Sync settings staged. Go to Pending Changes to publish.', 'success');
    });

    // Run now — placeholder until the sync server / Supabase trigger exists.
    document.getElementById('bgsync-run-now').addEventListener('click', () => {
        console.log('TODO: trigger ad-hoc sync');
        showMsg('bgsync-msg', 'Ad-hoc sync is not wired up yet.', 'success');
    });
}
