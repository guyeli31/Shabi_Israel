/**
 * excelImporter.js — Import Excel (.xlsx) or CSV files via drag & drop or file picker.
 * Uses SheetJS (loaded from CDN in admin.html) for Excel parsing.
 */

import { addChange } from './stagingStore.js';
import { computeCsvImportReport, renderCsvImportReport } from './csvValidation.js';
import { parseCSV } from '../data/csvParser.js';
import { mountMFTable } from '../../table-lab/formats/mf/mount.js';
import { formatNumber } from '../utils/helpers.js';
import { revealMsg } from './msgScroll.js';

/**
 * Render the Excel/CSV import UI into a container.
 * @param {HTMLElement} container
 * @param {string} leagueId — the league folder name
 * @param {function} refreshBadge
 * @param {function} onDone — called after successful staging
 */
export function renderExcelImporter(container, leagueId, refreshBadge, onDone) {
    container.innerHTML = `
        <div class="admin-card">
            <h2>Import CSV / Excel</h2>
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
                    <button class="btn btn-success" id="confirm-import">Confirm & Stage</button>
                    <button class="btn btn-secondary" id="cancel-import">Cancel</button>
                </div>
            </div>
        </div>`;

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    let parsedCSV = null;

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
            const report = await computeCsvImportReport(leagueId, csvText);
            if (el) el.innerHTML = renderCsvImportReport(report);
            renderPreview(host, report);
        } catch (err) {
            if (el) el.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-sm) 0">Compatibility check unavailable: ${escHtml(err.message)}</p>`;
            if (host) host.innerHTML = '';
        }
    }

    // F5 — CSV Import Preview. Shows ONLY the "N updates": matches played in the
    // uploaded CSV that were not already played and are not override-covered.
    // Rendered with the canonical MF renderer (font-small, sticky left column).
    function renderPreview(host, report) {
        if (!host) return;
        const newMatches = report.newMatches || [];
        showMsg('import-msg', `${newMatches.length} new match${newMatches.length === 1 ? '' : 'es'} to import.`, 'info');
        if (newMatches.length === 0) {
            host.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-sm) 0">No new matches in this upload.</p>`;
            return;
        }
        const num = (v) => v == null ? '—' : formatNumber(v);
        mountMFTable(host, {
            tableId: 'F5',
            fontClass: 'font-small',
            stickyCols: 1,
            data: newMatches,
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
            ],
        });
    }

    // Confirm
    document.getElementById('confirm-import').addEventListener('click', () => {
        if (!parsedCSV) return;

        const encoded = encodeURIComponent(leagueId);
        let played = 0;
        try { played = parseCSV(parsedCSV).length; } catch { /* count is best-effort */ }
        addChange({
            type: 'update',
            path: `leagues/${encoded}/leaguedata.csv`,
            content: parsedCSV,
            description: `Import CSV: ${leagueId}`,
            category: 'league-data',
            subject: leagueId,
            detail: `${played} match${played === 1 ? '' : 'es'}`
        });

        if (refreshBadge) refreshBadge();
        showMsg('import-msg', 'CSV staged. Go to Pending Changes to publish.', 'success');
        document.getElementById('preview-area').style.display = 'none';

        if (onDone) setTimeout(onDone, 1000);
    });

    // Cancel
    document.getElementById('cancel-import').addEventListener('click', () => {
        parsedCSV = null;
        document.getElementById('preview-area').style.display = 'none';
        document.getElementById('csv-validation').innerHTML = '';
        document.getElementById('preview-host').innerHTML = '';
        dropZone.style.display = '';
    });
}

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
