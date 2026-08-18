/**
 * mailSync.js — Admin ▸ Sync ▸ the two e-mail-ingestion sections.
 *
 * The External Source mails a report at the end of every match. An automation
 * in the recipient's mailbox parses it and calls submit_match_report() — the
 * one function `anon` may execute (sql/mail_sync.sql). Everything downstream
 * of that call is this file's subject.
 *
 * Two sections, rendered above the existing Sync sections:
 *
 *   F8 — Unassigned Email Matches. Only rendered when there is something to
 *        assign. A report lands here when the candidate scan found anything
 *        other than exactly one running league holding this pair as an open,
 *        non-override-covered fixture. The admin picks the league; Apply calls
 *        mail_apply_report, which re-runs the scan server-side before writing
 *        (a stale pick must never overwrite a played result).
 *
 *   F9 — Mail Automated Matches. Every mail-sourced match, auto-applied or
 *        admin-assigned, newest first. Columns mirror B5 (Played Matches) plus
 *        League — the table is cross-league, which B5 never is — and the Date
 *        carries a time, because "which match was this" is a per-minute
 *        question here, not a per-day one.
 *
 * A mail-applied match is a CSV-applied match: same override precedence, same
 * Historical Changes batch shape. That equivalence lives in the SQL, not here.
 */

import { supabase } from '../data/supabaseClient.js';
import { flagUrl, getFlagCode, formatNumber, thLabel } from '../utils/helpers.js';
import { attachStickyShadow } from '../utils/stickyShadow.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── Data ───────────────────────────────────────────────────────────────────

export async function loadMailState() {
    const [pending, log, health] = await Promise.all([
        supabase.rpc('mail_reports_pending'),
        supabase.rpc('mail_reports_log', { p_limit: 200 }),
        supabase.rpc('mail_reports_health'),
    ]);
    if (pending.error || log.error || health.error) {
        throw new Error((pending.error || log.error || health.error).message);
    }
    // Order F9 by the value its Date column actually shows (when the match was
    // played), not by when the mail arrived. The two differ whenever a report
    // is forwarded late or an admin assigns one by hand, and a table sorted by
    // a column it doesn't display just reads as unsorted.
    const at = (r) => new Date((r.payload && r.payload.played_at) || r.received_at).getTime();
    return {
        pending: pending.data || [],
        log: (log.data || []).filter((r) => r.status === 'applied').sort((a, b) => at(b) - at(a)),
        health: health.data || {},
    };
}

// ── Formatting ─────────────────────────────────────────────────────────────

function playerCell(name, customFlags, outcome) {
    const code = getFlagCode(name, customFlags || {});
    const cls = outcome === 'win' ? ' result-win' : (outcome === 'loss' ? ' result-loss' : '');
    return `<td class="player-cell${cls}"><img class="flag" src="${flagUrl(code)}" alt="${esc(code)}"> ${esc(name)}</td>`;
}

/**
 * The flag map to read a report's players out of.
 *
 * A flag belongs to a player IN A LEAGUE — CustomFlags is per-league state, and
 * the same name can fly different flags in different seasons. So once a report
 * has been assigned, its own league's map is the only correct one; the merged
 * fallback is for reports that do not have a league yet, and is a best guess by
 * construction.
 */
function flagsFor(leagueId, flagsByLeague, fallback) {
    return (leagueId && flagsByLeague && flagsByLeague[leagueId]) || fallback || {};
}

/** Winner/loser per side, or null on a tie — mirrors B5's rule exactly. */
function outcomes(a, b) {
    if (a === b) return [null, null];
    return a > b ? ['win', 'loss'] : ['loss', 'win'];
}

function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
}

function fmtAgo(iso) {
    if (!iso) return 'never';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    return `${Math.floor(hrs / 24)} days ago`;
}

/**
 * Health dot. Green while reports are arriving, amber once the mailbox has
 * been quiet for over a day. The whole point of the strip: an automation that
 * dies dies silently, and silence looks exactly like "no matches were played".
 */
function healthTone(iso) {
    if (!iso) return 'is-stale';
    return (Date.now() - new Date(iso).getTime()) > 24 * 3600 * 1000 ? 'is-stale' : 'is-live';
}

// ── F8 — Unassigned Email Matches ──────────────────────────────────────────

/**
 * F8 holds two problems that look alike in a count and are opposite in what the
 * admin must do:
 *
 *   AMBIGUOUS — more than one running league holds this pair as an open
 *               fixture. There IS a choice; make it and Apply.
 *   ORPHAN    — no running league holds it at all. There is NO choice to make
 *               from this screen. Almost always a player name that doesn't
 *               match the roster (matching is exact-string), or a pair whose
 *               result is already recorded or override-covered.
 *
 * One sentence cannot serve both: telling an admin to "pick the league" for a
 * row with nothing to pick sends them looking for a dropdown that isn't there.
 * So the banner counts each kind and says only what is true of it.
 */
function pendingBanner(pending) {
    const orphans = pending.filter((r) => !(Array.isArray(r.candidates) && r.candidates.length)).length;
    const ambiguous = pending.length - orphans;
    const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;

    const lines = [];
    if (ambiguous) {
        lines.push(`<b>${n(ambiguous, 'report matches', 'reports match')} more than one running league.</b>
                    Pick the league for each, then Apply.`);
    }
    if (orphans) {
        lines.push(`<b>${n(orphans, 'report matches', 'reports match')} no open fixture in any running league.</b>
                    The reason is on each row. These can't be applied from here — fix what the row says, or Discard.`);
    }
    return `<div class="admin-msg admin-msg-warning">${lines.join('<br>')}</div>`;
}

function sectionPending(pending, customFlags) {
    if (!pending.length) return '';

    const rows = pending.map((r) => {
        const p = r.payload || {};
        const [oa, ob] = outcomes(Number(p.score_a), Number(p.score_b));
        const cands = Array.isArray(r.candidates) ? r.candidates : [];

        // Zero candidates is a different sentence from "pick one of N", and the
        // picker must not pretend there is a choice.
        const picker = cands.length
            ? `<select class="mail-league-pick" data-report="${r.id}"
                       aria-label="Assign ${esc(p.player_a)} vs ${esc(p.player_b)} to a league">
                   <option value="">— pick one of ${cands.length} —</option>
                   ${cands.map((c) => `<option value="${esc(c.league_id)}">${esc(c.league_id)}</option>`).join('')}
               </select>`
            : `<span class="mail-no-cand">${esc(r.reason || 'No open fixture in any running league.')}</span>`;

        // No candidates → no Apply button at all, not a disabled one. A button
        // that can never become enabled advertises a path that doesn't exist;
        // Discard is the only action this row actually has.
        // Analytics: these carry a `data-track` so the operator's mail-sync review
        // actions are logged as named clicks (js/analytics.js's delegated listener).
        // The pair identifies the report at a glance; the Apply target gets the
        // CHOSEN league folded in on select-change (see wireMailActions) so one row
        // says which league resolved the conflict. "(Admin Mode)" mirrors the
        // convention for admin actions; admin_user is set regardless, so these sit
        // in the excluded operator lane by default.
        const dtPair = `${esc(p.player_a)} vs ${esc(p.player_b)}`;
        const actions = cands.length
            ? `<button class="btn btn-primary btn-sm mail-apply" data-report="${r.id}"
                       data-pa="${esc(p.player_a)}" data-pb="${esc(p.player_b)}"
                       data-track="Mail: apply ${dtPair} (Admin Mode)" disabled>Apply</button>
               <button class="btn btn-danger btn-xs mail-discard" data-report="${r.id}"
                       data-track="Mail: discard ${dtPair} (Admin Mode)">Discard</button>`
            : `<button class="btn btn-danger btn-xs mail-discard" data-report="${r.id}"
                       data-track="Mail: discard ${dtPair} (Admin Mode)">Discard</button>`;

        // Every row here is unassigned by definition, so the merged fallback is
        // all there is — there is no league whose map could be preferred.
        return `
            <tr data-report-row="${r.id}">
                ${playerCell(p.player_a, customFlags, oa)}
                ${playerCell(p.player_b, customFlags, ob)}
                <td>${esc(p.score_a)} - ${esc(p.score_b)}</td>
                <td class="mail-len">${esc(p.match_length ?? '—')}</td>
                <td>${p.pr_a == null ? '—' : formatNumber(p.pr_a, 3)}</td>
                <td>${p.pr_b == null ? '—' : formatNumber(p.pr_b, 3)}</td>
                <td>${p.luck_a == null ? '—' : formatNumber(p.luck_a)}</td>
                <td>${p.luck_b == null ? '—' : formatNumber(p.luck_b)}</td>
                <td>${fmtDateTime(r.received_at)}</td>
                <td>${picker}</td>
                <td class="mail-actions">${actions}</td>
            </tr>`;
    }).join('');

    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Unassigned Email Matches (${pending.length})</h2>
            <div class="collapsible-body">
              <div class="admin-card">
                <div id="mail-pending-msg"></div>
                ${pendingBanner(pending)}
                <p style="color:var(--color-text-muted);margin-bottom:var(--space-md);font-size:0.9em">
                    A report applies itself when <b>exactly one</b> running league holds this pair as an
                    open fixture at the same match length, with no override covering it. Anything else lands here.
                </p>
                <div class="ff-wrap">
                    <table class="admin-table font-large ff-sticky-2" data-mf-table-id="F8">
                        <thead>
                            <tr>
                                <th scope="col">${thLabel('Player A', 'A')}</th>
                                <th scope="col">${thLabel('Player B', 'B')}</th>
                                <th scope="col">Score</th>
                                <th scope="col">${thLabel('Length', 'Len')}</th>
                                <th scope="col">PR A</th>
                                <th scope="col">PR B</th>
                                <th scope="col">Luck A</th>
                                <th scope="col">Luck B</th>
                                <th scope="col">Received</th>
                                <th scope="col">${thLabel('Assign to League', 'League')}</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <p style="color:var(--color-text-muted);margin-top:var(--space-md);font-size:0.85em">
                    Applying writes the result exactly as a CSV import would — same override precedence,
                    and one Historical Changes entry per match.
                </p>
              </div>
            </div>
          </div>
        </div>`;
}

// ── F9 — Mail Automated Matches ────────────────────────────────────────────

function sectionLog(log, health, customFlags, flagsByLeague) {
    const rows = log.length ? log.map((r) => {
        const p = r.payload || {};
        // Stored A/B may be the fixture's reverse; display the report as it came.
        const [oa, ob] = outcomes(Number(p.score_a), Number(p.score_b));
        // Assigned rows read their own league's flags; unassigned ones fall back.
        const f = flagsFor(r.league_id, flagsByLeague, customFlags);
        return `
            <tr data-league="${esc(r.league_id || '')}">
                ${playerCell(p.player_a, f, oa)}
                ${playerCell(p.player_b, f, ob)}
                <td>${esc(p.score_a)} - ${esc(p.score_b)}</td>
                <td>${p.pr_a == null ? '—' : formatNumber(p.pr_a, 3)}</td>
                <td>${p.pr_b == null ? '—' : formatNumber(p.pr_b, 3)}</td>
                <td>${p.luck_a == null ? '—' : formatNumber(p.luck_a)}</td>
                <td>${p.luck_b == null ? '—' : formatNumber(p.luck_b)}</td>
                <td>${esc(r.league_id || '—')}</td>
                <td>${fmtDateTime(p.played_at || r.received_at)}</td>
                <td><span class="mail-src-pill${r.auto_applied ? '' : ' is-admin'}">${r.auto_applied ? 'AUTO' : 'ADMIN'}</span></td>
            </tr>`;
    }).join('') : `<tr><td colspan="10" style="text-align:center;color:var(--color-text-muted)">
                       No matches have arrived by e-mail yet.</td></tr>`;

    const leagueOpts = [...new Set(log.map((r) => r.league_id).filter(Boolean))].sort();

    return `
        <div class="dash-section">
          <div class="app-section app-section--card">
            <h2 class="app-section-h2">Mail Automated Matches</h2>
            <div class="collapsible-body">
              <div class="admin-card">
                <!-- Health strip. Each figure and its label are ONE element, not
                     a run of bare text: as an anonymous inline run inside the
                     flex row they broke wherever the line happened to end,
                     stranding "14" on one line and "applied automatically" on
                     the next. On a phone that is most of the strip. -->
                <div class="mail-health">
                    <p class="mail-health-lead">
                        <span class="mail-dot ${healthTone(health.last_received)}"></span>
                        Last report received <b>${esc(fmtAgo(health.last_received))}</b>
                    </p>
                    <dl class="mail-stats">
                        <div class="mail-stat">
                            <dt>${health.auto_applied || 0}</dt><dd>Auto&#8209;applied</dd>
                        </div>
                        <div class="mail-stat">
                            <dt>${health.admin_applied || 0}</dt><dd>By admin</dd>
                        </div>
                        <div class="mail-stat">
                            <dt>${health.pending || 0}</dt><dd>Awaiting</dd>
                        </div>
                        <div class="mail-stat">
                            <dt>${health.discarded || 0}</dt><dd>Discarded</dd>
                        </div>
                    </dl>
                    <select class="mail-league-filter" aria-label="Filter by league">
                        <option value="">All leagues</option>
                        ${leagueOpts.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
                    </select>
                </div>
                <div class="ff-wrap">
                    <table class="admin-table font-large ff-sticky-2" data-mf-table-id="F9">
                        <thead>
                            <tr>
                                <th scope="col">${thLabel('Player A', 'A')}</th>
                                <th scope="col">${thLabel('Player B', 'B')}</th>
                                <th scope="col">Score</th>
                                <th scope="col">PR A</th>
                                <th scope="col">PR B</th>
                                <th scope="col">Luck A</th>
                                <th scope="col">Luck B</th>
                                <th scope="col">League</th>
                                <th scope="col">Date</th>
                                <th scope="col">${thLabel('Assigned', 'By')}</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
              </div>
            </div>
          </div>
        </div>`;
}

/** Rows of F9 shown before "Show all". Matches the presets that already chose
 *  a number for a log-shaped table — completedLeagues, playerAllMatches and
 *  matchup all use 10. */
const MAIL_LOG_TOP_N = 10;

/**
 * Show-top-N for F9 — the canonical mechanism, wired to an FF table.
 *
 * Same contract as table-lab's MF and SF mounts: hide rows past N with
 * `.table-row-hidden`, offer a `.show-more-btn` reading "Show all (N)" /
 * "Show top N". Both classes already reach this page — admin.html loads
 * mf.css, which carries `.table-row-hidden` and imports base.css for the
 * button — so nothing is redefined here. FF has no showTopN option of its
 * own, which is the only reason this is written out rather than passed as a
 * parameter; when F9 moves onto a real FF mount in Phase 8 this should become
 * `showTopN: 10` and be deleted.
 *
 * The one thing it does NOT share with the canonical version is what "the
 * rows" means. F9 also has a league filter, which hides rows with the `hidden`
 * attribute. A top-N that counted every row in the tbody would slice the first
 * ten of ALL matches and then let the filter hide most of them — filter to a
 * league whose matches sit at rows 15-20 and the table comes back empty while
 * claiming to show the top ten. So the count, the slice and the button's total
 * are all over the rows the filter is currently letting through, and the filter
 * re-runs this on every change.
 *
 * @returns {{sync: function}} call sync() after changing what the filter shows
 */
function applyShowTopN(table, n) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return { sync: () => {} };

    // `[data-league]` excludes the "no matches yet" placeholder row, which is
    // neither filterable nor countable.
    const all = () => [...tbody.querySelectorAll('tr[data-league]')];
    if (!all().length) return { sync: () => {} };

    const wrap = table.closest('.ff-wrap') || table;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'show-more-btn';
    wrap.after(btn);

    let expanded = false;

    function sync() {
        const visible = all().filter((tr) => !tr.hidden);
        visible.forEach((tr, i) => tr.classList.toggle('table-row-hidden', !expanded && i >= n));
        // Rows the filter is hiding must not keep a stale collapse class, or
        // they stay hidden by two mechanisms and re-appear only by luck.
        all().filter((tr) => tr.hidden).forEach((tr) => tr.classList.remove('table-row-hidden'));

        const needed = visible.length > n;
        btn.hidden = !needed;
        if (needed) btn.textContent = expanded ? `Show top ${n}` : `Show all (${visible.length})`;
        else expanded = false;   // a narrowed filter leaves no expanded state to restore
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        sync();
    });

    sync();
    return { sync };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function mailSectionsHTML(state, customFlags, flagsByLeague) {
    return sectionPending(state.pending, customFlags)
         + sectionLog(state.log, state.health, customFlags, flagsByLeague);
}

/**
 * FF's `ff-sticky-2` variant pins Player A AND Player B: a match row's identity
 * is the pair, and a score against one name is half a result. Column 2's `left`
 * is column 1's rendered width, which is content-driven, so it is measured —
 * spelling mirrors SF's `--sf-col1-w` (table-lab/formats/sf/mount.js).
 *
 * Measure AFTER the flags load, not on first layout. `.flag` is
 * `height: 1em; width: auto`, so an unloaded flag contributes 0 width:
 * measured live on F8, th1 is 117.67px before the flags land and 131.33px
 * after — exactly one 13.67px flag — which parks column 2 fourteen pixels
 * inside column 1, permanently.
 *
 * Hence the observer watches the HEADER CELL, which reflows when the images
 * do. Watching the wrap does not work (its size never changes), and neither
 * does a one-shot rAF: pinning itself does NOT alter column 1's width
 * (verified — identical with and without the class), so there is no single
 * post-layout frame at which the value is already correct.
 */
function attachStickyCols(table) {
    const th1 = table.querySelector('thead th:first-child');
    if (!th1) return;
    const measure = () => {
        const w = th1.getBoundingClientRect().width;
        if (w > 0) table.style.setProperty('--ff-col1-w', `${w}px`);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(th1);
}

export function wireMailSections(container, onChanged) {
    container.querySelectorAll('.ff-sticky-2').forEach(attachStickyCols);

    // F9 only. F8 is a work queue — every row there is waiting on a decision,
    // so collapsing it would hide outstanding work behind a button.
    const logTable = container.querySelector('[data-mf-table-id="F9"]');
    const topN = logTable ? applyShowTopN(logTable, MAIL_LOG_TOP_N) : { sync: () => {} };

    // Apply stays disabled until a league is chosen; choosing one also tints the
    // row pending, so a screen with several rows shows at a glance what a click
    // on "Apply" is about to commit.
    container.querySelectorAll('.mail-league-pick').forEach((sel) => {
        sel.addEventListener('change', () => {
            const row = sel.closest('tr');
            const btn = row.querySelector('.mail-apply');
            const chosen = !!sel.value;
            btn.disabled = !chosen;
            row.classList.toggle('is-resolved', chosen);
            // Fold the chosen league into the Apply click's target, so the single
            // logged event names WHICH league the conflict resolved to — not just
            // "Apply". The league selection is captured here, inside the action it
            // belongs to, rather than as a separate row per dropdown fiddle.
            btn.dataset.track = chosen
                ? `Mail: apply ${btn.dataset.pa} vs ${btn.dataset.pb} → ${sel.value} (Admin Mode)`
                : `Mail: apply ${btn.dataset.pa} vs ${btn.dataset.pb} (Admin Mode)`;
        });
    });

    container.querySelectorAll('.mail-apply').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const sel = row.querySelector('.mail-league-pick');
            if (!sel || !sel.value) return;
            btn.disabled = true;
            btn.textContent = 'Applying…';
            const { data, error } = await supabase.rpc('mail_apply_report', {
                p_report_id: Number(btn.dataset.report),
                p_league_id: sel.value,
            });
            if (error || (data && data.ok === false)) {
                showMailMsg(container, (error && error.message) || data.hint || data.error, 'error');
                btn.disabled = false;
                btn.textContent = 'Apply';
                return;
            }
            if (onChanged) onChanged();
        });
    });

    container.querySelectorAll('.mail-discard').forEach((btn) => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const { error } = await supabase.rpc('mail_discard_report', {
                p_report_id: Number(btn.dataset.report), p_reason: 'Discarded by admin',
            });
            if (error) { showMailMsg(container, error.message, 'error'); btn.disabled = false; return; }
            if (onChanged) onChanged();
        });
    });

    const filter = container.querySelector('.mail-league-filter');
    if (filter) {
        filter.addEventListener('change', () => {
            const want = filter.value;
            container.querySelectorAll('[data-mf-table-id="F9"] tbody tr[data-league]').forEach((tr) => {
                tr.hidden = !!want && tr.dataset.league !== want;
            });
            // Re-slice over what the filter now lets through — see applyShowTopN.
            topN.sync();
        });
    }
}

function showMailMsg(container, text, kind) {
    const slot = container.querySelector('#mail-pending-msg');
    if (!slot) return;
    slot.innerHTML = `<div class="admin-msg admin-msg-${kind}">${esc(text)}</div>`;
}
