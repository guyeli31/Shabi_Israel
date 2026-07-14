/**
 * syncLog.js — Shared "External Source" sync activity-log helpers.
 *
 * Extracted from leagueManager.js so both the (now removed) per-league card and
 * the dedicated Sync page's Run-Now report cards render identical live logs. A
 * logger is bound to a target element (createSyncLog), so the same code drives a
 * single fixed panel or one card per league.
 *
 * The log only DISPLAYS lines. The user-facing wording of sync progress is
 * authored by the sync job (scripts/sync-source.js) and stored in
 * external_source_sync_events — here we just poll and render.
 */

import { supabase } from '../data/supabaseClient.js';
import { revealMsg } from './msgScroll.js';

const DEFAULT_MAX = 10;

/**
 * Bind a running, colour-coded, auto-scrolling log to one element.
 * Reuses the existing `.bgsync-log` / `.admin-msg` chrome in css/admin.css.
 * @returns {{ log:(msg:string,type?:string)=>void, clear:()=>void, el:HTMLElement }}
 */
export function createSyncLog(el, { max = DEFAULT_MAX } = {}) {
    // `when` (ISO string / Date) stamps the line with the event's real time — used
    // when replaying a past run. Live callers omit it and get the current time.
    function log(message, type = 'info', when = null) {
        if (!el) return;
        el.classList.add('bgsync-log');
        const line = document.createElement('div');
        line.className = `admin-msg admin-msg-${type}`;
        const t = (when ? new Date(when) : new Date())
            .toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        line.innerHTML = `<span class="bgsync-log-time">${t}</span> ${message}`;
        el.appendChild(line);
        while (el.children.length > max) el.removeChild(el.firstChild);
        el.scrollTop = el.scrollHeight;
        revealMsg(el);
    }
    function clear() {
        if (el) { el.innerHTML = ''; el.classList.remove('bgsync-log'); }
    }
    return { log, clear, el };
}

/** Turn a raw dispatch failure into one plain sentence the site owner can act on. */
export function friendlySyncError(err) {
    if (err && err.rejectedCode != null) {
        const c = err.rejectedCode;
        if (c === 401 || c === 403) return "Couldn't start — the site connection isn't authorized (check the access token).";
        if (c === 422) return "Couldn't start — the automation isn't published on the site yet (needs the main branch).";
        return "Couldn't start — the site refused the request.";
    }
    const m = (err && err.message) || '';
    if (/Could not find the function/i.test(m)) return "The sync isn't fully set up on the server yet.";
    if (/vault|github_dispatch_pat/i.test(m)) return "The sync isn't fully configured — the site access token is missing.";
    return "Couldn't start the sync — please try again in a moment.";
}

/** Newest event id for a league (anchor a live stream immune to clock skew). */
export async function latestEventId(leagueId) {
    const { data } = await supabase
        .from('external_source_sync_events')
        .select('id')
        .eq('league_id', leagueId)
        .order('id', { ascending: false })
        .limit(1);
    return (data && data.length) ? data[0].id : 0;
}

/**
 * After a "Run now" dispatch, poll external_source_sync_status() and log each
 * stage in plain language. Returns on accepted/timeout; throws (with
 * .rejectedCode) on rejection so the caller logs a red line.
 */
export async function pollSyncDispatch(leagueId, logger) {
    const DEADLINE_MS = 30000;
    const INTERVAL_MS = 2000;
    const start = Date.now();
    let waitingLogged = false;
    while (Date.now() - start < DEADLINE_MS) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        const { data, error } = await supabase.rpc('external_source_sync_status', { p_league_id: leagueId });
        if (error) {
            logger.log('Sync started. Results will appear in Historical Changes shortly.', 'success');
            return false;
        }
        const stage = data && data.stage;
        if (stage === 'accepted') {
            logger.log('The site accepted the request — the sync is now running.', 'success');
            return true;
        }
        if (stage === 'rejected') {
            const e = new Error('rejected');
            e.rejectedCode = data.status_code;
            e.rejectedDetail = data.error;
            throw e;
        }
        if (!waitingLogged) { logger.log('Waiting for the site to respond…', 'info'); waitingLogged = true; }
    }
    logger.log('Still waiting — the site is slow to respond. You can leave this page; results will show in Historical Changes.', 'info');
    return false;
}

/**
 * Live-stream the job's progress events into the log until a terminal event
 * ("Sync complete" / an error line) arrives or the deadline hits. `sinceId`
 * scopes to events from this run.
 *
 * `aliveAt()` returns the timestamp of the last SITE-level event (connecting /
 * signing in). The silence timer is measured from THAT, not from dispatch: GitHub
 * Actions routinely takes 40-60s just to boot the runner, so a fixed deadline from
 * dispatch declared "the sync failed to start" at the very moment the job began —
 * while the site-level log was visibly streaming progress. Any sign of life from
 * the run resets the clock; only a run that says nothing at all trips it.
 */
export async function streamSyncEvents(leagueId, sinceId, logger, { stopWhen = () => false, aliveAt = () => 0 } = {}) {
    const DEADLINE_MS = 4 * 60 * 1000;
    const INTERVAL_MS = 3000;
    const SILENT_MS = 90000; // no per-league news AND no sign of life for this long
    let lastId = sinceId;
    let anySeen = false;
    const start = Date.now();
    while (Date.now() - start < DEADLINE_MS) {
        // A site-level failure (e.g. couldn't sign in) means no per-league data
        // will ever come — stop quietly instead of waiting out the silent timeout.
        if (stopWhen()) return;
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        const { data, error } = await supabase
            .from('external_source_sync_events')
            .select('id, level, message')
            .eq('league_id', leagueId)
            .gt('id', lastId)
            .order('id', { ascending: true })
            .limit(50);
        if (error) return; // events table not available — stop quietly
        for (const ev of (data || [])) {
            lastId = ev.id;
            anySeen = true;
            logger.log(ev.message, ev.level);
            if (ev.level === 'error' || /sync complete/i.test(ev.message)) return;
        }
        const lastSignOfLife = Math.max(start, aliveAt() || 0);
        if (!anySeen && !stopWhen() && Date.now() - lastSignOfLife > SILENT_MS) {
            logger.log("No progress was reported — the sync likely failed to start, or the server can't post updates. Check the GitHub Actions run.", 'error');
            return;
        }
    }
    logger.log('Still running — you can leave this page; the log updates on your next visit.', 'info');
}

/** Newest SITE-level event id (league_id IS NULL) — anchor for streamSiteEvents. */
export async function latestSiteEventId() {
    const { data } = await supabase
        .from('external_source_sync_events')
        .select('id')
        .is('league_id', null)
        .order('id', { ascending: false })
        .limit(1);
    return (data && data.length) ? data[0].id : 0;
}

/**
 * Stream SITE-level events (league_id IS NULL) — the run's shared connection /
 * login story — into one logger (the global Run Now log). These are authored
 * once per run by the job, never per league. Stops when `stopWhen()` becomes
 * true (the per-league streams finished) or on the first error-level line, which
 * also calls `onError()` so the caller can abort the league streams.
 */
export async function streamSiteEvents(sinceId, logger, { stopWhen = () => false, onError = () => {}, onAlive = () => {} } = {}) {
    const DEADLINE_MS = 4 * 60 * 1000;
    const INTERVAL_MS = 3000;
    let lastId = sinceId;
    const start = Date.now();
    while (Date.now() - start < DEADLINE_MS) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        const { data, error } = await supabase
            .from('external_source_sync_events')
            .select('id, level, message')
            .is('league_id', null)
            .gt('id', lastId)
            .order('id', { ascending: true })
            .limit(50);
        if (error) return; // events table not available — stop quietly
        let sawError = false;
        for (const ev of (data || [])) {
            lastId = ev.id;
            logger.log(ev.message, ev.level);
            // Any site-level line proves the run is alive — it keeps the per-league
            // streams from wrongly declaring "the sync failed to start".
            onAlive();
            if (ev.level === 'error') sawError = true;
        }
        if (sawError) { onError(); return; }
        if (stopWhen()) return;
    }
}

/** Load the most recent run's log lines for a league (persisted history). */
export async function loadRecentSyncEvents(leagueId, logger, max = DEFAULT_MAX) {
    const { data, error } = await supabase
        .from('external_source_sync_events')
        .select('id, level, message, created_at')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(max);
    if (error || !data || data.length === 0) return;
    logger.clear();
    for (const ev of data.reverse()) logger.log(ev.message, ev.level, ev.created_at);
}

/**
 * Replay the LAST run's full log for a league — the league's own events plus that
 * same run's shared site-level (login/connection) lines — merged in chronological
 * order and stamped with each line's real time. Identical colours/wording/format
 * to Run Now, so an admin can see what happened behind the scenes and whether it
 * succeeded. "Last run" = the most recent run (scheduled or manual) that touched
 * this league; events aren't tagged by plan, so a league shared by two plans shows
 * the same last run under both.
 */
export async function loadLastRun(leagueId, logger, max = 40) {
    const { data: last } = await supabase
        .from('external_source_sync_events')
        .select('run_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(1);
    if (!last || !last.length) { logger.clear(); logger.log('No runs recorded yet.', 'info'); return; }

    const runId = last[0].run_id;
    if (!runId) return loadRecentSyncEvents(leagueId, logger, max); // legacy rows without a run id

    const [own, site] = await Promise.all([
        supabase.from('external_source_sync_events')
            .select('level, message, created_at').eq('run_id', runId).eq('league_id', leagueId),
        supabase.from('external_source_sync_events')
            .select('level, message, created_at').eq('run_id', runId).is('league_id', null),
    ]);
    const rows = [...(own.data || []), ...(site.data || [])]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    logger.clear();
    if (!rows.length) { logger.log('No activity recorded for the last run.', 'info'); return; }
    for (const ev of rows.slice(-max)) logger.log(ev.message, ev.level, ev.created_at);
}
