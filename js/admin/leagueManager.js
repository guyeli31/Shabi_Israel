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
                <td data-label="Name">${esc(p.LeagueTitle || lg.id)}${hiddenBadge}</td>
                <td data-label="Type"><span class="league-type-pill type-${esc(p.LeagueType || 'doubling')}">${esc(LEAGUE_TYPE_LABELS[p.LeagueType] || LEAGUE_TYPE_LABELS.doubling)}</span></td>
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
            <div class="table-scroll">
                <table class="admin-table font-large">
                    <thead>
                        <tr><th scope="col">${thLabel('Name', 'Name')}</th><th scope="col">${thLabel('Type', 'T')}</th><th scope="col">${thLabel('Issue Date', 'Date')}</th><th scope="col">${thLabel('Status', 'Stat')}</th><th scope="col">${thLabel('Actions', 'Act')}</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
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
                            <div class="custom-file-input" style="flex:1">
                                <label class="file-btn" for="upload-csv">Choose File</label>
                                <input type="file" id="upload-csv" accept=".csv,.xlsx">
                                <span class="file-name" data-for="upload-csv">No file chosen</span>
                            </div>
                            <button class="btn btn-secondary btn-sm" id="upload-csv-btn">Load File</button>
                        </div>
                    </div>
                </div>
                <div class="add-league-row" style="margin-bottom:var(--space-md);align-items:flex-end">
                    <div class="form-group" style="flex:2;position:relative">
                        <label for="manual-player-name">Add Player from Registry</label>
                        <input type="text" id="manual-player-name" placeholder="Type a registered player name…" autocomplete="off">
                        <ul class="player-autocomplete" id="manual-player-autocomplete" hidden></ul>
                    </div>
                    <div class="form-group" style="flex:0">
                        <button class="btn btn-primary btn-sm" id="add-manual-player-btn" style="margin-top:1.4rem">Add</button>
                    </div>
                </div>
                <div id="add-msg" style="margin-bottom:var(--space-sm)"></div>
                <div id="csv-source-msg" style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:var(--space-sm)"></div>
                <table class="admin-table" id="new-players-table">
                    <thead><tr><th scope="col">${thLabel('Name', 'Name')}</th><th scope="col">${thLabel('Flag', 'Flag')}</th><th scope="col">${thLabel('Retired', 'Ret')}</th><th scope="col"></th></tr></thead>
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
        tbody.innerHTML = state.players.map((pl, i) => {
            const knownSelected = KNOWN_FLAGS.includes(pl.flag);
            const customOption = (!knownSelected && pl.flag)
                ? `<option value="${esc(pl.flag)}" selected>${esc(pl.flag)}</option>`
                : '';
            return `
            <tr>
                <td><input type="text" data-pi="${i}" data-field="name" value="${esc(pl.name)}" style="width:160px;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px"></td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px">
                        <select data-pi="${i}" data-field="flag" style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                            ${KNOWN_FLAGS.map(f => `<option value="${f}" ${f === pl.flag ? 'selected' : ''}>${f}</option>`).join('')}
                            ${customOption}
                            <option value="__custom">Custom…</option>
                        </select>
                        <div class="inline-custom-flag" style="display:none;align-items:center;gap:4px;flex-wrap:wrap">
                            <input type="text" class="cflag-code" placeholder="XX" maxlength="6"
                                   style="width:50px;padding:2px 4px;border:1px solid var(--color-border);border-radius:4px">
                            <label class="file-btn" for="cflag-file-${i}" style="padding:2px 8px;font-size:0.8rem;cursor:pointer">PNG</label>
                            <input type="file" id="cflag-file-${i}" accept="image/*" style="display:none">
                            <span class="cflag-filename" style="font-size:0.8rem;color:var(--color-text-muted)">No file</span>
                            <button type="button" class="btn btn-secondary btn-sm cflag-upload-btn" style="padding:2px 8px">Upload</button>
                            <span class="cflag-msg" style="font-size:0.8rem"></span>
                        </div>
                    </div>
                </td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" data-pi="${i}" data-field="retired" ${pl.retired ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td><button class="btn btn-danger btn-sm" data-remove-pi="${i}">Remove</button></td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('input[data-field],select[data-field]').forEach(el => {
            el.addEventListener('change', () => {
                const i = parseInt(el.dataset.pi);
                const f = el.dataset.field;
                if (f === 'flag' && el.value === '__custom') {
                    // Revert select to current flag, show inline custom area instead
                    const cur = state.players[i].flag;
                    el.value = KNOWN_FLAGS.includes(cur) ? cur : (cur || KNOWN_FLAGS[0]);
                    const area = el.closest('div').querySelector('.inline-custom-flag');
                    if (area) area.style.display = 'flex';
                    return;
                }
                state.players[i][f] = f === 'retired' ? el.checked : el.value;
            });
        });

        // Wire inline custom-flag upload for each row
        tbody.querySelectorAll('.cflag-upload-btn').forEach(btn => {
            const row = btn.closest('tr');
            const i = parseInt(row.querySelector('select[data-field="flag"]').dataset.pi);
            const area = btn.closest('.inline-custom-flag');
            const codeInput = area.querySelector('.cflag-code');
            const fileInput = area.querySelector('input[type="file"]');
            const msgEl = area.querySelector('.cflag-msg');

            fileInput.addEventListener('change', () => {
                const span = area.querySelector('.cflag-filename');
                if (span) span.textContent = fileInput.files.length ? fileInput.files[0].name : 'No file';
            });

            btn.addEventListener('click', async () => {
                const code = codeInput.value.trim().toUpperCase();
                if (!code || code.length < 2) {
                    msgEl.textContent = 'Enter a valid code (2+ chars).';
                    msgEl.style.color = 'var(--color-loss, red)';
                    return;
                }
                if (!fileInput.files || fileInput.files.length === 0) {
                    msgEl.textContent = 'Select a PNG file.';
                    msgEl.style.color = 'var(--color-loss, red)';
                    return;
                }
                let base64;
                try {
                    const dataUrl = await new Promise((res, rej) => {
                        const fr = new FileReader();
                        fr.onload = () => res(fr.result);
                        fr.onerror = rej;
                        fr.readAsDataURL(fileInput.files[0]);
                    });
                    base64 = dataUrl.split(',')[1];
                } catch {
                    msgEl.textContent = 'Could not read image.';
                    msgEl.style.color = 'var(--color-loss, red)';
                    return;
                }
                state.players[i].flag = code;
                state.players[i].flagData = base64;
                if (!KNOWN_FLAGS.includes(code)) KNOWN_FLAGS.push(code);
                // Update the select to show the new flag
                const sel = row.querySelector('select[data-field="flag"]');
                let opt = sel.querySelector(`option[value="${code}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = code;
                    opt.textContent = code;
                    sel.insertBefore(opt, sel.querySelector('option[value="__custom"]'));
                }
                sel.value = code;
                area.style.display = 'none';
                msgEl.textContent = '';
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

    // Manual add — registry-only enforcement
    document.getElementById('add-manual-player-btn').addEventListener('click', async () => {
        const name = document.getElementById('manual-player-name').value.trim();
        if (!name) return;
        if (state.players.some(p => p.name === name)) {
            showMsg('add-msg', `Player "${name}" already in list.`, 'error');
            return;
        }
        // Enforce: name must exist in player registry (or staged)
        await ensureAcData();
        if (!_acPlayerNames.includes(name)) {
            showMsg('add-msg', `"${name}" is not in the player registry. Create the player first in the Players section.`, 'error');
            return;
        }
        // Use the player's default flag from metadata if available (check staged first)
        let flag = 'IL';
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
        state.players.push({ name, flag, retired: false });
        document.getElementById('manual-player-name').value = '';
        showMsg('add-msg', '', '');
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
                description: `Upload flag: ${pl.flag}.png`
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
        description: `Create league: ${name}`
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
        description: `Create CSV for: ${name}`
    });

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
        description: `Add "${name}" to landing settings`
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
            <div class="add-league-row">
                <div class="form-group">
                    <label for="edit-gold">Gold Count</label>
                    <input type="number" id="edit-gold" value="${goldCount}" min="0" max="20">
                </div>
                <div class="form-group">
                    <label for="edit-silver">Silver Count</label>
                    <input type="number" id="edit-silver" value="${silverCount}" min="0" max="20">
                </div>
                <div class="form-group">
                    <label for="edit-bronze">Bronze Count</label>
                    <input type="number" id="edit-bronze" value="${bronzeCount}" min="0" max="20">
                </div>
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
            <div class="add-league-row">
                <div class="form-group">
                    <label for="edit-prize-gold">Prize Gold</label>
                    <input type="number" id="edit-prize-gold" value="${prizes.Gold || 0}" min="0" step="1">
                </div>
                <div class="form-group">
                    <label for="edit-prize-silver">Prize Silver</label>
                    <input type="number" id="edit-prize-silver" value="${prizes.Silver || 0}" min="0" step="1">
                </div>
                <div class="form-group">
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
                    <tr><th scope="col">${thLabel('Name', 'Name')}</th><th scope="col">${thLabel('Flag', 'Flag')}</th><th scope="col">${thLabel('Retired', 'Ret')}</th><th scope="col"></th></tr>
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
                        <div class="custom-file-input" style="flex:1">
                            <label class="file-btn" for="upload-flag-file">Choose File</label>
                            <input type="file" id="upload-flag-file" accept="image/*">
                            <span class="file-name" data-for="upload-flag-file">No file chosen</span>
                        </div>
                        <button class="btn btn-secondary btn-sm" id="upload-flag-btn">Upload</button>
                    </div>
                </div>
                <div id="flag-upload-msg"></div>
            </div>
        </div>
        ` : '<div class="admin-card"><p style="color:var(--color-text-muted)">No players yet. Upload a CSV first.</p></div>'}

        <section class="match-results-section" id="match-results-section">
            <h2>Match Results</h2>
            <div class="rem-tab-bar" id="match-tab-bar">
                <button class="rem-tab-btn" data-panel="match-panel-rounds"><span class="rem-tab-arrow">&#x25B8;</span> Round Editor</button>
                ${!params.ManualEntry ? `
                <button class="rem-tab-btn" data-panel="match-panel-upload"><span class="rem-tab-arrow">&#x25B8;</span> Upload CSV</button>
                <button class="rem-tab-btn" data-panel="match-panel-overrides"><span class="rem-tab-arrow">&#x25B8;</span> View Overrides</button>
                ` : ''}
            </div>
            <div id="match-panel-rounds" class="rem-tab-panel" hidden></div>
            ${!params.ManualEntry ? `
            <div id="match-panel-upload" class="rem-tab-panel" hidden></div>
            <div id="match-panel-overrides" class="rem-tab-panel" hidden></div>
            ` : ''}
        </section>

    `;

    // Match Results sub-tabs — same pattern as dashboard "Remaining Matches" tabs.
    // Round Editor renders Table F2 for ALL leagues; manual overrides win over CSV.
    setupMatchResultsTabs(leagueId, params, refreshBadgeFn);

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

/**
 * Wire up the Match Results sub-tabs (Round Editor / Upload CSV / View Overrides).
 * Round Editor opens by default. Tabs follow the same pattern as the dashboard
 * "Remaining Matches" sub-tabs (one panel open at a time; click again to close).
 */
function setupMatchResultsTabs(leagueId, params, refreshBadge) {
    const bar = document.getElementById('match-tab-bar');
    if (!bar) return;
    const buttons = bar.querySelectorAll('.rem-tab-btn');

    function openPanel(btn) {
        const panelId = btn.dataset.panel;
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const opening = panel.hidden;

        buttons.forEach(b => {
            const p = document.getElementById(b.dataset.panel);
            if (p) p.hidden = true;
            b.classList.remove('rem-tab-btn--open');
            const arr = b.querySelector('.rem-tab-arrow');
            if (arr) arr.innerHTML = '&#x25B8;';
        });

        if (!opening) return;

        panel.hidden = false;
        btn.classList.add('rem-tab-btn--open');
        const arrow = btn.querySelector('.rem-tab-arrow');
        if (arrow) arrow.innerHTML = '&#x25BE;';

        if (panelId === 'match-panel-rounds') {
            if (!panel._built) {
                panel._built = true;
                renderRoundEditor(panel, leagueId, refreshBadge);
            }
        } else if (panelId === 'match-panel-upload') {
            // Re-render every open so the drop zone resets cleanly after a previous import.
            renderExcelImporter(panel, leagueId, refreshBadge, () => location.reload());
        } else if (panelId === 'match-panel-overrides') {
            // Re-render every open to reflect the latest overrides file.
            renderOverridesList(panel, leagueId, refreshBadge);
        }
    }

    buttons.forEach(btn => btn.addEventListener('click', () => openPanel(btn)));

    // Open Round Editor by default.
    const defaultBtn = bar.querySelector('[data-panel="match-panel-rounds"]');
    if (defaultBtn) openPanel(defaultBtn);
}
