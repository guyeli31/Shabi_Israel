/**
 * roundEditor.js — Round-by-round per-match override editor.
 * Used as the default Match Results editor for ALL leagues (manual or CSV-based).
 * Results are staged via manual_overrides.json — these overrides always win
 * over the CSV (past or future re-imports).
 *
 * Table F (TABLE-DESIGN.md): each match renders as TWO rows (one per player)
 * with PLAYERS, PR, LUCK, SCORE per-row and EDITED + ACTIONS spanning both rows
 * via rowspan="2". Only the leftmost (PLAYERS) column is sticky on horizontal scroll.
 */

import { loadOverrides, loadLeagueParams, loadLeagueMatchesAll } from '../data/supabaseLoader.js';
import { addChange, getStagedContent, stageManualOverrides } from './stagingStore.js';
import { revealMsg } from './msgScroll.js';

async function loadOverridesWithStaged(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const path = `leagues/${encoded}/manual_overrides.json`;
    const staged = getStagedContent(path);
    if (staged) {
        try { return JSON.parse(staged).overrides || []; } catch { return []; }
    }
    return loadOverrides(leagueId);
}
import { thLabel, flagUrl, getFlagCode } from '../utils/helpers.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { mountCombobox } from '../utils/combobox.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';

export function renderRoundEditor(container, leagueId, refreshBadge) {
    container.innerHTML = `
        <div id="round-msg"></div>
        <div class="match-filter-bar" style="margin-bottom:var(--space-md)">
            <label for="round-filter-input" style="margin-right:var(--space-xs)">Filter by player:</label>
            <input type="text" id="round-filter-input" class="app-search-input" placeholder="Type player name…" autocomplete="off">
            <button type="button" class="btn btn-secondary btn-xs" id="round-filter-clear" style="margin-left:var(--space-xs)">Clear</button>
        </div>
        <div id="round-bulk-bar" class="round-bulk-bar" hidden></div>
        <div id="round-pills-bar" class="round-pills-bar"></div>
        <div id="round-content"><div class="loading">Loading matches...</div></div>`;

    loadAndRender(document.getElementById('round-content'), leagueId, refreshBadge, container);
}

async function loadAndRender(container, leagueId, refreshBadge, root) {
    try {
        const { matches } = await loadLeagueMatchesAll(leagueId);
        const roundCount = Math.max(1, ...matches.map(m => m.round || 1));
        const [params, overrides] = await Promise.all([
            loadLeagueParams(leagueId).catch(() => ({})),
            loadOverridesWithStaged(leagueId)
        ]);
        const customFlags = params.CustomFlags || {};
        const matchLength = parseInt(params.MatchLength) || 7;
        const scoreOptions = Array.from({ length: matchLength + 1 }, (_, n) =>
            `<option value="${n}">${n}</option>`).join('');

        const overrideMap = new Map();
        for (const o of overrides) overrideMap.set(pairKey(o.playerA, o.playerB), o);

        const byRound = {};
        const playerSet = new Set();
        for (const m of matches) {
            if (!byRound[m.round]) byRound[m.round] = [];
            byRound[m.round].push(m);
            playerSet.add(m.playerA);
            playerSet.add(m.playerB);
        }
        if (root) populatePlayerDatalist(root, playerSet, customFlags);

        const roundStats = [];
        let html = '';
        for (let r = 1; r <= roundCount; r++) {
            const rMatches = byRound[r] || [];
            const playedCount = rMatches.filter(m => {
                if (m.played) return true;
                const o = overrideMap.get(pairKey(m.playerA, m.playerB));
                return o && o.type !== 'not_played';
            }).length;
            roundStats.push({ round: r, played: playedCount, total: rMatches.length });

            let blocks = '';
            for (let i = 0; i < rMatches.length; i++) {
                const m = rMatches[i];
                const key = pairKey(m.playerA, m.playerB);
                const o = overrideMap.get(key);
                const rowId = `r${r}m${i}`;

                let prA = '', lkA = '', scA = '', prB = '', lkB = '', scB = '';
                let blockClass = 'match-block';
                let editedTs = null;

                if (o && o.type === 'result') {
                    prA = o.prA ?? ''; lkA = o.luckA ?? ''; scA = o.scoreA;
                    prB = o.prB ?? ''; lkB = o.luckB ?? ''; scB = o.scoreB;
                    blockClass = 'match-block match-block-overridden';
                    editedTs = o.timestamp || null;
                } else if (o && (o.type === 'technical_win' || o.type === 'technical_draw')) {
                    const aWins = o.winner === m.playerA;
                    scA = o.type === 'technical_draw' ? matchLength : (aWins ? matchLength : 0);
                    scB = o.type === 'technical_draw' ? matchLength : (aWins ? 0 : matchLength);
                    blockClass = 'match-block match-block-overridden';
                    editedTs = o.timestamp || null;
                } else if (o && o.type === 'not_played') {
                    blockClass = 'match-block match-block-unplayed';
                    editedTs = o.timestamp || null;
                } else if (m.played) {
                    prA = m.prA || ''; lkA = m.luckA || ''; scA = m.scoreA;
                    prB = m.prB || ''; lkB = m.luckB || ''; scB = m.scoreB;
                } else {
                    blockClass = 'match-block match-block-unplayed';
                }

                const flagA = `<img class="flag" src="${flagUrl(getFlagCode(m.playerA, customFlags))}" alt="">`;
                const flagB = `<img class="flag" src="${flagUrl(getFlagCode(m.playerB, customFlags))}" alt="">`;

                const scoreSelectA = scoreOptions.replace(`value="${scA}"`, `value="${scA}" selected`);
                const scoreSelectB = scoreOptions.replace(`value="${scB}"`, `value="${scB}" selected`);
                const editedDateValue = editedTs ? String(editedTs).slice(0, 10) : '';

                blocks += `
                    <tbody class="${blockClass}" data-rid="${rowId}" data-pa="${esc(m.playerA)}" data-pb="${esc(m.playerB)}">
                        <tr class="match-row-a">
                            <td class="nowrap match-player-cell">${flagA}${esc(m.playerA)}</td>
                            <td><input type="number" class="inline-edit-input" data-field="prA" step="0.01" value="${prA}"></td>
                            <td><input type="number" class="inline-edit-input" data-field="luckA" step="0.01" value="${lkA}"></td>
                            <td><select class="inline-edit-input inline-edit-score-select" data-field="scoreA">${scoreSelectA}</select></td>
                            <td class="nowrap match-edited" rowspan="2"><input type="date" class="themed-date match-edited-date" data-rid="${rowId}" value="${editedDateValue}"></td>
                            <td class="nowrap match-actions" rowspan="2">
                                <button class="btn btn-xs btn-tech" data-tech="a" data-rid="${rowId}" title="Technical win ${esc(m.playerA)}">TA</button>
                                <button class="btn btn-xs btn-tech" data-tech="b" data-rid="${rowId}" title="Technical win ${esc(m.playerB)}">TB</button>
                                <button class="btn btn-xs btn-tech" data-tech="d" data-rid="${rowId}" title="Technical draw">TD</button>
                                <button class="btn btn-xs btn-tech" data-tech="np" data-rid="${rowId}" title="Mark as not played">NP</button>
                                <button class="btn btn-primary btn-xs btn-save-match" data-save="${rowId}" disabled>Save</button>
                                <button class="btn btn-secondary btn-xs btn-revert-match" data-revert="${rowId}" title="Discard the unsaved change and restore the match to its last saved state" disabled>Revert</button>
                            </td>
                        </tr>
                        <tr class="match-row-b">
                            <td class="nowrap match-player-cell">${flagB}${esc(m.playerB)}</td>
                            <td><input type="number" class="inline-edit-input" data-field="prB" step="0.01" value="${prB}"></td>
                            <td><input type="number" class="inline-edit-input" data-field="luckB" step="0.01" value="${lkB}"></td>
                            <td><select class="inline-edit-input inline-edit-score-select" data-field="scoreB">${scoreSelectB}</select></td>
                        </tr>
                    </tbody>`;
            }

            html += `
                <div class="admin-card round-card" data-round="${r}" style="margin-bottom:var(--space-md)">
                    <h3 style="margin-bottom:var(--space-sm)">
                        Round ${r}
                        <span style="font-size:0.8rem;color:var(--color-text-muted);font-weight:normal;margin-left:var(--space-sm)">${playedCount}/${rMatches.length} played</span>
                    </h3>
                    <div class="ff-wrap">
                        <table class="admin-table font-large admin-round-table">
                            <thead><tr>
                                <th class="match-player-cell">${thLabel('Players', 'Pl')}</th>
                                <th>${thLabel('PR', 'PR')}</th>
                                <th>${thLabel('Luck', 'Lk')}</th>
                                <th>${thLabel('Score', 'Sc')}</th>
                                <th>${thLabel('Edited', 'Ed')}</th>
                                <th>${thLabel('Actions', 'Act')}</th>
                            </tr></thead>
                            ${blocks}
                        </table>
                    </div>
                </div>`;
        }

        container.innerHTML = html || '<p style="color:var(--color-text-muted)">No matches found.</p>';
        container.querySelectorAll('.ff-wrap').forEach(w => attachStickyShadow(w));
        attachListeners(container, leagueId, refreshBadge, matchLength);
        if (root) attachRoundNav(root, container, roundStats);
        if (root) attachBulkTechLoss(root, container, leagueId, matches, matchLength, refreshBadge);
    } catch (err) {
        container.innerHTML = `<div class="admin-msg admin-msg-error">${err.message}</div>`;
    }
}

function populatePlayerDatalist(root, playerSet, customFlags = {}) {
    const input = root.querySelector('#round-filter-input');
    if (!input) return;
    const sorted = [...playerSet].sort((a, b) => a.localeCompare(b));
    // Title badges (BMAB / championship) for each player — loaded from the same
    // metadata source admin uses elsewhere; async, lands before the user types.
    const titleMap = {};
    import('../data/supabasePlayersMetadata.js')
        .then(({ loadPlayersMetadata }) => loadPlayersMetadata())
        .then(meta => { for (const [n, m] of Object.entries(meta || {})) { const t = getTitleAbbreviationsHtml(m); if (t) titleMap[n] = t; } })
        .catch(() => {});
    mountCombobox(input, {
        getOptions: () => sorted,
        decorate: (p) => ({ flagCode: getFlagCode(p, customFlags), titleHtml: titleMap[p] || '' }),
    });
}

/**
 * Round pills + player filter, combined: with no filter text, exactly one
 * round-card is shown at a time (picked via the pills — perf: hundreds of
 * live <input>/<select> elements only ever render for one round instead of
 * every round at once). Typing a filter temporarily searches across ALL
 * rounds (that's the point of a player filter — find them wherever they
 * are); clearing it snaps back to the selected pill's round.
 */
function attachRoundNav(root, content, roundStats) {
    const input = root.querySelector('#round-filter-input');
    const clearBtn = root.querySelector('#round-filter-clear');
    const pillsBar = root.querySelector('#round-pills-bar');
    if (!input || !pillsBar) return;

    if (roundStats.length === 0) { pillsBar.innerHTML = ''; return; }

    const firstIncomplete = roundStats.find(s => s.played < s.total);
    let selectedRound = (firstIncomplete || roundStats[0]).round;

    pillsBar.innerHTML = roundStats.map(s => `
        <button type="button" class="round-pill${s.round === selectedRound ? ' active' : ''}" data-round="${s.round}">R${s.round}${s.played < s.total ? '<span class="round-pill-dot" title="Not fully played"></span>' : ''}</button>`
    ).join('');

    function applyFilter() {
        const ft = input.value.trim().toLowerCase();
        const cards = content.querySelectorAll('.round-card');
        cards.forEach(card => {
            const blocks = card.querySelectorAll('tbody.match-block');
            let visible = 0;
            blocks.forEach(b => {
                const a = (b.dataset.pa || '').toLowerCase();
                const c = (b.dataset.pb || '').toLowerCase();
                const match = !ft || a.includes(ft) || c.includes(ft);
                b.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            card.style.display = ft
                ? (visible === 0 ? 'none' : '')
                : (parseInt(card.dataset.round, 10) === selectedRound ? '' : 'none');
        });
    }

    pillsBar.querySelectorAll('.round-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            selectedRound = parseInt(pill.dataset.round, 10);
            pillsBar.querySelectorAll('.round-pill').forEach(p => p.classList.toggle('active', p === pill));
            applyFilter();
        });
    });

    input.addEventListener('input', applyFilter);
    if (clearBtn) clearBtn.addEventListener('click', () => {
        input.value = '';
        applyFilter();
        // Reset to the clean initial state WITHOUT re-opening the suggestion
        // list: close it and hide the bulk-tech-loss bar, and deliberately do
        // NOT re-focus the field — focusing fires the combobox's focus→open and
        // a full suggestion list pops back over the rounds (the reported "Clear
        // reopens a dropdown" bug). No `input` event is dispatched for the same
        // reason; the dependent bulk bar is reset directly here.
        root.querySelector('.app-combo-dropdown')?.setAttribute('hidden', '');
        const bulk = root.querySelector('#round-bulk-bar');
        if (bulk) { bulk.hidden = true; bulk.innerHTML = ''; }
    });

    applyFilter();
}

/**
 * Bulk "technical loss" bar. Appears only once the filter input EXACTLY names a
 * player (the combobox pick sets input.value to the name), sitting between the
 * filter and the round pills. One Save forfeits ALL of that player's matches —
 * every match becomes a technical win for the opponent — staged in a single
 * manual_overrides.json change for review before publishing. Matches involving
 * 'Bye' are skipped (a forfeit against nobody is meaningless).
 */
function attachBulkTechLoss(root, content, leagueId, matches, matchLength, refreshBadge) {
    const input = root.querySelector('#round-filter-input');
    const bar = root.querySelector('#round-bulk-bar');
    if (!input || !bar) return;

    // Case-insensitive exact-name lookup (lowercased → canonical spelling).
    const canonical = new Map();
    for (const m of matches) {
        canonical.set(m.playerA.toLowerCase(), m.playerA);
        canonical.set(m.playerB.toLowerCase(), m.playerB);
    }

    function playerMatchesFor(player) {
        return matches.filter(m =>
            (m.playerA === player || m.playerB === player) &&
            m.playerA !== 'Bye' && m.playerB !== 'Bye');
    }

    function sync() {
        const player = canonical.get(input.value.trim().toLowerCase());
        const pMatches = player ? playerMatchesFor(player) : [];
        if (!player || pMatches.length === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
        const n = pMatches.length;
        bar.hidden = false;
        bar.innerHTML = `
            <span class="round-bulk-text">
                Technical loss — forfeit <strong>${esc(player)}</strong>'s
                ${n} match${n === 1 ? '' : 'es'} to the opponent.
            </span>
            <button type="button" class="btn btn-primary btn-xs round-bulk-save">Save all ${n}</button>`;

        bar.querySelector('.round-bulk-save').addEventListener('click', async () => {
            if (!confirm(`Forfeit all ${n} of ${player}'s match${n === 1 ? '' : 'es'} as a technical loss (opponent wins each)?\n\nThis stages ${n} override${n === 1 ? '' : 's'} for review before publishing.`)) return;
            const btn = bar.querySelector('.round-bulk-save');
            btn.disabled = true;
            try {
                await stageBulkTechLoss(leagueId, player, pMatches, refreshBadge);
                applyTechLossToDom(content, player, matchLength);
                showMsg(`Staged technical loss for all ${n} of ${player}'s match${n === 1 ? '' : 'es'}.`, 'success');
            } catch (err) {
                btn.disabled = false;
                showMsg(`Bulk technical loss failed: ${err.message}`, 'error');
            }
        });
    }

    input.addEventListener('input', sync);
    sync();
}

/**
 * Stage a technical_win (winner = opponent) for every one of a player's matches,
 * merged into the league's existing staged/published overrides and written as a
 * single staged manual_overrides.json change.
 */
async function stageBulkTechLoss(leagueId, player, playerMatches, refreshBadge) {
    const encoded = encodeURIComponent(leagueId);
    const path = `leagues/${encoded}/manual_overrides.json`;
    let overrides = [];
    const staged = getStagedContent(path);
    if (staged) {
        try { overrides = JSON.parse(staged).overrides || []; } catch { }
    } else {
        try { overrides = await loadOverrides(leagueId); } catch { }
    }
    const ts = new Date().toISOString();
    for (const m of playerMatches) {
        const winner = m.playerA === player ? m.playerB : m.playerA;
        const override = { type: 'technical_win', playerA: m.playerA, playerB: m.playerB, winner, reason: `Technical win: ${winner}`, timestamp: ts };
        const key = pairKey(m.playerA, m.playerB);
        const idx = overrides.findIndex(o => pairKey(o.playerA, o.playerB) === key);
        if (idx !== -1) overrides[idx] = override; else overrides.push(override);
    }
    await stageManualOverrides(leagueId, overrides);
    if (refreshBadge) refreshBadge();
}

/**
 * Reflect a just-staged bulk technical loss in the already-rendered DOM (across
 * all rounds), mirroring a per-match technical-win Save: opponent gets the full
 * match length, the player 0, PR/Luck cleared, block marked overridden + saved.
 */
function applyTechLossToDom(content, player, matchLength) {
    const today = new Date().toISOString().slice(0, 10);
    content.querySelectorAll('tbody.match-block').forEach(block => {
        const pa = block.dataset.pa, pb = block.dataset.pb;
        if (pa !== player && pb !== player) return;
        const winner = pa === player ? pb : pa;
        const set = (sel, v) => { const el = block.querySelector(sel); if (el) el.value = v; };
        set('[data-field="prA"]', ''); set('[data-field="luckA"]', ''); set('[data-field="scoreA"]', winner === pa ? matchLength : 0);
        set('[data-field="prB"]', ''); set('[data-field="luckB"]', ''); set('[data-field="scoreB"]', winner === pb ? matchLength : 0);
        const dateEl = block.querySelector('.match-edited-date');
        if (dateEl) dateEl.value = today;
        block.className = 'match-block match-block-overridden';
        delete block.dataset.pendingType;
        delete block.dataset.pendingWinner;
        block._orig = snapshotBlock(block);
        const saveBtn = block.querySelector('[data-save]');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('btn-save-ready'); }
        const revertBtn = block.querySelector('[data-revert]');
        if (revertBtn) revertBtn.disabled = true;
    });
}

function attachListeners(container, leagueId, refreshBadge, matchLength) {
    // Snapshot each match-block's original (last-saved/loaded) state so Revert
    // can restore it. Runs once, before any edits, so the live values are pristine.
    container.querySelectorAll('tbody[data-rid]').forEach(block => {
        block._orig = snapshotBlock(block);
    });

    container.querySelectorAll('[data-revert]').forEach(btn => {
        btn.addEventListener('click', () => {
            const block = container.querySelector(`tbody[data-rid="${btn.dataset.revert}"]`);
            if (block) revertBlock(block);
        });
    });

    container.querySelectorAll('[data-save]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const block = container.querySelector(`tbody[data-rid="${btn.dataset.save}"]`);
            if (!block) return;

            const pendingType = block.dataset.pendingType;
            const pendingWinner = block.dataset.pendingWinner;
            const playerA = block.dataset.pa;
            const playerB = block.dataset.pb;
            const dateInput = block.querySelector('.match-edited-date');
            const pickedDate = dateInput ? dateInput.value : '';
            const ts = pickedDate
                ? new Date(`${pickedDate}T00:00:00`).toISOString()
                : new Date().toISOString();

            let override;
            if (pendingType === 'technical_draw') {
                override = { type: 'technical_draw', playerA, playerB, reason: 'Technical draw', timestamp: ts };
            } else if (pendingType === 'technical_win') {
                override = { type: 'technical_win', playerA, playerB, winner: pendingWinner, reason: `Technical win: ${pendingWinner}`, timestamp: ts };
            } else if (pendingType === 'not_played') {
                override = { type: 'not_played', playerA, playerB, reason: 'Marked not played', timestamp: ts };
            } else {
                override = {
                    type: 'result',
                    playerA, playerB,
                    scoreA: parseFloat(block.querySelector('[data-field="scoreA"]').value) || 0,
                    scoreB: parseFloat(block.querySelector('[data-field="scoreB"]').value) || 0,
                    prA: parseFloat(block.querySelector('[data-field="prA"]').value) || 0,
                    prB: parseFloat(block.querySelector('[data-field="prB"]').value) || 0,
                    luckA: parseFloat(block.querySelector('[data-field="luckA"]').value) || 0,
                    luckB: parseFloat(block.querySelector('[data-field="luckB"]').value) || 0,
                    reason: 'Manual entry',
                    timestamp: ts
                };
            }

            await stageOverride(leagueId, override, refreshBadge);
            btn.disabled = true;
            btn.classList.remove('btn-save-ready');
            const wasNotPlayed = pendingType === 'not_played';
            delete block.dataset.pendingType;
            delete block.dataset.pendingWinner;
            block.classList.remove('match-block-pending');
            const dateCell = block.querySelector('.match-edited-date');
            if (wasNotPlayed) {
                block.classList.remove('match-block-overridden');
                block.classList.add('match-block-unplayed');
                block.querySelectorAll('.inline-edit-input').forEach(el => {
                    if (el.tagName === 'SELECT') el.value = '0';
                    else el.value = '';
                });
                if (dateCell) dateCell.value = ts.slice(0, 10);
            } else {
                block.classList.remove('match-block-unplayed');
                block.classList.add('match-block-overridden');
                if (dateCell) dateCell.value = ts.slice(0, 10);
            }
            // The just-saved state becomes the new "original" — a later edit reverts
            // back to here, not to the pre-save state.
            block._orig = snapshotBlock(block);
            const revertBtn = block.querySelector('[data-revert]');
            if (revertBtn) revertBtn.disabled = true;
            showMsg(`Saved: ${playerA} vs ${playerB}`, 'success');
        });
    });

    container.querySelectorAll('[data-tech]').forEach(btn => {
        btn.addEventListener('click', () => {
            const block = container.querySelector(`tbody[data-rid="${btn.dataset.rid}"]`);
            if (!block) return;
            const side = btn.dataset.tech;
            let type, winner = null, scA = 0, scB = 0;
            if (side === 'd') {
                type = 'technical_draw';
                scA = matchLength; scB = matchLength;
            } else if (side === 'np') {
                type = 'not_played';
            } else {
                type = 'technical_win';
                winner = side === 'a' ? block.dataset.pa : block.dataset.pb;
                scA = winner === block.dataset.pa ? matchLength : 0;
                scB = winner === block.dataset.pb ? matchLength : 0;
            }

            block.querySelector('[data-field="prA"]').value = '';
            block.querySelector('[data-field="luckA"]').value = '';
            block.querySelector('[data-field="scoreA"]').value = scA;
            block.querySelector('[data-field="prB"]').value = '';
            block.querySelector('[data-field="luckB"]').value = '';
            block.querySelector('[data-field="scoreB"]').value = scB;

            block.dataset.pendingType = type;
            if (winner) block.dataset.pendingWinner = winner;
            else delete block.dataset.pendingWinner;

            markPending(block, matchLength);
        });
    });

    container.querySelectorAll('.inline-edit-input').forEach(input => {
        const evt = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(evt, () => {
            const block = input.closest('tbody[data-rid]');
            if (!block) return;
            block.dataset.pendingType = 'result';
            delete block.dataset.pendingWinner;
            markPending(block, matchLength);
        });
    });

    container.querySelectorAll('.match-edited-date').forEach(input => {
        input.addEventListener('change', () => {
            const block = input.closest('tbody[data-rid]');
            if (!block) return;
            if (!block.dataset.pendingType) block.dataset.pendingType = 'result';
            markPending(block, matchLength);
        });
    });

}

function validateResultFields(block, matchLength) {
    const prA = block.querySelector('[data-field="prA"]').value.trim();
    const prB = block.querySelector('[data-field="prB"]').value.trim();
    const luckA = block.querySelector('[data-field="luckA"]').value.trim();
    const luckB = block.querySelector('[data-field="luckB"]').value.trim();
    if (!prA || !prB || !luckA || !luckB) return false;
    const scA = parseInt(block.querySelector('[data-field="scoreA"]').value, 10);
    const scB = parseInt(block.querySelector('[data-field="scoreB"]').value, 10);
    const aMax = scA === matchLength;
    const bMax = scB === matchLength;
    return aMax !== bMax;
}

function markPending(block, matchLength) {
    block.classList.add('match-block-pending');
    // Revert opens on ANY unsaved change (valid or not) so a partial/invalid edit
    // can still be undone — unlike Save, which also requires validity.
    const revertBtn = block.querySelector('[data-revert]');
    if (revertBtn) revertBtn.disabled = false;
    const saveBtn = block.querySelector('[data-save]');
    if (!saveBtn) return;
    const pendingType = block.dataset.pendingType;
    const valid = pendingType === 'result'
        ? validateResultFields(block, matchLength)
        : !!pendingType;
    saveBtn.disabled = !valid;
    saveBtn.classList.toggle('btn-save-ready', valid);
}

/** Snapshot a match-block's editable state + status class for Revert. */
function snapshotBlock(block) {
    const val = (sel) => { const el = block.querySelector(sel); return el ? el.value : ''; };
    const dateEl = block.querySelector('.match-edited-date');
    return {
        prA: val('[data-field="prA"]'), luckA: val('[data-field="luckA"]'), scoreA: val('[data-field="scoreA"]'),
        prB: val('[data-field="prB"]'), luckB: val('[data-field="luckB"]'), scoreB: val('[data-field="scoreB"]'),
        date: dateEl ? dateEl.value : '',
        className: block.className,
        pendingType: block.dataset.pendingType,
        pendingWinner: block.dataset.pendingWinner
    };
}

/** Restore a match-block to its snapshotted original, discarding the unsaved edit. */
function revertBlock(block) {
    const o = block._orig;
    if (!o) return;
    const set = (sel, v) => { const el = block.querySelector(sel); if (el) el.value = v; };
    set('[data-field="prA"]', o.prA); set('[data-field="luckA"]', o.luckA); set('[data-field="scoreA"]', o.scoreA);
    set('[data-field="prB"]', o.prB); set('[data-field="luckB"]', o.luckB); set('[data-field="scoreB"]', o.scoreB);
    const dateEl = block.querySelector('.match-edited-date');
    if (dateEl) dateEl.value = o.date;
    // className restore drops match-block-pending and re-applies the original status
    // (played / unplayed / overridden).
    block.className = o.className;
    if (o.pendingType) block.dataset.pendingType = o.pendingType; else delete block.dataset.pendingType;
    if (o.pendingWinner) block.dataset.pendingWinner = o.pendingWinner; else delete block.dataset.pendingWinner;
    const saveBtn = block.querySelector('[data-save]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('btn-save-ready'); }
    const revertBtn = block.querySelector('[data-revert]');
    if (revertBtn) revertBtn.disabled = true;
}

function formatEdited(ts) {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
}

async function stageOverride(leagueId, newOverride, refreshBadge) {
    const encoded = encodeURIComponent(leagueId);
    const path = `leagues/${encoded}/manual_overrides.json`;
    let overrides = [];
    const staged = getStagedContent(path);
    if (staged) {
        try { overrides = JSON.parse(staged).overrides || []; } catch { }
    } else {
        try { overrides = await loadOverrides(leagueId); } catch { }
    }
    const key = pairKey(newOverride.playerA, newOverride.playerB);
    const idx = overrides.findIndex(o => pairKey(o.playerA, o.playerB) === key);
    if (idx !== -1) overrides[idx] = newOverride;
    else overrides.push(newOverride);
    await stageManualOverrides(leagueId, overrides);
    if (refreshBadge) refreshBadge();
}

function pairKey(a, b) { return [a, b].sort().join('|'); }
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function showMsg(msg, type) { const el = document.getElementById('round-msg'); if (el) { el.innerHTML = `<div class="admin-msg admin-msg-${type}">${msg}</div>`; if (msg) revealMsg(el); } }
