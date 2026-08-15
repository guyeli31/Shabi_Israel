/**
 * excelImporter.js — Import Excel (.xlsx) or CSV files via drag & drop or file picker.
 * Uses SheetJS (loaded from CDN in admin.html) for Excel parsing.
 */

import { addChange, getStagedContent, stageManualOverrides, T } from './stagingStore.js';
import { computeCsvImportReport, renderCsvImportReport, wireCsvImportGate } from './csvValidation.js';
import { parseCSV, getAllPlayersFromCSV } from '../data/csvParser.js';
import { loadLeagueParams, loadOverrides } from '../data/supabaseLoader.js';
import { mountFFTable } from '../../table-lab/formats/ff/mount.js';
import { formatNumber } from '../utils/helpers.js';
import { revealMsg } from './msgScroll.js';

/**
 * Render the Excel/CSV import UI into a container.
 *
 * Two modes, one UI — the drop zone, the compatibility report and the F5
 * decision table are identical in both, which is the point: importing results
 * into a brand-new league should not be a second, weaker importer.
 *
 *   STAGE mode (default, Edit League) — Confirm writes the staged CSV +
 *     technical overrides for `leagueId` itself.
 *   COMPOSE mode (`opts.onCompose`, Add New League) — nothing is staged here.
 *     Confirm hands the composed result back to the caller, which folds it into
 *     the league-creation change set. The league doesn't exist yet, so the
 *     report runs against a clean baseline (see emptyBaseline) and the match
 *     length comes from the form rather than from saved params.
 *
 * @param {HTMLElement} container
 * @param {string} leagueId — the league folder name
 * @param {function} refreshBadge
 * @param {function} onDone — called after a successful confirm
 * @param {object} [opts]
 * @param {function} [opts.onCompose] — ({csvText, overrides, players}) => void
 * @param {function} [opts.getMatchLength] — () => number, for technical results
 * @param {string}   [opts.heading]
 */
export function renderExcelImporter(container, leagueId, refreshBadge, onDone, opts = {}) {
    const composeMode = typeof opts.onCompose === 'function';
    const confirmLabel = composeMode ? 'Add these matches' : 'Confirm & Stage';

    container.innerHTML = `
        <div class="admin-card">
            <h2>${escHtml(opts.heading || 'Import CSV / Excel')}</h2>
            <div id="import-msg"></div>
            <div id="drop-zone" style="
                border: 2px dashed var(--color-border);
                border-radius: var(--radius-md);
                padding: var(--space-xl);
                text-align: center;
                color: var(--color-text-muted);
                cursor: pointer;
                transition: border-color 0.2s, background 0.2s;
                margin-bottom: var(--space-md);
            ">
                <p style="font-size:1.1rem;margin-bottom:var(--space-sm)">
                    Drag & drop .xlsx or .csv file here
                </p>
                <p style="font-size:0.85rem">or click to browse</p>
                <input type="file" id="file-input" accept=".xlsx,.csv" style="display:none">
            </div>
            <div id="csv-validation"></div>
            <div id="preview-area" style="display:none">
                <h3 style="margin-bottom:var(--space-sm)">Preview</h3>
                <div id="preview-host" style="margin-bottom:var(--space-md)"></div>
                <div style="display:flex;gap:var(--space-sm)">
                    <button class="btn btn-success" id="confirm-import">${escHtml(confirmLabel)}</button>
                    <button class="btn btn-secondary" id="cancel-import">Cancel</button>
                </div>
            </div>
        </div>`;

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    let parsedCSV = null;

    // Per-row decisions taken in the F5 preview, parallel to report.newMatches.
    // Each entry: { action: 'import' | 'skip' | 'tech_a' | 'tech_b' | 'tech_draw' }.
    // 'import' is the default and stages the CSV row exactly as uploaded.
    let rowStates = [];
    let previewMatches = [];

    // Technical results need the league's match length (7 unless overridden), the
    // same value Round Editor uses to fill the winner's score. In compose mode the
    // league has no saved params yet, so the caller supplies it live from the form.
    let matchLength = 7;
    if (!opts.getMatchLength) {
        loadLeagueParams(leagueId)
            .then(p => { matchLength = parseInt(p.MatchLength) || 7; })
            .catch(() => { /* default stands */ });
    }
    // Read at decision time, not at mount: in compose mode the admin can still be
    // editing the Match Length field while marking rows technical.
    const currentMatchLength = () => opts.getMatchLength
        ? (parseInt(opts.getMatchLength()) || 7)
        : matchLength;

    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    });

    // Drag & drop
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--color-accent)';
        dropZone.style.background = 'var(--color-accent-light)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--color-border)';
        dropZone.style.background = '';
    });

    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--color-border)';
        dropZone.style.background = '';
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    async function handleFile(file) {
        const name = file.name.toLowerCase();

        try {
            if (name.endsWith('.csv')) {
                const text = await file.text();
                parsedCSV = text;
                showPreview(text);
            } else if (name.endsWith('.xlsx')) {
                const buffer = await file.arrayBuffer();
                const csvText = parseExcel(buffer);
                parsedCSV = csvText;
                showPreview(csvText);
            } else {
                showMsg('import-msg', 'Unsupported file type. Use .xlsx or .csv', 'error');
            }
        } catch (err) {
            showMsg('import-msg', `Error reading file: ${err.message}`, 'error');
        }
    }

    function parseExcel(buffer) {
        if (typeof XLSX === 'undefined') {
            throw new Error('SheetJS (XLSX) library not loaded. Check CDN script in admin.html.');
        }
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_csv(firstSheet);
    }

    function showPreview(csvText) {
        const lines = csvText.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) {
            showMsg('import-msg', 'File is empty.', 'error');
            return;
        }
        document.getElementById('preview-area').style.display = 'block';
        // Keep the drop zone visible so the compatibility report sits directly
        // beneath it, and the admin can re-drop a different file in place.

        // The report drives BOTH the compatibility panel and the F5 preview table.
        renderValidation(csvText);
    }

    async function renderValidation(csvText) {
        const el = document.getElementById('csv-validation');
        const host = document.getElementById('preview-host');
        if (el) el.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-sm) 0">Checking compatibility…</p>`;
        try {
            // Compose mode: the league is being created right now, so "what's
            // already there" is nothing — every played row in the file is new.
            const report = await computeCsvImportReport(leagueId, csvText, { emptyBaseline: composeMode });
            if (el) el.innerHTML = renderCsvImportReport(report);
            // A CSV that doesn't match the league, or that would erase already-played
            // results, must be acknowledged before it can be staged — the report's
            // checkbox arms the Confirm & Stage button below.
            wireCsvImportGate(el, report, document.getElementById('confirm-import'), confirmLabel);
            renderPreview(host, report);
        } catch (err) {
            if (el) el.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-sm) 0">Compatibility check unavailable: ${escHtml(err.message)}</p>`;
            if (host) host.innerHTML = '';
        }
    }

    // F5 — CSV Import Preview. Shows ONLY the "N updates": matches played in the
    // uploaded CSV that were not already played and are not override-covered.
    //
    // Rendered with the canonical FF renderer (`mountFFTable`) — F5 is the first
    // production call site of the lab's FF mount (Phase 8 of the table-lab
    // unification plan); every other admin table still hand-builds the same FF
    // chrome. Display cells for the data, Action cells for the per-row buttons.
    // Deliberately font-large (the FF default) — FF's chrome is keyed to
    // `.admin-table.font-large` and a font-small variant is not part of the canon.
    //
    // The buttons mirror Round Editor's (TA/TB/TD/NP) so the two editors read the
    // same, but they act on the IMPORT, not on the league: nothing is written
    // until Confirm & Stage.
    function renderPreview(host, report) {
        if (!host) return;
        previewMatches = report.newMatches || [];
        rowStates = previewMatches.map(() => ({ action: 'import' }));
        showMsg('import-msg', `${previewMatches.length} new match${previewMatches.length === 1 ? '' : 'es'} to import.`, 'info');
        if (previewMatches.length === 0) {
            host.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-sm) 0">No new matches in this upload.</p>`;
            return;
        }
        const num = (v) => v == null ? '—' : formatNumber(v);
        const actions = (_v, row) => {
            const a = escHtml(row.playerA), b = escHtml(row.playerB);
            return `
                <button class="btn btn-xs btn-tech" data-f5act="tech_a" title="Technical win ${a}">TA</button>
                <button class="btn btn-xs btn-tech" data-f5act="tech_b" title="Technical win ${b}">TB</button>
                <button class="btn btn-xs btn-tech" data-f5act="tech_draw" title="Technical draw">TD</button>
                <button class="btn btn-xs btn-tech" data-f5act="skip" title="Not played — leave this match out of the import">NP</button>
                <button class="btn btn-secondary btn-xs" data-f5act="import" title="Import this row exactly as it is in the CSV">Undo</button>`;
        };

        const { table } = mountFFTable(host, {
            tableId: 'F5',
            data: previewMatches,
            cols: [
                { key: 'round',   label: 'Rnd' },
                { key: 'playerA', label: 'Player A', format: (v) => escHtml(v) },
                { key: 'prA',     label: 'PR',       format: num },
                { key: 'luckA',   label: 'Luck',     format: num },
                { key: 'scoreA',  label: 'A' },
                { key: 'playerB', label: 'Player B', format: (v) => escHtml(v) },
                { key: 'prB',     label: 'PR',       format: num },
                { key: 'luckB',   label: 'Luck',     format: num },
                { key: 'scoreB',  label: 'B' },
                { key: '_status', label: 'Result',   tdClass: 'f5-status', format: () => statusLabel({ action: 'import' }) },
                { key: '_actions', label: 'Actions', tdClass: 'f5-actions', format: actions },
            ],
        });

        // Every body row carries .f5-row so the per-state tints and the single
        // uniform hover rule can out-specify FF's base body well (see the F5 block
        // in css/admin.css).
        table.querySelectorAll('tbody > tr').forEach(tr => tr.classList.add('f5-row'));

        // FF owns only the chrome — the caller wires action buttons via delegation
        // on the returned table (see the FF contract in TABLE-DESIGN.md).
        table.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-f5act]');
            if (!btn || !table.contains(btn)) return;
            const tr = btn.closest('tbody > tr');
            if (!tr) return;
            const i = [...tr.parentElement.children].indexOf(tr);
            if (i < 0 || !rowStates[i]) return;
            rowStates[i].action = btn.dataset.f5act;
            paintRow(tr, previewMatches[i], rowStates[i]);
            updateImportCount();
        });
    }

    /** Rewrite one preview row to reflect its decision (values, tint, status). */
    function paintRow(tr, m, state) {
        const num = (v) => v == null ? '—' : formatNumber(v);
        const cell = (i) => tr.children[i];
        const isTech = state.action.startsWith('tech');

        // Technical results replace the source's numbers the same way Round Editor
        // does: PR/Luck blank (they mean nothing for a forfeit), score = match length
        // for the winner(s), 0 for the loser.
        let prA = num(m.prA), lkA = num(m.luckA), scA = m.scoreA;
        let prB = num(m.prB), lkB = num(m.luckB), scB = m.scoreB;
        if (isTech) {
            const ml = currentMatchLength();
            prA = lkA = prB = lkB = '—';
            if (state.action === 'tech_draw')   { scA = ml; scB = ml; }
            else if (state.action === 'tech_a') { scA = ml; scB = 0; }
            else                                { scA = 0;  scB = ml; }
        }
        cell(2).innerHTML = prA; cell(3).innerHTML = lkA; cell(4).innerHTML = scA;
        cell(6).innerHTML = prB; cell(7).innerHTML = lkB; cell(8).innerHTML = scB;
        cell(9).innerHTML = statusLabel(state, m);

        tr.classList.toggle('f5-row-skipped', state.action === 'skip');
        tr.classList.toggle('f5-row-tech', isTech);
    }

    function statusLabel(state, m) {
        switch (state.action) {
            case 'skip':      return `<span class="f5-tag f5-tag-skip">Not played</span>`;
            case 'tech_draw': return `<span class="f5-tag f5-tag-tech">Technical draw</span>`;
            case 'tech_a':    return `<span class="f5-tag f5-tag-tech">Technical win: ${escHtml(m.playerA)}</span>`;
            case 'tech_b':    return `<span class="f5-tag f5-tag-tech">Technical win: ${escHtml(m.playerB)}</span>`;
            default:          return `<span class="f5-tag f5-tag-import">From CSV</span>`;
        }
    }

    /** Keep the headline count honest as rows are skipped or turned technical. */
    function updateImportCount() {
        const kept = rowStates.filter(s => s.action === 'import').length;
        const skipped = rowStates.filter(s => s.action === 'skip').length;
        const tech = rowStates.filter(s => s.action.startsWith('tech')).length;
        const parts = [`${kept} new match${kept === 1 ? '' : 'es'} to import`];
        if (tech) parts.push(`${tech} technical`);
        if (skipped) parts.push(`${skipped} skipped`);
        showMsg('import-msg', `${parts.join(' · ')}.`, 'info');
    }

    // Confirm — the per-row decisions land in TWO different places, deliberately:
    //
    //   NP (skip)  → the CSV itself. "Not played" is the CSV's own vocabulary (an
    //                all-zero row), and the match has no result to override — it
    //                simply must not enter the league. So the staged CSV carries
    //                that row zeroed.
    //   TA/TB/TD   → manual_overrides.json ONLY. A technical result is never
    //                written into leaguedata.csv: overrides always win on render,
    //                they survive re-imports, and the CSV keeps the source's real
    //                numbers so removing the override restores them.
    //
    // Everything else is staged byte-identical to the uploaded file.
    const confirmBtn = document.getElementById('confirm-import');
    confirmBtn.addEventListener('click', async () => {
        if (!parsedCSV) return;
        confirmBtn.disabled = true;

        try {

            const skipKeys = new Set();
            const techOverrides = [];
            const ts = new Date().toISOString();
            rowStates.forEach((state, i) => {
                const m = previewMatches[i];
                if (!m) return;
                if (state.action === 'skip') {
                    skipKeys.add(pairKey(m.playerA, m.playerB));
                } else if (state.action === 'tech_draw') {
                    techOverrides.push({
                        type: 'technical_draw', playerA: m.playerA, playerB: m.playerB,
                        reason: 'Technical draw', timestamp: ts
                    });
                } else if (state.action === 'tech_a' || state.action === 'tech_b') {
                    const winner = state.action === 'tech_a' ? m.playerA : m.playerB;
                    techOverrides.push({
                        type: 'technical_win', playerA: m.playerA, playerB: m.playerB,
                        winner, reason: `Technical win: ${winner}`, timestamp: ts
                    });
                }
            });

            const csvToStage = applySkipsToCsv(parsedCSV, skipKeys);
            let played = 0;
            try { played = parseCSV(csvToStage).length; } catch { /* count is best-effort */ }
            const detail = [`${played} match${played === 1 ? '' : 'es'}`];
            if (skipKeys.size) detail.push(`${skipKeys.size} skipped`);

            // Compose mode — hand the result to the caller instead of staging it.
            // The technical results travel as overrides exactly as they would
            // here; the caller stages them alongside the league it is creating.
            if (composeMode) {
                opts.onCompose({
                    csvText: csvToStage,
                    overrides: techOverrides,
                    players: [...getAllPlayersFromCSV(csvToStage)],
                    played,
                    skipped: skipKeys.size,
                });
                const note = techOverrides.length
                    ? ` ${techOverrides.length} technical result${techOverrides.length === 1 ? '' : 's'} will be created as overrides.`
                    : '';
                showMsg('import-msg', `${played} match${played === 1 ? '' : 'es'} added to the new league.${note}`, 'success');
                document.getElementById('preview-area').style.display = 'none';
                if (onDone) onDone();
                return;
            }

            addChange({
                type: 'update',
                target: T.leagueCsv(leagueId),
                content: csvToStage,
                description: `Import CSV: ${leagueId}`,
                category: 'league-data',
                subject: leagueId,
                detail: detail.join(', ')
            });

            if (techOverrides.length) await mergeStagedOverrides(leagueId, techOverrides);

            if (refreshBadge) refreshBadge();
            const extra = techOverrides.length
                ? ` ${techOverrides.length} technical result${techOverrides.length === 1 ? '' : 's'} staged as overrides.`
                : '';
            showMsg('import-msg', `CSV staged.${extra} Go to Pending Changes to publish.`, 'success');
            document.getElementById('preview-area').style.display = 'none';

            if (onDone) setTimeout(onDone, 1000);
        } catch (err) {
            confirmBtn.disabled = false;
            showMsg('import-msg', `Staging failed: ${err.message}`, 'error');
        }
    });

    // Cancel
    document.getElementById('cancel-import').addEventListener('click', () => {
        parsedCSV = null;
        rowStates = [];
        previewMatches = [];
        document.getElementById('preview-area').style.display = 'none';
        document.getElementById('csv-validation').innerHTML = '';
        document.getElementById('preview-host').innerHTML = '';
        dropZone.style.display = '';
    });
}

/**
 * Zero out the rows the admin marked NP, leaving every other byte of the uploaded
 * file untouched.
 *
 * Deliberately a LINE-level transform rather than a parse-and-rebuild: the CSV's
 * round structure is carried by its `Player,...` header lines and its row order,
 * and a league's shape (roster / rounds / rows-per-round) is fixed at creation —
 * validateCsvStructure rejects a file whose shape drifted. Dropping the line
 * entirely would break that shape, so the pairing stays in place and only its six
 * numeric fields become 0, which is exactly how csvParser spells "not played".
 */
function applySkipsToCsv(csvText, skipKeys) {
    if (!skipKeys || skipKeys.size === 0) return csvText;
    const eol = csvText.includes('\r\n') ? '\r\n' : '\n';
    return csvText.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.toLowerCase().startsWith('player')) return line;
        const parts = line.split(',');
        if (parts.length < 8) return line;
        if (!skipKeys.has(pairKey(parts[0].trim(), parts[4].trim()))) return line;
        const out = parts.slice();
        for (const i of [1, 2, 3, 5, 6, 7]) out[i] = '0';
        return out.join(',');
    }).join(eol);
}

/**
 * Merge technical overrides into the league's staged (or published) override set
 * and re-stage the lot — same read-staged-else-published merge Round Editor's
 * stageOverride does, so an import and a manual edit never clobber each other.
 */
async function mergeStagedOverrides(leagueId, newOverrides) {
    let overrides = [];
    const staged = getStagedContent(T.overrides(leagueId));
    if (staged) {
        try { overrides = JSON.parse(staged).overrides || []; } catch { /* corrupt → start clean */ }
    } else {
        try { overrides = await loadOverrides(leagueId); } catch { /* none published yet */ }
    }
    for (const o of newOverrides) {
        const key = pairKey(o.playerA, o.playerB);
        const idx = overrides.findIndex(x => pairKey(x.playerA, x.playerB) === key);
        if (idx !== -1) overrides[idx] = o; else overrides.push(o);
    }
    await stageManualOverrides(leagueId, overrides);
}

function pairKey(a, b) { return [a, b].sort().join('|'); }

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
    if (message) revealMsg(el);
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
