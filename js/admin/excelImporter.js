/**
 * excelImporter.js — Import Excel (.xlsx) or CSV files via drag & drop or file picker.
 * Uses SheetJS (loaded from CDN in admin.html) for Excel parsing.
 */

import { addChange } from './stagingStore.js';

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
            <div id="preview-area" style="display:none">
                <h3 style="margin-bottom:var(--space-sm)">Preview</h3>
                <div class="table-scroll" style="max-height:400px;overflow:auto;margin-bottom:var(--space-md)">
                    <table class="admin-table" id="preview-table"></table>
                </div>
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

        let tableHtml = '<thead><tr>';
        const headerParts = lines[0].split(',');
        for (const h of headerParts) {
            tableHtml += `<th scope="col">${escHtml(h.trim())}</th>`;
        }
        tableHtml += '</tr></thead><tbody>';

        for (let i = 1; i < Math.min(lines.length, 50); i++) {
            const parts = lines[i].split(',');
            tableHtml += '<tr>';
            for (const p of parts) {
                tableHtml += `<td>${escHtml(p.trim())}</td>`;
            }
            tableHtml += '</tr>';
        }

        if (lines.length > 50) {
            tableHtml += `<tr><td colspan="${headerParts.length}" style="color:var(--color-text-muted)">... and ${lines.length - 50} more rows</td></tr>`;
        }

        tableHtml += '</tbody>';

        document.getElementById('preview-table').innerHTML = tableHtml;
        document.getElementById('preview-area').style.display = 'block';
        dropZone.style.display = 'none';

        showMsg('import-msg', `Loaded ${lines.length - 1} data rows.`, 'info');
    }

    // Confirm
    document.getElementById('confirm-import').addEventListener('click', () => {
        if (!parsedCSV) return;

        const encoded = encodeURIComponent(leagueId);
        addChange({
            type: 'update',
            path: `leagues/${encoded}/leaguedata.csv`,
            content: parsedCSV,
            description: `Import CSV: ${leagueId}`
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
        dropZone.style.display = '';
    });
}

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
