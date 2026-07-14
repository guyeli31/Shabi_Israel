/**
 * csvValidation.js — Pre-stage compatibility report for CSV/Excel imports.
 *
 * When an admin uploads a CSV to replace a league's data, this compares the
 * uploaded file against the league's CURRENT state (staged version if present,
 * otherwise the published file) and produces a human-readable report so the admin
 * knows exactly what the upload contains before it ever reaches Pending Changes.
 *
 * It NEVER blocks: the report is informational. The admin always decides whether
 * to continue. Until a backend/DB exists, leaguedata.csv IS the datastore, so an
 * import is a full-file overwrite — this report is the only safety net.
 */

import { getStagedContent } from './stagingStore.js';
import { parseCSV, parseCSVWithRounds, parseCSVAllWithRounds, getAllPlayersFromCSV } from '../data/csvParser.js';
import { loadLeagueMatchesAll, loadOverrides } from '../data/supabaseLoader.js';
import {
    validateCsvStructure, describeLeagueShape, collectPlayed,
    findPlayedRegressions, splitRegressions, formatRegressions,
} from '../data/csvIntegrity.js';

/** Reconstruct leaguedata.csv-style text from Supabase match rows, grouped by
 *  round with a "Player,..." header line per round (parseCSV*'s round-detection
 *  keys off any line starting with "player"), so downstream parseCSV/
 *  parseCSVWithRounds keep working unchanged on the reconstructed text. */
function matchesToCsvText(matches) {
    const byRound = new Map();
    for (const m of matches) {
        const r = m.round || 1;
        if (!byRound.has(r)) byRound.set(r, []);
        byRound.get(r).push(m);
    }
    const lines = [];
    for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        lines.push('Player,PR,Luck,Score,Player,PR,Luck,Score');
        for (const m of byRound.get(round)) {
            lines.push([m.playerA, m.prA, m.luckA, m.scoreA, m.playerB, m.prB, m.luckB, m.scoreB].join(','));
        }
    }
    return lines.join('\n');
}

/**
 * Read the league's current state (as CSV text + overrides) from Supabase.
 * Prefers staged (unpublished) content so the comparison reflects what the
 * admin is actually about to publish.
 */
async function readCurrentState(leagueId) {
    const enc = encodeURIComponent(leagueId);

    let csv = getStagedContent(`leagues/${enc}/leaguedata.csv`);
    if (csv == null) {
        try {
            const { matches } = await loadLeagueMatchesAll(leagueId);
            csv = matchesToCsvText(matches);
        } catch { /* brand-new league or offline — treat as empty */ }
    }

    let overrides = [];
    const ovText = getStagedContent(`leagues/${enc}/manual_overrides.json`);
    if (ovText != null) {
        try { overrides = JSON.parse(ovText).overrides || []; } catch { /* ignore */ }
    } else {
        try { overrides = await loadOverrides(leagueId); } catch { /* no overrides yet */ }
    }

    return { csv: csv || '', overrides };
}

/** Classic Levenshtein edit distance (used for typo detection). */
function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/**
 * Compute the import compatibility report.
 *
 * @param {string} leagueId — league folder name
 * @param {string} newCsvText — the uploaded CSV content
 * @returns {Promise<object>} structured report (see fields below)
 */
export async function computeCsvImportReport(leagueId, newCsvText) {
    const { csv: curCsv, overrides } = await readCurrentState(leagueId);

    // ── The two integrity layers (shared with scripts/sync-source.js) ────────
    // LAYER 1 — structure: roster / round count / rows-per-round / 8-column layout
    //   are fixed at league creation, so a deviation means this CSV isn't this
    //   league's. LAYER 2 — regression: a pairing that ALREADY has a result (from
    //   the data or a manual override) coming back unplayed means a stale/partial
    //   file. Neither blocks the import — the admin confirms explicitly instead.
    const curAllMatches = parseCSVAllWithRounds(curCsv).matches;
    const expectedShape = curAllMatches.length > 0 ? describeLeagueShape(curAllMatches) : null;
    const structure = validateCsvStructure(newCsvText, expectedShape);
    const previouslyPlayed = collectPlayed(curAllMatches, overrides);
    // real → results the CSV would genuinely erase (blocking).
    // overridden → matches whose only result is a manual override; the CSV is
    //   SUPPOSED to show those unplayed, so it's a warning, never a block.
    const { real: regressions, overridden: overriddenUnplayed } = splitRegressions(
        findPlayedRegressions(parseCSVAllWithRounds(newCsvText).matches, previouslyPlayed),
    );

    const curPlayers = getAllPlayersFromCSV(curCsv);
    const newPlayers = getAllPlayersFromCSV(newCsvText);

    const curPlayed = parseCSV(curCsv).length;   // parseCSV filters to PLAYED matches only
    const newPlayed = parseCSV(newCsvText).length;

    const added = [...newPlayers].filter(p => !curPlayers.has(p)).sort((a, b) => a.localeCompare(b));
    const dropped = [...curPlayers].filter(p => !newPlayers.has(p)).sort((a, b) => a.localeCompare(b));

    // Typo suspects: an "added" name that is 1–2 edits away from an existing roster
    // name is more likely a misspelling than a genuinely new player.
    const typos = [];
    for (const a of added) {
        let best = null, bestD = Infinity;
        for (const c of curPlayers) {
            const d = editDistance(a.toLowerCase(), c.toLowerCase());
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best && bestD > 0 && bestD <= 2 && Math.abs(a.length - best.length) <= 2) {
            typos.push({ name: a, suggestion: best, distance: bestD });
        }
    }

    // Overrides always win over the CSV (applyOverrides runs on top of the parsed
    // CSV). So the useful question isn't "are overrides kept" (always yes) — it's
    // "which of the CSV's results are shadowed by an override and won't apply".
    const overrideKeys = new Set(overrides.map(o => [o.playerA, o.playerB].sort().join('|')));
    const shadowed = [];
    for (const m of parseCSV(newCsvText)) {
        const k = [m.playerA, m.playerB].sort().join('|');
        if (overrideKeys.has(k)) shadowed.push(`${m.playerA} vs ${m.playerB}`);
    }

    // The "N updates": matches PLAYED in the uploaded CSV that were NOT already
    // played in the current published data and are NOT covered by an override.
    // This is what the F5 import-preview table shows (display-only — the staged
    // content is still the full uploaded CSV).
    const curPlayedKeys = new Set(parseCSV(curCsv).map(m => [m.playerA, m.playerB].sort().join('|')));
    const newMatches = parseCSVWithRounds(newCsvText).matches.filter(m => {
        const k = [m.playerA, m.playerB].sort().join('|');
        return !curPlayedKeys.has(k) && !overrideKeys.has(k);
    });

    const isNewLeague = curPlayers.size === 0 && curPlayed === 0;
    const playersMatch = added.length === 0 && dropped.length === 0;
    const regression = !isNewLeague && newPlayed < curPlayed;

    // Anything the admin must knowingly accept before this reaches Pending Changes.
    const structureMismatch = !isNewLeague && !structure.ok;
    const needsConfirm = structureMismatch || regressions.length > 0;

    return {
        isNewLeague,
        curPlayerCount: curPlayers.size,
        newPlayerCount: newPlayers.size,
        playersMatch,
        added,
        dropped,
        typos,
        curPlayed,
        newPlayed,
        playedDelta: newPlayed - curPlayed,
        overrideCount: overrides.length,
        shadowed,
        newMatches,
        regression,
        structureMismatch,
        structureErrors: structure.errors,
        structureInfo: structure.structure,
        regressions,
        overriddenUnplayed,
        needsConfirm
    };
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

function row(severity, label, value) {
    const color = severity === 'err' ? 'var(--color-danger, #c0392b)'
        : severity === 'warn' ? 'var(--color-warning, #b8860b)'
        : severity === 'ok' ? 'var(--color-success, #2e7d32)'
        : 'var(--color-text-muted)';
    const icon = severity === 'err' ? '⛔' : severity === 'warn' ? '⚠️' : severity === 'ok' ? '✅' : 'ℹ️';
    return `<div style="display:flex;gap:.5em;align-items:baseline;padding:.2em 0;color:${color}">
        <span aria-hidden="true">${icon}</span>
        <span><b>${esc(label)}</b>${value ? ` — ${value}` : ''}</span>
    </div>`;
}

/**
 * Render the report object into an HTML panel.
 */
export function renderCsvImportReport(report) {
    const r = report;
    let body = '';

    // LAYER 1 — a structural mismatch means the file isn't this league's. Say it
    // first, and spell out every reason: this is the one an admin must not skim.
    if (r.structureMismatch) {
        body += row('err', "This CSV doesn't match the league",
            'its shape differs from the league as it was created — importing it will replace the league with data that may not belong to it');
        for (const e of r.structureErrors) body += row('err', 'Mismatch', esc(e));
        body += `<hr style="border:none;border-top:1px solid var(--color-border);margin:.5em 0">`;
    }

    // LAYER 2a — REAL regression: played per the data, unplayed in this CSV. The
    // signature of a stale/partial export; importing as-is would erase those results.
    if (r.regressions && r.regressions.length) {
        body += row('err', `${r.regressions.length} already-played match${r.regressions.length > 1 ? 'es' : ''} would lose ${r.regressions.length > 1 ? 'their' : 'its'} result`,
            `${esc(formatRegressions(r.regressions))} — ${r.regressions.length > 1 ? 'these are' : 'this is'} played in the league now but unplayed in this CSV`);
        body += `<hr style="border:none;border-top:1px solid var(--color-border);margin:.5em 0">`;
    }

    // LAYER 2b — manual overrides. These have a result ONLY because an admin set
    // one; the source has never heard of them, so a CSV showing them unplayed is
    // correct, not data loss. The override wins on render regardless. Inform, don't
    // alarm — and never gate the import on it.
    if (r.overriddenUnplayed && r.overriddenUnplayed.length) {
        const n = r.overriddenUnplayed.length;
        body += row('warn', `${n} manually-overridden match${n > 1 ? 'es' : ''} ${n > 1 ? 'are' : 'is'} unplayed in this CSV`,
            `${esc(formatRegressions(r.overriddenUnplayed))} — expected: ${n > 1 ? 'their results were' : 'its result was'} entered manually, so the source doesn't have ${n > 1 ? 'them' : 'it'}. The manual ${n > 1 ? 'results win and are' : 'result wins and is'} kept.`);
    }

    if (r.isNewLeague) {
        body += row('info', 'New league', `no prior data — importing ${r.newPlayerCount} players, ${r.newPlayed} played matches`);
    } else {
        // --- Players ---
        if (r.playersMatch) {
            body += row('ok', 'Players match the league', `${r.newPlayerCount} players, identical roster`);
        } else {
            const countSev = r.newPlayerCount === r.curPlayerCount ? 'warn' : 'err';
            body += row(countSev, 'Player roster differs',
                `CSV has ${r.newPlayerCount} · league has ${r.curPlayerCount}`);
            if (r.added.length) {
                body += row('warn', `New in CSV (${r.added.length})`, esc(r.added.join(', ')));
            }
            if (r.dropped.length) {
                body += row('err', `Missing from CSV (${r.dropped.length})`, esc(r.dropped.join(', ')));
            }
        }
        // --- Typos ---
        for (const t of r.typos) {
            body += row('err', 'Possible typo',
                `"${esc(t.name)}" looks like "${esc(t.suggestion)}" (${t.distance} edit${t.distance > 1 ? 's' : ''})`);
        }
    }

    // --- Matches ---
    body += `<hr style="border:none;border-top:1px solid var(--color-border);margin:.5em 0">`;
    body += row('info', 'Matches played', `CSV: ${r.newPlayed}${r.isNewLeague ? '' : ` · league now: ${r.curPlayed}`}`);
    if (r.regression) {
        body += row('warn', 'Fewer matches than now',
            `CSV has ${Math.abs(r.playedDelta)} fewer played match${Math.abs(r.playedDelta) > 1 ? 'es' : ''} than the league currently has (${r.newPlayed} vs ${r.curPlayed}) — possible data loss`);
    }
    // Overrides: only worth mentioning when a CSV result actually collides with one
    // (the override wins, so that CSV value is silently ignored).
    if (r.shadowed && r.shadowed.length) {
        body += row('warn', `Overridden by manual overrides (${r.shadowed.length})`,
            `${esc(r.shadowed.join(', '))} — a manual override exists for ${r.shadowed.length > 1 ? 'these' : 'this'}, so the CSV result${r.shadowed.length > 1 ? 's' : ''} won't apply`);
    } else if (!r.isNewLeague && r.overrideCount > 0) {
        body += row('info', 'Manual overrides', `${r.overrideCount} — none collide with this CSV`);
    }

    const anyProblem = r.regression || (!r.isNewLeague && !r.playersMatch) || r.typos.length > 0 || (r.shadowed && r.shadowed.length > 0);
    const headerColor = r.needsConfirm ? 'var(--color-danger, #c0392b)'
        : anyProblem ? 'var(--color-warning, #b8860b)'
        : 'var(--color-success, #2e7d32)';
    const headerText = r.needsConfirm ? 'This import can damage the league'
        : anyProblem ? 'Review before continuing'
        : 'CSV is compatible';

    // needsConfirm: a deliberate acknowledgement is required before the upload may
    // reach Pending Changes. The import is never hard-blocked — the admin stays in
    // control — but it can't be accepted by reflex. The gate is a checkbox only:
    // it arms the page's EXISTING "Confirm & Stage" button (see wireCsvImportGate)
    // rather than adding a second, competing action button.
    const what = [
        r.structureMismatch ? "doesn't match the league" : null,
        r.regressions.length
            ? `will erase ${r.regressions.length} already-played result${r.regressions.length > 1 ? 's' : ''}`
            : null,
    ].filter(Boolean).join(' and ');

    const footer = r.needsConfirm
        ? `<label class="csv-import-gate">
               <input type="checkbox" id="csv-import-ack">
               <span>I understand this CSV ${esc(what)}, and I want to import it anyway.</span>
           </label>`
        : `<p style="margin:.6em 0 0 0;font-size:.85rem;color:var(--color-text-muted)">
               This is informational only — you can continue to Pending Changes.
           </p>`;

    return `
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-md);background:var(--color-surface, transparent)">
            <h3 style="margin:0 0 .4em 0;color:${headerColor}">${headerText}</h3>
            ${body}
            ${footer}
        </div>`;
}

/**
 * Arm/disarm the page's existing "Confirm & Stage" button from the report.
 *
 * Clean report → the button stays exactly as the page defines it. Risky report →
 * the button is disabled and restyled as a destructive action ("Import anyway"),
 * and only the acknowledgement checkbox can unlock it. Deliberately reuses the
 * page's own button and the project's `btn btn-*` classes (theme-aware) instead of
 * introducing a second action.
 *
 * @param {HTMLElement} reportEl — the element renderCsvImportReport() was put into
 * @param {object} report
 * @param {HTMLButtonElement} confirmBtn — the page's "Confirm & Stage" button
 */
export function wireCsvImportGate(reportEl, report, confirmBtn) {
    if (!confirmBtn) return;

    if (!report.needsConfirm) {
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('btn-danger');
        confirmBtn.classList.add('btn-success');
        confirmBtn.textContent = 'Confirm & Stage';
        confirmBtn.removeAttribute('title');
        return;
    }

    confirmBtn.disabled = true;
    confirmBtn.classList.remove('btn-success');
    confirmBtn.classList.add('btn-danger');
    confirmBtn.textContent = 'Import anyway';
    confirmBtn.title = 'Tick the acknowledgement above to enable this';

    const ack = reportEl && reportEl.querySelector('#csv-import-ack');
    if (ack) ack.addEventListener('change', () => { confirmBtn.disabled = !ack.checked; });
}
