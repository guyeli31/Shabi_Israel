/**
 * playerManager.js — Admin Players view.
 *
 * Lets the admin search a player and edit their global metadata
 * (full name, Official BMAB Title, championship titles, photo).
 * The selected player's public general profile is embedded below
 * the form (read-only) so the admin can see exactly what the visitor will see.
 */

import { loadAllLeagues } from '../compute/crossLeague.js';
import { loadPlayersMetadata, clearPlayersMetadataCache } from '../data/playersMetadata.js';
import { addChange, getStagedContent, getChanges } from './stagingStore.js';
import { BMAB_TITLES, bmabSelectOptionsHtml, COUNTRIES, getChampionshipTooltip } from '../data/titleConstants.js';
import { filePickerHTML } from './render/formControls.js';

const KNOWN_FLAGS = ['BE', 'IL', 'RU', 'TZ', 'UN'];

let refreshBadgeFn = null;
let _state = {
    metadata: {},
    players: [], // sorted unique names (active + inactive pre-registered)
    leagues: [], // cached loadAllLeagues() result for global rename
    selected: null,
    photoData: null,    // base64 (no data: prefix)
    photoFileName: null,
    removePhoto: false,
    championships: []   // working copy of championshipTitles
};

async function fileToPngBase64(file) {
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('decode-failed'));
            im.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode-failed')), 'image/png');
        });
        const buffer = await blob.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function renderPlayerAdmin(container, refreshBadge) {
    refreshBadgeFn = refreshBadge;
    container.innerHTML = '<h1>Players</h1><div class="loading">Loading players…</div>';

    try {
        const [leagues, fetchedMeta] = await Promise.all([
            loadAllLeagues(),
            loadPlayersMetadata()
        ]);

        // Use staged metadata if available (preserves edits across player switches)
        let metadata = fetchedMeta;
        const stagedContent = getStagedContent('leagues/players_metadata.json');
        if (stagedContent) {
            try { metadata = JSON.parse(stagedContent); } catch { /* fall back to fetched */ }
        }

        const set = new Set();
        for (const lg of leagues) for (const p of lg.allPlayers) set.add(p);
        // Also include pre-registered inactive players from metadata
        for (const [name, meta] of Object.entries(metadata)) {
            if (meta && meta.inactive) set.add(name);
        }
        _state.players = [...set].sort((a, b) => a.localeCompare(b));
        _state.metadata = { ...metadata };
        _state.leagues = leagues;

        renderShell(container);
    } catch (err) {
        container.innerHTML = `<h1>Players</h1><div class="admin-msg admin-msg-error">Failed to load: ${esc(err.message)}</div>`;
    }
}

function renderShell(container) {
    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md)">
            <h1 style="margin:0">Players</h1>
            <button class="btn btn-success" id="add-new-player-btn">+ New Player</button>
        </div>
        <div class="admin-card">
            <div class="form-group">
                <label for="player-search">Search player</label>
                <input type="text" id="player-search" placeholder="Type a player name…" autocomplete="off">
            </div>
            <ul class="player-search-results" id="player-search-results"></ul>
        </div>
        <div id="player-edit-host"></div>
    `;

    const input = container.querySelector('#player-search');
    const results = container.querySelector('#player-search-results');

    function refreshResults() {
        const q = input.value.trim().toLowerCase();
        const list = q
            ? _state.players.filter(n => n.toLowerCase().includes(q)).slice(0, 20)
            : _state.players.slice(0, 20);
        results.innerHTML = list.map(name => {
            const meta = _state.metadata[name];
            const isInactive = !!(meta && meta.inactive);
            const isHidden = !!(meta && meta.hidden);
            const hasEdits = !!meta && !isInactive;
            let tags = '';
            if (isInactive) tags += ' <span class="player-meta-tag player-meta-inactive">inactive</span>';
            if (isHidden)   tags += ' <span class="player-meta-tag player-meta-hidden">hidden</span>';
            if (hasEdits && !isHidden) tags += ' <span class="player-meta-tag">edited</span>';
            return `<li data-name="${esc(name)}">${esc(name)}${tags}</li>`;
        }).join('') || '<li class="muted">No matches.</li>';
    }
    input.addEventListener('input', refreshResults);
    results.addEventListener('click', e => {
        const li = e.target.closest('li[data-name]');
        if (!li) return;
        selectPlayer(container, li.dataset.name);
    });
    refreshResults();

    container.querySelector('#add-new-player-btn').addEventListener('click', () => {
        showNewPlayerForm(container);
    });
}

function selectPlayer(container, name) {
    _state.selected = name;
    _state.photoData = null;
    _state.photoFileName = null;
    _state.removePhoto = false;
    const meta = _state.metadata[name] || {};
    _state.championships = (meta.championshipTitles || []).map(t => ({ ...t }));
    const host = container.querySelector('#player-edit-host');

    // Country datalist
    const countryOptions = COUNTRIES.map(c => `<option value="${esc(c)}">`).join('');

    const isInactive = !!(meta && meta.inactive);
    const isHiddenMeta = !!(meta && meta.hidden);
    host.innerHTML = `
        <div class="admin-card">
            <h2>Editing: ${esc(name)}${isInactive ? ' <span class="player-meta-tag player-meta-inactive" style="vertical-align:middle">inactive</span>' : ''}${isHiddenMeta ? ' <span class="player-meta-tag player-meta-hidden" style="vertical-align:middle">hidden</span>' : ''}</h2>
            ${isInactive ? '<div class="admin-msg admin-msg-info">This player has not played any matches yet. They will become active once added to a league.</div>' : ''}
            <div id="player-edit-msg"></div>
            <div class="form-group">
                <label for="pe-username">Nickname <small style="color:var(--color-text-muted)">(player ID — renames across all leagues)</small></label>
                <input type="text" id="pe-username" value="${esc(name)}" placeholder="e.g. Guy" autocomplete="off">
            </div>
            <div class="form-group">
                <label for="pe-fullname">Full name <small style="color:var(--color-text-muted)">(required for titled players)</small></label>
                <input type="text" id="pe-fullname" value="${esc(meta.fullName || '')}" placeholder="e.g. Jonathan Doe">
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:var(--space-md)">
                <label class="toggle-switch" style="margin:0">
                    <input type="checkbox" id="pe-hidden" ${meta.hidden ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
                <span style="font-weight:600;font-size:0.9rem;color:var(--color-text-secondary)">Hidden
                    <small style="color:var(--color-text-muted);font-weight:400"> — name replaced with <i>N/A</i> in all tables; not findable in public search</small>
                </span>
            </div>
            <div class="form-group">
                <label for="pe-bmab">Official BMAB Title</label>
                <select id="pe-bmab">
                    ${bmabSelectOptionsHtml(meta.bmabTitle || '')}
                </select>
            </div>
            <div class="form-group">
                <label>Championship Titles</label>
                <div id="pe-champ-list"></div>
                <button class="btn btn-secondary btn-sm" id="pe-add-champ" style="margin-top:var(--space-sm)">+ Add Championship</button>
                <datalist id="country-list">${countryOptions}</datalist>
            </div>
            <div class="form-group">
                <label>Photo</label>
                <div class="player-photo-row">
                    <div class="player-photo-preview" id="pe-photo-preview">
                        ${meta.photoPath ? `<img src="${esc(meta.photoPath)}" alt="">` : '<span class="muted">No photo</span>'}
                    </div>
                    <button class="btn btn-secondary" id="pe-photo-pick">Choose file…</button>
                    ${meta.photoPath ? '<button class="btn btn-danger btn-sm" id="pe-photo-remove">Remove photo</button>' : ''}
                    <span class="muted" id="pe-photo-name"></span>
                </div>
            </div>
            <button class="btn btn-primary" id="pe-save">Save</button>
        </div>

        <div class="admin-card">
            <h2>Live preview</h2>
            <iframe class="player-preview-frame"
                    src="player.html?player=${encodeURIComponent(name)}&preview=true"
                    title="Player preview"></iframe>
        </div>
    `;

    renderChampionshipRows();

    host.querySelector('#pe-photo-pick').addEventListener('click', pickPhoto);
    host.querySelector('#pe-save').addEventListener('click', () => savePlayer(container, name));
    host.querySelector('#pe-add-champ').addEventListener('click', () => {
        _state.championships.push({ type: 'national', country: '', year: new Date().getFullYear(), doubles: false });
        renderChampionshipRows();
    });

    const removeBtn = host.querySelector('#pe-photo-remove');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            _state.photoData = null;
            _state.photoFileName = null;
            _state.removePhoto = true;
            const preview = document.getElementById('pe-photo-preview');
            if (preview) preview.innerHTML = '<span class="muted">No photo</span>';
            removeBtn.style.display = 'none';
        });
    }
}

function renderChampionshipRows() {
    const list = document.getElementById('pe-champ-list');
    if (!list) return;

    if (_state.championships.length === 0) {
        list.innerHTML = '<div class="muted" style="font-size:0.85rem">No championship titles.</div>';
        return;
    }

    list.innerHTML = _state.championships.map((ch, i) => {
        const isWorld = ch.type === 'world';
        return `
        <div class="champ-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;padding:8px;border:1px solid var(--color-border);border-radius:6px">
            <select data-ci="${i}" data-cf="type" style="padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">
                <option value="national" ${!isWorld ? 'selected' : ''}>National Champion</option>
                <option value="world" ${isWorld ? 'selected' : ''}>World Champion</option>
            </select>
            ${isWorld
                ? `<input type="text" data-ci="${i}" data-cf="location" value="${esc(ch.location || '')}" placeholder="Location (e.g. Monte Carlo)" style="width:160px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">`
                : `<input type="text" data-ci="${i}" data-cf="country" value="${esc(ch.country || '')}" placeholder="Country" list="country-list" style="width:160px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">`
            }
            <input type="number" data-ci="${i}" data-cf="year" value="${ch.year || ''}" placeholder="Year" min="1900" max="2100" style="width:80px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">
            <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer">
                <input type="checkbox" data-ci="${i}" data-cf="doubles" ${ch.doubles ? 'checked' : ''}> Doubles
            </label>
            <button class="btn btn-danger btn-xs" data-champ-remove="${i}" title="Remove">&#10005;</button>
        </div>`;
    }).join('');

    // Wire change handlers
    list.querySelectorAll('[data-cf]').forEach(el => {
        const handler = () => {
            const i = parseInt(el.dataset.ci);
            const f = el.dataset.cf;
            if (f === 'doubles') {
                _state.championships[i][f] = el.checked;
            } else if (f === 'year') {
                _state.championships[i][f] = parseInt(el.value) || null;
            } else if (f === 'type') {
                _state.championships[i][f] = el.value;
                // Re-render to swap country/location field
                renderChampionshipRows();
            } else {
                _state.championships[i][f] = el.value;
            }
        };
        el.addEventListener('change', handler);
        if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('input', handler);
    });

    // Wire remove
    list.querySelectorAll('[data-champ-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.championships.splice(parseInt(btn.dataset.champRemove), 1);
            renderChampionshipRows();
        });
    });
}

function pickPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl.split(',')[1];
            _state.photoData = base64;
            _state.photoFileName = file.name;
            _state.removePhoto = false;
            const preview = document.getElementById('pe-photo-preview');
            if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
            const nameEl = document.getElementById('pe-photo-name');
            if (nameEl) nameEl.textContent = file.name;
            // Show remove button if hidden
            const removeBtn = document.getElementById('pe-photo-remove');
            if (removeBtn) removeBtn.style.display = '';
        };
        reader.readAsDataURL(file);
    });
    input.click();
}

function renameInCsvText(csvText, from, to) {
    return csvText.split('\n').map(line => {
        const parts = line.split(',');
        if (parts.length >= 8) {
            if (parts[0].trim() === from) parts[0] = to;
            if (parts[4].trim() === from) parts[4] = to;
        }
        return parts.join(',');
    }).join('\n');
}

function renameInParams(params, from, to) {
    const out = { ...params };
    if (out.CustomFlags && Object.prototype.hasOwnProperty.call(out.CustomFlags, from)) {
        const flags = { ...out.CustomFlags };
        flags[to] = flags[from];
        delete flags[from];
        out.CustomFlags = flags;
    }
    if (Array.isArray(out.RetiredPlayers)) {
        out.RetiredPlayers = out.RetiredPlayers.map(p => p === from ? to : p);
    }
    return out;
}

function renameInOverridesJson(jsonText, from, to) {
    const data = JSON.parse(jsonText);
    if (Array.isArray(data.overrides)) {
        data.overrides = data.overrides.map(o => {
            const next = { ...o };
            if (next.playerA === from) next.playerA = to;
            if (next.playerB === from) next.playerB = to;
            if (next.winner === from) next.winner = to;
            return next;
        });
    }
    return JSON.stringify(data, null, 2);
}

async function fetchLatestText(path) {
    const staged = getStagedContent(path);
    if (staged != null) return { text: staged, fromStaging: true };
    try {
        const resp = await fetch(path, { cache: 'no-store' });
        if (resp.ok) return { text: await resp.text(), fromStaging: false };
    } catch { /* ignore */ }
    return null;
}

async function applyGlobalRename(oldName, newName, groupId, groupDescription) {
    for (const lg of _state.leagues) {
        if (!lg.allPlayers.has(oldName)) continue;
        // Keep the cached set in sync so back-to-back renames in the same session work.
        lg.allPlayers.delete(oldName);
        lg.allPlayers.add(newName);
        const encoded = encodeURIComponent(lg.id);

        // CSV
        const csvPath = `leagues/${encoded}/leaguedata.csv`;
        const csvLatest = await fetchLatestText(csvPath);
        if (csvLatest) {
            const renamed = renameInCsvText(csvLatest.text, oldName, newName);
            if (renamed !== csvLatest.text) {
                addChange({
                    type: 'update',
                    path: csvPath,
                    content: renamed,
                    binary: false,
                    description: `Rename in CSV (${lg.id}): ${oldName} → ${newName}`,
                    group: groupId,
                    groupDescription
                });
            }
        }

        // league_params.json (CustomFlags / RetiredPlayers)
        const paramsPath = `leagues/${encoded}/league_params.json`;
        const paramsLatest = await fetchLatestText(paramsPath);
        if (paramsLatest) {
            try {
                const parsed = JSON.parse(paramsLatest.text);
                const renamed = renameInParams(parsed, oldName, newName);
                const renamedText = JSON.stringify(renamed, null, 2);
                if (renamedText !== paramsLatest.text) {
                    addChange({
                        type: 'update',
                        path: paramsPath,
                        content: renamedText,
                        binary: false,
                        description: `Rename in league params (${lg.id}): ${oldName} → ${newName}`,
                        group: groupId,
                        groupDescription
                    });
                }
            } catch { /* skip on parse error */ }
        }

        // manual_overrides.json (only if exists)
        const ovPath = `leagues/${encoded}/manual_overrides.json`;
        const ovLatest = await fetchLatestText(ovPath);
        if (ovLatest) {
            try {
                const renamedText = renameInOverridesJson(ovLatest.text, oldName, newName);
                if (renamedText !== ovLatest.text) {
                    addChange({
                        type: 'update',
                        path: ovPath,
                        content: renamedText,
                        binary: false,
                        description: `Rename in overrides (${lg.id}): ${oldName} → ${newName}`,
                        group: groupId,
                        groupDescription
                    });
                }
            } catch { /* skip on parse error */ }
        }
    }
}

async function savePlayer(container, name) {
    const newNameRaw = document.getElementById('pe-username').value;
    const newName = (newNameRaw || '').trim();
    const fullName = document.getElementById('pe-fullname').value.trim();
    const bmabTitle = document.getElementById('pe-bmab').value;
    const championships = _state.championships.filter(ch => {
        // Only keep valid entries
        if (ch.type === 'world') return !!ch.year;
        return !!ch.country && !!ch.year;
    });

    const msgEl = document.getElementById('player-edit-msg');
    const renaming = newName && newName !== name;

    // Validation: nickname required, no collisions
    if (!newName) {
        if (msgEl) msgEl.innerHTML = '<div class="admin-msg admin-msg-error">Nickname is required.</div>';
        const u = document.getElementById('pe-username');
        if (u) { u.style.borderColor = 'var(--color-loss, red)'; u.focus(); }
        return;
    }
    if (renaming) {
        const collides = _state.players.some(p => p !== name && p === newName)
            || (_state.metadata[newName] && newName !== name);
        if (collides) {
            if (msgEl) msgEl.innerHTML = `<div class="admin-msg admin-msg-error">A player named "${esc(newName)}" already exists.</div>`;
            const u = document.getElementById('pe-username');
            if (u) { u.style.borderColor = 'var(--color-loss, red)'; u.focus(); }
            return;
        }
        const ok = window.confirm(
            `Rename "${name}" to "${newName}"?\n\n` +
            `This will rewrite the player's name in every league CSV, league_params (custom flags / retired players), and any manual overrides where they appear.`
        );
        if (!ok) return;
    }

    // Validation: titled players require full name
    const hasTitles = bmabTitle || championships.length > 0;
    if (hasTitles && !fullName) {
        if (msgEl) msgEl.innerHTML = '<div class="admin-msg admin-msg-error">Full English name is required for titled players.</div>';
        const nameInput = document.getElementById('pe-fullname');
        if (nameInput) {
            nameInput.style.borderColor = 'var(--color-loss, red)';
            nameInput.focus();
        }
        return;
    }

    const existingPhotoPath = _state.metadata[name] && _state.metadata[name].photoPath;
    const oldEntry = _state.metadata[name] || {};

    const entry = { ..._state.metadata[name] };
    if (fullName) entry.fullName = fullName; else delete entry.fullName;
    if (bmabTitle) entry.bmabTitle = bmabTitle; else delete entry.bmabTitle;
    if (championships.length > 0) entry.championshipTitles = championships; else delete entry.championshipTitles;
    const isHidden = document.getElementById('pe-hidden')?.checked || false;
    if (isHidden) entry.hidden = true; else delete entry.hidden;

    // Detect "photo-only" save: only the photo changed (no other metadata fields,
    // not a rename). In that case we fold the metadata JSON + photo binary into
    // one group so PENDING shows a single "Player photo (X)" row instead of two.
    const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const nonPhotoFieldsChanged =
        (oldEntry.fullName || '') !== (entry.fullName || '')
        || (oldEntry.bmabTitle || '') !== (entry.bmabTitle || '')
        || !sameJson(oldEntry.championshipTitles, entry.championshipTitles)
        || !!oldEntry.hidden !== !!entry.hidden;
    const photoChanged = !!_state.photoData || (_state.removePhoto && !!existingPhotoPath);
    const photoOnly = !renaming && photoChanged && !nonPhotoFieldsChanged;

    // Photo handling
    if (_state.removePhoto) {
        delete entry.photoPath;
    }

    let photoPath = entry.photoPath || null;
    if (_state.photoData) {
        const safeName = (renaming ? newName : name).replace(/[^A-Za-z0-9_-]+/g, '_');
        const ext = (_state.photoFileName && _state.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? _state.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)[0].toLowerCase() : '.jpg';
        photoPath = `assets/players/${safeName}${ext}`;
        entry.photoPath = photoPath;
    }

    // Apply rename in metadata: drop old key, write under new key
    if (renaming) {
        delete _state.metadata[name];
    }
    const finalName = renaming ? newName : name;
    if (Object.keys(entry).length === 0) {
        delete _state.metadata[finalName];
    } else {
        _state.metadata[finalName] = entry;
    }

    // Rename group — single bundle so the PENDING row collapses to one line.
    let renameGroupId = null;
    let renameGroupDesc = null;
    if (renaming) {
        renameGroupId = `rename-${name}-${newName}-${Date.now()}`;
        renameGroupDesc = `Rename across leagues: ${name} → ${newName}`;
        try {
            await applyGlobalRename(name, newName, renameGroupId, renameGroupDesc);
        } catch (err) {
            if (msgEl) msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Rename failed: ${esc(err.message)}</div>`;
            return;
        }
    }

    // Build photo labels (used by both photo-only metadata staging and photo binary staging)
    const photoLabelText = _state.removePhoto
        ? `Remove player photo (${finalName})`
        : `Player photo (${finalName})`;
    const photoLabelHtml = _state.removePhoto
        ? `Remove player photo (<b>${esc(finalName)}</b>)`
        : `Player photo (<b>${esc(finalName)}</b>)`;

    // Stage metadata JSON change.
    if (renaming) {
        // Fold into the rename group — PENDING shows a single consolidated row.
        addChange({
            type: 'update',
            path: 'leagues/players_metadata.json',
            content: JSON.stringify(_state.metadata, null, 2),
            binary: false,
            description: renameGroupDesc,
            category: 'player-rename',
            subject: `${name} → ${newName}`,
            group: renameGroupId,
            groupDescription: renameGroupDesc
        });
    } else if (photoOnly) {
        // Photo-only: fold metadata JSON into the photo group so PENDING shows
        // ONE row labelled "Player photo (X)" instead of separate metadata + photo rows.
        // If there's already a metadata.json change in staging (from earlier edits of
        // other players), keep that entry's group/editedPlayers intact and just refresh
        // its content — otherwise we'd lose tracking of those edits.
        const existingMeta = getChanges().find(c => c.path === 'leagues/players_metadata.json');
        if (existingMeta && existingMeta.editedPlayers) {
            addChange({
                ...existingMeta,
                type: 'update',
                content: JSON.stringify(_state.metadata, null, 2)
            });
        } else {
            addChange({
                type: 'update',
                path: 'leagues/players_metadata.json',
                content: JSON.stringify(_state.metadata, null, 2),
                binary: false,
                description: photoLabelText,
                category: 'player-photo',
                subject: finalName,
                action: _state.removePhoto ? 'Photo removed' : 'Photo updated',
                group: `players-meta-${finalName}`,
                groupDescription: photoLabelText,
                groupDescriptionHtml: photoLabelHtml
            });
        }
    } else {
        let editedPlayers = [finalName];
        const existingChange = getChanges().find(c => c.path === 'leagues/players_metadata.json');
        if (existingChange && existingChange.editedPlayers) {
            editedPlayers = [...new Set([...existingChange.editedPlayers.filter(p => p !== name), finalName])];
        }
        addChange({
            type: 'update',
            path: 'leagues/players_metadata.json',
            content: JSON.stringify(_state.metadata, null, 2),
            binary: false,
            description: `Player metadata (${editedPlayers.join(', ')})`,
            category: 'player-meta',
            editedPlayers,
            group: 'players-metadata'
        });
    }

    // Stage binary photo if picked. Pick the group so PENDING never shows a
    // separate photo row for one player edit:
    //   - renaming        → the rename bundle
    //   - photo-only       → the per-player photo group (shared with metadata above)
    //   - fields + photo   → the shared 'players-metadata' group, so the photo rides
    //                        the player's editedPlayers sub-line (one row, not two).
    let photoGroupId, photoGroupExtras;
    if (renaming) {
        photoGroupId = renameGroupId;
        photoGroupExtras = { groupDescription: renameGroupDesc };
    } else if (photoOnly) {
        photoGroupId = `players-meta-${finalName}`;
        photoGroupExtras = { groupDescription: photoLabelText, groupDescriptionHtml: photoLabelHtml };
    } else {
        photoGroupId = 'players-metadata';
        photoGroupExtras = {};
    }
    if (_state.photoData && photoPath) {
        addChange({
            type: 'update',
            path: photoPath,
            content: _state.photoData,
            binary: true,
            description: renaming ? renameGroupDesc : photoLabelText,
            group: photoGroupId,
            ...photoGroupExtras
        });
    } else if (_state.removePhoto && existingPhotoPath) {
        addChange({
            type: 'delete',
            path: existingPhotoPath,
            content: null,
            binary: true,
            description: renaming ? renameGroupDesc : photoLabelText,
            group: photoGroupId,
            ...photoGroupExtras
        });
    }

    clearPlayersMetadataCache();

    // Update local players list + selection on rename, then re-render
    if (renaming) {
        _state.players = [...new Set(_state.players.map(p => p === name ? newName : p))]
            .sort((a, b) => a.localeCompare(b));
        _state.selected = newName;
    }

    if (refreshBadgeFn) refreshBadgeFn();

    if (renaming) {
        // Re-render the edit form bound to the new name (heading, iframe src, save handler).
        selectPlayer(container, finalName);
        const msgAfter = document.getElementById('player-edit-msg');
        if (msgAfter) msgAfter.innerHTML = `<div class="admin-msg admin-msg-success">Renamed to "${esc(finalName)}" and saved to staging.</div>`;
        return;
    }

    const msg = document.getElementById('player-edit-msg');
    if (msg) msg.innerHTML = '<div class="admin-msg admin-msg-success">Saved to staging.</div>';

    // Reload preview iframe so it picks up the staged change via previewMode interceptor
    const frame = document.querySelector('.player-preview-frame');
    if (frame) frame.src = frame.src;
}

function showNewPlayerForm(container) {
    const host = container.querySelector('#player-edit-host');
    const form = {
        flagCode: 'IL',
        flagData: null,
        photoData: null,
        photoFileName: null,
        championships: []
    };

    const countryOptions = COUNTRIES.map(c => `<option value="${esc(c)}">`).join('');
    const flagOptions = KNOWN_FLAGS.map(f =>
        `<option value="${f}" ${f === 'IL' ? 'selected' : ''}>${f}</option>`
    ).join('');

    host.innerHTML = `
        <div class="admin-card">
            <h2>New Player</h2>
            <div id="new-player-msg"></div>

            <div class="form-group">
                <label for="np-nickname">Nickname <span style="color:var(--color-loss,red)">*</span></label>
                <input type="text" id="np-nickname" placeholder="e.g. Guy" autocomplete="off">
            </div>

            <div class="form-group">
                <label for="np-fullname">Full name <small style="color:var(--color-text-muted)">(required for titled players)</small></label>
                <input type="text" id="np-fullname" placeholder="e.g. Jonathan Doe">
            </div>

            <div class="form-group" style="display:flex;align-items:center;gap:var(--space-md)">
                <label class="toggle-switch" style="margin:0">
                    <input type="checkbox" id="np-hidden">
                    <span class="toggle-slider"></span>
                </label>
                <span style="font-weight:600;font-size:0.9rem;color:var(--color-text-secondary)">Hidden
                    <small style="color:var(--color-text-muted);font-weight:400"> — name replaced with <i>N/A</i> in all tables; not findable in public search</small>
                </span>
            </div>

            <div class="form-group">
                <label>Flag</label>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <img id="np-flag-preview" src="assets/flags/IL.png" alt="IL"
                         style="width:32px;height:21px;border:1px solid var(--color-border);border-radius:2px">
                    <select id="np-flag-select">
                        ${flagOptions}
                        <option value="__custom">Custom…</option>
                    </select>
                    <div id="np-custom-flag-area" class="input-action-row" style="display:none">
                        <input type="text" id="np-custom-flag-code" class="input-code" placeholder="XX" maxlength="3">
                        ${filePickerHTML('np-flag-file', { label: 'Choose PNG', accept: 'image/*' })}
                        <button class="btn btn-secondary btn-sm" id="np-flag-upload-btn">Upload</button>
                    </div>
                    <span id="np-flag-msg" style="font-size:0.85rem"></span>
                </div>
            </div>

            <div class="form-group">
                <label for="np-bmab">Official BMAB Title</label>
                <select id="np-bmab">
                    ${bmabSelectOptionsHtml('')}
                </select>
            </div>

            <div class="form-group">
                <label>Championship Titles</label>
                <div id="np-champ-list"></div>
                <button class="btn btn-secondary btn-sm" id="np-add-champ" style="margin-top:var(--space-sm)">+ Add Championship</button>
                <datalist id="np-country-list">${countryOptions}</datalist>
            </div>

            <div class="form-group">
                <label>Photo</label>
                <div class="player-photo-row">
                    <div class="player-photo-preview" id="np-photo-preview">
                        <span class="muted">No photo</span>
                    </div>
                    <button class="btn btn-secondary" id="np-photo-pick">Choose file…</button>
                    <span class="muted" id="np-photo-name"></span>
                </div>
            </div>

            <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-success" id="np-save">Create Player</button>
                <button class="btn btn-secondary" id="np-cancel">Cancel</button>
            </div>
        </div>
    `;

    // Flag select
    const flagSelect = host.querySelector('#np-flag-select');
    const customArea = host.querySelector('#np-custom-flag-area');
    const flagPreview = host.querySelector('#np-flag-preview');

    flagSelect.addEventListener('change', () => {
        if (flagSelect.value === '__custom') {
            customArea.style.display = 'flex';
        } else {
            customArea.style.display = 'none';
            form.flagCode = flagSelect.value;
            form.flagData = null;
            flagPreview.src = `assets/flags/${form.flagCode}.png`;
            flagPreview.alt = form.flagCode;
        }
    });

    host.querySelector('#np-flag-file').addEventListener('change', e => {
        const span = host.querySelector('.file-name[data-for="np-flag-file"]');
        if (span) span.textContent = e.target.files.length ? e.target.files[0].name : 'No file chosen';
    });

    host.querySelector('#np-flag-upload-btn').addEventListener('click', async () => {
        const codeInput = host.querySelector('#np-custom-flag-code');
        const fileInput = host.querySelector('#np-flag-file');
        const msgEl = host.querySelector('#np-flag-msg');
        const code = codeInput.value.trim().toUpperCase();

        if (!code || code.length < 2) {
            msgEl.textContent = 'Enter a valid flag code (2+ chars).';
            msgEl.style.color = 'var(--color-loss, red)';
            return;
        }
        if (!fileInput.files || fileInput.files.length === 0) {
            msgEl.textContent = 'Select an image file.';
            msgEl.style.color = 'var(--color-loss, red)';
            return;
        }

        let base64;
        try {
            base64 = await fileToPngBase64(fileInput.files[0]);
        } catch {
            msgEl.textContent = 'Could not read this image. Try JPEG or PNG.';
            msgEl.style.color = 'var(--color-loss, red)';
            return;
        }

        form.flagCode = code;
        form.flagData = base64;
        if (!KNOWN_FLAGS.includes(code)) KNOWN_FLAGS.push(code);

        flagPreview.src = `data:image/png;base64,${base64}`;
        flagPreview.alt = code;
        msgEl.textContent = `Flag "${code}" ready.`;
        msgEl.style.color = 'var(--color-win, green)';
        customArea.style.display = 'none';
    });

    // Photo
    host.querySelector('#np-photo-pick').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.addEventListener('change', () => {
            const file = inp.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                form.photoData = dataUrl.split(',')[1];
                form.photoFileName = file.name;
                const preview = host.querySelector('#np-photo-preview');
                if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
                const nameEl = host.querySelector('#np-photo-name');
                if (nameEl) nameEl.textContent = file.name;
            };
            reader.readAsDataURL(file);
        });
        inp.click();
    });

    // Championship titles (reuse same pattern, namespaced to np-)
    function renderNewChampRows() {
        const list = host.querySelector('#np-champ-list');
        if (!list) return;
        if (form.championships.length === 0) {
            list.innerHTML = '<div class="muted" style="font-size:0.85rem">No championship titles.</div>';
            return;
        }
        list.innerHTML = form.championships.map((ch, i) => {
            const isWorld = ch.type === 'world';
            return `
            <div class="champ-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;padding:8px;border:1px solid var(--color-border);border-radius:6px">
                <select data-nci="${i}" data-ncf="type" style="padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">
                    <option value="national" ${!isWorld ? 'selected' : ''}>National Champion</option>
                    <option value="world" ${isWorld ? 'selected' : ''}>World Champion</option>
                </select>
                ${isWorld
                    ? `<input type="text" data-nci="${i}" data-ncf="location" value="${esc(ch.location || '')}" placeholder="Location (e.g. Monte Carlo)" style="width:160px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">`
                    : `<input type="text" data-nci="${i}" data-ncf="country" value="${esc(ch.country || '')}" placeholder="Country" list="np-country-list" style="width:160px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">`
                }
                <input type="number" data-nci="${i}" data-ncf="year" value="${ch.year || ''}" placeholder="Year" min="1900" max="2100" style="width:80px;padding:4px 6px;border:1px solid var(--color-border);border-radius:4px">
                <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer">
                    <input type="checkbox" data-nci="${i}" data-ncf="doubles" ${ch.doubles ? 'checked' : ''}> Doubles
                </label>
                <button class="btn btn-danger btn-xs" data-nc-remove="${i}">&#10005;</button>
            </div>`;
        }).join('');

        list.querySelectorAll('[data-ncf]').forEach(el => {
            const handler = () => {
                const i = parseInt(el.dataset.nci);
                const f = el.dataset.ncf;
                if (f === 'doubles') {
                    form.championships[i][f] = el.checked;
                } else if (f === 'year') {
                    form.championships[i][f] = parseInt(el.value) || null;
                } else if (f === 'type') {
                    form.championships[i][f] = el.value;
                    renderNewChampRows();
                } else {
                    form.championships[i][f] = el.value;
                }
            };
            el.addEventListener('change', handler);
            if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('input', handler);
        });
        list.querySelectorAll('[data-nc-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                form.championships.splice(parseInt(btn.dataset.ncRemove), 1);
                renderNewChampRows();
            });
        });
    }
    renderNewChampRows();

    host.querySelector('#np-add-champ').addEventListener('click', () => {
        form.championships.push({ type: 'national', country: '', year: new Date().getFullYear(), doubles: false });
        renderNewChampRows();
    });

    host.querySelector('#np-cancel').addEventListener('click', () => {
        host.innerHTML = '';
    });

    host.querySelector('#np-save').addEventListener('click', () => saveNewPlayer(container, host, form));
}

function saveNewPlayer(container, host, form) {
    const msgEl = host.querySelector('#new-player-msg');
    const nickname = host.querySelector('#np-nickname').value.trim();
    const fullName = host.querySelector('#np-fullname').value.trim();
    const isHidden = host.querySelector('#np-hidden')?.checked || false;
    const bmabTitle = host.querySelector('#np-bmab').value;
    const championships = form.championships.filter(ch =>
        ch.type === 'world' ? !!ch.year : (!!ch.country && !!ch.year)
    );

    if (!nickname) {
        msgEl.innerHTML = '<div class="admin-msg admin-msg-error">Nickname is required.</div>';
        host.querySelector('#np-nickname').focus();
        return;
    }

    // Validation: titled players require full name
    const hasTitles = bmabTitle || championships.length > 0;
    if (hasTitles && !fullName) {
        msgEl.innerHTML = '<div class="admin-msg admin-msg-error">Full English name is required for titled players.</div>';
        const nameInput = host.querySelector('#np-fullname');
        if (nameInput) { nameInput.style.borderColor = 'var(--color-loss, red)'; nameInput.focus(); }
        return;
    }

    if (_state.players.includes(nickname) || _state.metadata[nickname]) {
        msgEl.innerHTML = `<div class="admin-msg admin-msg-error">Player "${esc(nickname)}" already exists.</div>`;
        return;
    }

    const entry = { inactive: true };
    if (fullName) entry.fullName = fullName;
    if (isHidden) entry.hidden = true;
    if (form.flagCode && form.flagCode !== 'IL') entry.defaultFlag = form.flagCode;
    if (bmabTitle) entry.bmabTitle = bmabTitle;
    if (championships.length > 0) entry.championshipTitles = championships;

    if (form.photoData) {
        const safeName = nickname.replace(/[^A-Za-z0-9_-]+/g, '_');
        const ext = (form.photoFileName && form.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i))
            ? form.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)[0].toLowerCase()
            : '.jpg';
        entry.photoPath = `assets/players/${safeName}${ext}`;
    }

    _state.metadata[nickname] = entry;
    _state.players = [...new Set([..._state.players, nickname])].sort((a, b) => a.localeCompare(b));

    // Build editedPlayers list
    let editedPlayers = [nickname];
    const existingChange = getChanges().find(c => c.path === 'leagues/players_metadata.json');
    if (existingChange && existingChange.editedPlayers) {
        editedPlayers = [...new Set([...existingChange.editedPlayers, nickname])];
    }

    addChange({
        type: 'update',
        path: 'leagues/players_metadata.json',
        content: JSON.stringify(_state.metadata, null, 2),
        binary: false,
        description: `Player metadata (${editedPlayers.join(', ')})`,
        category: 'player-meta',
        editedPlayers,
        group: 'players-metadata'
    });

    // Flag + photo for a brand-new player fold into the same 'players-metadata'
    // group so the create shows as ONE row (the player's editedPlayers sub-line),
    // not three separate flag/photo/metadata rows.
    if (form.flagData && form.flagCode) {
        addChange({
            type: 'create',
            path: `assets/flags/${form.flagCode}.png`,
            content: form.flagData,
            binary: true,
            description: `Upload flag: ${form.flagCode}.png`,
            group: 'players-metadata'
        });
    }

    if (form.photoData && entry.photoPath) {
        addChange({
            type: 'update',
            path: entry.photoPath,
            content: form.photoData,
            binary: true,
            description: `Player photo (${nickname})`,
            group: 'players-metadata'
        });
    }

    clearPlayersMetadataCache();
    if (refreshBadgeFn) refreshBadgeFn();

    // Navigate to edit form for the newly created player
    selectPlayer(container, nickname);
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
