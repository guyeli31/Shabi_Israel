/**
 * csvEditor.js — Interactive CSV editor with manual override management.
 *
 * Shows all matches (CSV + overrides applied), allows inline editing,
 * adding new rows, and managing overrides.
 */

import { loadLeagueMatches } from '../data/leagueLoader.js';
import { addChange } from './stagingStore.js';
import { renderExcelImporter } from './excelImporter.js';

/**
 * Render the CSV editor for a league.
 */
export function renderCsvEditor(container, leagueId, refreshBadge) {
    container.innerHTML = `
        <h2>Match Data</h2>
        <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-md);flex-wrap:wrap">
            <button class="btn btn-primary" id="show-editor-btn">Edit Matches</button>
            <button class="btn btn-secondary" id="show-import-btn">Import CSV/Excel</button>
            <button class="btn btn-secondary" id="show-overrides-btn">View Overrides</button>
            <button class="btn btn-success" id="add-match-btn">+ Add Match</button>
        </div>
        <div id="csv-content"></div>`;

    document.getElementById('show-editor-btn').addEventListener('click', () => {
        renderMatchEditor(document.getElementById('csv-content'), leagueId, refreshBadge);
    });

    document.getElementById('show-import-btn').addEventListener('click', () => {
        renderExcelImporter(document.getElementById('csv-content'), leagueId, refreshBadge, () => {
            renderCsvEditor(container, leagueId, refreshBadge);
        });
    });

    document.getElementById('show-overrides-btn').addEventListener('click', () => {
        renderOverridesList(document.getElementById('csv-content'), leagueId, refreshBadge);
    });

    document.getElementById('add-match-btn').addEventListener('click', () => {
        renderAddMatchForm(document.getElementById('csv-content'), leagueId, refreshBadge);
    });

    // Default: show editor
    renderMatchEditor(document.getElementById('csv-content'), leagueId, refreshBadge);
}

// ---- Match Editor ----

async function renderMatchEditor(container, leagueId, refreshBadge) {
    container.innerHTML = '<div class="loading">Loading matches...</div>';

    try {
        const { matches } = await loadLeagueMatches(leagueId);

        if (matches.length === 0) {
            container.innerHTML = '<p style="color:var(--color-text-muted)">No matches yet. Import a CSV or add matches manually.</p>';
            return;
        }

        let rows = '';
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const isOverridden = m._overridden || false;
            const rowClass = isOverridden ? 'style="background:var(--color-accent-light)"' : '';
            rows += `
                <tr ${rowClass}>
                    <td>${esc(m.playerA)}</td>
                    <td>${m.prA}</td>
                    <td>${m.luckA}</td>
                    <td>${m.scoreA}</td>
                    <td>${esc(m.playerB)}</td>
                    <td>${m.prB}</td>
                    <td>${m.luckB}</td>
                    <td>${m.scoreB}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" data-edit-row="${i}">Edit</button>
                    </td>
                </tr>`;
        }

        container.innerHTML = `
            <div id="editor-msg"></div>
            <div class="table-scroll" style="max-height:500px;overflow:auto">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Player A</th><th>PR A</th><th>Luck A</th><th>Score A</th>
                            <th>Player B</th><th>PR B</th><th>Luck B</th><th>Score B</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:var(--space-sm)">
                Highlighted rows have manual overrides applied.
            </p>`;

        container.querySelectorAll('[data-edit-row]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.editRow);
                renderEditMatchForm(container, leagueId, matches[idx], refreshBadge);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

// ---- Edit Match Form ----

function renderEditMatchForm(container, leagueId, match, refreshBadge) {
    container.innerHTML = `
        <div class="admin-card">
            <h2>Edit Match: ${esc(match.playerA)} vs ${esc(match.playerB)}</h2>
            <div id="edit-match-msg"></div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <h3 style="margin-bottom:var(--space-sm)">${esc(match.playerA)}</h3>
                    <div class="form-group">
                        <label>Score</label>
                        <input type="number" id="em-scoreA" value="${match.scoreA}" step="1">
                    </div>
                    <div class="form-group">
                        <label>PR</label>
                        <input type="number" id="em-prA" value="${match.prA}" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Luck</label>
                        <input type="number" id="em-luckA" value="${match.luckA}" step="0.01">
                    </div>
                </div>
                <div style="flex:1;min-width:200px">
                    <h3 style="margin-bottom:var(--space-sm)">${esc(match.playerB)}</h3>
                    <div class="form-group">
                        <label>Score</label>
                        <input type="number" id="em-scoreB" value="${match.scoreB}" step="1">
                    </div>
                    <div class="form-group">
                        <label>PR</label>
                        <input type="number" id="em-prB" value="${match.prB}" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Luck</label>
                        <input type="number" id="em-luckB" value="${match.luckB}" step="0.01">
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>Reason for change</label>
                <input type="text" id="em-reason" placeholder="e.g. Manual correction">
            </div>
            <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-primary" id="em-save">Save as Override</button>
                <button class="btn btn-secondary" id="em-cancel">Cancel</button>
            </div>
        </div>`;

    document.getElementById('em-cancel').addEventListener('click', () => {
        renderMatchEditor(container, leagueId, refreshBadge);
    });

    document.getElementById('em-save').addEventListener('click', () => {
        const override = {
            type: 'result',
            playerA: match.playerA,
            playerB: match.playerB,
            scoreA: parseFloat(document.getElementById('em-scoreA').value) || 0,
            scoreB: parseFloat(document.getElementById('em-scoreB').value) || 0,
            prA: parseFloat(document.getElementById('em-prA').value) || 0,
            prB: parseFloat(document.getElementById('em-prB').value) || 0,
            luckA: parseFloat(document.getElementById('em-luckA').value) || 0,
            luckB: parseFloat(document.getElementById('em-luckB').value) || 0,
            reason: document.getElementById('em-reason').value.trim() || 'Manual edit',
            timestamp: new Date().toISOString()
        };

        stageOverride(leagueId, override, refreshBadge);
        showMsg('edit-match-msg', 'Override staged.', 'success');
        setTimeout(() => renderMatchEditor(container, leagueId, refreshBadge), 800);
    });
}

// ---- Add Match Form ----

function renderAddMatchForm(container, leagueId, refreshBadge) {
    container.innerHTML = `
        <div class="admin-card">
            <h2>Add Match</h2>
            <div id="add-match-msg"></div>
            <div class="form-group">
                <label>Match Type</label>
                <select id="am-type">
                    <option value="result">Regular Result</option>
                    <option value="technical_win">Technical Win</option>
                    <option value="technical_draw">Technical Draw</option>
                </select>
            </div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:140px">
                    <label>Player A</label>
                    <input type="text" id="am-playerA" placeholder="Name">
                </div>
                <div class="form-group" style="flex:1;min-width:140px">
                    <label>Player B</label>
                    <input type="text" id="am-playerB" placeholder="Name">
                </div>
            </div>
            <div id="am-regular-fields">
                <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                    <div class="form-group" style="flex:1">
                        <label>Score A</label>
                        <input type="number" id="am-scoreA" value="0">
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>Score B</label>
                        <input type="number" id="am-scoreB" value="0">
                    </div>
                </div>
                <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                    <div class="form-group" style="flex:1">
                        <label>PR A</label>
                        <input type="number" id="am-prA" value="0" step="0.01">
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>PR B</label>
                        <input type="number" id="am-prB" value="0" step="0.01">
                    </div>
                </div>
                <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                    <div class="form-group" style="flex:1">
                        <label>Luck A</label>
                        <input type="number" id="am-luckA" value="0" step="0.01">
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>Luck B</label>
                        <input type="number" id="am-luckB" value="0" step="0.01">
                    </div>
                </div>
            </div>
            <div id="am-tech-winner" style="display:none">
                <div class="form-group">
                    <label>Winner</label>
                    <select id="am-winner">
                        <option value="A">Player A</option>
                        <option value="B">Player B</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Reason</label>
                <input type="text" id="am-reason" placeholder="e.g. Added manually">
            </div>
            <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-success" id="am-save">Add Match</button>
                <button class="btn btn-secondary" id="am-cancel">Cancel</button>
            </div>
        </div>`;

    const typeSelect = document.getElementById('am-type');
    typeSelect.addEventListener('change', () => {
        const t = typeSelect.value;
        document.getElementById('am-regular-fields').style.display = t === 'result' ? '' : 'none';
        document.getElementById('am-tech-winner').style.display = t === 'technical_win' ? '' : 'none';
    });

    document.getElementById('am-cancel').addEventListener('click', () => {
        renderMatchEditor(container, leagueId, refreshBadge);
    });

    document.getElementById('am-save').addEventListener('click', () => {
        const playerA = document.getElementById('am-playerA').value.trim();
        const playerB = document.getElementById('am-playerB').value.trim();

        if (!playerA || !playerB) {
            showMsg('add-match-msg', 'Both player names are required.', 'error');
            return;
        }

        const type = typeSelect.value;
        const reason = document.getElementById('am-reason').value.trim() || 'Manual add';
        const timestamp = new Date().toISOString();

        let override;
        if (type === 'result') {
            override = {
                type: 'result',
                playerA, playerB,
                scoreA: parseFloat(document.getElementById('am-scoreA').value) || 0,
                scoreB: parseFloat(document.getElementById('am-scoreB').value) || 0,
                prA: parseFloat(document.getElementById('am-prA').value) || 0,
                prB: parseFloat(document.getElementById('am-prB').value) || 0,
                luckA: parseFloat(document.getElementById('am-luckA').value) || 0,
                luckB: parseFloat(document.getElementById('am-luckB').value) || 0,
                reason, timestamp
            };
        } else if (type === 'technical_win') {
            const winnerSel = document.getElementById('am-winner').value;
            override = {
                type: 'technical_win',
                playerA, playerB,
                winner: winnerSel === 'A' ? playerA : playerB,
                reason, timestamp
            };
        } else {
            override = {
                type: 'technical_draw',
                playerA, playerB,
                reason, timestamp
            };
        }

        stageOverride(leagueId, override, refreshBadge);
        showMsg('add-match-msg', 'Match override staged.', 'success');
        setTimeout(() => renderMatchEditor(container, leagueId, refreshBadge), 800);
    });
}

// ---- Overrides List ----

async function renderOverridesList(container, leagueId, refreshBadge) {
    container.innerHTML = '<div class="loading">Loading overrides...</div>';

    try {
        const encoded = encodeURIComponent(leagueId);
        const resp = await fetch(`leagues/${encoded}/manual_overrides.json`);

        let overrides = [];
        if (resp.ok) {
            const data = await resp.json();
            overrides = data.overrides || [];
        }

        if (overrides.length === 0) {
            container.innerHTML = '<p style="color:var(--color-text-muted)">No manual overrides for this league.</p>';
            return;
        }

        let rows = '';
        for (let i = 0; i < overrides.length; i++) {
            const o = overrides[i];
            const time = new Date(o.timestamp).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
            rows += `
                <tr>
                    <td>${esc(o.type)}</td>
                    <td>${esc(o.playerA)} vs ${esc(o.playerB)}</td>
                    <td>${esc(o.reason || '')}</td>
                    <td>${time}</td>
                    <td><button class="btn btn-danger btn-sm" data-del-override="${i}">Remove</button></td>
                </tr>`;
        }

        container.innerHTML = `
            <div id="overrides-msg"></div>
            <table class="admin-table">
                <thead><tr><th>Type</th><th>Match</th><th>Reason</th><th>Date</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        container.querySelectorAll('[data-del-override]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.delOverride);
                overrides.splice(idx, 1);

                const encoded = encodeURIComponent(leagueId);
                addChange({
                    type: 'update',
                    path: `leagues/${encoded}/manual_overrides.json`,
                    content: JSON.stringify({ overrides }, null, 2),
                    description: `Remove override #${idx + 1}: ${leagueId}`
                });

                if (refreshBadge) refreshBadge();
                showMsg('overrides-msg', 'Override removal staged.', 'success');
                setTimeout(() => renderOverridesList(container, leagueId, refreshBadge), 800);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

// ---- Override Staging ----

async function stageOverride(leagueId, newOverride, refreshBadge) {
    const encoded = encodeURIComponent(leagueId);

    // Load existing overrides
    let overrides = [];
    try {
        const resp = await fetch(`leagues/${encoded}/manual_overrides.json`);
        if (resp.ok) {
            const data = await resp.json();
            overrides = data.overrides || [];
        }
    } catch { /* no overrides file yet */ }

    // Check if override for same match exists — replace it
    const key = overrideKey(newOverride.playerA, newOverride.playerB);
    const existingIdx = overrides.findIndex(o =>
        overrideKey(o.playerA, o.playerB) === key
    );

    if (existingIdx !== -1) {
        overrides[existingIdx] = newOverride;
    } else {
        overrides.push(newOverride);
    }

    addChange({
        type: 'update',
        path: `leagues/${encoded}/manual_overrides.json`,
        content: JSON.stringify({ overrides }, null, 2),
        description: `Override: ${newOverride.playerA} vs ${newOverride.playerB} (${newOverride.type})`
    });

    if (refreshBadge) refreshBadge();
}

function overrideKey(playerA, playerB) {
    return [playerA, playerB].sort().join('|');
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
