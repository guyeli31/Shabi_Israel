/**
 * leagueManager.js — Admin league management: list, create, edit, delete leagues + player editing.
 */

import { loadLeagueOrder, loadLeagueParams, loadAllLeagueParams, loadLeagueMatches, loadLeagueMatchesAll, loadLandingSettings } from '../data/supabaseLoader.js';
import { addChange, getStagedContent, getChanges, hasLeagueChanges, readOverridesForEdit, removeChange, removeGroup, removeLeagueChanges, stageManualOverrides, T } from './stagingStore.js';
import { renderRoundEditor } from './roundEditor.js';
import { renderExcelImporter } from './excelImporter.js';
import { renderOverridesList } from './overridesList.js';
import { ensurePlayerIndex, ensureLeagueIndex, getPlayerLeagues, getPlayerFlagCode } from '../render/navigation.js';
import { thLabel } from '../utils/helpers.js';
import { tabSlug } from '../utils/queryString.js';
import { mountCombobox } from '../utils/combobox.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { revealMsg } from './msgScroll.js';
import { wireSectionCollapse } from '../render/sectionCollapse.js';
import { mountAccordionTabs } from '../render/subTabs.js';
import { filePickerHTML } from './render/formControls.js';
import { matchesToCsvText } from './csvText.js';
import { parseCSV, getAllPlayersFromCSV } from '../data/csvParser.js';
import { KNOWN_FLAGS, ensureFlagCodes, registerFlagCode } from './flagRegistry.js';
import {
    DURATION_MODES, DURATION_MODE_LABELS, DEFAULT_DURATION_MODE,
    durationMode, durationDays, leagueDateWindow, describeDuration, daysBetween,
} from '../compute/leagueDuration.js';
import { MEDAL_TIERS, getExtraPrizeRows, withExtraPrizeRows, countExtraPrizeRows } from '../compute/prizeRows.js';
import { leagueTypeRank } from '../compute/leagueTypes.js';
import { landingSettingsPayload } from './landingSettingsPayload.js';
import { loadPlayersMetadata } from '../data/supabasePlayersMetadata.js';
import { displayPlayerName, alternateName } from '../utils/nameDisplay.js';
import { restartSplash, endSplash } from '../utils/splash.js';

/**
 * Per-league CustomFlags plus the recency order of the leagues themselves —
 * the two things needed to answer "which flag did this player last play under".
 * Memoized for the session (the Add form asks once per import / preset load).
 *
 * Recency = position in DisplayOrder. That IS the site's own newest-first
 * ordering (the landing page renders leagues in it and the admin controls it),
 * so it stays right even for a league whose issue date was never filled in.
 */
let _flagCtx = null;
async function ensureFlagContext() {
    if (_flagCtx) return _flagCtx;
    const ctx = { rank: new Map(), flagsByLeague: new Map() };
    try {
        const ids = (await loadLeagueOrder()).map(t => t.replace(' - ', ' '));
        ids.forEach((id, i) => ctx.rank.set(id, i)); // 0 = most recent
        for (const e of await loadAllLeagueParams(ids)) {
            ctx.flagsByLeague.set(e.id, e.params?.CustomFlags || {});
        }
    } catch { /* offline → every lookup falls through to the registry default */ }
    _flagCtx = ctx;
    return ctx;
}

/**
 * The flag each of `names` should arrive with when it's added to a league:
 * THE ONE THEY LAST PLAYED UNDER. A player whose most recent league flew ES
 * joins the new league as ES — not as the IL default, and not as some arbitrary
 * winner of a cross-league merge.
 *
 * Resolution order:
 *   1. the most recent league they actually played in → its CustomFlags (IL if
 *      that league listed no custom flag for them — that IS the flag they played
 *      under there)
 *   2. players_metadata defaultFlag (staged first) — covers a registered player
 *      who has not played anywhere yet
 *   3. IL
 *
 * @returns {Promise<Map<string,string>>} name → flag code
 */
async function resolveDefaultFlags(names) {
    try { await ensurePlayerIndex(); } catch { /* cross-league history unavailable */ }
    const { rank, flagsByLeague } = await ensureFlagContext();
    let meta = {};
    try { meta = await loadPlayersMetadata(); } catch { /* registry unavailable */ }
    let staged = {};
    const stagedRaw = getStagedContent(T.playersMetadata());
    if (stagedRaw) { try { staged = JSON.parse(stagedRaw); } catch { /* ignore */ } }

    const lastPlayedFlag = (name) => {
        const played = getPlayerLeagues(name).filter(l => l.leagueId);
        if (played.length === 0) return null;
        const newest = played.reduce((best, l) =>
            (rank.get(l.leagueId) ?? Infinity) < (rank.get(best.leagueId) ?? Infinity) ? l : best);
        return flagsByLeague.get(newest.leagueId)?.[name] || 'IL';
    };

    const out = new Map();
    for (const n of names) {
        out.set(n, lastPlayedFlag(n) || staged[n]?.defaultFlag || meta[n]?.defaultFlag || 'IL');
    }
    return out;
}
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

let refreshBadgeFn = null;

/**
 * Convert any image file (jpg, png, gif, webp, heic, etc.) to a PNG base64 string.
 * Uses Canvas to re-encode. HEIC works only where the browser can natively decode it
 * (iOS 17+ Safari, recent Chrome on macOS) — falls back to a friendly error otherwise.
 */
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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode-failed')), 'image/png');
        });
        const buffer = await blob.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Main entry: render the leagues admin view.
 */
/**
 * Reflect the Leagues sub-navigation in the URL hash so a browser refresh
 * restores it (adminPage.js parses this back into a subroute on load):
 *   setLeaguesHash()                      → #leagues                   (list)
 *   setLeaguesHash('new')                 → #leagues/new               (add form)
 *   setLeaguesHash('edit', id [, subtab]) → #leagues/edit/<id>[/<subtab>]
 * The league id is URL-encoded (folder names contain spaces). replaceState so we
 * don't stack a back-button entry per drill-in.
 */
function setLeaguesHash(kind, leagueId, subtab) {
    const segs = ['leagues'];
    if (kind === 'new') segs.push('new');
    else if (kind === 'edit' && leagueId) {
        segs.push('edit', encodeURIComponent(leagueId));
        if (subtab) segs.push(subtab);
    }
    const h = '#' + segs.join('/');
    if (location.hash !== h) history.replaceState(null, '', h);
}

/** The group id every change belonging to one league's creation carries. */
const addGroupId = (folderId) => `add-${folderId}`;

/**
 * The DisplayOrder a publish would write right now, or null when nothing is
 * staged against landing_settings. Read from the queue rather than from
 * `loadLandingSettings()`, whose object is the loader's own cached instance.
 */
function stagedDisplayOrder() {
    const raw = getStagedContent(T.landingSettings());
    if (!raw) return null;
    try {
        const ls = JSON.parse(raw);
        const order = ls.DisplayOrder || ls.displayOrder;
        return Array.isArray(order) ? order : null;
    } catch { return null; }
}

/**
 * The staged CREATION of `folderId`, or null — the whole draft, ready to be
 * listed in F1 or poured back into the Add form.
 *
 * Deliberately keyed on `type === 'create'`: an UPDATE to league_params is an
 * edit of a league that already exists and belongs on the Edit screen. Only a
 * create describes a league the database has never had.
 */
function stagedCreateFor(folderId) {
    const change = getChanges().find(c =>
        c.type === 'create' && c.target?.kind === 'league_params' && c.target?.leagueId === folderId);
    if (!change) return null;
    let params;
    try { params = JSON.parse(change.content); } catch { return null; }
    const csvChange = getChanges().find(c =>
        c.target?.kind === 'leaguedata_csv' && c.target?.leagueId === folderId);
    const ovChange = getChanges().find(c =>
        c.target?.kind === 'manual_overrides' && c.target?.leagueId === folderId);
    let overrides = [];
    if (ovChange) {
        try { overrides = JSON.parse(ovChange.content).overrides || []; } catch { /* none */ }
    }
    return {
        id: folderId,
        params,
        csvText: csvChange ? csvChange.content : null,
        overrides,
        group: change.group || addGroupId(folderId),
    };
}

/**
 * Take one league OUT of the queued landing order.
 *
 * Needed because `landing_settings` is a SINGLE shared target while each league
 * creation is its own group: create two leagues and the second one's write
 * supersedes the first's, so the one surviving order change ends up tagged with
 * the LAST group that touched it. Discarding the first league's group therefore
 * removes its params and CSV but leaves its name sitting in that order — which
 * publishes as exactly the broken league this whole screen exists to prevent.
 * The name has to be taken out by hand.
 *
 * The change is removed and re-added rather than edited in place, on purpose:
 * addChange supersedes a target AT ITS OLD INDEX, and publish walks the queue in
 * order. Re-adding pushes the order change to the END, which is where it has to
 * run — after the params of every league it names.
 */
async function dropFromStagedLandingOrder(folderId) {
    const raw = getStagedContent(T.landingSettings());
    if (!raw) return;                     // nothing queued → the published order never had it
    let ls;
    try { ls = JSON.parse(raw); } catch { return; }
    const order = (ls.DisplayOrder || ls.displayOrder || [])
        .filter(t => t.replace(' - ', ' ') !== folderId);

    const idx = getChanges().findIndex(c => c.target?.kind === 'landing_settings');
    if (idx !== -1) removeChange(idx);

    // If what remains is the published order verbatim, the change has nothing
    // left to say — queueing a no-op would show a Pending row for a write that
    // changes nothing.
    const published = await loadLeagueOrder();
    if (order.length === published.length && order.every((t, i) => t === published[i])) return;

    addChange({
        type: 'update',
        target: T.landingSettings(),
        content: JSON.stringify(landingSettingsPayload(ls, { DisplayOrder: order }), null, 2),
        description: 'Update league order',
        category: 'landing',
    });
}

export async function renderLeagueAdmin(container, refreshBadge, subroute = []) {
    refreshBadgeFn = refreshBadge;
    restartSplash({ stages: 'adminView' });   // shared loading screen — see syncManager.js
    container.innerHTML = '<h1>Leagues</h1>';

    try {
        const publishedOrder = await loadLeagueOrder();
        // The order the NEXT publish will write, which is the order this screen
        // should show: a staged landing_settings change already carries it (a
        // league created but not yet published is in there, at its intended
        // slot). Falling back to the published order when nothing is staged.
        const displayOrder = stagedDisplayOrder() || publishedOrder;
        const folderNames = displayOrder.map(title => title.replace(' - ', ' '));
        const publishedIds = new Set(publishedOrder.map(title => title.replace(' - ', ' ')));

        // Restore a deep sub-route from the URL (see setLeaguesHash): the
        // Add-League form, or editing a specific league (optionally with a
        // Match-Results sub-tab open). Falls through to the list if the id is
        // unknown. The hash is already correct here (it's where subroute came
        // from), so these restore paths don't rewrite it.
        if (subroute[0] === 'new') { renderAddLeagueForm(container, displayOrder); return; }
        if (subroute[0] === 'edit' && subroute[1]) {
            const id = decodeURIComponent(subroute[1]);
            // A league that exists only as a staged creation is edited in the
            // ADD form, not the Edit-League screen: it has no matches, no
            // players table and no history for that screen to work on, and its
            // Save writes settings for a league id the database has never seen.
            // Reopening the form it was built in is also what the admin means by
            // "edit" here — go back and change what I typed.
            if (stagedCreateFor(id)) { renderAddLeagueForm(container, displayOrder, id); return; }
            if (folderNames.includes(id)) { renderEditLeague(container, id, displayOrder, subroute[2]); return; }
        }

        // ONE query for every league's params, not one per league. The map
        // above fired a separate round trip per league — measured on production
        // at eleven `leagues` requests to render a single list, and up to
        // twenty-four inside one navigation once other modules joined in. This
        // is the same fan-out the public read path was rebuilt to remove; it
        // simply survived in the admin. A league the query does not return
        // still gets a row with null params, exactly as the per-league catch
        // did — a missing row hides one row's controls, it does not fail the
        // page.
        const paramsById = new Map(
            (await loadAllLeagueParams([...publishedIds]).catch(() => []))
                .map(({ id, params }) => [id, params]),
        );
        // Three states, not two. A league is PUBLISHED (a row came back), PENDING
        // (no row, but a staged creation describes it — it is queued, not
        // broken), or genuinely unreadable. They used to render identically, as
        // one red "Failed to load", which read as a failure for the one case
        // that is simply work in progress.
        const leagues = folderNames.map((id, i) => {
            const published = paramsById.get(id) ?? null;
            if (published) return { id, title: displayOrder[i], params: published, pending: false };
            const staged = stagedCreateFor(id);
            return {
                id,
                title: displayOrder[i],
                params: staged ? staged.params : null,
                pending: !!staged,
            };
        });

        renderLeagueList(container, leagues, displayOrder);
    } catch (err) {
        container.innerHTML = `<h1>Leagues</h1><div class="admin-msg admin-msg-error">Failed to load: ${err.message}</div>`;
    } finally {
        endSplash();   // pairs with restartSplash() — see syncManager.js
    }
}

// ---- League List ----

function renderLeagueList(container, leagues, displayOrder) {
    // Default order: league opening date, newest first — same as A1 (Completed
    // Leagues) on the landing page. NOT DisplayOrder: that is the public
    // landing-page arrangement, and reading this screen in it meant a newly
    // opened league could sit anywhere in the list. A tie on the date falls
    // back to the canonical league-type order (doubling above regular), and a
    // row with no date at all — a broken publish, or a draft whose date is not
    // set yet — sorts to the TOP, because that row is the one asking for work.
    // `displayOrder` is untouched: it is passed on to the edit/add screens and
    // is still what publishing writes.
    const sorted = [...leagues].sort((a, b) => {
        const da = a.params?.IssueDate ? Date.parse(a.params.IssueDate) : NaN;
        const db = b.params?.IssueDate ? Date.parse(b.params.IssueDate) : NaN;
        const aBad = Number.isNaN(da), bBad = Number.isNaN(db);
        if (aBad !== bBad) return aBad ? -1 : 1;
        if (!aBad && da !== db) return db - da;
        return leagueTypeRank(a.params?.LeagueType || 'doubling')
             - leagueTypeRank(b.params?.LeagueType || 'doubling');
    });

    let rows = '';
    const dash = '<span style="color:var(--color-text-muted)">—</span>';
    for (const lg of sorted) {
        // No params AND no staged creation: the league is named in the order but
        // nothing anywhere describes it. That IS a broken league (a publish that
        // wrote the order and failed on the row), and it is the only case that
        // still earns red — with a way out, which it never had: the row used to
        // carry no buttons at all, so a broken entry could not be removed from
        // this screen.
        if (!lg.params) {
            rows += `
            <tr>
                <td>${esc(lg.id)}</td>
                <td colspan="3" style="color:var(--color-loss)">Listed, but no league data — never finished publishing</td>
                <td><button class="btn btn-danger btn-sm" data-delete="${lg.id}" data-title="${esc(lg.title)}">Remove</button></td>
            </tr>`;
            continue;
        }
        const p = lg.params;
        const running = p.Running === true;
        const hidden = p.Hidden === true;
        // A pending league has no published status to report — "Running" would
        // be a claim about a league the site cannot show anyone yet. Its own
        // state IS the status, so it takes that column.
        const statusPill = lg.pending
            ? '<span class="status-pill status-pending">Pending</span>'
            : running
                ? '<span class="status-pill status-running">Running</span>'
                : '<span class="status-pill status-completed">Completed</span>';
        const hiddenBadge = hidden ? ' <span style="color:var(--color-text-muted);font-size:0.8em">(Hidden)</span>' : '';
        // Type comes from the staged params for a pending league, so it is real
        // in both states and the pill is drawn the same way. Date is dashed when
        // absent — for a draft that usually means "not set yet".
        rows += `
            <tr${lg.pending ? ' class="league-row-pending"' : ''}>
                <td>${esc(lg.id)}${hiddenBadge}</td>
                <td><span class="league-type-pill type-${esc(p.LeagueType || 'doubling')}">${esc(LEAGUE_TYPE_LABELS[p.LeagueType] || LEAGUE_TYPE_LABELS.doubling)}</span></td>
                <td>${p.IssueDate ? formatAdminDate(p.IssueDate) : dash}</td>
                <td>${statusPill}</td>
                <td>
                    <button class="btn btn-primary btn-sm" data-edit="${lg.id}">Edit</button>
                    <button class="btn btn-danger btn-sm"
                            data-delete="${lg.id}" data-title="${esc(lg.title)}"
                            ${lg.pending ? 'data-pending="1"' : ''}>${lg.pending ? 'Discard' : 'Delete'}</button>
                </td>
            </tr>`;
    }

    container.innerHTML = `
        <h1>Leagues</h1>
        <div style="margin-bottom:var(--space-md)">
            <button class="btn btn-success" id="add-league-btn">+ Add League</button>
        </div>
        <div class="ff-wrap">
            <table class="admin-table font-large" data-mf-table-id="F1">
                <thead>
                    <tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    attachStickyShadow(container.querySelector('.ff-wrap'));

    // Add league
    document.getElementById('add-league-btn').addEventListener('click', () => {
        setLeaguesHash('new');
        renderAddLeagueForm(container, displayOrder);
    });

    // Edit buttons. The hash is the same in both cases (#leagues/edit/<id>) —
    // which screen it opens is decided in renderLeagueAdmin by whether the id
    // has a staged creation, so a refresh on that URL lands where the click did.
    container.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.edit;
            setLeaguesHash('edit', id);
            if (stagedCreateFor(id)) renderAddLeagueForm(container, displayOrder, id);
            else renderEditLeague(container, id, displayOrder);
        });
    });

    // Delete buttons
    container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.delete;
            const title = btn.dataset.title;
            // A league that was never published has nothing to delete — the only
            // thing that exists is the queued work. Staging a DELETE for it would
            // queue the removal of a database row that has never been written,
            // alongside the creation of that same row. So this drops the queued
            // creation instead, which also restores the landing order (the order
            // change is part of the same group).
            const staged = stagedCreateFor(id);
            if (staged) {
                if (!confirm(`Discard the pending creation of "${id}"? Its queued settings, roster, match data and any flag uploaded for it are dropped. Nothing published is affected.`)) return;
                removeGroup(staged.group);
                // And out of the queued order, which may live in ANOTHER group
                // by now — see dropFromStagedLandingOrder.
                dropFromStagedLandingOrder(id).finally(() => {
                    if (refreshBadgeFn) refreshBadgeFn();
                    setLeaguesHash();
                    renderLeagueAdmin(container, refreshBadgeFn);
                });
                return;
            }
            if (confirm(`Delete league "${id}"? This will remove all league files.`)) {
                stageDeleteLeague(id, title, displayOrder);
                setLeaguesHash();
                renderLeagueAdmin(container, refreshBadgeFn);
            }
        });
    });
}

// ---- Add League ----

/**
 * The Add-League form. Also the EDIT screen for a league that exists only as a
 * staged creation: pass its folder id as `draftId` and the form opens filled
 * with the queued draft, saving back over the same queued group instead of
 * adding a second one.
 */
async function renderAddLeagueForm(container, displayOrder, draftId = null) {
    const draft = draftId ? stagedCreateFor(draftId) : null;

    // Local state for the new league
    const state = {
        players: [],          // [{ name, flag, retired }]
        customFlags: {},
        csvText: null,        // set by the importer; overrides round-robin generation
        importOverrides: [],  // technical results decided in the import preview
        uploadedFlags: []     // flag codes uploaded from this form — see wireUploadFlagPanel
    };

    // Flag dropdowns are only useful if they offer the codes already in use —
    // resolved once here, before the first F2b render (see flagRegistry.js).
    // The league index backs the preset picker's search (same index the site
    // sidebar searches), warmed here so the first keystroke is instant.
    await Promise.all([ensureFlagCodes(), ensureLeagueIndex().catch(() => {})]);

    container.innerHTML = `
        <h1>${draft ? `Edit Pending League — ${esc(draftId)}` : 'Add New League'}</h1>
        <button class="btn btn-primary btn-back" id="cancel-new-league" style="margin-bottom:var(--space-lg)">&lsaquo; Back to Leagues</button>
        <div id="add-msg"></div>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">League Settings</h2>
            <div class="collapsible-body">
            <div class="admin-card edit-card-sm">
                <div class="form-group">
                    <label for="preset-league">Start from an existing league</label>
                    <div class="input-action-row">
                        <div class="ac-field">
                            <input type="text" id="preset-league" class="app-search-input" placeholder="Search a league to copy…" autocomplete="off">
                        </div>
                        <button class="btn btn-secondary btn-sm" id="apply-preset-btn">Load Preset</button>
                    </div>
                    <label class="preset-opt">
                        <input type="checkbox" id="preset-include-players" checked>
                        <span>Also copy its players (with flags &amp; retired state)</span>
                    </label>
                    <small class="form-hint">Copies type, duration, entry fee, match length, medals &amp; prizes — so a recurring league doesn't have to be re-typed. The name, the issue date and the match results always stay yours to set.</small>
                </div>
                <div class="form-group">
                    <label for="new-league-name">League Name</label>
                    <input type="text" id="new-league-name" placeholder="e.g. Shabi Israel - May 2026">
                </div>
                <div class="form-group">
                    <label for="new-league-type">League Type</label>
                    <select id="new-league-type">
                        <option value="doubling">Doubling (Win Rate)</option>
                        <option value="regular">Regular (Wins only)</option>
                        <option value="ubc">UBC (PR Wins + Points)</option>
                    </select>
                </div>
                <div class="add-league-row">
                    <div class="form-group">
                        <label for="new-issue-date">Issue Date</label>
                        <input type="date" id="new-issue-date" class="themed-date">
                        <small class="form-hint">Sets the league's month column in the Annual Leaderboard.</small>
                    </div>
                    <div class="form-group">
                        <label for="new-in-leaderboard">In Leaderboard</label>
                        <label class="toggle-switch" style="display:block;margin-top:4px">
                            <input type="checkbox" id="new-in-leaderboard" checked disabled>
                            <span class="toggle-slider"></span>
                        </label>
                        <small class="leaderboard-hint" style="color:var(--color-text-muted)"></small>
                    </div>
                    <div class="form-group">
                        <label for="new-entry-fee">Entry Fee</label>
                        <input type="number" id="new-entry-fee" value="0" min="0">
                    </div>
                    <div class="form-group">
                        <label for="new-match-length">Match Length</label>
                        <input type="number" id="new-match-length" value="7" min="1" max="25" step="2">
                    </div>
                </div>
                ${durationFieldsHTML('new')}
                <div class="form-group">
                    <label>Medals &amp; Prizes</label>
                    ${ffMedalsTableHTML([
                        { medal: 'Gold',   icon: '&#x1F947;', cls: 'medal-gold',   count: 1, countId: 'new-gold-count',   prize: 0, prizeId: 'new-prize-gold' },
                        { medal: 'Silver', icon: '&#x1F948;', cls: 'medal-silver', count: 1, countId: 'new-silver-count', prize: 0, prizeId: 'new-prize-silver' },
                        { medal: 'Bronze', icon: '&#x1F949;', cls: 'medal-bronze', count: 4, countId: 'new-bronze-count', prize: 0, prizeId: 'new-prize-bronze' },
                    ])}
                </div>
            </div>
            </div>
          </div>
        </div>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Players & Data</h2>
            <div class="collapsible-body">
            <div class="admin-card">
                <h3 class="admin-subhead">Players</h3>

                <div class="form-group">
                    <label for="manual-player-name">Add a player</label>
                    <div class="input-action-row">
                        <div class="ac-field">
                            <input type="text" id="manual-player-name" class="app-search-input" placeholder="Pick an existing player or type a new name…" autocomplete="off">
                        </div>
                        <button class="btn btn-primary btn-sm" id="add-manual-player-btn">Add</button>
                    </div>
                    <small class="form-hint">Existing players autocomplete; a new name is registered when the league is created.</small>
                </div>

                <div id="csv-source-msg" class="form-hint" style="margin-bottom:var(--space-sm)"></div>

                <div class="players-list-head">
                    <h3 class="admin-subhead" style="margin:0">Roster</h3>
                    <button class="btn btn-danger btn-sm" id="clear-all-players" type="button">Clear All</button>
                </div>
                <div id="f2b-mount"></div>

                ${uploadFlagPanelHTML()}
            </div>

            <div class="admin-card">
                <h3 class="admin-subhead">Or import a file (CSV / Excel)</h3>
                <small class="form-hint" style="margin-bottom:var(--space-sm)">
                    The same import screen Edit League uses: drop a file to see every
                    match it contains and decide row by row. Nothing moves until you
                    press <strong>Add these matches</strong> — that is the step that
                    fills the Roster above and attaches the results to the new league.
                </small>
                <div id="f2b-import-mount"></div>
            </div>
            </div>
          </div>
        </div>

        <div id="create-blockers" class="form-hint" style="margin-bottom:var(--space-sm)"></div>
        <div style="display:flex;gap:var(--space-sm)">
            <button class="btn btn-success" id="save-new-league">${draft ? 'Update League' : 'Create League'}</button>
            <button class="btn btn-secondary" id="cancel-new-league-2">Cancel</button>
        </div>`;

    /**
     * Everything standing between this form and a league, in the admin's words.
     *
     * ONE function owns the Create button's `disabled`. Each rule used to switch
     * it on its own, and the last listener to fire won — so a form failing two
     * rules could still be armed by whichever one happened to be re-checked
     * last. Collected here, the button is off while ANY rule fails and the row
     * beneath it names them all at once.
     */
    function createBlockers() {
        const out = [];
        // A league IS its fixtures, and a fixture needs two sides. Below two
        // players there is nothing to generate and nothing to import into — the
        // league would publish with an empty match table. It cannot be fixed
        // afterwards either: a published league is not restructured while it
        // runs, or at its end, so the roster has to be right here.
        if (state.players.length < 2) {
            out.push(state.players.length === 0
                ? 'add at least 2 players to the roster'
                : 'add at least one more player — a league needs 2');
        }
        if (!durationFieldsValid('new')) out.push('set how many days the league runs (at least 1)');
        return out;
    }

    /**
     * The staged flag uploads that belong to this league — as {code, content}
     * so they can be re-staged under its group.
     *
     * Two sources, because a draft can be saved more than once: codes uploaded
     * in THIS form session (state.uploadedFlags), and codes an earlier save
     * already folded into the draft's group. The second matters because the
     * save path drops that group wholesale before re-staging it — without
     * carrying them out first, editing a pending league would quietly delete
     * the flags it was created with.
     */
    function collectCarriedFlags() {
        const mine = new Set(state.uploadedFlags);
        const out = new Map();
        for (const c of getChanges()) {
            if (c.target?.kind !== 'flag_asset') continue;
            const inMyGroup = draft && c.group === draft.group;
            if (mine.has(c.target.code) || inMyGroup) {
                out.set(c.target.code, { code: c.target.code, content: c.content });
            }
        }
        return [...out.values()];
    }

    function refreshCreateGate() {
        const blockers = createBlockers();
        const btn = document.getElementById('save-new-league');
        const note = document.getElementById('create-blockers');
        if (btn) {
            btn.disabled = blockers.length > 0;
            btn.title = blockers.length ? `Before saving: ${blockers.join('; ')}.` : '';
        }
        if (note) {
            note.innerHTML = blockers.length
                ? `<span style="color:var(--color-loss)">Before saving: ${blockers.map(esc).join(' · ')}.</span>`
                : '';
        }
    }

    // F6 (Medals & Prizes) sticky-shadow — the F2b players wrap attaches itself in
    // rerenderPlayers(); here we cover the static F6 wrap rendered in the template.
    const medalsWrap = container.querySelector('[data-mf-table-id="F6"]')?.closest('.ff-wrap');
    if (medalsWrap) attachStickyShadow(medalsWrap);
    wireMedalsTable(container);

    // F2b — the Add-League players table. Identical FF format to F2 (Edit League)
    // via the shared ffPlayersTableHTML builder; data lives in state.players and
    // rows are keyed by their position in the table.
    function rerenderPlayers() {
        const mount = container.querySelector('#f2b-mount');
        const rows = state.players.map(pl => ({ name: pl.name, flagCode: pl.flag || 'IL', isRetired: !!pl.retired }));
        mount.innerHTML = ffPlayersTableHTML('F2b', rows, 'No players yet');
        attachStickyShadow(mount.querySelector('.ff-wrap'));
        // Every roster change — add, remove, import, preset, draft load — passes
        // through here, so this is the one place the gate needs re-checking.
        refreshCreateGate();

        if (state.players.length === 0) return;

        const tbody = mount.querySelector('tbody');
        const rowIndex = el => [...tbody.rows].indexOf(el.closest('tr'));

        // Shared flag preview / custom-code toggle (same handler as F2).
        wireFlagSelectPreview(mount);

        // Name edits → state.players (by row position)
        tbody.querySelectorAll('.player-name-input').forEach(input => {
            input.addEventListener('change', () => {
                const i = rowIndex(input);
                if (state.players[i]) state.players[i].name = input.value.trim();
            });
        });

        // Flag <select> + custom-code input → state.players
        tbody.querySelectorAll('.player-flag-select').forEach(sel => {
            const custom = sel.closest('tr').querySelector('.player-flag-custom');
            const syncFlag = () => {
                const i = rowIndex(sel);
                if (!state.players[i]) return;
                const code = sel.value === '__custom' ? (custom?.value.trim().toUpperCase() || '') : sel.value;
                if (code) state.players[i].flag = code;
            };
            sel.addEventListener('change', syncFlag);
            if (custom) custom.addEventListener('input', syncFlag);
        });

        // Retired toggle → state.players
        tbody.querySelectorAll('.player-retired-check').forEach(chk => {
            chk.addEventListener('change', () => {
                const i = rowIndex(chk);
                if (state.players[i]) state.players[i].retired = chk.checked;
            });
        });

        // Remove ✕ → splice + re-render
        tbody.querySelectorAll('.player-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = rowIndex(btn);
                if (i < 0) return;
                state.players.splice(i, 1);
                rerenderPlayers();
            });
        });
    }
    rerenderPlayers();

    /**
     * Pour a staged draft back into this form.
     *
     * The roster is RECONSTRUCTED rather than stored: what the queue holds is
     * what a league is made of — a CSV, a CustomFlags map and a RetiredPlayers
     * list — so the roster is the union of the names those three mention. That
     * keeps one source of truth (the staged change set IS the draft; nothing
     * shadows it), at the cost of one blind spot: a roster of a single player
     * flying IL and not retired produces a header-only CSV that names nobody,
     * so that one player cannot be recovered. Two or more players always can —
     * they generate a round-robin CSV carrying every name.
     */
    async function loadDraftIntoForm(d) {
        const p = d.params || {};
        document.getElementById('new-league-name').value = d.id;
        document.getElementById('new-league-type').value = p.LeagueType || 'doubling';
        if (p.IssueDate) document.getElementById('new-issue-date').value = p.IssueDate;
        document.getElementById('new-entry-fee').value = p.EntryFee ?? 0;
        document.getElementById('new-match-length').value = p.MatchLength || 7;
        document.getElementById('new-gold-count').value = p.GoldCount ?? 1;
        document.getElementById('new-silver-count').value = p.SilverCount ?? 1;
        document.getElementById('new-bronze-count').value = p.BronzeCount ?? 4;
        const prizes = p.Prizes || {};
        document.getElementById('new-prize-gold').value = prizes.Gold || 0;
        document.getElementById('new-prize-silver').value = prizes.Silver || 0;
        document.getElementById('new-prize-bronze').value = prizes.Bronze || 0;
        applyExtraPrizeRows(container, getExtraPrizeRows(prizes));
        document.getElementById('new-duration-mode').value = durationMode(p);
        const days = durationDays(p);
        if (days) document.getElementById('new-duration-days').value = days;
        // Both toggles derive from the issue date, so fire their sync AFTER the
        // date is in — otherwise they settle on the empty-date defaults.
        document.getElementById('new-issue-date').dispatchEvent(new Event('change'));
        document.getElementById('new-duration-mode').dispatchEvent(new Event('change'));
        if (p.IssueDate) document.getElementById('new-in-leaderboard').checked = p.InLeaderboard !== false;

        // Match data: a ManualEntry league's CSV is a generated round-robin, not
        // an imported file — carrying it as `csvText` would freeze that draw and
        // re-stage it verbatim. Left null, it is regenerated from the roster on
        // save, exactly as it was the first time.
        state.importOverrides = d.overrides || [];
        state.csvText = (d.csvText && !p.ManualEntry) ? d.csvText : null;

        const flags = p.CustomFlags || {};
        const retired = new Set(p.RetiredPlayers || []);
        const names = new Set([...Object.keys(flags), ...retired]);
        if (d.csvText) for (const n of getAllPlayersFromCSV(d.csvText)) names.add(n);
        const sorted = [...names].sort();
        await ensureAcData();
        const known = new Set(_acPlayerNames);
        state.players = sorted.map(n => ({
            name: n,
            flag: flags[n] || 'IL',
            retired: retired.has(n),
            isNew: !known.has(n),
        }));
        rerenderPlayers();

        if (state.csvText) {
            const count = parseCSV(state.csvText).length;
            setCsvSourceMsg(`Imported file kept from the pending draft: ${sorted.length} player${sorted.length === 1 ? '' : 's'}, `
                + `${count} played match${count === 1 ? '' : 'es'}.`);
        }
        showMsg('add-msg', `Editing the pending creation of "${d.id}". Saving replaces the queued version — it does not add a second one.`, 'info');
    }

    // ── Preset picker — the canonical smart search, leagues only ────────────
    // Same field, same matcher and same result chrome as the site sidebar's
    // search: typing filters live, results carry the league glyph with its
    // running/completed status dot and the league-type badge, and the mobile
    // sheet is handled by the shared base.
    //
    // HIDDEN leagues are INCLUDED here, which is why this reads `ensureLeagueIndex()`
    // directly instead of calling the shared `searchEntities()`. That helper is
    // the PUBLIC search and drops hidden leagues unconditionally — correct there,
    // wrong here: this picker lives inside admin.html, where a hidden league is
    // meant to be visible and workable, and cloning last month's setup is exactly
    // what you want to do with a league you are still preparing. Filtering it out
    // meant the one league most likely to be a useful template was the one you
    // could not pick. The matching rule below is copied from searchEntities so
    // the two still agree on WHAT matches — only on the hidden set do they differ.
    const presetIds = new Set(displayOrder.map(t => t.replace(' - ', ' ')));
    const presetInput = document.getElementById('preset-league');
    const presetMeta = new Map(); // id → {running, leagueType}
    const presetField = mountCombobox(presetInput, {
        suggest: async (query) => {
            const q = (query || '').trim().toLowerCase();
            // Empty query → browse all (the list is short and the admin is
            // usually cloning "last month", which is the first row).
            const leagues = (await ensureLeagueIndex())
                .filter(l => !q || l.title.toLowerCase().includes(q))
                .slice(0, 20);
            for (const l of leagues) presetMeta.set(l.id, l);
            return leagues.map(l => l.id);
        },
        decorate: (id) => {
            const l = presetMeta.get(id) || {};
            const status = l.running ? 'running' : 'completed';
            return {
                iconHtml: `<span class="search-icon search-icon--league" aria-hidden="true">
                        <svg class="search-league-glyph" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                            <rect x="2" y="3" width="12" height="10" rx="1.5"/>
                            <line x1="2" y1="6.5" x2="14" y2="6.5"/>
                            <line x1="8" y1="6.5" x2="8" y2="13"/>
                        </svg>
                        <span class="status-dot ${status}"></span>
                    </span>`,
                // The league TYPE is the pill, rendered as the SAME pill the
                // sidebar's own league results use — `kind` is the league type
                // verbatim, which lands on the shared `--doubling / --regular /
                // --ubc` styling in search-overlay.css and therefore on the
                // shared --lt-* theme tokens. No second definition of the pill
                // exists for this picker.
                //
                // It replaces a Running/Completed pill, which is gone: a preset
                // is a league you are cloning, so its status is not what decides
                // whether to pick it — the TYPE is (a Doubling league is a
                // different animal from a Regular or a UBC one). The status dot
                // on the glyph above still carries it for anyone who cares.
                //
                // It is a pill and not a `sublabel` because that slot holds the
                // SECOND NAME in every player search, and a league has only one
                // name; filling it with the type made this the one search where
                // the same position meant something else.
                badge: {
                    text: LEAGUE_TYPE_LABELS[l.leagueType] || LEAGUE_TYPE_LABELS.doubling,
                    kind: LEAGUE_TYPE_LABELS[l.leagueType] ? l.leagueType : 'doubling',
                },
            };
        },
        allowFreeText: false,   // a preset must be an existing league
        // The value is a standing choice the "Load Preset" button reads later,
        // not a query being refined — so re-entering the field browses the whole
        // list again instead of filtering to the one league already in it.
        browseOnOpen: true,
        onSelect: () => {},     // fills the field; the Load Preset button reads it
    });

    wireLeaderboardToggle(
        document.getElementById('new-issue-date'),
        document.getElementById('new-in-leaderboard'),
        document.getElementById('new-in-leaderboard')?.closest('.form-group')?.querySelector('.leaderboard-hint')
    );
    // Duration edits feed the one gate that owns the Create button (see
    // refreshCreateGate) rather than switching it themselves.
    wireDurationFields(container, 'new', refreshCreateGate);

    // Preset — clone an existing league's setup into this blank form. A league
    // that runs every month is the same league with a new name and a new set of
    // results, so re-typing type / fee / match length / medals every time is
    // pure friction. Deliberately NOT copied: the name (it's the unique id), the
    // issue date, and any match data — those are what makes the new league new.
    document.getElementById('apply-preset-btn').addEventListener('click', async () => {
        const sourceId = presetInput.value.trim();
        if (!sourceId) {
            showMsg('add-msg', 'Search for a league to copy from first.', 'error');
            return;
        }
        if (!presetIds.has(sourceId)) {
            showMsg('add-msg', `No league named "${esc(sourceId)}". Pick one from the list.`, 'error');
            return;
        }
        const withPlayers = document.getElementById('preset-include-players').checked;
        const btn = document.getElementById('apply-preset-btn');
        btn.disabled = true;
        try {
            // Prefer this league's staged (unpublished) params, exactly as Edit
            // League does — a preset should reflect what the admin last set.
            let params = await loadLeagueParams(sourceId);
            const stagedParams = getStagedContent(T.leagueParams(sourceId));
            if (stagedParams) { try { params = JSON.parse(stagedParams); } catch { /* keep published */ } }

            document.getElementById('new-league-type').value = params.LeagueType || 'doubling';
            document.getElementById('new-entry-fee').value = params.EntryFee ?? 0;
            document.getElementById('new-match-length').value = params.MatchLength || 7;
            document.getElementById('new-gold-count').value = params.GoldCount ?? 1;
            document.getElementById('new-silver-count').value = params.SilverCount ?? 1;
            document.getElementById('new-bronze-count').value = params.BronzeCount ?? 4;
            const prizes = params.Prizes || {};
            document.getElementById('new-prize-gold').value = prizes.Gold || 0;
            document.getElementById('new-prize-silver').value = prizes.Silver || 0;
            document.getElementById('new-prize-bronze').value = prizes.Bronze || 0;
            // The preset's extra prize rows are part of "the same league again"
            // just as much as the medal counts are.
            applyExtraPrizeRows(container, getExtraPrizeRows(prizes));
            // How long it ran is part of "the same league again" — copied like
            // the fee and the match length. The Issue Date still isn't, so the
            // window lands wherever the new league's own start date puts it.
            document.getElementById('new-duration-mode').value = durationMode(params);
            const presetDays = durationDays(params);
            if (presetDays) document.getElementById('new-duration-days').value = presetDays;
            document.getElementById('new-duration-mode').dispatchEvent(new Event('change'));

            let playerNote = '';
            if (withPlayers) {
                const { allPlayers } = await loadLeagueMatches(sourceId);
                const names = [...allPlayers].sort();
                const customFlags = params.CustomFlags || {};
                const retired = params.RetiredPlayers || [];
                await ensureAcData();
                const known = new Set(_acPlayerNames);
                // Exactly the flag each player flew IN THAT LEAGUE: its own
                // CustomFlags, and IL for anyone it didn't list. Deliberately not
                // the cross-league "last played" default — when you clone a
                // league you are cloning that league's roster as it stood.
                state.players = names.map(n => ({
                    name: n,
                    flag: customFlags[n] || 'IL',
                    retired: retired.includes(n),
                    isNew: !known.has(n)
                }));
                // A preset roster replaces any uploaded CSV — the two are
                // alternative ways to answer the same question ("who plays?").
                clearImport({ keepMessage: true });
                rerenderPlayers();
                playerNote = ` with ${names.length} player${names.length === 1 ? '' : 's'}`;
            }
            showMsg('add-msg', `Preset loaded from "${esc(sourceId)}"${playerNote}. Give the new league a name before creating it.`, 'success');
        } catch (err) {
            showMsg('add-msg', `Could not load preset: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
        }
    });

    // Upload Custom Flag panel (shared with F2 in Edit League) — stages the PNG +
    // registers the code so it appears in every F2b flag dropdown. The codes are
    // remembered so they can be folded into the league's own change group when
    // it is created, and dropped with it if it never is.
    wireUploadFlagPanel(code => {
        if (!state.uploadedFlags.includes(code)) state.uploadedFlags.push(code);
    });

    // Collapsible section headers — shared mechanism (css/sections.css +
    // sectionCollapse.js), identical to landing / dashboard / player pages.
    // All sections open by default.
    container.querySelectorAll('.app-section').forEach(s => wireSectionCollapse(s, { defaultOpen: true }));

    function setCsvSourceMsg(msg) {
        document.getElementById('csv-source-msg').textContent = msg || '';
    }

    // Custom file input labels
    container.querySelectorAll('.custom-file-input input[type="file"]').forEach(inp => {
        inp.addEventListener('change', () => {
            const span = inp.parentElement.querySelector('.file-name');
            if (span) span.textContent = inp.files.length ? inp.files[0].name : 'No file chosen';
        });
    });

    // Cancel — and take this form's flag uploads with it, unprompted.
    //
    // The other half of "discarding the league discards its flag". A flag
    // uploaded here is queued the instant Upload is pressed (it has to be, so it
    // can be picked in the roster below), so walking away without creating the
    // league left it queued with nothing to belong to — the same orphan that
    // discarding a pending league avoids, reached by a different door.
    //
    // No confirmation, deliberately. A flag uploaded inside this form is part of
    // building THIS league; abandoning the league abandons it, the same way the
    // roster and the imported file are abandoned without being asked about. An
    // extra prompt would make the one ancillary thing behave unlike everything
    // else on the form. Re-uploading is a two-field operation if it is wanted
    // again.
    const cancel = () => {
        const mine = new Set(state.uploadedFlags);
        if (mine.size > 0) {
            const changes = getChanges();
            let dropped = 0;
            for (let i = changes.length - 1; i >= 0; i--) {
                if (changes[i].target?.kind === 'flag_asset' && mine.has(changes[i].target.code)) {
                    removeChange(i);
                    dropped++;
                }
            }
            if (dropped > 0 && refreshBadgeFn) refreshBadgeFn();
        }
        setLeaguesHash();
        renderLeagueAdmin(container, refreshBadgeFn);
    };
    document.getElementById('cancel-new-league').addEventListener('click', cancel);
    document.getElementById('cancel-new-league-2').addEventListener('click', cancel);

    // Manual add — existing registry player OR a brand-new name. New names are
    // registered in players_metadata.json when the league is created (stageAddLeague).
    document.getElementById('add-manual-player-btn').addEventListener('click', async () => {
        const name = document.getElementById('manual-player-name').value.trim();
        if (!name) return;
        if (state.players.some(p => p.name === name)) {
            showMsg('add-msg', `Player "${name}" already in list.`, 'error');
            return;
        }
        await ensureAcData();
        const inRegistry = _acPlayerNames.includes(name);
        // Existing players inherit the flag they already play under; new ones get IL.
        const flag = inRegistry ? (await resolveDefaultFlags([name])).get(name) : 'IL';
        state.players.push({ name, flag, retired: false, isNew: !inRegistry });
        acField.clear();
        showMsg('add-msg', inRegistry ? '' : `New player "${name}" added — it will be registered when you create the league.`,
            inRegistry ? '' : 'success');
        rerenderPlayers();
    });

    // Smart autocomplete for manual player input
    let _acPlayerNames = null;
    let _acPlayerMeta = null; // nickname → fullName (for full-name search)
    let _acTitleHtml = {};    // nickname → title-badge HTML (BMAB / championship)
    const acInput = document.getElementById('manual-player-name');

    /** `_acPlayerMeta` stores a bare full-name STRING per nickname, but the
     *  name helpers take a metadata object — wrap it rather than keeping a
     *  second parallel map that could drift out of step with the first. */
    const acMeta = (n) => ({ fullName: _acPlayerMeta?.[n] });

    async function ensureAcData() {
        if (_acPlayerNames) return;
        try {
            const [index, { loadPlayersMetadata }] = await Promise.all([
                ensurePlayerIndex(),
                import('../data/supabasePlayersMetadata.js')
            ]);
            const meta = await loadPlayersMetadata();
            const names = new Set([...index.keys()]);
            const fullNames = {};
            const titleHtml = {};
            for (const [n, m] of Object.entries(meta)) {
                if (m && m.inactive) names.add(n);
                if (m?.fullName) fullNames[n] = m.fullName;
                const t = getTitleAbbreviationsHtml(m);
                if (t) titleHtml[n] = t;
            }
            const stagedRaw = getStagedContent(T.playersMetadata());
            if (stagedRaw) {
                try {
                    const stagedMeta = JSON.parse(stagedRaw);
                    for (const [n, m] of Object.entries(stagedMeta)) {
                        if (m && m.inactive) names.add(n);
                        if (m?.fullName) fullNames[n] = m.fullName;
                        const t = getTitleAbbreviationsHtml(m);
                        titleHtml[n] = t;  // staged wins (may clear a removed title)
                    }
                } catch { /* ignore parse errors */ }
            }
            _acPlayerNames = [...names].sort();
            _acPlayerMeta = fullNames;
            _acTitleHtml = titleHtml;
        } catch { _acPlayerNames = []; _acPlayerMeta = {}; _acTitleHtml = {}; }
    }

    // Canonical search field — suggests registry players (excluding ones already
    // added) with flag + full-name sublabel; a brand-new name is allowed and gets
    // registered when the league is created (see the Add handler above).
    const acField = mountCombobox(acInput, {
        suggest: async (query) => {
            const q = query.trim().toLowerCase();
            if (!q) return [];              // type-to-search (no browse-all dump here)
            await ensureAcData();
            const existing = new Set(state.players.map(p => p.name));
            return _acPlayerNames.filter(n => {
                if (existing.has(n)) return false;
                const fl = (_acPlayerMeta?.[n] || '').toLowerCase();
                return n.toLowerCase().includes(q) || fl.includes(q);
            })
                // Ordered by the name the row SHOWS — the registry hands these
                // over keyed by username, which reads as unsorted the moment
                // "Show name as" is set to full names.
                .sort((a, b) => displayPlayerName(a, acMeta(a)).localeCompare(displayPlayerName(b, acMeta(b))))
                .slice(0, 10);
        },
        labelFor: (n) => displayPlayerName(n, acMeta(n)),
        // The second name, replacing a hard-coded full-name sublabel. Both forms
        // were already matched by the suggest above; now both are also SHOWN, so
        // the row a search matched can be recognised by whichever name the admin
        // typed.
        altFor:   (n) => alternateName(n, acMeta(n)),
        decorate: (n) => ({ flagCode: getPlayerFlagCode(n), titleHtml: _acTitleHtml?.[n] || '' }),
        // The name waits in the field until "Add" is pressed, so it keeps the
        // picked player's flag + titles. A typed-from-scratch name is new to the
        // registry and decorates to nothing — which is itself the signal that
        // this is not one of the existing players.
        identity: true,
        allowFreeText: true,
        onSelect: () => {},                 // just fills the field; the Add button reads it
    });

    // ── Import (CSV / Excel) — the SAME importer Edit League uses ───────────
    // Compose mode: nothing is staged here. The importer produces the CSV (with
    // NP rows zeroed) plus any technical overrides, and hands them back; they
    // ride along with the league-creation change set. The compatibility report
    // runs against a clean baseline, so its F5 table lists exactly the matches
    // the file says were played — each one decidable row by row (TA/TB/TD/NP)
    // before the league exists.
    function mountImporter() {
        renderExcelImporter(
            container.querySelector('#f2b-import-mount'),
            document.getElementById('new-league-name').value.trim() || '(new league)',
            refreshBadgeFn,
            null,
            {
                heading: 'Import results & roster',
                getMatchLength: () => document.getElementById('new-match-length').value,
                // A dropped file wipes the draft before its own preview is even
                // drawn (see the onReplace contract in excelImporter.js). The
                // roster goes with the matches deliberately: the two are one
                // answer to "who plays and what did they play", and a roster
                // left over from a file the admin has just replaced names
                // players the new file may never mention. It is the same pairing
                // Clear All enforces, applied to the same-window re-drop.
                onReplace: () => {
                    state.csvText = null;
                    state.importOverrides = [];
                    state.players = [];
                    rerenderPlayers();
                    setCsvSourceMsg('New file loaded — the previous import and its roster were cleared. '
                        + 'Press "Add these matches" to apply this one.');
                },
                onCompose: async ({ csvText, overrides, players, played, skipped }) => {
                    state.csvText = csvText;
                    state.importOverrides = overrides;

                    // The file's players ARE the roster — it was emptied by
                    // onReplace the moment this file was dropped, so there is
                    // nothing here to merge with and nothing to preserve. Each
                    // name arrives under the flag it last played with (see
                    // resolveDefaultFlags); a name new to the site gets IL.
                    const names = [...players].sort();
                    await ensureAcData();
                    const known = new Set(_acPlayerNames);
                    const defaults = await resolveDefaultFlags(names);
                    state.players = names.map(n => ({
                        name: n,
                        flag: defaults.get(n) || 'IL',
                        retired: false,
                        isNew: !known.has(n)
                    }));
                    rerenderPlayers();

                    const bits = [`${names.length} player${names.length === 1 ? '' : 's'}`,
                                  `${played} played match${played === 1 ? '' : 'es'}`];
                    if (skipped) bits.push(`${skipped} marked not played`);
                    if (overrides.length) bits.push(`${overrides.length} technical`);
                    setCsvSourceMsg(`Imported file: ${bits.join(' · ')}. It becomes this league's match data.`);
                },
            },
        );
    }
    mountImporter();

    // Fill the form from the queued draft, once every field it writes to is
    // wired — the duration and leaderboard toggles are driven by dispatched
    // change events, which do nothing before their listeners exist.
    if (draft) await loadDraftIntoForm(draft);

    /** Drop the imported file and reset the import UI back to its drop zone. */
    function clearImport({ keepMessage = false } = {}) {
        state.csvText = null;
        state.importOverrides = [];
        mountImporter();
        if (!keepMessage) setCsvSourceMsg('');
    }

    // ── Clear All — one undo for "I loaded the wrong thing" ─────────────────
    // Empties the roster AND the imported file together: they are one answer to
    // "who plays and what did they play", and clearing only half of it leaves a
    // league whose CSV names players its roster no longer has.
    document.getElementById('clear-all-players').addEventListener('click', () => {
        const hasRoster = state.players.length > 0;
        const hasImport = !!state.csvText;
        if (!hasRoster && !hasImport) {
            showMsg('add-msg', 'Nothing to clear — the roster is already empty.', 'info');
            return;
        }
        const what = [hasRoster ? `${state.players.length} player${state.players.length === 1 ? '' : 's'}` : null,
                      hasImport ? 'the imported file' : null].filter(Boolean).join(' and ');
        if (!confirm(`Clear ${what}? The league settings above are kept.`)) return;
        state.players = [];
        clearImport();
        presetField.clear();
        rerenderPlayers();
        showMsg('add-msg', 'Roster cleared.', 'success');
    });

    // Save
    document.getElementById('save-new-league').addEventListener('click', async () => {
        const name = document.getElementById('new-league-name').value.trim();
        const type = document.getElementById('new-league-type').value;

        if (!name) {
            showMsg('add-msg', 'Please enter a league name.', 'error');
            return;
        }

        // Uniqueness guard: the league name IS its id (the natural key), so it
        // must not collide with an existing one. Compare the resolved folder id
        // (dash stripped, as stageAddLeague does) case-insensitively against the
        // leagues the admin knows (DisplayOrder is its league list). Without this
        // an upsert would silently overwrite the existing league of that name.
        //
        // A draft being re-saved is excluded from the comparison: `displayOrder`
        // now includes pending leagues (that is what puts them in F1), so
        // without this a draft could not be saved under its own name — the guard
        // would report it as colliding with itself.
        const newFolderId = name.replace(' - ', ' ');
        const existingIds = displayOrder
            .map(t => t.replace(' - ', ' '))
            .filter(id => !draft || id !== draft.id);
        if (existingIds.some(id => id.toLowerCase() === newFolderId.toLowerCase())) {
            showMsg('add-msg', `A league named "${newFolderId}" already exists. League names must be unique.`, 'error');
            return;
        }

        // Second gate on the same rules the disabled button enforces (see
        // createBlockers). The button is the one the admin sees; this is the one
        // that holds if the click arrives anyway — a keyboard activation racing
        // the input event, or a future caller that skips the form.
        const blockers = createBlockers();
        if (blockers.length) {
            showMsg('add-msg', `Before saving: ${blockers.join('; ')}.`, 'error');
            return;
        }
        const duration = readDurationFields('new');

        const options = {
            issueDate: document.getElementById('new-issue-date').value || null,
            inLeaderboard: document.getElementById('new-in-leaderboard').checked,
            entryFee: parseInt(document.getElementById('new-entry-fee').value) || 0,
            matchLength: parseInt(document.getElementById('new-match-length').value) || 7,
            goldCount: parseInt(document.getElementById('new-gold-count').value) || 1,
            silverCount: parseInt(document.getElementById('new-silver-count').value) || 1,
            bronzeCount: parseInt(document.getElementById('new-bronze-count').value) || 4,
            // Extra rows ride inside Prizes (see compute/prizeRows.js); the key is
            // omitted entirely when the admin added none.
            prizes: withExtraPrizeRows({
                Gold: parseInt(document.getElementById('new-prize-gold').value) || 0,
                Silver: parseInt(document.getElementById('new-prize-silver').value) || 0,
                Bronze: parseInt(document.getElementById('new-prize-bronze').value) || 0
            }, readExtraPrizeRows(container)),
            ...duration,
            players: state.players,
            csvText: state.csvText,
            overrides: state.importOverrides,
            // Flags uploaded for THIS league travel with it — read out of the
            // queue here, BEFORE removeGroup below can drop the ones a previous
            // save already folded into the draft's group.
            carryFlags: collectCarriedFlags(),
        };

        // Re-saving a draft REPLACES its queued group outright, and the whole
        // group goes — not just the params.
        //
        // Two reasons it has to be the whole group. A renamed draft is queued
        // under a group id built from the OLD name, so leaving it would publish
        // BOTH leagues, the abandoned one included. And even under an unchanged
        // name, a draft that has since lost its imported file (or its technical
        // overrides) would keep the old CSV and overrides staged: addChange
        // supersedes a target it writes again, and never touches one it doesn't.
        // Dropping the group first makes the queue say exactly what the form
        // says, with nothing surviving from a version of the draft the admin has
        // already moved past.
        //
        // The order this runs in matters: removeGroup takes out the group's
        // landing_settings change too, so `publishedBaseOrder` below is read
        // AFTER it — otherwise the new order would be built on top of an entry
        // for the draft's own old name.
        if (draft) removeGroup(draft.group);
        const publishedBaseOrder = (stagedDisplayOrder() || displayOrder)
            .filter(t => t.replace(' - ', ' ') !== (draft ? draft.id : null));

        // Report a staging failure instead of leaving the form looking like it
        // worked: an exception in here used to reject silently, so the last
        // message on screen ("CSV loaded with N players") read as success while
        // nothing had been staged at all.
        try {
            await stageAddLeague(name, type, publishedBaseOrder, options);
        } catch (err) {
            showMsg('add-msg', `Could not stage this league: ${err.message}`, 'error');
            return;
        }
        showMsg('add-msg', draft
            ? `Pending league updated${name !== draft.id ? ` and renamed to "${name}"` : ''}. It is still one queued creation — publish it from Pending Changes.`
            : `League "${name}" staged. Go to Pending Changes to publish.`, 'success');
        if (refreshBadgeFn) refreshBadgeFn();
        setTimeout(() => { setLeaguesHash(); renderLeagueAdmin(container, refreshBadgeFn); }, 1200);
    });
}

/**
 * Generate a round-robin CSV using the circle method with a random initial shuffle.
 * Each player plays every other exactly once. Rounds are separated by repeated
 * header rows (as expected by parseCSVWithRounds).
 * For N players: N-1 rounds (even) or N rounds with one bye skipped (odd).
 */
function generateRoundRobinCSV(playerNames) {
    const header = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B';
    const players = [...playerNames].sort(() => Math.random() - 0.5);
    if (players.length % 2 !== 0) players.push('Bye');
    const n = players.length;
    const lines = [];

    for (let round = 0; round < n - 1; round++) {
        const roundLines = [];
        for (let i = 0; i < n / 2; i++) {
            const a = players[i];
            const b = players[n - 1 - i];
            if (a !== 'Bye' && b !== 'Bye') {
                roundLines.push(`${a},,,,${b},,,,`);
            }
        }
        if (roundLines.length > 0) {
            lines.push(header);
            lines.push(...roundLines);
        }
        // Rotate all except the fixed first player
        players.splice(1, 0, players.pop());
    }

    return lines.join('\n') + '\n';
}

async function stageAddLeague(name, type, displayOrder, options = {}) {
    // Folder name: title without dash
    const folderName = name.replace(' - ', ' ');

    // All files that make up a brand-new league are staged under a single group
    // so Pending Changes shows (and the badge counts) the whole creation as ONE item.
    const groupId = `add-${folderName}`;
    const groupDescription = `Create league: ${name}`;

    const players = options.players || [];
    const customFlags = {};
    const retiredPlayers = [];
    for (const pl of players) {
        if (pl.flag && pl.flag !== 'IL') customFlags[pl.name] = pl.flag;
        if (pl.retired) retiredPlayers.push(pl.name);
        // Stage uploaded custom flag PNG
        if (pl.flagData && pl.flag) {
            addChange({
                type: 'create',
                target: T.flagAsset(pl.flag),
                content: pl.flagData,
                binary: true,
                description: `Upload flag: ${pl.flag}.png`,
                group: groupId,
                groupDescription
            });
        }
    }

    // Flags uploaded from the Add form, re-staged INTO this group. addChange
    // supersedes a target it writes again, so this does not duplicate the queued
    // upload — it re-labels it as part of this league's creation. From here on,
    // discarding the league discards the flag with it, which is the whole point:
    // an ownerless flag left in the queue is a change the admin cannot connect
    // to anything they remember doing.
    for (const f of options.carryFlags || []) {
        addChange({
            type: 'create',
            target: T.flagAsset(f.code),
            content: f.content,
            binary: true,
            description: `Upload flag: ${f.code}.png`,
            category: 'flag-upload',
            subject: f.code,
            detail: `${f.code}.png`,
            group: groupId,
            groupDescription,
        });
    }

    // league_params.json — no LeagueTitle: the folder id IS the name, and
    // mapParamsToLeagueRow falls the DB `title` column back to the id.
    const params = {
        LeagueType: type,
        GoldCount: options.goldCount ?? 1,
        SilverCount: options.silverCount ?? 1,
        BronzeCount: options.bronzeCount ?? 4,
        Running: true,
        StartDate: new Date().toISOString(),
        CustomFlags: customFlags
    };
    if (options.issueDate) params.IssueDate = options.issueDate;
    // Written only to opt OUT (absent = in), and forced off with no issue date
    // — the toggle is disabled in that state, but the guard is here too so a
    // caller that skips the form can't stage a row the DB CHECK would reject.
    if (!options.issueDate || options.inLeaderboard === false) params.InLeaderboard = false;
    if (options.entryFee) params.EntryFee = options.entryFee;
    if (options.matchLength) params.MatchLength = options.matchLength;
    // Always written, including the default: the params blob is what Pending
    // shows and what publish upserts, so an omitted mode would read as "unknown"
    // in the review step even though the form clearly said "calendar month".
    params.DurationMode = options.durationMode || DEFAULT_DURATION_MODE;
    if (params.DurationMode === 'days' && options.durationDays) params.DurationDays = options.durationDays;
    // Written only when there is something to write — an all-zero prize table is
    // the default and stays out of the JSON. Extra rows count as "something",
    // even when every amount in them is 0: the admin explicitly added those rows.
    if (options.prizes && (options.prizes.Gold || options.prizes.Silver || options.prizes.Bronze
        || countExtraPrizeRows(options.prizes))) {
        params.Prizes = options.prizes;
    }
    if (retiredPlayers.length > 0) params.RetiredPlayers = retiredPlayers;

    // CSV: uploaded text wins; otherwise round-robin from players; otherwise header
    // only. Resolved BEFORE the params change is staged — a manually-built league
    // sets params.ManualEntry here, and staging the params first would freeze a
    // copy without it (that flag is what hides the Upload-CSV tab in Edit League).
    let csvContent;
    if (options.csvText) {
        csvContent = options.csvText;
    } else if (players.length > 1) {
        csvContent = generateRoundRobinCSV(players.map(p => p.name));
        params.ManualEntry = true;
    } else {
        csvContent = 'Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B\n';
    }

    addChange({
        type: 'create',
        target: T.leagueParams(folderName),
        content: JSON.stringify(params, null, 2),
        description: `Create league: ${name}`,
        category: 'create-league',
        subject: name,
        // Pending shows how long the new league will run, so the duration is
        // reviewable before publish rather than only visible afterwards.
        detail: `Runs ${describeDuration(params).toLowerCase()}`,
        group: groupId,
        groupDescription
    });

    addChange({
        type: 'create',
        target: T.leagueCsv(folderName),
        content: csvContent,
        description: `Create CSV for: ${name}`,
        group: groupId,
        groupDescription
    });

    // Technical results decided during the import are overrides, never CSV rows —
    // the same split the Edit-League importer makes (see excelImporter.js). Staged
    // in the creation group so they publish with the league that owns them, and
    // with an empty baseline because there is nothing published to diff against.
    if (options.overrides && options.overrides.length > 0) {
        addChange({
            type: 'update',
            target: T.overrides(folderName),
            content: JSON.stringify({ overrides: options.overrides }, null, 2),
            baselineOverrides: [],
            description: `Technical results for: ${name}`,
            group: groupId,
            groupDescription
        });
    }

    // Register brand-new players into the registry (players_metadata.json) so they
    // enter the "DB" when this league is published — and so the future backend can
    // parse them as known players. Existing players already have records and are
    // left untouched. Build on any already-staged metadata so prior edits survive.
    try {
        const { loadPlayersMetadata } = await import('../data/supabasePlayersMetadata.js');
        let metadata = {};
        const stagedMeta = getStagedContent(T.playersMetadata());
        if (stagedMeta) {
            try { metadata = JSON.parse(stagedMeta); } catch { metadata = {}; }
        } else {
            try { metadata = await loadPlayersMetadata(); } catch { metadata = {}; }
        }
        const known = new Set(Object.keys(metadata));
        try {
            const index = await ensurePlayerIndex();
            for (const n of index.keys()) known.add(n);
        } catch { /* player index is optional here */ }

        const updated = { ...metadata };
        const added = [];
        for (const pl of players) {
            if (!pl.name || known.has(pl.name)) continue;
            const entry = {};
            if (pl.flag && pl.flag !== 'IL') entry.defaultFlag = pl.flag;
            updated[pl.name] = entry;
            known.add(pl.name);
            added.push(pl.name);
        }
        if (added.length > 0) {
            addChange({
                type: 'update',
                target: T.playersMetadata(),
                content: JSON.stringify(updated, null, 2),
                description: `Register new players: ${added.join(', ')}`,
                group: groupId,
                groupDescription
            });
        }
    } catch { /* best-effort registry registration — never block league creation */ }

    // Update landing_settings.json.
    //
    // READ-ONLY on the settings object. `loadLandingSettings()` hands back the
    // very object its memo holds, so the `settings.displayOrder = newOrder` this
    // replaces was writing straight into supabaseLoader's cache — every later
    // read in the page, F1's league list first among them, then saw a published
    // order that included a league which exists nowhere but this queue. That is
    // the whole reason a just-created league showed up in F1 as a red
    // "Failed to load" and then vanished on the next refresh: the row was never
    // real, it was the cache talking.
    const newOrder = [name, ...displayOrder];
    const settings = await loadLandingSettings();
    addChange({
        type: 'update',
        target: T.landingSettings(),
        content: JSON.stringify(landingSettingsPayload(settings, { DisplayOrder: newOrder }), null, 2),
        description: `Add "${name}" to landing settings`,
        group: groupId,
        groupDescription
    });

    if (refreshBadgeFn) refreshBadgeFn();
}

async function stageDeleteLeague(leagueId, title, displayOrder) {
    const groupId = `delete-${leagueId}`;
    const groupDescription = `Delete league: ${title}`;

    addChange({
        type: 'delete',
        target: T.leagueParams(leagueId),
        content: null,
        description: `Delete league params: ${leagueId}`,
        category: 'delete-league',
        subject: title,
        group: groupId,
        groupDescription
    });

    addChange({
        type: 'delete',
        target: T.leagueCsv(leagueId),
        content: null,
        description: `Delete league CSV: ${leagueId}`,
        group: groupId,
        groupDescription
    });

    // Update order in landing_settings.json. Read-only on `settings` — see the
    // same note in stageAddLeague: assigning to it writes into the loader's memo.
    const newOrder = displayOrder.filter(t => t !== title);
    const settings = await loadLandingSettings();
    addChange({
        type: 'update',
        target: T.landingSettings(),
        content: JSON.stringify(landingSettingsPayload(settings, { DisplayOrder: newOrder }), null, 2),
        description: `Remove "${title}" from landing settings`,
        group: groupId,
        groupDescription
    });

    if (refreshBadgeFn) refreshBadgeFn();
}

// ---- Edit League ----

async function renderEditLeague(container, leagueId, displayOrder, openSubtab) {
    restartSplash({ stages: 'adminView' });   // shared loading screen — see syncManager.js
    container.innerHTML = '<h1>Edit League</h1>';

    try {
        // Same as the Add form: the F2 flag dropdowns are only correct once the
        // in-use codes are known (see flagRegistry.js).
        await ensureFlagCodes();
        let params = await loadLeagueParams(leagueId);
        // Prefer staged (unpublished) params so edits survive a page refresh
        // before they are published via Pending Changes.
        const stagedParams = getStagedContent(T.leagueParams(leagueId));
        if (stagedParams) {
            try { params = JSON.parse(stagedParams); } catch { /* fall back to file version */ }
        }
        let players = [];
        try {
            const { allPlayers } = await loadLeagueMatches(leagueId);
            players = [...allPlayers].sort();
        } catch { /* no CSV yet */ }

        renderEditLeagueForm(container, leagueId, params, players, displayOrder, openSubtab);
    } catch (err) {
        container.innerHTML = `<h1>Edit League</h1><div class="admin-msg admin-msg-error">${err.message}</div>`;
    } finally {
        endSplash();   // pairs with restartSplash() — see syncManager.js
    }
}

/**
 * Keep a Save button dormant until something inside `scope` actually changes from
 * its loaded state, then re-enable — mirroring the Round/CSV editors, where Save
 * stays disabled until there's a pending edit. Returns a controller:
 *   - markDirty(): force the dirty state (e.g. a row removed, not an input event)
 *   - markClean(): re-snapshot the current values as the new baseline and disable
 *     (call after a successful save so a fresh edit is needed to re-enable).
 */
function wireDirtySave(scope, saveBtn, isValid = () => true) {
    if (!scope || !saveBtn) return { markDirty() {}, markClean() {} };
    const snapshot = () => Array.from(scope.querySelectorAll('input, select, textarea'))
        .map(c => (c.type === 'checkbox' || c.type === 'radio') ? (c.checked ? '1' : '0') : c.value)
        .join('');
    let baseline = snapshot();
    let forcedDirty = false;
    // `isValid` folds into the SAME disabled flag rather than sitting beside it:
    // this listener is on the whole section, so it fires AFTER any field-level
    // listener and would otherwise re-enable a button a validity check had just
    // switched off. One owner of the flag, no fight over it.
    const refresh = () => {
        const dirty = (forcedDirty || snapshot() !== baseline) && isValid();
        saveBtn.disabled = !dirty;
        saveBtn.classList.toggle('btn-save-ready', dirty);
    };
    scope.addEventListener('input', refresh);
    scope.addEventListener('change', refresh);
    saveBtn.disabled = true;
    saveBtn.classList.remove('btn-save-ready');
    return {
        markDirty() { forcedDirty = true; refresh(); },
        markClean() { forcedDirty = false; baseline = snapshot(); refresh(); }
    };
}

/**
 * Bind an "In Leaderboard" toggle to the Issue Date input it depends on.
 *
 * The dependency is a real rule, not a hint: the leaderboard files a league
 * under the MONTH of its issue date (never its name — see
 * helpers.js → leagueLeaderboardSlot), so with no date there is no column to
 * put it in. The DB enforces the same thing via the
 * leagues_in_leaderboard_needs_date CHECK, so leaving the toggle clickable
 * while the date is empty would just let the admin build a row the database
 * refuses at publish time. Instead the toggle disables itself and says why.
 */
function wireLeaderboardToggle(dateEl, toggleEl, hintEl, defaultOn = true) {
    if (!dateEl || !toggleEl) return;
    // Null until the admin touches the toggle themselves, so a date typed in
    // AFTER the form loaded lands on the intended default (a normal monthly
    // league is in) rather than staying stuck off just because the toggle was
    // forced off while the date was blank.
    let userChoice = null;
    const sync = () => {
        const hasDate = !!dateEl.value;
        toggleEl.disabled = !hasDate;
        toggleEl.checked = hasDate && (userChoice ?? defaultOn);
        if (hintEl) {
            hintEl.textContent = !hasDate
                ? 'Set an issue date first'
                : (toggleEl.checked ? 'Counts toward its year' : 'Excluded from its year');
        }
    };
    dateEl.addEventListener('input', sync);
    dateEl.addEventListener('change', sync);
    toggleEl.addEventListener('change', () => { userChoice = toggleEl.checked; sync(); });
    sync();
}

function renderEditLeagueForm(container, leagueId, params, players, displayOrder, openSubtab) {
    const p = params;
    const running = p.Running === true;
    const hidden = p.Hidden === true;
    const goldCount = p.GoldCount || 1;
    const silverCount = p.SilverCount || 1;
    const bronzeCount = p.BronzeCount || 4;
    const customFlags = p.CustomFlags || {};
    const retiredPlayers = p.RetiredPlayers || [];
    const issueDate = p.IssueDate ? String(p.IssueDate).slice(0, 10) : '';
    // Opt-out flag, but only ever ON for a league that has an issue date to
    // place it under — a dateless league has no month column to occupy.
    const inLeaderboard = p.InLeaderboard !== false && !!issueDate;
    const entryFee = p.EntryFee ?? 0;
    const prizes = p.Prizes || { Gold: 0, Silver: 0, Bronze: 0 };
    // Extra prize rows per medal. Each one awards real places, so it lengthens
    // the podium everywhere (D, B2, the medal tallies) — see compute/prizeRows.js.
    const extraPrizes = getExtraPrizeRows(prizes);

    // External Source sync is now managed on the dedicated Sync page
    // (js/admin/syncManager.js → leagues/sync_settings.json), not per-league here.

    // F2 players-table rows (shared builder — see ffPlayersTableHTML).
    const editPlayerRows = players.map(name => ({
        name,
        flagCode: customFlags[name] || 'IL',
        isRetired: retiredPlayers.includes(name)
    }));

    container.innerHTML = `
        <h1>Edit: ${esc(leagueId)}</h1>
        <button class="btn btn-primary btn-back" id="back-to-leagues" style="margin-bottom:var(--space-lg)">&lsaquo; Back to Leagues</button>

        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">League Settings</h2>
            <div class="collapsible-body">
            <div class="admin-card edit-card-sm">
            <div id="edit-msg"></div>
            <div class="form-group">
                <label for="edit-title">League Name</label>
                <input type="text" id="edit-title" value="${esc(leagueId)}">
                <small class="form-hint">This is the league's id and its page URL. Changing it renames the league everywhere (matches, history, analytics) on publish.</small>
            </div>
            <div class="form-group">
                <label for="edit-type">League Type</label>
                <select id="edit-type">
                    <option value="doubling" ${p.LeagueType === 'doubling' ? 'selected' : ''}>Doubling</option>
                    <option value="regular" ${p.LeagueType === 'regular' ? 'selected' : ''}>Regular</option>
                    <option value="ubc" ${p.LeagueType === 'ubc' ? 'selected' : ''}>UBC</option>
                </select>
            </div>
            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-status">Status</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="edit-status" ${running ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <small style="color:var(--color-text-muted)">${running ? 'Running' : 'Completed'}</small>
                </div>
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-hidden">Hidden</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="edit-hidden" ${hidden ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <small style="color:var(--color-text-muted)">${hidden ? 'Hidden from public' : 'Visible'}</small>
                </div>
                <div class="form-group" style="flex:1;min-width:100px">
                    <label for="edit-in-leaderboard">In Leaderboard</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" id="edit-in-leaderboard"
                               ${inLeaderboard ? 'checked' : ''} ${issueDate ? '' : 'disabled'}>
                        <span class="toggle-slider"></span>
                    </label>
                    <small class="leaderboard-hint" style="color:var(--color-text-muted)"></small>
                </div>
            </div>
            <div class="form-group">
                <label>Medals &amp; Prizes</label>
                ${ffMedalsTableHTML([
                    { medal: 'Gold',   icon: '&#x1F947;', cls: 'medal-gold',   count: goldCount,   countId: 'edit-gold',   prize: prizes.Gold   || 0, prizeId: 'edit-prize-gold',   extra: extraPrizes.Gold },
                    { medal: 'Silver', icon: '&#x1F948;', cls: 'medal-silver', count: silverCount, countId: 'edit-silver', prize: prizes.Silver || 0, prizeId: 'edit-prize-silver', extra: extraPrizes.Silver },
                    { medal: 'Bronze', icon: '&#x1F949;', cls: 'medal-bronze', count: bronzeCount, countId: 'edit-bronze', prize: prizes.Bronze || 0, prizeId: 'edit-prize-bronze', extra: extraPrizes.Bronze },
                ])}
            </div>
            <div class="add-league-row">
                <div class="form-group">
                    <label for="edit-issue-date">Issue Date</label>
                    <input type="date" id="edit-issue-date" class="themed-date" value="${issueDate}">
                    <small class="form-hint">Sets the league's month column in the Annual Leaderboard.</small>
                </div>
                <div class="form-group">
                    <label for="edit-entry-fee">Entry Fee</label>
                    <input type="number" id="edit-entry-fee" value="${entryFee}" min="0" step="1">
                </div>
                <div class="form-group">
                    <label for="edit-match-length">Match Length</label>
                    <input type="number" id="edit-match-length" value="${p.MatchLength || 7}" min="1" max="25" step="2">
                </div>
            </div>
            ${durationFieldsHTML('edit', p)}
            <button class="btn btn-primary" id="save-league-settings">Save Settings</button>
            </div>
            </div>
          </div>
        </div>

        <div class="dash-section" id="match-results-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Match Results</h2>
            <div class="collapsible-body">
            <div id="match-tab-bar"></div>
            <div id="match-panel-rounds" class="subtab-panel" hidden></div>
            ${!params.ManualEntry ? `
            <div id="match-panel-upload" class="subtab-panel" hidden></div>
            <div id="match-panel-overrides" class="subtab-panel" hidden></div>
            ` : ''}
            </div>
          </div>
        </div>

        ${players.length > 0 ? `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Players (${players.length})</h2>
            <div class="collapsible-body">
            <div class="admin-card">
            <div id="players-msg"></div>
            ${ffPlayersTableHTML('F2', editPlayerRows)}
            <div style="margin-top:var(--space-md)">
                <button class="btn btn-primary" id="save-players">Save Player Changes</button>
            </div>
            ${uploadFlagPanelHTML()}
            </div>
            </div>
          </div>
        </div>
        ` : '<div class="admin-card"><p style="color:var(--color-text-muted)">No players yet. Upload a CSV first.</p></div>'}

    `;

    wireLeaderboardToggle(
        container.querySelector('#edit-issue-date'),
        container.querySelector('#edit-in-leaderboard'),
        container.querySelector('#edit-in-leaderboard')?.closest('.form-group')?.querySelector('.leaderboard-hint'),
        inLeaderboard
    );
    wireDurationFields(container, 'edit');

    // F2 (Players) — sticky-col drop-shadow on horizontal scroll, same as F1/F4 (FF chrome).
    container.querySelectorAll('.ff-wrap').forEach(w => attachStickyShadow(w));

    wireMedalsTable(container);

    // Match Results sub-tabs — same pattern as dashboard "Remaining Matches" tabs.
    // Round Editor renders Table F2 for ALL leagues; manual overrides win over CSV.
    setupMatchResultsTabs(leagueId, params, refreshBadgeFn, openSubtab);

    // Collapsible section headers (League Settings / Match Results / Players).
    // Shared mechanism (css/sections.css + sectionCollapse.js), identical to the
    // landing / dashboard / player pages. All open by default.
    container.querySelectorAll('.app-section').forEach(s => wireSectionCollapse(s, { defaultOpen: true }));

    // Keep "Save Settings" / "Save Player Changes" disabled until something in
    // their section actually changes — same dormant-until-edited behaviour the
    // Round/CSV editors already use. Re-enabled on any edit, re-disabled on save.
    const settingsSaveBtn = document.getElementById('save-league-settings');
    // Save Settings stays off while the duration pair is one the DB would refuse
    // (see durationFieldsValid) — the same gate Add League puts on Create League.
    const settingsTracker = wireDirtySave(
        settingsSaveBtn && settingsSaveBtn.closest('.app-section'),
        settingsSaveBtn,
        () => durationFieldsValid('edit'),
    );
    // Scope to the F2 player table only — the "Custom Flag" upload panel in the same
    // section has its own Upload action and must not arm "Save Player Changes".
    const playersSaveBtn = document.getElementById('save-players');
    const playersTracker = wireDirtySave(container.querySelector('[data-ff-table="F2"]'), playersSaveBtn);

    // Status toggle label update
    document.getElementById('edit-status').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Running' : 'Completed';
    });

    // Hidden toggle label update
    document.getElementById('edit-hidden').addEventListener('change', function() {
        this.closest('.form-group').querySelector('small').textContent = this.checked ? 'Hidden from public' : 'Visible';
    });

    // F2 flag-select preview/custom-code toggle (shared with F2b in Add League).
    wireFlagSelectPreview(container);

    // Back
    document.getElementById('back-to-leagues').addEventListener('click', () => {
        setLeaguesHash();
        renderLeagueAdmin(container, refreshBadgeFn);
    });

    // Custom file input labels (edit form)
    container.querySelectorAll('.custom-file-input input[type="file"]').forEach(inp => {
        inp.addEventListener('change', () => {
            const span = inp.parentElement.querySelector('.file-name');
            if (span) span.textContent = inp.files.length ? inp.files[0].name : 'No file chosen';
        });
    });

    // Save settings — the "League Name" field IS the league id (the natural key
    // shown everywhere). Changing it drives a real rename cascade, not a cosmetic
    // title edit: the id, its ?league= URL, and every reference (matches /
    // overrides / history / snapshots / sync / analytics) move together via the
    // rename_league RPC. There is no separate visual title any more.
    document.getElementById('save-league-settings').addEventListener('click', async () => {
        const newName = document.getElementById('edit-title').value.trim();
        const renaming = !!newName && newName !== leagueId;

        // Second gate on the same rule the disabled button enforces (see
        // durationFieldsValid). The button is the one the admin sees; this is
        // the one that holds if a click arrives anyway.
        if (!durationFieldsValid('edit')) {
            showMsg('edit-msg', 'Set how many days the league runs (at least 1) before saving.', 'error');
            return;
        }

        if (renaming) {
            // Uniqueness (case-insensitive) against the leagues the admin knows —
            // DisplayOrder is its league list. The RPC re-checks server-side, so
            // this is early feedback, not the authority.
            const existingIds = displayOrder.map(t => t.replace(' - ', ' '));
            if (existingIds.some(id => id.toLowerCase() === newName.toLowerCase() && id !== leagueId)) {
                showMsg('edit-msg', `A league named "${newName}" already exists. League names must be unique.`, 'error');
                return;
            }
            // A rename rewrites this league's id everywhere; any change still
            // staged under the OLD id would publish in an undefined order against
            // it (or resurrect it). Require a clean slate for this league first.
            if (hasLeagueChanges(leagueId)) {
                showMsg('edit-msg', 'Publish or discard this league’s other pending changes before renaming it.', 'error');
                return;
            }
            if (!confirm(`Rename this league from "${leagueId}" to "${newName}"?\n\nThis changes its id and its ?league= URL, and moves every reference (matches, overrides, history, analytics) to the new name. Links saved to the old name will stop working.`)) {
                return;
            }
        }

        const targetId = renaming ? newName : leagueId;
        const stagedJson = getStagedContent(T.leagueParams(leagueId));
        const baseParams = stagedJson ? JSON.parse(stagedJson) : params;
        const newParams = { ...baseParams };
        delete newParams.LeagueTitle; // the id is the name — no cosmetic title stored
        newParams.LeagueType = document.getElementById('edit-type').value;
        newParams.Running = document.getElementById('edit-status').checked;
        newParams.Hidden = document.getElementById('edit-hidden').checked;
        newParams.GoldCount = parseInt(document.getElementById('edit-gold').value) || 1;
        newParams.SilverCount = parseInt(document.getElementById('edit-silver').value) || 1;
        newParams.BronzeCount = parseInt(document.getElementById('edit-bronze').value) || 4;
        const issueDateVal = document.getElementById('edit-issue-date').value;
        if (issueDateVal) newParams.IssueDate = issueDateVal;
        else delete newParams.IssueDate;
        // Stored opt-OUT-only: absent means "in", so only an explicit exclusion
        // is written (matches how Hidden is kept out of the JSON when false).
        // A league with no issue date can never be in, whatever the (disabled)
        // toggle reads.
        if (issueDateVal && document.getElementById('edit-in-leaderboard').checked) {
            delete newParams.InLeaderboard;
        } else {
            newParams.InLeaderboard = false;
        }
        newParams.EntryFee = parseInt(document.getElementById('edit-entry-fee').value) || 0;
        newParams.MatchLength = parseInt(document.getElementById('edit-match-length').value) || 7;
        // Extra rows ride inside Prizes (see compute/prizeRows.js) — withExtraPrizeRows
        // drops the key entirely when there are none, so a league that doesn't use
        // them keeps exactly the JSON it had.
        newParams.Prizes = withExtraPrizeRows({
            Gold: parseInt(document.getElementById('edit-prize-gold').value) || 0,
            Silver: parseInt(document.getElementById('edit-prize-silver').value) || 0,
            Bronze: parseInt(document.getElementById('edit-prize-bronze').value) || 0
        }, readExtraPrizeRows(container));

        // Duration. DurationDays is dropped outside 'days' mode so a count left
        // over from a previous mode can't linger in the params and reappear if
        // the mode is switched back.
        const duration = readDurationFields('edit');
        const durationBefore = describeDuration(baseParams);
        newParams.DurationMode = duration.durationMode;
        if (duration.durationMode === 'days' && duration.durationDays) newParams.DurationDays = duration.durationDays;
        else delete newParams.DurationDays;

        // Remove Hidden if false (keep JSON clean)
        if (!newParams.Hidden) delete newParams.Hidden;

        // Pending detail — name the duration only when it actually changed, so
        // the row says what this edit did rather than restating every setting.
        const durationAfter = describeDuration(newParams);
        const settingsDetail = durationAfter !== durationBefore
            ? `Duration: ${durationBefore.toLowerCase()} → ${durationAfter.toLowerCase()}`
            : null;

        const groupId = renaming ? `rename-${leagueId}` : undefined;
        const groupDescription = renaming ? `Rename league: ${leagueId} → ${newName}` : undefined;

        if (renaming) {
            // 1. The rename itself, staged FIRST so publish runs it before the
            //    params upsert lands on the (now-renamed) row instead of inserting
            //    a duplicate under the new id.
            addChange({
                type: 'update',
                target: T.leagueRename(leagueId),
                content: JSON.stringify({ newId: newName }),
                description: `Rename league: ${leagueId} → ${newName}`,
                category: 'league-rename',
                subject: newName,
                group: groupId,
                groupDescription
            });
            // 2. Keep this league's slot in the landing order under the new id.
            //    The dash↔space map treats a raw-id entry as itself, so writing
            //    newName is safe for both old dash-titles and free-form names.
            //    Base off any already-staged landing edit so a pending reorder is
            //    preserved.
            try {
                const stagedLanding = getStagedContent(T.landingSettings());
                const ls = stagedLanding ? JSON.parse(stagedLanding) : await loadLandingSettings();
                const order = ls.DisplayOrder || ls.displayOrder || [];
                const swapped = order.map(e => e.replace(' - ', ' ') === leagueId ? newName : e);
                addChange({
                    type: 'update',
                    target: T.landingSettings(),
                    content: JSON.stringify(landingSettingsPayload(ls, { DisplayOrder: swapped }), null, 2),
                    description: `Landing order: ${leagueId} → ${newName}`,
                    category: 'landing',
                    subject: newName,
                    group: groupId,
                    groupDescription
                });
            } catch { /* landing order is best-effort; the rename itself is what matters */ }
        }

        // 3. Settings, under the TARGET id (runs after the rename in publish order).
        addChange({
            type: 'update',
            target: T.leagueParams(targetId),
            content: JSON.stringify(newParams, null, 2),
            description: `Update settings: ${targetId}`,
            category: 'league-settings',
            subject: targetId,
            detail: settingsDetail,
            group: groupId,
            groupDescription
        });

        if (refreshBadgeFn) refreshBadgeFn();
        settingsTracker.markClean();
        showMsg('edit-msg', renaming
            ? `Rename to "${newName}" staged. Publish to apply it everywhere.`
            : 'Settings staged. Go to Pending Changes to publish.', 'success');
    });

    // Remove player buttons.
    //
    // Removing a player removes THE PLAYER, matches included. It has to: the
    // roster of a league is derived from its matches, so a player whose rows
    // survive is simply back on the table at the next render — which is exactly
    // what used to happen. `removedPlayers` was collected here and never read by
    // anything, so the only lasting effect of a removal was that the rebuilt
    // CustomFlags / RetiredPlayers no longer mentioned the player: their flag
    // and retired mark were silently dropped and they reappeared flying IL. A
    // removal that damages the player and then hands them back is worse than one
    // that refuses.
    //
    // The confirm says what actually happens, including the part that reaches
    // beyond this player: his opponents keep their other results, but every
    // match against HIM is gone, so their totals move too.
    const removedPlayers = new Set();
    container.querySelectorAll('.player-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const player = btn.dataset.removePlayer;
            if (!confirm(
                `Remove "${player}" from this league?\n\n`
                + `Every match he played here is deleted, along with any technical result of his. `
                + `His opponents keep their other games, but their totals change — the matches against him no longer exist.\n\n`
                + `If he has played in no other league, his player record is removed too.\n\n`
                + `Nothing is written until you publish.`
            )) return;
            removedPlayers.add(player);
            const row = btn.closest('tr');
            if (row) row.remove();
            playersTracker.markDirty();
            showMsg('players-msg', `"${player}" marked for removal. Click "Save Player Changes" to apply.`, 'success');
        });
    });

    // Save players
    if (document.getElementById('save-players')) {
        document.getElementById('save-players').addEventListener('click', async () => {
            const newCustomFlags = {};
            const newRetired = [];
            const renames = []; // { from, to }

            // Collect player changes
            container.querySelectorAll('.player-name-input').forEach(input => {
                const original = input.dataset.original;
                const newName = input.value.trim();
                if (newName !== original && newName) {
                    renames.push({ from: original, to: newName });
                }
            });

            container.querySelectorAll('.player-flag-select').forEach(sel => {
                const player = sel.dataset.player;
                // Resolve name after renames
                const rename = renames.find(r => r.from === player);
                const finalName = rename ? rename.to : player;

                let flagCode;
                if (sel.value === '__custom') {
                    const row = sel.closest('tr');
                    flagCode = row.querySelector('.player-flag-custom').value.trim().toUpperCase();
                } else {
                    flagCode = sel.value;
                }

                if (flagCode && flagCode !== 'IL') {
                    newCustomFlags[finalName] = flagCode;
                }
            });

            container.querySelectorAll('.player-retired-check').forEach(chk => {
                if (chk.checked) {
                    const player = chk.dataset.player;
                    const rename = renames.find(r => r.from === player);
                    newRetired.push(rename ? rename.to : player);
                }
            });

            // Update params — use staged version as base if it exists
            const stagedPlayerJson = getStagedContent(T.leagueParams(leagueId));
            const playerBaseParams = stagedPlayerJson ? JSON.parse(stagedPlayerJson) : params;
            const updatedParams = { ...playerBaseParams };
            updatedParams.CustomFlags = newCustomFlags;
            if (newRetired.length > 0) {
                updatedParams.RetiredPlayers = newRetired;
            } else {
                delete updatedParams.RetiredPlayers;
            }


            // One group so the params + CSV-rename side-effect collapse to a single
            // Pending row instead of two ("Update players" + "Rename players in CSV").
            const editGroupId = `edit-players-${leagueId}`;
            const editGroupDesc = `Players updated: ${leagueId}`;
            // The detail line is the ONLY thing separating one player edit from
            // another in Pending and in Historical — the group collapses to a
            // single "Players updated" row headlined by this change, so a
            // removal that is not named here is a removal nobody can see before
            // publishing it. Removals lead: they are the destructive half.
            const detailBits = [];
            if (removedPlayers.size > 0) detailBits.push(`removed ${[...removedPlayers].join(', ')}`);
            if (renames.length > 0) detailBits.push(renames.map(r => `${r.from} → ${r.to}`).join(', '));
            const editDetail = detailBits.length > 0 ? detailBits.join(' · ') : null;

            addChange({
                type: 'update',
                target: T.leagueParams(leagueId),
                content: JSON.stringify(updatedParams, null, 2),
                description: `Update players: ${leagueId}`,
                category: 'league-players',
                subject: leagueId,
                detail: editDetail,
                group: editGroupId,
                groupDescription: editGroupDesc
            });

            // Handle renames in CSV
            if (renames.length > 0) {
                try {
                    const { matches: allMatches } = await loadLeagueMatchesAll(leagueId);
                    let csvText = matchesToCsvText(allMatches);

                    for (const { from, to } of renames) {
                        // Replace player name at start of field (column 0 or column 4)
                        csvText = csvText.split('\n').map(line => {
                            const parts = line.split(',');
                            if (parts.length >= 8) {
                                if (parts[0].trim() === from) parts[0] = to;
                                if (parts[4].trim() === from) parts[4] = to;
                            }
                            return parts.join(',');
                        }).join('\n');
                    }

                    addChange({
                        type: 'update',
                        target: T.leagueCsv(leagueId),
                        content: csvText,
                        description: `Rename players in CSV: ${renames.map(r => `${r.from} → ${r.to}`).join(', ')}`,
                        category: 'league-players',
                        subject: leagueId,
                        detail: editDetail,
                        group: editGroupId,
                        groupDescription: editGroupDesc
                    });
                } catch (err) {
                    showMsg('players-msg', `Warning: Could not update CSV for renames: ${err.message}`, 'error');
                }
            }

            // ── Removals: the player, his matches, his overrides, and his record
            //
            // Staged into the SAME group as the params edit, so Pending shows one
            // bundle per save rather than four unrelated-looking rows, and
            // Historical files them under one batch.
            let removalNote = '';
            if (removedPlayers.size > 0) {
                const gone = [...removedPlayers];
                const isGone = (n) => removedPlayers.has(n);
                try {
                    // 1. Matches. Every row he appears on, played or not — an
                    //    unplayed row is still a fixture that names him, and
                    //    leaving it would put him straight back on the roster.
                    const { matches: allMatches } = await loadLeagueMatchesAll(leagueId);
                    const kept = allMatches.filter(m => !isGone(m.playerA) && !isGone(m.playerB));
                    const dropped = allMatches.length - kept.length;
                    addChange({
                        type: 'update',
                        target: T.leagueCsv(leagueId),
                        content: matchesToCsvText(kept),
                        description: `Remove ${gone.join(', ')} from match data: ${leagueId}`,
                        category: 'league-data',
                        subject: leagueId,
                        detail: `${dropped} match${dropped === 1 ? '' : 'es'} deleted`,
                        group: editGroupId,
                        groupDescription: editGroupDesc,
                    });
                    removalNote = ` ${dropped} match${dropped === 1 ? '' : 'es'} removed.`;

                    // 2. Technical results for a match that no longer exists are
                    //    orphans — an override is a verdict ON a pairing.
                    const overrides = await readOverridesForEdit(leagueId);
                    const keptOv = overrides.filter(o => !isGone(o.playerA) && !isGone(o.playerB));
                    if (keptOv.length !== overrides.length) {
                        await stageManualOverrides(leagueId, keptOv);
                    }

                    // 3. The player record itself, but ONLY for someone this
                    //    league was the whole of. The index is built from
                    //    published matches, so a player whose only other
                    //    appearance is itself still unpublished counts as
                    //    league-less here — deliberately: the record can be
                    //    re-created, and guessing the other way would delete a
                    //    record that another queued league still needs.
                    await ensurePlayerIndex();
                    const orphans = gone.filter(n =>
                        getPlayerLeagues(n).filter(l => l.leagueId && l.leagueId !== leagueId).length === 0);
                    if (orphans.length > 0) {
                        const stagedMeta = getStagedContent(T.playersMetadata());
                        let metadata = {};
                        if (stagedMeta) {
                            try { metadata = JSON.parse(stagedMeta); } catch { metadata = {}; }
                        } else {
                            try { metadata = await loadPlayersMetadata(); } catch { metadata = {}; }
                        }
                        const present = orphans.filter(n => n in metadata);
                        if (present.length > 0) {
                            const next = { ...metadata };
                            for (const n of present) delete next[n];
                            addChange({
                                type: 'update',
                                target: T.playersMetadata(),
                                content: JSON.stringify(next, null, 2),
                                description: `Delete player record: ${present.join(', ')}`,
                                category: 'player-meta',
                                subject: present.join(', '),
                                detail: `Played in no other league`,
                                group: editGroupId,
                                groupDescription: editGroupDesc,
                            });
                            removalNote += ` Player record deleted for ${present.join(', ')}.`;
                        }
                    }
                } catch (err) {
                    showMsg('players-msg', `Could not stage the removal: ${err.message}`, 'error');
                    return;
                }
            }

            if (refreshBadgeFn) refreshBadgeFn();
            playersTracker.markClean();
            showMsg('players-msg', `Player changes staged.${removalNote}`, 'success');
        });
    }

    // Upload custom flag (shared panel + handler — also used by F2b in Add League).
    wireUploadFlagPanel();
}

// ---- FF Players table (F2 / F2b) ----
// Single source of truth for the unified admin players table so F2 (Players in
// Edit League) and F2b (players in Add New League) are byte-identical in format
// and button chrome, differing only in their data + wiring. See docs/TABLE-DESIGN.md.

/** One F2/F2b row: Name input · Flag (preview + dropdown + custom code) · Retired toggle · ✕ remove. */
function ffPlayerRowHTML(name, flagCode, isRetired) {
    const isKnown = KNOWN_FLAGS.includes(flagCode);
    const flagOptions = KNOWN_FLAGS.map(f =>
        `<option value="${f}" ${f === flagCode ? 'selected' : ''}>${f}</option>`
    ).join('');
    return `
            <tr>
                <td>
                    <input type="text" class="player-name-input" data-original="${esc(name)}" value="${esc(name)}"
                        style="width:140px;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px">
                        <img class="flag" src="assets/flags/${flagCode}.png" alt="${flagCode}">
                        <select class="player-flag-select" data-player="${esc(name)}" style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px">
                            ${flagOptions}
                            <option value="__custom" ${!isKnown ? 'selected' : ''}>Custom...</option>
                        </select>
                        <input type="text" class="player-flag-custom" placeholder="Code" style="width:50px;padding:2px 4px;border:1px solid var(--color-border);border-radius:4px;display:${isKnown ? 'none' : 'inline'}"
                            value="${!isKnown ? flagCode : ''}">
                    </div>
                </td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" class="player-retired-check" data-player="${esc(name)}" ${isRetired ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td><button class="btn btn-danger btn-sm player-remove-btn" data-remove-player="${esc(name)}" title="Remove player">&#10005;</button></td>
            </tr>`;
}

/**
 * Full FF players table (.ff-wrap + .admin-table.font-large).
 * @param {string} tableId   - 'F2' (Edit) or 'F2b' (Add); tagged as data-ff-table.
 * @param {Array<{name:string,flagCode:string,isRetired:boolean}>} rows
 * @param {string} [emptyMessage] - placeholder row shown when rows is empty.
 */
function ffPlayersTableHTML(tableId, rows, emptyMessage) {
    const body = rows.length
        ? rows.map(r => ffPlayerRowHTML(r.name, r.flagCode, r.isRetired)).join('')
        : (emptyMessage ? `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted)">${esc(emptyMessage)}</td></tr>` : '');
    return `
            <div class="ff-wrap">
                <table class="admin-table font-large" data-ff-table="${tableId}">
                    <thead>
                        <tr><th scope="col">${thLabel('Name', 'Name')}</th><th scope="col">${thLabel('Flag', 'Flag')}</th><th scope="col">${thLabel('Retired', 'Ret')}</th><th scope="col"></th></tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
}

/**
 * One EXTRA prize row under a medal — same Count/Prize pair as the medal's own
 * row, but unnamed (read by position within its tier, not by id) so a tier can
 * hold any number of them. See js/compute/prizeRows.js for what they mean.
 */
function ffMedalsExtraRowHTML(tier, count, prize) {
    const t = MEDAL_TIERS.find(m => m.tier === tier);
    if (!t) return '';
    return `
            <tr data-prize-tier="${tier}" data-prize-row="extra">
                <td><span class="medal-cell ${t.cls} is-extra"><span class="medal-icon">${t.iconHtml}</span> ${esc(tier)}</span></td>
                <td><input type="number" class="prize-extra-count" value="${count}" min="1" max="20"></td>
                <td><input type="number" class="prize-extra-prize" value="${prize}" min="0" step="1"></td>
                <td class="prize-row-actions"><button type="button" class="btn btn-danger btn-xs prize-row-del" title="Remove this prize row" aria-label="Remove this ${esc(tier)} prize row">&times;</button></td>
            </tr>`;
}

/**
 * F6 — Medals & Prizes table. Shared by Edit League and Add New League so both
 * are byte-identical. Uses the unified FF chrome (.ff-wrap + .admin-table
 * .font-large, tagged data-mf-table-id="F6"): a Display cell (medal label+icon)
 * plus two Edit cells (Count, Prize number inputs). The medal's own row keeps
 * its stable input ids so the Save/Create handlers read it unchanged; any EXTRA
 * prize rows under it are unnamed and read by position (readExtraPrizeRows).
 * The fourth column holds the add/remove buttons. Hand-built FF chrome like
 * F1–F4 — the mountFFTable rewire is Phase 8 of
 * docs/plans/table-lab-unification.md.
 * @param {Array<{medal,icon,cls,count,countId,prize,prizeId,extra}>} rows
 *        `extra` is that tier's saved extra rows ([{count,prize}], optional).
 */
function ffMedalsTableHTML(rows) {
    const body = rows.map(r => `
            <tr data-prize-tier="${r.medal}" data-prize-row="base">
                <td><span class="medal-cell ${r.cls}"><span class="medal-icon">${r.icon}</span> ${esc(r.medal)}</span></td>
                <td><input type="number" id="${r.countId}" value="${r.count}" min="0" max="20"></td>
                <td><input type="number" id="${r.prizeId}" value="${r.prize}" min="0" step="1"></td>
                <td class="prize-row-actions"><button type="button" class="btn btn-secondary btn-xs prize-row-add" title="Add another prize row for ${esc(r.medal)}" aria-label="Add another ${esc(r.medal)} prize row">+</button></td>
            </tr>`
        + (r.extra || []).map(e => ffMedalsExtraRowHTML(r.medal, e.count, e.prize)).join('')
    ).join('');
    return `
            <div class="ff-wrap">
                <table class="admin-table font-large" data-mf-table-id="F6">
                    <thead>
                        <tr><th scope="col">${thLabel('Medal', 'Medal')}</th><th scope="col">${thLabel('Count', 'Count')}</th><th scope="col">${thLabel('Prize', 'Prize')}</th><th scope="col"></th></tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
}

/**
 * Wire the F6 add/remove buttons. Delegated on the table so rows added at
 * runtime are live without re-binding, and each new row is inserted directly
 * below the last row of ITS tier — the table stays in podium order however many
 * rows a tier grows.
 * @param {ParentNode} scope — the form container holding one F6 table
 */
function wireMedalsTable(scope) {
    const table = scope.querySelector('[data-mf-table-id="F6"]');
    if (!table) return;
    // Adding or removing a row IS an edit, but a click fires neither input nor
    // change — without this the "Save Settings" dirty-tracker would stay dormant
    // until the admin also typed into the new row.
    const notifyEdited = () => table.dispatchEvent(new Event('change', { bubbles: true }));
    table.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.prize-row-add');
        if (addBtn) {
            const row = addBtn.closest('tr');
            const tier = row.dataset.prizeTier;
            let last = row;
            while (last.nextElementSibling && last.nextElementSibling.dataset.prizeTier === tier) {
                last = last.nextElementSibling;
            }
            last.insertAdjacentHTML('afterend', ffMedalsExtraRowHTML(tier, 1, 0));
            last.nextElementSibling.querySelector('.prize-extra-count')?.focus();
            notifyEdited();
            return;
        }
        const delBtn = e.target.closest('.prize-row-del');
        if (delBtn) { delBtn.closest('tr').remove(); notifyEdited(); }
    });
}

/**
 * Replace the extra prize rows in one F6 table with the given tier→rows map.
 * Used by the Add-League preset picker, which fills a form that is already on
 * screen — its base rows are just value assignments, but the extra rows are
 * whole <tr>s that have to be rebuilt.
 * @param {ParentNode} scope — the form container holding one F6 table
 */
function applyExtraPrizeRows(scope, extra) {
    const table = scope.querySelector('[data-mf-table-id="F6"]');
    if (!table) return;
    table.querySelectorAll('tr[data-prize-row="extra"]').forEach(tr => tr.remove());
    for (const { tier } of MEDAL_TIERS) {
        const base = table.querySelector(`tr[data-prize-tier="${tier}"][data-prize-row="base"]`);
        if (!base) continue;
        let after = base;
        for (const r of (extra && extra[tier]) || []) {
            after.insertAdjacentHTML('afterend', ffMedalsExtraRowHTML(tier, r.count, r.prize));
            after = after.nextElementSibling;
        }
    }
}

/**
 * Read the extra prize rows out of one F6 table, as the tier→rows map that
 * withExtraPrizeRows() expects.
 * @param {ParentNode} scope — the form container holding one F6 table
 */
function readExtraPrizeRows(scope) {
    const out = {};
    const table = scope.querySelector('[data-mf-table-id="F6"]');
    if (!table) return out;
    for (const tr of table.querySelectorAll('tr[data-prize-row="extra"]')) {
        const tier = tr.dataset.prizeTier;
        (out[tier] ||= []).push({
            count: parseInt(tr.querySelector('.prize-extra-count').value, 10) || 0,
            prize: parseInt(tr.querySelector('.prize-extra-prize').value, 10) || 0,
        });
    }
    return out;
}

/* ---- League Duration (Add + Edit) ----
   How long the league runs, in the same `.add-league-row` chrome as Issue Date
   and Match Length: label above, full-width control, hint below. The Days count
   is a SIBLING field rather than a second control crammed into one group, so it
   inherits that chrome unchanged and is simply hidden in the two modes that have
   no count. Ids are prefixed per form ('new' / 'edit') so both can be on screen
   in the same session without colliding. */

/**
 * @param {'new'|'edit'} prefix
 * @param {object} [params] — the league being edited (Add starts on the default)
 */
function durationFieldsHTML(prefix, params) {
    const mode = durationMode(params || {});
    const days = durationDays(params || {}) || 30;
    const options = DURATION_MODES
        .map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${esc(DURATION_MODE_LABELS[m])}</option>`)
        .join('');
    return `
            <div class="add-league-row">
                <div class="form-group">
                    <label for="${prefix}-duration-mode">Duration</label>
                    <select id="${prefix}-duration-mode">${options}</select>
                    <small class="form-hint duration-window-hint"></small>
                </div>
                <div class="form-group duration-days-group" ${mode === 'days' ? '' : 'hidden'}>
                    <label for="${prefix}-duration-days">Days</label>
                    <input type="number" id="${prefix}-duration-days" value="${days}" min="1" max="365" step="1">
                    <small class="form-hint">Counted from the Issue Date, including it.</small>
                </div>
            </div>`;
}

/**
 * Show the Days field only in 'days' mode, and state the END DATE the current
 * settings produce — under the Duration select itself, so it is visible in every
 * mode rather than only in the one that happens to show a second field. An
 * admin should see the window before saving, not discover it after publishing.
 */
function wireDurationFields(scope, prefix, onChange = null) {
    const modeSel = scope.querySelector(`#${prefix}-duration-mode`);
    const daysInput = scope.querySelector(`#${prefix}-duration-days`);
    if (!modeSel || !daysInput) return;
    const daysGroup = daysInput.closest('.form-group');
    const hint = modeSel.closest('.form-group').querySelector('.duration-window-hint');
    const dateInput = scope.querySelector(`#${prefix}-issue-date`);

    const sync = () => {
        const mode = modeSel.value;
        daysGroup.hidden = mode !== 'days';
        // See durationFieldsValid: 'days' with no count is the one pair the DB
        // refuses. Caught here, in the field the admin is looking at, it is a
        // hint; caught at publish it is a league that cannot be repaired.
        //
        // The save button is NOT touched from here. Both forms have more than
        // one reason to refuse a save, and two functions writing `disabled`
        // fight — the one whose listener runs last wins, which on the Edit form
        // is the section-wide dirty tracker. So this reports the change and lets
        // each form's single gate decide.
        const daysInvalid = !durationFieldsValid(prefix);
        const window = leagueDateWindow({
            IssueDate: dateInput ? dateInput.value : null,
            DurationMode: mode,
            DurationDays: daysInput.value,
        });
        if (daysInvalid) {
            hint.textContent = 'Enter how many days the league runs (at least 1).';
        } else if (mode === 'unlimited') {
            hint.textContent = 'Runs with no end date — the dashboard shows no time progress.';
        } else if (window) {
            // Spell out the LENGTH next to the dates. In calendar-month mode the
            // length depends on where in the month the league opens (issued on
            // the 21st of a 28-day month it runs 8 days), and the dates alone
            // make that easy to miss.
            const total = daysBetween(window.start, window.end) + 1;
            hint.textContent = `Runs ${formatAdminDate(toIsoDay(window.start))} → ${formatAdminDate(toIsoDay(window.end))}`
                + ` (${total} day${total === 1 ? '' : 's'}).`;
        } else {
            hint.textContent = 'Set an Issue Date to see the end date.';
        }
        if (onChange) onChange();
    };
    modeSel.addEventListener('change', sync);
    daysInput.addEventListener('input', sync);
    if (dateInput) dateInput.addEventListener('change', sync);
    sync();
}

/**
 * Is this form's duration pair one the database will accept?
 *
 * The ONE combination it refuses: 'days' mode with no count. The
 * leagues_duration_days_pairing CHECK requires duration_days > 0 in that mode
 * and NULL in every other, and the `min="1"` on the input is inert — nothing
 * submits a form here, so an emptied or zeroed field sails through and the
 * rejection lands at PUBLISH time instead. On Add League that is the worst
 * possible place for it: the create group has already put the name in the
 * landing order, the params row is refused, staging is cleared, and what's left
 * is a league that cannot be repaired from the UI. Both forms therefore gate
 * their own save button on this.
 */
function durationFieldsValid(prefix) {
    const mode = document.getElementById(`${prefix}-duration-mode`)?.value;
    if (mode !== 'days') return true;
    return parseInt(document.getElementById(`${prefix}-duration-days`)?.value, 10) > 0;
}

/** Read the duration settings out of one of the two forms. */
function readDurationFields(prefix) {
    const mode = document.getElementById(`${prefix}-duration-mode`)?.value || DEFAULT_DURATION_MODE;
    const days = parseInt(document.getElementById(`${prefix}-duration-days`)?.value, 10);
    return {
        durationMode: DURATION_MODES.includes(mode) ? mode : DEFAULT_DURATION_MODE,
        durationDays: mode === 'days' && days > 0 ? days : null,
    };
}

/** Local-midnight Date → "YYYY-MM-DD" (formatAdminDate's input shape). */
function toIsoDay(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The "Upload Custom Flag" panel that accompanies an FF players table. */
function uploadFlagPanelHTML() {
    return `
            <h3 class="admin-subhead">Custom Flag</h3>
            <div class="form-group">
                <label for="upload-flag-code">Flag code + PNG</label>
                <div class="input-action-row">
                    <input type="text" id="upload-flag-code" class="input-code" placeholder="XX" maxlength="3">
                    ${filePickerHTML('upload-flag-file', { label: 'Choose File', accept: 'image/*' })}
                    <button class="btn btn-secondary btn-sm" id="upload-flag-btn">Upload</button>
                </div>
                <small class="form-hint">Register a 2-letter code with a PNG to use a non-default flag.</small>
            </div>
            <div id="flag-upload-msg"></div>`;
}

/** Wire the flag <select> in an FF table: show/hide the custom-code input + swap the preview. */
function wireFlagSelectPreview(scope) {
    scope.querySelectorAll('.player-flag-select').forEach(sel => {
        sel.addEventListener('change', function() {
            const row = this.closest('tr');
            const customInput = row.querySelector('.player-flag-custom');
            const preview = row.querySelector('img.flag');
            if (this.value === '__custom') {
                customInput.style.display = 'inline';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
                if (preview) {
                    preview.src = `assets/flags/${this.value}.png`;
                    preview.alt = this.value;
                }
            }
        });
    });
}

/** Wire the "Upload Custom Flag" panel: stage the PNG + register the code in KNOWN_FLAGS. */
/**
 * @param {function} [onUploaded] — called with the flag code after it is staged.
 *   The Add-League form passes one so the flag can RIDE WITH the league it was
 *   uploaded for (see carryFlags): a flag staged here is a standalone queue item
 *   with no owner, so abandoning or discarding the league used to leave it
 *   behind — queued, ownerless, and indistinguishable from a deliberate upload.
 *   Edit League passes nothing: a flag added there belongs to a league that
 *   already exists, so it stands on its own exactly as before.
 */
function wireUploadFlagPanel(onUploaded = null) {
    const btn = document.getElementById('upload-flag-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const code = document.getElementById('upload-flag-code').value.trim().toUpperCase();
        const fileInput = document.getElementById('upload-flag-file');

        if (!code || code.length < 2) {
            showMsg('flag-upload-msg', 'Enter a valid flag code (2+ chars).', 'error');
            return;
        }
        if (!fileInput.files || fileInput.files.length === 0) {
            showMsg('flag-upload-msg', 'Select an image file.', 'error');
            return;
        }

        const file = fileInput.files[0];
        let base64;
        try {
            base64 = await fileToPngBase64(file);
        } catch {
            showMsg('flag-upload-msg', 'Could not read this image. If it is a HEIC from iPhone, please share it as JPEG or PNG.', 'error');
            return;
        }

        addChange({
            type: 'create',
            target: T.flagAsset(code),
            content: base64,
            binary: true,
            description: `Upload flag: ${code}.png`,
            category: 'flag-upload',
            subject: code,
            detail: `${code}.png`
        });

        // Pickable immediately, in every flag dropdown of this session.
        registerFlagCode(code);
        if (onUploaded) onUploaded(code);

        if (refreshBadgeFn) refreshBadgeFn();
        showMsg('flag-upload-msg', `Flag ${code}.png staged for upload.`, 'success');
    });
}

// ---- Helpers ----

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function formatAdminDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
}

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
    if (message) revealMsg(el);
}

/**
 * Wire up the Match Results sub-tabs (Round Editor / Upload CSV / Overrides).
 * Round Editor opens by default. Tabs follow the same pattern as the dashboard
 * "Remaining Matches" sub-tabs (one panel open at a time; click again to close).
 *
 * The hash slug is DERIVED from each tab's label via tabSlug() rather than
 * declared alongside it — the pair of lookup tables that used to live here is
 * exactly how `rounds` came to name a tab called "Round Editor". See CLAUDE.md
 * § URL contract.
 */
function setupMatchResultsTabs(leagueId, params, refreshBadge, openSubtab) {
    const bar = document.getElementById('match-tab-bar');
    if (!bar) return;

    const tabs = [{ id: 'match-panel-rounds', label: 'Round Editor' }];
    if (!params.ManualEntry) {
        tabs.push({ id: 'match-panel-upload', label: 'Upload CSV' });
        tabs.push({ id: 'match-panel-overrides', label: 'Overrides' });
    }

    const slugOf = (panelId) => tabSlug(tabs.find(t => t.id === panelId).label);
    // Slugs retired by the 2026-08 URL-contract rename. A link shared before it
    // still opens the right panel; the hash then normalises on its own, because
    // defaultOpenId fires onOpen, which rewrites it with the canonical slug.
    const LEGACY_SUBTAB_SLUGS = { rounds: 'round-editor', upload: 'upload-csv' };
    const panelFor = (slug) => {
        const want = LEGACY_SUBTAB_SLUGS[slug] || slug;
        return tabs.find(t => tabSlug(t.label) === want)?.id || null;
    };

    // Honour a restored sub-tab from the URL, but only if it's actually available
    // (e.g. a manual-entry league has no Upload/Overrides tabs) — else default to
    // the Round Editor.
    const defaultOpenId = panelFor(openSubtab) || 'match-panel-rounds';

    // Shared accordion sub-tabs (one open at a time; Round Editor open by default).
    mountAccordionTabs(bar, {
        tabs,
        defaultOpenId,
        // Nothing is open any more — drop the slug rather than leave the URL
        // claiming a panel that isn't there.
        onClose: () => setLeaguesHash('edit', leagueId),
        onOpen: (panelId, panel) => {
            // Keep the URL's sub-tab segment in sync so a refresh reopens this one.
            setLeaguesHash('edit', leagueId, slugOf(panelId));
            if (panelId === 'match-panel-rounds') {
                if (!panel._built) { panel._built = true; renderRoundEditor(panel, leagueId, refreshBadge); }
            } else if (panelId === 'match-panel-upload') {
                // Re-render every open so the drop zone resets cleanly after a previous import.
                renderExcelImporter(panel, leagueId, refreshBadge, () => location.reload());
            } else if (panelId === 'match-panel-overrides') {
                // Re-render every open to reflect the latest overrides file.
                renderOverridesList(panel, leagueId, refreshBadge);
            }
        },
    });
}

