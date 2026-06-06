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
import { parseCSV, parseCSVWithRounds, getAllPlayersFromCSV } from '../data/csvParser.js';

/**
 * Read the league's current CSV + overrides. Prefers staged (unpublished) content
 * so the comparison reflects what the admin is actually about to publish.
 */
async function readCurrentState(leagueId) {
    const enc = encodeURIComponent(leagueId);

    let csv = getStagedContent(`leagues/${enc}/leaguedata.csv`);
    if (csv == null) {
        try {
            const r = await fetch(`leagues/${enc}/leaguedata.csv`);
            if (r.ok) csv = await r.text();
        } catch { /* brand-new league or offline — treat as empty */ }
    }

    let ovText = getStagedContent(`leagues/${enc}/manual_overrides.json`);
    if (ovText == null) {
        try {
            const r = await fetch(`leagues/${enc}/manual_overrides.json`);
            if (r.ok) ovText = await r.text();
        } catch { /* no overrides file */ }
    }
    let overrides = [];
    if (ovText) {
        try { overrides = JSON.parse(ovText).overrides || []; } catch { /* ignore */ }
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
        regression
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
    const headerColor = anyProblem ? 'var(--color-warning, #b8860b)' : 'var(--color-success, #2e7d32)';
    const headerText = anyProblem ? 'Review before continuing' : 'CSV is compatible';

    return `
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-md);background:var(--color-surface, transparent)">
            <h3 style="margin:0 0 .4em 0;color:${headerColor}">${headerText}</h3>
            ${body}
            <p style="margin:.6em 0 0 0;font-size:.85rem;color:var(--color-text-muted)">
                This is informational only — you can continue to Pending Changes in any case.
            </p>
        </div>`;
}
