/**
 * stagingStore.js — Manages pending changes in localStorage before publishing to GitHub.
 *
 * Changes accumulate locally. The admin reviews them, can cancel individual changes,
 * and publishes all at once. Each publish also saves a snapshot for league history.
 */

import * as supabaseAdmin from './supabaseAdmin.js';
import { supabase } from '../data/supabaseClient.js';
import { CATEGORY_TAXONOMY, CATEGORY_RANK } from './render/changeVocabulary.js';

const STORAGE_KEY = 'shabi-admin-staging';

/**
 * A staged change object:
 * {
 *   type: 'create' | 'update' | 'delete',
 *   path: string,           // repo file path
 *   content: string|null,   // file content (null for delete)
 *   binary: boolean,        // true if content is base64-encoded binary
 *   description: string,    // human-readable description (Hebrew OK)
 *   timestamp: string        // ISO timestamp
 * }
 */

function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function save(changes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
}

/**
 * Add a change to the staging area.
 */
export function addChange(change) {
    const changes = load();
    // If a change for the same path already exists, replace it
    const existing = changes.findIndex(c => c.path === change.path);
    if (existing !== -1) {
        const updated = { ...change, timestamp: new Date().toISOString() };
        // Mark as updated if replacing an earlier change
        if (!updated.description.includes('(updated)')) {
            updated.description = updated.description + ' (updated)';
        }
        changes[existing] = updated;
    } else {
        changes.push({ ...change, timestamp: new Date().toISOString() });
    }
    save(changes);
}

/**
 * Get all pending changes.
 */
export function getChanges() {
    return load();
}

/**
 * Remove a single change by index.
 */
export function removeChange(index) {
    const changes = load();
    if (index >= 0 && index < changes.length) {
        changes.splice(index, 1);
        save(changes);
    }
}

/**
 * Remove all changes belonging to a group.
 */
export function removeGroup(groupId) {
    const changes = load().filter(c => c.group !== groupId);
    save(changes);
}

/**
 * Clear all pending changes.
 */
export function clearChanges() {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get the staged content for a specific path (if any).
 * Returns the content string or null if no staged change exists.
 */
export function getStagedContent(path) {
    const changes = load();
    const match = changes.find(c => c.path === path);
    return match ? match.content : null;
}

// ---- Manual overrides: delta-based staging ----
// A staged manual_overrides.json change carries the league's PUBLISHED override
// set as `baselineOverrides`. Pending Changes shows (and the badge counts) only
// the delta vs that baseline — so editing one override never floods the list with
// the league's other, already-published overrides.

/** Stable key for a match override (order-independent on the player pair). */
export function overrideKey(o) {
    return [o.playerA, o.playerB].sort().join('|');
}

function canon(o) {
    return JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
}

/**
 * Diff a staged overrides array against the published baseline.
 * @returns {{added: {override, index}[], changed: {override, index}[], removed: object[]}}
 *   added   — a brand-new override not present in the baseline
 *   changed — an override that existed in the baseline but was edited
 *   removed — present in baseline but gone from staged
 */
export function diffOverrides(staged, baseline) {
    const baseMap = new Map((baseline || []).map(o => [overrideKey(o), o]));
    const stagedKeys = new Set();
    const added = [];
    const changed = [];
    for (let i = 0; i < staged.length; i++) {
        const o = staged[i];
        const k = overrideKey(o);
        stagedKeys.add(k);
        const b = baseMap.get(k);
        if (!b) added.push({ override: o, index: i });
        else if (canon(b) !== canon(o)) changed.push({ override: o, index: i });
    }
    const removed = [];
    for (const o of (baseline || [])) {
        if (!stagedKeys.has(overrideKey(o))) removed.push(o);
    }
    return { added, changed, removed };
}

/** Total number of delta items (added + changed + removed) for a diff result. */
function deltaCount(d) {
    return d.added.length + d.changed.length + d.removed.length;
}

/**
 * Stage a league's full overrides array, capturing the published baseline so the
 * display/count can show only the delta. Reuses an already-captured baseline so
 * repeated edits in one session keep comparing against the original published set.
 * If the result is identical to the baseline, any staged change is dropped.
 */
export async function stageManualOverrides(leagueId, overrides) {
    const enc = encodeURIComponent(leagueId);
    const path = `leagues/${enc}/manual_overrides.json`;

    const existing = load().find(c => c.path === path);
    let baseline = existing && existing.baselineOverrides ? existing.baselineOverrides : null;
    if (!baseline) {
        baseline = [];
        try {
            const resp = await fetch(path);
            if (resp.ok) baseline = (await resp.json()).overrides || [];
        } catch { /* no published overrides file → empty baseline */ }
    }

    if (deltaCount(diffOverrides(overrides, baseline)) === 0) {
        // No net change vs published — remove any staged change for this path.
        const changes = load().filter(c => c.path !== path);
        save(changes);
        return;
    }

    addChange({
        type: 'update',
        path,
        content: JSON.stringify({ overrides }, null, 2),
        description: `Overrides: ${leagueId}`,
        category: 'match-override',
        subject: leagueId,
        baselineOverrides: baseline
    });
}

/** Drop the staged overrides change for a path if it no longer differs from baseline. */
function dropOverridesChangeIfClean(changes, idx) {
    try {
        const staged = JSON.parse(changes[idx].content).overrides || [];
        if (deltaCount(diffOverrides(staged, changes[idx].baselineOverrides || [])) === 0) {
            changes.splice(idx, 1);
        }
    } catch { /* leave as-is on parse error */ }
}

/**
 * Cancel a staged ADDED override (remove it from the staged file entirely).
 * Used for brand-new overrides that have no published baseline to fall back to.
 * If the file then matches the published baseline, the whole change is dropped.
 */
export function removeOverrideFromChange(path, overrideIndex) {
    const changes = load();
    const idx = changes.findIndex(c => c.path === path);
    if (idx === -1) return;

    try {
        const data = JSON.parse(changes[idx].content);
        const overrides = data.overrides || [];
        if (overrideIndex >= 0 && overrideIndex < overrides.length) {
            overrides.splice(overrideIndex, 1);
        }
        data.overrides = overrides;
        changes[idx].content = JSON.stringify(data, null, 2);
        dropOverridesChangeIfClean(changes, idx);
        save(changes);
    } catch { /* ignore parse errors */ }
}

/**
 * Revert a staged override to its PUBLISHED baseline value, by key. Handles both
 * cancel cases for overrides that existed before this session:
 *   - a CHANGED (edited) override → replace the staged edit with the baseline value
 *   - a REMOVED override          → re-insert the baseline value
 * The baseline value is looked up from the change itself, so nothing is round-tripped
 * through the DOM. If the file then matches the baseline, the whole change is dropped.
 */
export function restoreOverrideToChange(path, key) {
    const changes = load();
    const idx = changes.findIndex(c => c.path === path);
    if (idx === -1) return;

    const override = (changes[idx].baselineOverrides || []).find(o => overrideKey(o) === key);
    if (!override) return;

    try {
        const data = JSON.parse(changes[idx].content);
        const overrides = data.overrides || [];
        const pos = overrides.findIndex(o => overrideKey(o) === key);
        if (pos >= 0) overrides[pos] = override; // edited → revert to published
        else overrides.push(override);           // removed → restore published
        data.overrides = overrides;
        changes[idx].content = JSON.stringify(data, null, 2);
        dropOverridesChangeIfClean(changes, idx);
        save(changes);
    } catch { /* ignore parse errors */ }
}

/**
 * Remove a single player from a grouped player-metadata change.
 * If no players remain, removes the entire group.
 * Also removes any associated photo change for this player.
 */
export function removePlayerFromGroup(playerName) {
    const changes = load();
    let modified = false;

    // Find the players_metadata.json change (has editedPlayers)
    const metaIdx = changes.findIndex(c => c.editedPlayers && c.editedPlayers.includes(playerName));
    if (metaIdx !== -1) {
        const c = changes[metaIdx];
        // Remove player from editedPlayers
        c.editedPlayers = c.editedPlayers.filter(p => p !== playerName);

        // Remove player from JSON content
        try {
            const data = JSON.parse(c.content);
            delete data[playerName];
            c.content = JSON.stringify(data, null, 2);
        } catch { /* ignore */ }

        if (c.editedPlayers.length === 0) {
            // Remove all changes in this group
            const groupId = c.group;
            const toRemove = new Set();
            for (let i = 0; i < changes.length; i++) {
                if (changes[i].group === groupId) toRemove.add(i);
            }
            for (const idx of [...toRemove].sort((a, b) => b - a)) {
                changes.splice(idx, 1);
            }
        } else {
            c.description = `Player metadata (${c.editedPlayers.length} player${c.editedPlayers.length > 1 ? 's' : ''})`;
        }
        modified = true;
    }

    // Remove photo change for this player
    const photoIdx = changes.findIndex(c =>
        c.description && c.description === `Player photo (${playerName})`
    );
    if (photoIdx !== -1) {
        changes.splice(photoIdx, 1);
        modified = true;
    }

    if (modified) save(changes);
}

/**
 * Get number of pending changes (display count).
 * Groups count as 1, manual_overrides.json counts as N (one per override).
 */
export function getChangeCount() {
    const changes = load();
    const seen = new Set();
    let count = 0;
    for (const c of changes) {
        if (c.group) {
            if (!seen.has(c.group)) {
                seen.add(c.group);
                count += (c.editedPlayers && c.editedPlayers.length > 0) ? c.editedPlayers.length : 1;
            }
        } else if (c.path && c.path.endsWith('manual_overrides.json') && c.content) {
            try {
                const staged = JSON.parse(c.content).overrides || [];
                count += deltaCount(diffOverrides(staged, c.baselineOverrides || []));
            } catch { count++; }
        } else {
            count++;
        }
    }
    return count;
}

/**
 * Parse a staged change's repo-style path into a (kind, ids) descriptor, so
 * publishAll() can dispatch to the right supabaseAdmin.js function. Every
 * staged path already carries the FULL current content for what it
 * represents (see file header) — this function only figures out WHERE it goes.
 */
function parseChangePath(path) {
    let m;
    if ((m = path.match(/^leagues\/([^/]+)\/league_params\.json$/))) return { kind: 'league_params', leagueId: decodeURIComponent(m[1]) };
    if ((m = path.match(/^leagues\/([^/]+)\/leaguedata\.csv$/))) return { kind: 'leaguedata_csv', leagueId: decodeURIComponent(m[1]) };
    if ((m = path.match(/^leagues\/([^/]+)\/manual_overrides\.json$/))) return { kind: 'manual_overrides', leagueId: decodeURIComponent(m[1]) };
    if (path === 'leagues/players_metadata.json') return { kind: 'players_metadata' };
    if (path === 'leagues/landing_settings.json') return { kind: 'landing_settings' };
    if (path === 'leagues/sync_settings.json') return { kind: 'sync_settings' };
    if ((m = path.match(/^assets\/flags\/([^/]+)\.png$/))) return { kind: 'flag_asset', code: m[1] };
    if ((m = path.match(/^assets\/players\/(.+)$/))) return { kind: 'player_photo', filename: m[1] };
    return { kind: 'unknown' };
}

/**
 * Publish all pending changes to Supabase sequentially. Each change's `path`
 * is parsed (see parseChangePath) and dispatched to the matching
 * supabaseAdmin.js function — Admin no longer touches GitHub at all.
 *
 * After publishing league data changes, saves a history snapshot + reconciles
 * match_history, same as before (now against Supabase instead of repo files).
 *
 * @param {function} onProgress — callback(index, total, description) for progress UI
 * @returns {Promise<{success: boolean, published: number, errors: string[]}>}
 */
export async function publishAll(onProgress) {
    const changes = load();
    if (changes.length === 0) return { success: true, published: 0, errors: [] };

    const errors = [];
    let published = 0;

    // Batch granularity = one logical UNIT per Historical row, matching Pending:
    // a shared `group` (e.g. create-league + its players) is ONE unit; every
    // ungrouped change is its own unit. So editing settings of X different
    // leagues in one publish becomes X separate units → X separate Historical
    // rows (each with its own valid related rows), never one lump.
    const units = [];
    const unitByKey = new Map();
    changes.forEach((change, i) => {
        const key = change.group || `single:${i}`;
        let u = unitByKey.get(key);
        if (!u) { u = { changes: [] }; unitByKey.set(key, u); units.push(u); }
        u.changes.push(change);
    });

    let progressIdx = 0;
    for (const unit of units) {
        // Audit high-water mark before this unit: everything it logs (its write
        // + snapshot/reconcile fan-out) gets tagged into ONE batch, headlined by
        // the unit's primary staged change (same wording as its Pending row).
        // Best-effort — a failure here must never block publishing.
        let watermark = null;
        try {
            const { data } = await supabase.rpc('current_max_audit_id');
            if (data != null) watermark = data;
        } catch { /* batching unavailable (migration not run) → publish anyway */ }

        const unitLeagues = new Set(); // leagues in THIS unit needing snapshot/reconcile

        for (const change of unit.changes) {
            if (onProgress) onProgress(progressIdx++, changes.length, change.description);
            const desc = parseChangePath(change.path);
            try {
                switch (desc.kind) {
                    case 'league_params':
                        // Settings only (type/title/prizes/etc.) — no match/override
                        // data changed, so this deliberately does NOT add to
                        // unitLeagues: no snapshot, no match_history reconcile, no
                        // last_updated bump. That field is a public-facing "when were
                        // results last updated" stat (see leagueHeader.js) — a pure
                        // settings edit touching it would be misleading. It also
                        // sidesteps a delete case bug: createSnapshot() afterward
                        // would violate the league_snapshots FK once the league row
                        // is gone.
                        if (change.type === 'delete') await supabaseAdmin.deleteLeague(desc.leagueId);
                        else await supabaseAdmin.upsertLeague(desc.leagueId, JSON.parse(change.content));
                        break;
                    case 'leaguedata_csv':
                        if (change.type !== 'delete') {
                            // A standalone delete is redundant — deleteLeague() already
                            // cascades matches when the league itself is removed.
                            await supabaseAdmin.bulkImportCSV(desc.leagueId, change.content);
                            unitLeagues.add(desc.leagueId);
                        }
                        break;
                    case 'manual_overrides':
                        await supabaseAdmin.syncOverrides(desc.leagueId, JSON.parse(change.content).overrides || []);
                        unitLeagues.add(desc.leagueId);
                        break;
                    case 'players_metadata':
                        await supabaseAdmin.syncPlayersMetadata(JSON.parse(change.content));
                        break;
                    case 'landing_settings':
                        await supabaseAdmin.updateLandingSettings(JSON.parse(change.content));
                        break;
                    case 'sync_settings':
                        await supabaseAdmin.updateSyncSettings(JSON.parse(change.content));
                        break;
                    case 'flag_asset':
                        await supabaseAdmin.uploadFlagAsset(desc.code, change.content);
                        break;
                    case 'player_photo':
                        if (change.type === 'delete') await supabaseAdmin.deletePlayerPhoto(desc.filename);
                        else await supabaseAdmin.uploadPlayerPhoto(desc.filename, change.content);
                        break;
                    default:
                        throw new Error(`Unrecognized staged path: ${change.path}`);
                }
                published++;
            } catch (err) {
                errors.push(`${change.path}: ${err.message}`);
            }
        }

        // Snapshot + per-match history for this unit's leagues (part of its batch).
        for (const leagueId of unitLeagues) {
            try {
                await supabaseAdmin.createSnapshot(leagueId);
            } catch (err) {
                errors.push(`Snapshot for "${leagueId}": ${err.message}`);
            }
            try {
                await supabaseAdmin.reconcileMatchHistory(leagueId);
            } catch (err) {
                errors.push(`Match history for "${leagueId}": ${err.message}`);
            }
        }

        // Tag this unit's rows into their batch(es). A players_metadata unit
        // splits into ONE batch PER edited player (so Historical mirrors the
        // per-player rows Pending already shows); every other unit becomes a
        // single batch headlined by its primary staged change.
        let batchId = null;
        if (watermark != null) {
            try {
                const isPlayerMetaUnit = unit.changes.some(
                    (c) => parseChangePath(c.path).kind === 'players_metadata'
                );
                if (isPlayerMetaUnit) {
                    await supabase.rpc('finalize_player_batches', { p_after_id: watermark });
                } else {
                    const { data } = await supabase.rpc('finalize_publish_batch', {
                        p_intent: deriveGroupIntent(unit.changes),
                        p_after_id: watermark,
                    });
                    batchId = data || null;
                }
            } catch { /* leave rows un-batched rather than fail the publish */ }
        }

        // Restore point for this unit (sql/db_version_control.sql). One per
        // logical change, so Historical Changes and the restore-point list line
        // up one-to-one and any single publish can be checked out again. Costs a
        // few KB — only the rows this unit touched become new objects, and a
        // unit that changed nothing real is detected and skipped server-side.
        // Best-effort: the migration may not be installed, and a publish must
        // never fail over its own bookkeeping.
        try {
            await supabase.rpc('dbc_snapshot', {
                p_message: describeUnit(unit.changes),
                p_audit_batch_id: batchId,
            });
        } catch { /* version control unavailable → publish anyway */ }
    }

    // Clear staging on success (even partial — published changes are done)
    if (published > 0) {
        clearChanges();
    }

    return { success: errors.length === 0, published, errors };
}

/**
 * One-line, human-readable name for a restore point, built from the same intent
 * the Historical row uses — so the two lists read the same way.
 * e.g. "Match data updated — Shabi Israel April 2026 (Dan vs Ron)"
 */
function describeUnit(changes) {
    const i = deriveGroupIntent(changes);
    return [i.specific, i.subject].filter(Boolean).join(' — ')
        + (i.detail ? ` (${i.detail})` : '');
}

/**
 * Pick a unit's batch headline from its staged changes: the highest-rank change
 * with a known category (ties → first). Mirrors the retroactive backfill's
 * "highest-rank primary row headlines the batch" rule. Falls back to a generic
 * "{n} changes" intent when nothing has a mapped category.
 */
function deriveGroupIntent(changes) {
    let best = null;
    for (const c of changes) {
        const meta = CATEGORY_TAXONOMY[c.category];
        if (!meta) continue;
        const rank = CATEGORY_RANK[c.category] || 0;
        if (!best || rank > best.rank) {
            best = { rank, topic: meta.topic, icon: meta.icon, specific: meta.text, subject: c.subject || null, detail: c.detail || null };
        }
    }
    if (!best) {
        return { topic: 'settings', subject: null, specific: `${changes.length} change${changes.length === 1 ? '' : 's'}`, icon: '📝', detail: null };
    }
    return { topic: best.topic, subject: best.subject, specific: best.specific, icon: best.icon, detail: best.detail };
}
