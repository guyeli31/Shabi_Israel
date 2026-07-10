/**
 * syncManager.js — Admin "Sync" page: one control center for every External
 * Source sync (manual Run Now + scheduled named plans).
 *
 * Source of truth = leagues/sync_settings.json (staged → Pending Changes →
 * Publish, like landing_settings.json). Publish mirrors it into sync_plans /
 * sync_plan_members / leagues.source_league_name (see supabaseAdmin.updateSyncSettings
 * + sql/external_source_scheduler.sql), which the pg_cron scheduler reads.
 *
 * Three sections, each staging the WHOLE file via its own Save Settings (Run Now
 * is the exception — it dispatches immediately, nothing is staged):
 *   1. Active Leagues (F7) — per-league Source League Name + a plan-membership matrix.
 *   2. Run Now — pick leagues (default: all eligible), stream a per-league report.
 *   3. Auto Sync — create/name/schedule plans (the 'default' plan can't be deleted).
 *
 * Membership single source of truth in the DOM = the Section-1 matrix. Section 3
 * only owns plan meta (name/schedule/dates). A completed (non-running) league is
 * never listed in Section 1, so any Save drops it from every plan — and the cron
 * also filters to running leagues, so it leaves all plans automatically.
 */

import { loadLeagueOrder, loadLeagueParams } from '../data/supabaseLoader.js';
import { supabase } from '../data/supabaseClient.js';
import { addChange, getStagedContent } from './stagingStore.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { revealMsg } from './msgScroll.js';
import { wireSectionCollapse } from '../render/sectionCollapse.js';
import { thLabel } from '../utils/helpers.js';
import {
    createSyncLog, friendlySyncError, latestEventId, pollSyncDispatch, streamSyncEvents,
} from './syncLog.js';

const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const SYNC_SETTINGS_PATH = 'leagues/sync_settings.json';
const DEFAULT_PLAN_ID = 'default';

let refreshBadgeFn = null;
// Published (live) source names, cached for the page's lifetime. Publish state
// can't change without a full reload, so this survives in-page re-renders and
// is re-attached to the rebuilt settings on every Save (see saveAll).
let _publishedSourceNames = {};

// ── entry ───────────────────────────────────────────────────────────────
export async function renderSyncAdmin(container, refreshBadge) {
    refreshBadgeFn = refreshBadge;
    container.innerHTML = '<h1>Sync</h1><div class="loading">Loading sync settings…</div>';

    try {
        const displayOrder = await loadLeagueOrder();
        const folderNames = displayOrder.map((t) => t.replace(' - ', ' '));
        const leagues = await Promise.all(
            folderNames.map(async (id, i) => {
                try { return { id, title: displayOrder[i], params: await loadLeagueParams(id) }; }
                catch { return { id, title: displayOrder[i], params: null }; }
            }),
        );
        const settings = await loadSyncSettings(leagues);
        renderSyncPage(container, leagues, settings);
    } catch (err) {
        container.innerHTML = `<h1>Sync</h1><div class="admin-msg admin-msg-error">Failed to load: ${esc(err.message)}</div>`;
    }
}

// ── load current settings (staged wins for inputs; published gates actions) ──
async function loadSyncSettings(leagues) {
    // Published (live) source names — the TRUE enabling key. From
    // leagues.source_league_name, falling back to the legacy per-league
    // ExternalSourceSync jsonb (both already published in Supabase). Run Now +
    // scheduling only unlock once a name is PUBLISHED, never merely staged.
    const publishedSourceNames = {};
    for (const lg of leagues) {
        const legacy = lg.params && lg.params.ExternalSourceSync;
        if (legacy && legacy.sourceLeagueName) publishedSourceNames[lg.id] = legacy.sourceLeagueName;
    }
    try {
        const { data, error } = await supabase.from('leagues').select('id, source_league_name');
        if (!error) for (const r of data || []) if (r.source_league_name) publishedSourceNames[r.id] = r.source_league_name;
    } catch { /* column not present pre-migration — legacy fallback stands */ }

    // Staged edits win for the INPUT values (what the admin is editing right now).
    const staged = getStagedContent(SYNC_SETTINGS_PATH);
    if (staged) {
        try { return { ...normalize(JSON.parse(staged)), publishedSourceNames }; } catch { /* fall through */ }
    }

    // No stage → current == published (everything clean). Pull published plans too
    // (tables may not exist yet if the SQL migration hasn't run — synth a default).
    let plans = [];
    try {
        const [{ data: planRows, error: pErr }, { data: memberRows }] = await Promise.all([
            supabase.from('sync_plans').select('*'),
            supabase.from('sync_plan_members').select('plan_id, league_id'),
        ]);
        if (!pErr) {
            plans = (planRows || []).map((p) => ({
                id: p.id,
                name: p.name || p.id,
                enabled: p.enabled !== false,
                mode: p.mode || 'full',
                times: Array.isArray(p.times) ? p.times : [],
                jitterMinutes: p.jitter_minutes ?? 60,
                startDate: p.start_date || null,
                endDate: p.end_date || null,
                leagues: (memberRows || []).filter((m) => m.plan_id === p.id).map((m) => m.league_id),
            }));
        }
    } catch { /* tables not present — use synthesized default below */ }

    if (plans.length === 0) plans = [synthDefaultPlan(leagues, publishedSourceNames)];
    return { plans, sourceNames: { ...publishedSourceNames }, publishedSourceNames };
}

/** Coerce a parsed sync_settings.json into the in-memory shape used here. */
function normalize(obj) {
    const sourceNames = (obj && obj.sourceNames && typeof obj.sourceNames === 'object') ? { ...obj.sourceNames } : {};
    const plans = Array.isArray(obj && obj.plans) ? obj.plans.map((p) => ({
        id: String(p.id),
        name: p.name || String(p.id),
        enabled: p.enabled !== false,
        mode: p.mode === 'fast' ? 'fast' : 'full',
        times: Array.isArray(p.times) ? p.times.slice() : [],
        jitterMinutes: p.jitterMinutes ?? 60,
        startDate: p.startDate || null,
        endDate: p.endDate || null,
        leagues: Array.isArray(p.leagues) ? p.leagues.slice() : [],
    })) : [];
    if (!plans.some((p) => p.id === DEFAULT_PLAN_ID)) {
        plans.unshift({ id: DEFAULT_PLAN_ID, name: 'Nightly Sync', enabled: true, mode: 'full', times: ['03:00'], jitterMinutes: 60, startDate: null, endDate: null, leagues: [] });
    }
    return { plans, sourceNames };
}

/** Default plan seeded from running leagues that already have a source name. */
function synthDefaultPlan(leagues, sourceNames) {
    const running = leagues.filter((l) => l.params && l.params.Running === true);
    const memberIds = running.filter((l) => sourceNames[l.id]).map((l) => l.id);
    let times = ['03:00'];
    for (const l of running) {
        const c = l.params && l.params.ExternalSourceSync;
        if (c && c.enabled && Array.isArray(c.times) && c.times.length) { times = c.times.slice(); break; }
    }
    return { id: DEFAULT_PLAN_ID, name: 'Nightly Sync', enabled: true, mode: 'full', times, jitterMinutes: 60, startDate: null, endDate: null, leagues: memberIds };
}

// ── page render ───────────────────────────────────────────────────────────
// Exported as the pure renderer (renderSyncAdmin loads data then calls this);
// also lets a harness mount the page with mock data without Supabase/auth.
export function renderSyncPage(container, leagues, settings) {
    _publishedSourceNames = settings.publishedSourceNames || {};
    const active = leagues.filter((l) => l.params && l.params.Running === true);
    const { plans } = settings;

    container.innerHTML = `
        <h1>Sync</h1>
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-lg)">
            Control every External Source sync — manual runs and scheduled plans — from one place.
        </p>

        ${sectionActiveLeagues(active, plans, settings)}
        ${sectionRunNow(active, settings)}
        ${sectionAutoSync(active, plans, settings)}
    `;

    container.querySelectorAll('.ff-wrap').forEach((w) => attachStickyShadow(w));
    container.querySelectorAll('.app-section').forEach((s) => wireSectionCollapse(s, { defaultOpen: true }));

    wireActiveLeagues(container, leagues);
    wireRunNow(container, active);
    wireAutoSync(container, leagues, settings);
}

// ── Section 1: Active Leagues (F7) ─────────────────────────────────────────
function sectionActiveLeagues(active, plans, settings) {
    const rows = active.map((lg) => {
        const type = (lg.params.LeagueType) || 'doubling';
        const pub = settings.publishedSourceNames[lg.id] || '';
        const cur = settings.sourceNames[lg.id] || '';
        const eligible = pub !== '' && cur === pub; // published AND clean (no pending edit)
        const gateMsg = gateHintMsg(pub, cur);
        const chips = plans.map((pl) => {
            const member = (pl.leagues || []).includes(lg.id);
            return `
                <label class="sync-plan-chip" style="display:inline-flex;align-items:center;gap:4px;margin-right:var(--space-sm);white-space:nowrap">
                    <input type="checkbox" class="sync-plan-member" data-plan="${esc(pl.id)}" data-league="${esc(lg.id)}"
                        ${member ? 'checked' : ''} ${eligible ? '' : 'disabled'}>
                    ${esc(pl.name)}
                </label>`;
        }).join('');
        return `
            <tr data-league="${esc(lg.id)}">
                <td><span style="font-weight:600">${esc(lg.params.LeagueTitle || lg.id)}</span> ${typePill(type)}</td>
                <td><input type="text" class="sync-source-name" data-league="${esc(lg.id)}" data-published="${esc(pub)}" value="${esc(cur)}"
                        placeholder="e.g. Shabi Israel"
                        style="padding:2px 6px;border:1px solid var(--color-border);border-radius:4px;min-width:160px"></td>
                <td>
                    ${chips || '<span style="color:var(--color-text-muted)">—</span>'}
                    <div class="sync-gate-hint" style="color:var(--color-text-muted);font-size:0.8em;margin-top:4px;display:${gateMsg ? '' : 'none'}">${esc(gateMsg)}</div>
                </td>
            </tr>`;
    }).join('');

    const body = active.length
        ? rows
        : `<tr><td colspan="3" style="text-align:center;color:var(--color-text-muted)">No active leagues. Mark a league as Running in Leagues to sync it.</td></tr>`;

    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Active Leagues</h2>
            <div class="collapsible-body">
              <div class="admin-card">
                <div id="sync-leagues-msg"></div>
                <p style="color:var(--color-text-muted);margin-bottom:var(--space-md);font-size:0.9em">
                    Set each league's <b>Source League Name</b> (the exact name shown on the data source), then Save &amp; <b>Publish</b>
                    it. A league can join a plan or Run Now only <b>after</b> its Source League Name is published — a staged, unpublished
                    name doesn't count.
                </p>
                <div class="ff-wrap">
                    <table class="admin-table font-large" data-mf-table-id="F7">
                        <thead>
                            <tr>
                                <th scope="col">${thLabel('League', 'League')}</th>
                                <th scope="col">${thLabel('Source League Name', 'Source')}</th>
                                <th scope="col">${thLabel('Plans', 'Plans')}</th>
                            </tr>
                        </thead>
                        <tbody>${body}</tbody>
                    </table>
                </div>
                <div style="margin-top:var(--space-md)">
                    <button class="btn btn-primary" id="sync-leagues-save"${active.length ? '' : ' disabled'}>Save Settings</button>
                </div>
              </div>
            </div>
          </div>
        </div>`;
}

function wireActiveLeagues(container, leagues) {
    // Published-name gate: a league's plan checkboxes + Run Now pick are enabled
    // ONLY while its Source League Name is published AND unedited (input ===
    // data-published, non-empty). Editing the name (or an empty/unpublished name)
    // disables those actions until the change is published. Existing membership is
    // NOT unchecked on edit — a disabled+checked box stays a member and publishes
    // atomically with the name; the gate only blocks *new* actions on a stale name.
    container.querySelectorAll('.sync-source-name').forEach((inp) => {
        inp.addEventListener('input', () => {
            const row = inp.closest('tr');
            const pub = inp.dataset.published || '';
            const val = inp.value.trim();
            const eligible = pub !== '' && val === pub;
            const msg = gateHintMsg(pub, val);

            row.querySelectorAll('.sync-plan-member').forEach((c) => { c.disabled = !eligible; });
            const hint = row.querySelector('.sync-gate-hint');
            if (hint) { hint.textContent = msg; hint.style.display = msg ? '' : 'none'; }

            // Reflect into the Run Now section (immediate, not staged — must use
            // the live published name, so an edited name can't be run).
            const pick = container.querySelector(`.sync-runnow-pick[data-league="${cssAttr(inp.dataset.league)}"]`);
            if (pick) {
                pick.disabled = !eligible;
                pick.checked = eligible;
                const lbl = pick.closest('label');
                if (lbl) lbl.style.opacity = eligible ? '' : '.55';
                const rnHint = lbl && lbl.querySelector('.sync-runnow-hint');
                if (rnHint) { rnHint.textContent = msg ? `(${msg})` : ''; rnHint.style.display = msg ? '' : 'none'; }
            }
        });
    });

    const saveBtn = container.querySelector('#sync-leagues-save');
    if (saveBtn) saveBtn.addEventListener('click', () => saveAll(container, leagues, 'sync-leagues-msg'));
}

// ── Section 2: Run Now ─────────────────────────────────────────────────────
function sectionRunNow(active, settings) {
    // Run Now dispatches immediately against the PUBLISHED name — so eligibility
    // requires a published, unedited Source League Name (isEligible), never a
    // merely-staged one.
    const eligibleList = active.filter((l) => isEligible(l.id, settings));
    const checks = active.map((lg) => {
        const eligible = isEligible(lg.id, settings);
        const msg = gateHintMsg(settings.publishedSourceNames[lg.id] || '', settings.sourceNames[lg.id] || '');
        const type = lg.params.LeagueType || 'doubling';
        return `
            <label style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-xs);${eligible ? '' : 'opacity:.55'}">
                <input type="checkbox" class="sync-runnow-pick" data-league="${esc(lg.id)}" ${eligible ? 'checked' : 'disabled'}>
                <span style="font-weight:600">${esc(lg.params.LeagueTitle || lg.id)}</span> ${typePill(type)}
                <span class="sync-runnow-hint" style="color:var(--color-text-muted);font-size:0.85em;display:${eligible ? 'none' : ''}">${eligible ? '' : `(${esc(msg)})`}</span>
            </label>`;
    }).join('');

    const disabled = eligibleList.length === 0;
    const banner = active.length === 0
        ? `<div class="admin-msg admin-msg-error">No active leagues — Run Now is unavailable.</div>`
        : (disabled ? `<div class="admin-msg admin-msg-error">No league has a <b>published</b> Source League Name yet — set one above and Publish to enable Run Now.</div>` : '');

    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Run Now</h2>
            <div class="collapsible-body">
              <div class="admin-card">
                ${banner}
                <p style="color:var(--color-text-muted);margin-bottom:var(--space-md);font-size:0.9em">
                    Runs a fast sync immediately. Pick the leagues (all eligible are selected by default); each reports its
                    own CSV match check and any new flags below.
                </p>
                <div style="margin-bottom:var(--space-md)">${checks || '<span style="color:var(--color-text-muted)">—</span>'}</div>
                <button class="btn btn-secondary" id="sync-runnow-btn"${disabled ? ' disabled' : ''}>Run Now</button>
                <div id="sync-runnow-log" style="margin-top:var(--space-md)"></div>
                <div id="sync-runnow-reports" style="margin-top:var(--space-md);display:flex;flex-direction:column;gap:var(--space-md)"></div>
              </div>
            </div>
          </div>
        </div>`;
}

function wireRunNow(container, active) {
    const btn = container.querySelector('#sync-runnow-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const ids = Array.from(container.querySelectorAll('.sync-runnow-pick:checked')).map((c) => c.dataset.league);
        const runLogEl = container.querySelector('#sync-runnow-log');
        const reportsEl = container.querySelector('#sync-runnow-reports');
        const runLog = createSyncLog(runLogEl);
        runLog.clear();
        reportsEl.innerHTML = '';

        if (ids.length === 0) { runLog.log('Pick at least one league to run.', 'error'); return; }

        btn.disabled = true;
        runLog.log(`Starting sync for ${ids.length} league${ids.length === 1 ? '' : 's'}…`, 'info');

        // Build one report card + logger per selected league, and anchor each
        // league's live stream on its current newest event id.
        const cards = {};
        const anchors = {};
        for (const id of ids) {
            const lg = active.find((l) => l.id === id);
            const title = lg ? (lg.params.LeagueTitle || id) : id;
            const type = lg ? (lg.params.LeagueType || 'doubling') : 'doubling';
            const card = document.createElement('div');
            card.className = 'admin-card';
            card.style.cssText = 'background:var(--color-inset)';
            card.innerHTML = `
                <div style="margin-bottom:var(--space-sm)"><span style="font-weight:600">${esc(title)}</span> ${typePill(type)}</div>
                <div class="sync-report-log"></div>`;
            reportsEl.appendChild(card);
            cards[id] = createSyncLog(card.querySelector('.sync-report-log'));
            cards[id].log('Queued…', 'info');
            anchors[id] = await latestEventId(id);
        }

        try {
            const { error } = await supabase.rpc('trigger_external_source_sync_now_leagues', { p_league_ids: ids });
            if (error) throw error;
            runLog.log('Request sent to the league site.', 'info');
            const running = await pollSyncDispatch(ids[0], runLog);
            if (running) {
                await Promise.all(ids.map((id) => streamSyncEvents(id, anchors[id], cards[id])));
                runLog.log('All selected syncs finished (or are still running in the background).', 'success');
            }
        } catch (err) {
            const msg = friendlySyncError(err);
            runLog.log(msg, 'error');
            for (const id of ids) cards[id].log(msg, 'error');
        } finally {
            btn.disabled = false;
        }
    });
}

// ── Section 3: Auto Sync (plans) ───────────────────────────────────────────
function sectionAutoSync(active, plans, settings) {
    const cards = plans.map((pl) => planCardHTML(pl, active, settings)).join('');
    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Auto Sync</h2>
            <div class="collapsible-body">
              <div class="admin-card edit-card-sm">
                <div id="sync-plans-msg"></div>
                <p style="color:var(--color-text-muted);margin-bottom:var(--space-md);font-size:0.9em">
                    Scheduled plans run their member leagues automatically. Assign leagues to plans in <b>Active Leagues</b> above.
                </p>
                <div id="sync-plans-list">${cards}</div>
                <button class="btn btn-secondary btn-sm" id="sync-add-plan" type="button" style="margin-top:var(--space-md)">+ Add Plan</button>
              </div>
            </div>
          </div>
        </div>`;
}

function planCardHTML(pl, active, settings) {
    const isDefault = pl.id === DEFAULT_PLAN_ID;
    const memberCount = (pl.leagues || []).filter((id) => active.some((l) => l.id === id)).length;
    const times = (pl.times && pl.times.length) ? pl.times : ['03:00'];
    const timeRows = times.map((t) => timeRowHTML(t)).join('');
    return `
        <div class="sync-plan-card admin-card" data-plan-id="${esc(pl.id)}"
             style="background:var(--color-inset);margin-bottom:var(--space-md)">
            <div style="display:flex;align-items:center;gap:var(--space-md);flex-wrap:wrap;margin-bottom:var(--space-sm)">
                <div class="form-group" style="flex:1;min-width:160px;margin:0">
                    <label>Plan Name</label>
                    <input type="text" class="sync-plan-name" value="${esc(pl.name)}" ${isDefault ? 'readonly' : ''}
                        placeholder="Plan name">
                </div>
                <div class="form-group" style="margin:0">
                    <label>Enabled</label>
                    <label class="toggle-switch" style="display:block;margin-top:4px">
                        <input type="checkbox" class="sync-plan-enabled" ${pl.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                ${isDefault ? '<span class="league-type-pill" style="align-self:flex-end">Default</span>'
                    : '<button class="btn btn-danger btn-sm sync-plan-delete" type="button" style="align-self:flex-end">Delete</button>'}
            </div>

            <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
                <div class="form-group" style="flex:1;min-width:140px">
                    <label>Start Date</label>
                    <input type="date" class="sync-plan-start themed-date" value="${esc(pl.startDate || '')}">
                </div>
                <div class="form-group" style="flex:1;min-width:140px">
                    <label>End Date</label>
                    <input type="date" class="sync-plan-end themed-date" value="${esc(pl.endDate || '')}">
                </div>
            </div>

            <div class="form-group">
                <label>Run Times (every day, with &plusmn;1h randomization)</label>
                <div class="sync-plan-times">${timeRows}</div>
                <button class="btn btn-secondary btn-sm sync-plan-add-time" type="button">+ Add time</button>
            </div>

            <div style="color:var(--color-text-muted);font-size:0.85em;margin-bottom:var(--space-sm)">
                Member leagues: ${memberCount} (edit in Active Leagues)
            </div>

            <button class="btn btn-primary btn-sm sync-plan-save" type="button">Save Settings</button>
        </div>`;
}

function timeRowHTML(value) {
    return `
        <div class="sync-plan-time-row" style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-xs)">
            <input type="time" step="300" class="sync-plan-time" value="${esc(value)}">
            <button type="button" class="btn btn-danger btn-sm sync-plan-del-time" title="Remove time">&#128465;</button>
        </div>`;
}

function wireAutoSync(container, leagues, settings) {
    const list = container.querySelector('#sync-plans-list');

    // Add time / delete time (event delegation on the list).
    list.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.sync-plan-add-time');
        if (addBtn) {
            const times = addBtn.previousElementSibling; // .sync-plan-times
            times.insertAdjacentHTML('beforeend', timeRowHTML(nowHHMM()));
            return;
        }
        const delBtn = e.target.closest('.sync-plan-del-time');
        if (delBtn) {
            const rows = delBtn.closest('.sync-plan-times').querySelectorAll('.sync-plan-time-row');
            if (rows.length > 1) delBtn.closest('.sync-plan-time-row').remove();
            return;
        }
        const delPlan = e.target.closest('.sync-plan-delete');
        if (delPlan) {
            const card = delPlan.closest('.sync-plan-card');
            const name = card.querySelector('.sync-plan-name').value.trim() || 'this plan';
            if (confirm(`Delete plan "${name}"? Save Settings to publish the removal.`)) {
                card.remove();
                saveAll(container, leagues, 'sync-plans-msg');
            }
            return;
        }
        const savePlan = e.target.closest('.sync-plan-save');
        if (savePlan) { saveAll(container, leagues, 'sync-plans-msg'); return; }
    });

    // Add plan — append a fresh card, then re-render so Active Leagues gains its column.
    const addPlanBtn = container.querySelector('#sync-add-plan');
    if (addPlanBtn) addPlanBtn.addEventListener('click', () => {
        const active = leagues.filter((l) => l.params && l.params.Running === true);
        const newPlan = { id: String(Date.now()), name: 'New Plan', enabled: true, mode: 'full', times: ['03:00'], jitterMinutes: 60, startDate: null, endDate: null, leagues: [] };
        list.insertAdjacentHTML('beforeend', planCardHTML(newPlan, active, settings));
    });
}

// ── Save: rebuild the whole file from the DOM, stage it ────────────────────
function rebuildFromDOM(container) {
    const sourceNames = {};
    container.querySelectorAll('.sync-source-name').forEach((inp) => {
        const v = inp.value.trim();
        if (v) sourceNames[inp.dataset.league] = v;
    });

    const plans = [];
    container.querySelectorAll('.sync-plan-card').forEach((card) => {
        const id = card.dataset.planId;
        const name = card.querySelector('.sync-plan-name').value.trim() || id;
        const enabled = card.querySelector('.sync-plan-enabled').checked;
        const times = Array.from(card.querySelectorAll('.sync-plan-time')).map((i) => i.value.trim()).filter(Boolean);
        const startDate = card.querySelector('.sync-plan-start').value || null;
        const endDate = card.querySelector('.sync-plan-end').value || null;
        // Membership single source of truth = the Section-1 matrix.
        const memberLeagues = Array.from(
            container.querySelectorAll(`.sync-plan-member[data-plan="${cssAttr(id)}"]:checked`),
        ).map((c) => c.dataset.league);
        plans.push({ id, name, enabled, mode: 'full', times, jitterMinutes: 60, startDate, endDate, leagues: memberLeagues });
    });

    return { plans, sourceNames };
}

function saveAll(container, leagues, msgElId) {
    const settings = rebuildFromDOM(container);
    // Carry the published names through the re-render so the action gate keeps working.
    settings.publishedSourceNames = _publishedSourceNames;
    addChange({
        type: 'update',
        path: SYNC_SETTINGS_PATH,
        content: JSON.stringify(settings, null, 2),
        description: 'Update sync settings',
        category: 'bgsync',
        subject: 'Sync',
    });
    if (refreshBadgeFn) refreshBadgeFn();
    showMsg(msgElId, 'Sync settings staged. Go to Pending Changes to publish.', 'success');
    // Re-render so a freshly added/removed plan is reflected in the Active Leagues
    // matrix and member counts (reads the just-staged content).
    renderSyncPage(container, leagues, settings);
}

// ── helpers ────────────────────────────────────────────────────────────────
/** A league can be scheduled / Run Now only when its Source League Name is
 *  PUBLISHED (in Supabase) and matches the current (unedited) input value. */
function isEligible(id, settings) {
    const pub = (settings.publishedSourceNames && settings.publishedSourceNames[id]) || '';
    const cur = (settings.sourceNames && settings.sourceNames[id]) || '';
    return pub !== '' && cur === pub;
}

/** Message explaining why a league is gated ('' = eligible, no message). */
function gateHintMsg(pub, cur) {
    if (pub && cur === pub) return '';
    if (!pub) return 'Publish a Source League Name to enable scheduling & Run Now';
    return 'Publish the pending Source League Name change to enable';
}

function typePill(type) {
    const t = LEAGUE_TYPE_LABELS[type] ? type : 'doubling';
    return `<span class="league-type-pill type-${esc(t)}">${esc(LEAGUE_TYPE_LABELS[t])}</span>`;
}

function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function cssAttr(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
    if (message) revealMsg(el);
}

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}
