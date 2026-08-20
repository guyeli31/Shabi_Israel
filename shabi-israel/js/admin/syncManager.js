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

import { loadLeagueOrder, loadAllLeagueParams } from '../data/supabaseLoader.js';
import { supabase } from '../data/supabaseClient.js';
import { addChange, getStagedContent, T } from './stagingStore.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';
import { revealMsg, revealAtTop } from './msgScroll.js';
import { wireSectionCollapse } from '../render/sectionCollapse.js';
import { thLabel } from '../utils/helpers.js';
import {
    createSyncLog, friendlySyncError, latestEventId, pollSyncDispatch, streamSyncEvents,
    latestSiteEventId, streamSiteEvents, loadLastRun,
} from './syncLog.js';
import { createStageTracker, estimateRunSeconds, fmtDuration } from './syncProgress.js';
import { loadMailState, mailSectionsHTML, wireMailSections } from './mailSync.js';
import { restartSplash, endSplash } from '../utils/splash.js';

const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const DEFAULT_PLAN_ID = 'default';

let refreshBadgeFn = null;
// Published (live) source names, cached for the page's lifetime. Publish state
// can't change without a full reload, so this survives in-page re-renders and
// is re-attached to the rebuilt settings on every Save (see saveAll).
let _publishedSourceNames = {};

// ── entry ───────────────────────────────────────────────────────────────
export async function renderSyncAdmin(container, refreshBadge) {
    refreshBadgeFn = refreshBadge;
    // Every path into this view fetches from Supabase, so it gets the shared
    // loading screen rather than a line of text of its own. A no-op when the
    // admin's first-load splash is still up. See restartSplash().
    restartSplash({ stages: 'adminView' });
    container.innerHTML = '<h1>Sync</h1>';

    try {
        const displayOrder = await loadLeagueOrder();
        const folderNames = displayOrder.map((t) => t.replace(' - ', ' '));

        // ONE query for every league's params, not one per league.
        // `loadLeagueParams(id)` in a map fires a separate round trip per
        // league — eleven of them here — which is the exact fan-out the public
        // read path was rebuilt to remove, still living in the admin.
        // `loadAllLeagueParams` asks for them with a single `in (…)`.
        const paramsById = new Map(
            (await loadAllLeagueParams(folderNames).catch(() => []))
                .map(({ id, params }) => [id, params]),
        );
        const leagues = folderNames.map((id, i) => ({
            id,
            title: displayOrder[i],
            // null for a league the query did not return, matching the old
            // per-league catch: a missing row hides one row's controls, it does
            // not fail the page.
            params: paramsById.get(id) ?? null,
        }));

        // The two loads below are INDEPENDENT — mail state knows nothing about
        // sync settings — but were awaited one after the other, so the page paid
        // both round trips end to end. Run together they cost the slower of the
        // two instead of the sum. This was the Sync view's largest single cost:
        // it was measured on production at ~1s to swap a panel, slower than
        // loading a whole public page from scratch.
        //
        // The mail sections must never take the Sync page down with them: a
        // missing sql/mail_sync.sql (not yet run on this environment) is a
        // reason to hide two sections, not to lose Run Now.
        const [settings, mail] = await Promise.all([
            loadSyncSettings(leagues),
            loadMailState().catch((err) => {
                console.warn('Mail sync sections unavailable:', err.message);
                return null;
            }),
        ]);
        renderSyncPage(container, leagues, settings, mail);
    } catch (err) {
        container.innerHTML = `<h1>Sync</h1><div class="admin-msg admin-msg-error">Failed to load: ${esc(err.message)}</div>`;
    } finally {
        // Pairs with the restartSplash() above. Must be here, not at the call
        // site: this view is re-rendered from inside itself (the mail-section
        // wiring), and those paths would otherwise leave the loading screen up
        // until the 25s fail-safe. Harmless when no splash is running.
        endSplash();
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
    const staged = getStagedContent(T.syncSettings());
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
export function renderSyncPage(container, leagues, settings, mail = null) {
    _publishedSourceNames = settings.publishedSourceNames || {};
    const active = leagues.filter((l) => l.params && l.params.Running === true);
    const { plans } = settings;

    // Flags for the mail tables.
    //
    // A player's flag is a property of the LEAGUE, not of the player: the same
    // name can carry different flags in different seasons, which is exactly why
    // CustomFlags lives in league_params. So a report that already knows its
    // league is looked up in that league's own map — `flagsByLeague` below —
    // and only a report with no league yet needs a merged one.
    //
    // The merge was `Object.assign({}, ...leagues.map(...))`, and in
    // Object.assign the LAST source wins. `leagues` follows DisplayOrder, which
    // runs newest-first, so the last entry was the OLDEST league — every player
    // wore the flag from the first season they ever played in.
    //
    // The fallback now answers the question the table is actually asking. A mail
    // report can only ever belong to a RUNNING league — that is the first
    // condition in mail_candidate_leagues — so the flag beside an unassigned
    // player should be the one they fly in the league this match is going to
    // land in, which is a running one.
    //
    // So the fallback is built from the RUNNING leagues ONLY — not from every
    // league with the running ones layered on top.
    //
    // The difference is absence. CustomFlags holds only the players who differ
    // from the IL default, and getFlagCode() reads a missing name AS IL. Layering
    // running leagues over all leagues therefore lets an old entry survive where
    // the running league is silent — and silence there is not "no opinion", it is
    // the opinion "IL". Moriarty is the live case: TZ up to April 2026, GE from
    // May, and no entry at all in August 2026, which he plays in. The league page
    // shows him IL; a layered merge showed him GE, so the two disagreed about the
    // same player in the same league.
    //
    // "Newest" and "running" are also not the same thing and can disagree: a
    // league can carry a later date and not be running yet, and more than one
    // league can run at once — August 2026 and August 2026 Regular both do.
    // Among several running leagues the newest wins, which is the best available
    // answer when the report has not been assigned to one of them yet.
    const oldestFirst = (list) => [...list].sort((a, b) =>
        // Undated leagues sort first, i.e. lose to every dated one — they are the
        // ones whose recency cannot be established, so they are the ones that
        // should not overwrite a league that can be dated.
        String((a.params && a.params.IssueDate) || '')
            .localeCompare(String((b.params && b.params.IssueDate) || '')));

    const flagsOf = (l) => (l.params && l.params.CustomFlags) || {};
    const running = leagues.filter((l) => l.params && l.params.Running === true);

    const customFlags = Object.assign({}, ...oldestFirst(running).map(flagsOf));

    const flagsByLeague = {};
    for (const l of leagues) flagsByLeague[l.id] = flagsOf(l);

    container.innerHTML = `
        <h1>Sync</h1>
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-lg)">
            Control every External Source sync — manual runs and scheduled plans — from one place.
        </p>

        ${mail ? mailSectionsHTML(mail, customFlags, flagsByLeague) : ''}
        ${sectionActiveLeagues(active, plans, settings)}
        ${sectionRunNow(active, settings)}
        ${sectionAutoSync(active, plans, settings)}
    `;

    container.querySelectorAll('.ff-wrap').forEach((w) => attachStickyShadow(w));
    container.querySelectorAll('.app-section').forEach((s) => wireSectionCollapse(s, { defaultOpen: true }));

    if (mail) wireMailSections(container, () => renderSyncAdmin(container, refreshBadgeFn));
    wireActiveLeagues(container, leagues);
    wireRunNow(container, active);
    wireAutoSync(container, leagues, settings);
    wirePlanLastRuns(container);
    wireLogCollapse(container);
    wireDirtyTracking(container, active);
}

/** Populate each plan card's per-league "Last run" panels from stored events. */
function wirePlanLastRuns(container) {
    container.querySelectorAll('.sync-lastrun-log').forEach((el) => {
        // reveal:false — these fill in on page load; a replayed line must never
        // scroll the page down to a plan the user hasn't looked at yet.
        const logger = createSyncLog(el, { max: 40, reveal: false });
        logger.status('Loading last run…', 'info');
        loadLastRun(el.dataset.league, logger).catch(() => {
            logger.clear();
            logger.status("Couldn't load the last run.", 'error');
        });
    });
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
                        placeholder="e.g. Shabi Israel"></td>
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
                    <button class="btn btn-primary" id="sync-leagues-save" disabled>Save Settings</button>
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
                // The pick changed without a `change` event — refresh the estimate.
                if (container._syncUpdateEta) container._syncUpdateEta();
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
                <div class="sync-eta" id="sync-runnow-eta"></div>
                <button class="btn btn-secondary" id="sync-runnow-btn"${disabled ? ' disabled' : ''}>Run Now</button>
                <!-- Stage timers sit OUTSIDE the collapsible log: progress stays visible
                     even when an admin hides the log lines. -->
                <div class="sync-stages-panel" id="sync-runnow-stages" hidden></div>
                ${collapsibleLogHTML('runnow', 'Activity log', `
                    <div id="sync-runnow-log" style="margin-top:var(--space-md)"></div>
                    <div id="sync-runnow-reports" style="margin-top:var(--space-md);display:flex;flex-direction:column;gap:var(--space-md)"></div>
                `)}
              </div>
            </div>
          </div>
        </div>`;
}

function wireRunNow(container, active) {
    const btn = container.querySelector('#sync-runnow-btn');
    if (!btn) return;

    const pickedIds = () => Array.from(container.querySelectorAll('.sync-runnow-pick:checked')).map((c) => c.dataset.league);

    // Pre-run estimate — what this run should take if nothing goes wrong. Recomputed
    // whenever the selection changes (including when the Source-Name gate in Active
    // Leagues toggles a pick), since every league adds an export pass.
    function updateEta() {
        const etaEl = container.querySelector('#sync-runnow-eta');
        if (!etaEl) return;
        const ids = pickedIds();
        if (ids.length === 0) {
            etaEl.textContent = 'Pick at least one league to see an estimated run time.';
            return;
        }
        etaEl.innerHTML = `Estimated run time <b>~${fmtDuration(estimateRunSeconds(ids))}</b>
            for ${ids.length} league${ids.length === 1 ? '' : 's'}, if everything runs smoothly.`;
    }
    container.querySelectorAll('.sync-runnow-pick').forEach((c) => c.addEventListener('change', updateEta));
    container._syncUpdateEta = updateEta; // Active Leagues re-checks picks programmatically
    updateEta();

    btn.addEventListener('click', async () => {
        const ids = pickedIds();
        const runLogEl = container.querySelector('#sync-runnow-log');
        const reportsEl = container.querySelector('#sync-runnow-reports');
        const stagesEl = container.querySelector('#sync-runnow-stages');
        // reveal:false — during a run the stage timers own the viewport (see below).
        const runLog = createSyncLog(runLogEl, { reveal: false });
        runLog.clear();
        reportsEl.innerHTML = '';

        if (ids.length === 0) { runLog.log('Pick at least one league to run.', 'error'); return; }

        btn.disabled = true;
        runLog.log(`Starting sync for ${ids.length} league${ids.length === 1 ? '' : 's'}…`, 'info');

        const titleOf = (id) => {
            const lg = active.find((l) => l.id === id);
            return lg ? (lg.params.LeagueTitle || id) : id;
        };

        // Live stage timers: each stage shows elapsed vs. how long it usually takes,
        // so a long silent gap (a runner installing, say) reads as progress and not
        // as a hang. Stage transitions are driven by the events themselves — the first
        // site-level line ends "startup", the first league line ends "connect", etc.
        stagesEl.hidden = false;
        const tracker = createStageTracker(stagesEl, ids.map((id) => ({ id, title: titleOf(id) })));
        // The progress panel is what matters the moment a run starts — put it at the
        // top of the viewport. The logs sit below it; scrolling to them is the
        // user's choice, which is also why none of this run's logs self-reveal.
        revealAtTop(stagesEl);
        tracker.begin('dispatch');

        // Build one report card + logger per selected league, and anchor each
        // league's live stream on its current newest event id.
        const cards = {};
        const anchors = {};
        const lastLevel = {};
        for (const id of ids) {
            const lg = active.find((l) => l.id === id);
            const type = lg ? (lg.params.LeagueType || 'doubling') : 'doubling';
            // Same card markup as a plan's Last Run (syncReportCardHTML), so the
            // live report and the replay look identical.
            reportsEl.insertAdjacentHTML('beforeend', syncReportCardHTML(titleOf(id), type, 'sync-report-log'));
            cards[id] = createSyncLog(reportsEl.lastElementChild.querySelector('.sync-report-log'), { reveal: false });
            cards[id].log('Queued…', 'info');
            anchors[id] = await latestEventId(id);
        }
        // Anchor the SITE-level stream (connecting / signing in — shared across the
        // whole run, shown once here in the global log, not per league).
        const siteSince = await latestSiteEventId();

        // Loggers that advance the stage clock as lines land, then pass the line on
        // untouched. begin/complete are idempotent, so firing them per line is safe.
        const siteLogger = {
            ...runLog,
            log: (msg, type = 'info', when = null) => {
                tracker.complete('startup');
                tracker.begin('connect');
                runLog.log(msg, type, when);
            },
        };
        const leagueLogger = (id) => ({
            ...cards[id],
            log: (msg, type = 'info', when = null) => {
                tracker.complete('startup'); // in case no site line ever arrived
                tracker.complete('connect'); // first league line = the site is in
                tracker.begin(`league:${id}`);
                lastLevel[id] = type;
                cards[id].log(msg, type, when);
            },
        });

        try {
            const { error } = await supabase.rpc('trigger_external_source_sync_now_leagues', { p_league_ids: ids });
            if (error) throw error;
            runLog.log('Request sent to the league site.', 'info');
            const running = await pollSyncDispatch(ids[0], runLog);
            tracker.complete('dispatch');
            if (!running) { tracker.done(); return; } // can't observe further — nothing to time

            tracker.begin('startup');
            // The site log (login/connection) streams into the GLOBAL log; each
            // league's export story streams into its own card. A site-level error
            // (e.g. couldn't sign in) aborts the per-league streams — no data will
            // come, so they stop quietly instead of hitting the "no progress" timeout.
            let leaguesDone = false;
            let aborted = false;
            // Last site-level line seen. GitHub Actions can take a minute just to boot
            // the runner, so the per-league "no progress" timer counts from the run's
            // last sign of life rather than from dispatch — otherwise it fired exactly
            // as the job came up, while the site log was streaming progress.
            let lastAlive = 0;
            const sitePromise = streamSiteEvents(siteSince, siteLogger, {
                stopWhen: () => leaguesDone,
                onError: () => { aborted = true; },
                onAlive: () => { lastAlive = Date.now(); },
            });
            await Promise.all(ids.map(async (id) => {
                await streamSyncEvents(id, anchors[id], leagueLogger(id), {
                    stopWhen: () => aborted,
                    aliveAt: () => lastAlive,
                });
                // The stream returns on the league's terminal line — its level says
                // whether that league landed or failed.
                if (lastLevel[id] === 'error') tracker.fail(`league:${id}`);
                else tracker.complete(`league:${id}`);
            }));
            leaguesDone = true;
            await sitePromise;
            runLog.log(
                aborted
                    ? 'Run stopped — see the connection problem above.'
                    : 'All selected syncs finished (or are still running in the background).',
                aborted ? 'error' : 'success',
            );
            if (aborted) tracker.stop(); else tracker.done();
        } catch (err) {
            runLog.log(friendlySyncError(err), 'error');
            tracker.stop();
        } finally {
            btn.disabled = false;
        }
    });
}

// ── Section 3: Auto Sync (plans) ───────────────────────────────────────────
// Each plan is its own top-level collapsible section — the SAME hierarchy as the
// Run Now card — so a plan reads as a peer control, not a nested well. Plan
// sections live in #sync-plans-list (kept as a wrapper for click delegation +
// dirty tracking); the Add Plan button sits just below the list.
function sectionAutoSync(active, plans, settings) {
    const sections = plans.map((pl) => planCardHTML(pl, active, settings)).join('');
    return `
        <div id="sync-plans-msg"></div>
        <div id="sync-plans-list">${sections}</div>
        <div class="dash-section" style="margin-top:var(--space-sm)">
            <button class="btn btn-secondary btn-sm" id="sync-add-plan" type="button">+ Add Plan</button>
        </div>`;
}

// A plan renders as a full `.app-section--card` section (peer of Run Now), with
// the plan name as its collapsible header. Inside, the layout mirrors Run Now:
// settings → Save button → collapsible activity log ("Last run").
function planCardHTML(pl, active, settings) {
    const isDefault = pl.id === DEFAULT_PLAN_ID;
    const memberCount = (pl.leagues || []).filter((id) => active.some((l) => l.id === id)).length;
    const times = (pl.times && pl.times.length) ? pl.times : ['03:00'];
    const timeRows = times.map((t) => timeRowHTML(t)).join('');
    const headBadge = isDefault
        ? '<span class="league-type-pill" style="margin-left:var(--space-sm)">Default</span>'
        : '';
    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">${esc(pl.name)}${headBadge}</h2>
            <div class="collapsible-body">
              <div class="admin-card edit-card-sm sync-plan-card" data-plan-id="${esc(pl.id)}">
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
                    ${isDefault ? ''
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
                <div style="color:var(--color-text-muted);font-size:0.8em;margin:-2px 0 var(--space-sm)">
                    Optional. Leave blank to run indefinitely — the plan is bounded by its leagues (a league that becomes Completed leaves automatically, and a plan with no active members runs nothing).
                </div>

                <div class="form-group">
                    <label>Run Times (every day, with &plusmn;1h randomization)</label>
                    <div class="sync-plan-times">${timeRows}</div>
                    <button class="btn btn-secondary btn-sm sync-plan-add-time" type="button">+ Add time</button>
                </div>

                <div style="color:var(--color-text-muted);font-size:0.85em;margin-bottom:var(--space-md)">
                    Member leagues: ${memberCount} (edit in Active Leagues)
                </div>

                <button class="btn btn-primary btn-sm sync-plan-save" type="button" disabled>Save Settings</button>

                ${lastRunHTML(pl, active)}
              </div>
            </div>
          </div>
        </div>`;
}

// ── Log hide/show (persisted) ──────────────────────────────────────────────
// Any sync log block (a Run Now report or a plan's last-run panel) can be
// collapsed. The choice sticks per block via localStorage, so a log the admin
// hid stays hidden across visits.
const LOG_HIDDEN_KEY = 'bgsync-log-hidden';

function logHiddenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(LOG_HIDDEN_KEY) || '[]')); }
    catch { return new Set(); }
}
function setLogHidden(key, hidden) {
    const s = logHiddenSet();
    if (hidden) s.add(key); else s.delete(key);
    try { localStorage.setItem(LOG_HIDDEN_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

/**
 * Wrap a log block in a header toggle that hides/shows the body. `key` persists
 * the collapsed state; `titleHTML` is the header label (may contain markup).
 */
function collapsibleLogHTML(key, titleHTML, bodyHTML) {
    return `
        <div class="sync-log-collapsible" data-log-key="${esc(key)}">
            <button type="button" class="sync-log-toggle" aria-expanded="true">
                <span class="sync-log-caret">&#9662;</span>
                <span class="sync-log-title">${titleHTML}</span>
                <span class="sync-log-hint">Hide</span>
            </button>
            <div class="sync-log-body">${bodyHTML}</div>
        </div>`;
}

/** Apply persisted hide state + wire the toggle for every log block. */
function wireLogCollapse(container) {
    const hidden = logHiddenSet();
    container.querySelectorAll('.sync-log-collapsible').forEach((wrap) => {
        if (wrap.dataset.logWired) return; // idempotent — safe to re-call after Add Plan
        wrap.dataset.logWired = '1';
        const key = wrap.dataset.logKey;
        const body = wrap.querySelector(':scope > .sync-log-body');
        const btn = wrap.querySelector(':scope > .sync-log-toggle');
        if (!body || !btn) return;
        const caret = btn.querySelector('.sync-log-caret');
        const hint = btn.querySelector('.sync-log-hint');
        const apply = (isHidden) => {
            body.hidden = isHidden;
            wrap.classList.toggle('is-collapsed', isHidden);
            if (caret) caret.innerHTML = isHidden ? '&#9656;' : '&#9662;';
            if (hint) hint.textContent = isHidden ? 'Show' : 'Hide';
            btn.setAttribute('aria-expanded', String(!isHidden));
        };
        apply(hidden.has(key));
        btn.addEventListener('click', () => {
            const next = !body.hidden;
            apply(next);
            setLogHidden(key, next);
        });
    });
}

/**
 * "Last run" block below a plan card — one report per member league, populated
 * after render by wirePlanLastRuns() with loadLastRun(). Same log format as Run
 * Now (colours, wording, real timestamps).
 */
function lastRunHTML(pl, active) {
    const members = (pl.leagues || []).map((id) => active.find((l) => l.id === id)).filter(Boolean);
    const reports = members.length
        ? members.map((lg) => syncReportCardHTML(
            lg.params.LeagueTitle || lg.id, lg.params.LeagueType || 'doubling',
            'sync-lastrun-log', ` data-league="${esc(lg.id)}"`)).join('')
        : `<div style="color:var(--color-text-muted);font-size:0.85em">No member leagues to report on.</div>`;
    return `
        <div class="sync-plan-lastrun">
            ${collapsibleLogHTML(`lastrun:${pl.id}`, 'Last run', reports)}
        </div>`;
}

/** One report card (league title + type pill + a log slot) — IDENTICAL markup
 *  for the Run Now live report and a plan's Last Run replay, so both read the
 *  same. `logClass` is the inner log container; `attrs` are extra attributes. */
function syncReportCardHTML(title, type, logClass, attrs = '') {
    return `
        <div class="sync-report-card admin-card" style="background:var(--color-inset);margin-bottom:var(--space-sm)">
            <div style="margin-bottom:var(--space-sm)"><span style="font-weight:600">${esc(title)}</span> ${typePill(type)}</div>
            <div class="${logClass}"${attrs}></div>
        </div>`;
}

// Run times as two selects (hour 00–23, minute in 5-min steps) rather than a
// native <input type="time">: the native picker renders in the browser's locale,
// which shows 12-hour AM/PM in many locales. Selects display a fixed 24-hour
// clock everywhere, so "13:00" reads as 13:00, never "1 PM".
function timeRowHTML(value) {
    const [hh, mm] = splitHHMM(value);
    const hourOpts = Array.from({ length: 24 }, (_, h) => pad2(h))
        .map((h) => `<option value="${h}"${h === hh ? ' selected' : ''}>${h}</option>`).join('');
    const minOpts = Array.from({ length: 12 }, (_, i) => pad2(i * 5))
        .map((m) => `<option value="${m}"${m === mm ? ' selected' : ''}>${m}</option>`).join('');
    return `
        <div class="sync-plan-time-row" style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-xs)">
            <select class="sync-plan-hour" aria-label="Hour (00–23)">${hourOpts}</select>
            <span class="sync-plan-time-colon" aria-hidden="true">:</span>
            <select class="sync-plan-min" aria-label="Minute">${minOpts}</select>
            <button type="button" class="btn btn-danger btn-sm sync-plan-del-time" title="Remove time">&#128465;</button>
        </div>`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** "HH:MM" → ["HH","MM"], clamped to 24h and snapped to the 5-min grid. Bad or
 *  empty input defaults to 03:00. */
function splitHHMM(value) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec((value || '').trim());
    let h = m ? parseInt(m[1], 10) : 3;
    let min = m ? parseInt(m[2], 10) : 0;
    if (!(h >= 0 && h <= 23)) h = 3;
    if (!(min >= 0 && min <= 59)) min = 0;
    min = Math.round(min / 5) * 5;
    if (min === 60) min = 55;
    return [pad2(h), pad2(min)];
}

/** Read a plan card's run times as "HH:MM" strings (from the hour/min selects). */
function planTimes(card) {
    return Array.from(card.querySelectorAll('.sync-plan-time-row')).map((row) => {
        const h = row.querySelector('.sync-plan-hour');
        const min = row.querySelector('.sync-plan-min');
        return (h && min) ? `${h.value}:${min.value}` : '';
    }).filter(Boolean);
}

function wireAutoSync(container, leagues, settings) {
    const list = container.querySelector('#sync-plans-list');

    // Add time / delete time (event delegation on the list).
    list.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.sync-plan-add-time');
        if (addBtn) {
            const times = addBtn.previousElementSibling; // .sync-plan-times
            times.insertAdjacentHTML('beforeend', timeRowHTML(nowHHMM()));
            if (container._syncRefreshDirty) container._syncRefreshDirty();
            return;
        }
        const delBtn = e.target.closest('.sync-plan-del-time');
        if (delBtn) {
            const rows = delBtn.closest('.sync-plan-times').querySelectorAll('.sync-plan-time-row');
            if (rows.length > 1) delBtn.closest('.sync-plan-time-row').remove();
            if (container._syncRefreshDirty) container._syncRefreshDirty();
            return;
        }
        const delPlan = e.target.closest('.sync-plan-delete');
        if (delPlan) {
            const card = delPlan.closest('.sync-plan-card');
            const section = delPlan.closest('.dash-section'); // remove the whole plan section
            // A brand-new plan (added this session, never published) — just drop it.
            // There's nothing on the site to remove, so it must NOT create a Pending
            // change. Only staged/published plans stage a removal.
            if (card.hasAttribute('data-new')) {
                section.remove();
                if (container._syncRefreshDirty) container._syncRefreshDirty();
                return;
            }
            const name = card.querySelector('.sync-plan-name').value.trim() || 'this plan';
            if (confirm(`Delete plan "${name}"? It will be removed from the site on the next Publish.`)) {
                section.remove();
                saveAll(container, leagues, 'sync-plans-msg');
            }
            return;
        }
        const savePlan = e.target.closest('.sync-plan-save');
        if (savePlan) { saveAll(container, leagues, 'sync-plans-msg'); return; }
    });

    // Add plan — append a fresh plan SECTION (peer of Run Now) and wire its
    // collapse + log toggles. No re-render: a brand-new plan has no members yet,
    // so Active Leagues doesn't need its column until the plan is saved.
    const addPlanBtn = container.querySelector('#sync-add-plan');
    if (addPlanBtn) addPlanBtn.addEventListener('click', () => {
        const active = leagues.filter((l) => l.params && l.params.Running === true);
        const newPlan = { id: String(Date.now()), name: 'New Plan', enabled: true, mode: 'full', times: ['03:00'], jitterMinutes: 60, startDate: null, endDate: null, leagues: [] };
        list.insertAdjacentHTML('beforeend', planCardHTML(newPlan, active, settings));
        const section = list.lastElementChild;
        // Tag the card so a later Delete drops it silently (never published → no Pending).
        const card = section.querySelector('.sync-plan-card');
        if (card) card.setAttribute('data-new', '1');
        // Wire the new section's collapse + its (empty) Last-run log toggle.
        const appSection = section.querySelector('.app-section');
        if (appSection) wireSectionCollapse(appSection, { defaultOpen: true });
        wireLogCollapse(container);
        // A brand-new plan has no baseline → its Save enables immediately.
        if (container._syncRefreshDirty) container._syncRefreshDirty();
    });
}

// ── Per-section dirty tracking — a Save Settings button enables ONLY when its
// own fields actually change (fixes always-on buttons that staged no-op changes).
//   • Active Leagues Save  ← Source League Name OR Plans membership.
//   • each Auto Sync plan Save ← that plan's name / enabled / dates / run-times.
//     Member-league count is shown there but NOT editable there, so it does NOT
//     arm the plan's Save (membership is owned by the Active Leagues matrix).
// Whole-file staging is unchanged; this only governs button enablement.
function activeSig(container) {
    const src = {};
    container.querySelectorAll('.sync-source-name').forEach((i) => { src[i.dataset.league] = i.value.trim(); });
    const mem = [];
    container.querySelectorAll('.sync-plan-member').forEach((c) => { if (c.checked) mem.push(`${c.dataset.plan}::${c.dataset.league}`); });
    mem.sort();
    return JSON.stringify({ src, mem });
}

function planSig(card) {
    const times = planTimes(card);
    return JSON.stringify({
        name: card.querySelector('.sync-plan-name').value.trim(),
        enabled: card.querySelector('.sync-plan-enabled').checked,
        start: card.querySelector('.sync-plan-start').value || '',
        end: card.querySelector('.sync-plan-end').value || '',
        times,
    });
}

function wireDirtyTracking(container, active) {
    const baseActive = activeSig(container);
    const basePlans = {}; // planId → baseline signature ('' baseline = existing/clean; absent = brand-new)
    container.querySelectorAll('.sync-plan-card').forEach((card) => { basePlans[card.dataset.planId] = planSig(card); });

    function refreshDirty() {
        const activeBtn = container.querySelector('#sync-leagues-save');
        if (activeBtn) activeBtn.disabled = active.length === 0 || activeSig(container) === baseActive;
        container.querySelectorAll('.sync-plan-card').forEach((card) => {
            const btn = card.querySelector('.sync-plan-save');
            if (!btn) return;
            const base = basePlans[card.dataset.planId];
            // Existing plan: enable only if it changed. Brand-new plan (no baseline): always enabled.
            btn.disabled = base !== undefined && planSig(card) === base;
        });
    }

    container.addEventListener('input', refreshDirty);
    container.addEventListener('change', refreshDirty);
    container._syncRefreshDirty = refreshDirty;
    refreshDirty();
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
        const times = planTimes(card);
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
        target: T.syncSettings(),
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
