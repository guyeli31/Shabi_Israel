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

let refreshBadgeFn = null;
let _state = {
    metadata: {},
    players: [], // sorted unique names
    selected: null,
    photoData: null,    // base64 (no data: prefix)
    photoFileName: null,
    removePhoto: false,
    championships: []   // working copy of championshipTitles
};

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
    _state.removePhoto = false;
    const meta = _state.metadata[name] || {};
    _state.championships = (meta.championshipTitles || []).map(t => ({ ...t }));
    const host = container.querySelector('#player-edit-host');

    // Country datalist
    const countryOptions = COUNTRIES.map(c => `<option value="${esc(c)}">`).join('');

    host.innerHTML = `
        <div class="admin-card">
            <h2>Editing: ${esc(name)}</h2>
            <div id="player-edit-msg"></div>
            <div class="form-group">
                <label for="pe-fullname">Full name <small style="color:var(--color-text-muted)">(required for titled players)</small></label>
                <input type="text" id="pe-fullname" value="${esc(meta.fullName || '')}" placeholder="e.g. Jonathan Doe">
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
                    src="player_general.html?player=${encodeURIComponent(name)}&preview=true"
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
            <button class="btn btn-danger btn-sm" data-champ-remove="${i}" title="Remove" style="padding:2px 8px">&#10005;</button>
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

function savePlayer(container, name) {
    const fullName = document.getElementById('pe-fullname').value.trim();
    const bmabTitle = document.getElementById('pe-bmab').value;
    const championships = _state.championships.filter(ch => {
        // Only keep valid entries
        if (ch.type === 'world') return !!ch.year;
        return !!ch.country && !!ch.year;
    });

    // Validation: titled players require full name
    const hasTitles = bmabTitle || championships.length > 0;
    if (hasTitles && !fullName) {
        const msg = document.getElementById('player-edit-msg');
        if (msg) msg.innerHTML = '<div class="admin-msg admin-msg-error">Full English name is required for titled players.</div>';
        const nameInput = document.getElementById('pe-fullname');
        if (nameInput) {
            nameInput.style.borderColor = 'var(--color-loss, red)';
            nameInput.focus();
        }
        return;
    }

    const entry = { ..._state.metadata[name] };
    if (fullName) entry.fullName = fullName; else delete entry.fullName;
    if (bmabTitle) entry.bmabTitle = bmabTitle; else delete entry.bmabTitle;
    if (championships.length > 0) entry.championshipTitles = championships; else delete entry.championshipTitles;

    // Photo handling
    if (_state.removePhoto) {
        delete entry.photoPath;
    }

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

    // Build editedPlayers list from existing staged change
    let editedPlayers = [name];
    const existingChange = getChanges().find(c => c.path === 'leagues/players_metadata.json');
    if (existingChange && existingChange.editedPlayers) {
        editedPlayers = [...new Set([...existingChange.editedPlayers, name])];
    }

    // Stage JSON change
    addChange({
        type: 'update',
        path: 'leagues/players_metadata.json',
        content: JSON.stringify(_state.metadata, null, 2),
        binary: false,
        description: `Player metadata (${editedPlayers.join(', ')})`,
        editedPlayers,
        group: 'players-metadata'
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
