/**
 * stagingStore.js — Manages pending changes in localStorage before publishing to GitHub.
 *
 * Changes accumulate locally. The admin reviews them, can cancel individual changes,
 * and publishes all at once. Each publish also saves a snapshot for league history.
 */

import { getFile, putFile, deleteFile, putBinaryFile } from './githubApi.js';
import { parseCSVWithRounds } from '../data/csvParser.js';
import { matchKey } from '../compute/matchHistory.js';

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
 * Publish all pending changes to GitHub sequentially.
 * For each change:
 *   - create/update: get current SHA (if exists), then PUT
 *   - delete: get current SHA, then DELETE
 *
 * After publishing league data changes, saves a history snapshot.
 *
 * @param {function} onProgress — callback(index, total, description) for progress UI
 * @returns {Promise<{success: boolean, published: number, errors: string[]}>}
 */
export async function publishAll(onProgress) {
    const changes = load();
    if (changes.length === 0) return { success: true, published: 0, errors: [] };

    const errors = [];
    let published = 0;
    const leagueDataChanges = new Set(); // track which leagues had data changes

    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (onProgress) onProgress(i, changes.length, change.description);

        try {
            if (change.type === 'delete') {
                const file = await getFile(change.path);
                if (file && file.sha) {
                    await deleteFile(change.path, file.sha, `Admin: ${change.description}`);
                }
            } else {
                // create or update
                const file = await getFile(change.path);
                const sha = file ? file.sha : null;

                if (change.binary) {
                    // Binary content is already base64 — decode to bytes for putBinaryFile
                    const binary = Uint8Array.from(atob(change.content), c => c.charCodeAt(0));
                    await putBinaryFile(change.path, binary, sha, `Admin: ${change.description}`);
                } else {
                    await putFile(change.path, change.content, sha, `Admin: ${change.description}`);
                }
            }
            published++;

            // Track league data changes for snapshots
            const leagueMatch = change.path.match(/^leagues\/([^/]+)\/(leaguedata\.csv|manual_overrides\.json)/);
            if (leagueMatch) {
                leagueDataChanges.add(leagueMatch[1]);
            }
        } catch (err) {
            errors.push(`${change.path}: ${err.message}`);
        }
    }

    // Save history snapshots + per-match history for affected leagues
    for (const leagueId of leagueDataChanges) {
        try {
            await saveSnapshot(leagueId);
        } catch (err) {
            errors.push(`Snapshot for "${leagueId}": ${err.message}`);
        }
        try {
            await updateMatchHistory(leagueId);
        } catch (err) {
            errors.push(`Match history for "${leagueId}": ${err.message}`);
        }
    }

    // Clear staging on success (even partial — published changes are done)
    if (published > 0) {
        clearChanges();
    }

    return { success: errors.length === 0, published, errors };
}

/**
 * Save a history snapshot for a league.
 * Reads the current CSV and overrides from the repo and saves them as a timestamped JSON.
 */
async function saveSnapshot(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Read current state from repo
    const csvFile = await getFile(`leagues/${encoded}/leaguedata.csv`);
    const overridesFile = await getFile(`leagues/${encoded}/manual_overrides.json`);

    const snapshot = {
        timestamp: new Date().toISOString(),
        csvContent: csvFile ? csvFile.content : '',
        overrides: overridesFile ? JSON.parse(overridesFile.content) : null
    };

    const snapshotPath = `leagues/${encoded}/history/${timestamp}.json`;
    await putFile(snapshotPath, JSON.stringify(snapshot, null, 2), null, `Snapshot: ${leagueId}`);

    // Update LastUpdated in league_params.json
    const paramsFile = await getFile(`leagues/${encoded}/league_params.json`);
    if (paramsFile) {
        const params = JSON.parse(paramsFile.content);
        params.LastUpdated = new Date().toISOString();
        await putFile(
            `leagues/${encoded}/league_params.json`,
            JSON.stringify(params, null, 2),
            paramsFile.sha,
            `Update LastUpdated: ${leagueId}`
        );
    }
}

/**
 * Reconcile match_history.json against the current CSV + manual_overrides for a league.
 *
 * Per-match logic:
 *   - Each CSV match is converted to a record. If history already has the same match
 *     with identical numeric fields, keep its existing updatedAt + source. Otherwise,
 *     stamp with `now` and source = "csv".
 *   - Each manual override stamps the matching record with `now` and source = "manual"
 *     (always — manual edits are explicit timeline events).
 */
async function updateMatchHistory(leagueId) {
    const encoded = encodeURIComponent(leagueId);
    const now = new Date().toISOString();

    const csvFile = await getFile(`leagues/${encoded}/leaguedata.csv`);
    if (!csvFile) return;
    const overridesFile = await getFile(`leagues/${encoded}/manual_overrides.json`);
    const historyFile = await getFile(`leagues/${encoded}/match_history.json`);

    const { matches: csvMatches } = parseCSVWithRounds(csvFile.content);
    const overrides = overridesFile ? (JSON.parse(overridesFile.content).overrides || []) : [];
    const previous = historyFile ? (JSON.parse(historyFile.content).matches || []) : [];
    const prevByKey = new Map(previous.map(m => [matchKey(m.playerA, m.playerB), m]));

    const next = [];
    const seen = new Set();

    function sameNumericFields(a, b) {
        return a.scoreA === b.scoreA && a.scoreB === b.scoreB
            && a.prA === b.prA && a.prB === b.prB
            && a.luckA === b.luckA && a.luckB === b.luckB;
    }

    for (const m of csvMatches) {
        const key = matchKey(m.playerA, m.playerB);
        seen.add(key);
        const prev = prevByKey.get(key);
        if (prev && sameNumericFields(prev, m) && prev.source !== 'manual') {
            next.push({ ...prev, round: m.round });
        } else if (prev && prev.source === 'manual') {
            // Manual edits take precedence over CSV — keep prev as-is
            next.push({ ...prev, round: m.round });
        } else {
            next.push({
                playerA: m.playerA, playerB: m.playerB,
                scoreA: m.scoreA, scoreB: m.scoreB,
                prA: m.prA, prB: m.prB,
                luckA: m.luckA, luckB: m.luckB,
                round: m.round,
                updatedAt: now,
                source: 'csv'
            });
        }
    }

    // Manual overrides — always stamp `now` and mark source = "manual"
    for (const o of overrides) {
        const key = matchKey(o.playerA, o.playerB);
        seen.add(key);
        let record;
        if (o.type === 'result') {
            record = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            record = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null, luckA: null, luckB: null
            };
        } else if (o.type === 'technical_draw') {
            record = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null, luckA: null, luckB: null
            };
        } else if (o.type === 'not_played') {
            record = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: 0, prB: 0, luckA: 0, luckB: 0
            };
        } else continue;

        // Replace or append (overrides win)
        const idx = next.findIndex(x => matchKey(x.playerA, x.playerB) === key);
        const stamped = { ...record, round: idx >= 0 ? next[idx].round : null, updatedAt: now, source: 'manual' };
        if (idx >= 0) next[idx] = stamped;
        else next.push(stamped);
    }

    const out = { matches: next };
    await putFile(
        `leagues/${encoded}/match_history.json`,
        JSON.stringify(out, null, 2),
        historyFile ? historyFile.sha : null,
        `Update match history: ${leagueId}`
    );
}
