/**
 * playerManager.js — Admin Players view.
 *
 * Lets the admin search a player and edit their global metadata
 * (full name, Official BMAB Title, photo). The selected player's public
 * general profile is embedded below the form (read-only) so the admin can
 * see exactly what the visitor will see.
 */

import { loadAllLeagues } from '../compute/crossLeague.js';
import { loadPlayersMetadata, clearPlayersMetadataCache } from '../data/playersMetadata.js';
import { addChange } from './stagingStore.js';

let refreshBadgeFn = null;
let _state = {
    metadata: {},
    players: [], // sorted unique names
    selected: null,
    photoData: null,    // base64 (no data: prefix)
    photoFileName: null
};

export async function renderPlayerAdmin(container, refreshBadge) {
    refreshBadgeFn = refreshBadge;
    container.innerHTML = '<h1>Players</h1><div class="loading">Loading players…</div>';

    try {
        const [leagues, metadata] = await Promise.all([
            loadAllLeagues(),
            loadPlayersMetadata()
        ]);

        const set = new Set();
        for (const lg of leagues) for (const p of lg.allPlayers) set.add(p);
        _state.players = [...set].sort((a, b) => a.localeCompare(b));
        _state.metadata = { ...metadata };

        renderShell(container);
    } catch (err) {
        container.innerHTML = `<h1>Players</h1><div class="admin-msg admin-msg-error">Failed to load: ${esc(err.message)}</div>`;
    }
}

function renderShell(container) {
    container.innerHTML = `
        <h1>Players</h1>
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
            const has = !!_state.metadata[name];
            const tag = has ? ' <span class="player-meta-tag">edited</span>' : '';
            return `<li data-name="${esc(name)}">${esc(name)}${tag}</li>`;
        }).join('') || '<li class="muted">No matches.</li>';
    }
    input.addEventListener('input', refreshResults);
    results.addEventListener('click', e => {
        const li = e.target.closest('li[data-name]');
        if (!li) return;
        selectPlayer(container, li.dataset.name);
    });
    refreshResults();
}

function selectPlayer(container, name) {
    _state.selected = name;
    _state.photoData = null;
    _state.photoFileName = null;
    const meta = _state.metadata[name] || {};
    const host = container.querySelector('#player-edit-host');

    host.innerHTML = `
        <div class="admin-card">
            <h2>Editing: ${esc(name)}</h2>
            <div id="player-edit-msg"></div>
            <div class="form-group">
                <label for="pe-fullname">Full name</label>
                <input type="text" id="pe-fullname" value="${esc(meta.fullName || '')}" placeholder="e.g. Jonathan Doe">
            </div>
            <div class="form-group">
                <label for="pe-bmab">Official BMAB Title</label>
                <input type="text" id="pe-bmab" value="${esc(meta.bmabTitle || '')}" placeholder="e.g. Intermediate, Advanced, Master, Grandmaster">
            </div>
            <div class="form-group">
                <label>Photo</label>
                <div class="player-photo-row">
                    <div class="player-photo-preview" id="pe-photo-preview">
                        ${meta.photoPath ? `<img src="${esc(meta.photoPath)}" alt="">` : '<span class="muted">No photo</span>'}
                    </div>
                    <button class="btn btn-secondary" id="pe-photo-pick">Choose file…</button>
                    <span class="muted" id="pe-photo-name"></span>
                </div>
            </div>
            <button class="btn btn-primary" id="pe-save">Save</button>
        </div>

        <div class="admin-card">
            <h2>Live preview</h2>
            <iframe class="player-preview-frame"
                    src="player_general.html?player=${encodeURIComponent(name)}&preview=true"
                    title="Player preview"></iframe>
        </div>
    `;

    host.querySelector('#pe-photo-pick').addEventListener('click', pickPhoto);
    host.querySelector('#pe-save').addEventListener('click', () => savePlayer(container, name));
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
            const preview = document.getElementById('pe-photo-preview');
            if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
            const nameEl = document.getElementById('pe-photo-name');
            if (nameEl) nameEl.textContent = file.name;
        };
        reader.readAsDataURL(file);
    });
    input.click();
}

function savePlayer(container, name) {
    const fullName = document.getElementById('pe-fullname').value.trim();
    const bmabTitle = document.getElementById('pe-bmab').value.trim();

    const entry = { ..._state.metadata[name] };
    if (fullName) entry.fullName = fullName; else delete entry.fullName;
    if (bmabTitle) entry.bmabTitle = bmabTitle; else delete entry.bmabTitle;

    let photoPath = entry.photoPath || null;
    if (_state.photoData) {
        const safeName = name.replace(/[^A-Za-z0-9_-]+/g, '_');
        const ext = (_state.photoFileName && _state.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? _state.photoFileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)[0].toLowerCase() : '.jpg';
        photoPath = `assets/players/${safeName}${ext}`;
        entry.photoPath = photoPath;
    }

    if (Object.keys(entry).length === 0) {
        delete _state.metadata[name];
    } else {
        _state.metadata[name] = entry;
    }

    // Stage JSON change
    addChange({
        type: 'update',
        path: 'leagues/players_metadata.json',
        content: JSON.stringify(_state.metadata, null, 2),
        binary: false,
        description: `Player metadata updated (${name})`,
        group: `players-meta-${name}`
    });

    // Stage binary photo if picked
    if (_state.photoData && photoPath) {
        addChange({
            type: 'update',
            path: photoPath,
            content: _state.photoData,
            binary: true,
            description: `Player photo (${name})`,
            group: `players-meta-${name}`
        });
    }

    clearPlayersMetadataCache();

    if (refreshBadgeFn) refreshBadgeFn();

    const msg = document.getElementById('player-edit-msg');
    if (msg) msg.innerHTML = '<div class="admin-msg admin-msg-success">Saved to staging.</div>';

    // Reload preview iframe so it picks up the staged change via previewMode interceptor
    const frame = document.querySelector('.player-preview-frame');
    if (frame) frame.src = frame.src;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
