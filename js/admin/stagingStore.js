/**
 * stagingStore.js — Manages pending changes in localStorage before publishing to GitHub.
 *
 * Changes accumulate locally. The admin reviews them, can cancel individual changes,
 * and publishes all at once. Each publish also saves a snapshot for league history.
 */

import { getFile, putFile, deleteFile, putBinaryFile } from './githubApi.js';

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

/**
 * Remove a specific override from a manual_overrides.json staged change.
 * If no overrides remain, removes the change entirely.
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
        if (overrides.length === 0) {
            changes.splice(idx, 1);
        } else {
            data.overrides = overrides;
            changes[idx].content = JSON.stringify(data, null, 2);
            changes[idx].description = `${overrides.length} override(s)`;
        }
        save(changes);
    } catch { /* ignore parse errors */ }
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
                count++;
            }
        } else if (c.path && c.path.endsWith('manual_overrides.json') && c.content) {
            try {
                const data = JSON.parse(c.content);
                count += (data.overrides || []).length || 1;
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

    // Save history snapshots for affected leagues
    for (const leagueId of leagueDataChanges) {
        try {
            await saveSnapshot(leagueId);
        } catch (err) {
            errors.push(`Snapshot for "${leagueId}": ${err.message}`);
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
