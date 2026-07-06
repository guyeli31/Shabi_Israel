/**
 * historicalChanges.js — Admin "Historical Changes" tab.
 *
 * Read-only chronological view of audit_log (RLS: SELECT granted to
 * `authenticated`), styled consistently with the existing Pending Changes
 * list. Each row already carries everything needed for the "workflow vs
 * manual" badge for free (see sql/supabase_schema.sql's log_audit_event()
 * trigger: changed_by = coalesce(auth.email(), 'external-source-automation')).
 *
 * "Undo" calls the restore_audit_row(log_id) Postgres RPC (SECURITY DEFINER,
 * granted to authenticated) — reverting a single row is done server-side in
 * one transaction rather than reassembled from JSON client-side. The "✕"
 * button both undoes a row AND purges it from history via
 * restore_and_delete_audit_row(log_id). Rows can be multi-selected for
 * either action in bulk — "Undo selected" loops restore_audit_row per row,
 * "Undo + remove selected" loops restore_and_delete_audit_row per row.
 */

import { supabase } from '../../data/supabaseClient.js';

const TABLE_META = {
    leagues:           { icon: '🏆', label: 'League' },
    matches:           { icon: '📊', label: 'Match' },
    manual_overrides:  { icon: '⚖️', label: 'Override' },
    match_history:     { icon: '🕘', label: 'Match history' },
    players_metadata:  { icon: '👤', label: 'Player' },
    landing_settings:  { icon: '🏠', label: 'Landing settings' },
};

const ACTION_LABEL = { INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' };

const LIMIT_KEY = 'shabi-history-limit';
const DEFAULT_LIMIT = 200;

function getHistoryLimit() {
    const v = parseInt(localStorage.getItem(LIMIT_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}

function setHistoryLimit(v) {
    localStorage.setItem(LIMIT_KEY, String(v));
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

function summarize(row) {
    const value = row.new_value || row.old_value || {};
    const meta = TABLE_META[row.table_name] || { icon: '📄', label: row.table_name };
    let subject = value.id || row.row_pk;
    if (row.table_name === 'matches' || row.table_name === 'manual_overrides' || row.table_name === 'match_history') {
        subject = `${value.player_a ?? ''} vs ${value.player_b ?? ''}`.trim();
    }
    return { icon: meta.icon, label: meta.label, subject, action: ACTION_LABEL[row.action] || row.action };
}

function diffRows(oldVal, newVal) {
    const keys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal || {})]);
    const rows = [];
    for (const key of keys) {
        if (key === 'created_at' || key === 'updated_at') continue;
        const before = oldVal ? oldVal[key] : undefined;
        const after = newVal ? newVal[key] : undefined;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        rows.push({ key, before, after });
    }
    return rows;
}

function bindLimitInput(container) {
    const input = container.querySelector('#history-limit-input');
    if (!input) return;
    const apply = () => {
        const v = parseInt(input.value, 10);
        if (!Number.isFinite(v) || v < 1 || v === getHistoryLimit()) return;
        setHistoryLimit(v);
        renderHistoricalChanges(container);
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') apply();
    });
    input.addEventListener('blur', apply);
}

export async function renderHistoricalChanges(container) {
    container.innerHTML = `
        <h1>Historical Changes</h1>
        <div class="admin-card"><p class="loading">Loading history...</p></div>`;

    const limit = getHistoryLimit();

    const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(limit);

    if (error) {
        container.innerHTML = `<h1>Historical Changes</h1><div class="admin-msg admin-msg-error">${esc(error.message)}</div>`;
        return;
    }

    const limitBarHtml = `
        <div class="history-limit-bar">
            <label for="history-limit-input">Show last</label>
            <input type="number" id="history-limit-input" class="history-limit-input" min="1" step="1" value="${limit}">
            <span>changes</span>
        </div>`;

    if (!data || data.length === 0) {
        container.innerHTML = `
            <h1>Historical Changes</h1>
            ${limitBarHtml}
            <div class="admin-card">
                <p style="color:var(--color-text-muted);text-align:center;padding:var(--space-lg)">
                    No changes recorded yet.
                </p>
            </div>`;
        bindLimitInput(container);
        return;
    }

    const itemsHtml = data.map((row) => {
        const s = summarize(row);
        const time = new Date(row.changed_at).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const isAutomation = row.changed_by === 'external-source-automation';
        const badge = isAutomation
            ? `<span class="status-pill" style="background:var(--color-bg-muted)">🤖 Automation</span>`
            : `<span class="status-pill status-completed">👤 ${esc(row.changed_by || 'unknown')}</span>`;

        return `
            <li class="pending-item history-item" data-log-id="${row.id}">
                <input type="checkbox" class="history-row-select" data-select-row="${row.id}" aria-label="Select this change">
                <span class="pending-item-desc">
                    <span aria-hidden="true">${s.icon}</span>
                    ${esc(s.label)} <b>${esc(s.subject)}</b> ${esc(s.action)}
                    ${badge}
                </span>
                <span class="pending-item-time">${time}</span>
                <button class="btn btn-secondary btn-sm" data-toggle-diff="${row.id}">Details</button>
                <button class="btn btn-danger btn-sm" data-undo="${row.id}">Undo</button>
                <button class="btn btn-danger btn-sm" data-undo-delete="${row.id}" title="Undo and remove from history">✕</button>
                <div class="history-diff" id="diff-${row.id}" hidden></div>
            </li>`;
    }).join('');

    container.innerHTML = `
        <h1>Historical Changes</h1>
        ${limitBarHtml}
        <div class="pending-panel">
            <div class="history-bulk-bar">
                <label class="history-select-all">
                    <input type="checkbox" id="history-select-all">
                    <span>${data.length} recent change${data.length === 1 ? '' : 's'}</span>
                </label>
                <span class="history-selected-count" id="history-selected-count" hidden></span>
                <button class="btn btn-danger btn-sm" id="history-bulk-undo" hidden>Undo selected</button>
                <button class="btn btn-danger btn-sm" id="history-bulk-undo-delete" hidden title="Undo and remove from history">Undo + remove selected</button>
            </div>
            <div id="history-msg"></div>
            <ul class="pending-list history-list">${itemsHtml}</ul>
        </div>`;

    bindLimitInput(container);

    const byId = new Map(data.map((row) => [String(row.id), row]));
    const selected = new Set();

    const selectAllEl = document.getElementById('history-select-all');
    const bulkUndoBtn = document.getElementById('history-bulk-undo');
    const bulkUndoDeleteBtn = document.getElementById('history-bulk-undo-delete');
    const selectedCountEl = document.getElementById('history-selected-count');
    const rowCheckboxes = Array.from(container.querySelectorAll('[data-select-row]'));

    function refreshBulkBar() {
        const n = selected.size;
        bulkUndoBtn.hidden = n === 0;
        bulkUndoDeleteBtn.hidden = n === 0;
        selectedCountEl.hidden = n === 0;
        selectedCountEl.textContent = n > 0 ? `${n} selected` : '';
        selectAllEl.checked = n > 0 && n === rowCheckboxes.length;
        selectAllEl.indeterminate = n > 0 && n < rowCheckboxes.length;
    }

    // Shift-click extends the selection as a contiguous range from the last
    // row clicked (Gmail/file-manager convention) — lets an admin sweep many
    // rows in two clicks instead of one at a time.
    let lastClickedIndex = null;

    rowCheckboxes.forEach((cb, idx) => {
        cb.addEventListener('click', (e) => {
            if (e.shiftKey && lastClickedIndex !== null) {
                const [from, to] = [lastClickedIndex, idx].sort((a, b) => a - b);
                for (let i = from; i <= to; i++) {
                    const rangeCb = rowCheckboxes[i];
                    rangeCb.checked = cb.checked;
                    const rangeId = rangeCb.dataset.selectRow;
                    if (rangeCb.checked) selected.add(rangeId); else selected.delete(rangeId);
                }
                refreshBulkBar();
            }
            lastClickedIndex = idx;
        });
        cb.addEventListener('change', () => {
            const id = cb.dataset.selectRow;
            if (cb.checked) selected.add(id); else selected.delete(id);
            refreshBulkBar();
        });
    });

    selectAllEl.addEventListener('change', () => {
        selected.clear();
        rowCheckboxes.forEach((cb) => {
            cb.checked = selectAllEl.checked;
            if (selectAllEl.checked) selected.add(cb.dataset.selectRow);
        });
        refreshBulkBar();
    });

    bulkUndoBtn.addEventListener('click', async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        if (!confirm(`Undo ${ids.length} selected change${ids.length === 1 ? '' : 's'}? This reverts each row to its previous state.`)) return;
        bulkUndoBtn.disabled = true;
        bulkUndoBtn.textContent = 'Undoing...';
        const msgEl = document.getElementById('history-msg');
        let failed = 0;
        for (const id of ids) {
            const { error: rpcErr } = await supabase.rpc('restore_audit_row', { log_id: Number(id) });
            if (rpcErr) failed++;
        }
        if (failed > 0) {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-error">${failed} of ${ids.length} undo${ids.length === 1 ? '' : 's'} failed.</div>`;
            bulkUndoBtn.disabled = false;
            bulkUndoBtn.textContent = 'Undo selected';
        } else {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-success">${ids.length} change${ids.length === 1 ? '' : 's'} undone.</div>`;
            setTimeout(() => renderHistoricalChanges(container), 800);
        }
    });

    bulkUndoDeleteBtn.addEventListener('click', async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        if (!confirm(`Undo ${ids.length} selected change${ids.length === 1 ? '' : 's'} and remove ${ids.length === 1 ? 'it' : 'them'} from history? This reverts each row and cannot be shown here again.`)) return;
        bulkUndoDeleteBtn.disabled = true;
        bulkUndoDeleteBtn.textContent = 'Removing...';
        const msgEl = document.getElementById('history-msg');
        let failed = 0;
        for (const id of ids) {
            const { error: rpcErr } = await supabase.rpc('restore_and_delete_audit_row', { log_id: Number(id) });
            if (rpcErr) failed++;
        }
        if (failed > 0) {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-error">${failed} of ${ids.length} undo${ids.length === 1 ? '' : 's'} failed.</div>`;
            bulkUndoDeleteBtn.disabled = false;
            bulkUndoDeleteBtn.textContent = 'Undo + remove selected';
        } else {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-success">${ids.length} change${ids.length === 1 ? '' : 's'} undone and removed from history.</div>`;
            setTimeout(() => renderHistoricalChanges(container), 800);
        }
    });

    container.querySelectorAll('[data-toggle-diff]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.toggleDiff;
            const el = document.getElementById(`diff-${id}`);
            if (!el) return;
            if (el.hidden) {
                const row = byId.get(id);
                const rows = diffRows(row.old_value, row.new_value);
                el.innerHTML = rows.length === 0
                    ? '<p style="color:var(--color-text-muted)">No field-level changes to show.</p>'
                    : `<table class="admin-table">
                        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                        <tbody>${rows.map((r) => `
                            <tr>
                                <td>${esc(r.key)}</td>
                                <td>${esc(JSON.stringify(r.before))}</td>
                                <td>${esc(JSON.stringify(r.after))}</td>
                            </tr>`).join('')}</tbody>
                       </table>`;
            }
            el.hidden = !el.hidden;
        });
    });

    container.querySelectorAll('[data-undo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.undo);
            if (!confirm('Undo this change? This reverts the row to its previous state.')) return;
            btn.disabled = true;
            btn.textContent = 'Undoing...';
            const { error: rpcErr } = await supabase.rpc('restore_audit_row', { log_id: id });
            const msgEl = document.getElementById('history-msg');
            if (rpcErr) {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Undo failed: ${esc(rpcErr.message)}</div>`;
                btn.disabled = false;
                btn.textContent = 'Undo';
            } else {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-success">Change undone.</div>`;
                setTimeout(() => renderHistoricalChanges(container), 800);
            }
        });
    });

    container.querySelectorAll('[data-undo-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.undoDelete);
            if (!confirm('Undo this change and remove it from history? This reverts the row and cannot be shown here again.')) return;
            btn.disabled = true;
            btn.textContent = '...';
            const { error: rpcErr } = await supabase.rpc('restore_and_delete_audit_row', { log_id: id });
            const msgEl = document.getElementById('history-msg');
            if (rpcErr) {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Undo failed: ${esc(rpcErr.message)}</div>`;
                btn.disabled = false;
                btn.textContent = '✕';
            } else {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-success">Change undone and removed from history.</div>`;
                setTimeout(() => renderHistoricalChanges(container), 800);
            }
        });
    });
}
