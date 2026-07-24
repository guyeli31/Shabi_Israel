/**
 * historicalChanges.js — Admin "Historical Changes" tab.
 *
 * ONE row per logical change (a Publish, or an automation sync), read from the
 * `audit_batch_summary` view (see sql/audit_batching.sql). Each publish fans out
 * across the DB into a primary edit + valid derived rows (match_history
 * reconcile) + no-op "ghost" UPDATEs; here it collapses to a single row whose
 * label uses the SAME renderChangeLabel() as Pending Changes (changeVocabulary.js),
 * so the two views can never drift. Valid derived rows appear under a "Details"
 * toggle (lazy-loaded); ghosts are hidden entirely.
 *
 * "Undo" reverts the whole batch via restore_batch(batch_id) and logs the revert
 * as one tidy "Reverted…" row. "✕" reverts AND purges the batch from history via
 * restore_and_delete_batch(batch_id). Both are single server-side transactions,
 * so the DB returns to exactly its pre-publish state. Batches can be
 * multi-selected for either action in bulk.
 */

import { supabase } from '../../data/supabaseClient.js';
import { renderChangeLabel } from './changeVocabulary.js';
import { describeFieldChange, describeEntitySummary } from './changeDetails.js';

// Per-table icon + label for the attachment sub-rows shown under "Details".
const ATTACHMENT_META = {
    leagues:          { icon: '⚙️', label: 'League' },
    matches:          { icon: '📊', label: 'Match' },
    manual_overrides: { icon: '⚖️', label: 'Override' },
    match_history:    { icon: '🕘', label: 'Match history' },
    players_metadata: { icon: '👤', label: 'Player' },
    landing_settings: { icon: '🏠', label: 'Landing settings' },
};

const ACTION_LABEL = { INSERT: 'created', UPDATE: 'updated', DELETE: 'removed' };

const LIMIT_KEY = 'shabi-history-limit';
const DEFAULT_LIMIT = 100;

function getHistoryLimit() {
    const v = parseInt(localStorage.getItem(LIMIT_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}
function setHistoryLimit(v) { localStorage.setItem(LIMIT_KEY, String(v)); }

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

// A ghost: an UPDATE that changed nothing real (updated_at / last_updated aside).
// Mirrors public.audit_is_noop() so the client hides exactly what the DB counts.
function isGhost(row) {
    if (row.action !== 'UPDATE' || !row.old_value || !row.new_value) return false;
    const strip = (o) => {
        const c = { ...o };
        delete c.updated_at;
        if (row.table_name === 'leagues') delete c.last_updated;
        return JSON.stringify(c);
    };
    return strip(row.old_value) === strip(row.new_value);
}

function attachmentSubject(row) {
    const v = row.new_value || row.old_value || {};
    if (['matches', 'manual_overrides', 'match_history'].includes(row.table_name)) {
        return `${v.player_a ?? ''} vs ${v.player_b ?? ''}`.trim();
    }
    return v.id || row.row_pk || '';
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
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    input.addEventListener('blur', apply);
}

export async function renderHistoricalChanges(container) {
    container.innerHTML = `
        <h1>Historical Changes</h1>
        <div class="admin-card"><p class="loading">Loading history...</p></div>`;

    const limit = getHistoryLimit();

    // Only batches with a real change (primary or derived); fully-ghost
    // "housekeeping" batches (e.g. a lone last_updated bump) are hidden.
    const { data, error } = await supabase
        .from('audit_batch_summary')
        .select('*')
        .or('primary_rows.gt.0,derived_rows.gt.0')
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

    const itemsHtml = data.map((b) => {
        const time = new Date(b.changed_at).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const isAutomation = (b.changed_by || '').includes('automation');
        const badge = isAutomation
            ? `<span class="status-pill" style="background:var(--color-bg-muted)">🤖 Automation</span>`
            : `<span class="status-pill status-completed">👤 ${esc(b.changed_by || 'unknown')}</span>`;

        const label = renderChangeLabel({
            topic: b.topic, subject: b.subject, icon: b.icon, text: b.specific, detail: b.detail,
        });

        // "Related changes" = the valid rows this publish created/updated BEYOND
        // the single headline change (e.g. new players created alongside a new
        // league, or the match_history reconcile). Ghosts (no-op rows) are not
        // counted here — they're irrelevant and only footnoted inside Details.
        const related = Math.max(0, (b.primary_rows || 0) + (b.derived_rows || 0) - 1);
        const countPill = related > 0
            ? `<span class="history-count-pill">+${related} related change${related === 1 ? '' : 's'}</span>` : '';

        const rowSummary = `${b.specific} ${b.subject || ''}`.replace(/\s+/g, ' ').trim();

        return `
            <li class="pending-item history-item" data-batch-id="${b.id}">
                <input type="checkbox" class="history-row-select" data-select-row="${b.id}" aria-label="Select this change">
                <span class="pending-item-desc">
                    ${label}
                    ${countPill}
                    ${badge}
                </span>
                <span class="pending-item-time">${time}</span>
                <button class="btn btn-secondary btn-sm" data-toggle-diff="${b.id}">Details</button>
                <button class="btn btn-danger btn-sm" data-undo="${b.id}" data-track="Action: Undo — ${esc(rowSummary)} (Admin Mode)">Undo</button>
                <button class="btn btn-danger btn-sm" data-undo-delete="${b.id}" title="Undo and remove from history" data-track="Action: Remove from history — ${esc(rowSummary)} (Admin Mode)">✕</button>
                <div class="history-diff" id="diff-${b.id}" hidden></div>
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
    wireBulk(container, data);
    wireDiffToggles(container);
    wireRowActions(container);
}

// ---- Details (lazy-load one batch's non-ghost rows on expand) ----
function wireDiffToggles(container) {
    container.querySelectorAll('[data-toggle-diff]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleDiff;
            const el = document.getElementById(`diff-${id}`);
            if (!el) return;
            if (!el.hidden) { el.hidden = true; return; }

            if (!el.dataset.loaded) {
                el.innerHTML = `<p style="color:var(--color-text-muted)">Loading…</p>`;
                el.hidden = false;
                const { data: rows, error } = await supabase
                    .from('audit_log')
                    .select('id, table_name, action, old_value, new_value, row_pk')
                    .eq('batch_id', id)
                    .order('id', { ascending: true });
                if (error) { el.innerHTML = `<p class="admin-msg admin-msg-error">${esc(error.message)}</p>`; return; }

                const visible = (rows || []).filter((r) => !isGhost(r));
                const ghostCount = (rows || []).length - visible.length;
                el.innerHTML = renderDetails(visible, ghostCount);
                el.dataset.loaded = '1';
            }
            el.hidden = false;
        });
    });
}

function renderDetails(rows, ghostCount) {
    if (rows.length === 0) {
        return `<p style="color:var(--color-text-muted)">No field-level changes to show.</p>`;
    }
    const blocks = rows.map((r) => {
        const meta = ATTACHMENT_META[r.table_name] || { icon: '📄', label: r.table_name };
        const subj = attachmentSubject(r);

        // Creates and deletes summarise the whole row in one line; updates list
        // one plain-English bullet per changed field.
        let lines;
        if (r.action === 'INSERT' || r.action === 'DELETE') {
            lines = `<div class="history-field-line">${esc(describeEntitySummary(r.table_name, r.action, r.old_value, r.new_value))}</div>`;
        } else {
            const diff = diffRows(r.old_value, r.new_value);
            lines = diff.length === 0
                ? `<div class="history-field-line">(no field-level changes)</div>`
                : diff.map((d) =>
                    `<div class="history-field-line">• ${esc(describeFieldChange(r.table_name, d.key, d.before, d.after))}</div>`
                  ).join('');
        }
        return `
            <div class="history-attach">
                <div class="history-attach-head">
                    <span aria-hidden="true">${meta.icon}</span>
                    ${esc(meta.label)} <b>${esc(subj)}</b> — ${esc(ACTION_LABEL[r.action] || r.action)}
                </div>
                ${lines}
            </div>`;
    }).join('');
    const footnote = ghostCount > 0
        ? `<p class="history-ghost-note" style="margin-top:var(--space-sm)">+${ghostCount} unchanged row${ghostCount === 1 ? '' : 's'} were re-written by this publish and are hidden.</p>`
        : '';
    return blocks + footnote;
}

// ---- Per-row Undo / Undo+Remove (whole batch) ----
function wireRowActions(container) {
    container.querySelectorAll('[data-undo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.undo;
            if (!confirm('Undo this change? This reverts the whole change (and its related rows) to the previous state.')) return;
            btn.disabled = true; btn.textContent = 'Undoing...';
            const { error } = await supabase.rpc('restore_batch', { p_batch_id: id });
            const msgEl = document.getElementById('history-msg');
            if (error) {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Undo failed: ${esc(error.message)}</div>`;
                btn.disabled = false; btn.textContent = 'Undo';
            } else {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-success">Change undone.</div>`;
                setTimeout(() => renderHistoricalChanges(container), 800);
            }
        });
    });

    container.querySelectorAll('[data-undo-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.undoDelete;
            if (!confirm('Undo this change and remove it from history? This reverts everything it did and cannot be shown here again.')) return;
            btn.disabled = true; btn.textContent = '...';
            const { error } = await supabase.rpc('restore_and_delete_batch', { p_batch_id: id });
            const msgEl = document.getElementById('history-msg');
            if (error) {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Undo failed: ${esc(error.message)}</div>`;
                btn.disabled = false; btn.textContent = '✕';
            } else {
                msgEl.innerHTML = `<div class="admin-msg admin-msg-success">Change undone and removed from history.</div>`;
                setTimeout(() => renderHistoricalChanges(container), 800);
            }
        });
    });
}

// ---- Multi-select + bulk actions (batch-scoped) ----
function wireBulk(container, data) {
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

    async function runBulk(rpc, btn, verb, doneLabel) {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        if (!confirm(`${verb} ${ids.length} selected change${ids.length === 1 ? '' : 's'}? Each reverts to its previous state.`)) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Working...';
        const msgEl = document.getElementById('history-msg');
        let failed = 0;
        for (const id of ids) {
            const { error } = await supabase.rpc(rpc, { p_batch_id: id });
            if (error) failed++;
        }
        if (failed > 0) {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-error">${failed} of ${ids.length} failed.</div>`;
            btn.disabled = false; btn.textContent = original;
        } else {
            msgEl.innerHTML = `<div class="admin-msg admin-msg-success">${ids.length} change${ids.length === 1 ? '' : 's'} ${doneLabel}.</div>`;
            setTimeout(() => renderHistoricalChanges(container), 800);
        }
    }

    bulkUndoBtn.addEventListener('click', () => runBulk('restore_batch', bulkUndoBtn, 'Undo', 'undone'));
    bulkUndoDeleteBtn.addEventListener('click', () => runBulk('restore_and_delete_batch', bulkUndoDeleteBtn, 'Undo and remove', 'undone and removed from history'));
}
