/**
 * csvEditor.js — Inline match editor with technical result buttons and override management.
 *
 * Shows ALL match pairings (played + unplayed) with inline-editable fields,
 * quick technical result buttons, and override management.
 */

import { loadLeagueMatchesAll, loadOverrides } from '../data/leagueLoader.js';
import { addChange, getStagedContent } from './stagingStore.js';
import { renderExcelImporter } from './excelImporter.js';
import { thLabel } from '../utils/helpers.js';

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

    // Default: show editor
    renderMatchEditor(document.getElementById('csv-content'), leagueId, refreshBadge);
}

// ---- Match Editor ----

async function renderMatchEditor(container, leagueId, refreshBadge) {
    container.innerHTML = '<div class="loading">Loading matches...</div>';

    try {
        const { matches: csvMatches, allPlayers } = await loadLeagueMatchesAll(leagueId);
        const overrides = await loadOverrides(leagueId);

        // Build override map for timestamps and data
        const overrideMap = new Map();
        for (const o of overrides) {
            overrideMap.set(overrideKey(o.playerA, o.playerB), o);
        }

        // Build complete pairings: CSV rows + unplayed combos
        const allPairings = buildAllPairings(csvMatches, allPlayers, overrideMap);

        if (allPairings.length === 0) {
            container.innerHTML = '<p style="color:var(--color-text-muted)">No players yet. Import a CSV first.</p>';
            return;
        }

        // Player names for filter datalist
        const sortedPlayers = [...allPlayers].sort((a, b) => a.localeCompare(b));
        const datalistOptions = sortedPlayers.map(p => `<option value="${esc(p)}">`).join('');

        function buildRows(filterText) {
            const ft = (filterText || '').toLowerCase();
            let rows = '';
            for (let i = 0; i < allPairings.length; i++) {
                const m = allPairings[i];
                if (ft && !m.playerA.toLowerCase().includes(ft) && !m.playerB.toLowerCase().includes(ft)) continue;

                const rowClass = m._overridden ? 'class="match-row-overridden"'
                    : !m.played ? 'class="match-row-unplayed"' : '';

                const prA = m.played && m.prA !== null ? m.prA : '';
                const lkA = m.played && m.luckA !== null ? m.luckA : '';
                const scA = m.played ? m.scoreA : '';
                const prB = m.played && m.prB !== null ? m.prB : '';
                const lkB = m.played && m.luckB !== null ? m.luckB : '';
                const scB = m.played ? m.scoreB : '';

                const edited = m.lastEdited
                    ? new Date(m.lastEdited).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : '—';

                rows += `
                    <tr ${rowClass} data-row="${i}">
                        <td class="nowrap">${esc(m.playerA)}</td>
                        <td><input type="number" class="inline-edit-input" data-field="prA" step="0.01" value="${prA}"></td>
                        <td><input type="number" class="inline-edit-input" data-field="luckA" step="0.01" value="${lkA}"></td>
                        <td><input type="number" class="inline-edit-input inline-edit-score" data-field="scoreA" step="1" value="${scA}"></td>
                        <td class="nowrap">${esc(m.playerB)}</td>
                        <td><input type="number" class="inline-edit-input" data-field="prB" step="0.01" value="${prB}"></td>
                        <td><input type="number" class="inline-edit-input" data-field="luckB" step="0.01" value="${lkB}"></td>
                        <td><input type="number" class="inline-edit-input inline-edit-score" data-field="scoreB" step="1" value="${scB}"></td>
                        <td class="nowrap edit-ts">${edited}</td>
                        <td class="nowrap">
                            <button class="btn btn-xs btn-tech" data-tech-a="${i}" title="Technical win ${esc(m.playerA)}">TA</button>
                            <button class="btn btn-xs btn-tech" data-tech-b="${i}" title="Technical win ${esc(m.playerB)}">TB</button>
                            <button class="btn btn-xs btn-tech" data-tech-d="${i}" title="Technical draw">TD</button>
                            <button class="btn btn-xs btn-tech" data-np="${i}" title="Mark as Not Played">NP</button>
                            <button class="btn btn-primary btn-xs btn-save-match" data-save="${i}" title="Save changes" disabled>Save</button>
                        </td>
                    </tr>`;
            }
            return rows;
        }

        function attachListeners() {
            // Save buttons
            container.querySelectorAll('[data-save]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.save);
                    const m = allPairings[idx];
                    const row = container.querySelector(`tr[data-row="${idx}"]`);
                    if (!row) return;

                    const override = {
                        type: 'result',
                        playerA: m.playerA,
                        playerB: m.playerB,
                        scoreA: parseFloat(row.querySelector('[data-field="scoreA"]').value) || 0,
                        scoreB: parseFloat(row.querySelector('[data-field="scoreB"]').value) || 0,
                        prA: parseFloat(row.querySelector('[data-field="prA"]').value) || 0,
                        prB: parseFloat(row.querySelector('[data-field="prB"]').value) || 0,
                        luckA: parseFloat(row.querySelector('[data-field="luckA"]').value) || 0,
                        luckB: parseFloat(row.querySelector('[data-field="luckB"]').value) || 0,
                        reason: 'Manual edit',
                        timestamp: new Date().toISOString()
                    };

                    stageOverride(leagueId, override, refreshBadge);
                    btn.disabled = true;
                    btn.classList.remove('btn-save-ready');
                    showMsg('editor-msg', `Override staged: ${m.playerA} vs ${m.playerB}`, 'success');
                });
            });

            // Technical win A
            container.querySelectorAll('[data-tech-a]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.techA);
                    applyTechnical(idx, 'technical_win', allPairings[idx].playerA);
                });
            });

            // Technical win B
            container.querySelectorAll('[data-tech-b]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.techB);
                    applyTechnical(idx, 'technical_win', allPairings[idx].playerB);
                });
            });

            // Technical draw
            container.querySelectorAll('[data-tech-d]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.techD);
                    applyTechnical(idx, 'technical_draw', null);
                });
            });

            // Not Played
            container.querySelectorAll('[data-np]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.np);
                    applyNotPlayed(idx);
                });
            });

            // Enable Save button when any input in the row changes
            container.querySelectorAll('.inline-edit-input').forEach(input => {
                input.addEventListener('input', () => {
                    const row = input.closest('tr');
                    const saveBtn = row && row.querySelector('[data-save]');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.classList.add('btn-save-ready');
                    }
                });
            });
        }

        function applyTechnical(idx, type, winner) {
            const m = allPairings[idx];
            const row = container.querySelector(`tr[data-row="${idx}"]`);
            if (!row) return;

            const scoreA = type === 'technical_draw' ? 7 : (winner === m.playerA ? 7 : 0);
            const scoreB = type === 'technical_draw' ? 7 : (winner === m.playerB ? 7 : 0);

            // Update inputs visually
            row.querySelector('[data-field="prA"]').value = '';
            row.querySelector('[data-field="luckA"]').value = '';
            row.querySelector('[data-field="scoreA"]').value = scoreA;
            row.querySelector('[data-field="prB"]').value = '';
            row.querySelector('[data-field="luckB"]').value = '';
            row.querySelector('[data-field="scoreB"]').value = scoreB;

            const override = {
                type,
                playerA: m.playerA,
                playerB: m.playerB,
                reason: type === 'technical_draw' ? 'Technical draw' : `Technical win: ${winner}`,
                timestamp: new Date().toISOString()
            };
            if (winner) override.winner = winner;

            stageOverride(leagueId, override, refreshBadge);
            showMsg('editor-msg', `Technical result staged: ${m.playerA} vs ${m.playerB}`, 'success');
        }

        function applyNotPlayed(idx) {
            const m = allPairings[idx];
            const row = container.querySelector(`tr[data-row="${idx}"]`);
            if (!row) return;

            // Clear all input fields
            row.querySelector('[data-field="prA"]').value = '';
            row.querySelector('[data-field="luckA"]').value = '';
            row.querySelector('[data-field="scoreA"]').value = '';
            row.querySelector('[data-field="prB"]').value = '';
            row.querySelector('[data-field="luckB"]').value = '';
            row.querySelector('[data-field="scoreB"]').value = '';

            const override = {
                type: 'not_played',
                playerA: m.playerA,
                playerB: m.playerB,
                reason: 'Marked as Not Played',
                timestamp: new Date().toISOString()
            };

            stageOverride(leagueId, override, refreshBadge);
            showMsg('editor-msg', `Not Played staged: ${m.playerA} vs ${m.playerB}`, 'success');
        }

        container.innerHTML = `
            <div id="editor-msg"></div>
            <div class="match-filter-bar">
                <label for="match-filter-input">Filter by player:</label>
                <input type="text" id="match-filter-input" list="match-player-list" placeholder="Type player name...">
                <datalist id="match-player-list">${datalistOptions}</datalist>
            </div>
            <div class="table-scroll" style="max-height:600px;overflow:auto">
                <table class="admin-table admin-table-compact">
                    <thead>
                        <tr>
                            <th scope="col">${thLabel('Player A', 'PA')}</th><th scope="col">${thLabel('PR', 'PR')}</th><th scope="col">${thLabel('Luck', 'Lk')}</th><th scope="col">${thLabel('Score', 'Sc')}</th>
                            <th scope="col">${thLabel('Player B', 'PB')}</th><th scope="col">${thLabel('PR', 'PR')}</th><th scope="col">${thLabel('Luck', 'Lk')}</th><th scope="col">${thLabel('Score', 'Sc')}</th>
                            <th scope="col">${thLabel('Edited', 'Ed')}</th><th scope="col">${thLabel('Actions', 'Act')}</th>
                        </tr>
                    </thead>
                    <tbody id="match-table-body">${buildRows('')}</tbody>
                </table>
            </div>
            <p style="font-size:0.75rem;color:var(--color-text-muted);margin-top:var(--space-xs)">
                Highlighted rows = overridden &nbsp;|&nbsp; Dimmed rows = not yet played
            </p>`;

        attachListeners();

        // Live filter
        document.getElementById('match-filter-input').addEventListener('input', (e) => {
            document.getElementById('match-table-body').innerHTML = buildRows(e.target.value);
            attachListeners();
        });
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

/**
 * Build all match pairings: CSV rows (played) + generated unplayed combos.
 */
function buildAllPairings(csvMatches, allPlayers, overrideMap) {
    const pairings = [];
    const seenKeys = new Set();

    // First: CSV rows (preserves chronological order)
    for (const m of csvMatches) {
        const key = overrideKey(m.playerA, m.playerB);
        seenKeys.add(key);

        const o = overrideMap.get(key);
        const isPlayed = m.scoreA !== 0 || m.scoreB !== 0 || m.prA !== 0 || m.prB !== 0;

        if (o && o.type === 'not_played') {
            // Not Played override — treat as unplayed
            pairings.push({
                playerA: m.playerA, playerB: m.playerB,
                prA: 0, luckA: 0, scoreA: 0,
                prB: 0, luckB: 0, scoreB: 0,
                played: false, _overridden: true,
                lastEdited: o.timestamp || null
            });
        } else if (o && (o.type === 'technical_win' || o.type === 'technical_draw')) {
            // Technical override — show technical result
            const aWins = o.winner === m.playerA;
            pairings.push({
                playerA: m.playerA, playerB: m.playerB,
                prA: null, luckA: null,
                scoreA: o.type === 'technical_draw' ? 7 : (aWins ? 7 : 0),
                prB: null, luckB: null,
                scoreB: o.type === 'technical_draw' ? 7 : (aWins ? 0 : 7),
                played: true, _overridden: true,
                lastEdited: o.timestamp || null
            });
        } else if (o && o.type === 'result') {
            // Result override
            pairings.push({
                playerA: m.playerA, playerB: m.playerB,
                prA: o.prA, luckA: o.luckA, scoreA: o.scoreA,
                prB: o.prB, luckB: o.luckB, scoreB: o.scoreB,
                played: true, _overridden: true,
                lastEdited: o.timestamp || null
            });
        } else {
            // Original CSV data
            pairings.push({
                ...m, played: isPlayed, _overridden: false, lastEdited: null
            });
        }
    }

    // Second: overrides for pairings not in CSV
    for (const [key, o] of overrideMap) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        if (o.type === 'not_played') {
            // Not Played override — skip (already unplayed, not in CSV)
            continue;
        } else if (o.type === 'technical_win' || o.type === 'technical_draw') {
            const aWins = o.winner === o.playerA;
            pairings.push({
                playerA: o.playerA, playerB: o.playerB,
                prA: null, luckA: null,
                scoreA: o.type === 'technical_draw' ? 7 : (aWins ? 7 : 0),
                prB: null, luckB: null,
                scoreB: o.type === 'technical_draw' ? 7 : (aWins ? 0 : 7),
                played: true, _overridden: true,
                lastEdited: o.timestamp || null
            });
        } else if (o.type === 'result') {
            pairings.push({
                playerA: o.playerA, playerB: o.playerB,
                prA: o.prA, luckA: o.luckA, scoreA: o.scoreA,
                prB: o.prB, luckB: o.luckB, scoreB: o.scoreB,
                played: true, _overridden: true,
                lastEdited: o.timestamp || null
            });
        }
    }

    // Third: unplayed pairings from allPlayers not yet seen
    const playerArr = [...allPlayers].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < playerArr.length; i++) {
        for (let j = i + 1; j < playerArr.length; j++) {
            const key = overrideKey(playerArr[i], playerArr[j]);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            pairings.push({
                playerA: playerArr[i], playerB: playerArr[j],
                prA: 0, luckA: 0, scoreA: 0,
                prB: 0, luckB: 0, scoreB: 0,
                played: false, _overridden: false, lastEdited: null
            });
        }
    }

    return pairings;
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
                <thead><tr><th scope="col">${thLabel('Type', 'T')}</th><th scope="col">${thLabel('Match', 'Match')}</th><th scope="col">${thLabel('Reason', 'Why')}</th><th scope="col">${thLabel('Date', 'Date')}</th><th scope="col"></th></tr></thead>
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
    const overridesPath = `leagues/${encoded}/manual_overrides.json`;

    // Load existing overrides — prefer staged version, fall back to server
    let overrides = [];
    const staged = getStagedContent(overridesPath);
    if (staged) {
        try { overrides = JSON.parse(staged).overrides || []; } catch { /* ignore */ }
    } else {
        try {
            const resp = await fetch(`leagues/${encoded}/manual_overrides.json`);
            if (resp.ok) {
                const data = await resp.json();
                overrides = data.overrides || [];
            }
        } catch { /* no overrides file yet */ }
    }

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
