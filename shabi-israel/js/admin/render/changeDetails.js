/**
 * changeDetails.js — turn a raw DB row diff into plain-English prose for the
 * Historical Changes "Details" pane, across EVERY audited table.
 *
 * The pane used to print storage-language rows like:
 *   1. field: championship_titles, before: [], after: [{"type":"national",…}]
 * which reads as a database dump. Two entry points replace that:
 *
 *   • describeFieldChange(table, key, before, after) — one changed column of an
 *     UPDATE → one sentence, e.g. `Championship titles: added "2024 Belgium
 *     National Champion"`, `Match length: 5 → 7`, `Marked inactive`.
 *   • describeEntitySummary(table, action, oldVal, newVal) — an INSERT or DELETE
 *     of a whole row → one summary line (creates/deletes never enumerate every
 *     column), e.g. `New Doubling league — match length 5, issue date Apr 2026.`
 *
 * Six field patterns cover the whole vocabulary: Set / Cleared / Changed /
 * Toggle / Collection / Presence (see docs/… spec). Both entry points return
 * PLAIN TEXT — the caller escapes it. Unknown columns fall back to a prettified
 * label + readable value, never raw JSON.
 */

import { getBmabInfo, getChampionshipTooltip } from '../../data/titleConstants.js';
import { EXTRA_PRIZES_KEY, getExtraPrizeRows, countExtraPrizeRows } from '../../compute/prizeRows.js';

// Friendly labels for the DB columns that surface in an audit diff, per table.
// Anything not listed falls back to prettifyKey() ("source_league_name" → "Source league").
const FIELD_LABELS = {
    players_metadata: {
        id: 'Nickname', full_name: 'Full name', bmab_title: 'BMAB title',
        championship_titles: 'Championship titles', hidden: 'Site visibility',
        photo_path: 'Photo', inactive: 'Activity status', joined: 'Joined',
    },
    leagues: {
        id: 'League ID', title: 'Title', league_type: 'League type', running: 'Running',
        hidden: 'Visibility', gold_count: 'Gold places', silver_count: 'Silver places',
        bronze_count: 'Bronze places', match_length: 'Match length', issue_date: 'Issue date',
        entry_fee: 'Entry fee', prizes: 'Prizes', custom_flags: 'Custom flags',
        retired_players: 'Retired players', external_source_sync: 'Auto-sync',
        source_league_name: 'Source league', in_leaderboard: 'In leaderboard',
        duration_mode: 'Duration', duration_days: 'Duration in days',
    },
    matches: {
        round: 'Round', player_a: 'Player A', player_b: 'Player B',
        pr_a: 'PR (A)', pr_b: 'PR (B)', luck_a: 'Luck (A)', luck_b: 'Luck (B)',
        score_a: 'Score (A)', score_b: 'Score (B)', played: 'Played',
    },
    match_history: {
        round: 'Round', player_a: 'Player A', player_b: 'Player B',
        pr_a: 'PR (A)', pr_b: 'PR (B)', luck_a: 'Luck (A)', luck_b: 'Luck (B)',
        score_a: 'Score (A)', score_b: 'Score (B)', source: 'Source',
    },
    manual_overrides: {
        type: 'Override type', winner: 'Winner', reason: 'Reason',
        score_a: 'Score (A)', score_b: 'Score (B)', pr_a: 'PR (A)', pr_b: 'PR (B)',
        luck_a: 'Luck (A)', luck_b: 'Luck (B)', edited_at: 'Edited date',
    },
    landing_settings: {
        title: 'Title', subtitle: 'Subtitle', logo_path: 'Logo', display_order: 'League order',
        completed_custom_order: 'Completed Leagues order',
    },
};

// Human labels for the enum-like columns, so a value never shows as its raw token.
// Columns whose values are prose — quoted in changes so titles/reasons read as text.
const FREE_TEXT = {
    leagues: new Set(['title', 'source_league_name']),
    manual_overrides: new Set(['reason']),
    landing_settings: new Set(['title', 'subtitle']),
    players_metadata: new Set(['full_name']),
};
const isFreeText = (table, key) => !!(FREE_TEXT[table] && FREE_TEXT[table].has(key));

const LEAGUE_TYPE = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
// How long a league runs (sql/league_duration.sql). Phrased as the window it
// produces, not as the stored token: "Duration: the calendar month → no time limit".
const DURATION_MODE = {
    month: 'the calendar month',
    days: 'a fixed number of days',
    unlimited: 'no time limit',
};
const OVERRIDE_TYPE = {
    result: 'Result', technical_win: 'Technical win',
    technical_draw: 'Technical draw', not_played: 'Not played',
};
const SOURCE = { csv: 'CSV', manual: 'Manual' };

function prettifyKey(key) {
    const s = String(key).replace(/_/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function labelFor(table, key) {
    return (FIELD_LABELS[table] && FIELD_LABELS[table][key]) || prettifyKey(key);
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

const isEmpty = (v) =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const asArray = (v) => (Array.isArray(v) ? v : []);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v == null || (typeof v !== 'object');
const truthy = (v) => v === true || v === 'true';

function bmabLabel(code) {
    if (!code) return null;
    const info = getBmabInfo(code);
    return info ? info.label : code;
}
// Map an enum-ish column value to its display label (else null → default fmt).
function mapValue(table, key, v) {
    if (isEmpty(v)) return null;
    if (table === 'leagues' && key === 'league_type') return LEAGUE_TYPE[v] || cap(v);
    if (table === 'leagues' && key === 'duration_mode') return DURATION_MODE[v] || cap(v);
    if (table === 'manual_overrides' && key === 'type') return OVERRIDE_TYPE[v] || cap(v);
    if ((table === 'matches' || table === 'match_history') && key === 'source') return SOURCE[v] || cap(v);
    if (table === 'players_metadata' && key === 'bmab_title') return bmabLabel(v);
    return null;
}
function scoreStr(v) {
    if (v == null) return null;
    if (v.score_a == null || v.score_b == null) return null;
    return `${v.score_a}–${v.score_b}`; // en-dash
}

// ============================================================================
//  UPDATE — one changed column → one sentence
// ============================================================================
export function describeFieldChange(table, key, before, after) {
    const label = labelFor(table, key);

    if (table === 'players_metadata') {
        if (key === 'championship_titles') return describeChampionships(before, after);
        if (key === 'bmab_title')          return describeBmab(before, after);
        if (key === 'hidden')              return truthy(after) ? 'Hidden from the site' : 'Made visible on the site';
        if (key === 'inactive')            return truthy(after) ? 'Marked inactive' : 'Marked active';
        if (key === 'photo_path')          return describePresence('Photo', before, after);
    }
    if (table === 'leagues') {
        if (key === 'running')              return truthy(after) ? 'League set to running' : 'League set to not running';
        if (key === 'hidden')               return truthy(after) ? 'League hidden from the site' : 'League made visible';
        if (key === 'custom_flags')         return describeMap(label, before, after);
        if (key === 'retired_players')      return describeStringArray(label, before, after);
        if (key === 'prizes')               return describePrizes(label, before, after);
        if (key === 'external_source_sync') return describeAutoSync(before, after);
    }
    if ((table === 'matches' || table === 'match_history') && key === 'played') {
        return truthy(after) ? 'Match marked as played' : 'Match marked as not played';
    }
    if (table === 'landing_settings' && key === 'display_order') {
        return 'League order rearranged';
    }
    if (table === 'landing_settings' && key === 'completed_custom_order') {
        // Reads as what the visitor will see, not as a column flipping value.
        return truthy(after)
            ? 'Completed Leagues now use the hand-made order'
            : 'Completed Leagues sorted by date again';
    }

    // Enum-ish scalar with a friendly value label (never quoted — it's a token).
    const mb = mapValue(table, key, before), ma = mapValue(table, key, after);
    if (mb !== null || ma !== null) return describeScalar(label, mb ?? fmtScalar(before), ma ?? fmtScalar(after));

    if (isStringArray(before) || isStringArray(after)) return describeStringArray(label, before, after);
    if (isPlainObject(before) || isPlainObject(after)) return describeMap(label, before, after);
    return describeScalar(label, fmtScalar(before), fmtScalar(after), isFreeText(table, key));
}

// ============================================================================
//  INSERT / DELETE — a whole row → one summary line
// ============================================================================
export function describeEntitySummary(table, action, oldVal, newVal) {
    const v = (action === 'DELETE' ? oldVal : newVal) || {};

    if (action === 'INSERT') {
        switch (table) {
            case 'players_metadata': {
                const parts = [];
                if (v.full_name) parts.push(v.full_name);
                if (v.bmab_title) parts.push(bmabLabel(v.bmab_title));
                for (const t of asArray(v.championship_titles)) parts.push(getChampionshipTooltip(t));
                return parts.length ? `New player — ${parts.join(', ')}.` : 'Added as a new player.';
            }
            case 'leagues': {
                const type = v.league_type ? `${LEAGUE_TYPE[v.league_type] || cap(v.league_type)} league` : 'League';
                const bits = [];
                if (v.match_length) bits.push(`match length ${v.match_length}`);
                if (v.issue_date) bits.push(`issue date ${v.issue_date}`);
                // How long it runs is part of what the league IS, so it belongs
                // in the one-line summary rather than only in a later diff.
                if (v.duration_mode === 'days' && v.duration_days) bits.push(`runs ${v.duration_days} days`);
                else if (v.duration_mode === 'month') bits.push('runs to the end of the calendar month');
                else if (v.duration_mode === 'unlimited') bits.push('runs with no time limit');
                return bits.length ? `New ${type} — ${bits.join(', ')}.` : `New ${type} created.`;
            }
            case 'matches':       { const s = scoreStr(v); return s ? `Result ${s} added.` : 'Match added.'; }
            case 'match_history': { const s = scoreStr(v); return s ? `History recorded (${s}).` : 'History entry recorded.'; }
            case 'manual_overrides': {
                const t = OVERRIDE_TYPE[v.type] || cap(v.type) || 'Override';
                return v.winner ? `${t} for ${v.winner}.` : `${t}.`;
            }
            case 'landing_settings': return 'Landing settings created.';
            default: return `${cap(prettifyKey(table))} created.`;
        }
    }

    // DELETE
    switch (table) {
        case 'players_metadata': return 'Player removed.';
        case 'leagues':          return 'League removed, along with its matches, overrides and history.';
        case 'matches':          { const s = scoreStr(v); return s ? `Match removed (was ${s}).` : 'Match removed.'; }
        case 'match_history':    return 'History entry removed.';
        case 'manual_overrides': {
            const t = OVERRIDE_TYPE[v.type] || cap(v.type) || 'override';
            const who = v.winner ? ` for ${v.winner}` : '';
            return `Override removed (was a ${t}${who}). The natural result applies again.`;
        }
        case 'landing_settings': return 'Landing settings removed.';
        default: return `${cap(prettifyKey(table))} removed.`;
    }
}

// ============================================================================
//  Field describers (the six patterns)
// ============================================================================

// A stable identity for a championship title, so a re-order isn't read as churn.
function champKey(t) {
    return [t.type || '', t.year || '', t.country || '', t.location || '', t.doubles ? 'd' : ''].join('|');
}
function describeChampionships(before, after) {
    const b = asArray(before), a = asArray(after);
    const bKeys = new Set(b.map(champKey));
    const aKeys = new Set(a.map(champKey));
    const parts = [];
    for (const t of a) if (!bKeys.has(champKey(t))) parts.push(`added "${getChampionshipTooltip(t)}"`);
    for (const t of b) if (!aKeys.has(champKey(t))) parts.push(`removed "${getChampionshipTooltip(t)}"`);
    return parts.length ? `Championship titles: ${parts.join('; ')}` : 'Championship titles updated';
}

function describeBmab(before, after) {
    const b = bmabLabel(before), a = bmabLabel(after);
    if (!b && a) return `BMAB title set to ${a}`;
    if (b && !a) return `BMAB title removed (was ${b})`;
    if (b && a) return `BMAB title: ${b} → ${a}`;
    return 'BMAB title updated';
}

// Auto-sync (leagues.external_source_sync jsonb). Lead with the on/off toggle
// when `enabled` flips; otherwise fall through to a generic key-level diff.
function describeAutoSync(before, after) {
    const b = isPlainObject(before) ? before : {};
    const a = isPlainObject(after) ? after : {};
    const bOn = truthy(b.enabled), aOn = truthy(a.enabled);
    if (('enabled' in b || 'enabled' in a) && bOn !== aOn) {
        return aOn ? 'Auto-sync turned on' : 'Auto-sync turned off';
    }
    return describeMap('Auto-sync', before, after);
}

function describePresence(label, before, after) {
    if (isEmpty(before) && !isEmpty(after)) return `${label} added`;
    if (!isEmpty(before) && isEmpty(after)) return `${label} removed`;
    return `${label} replaced`;
}

function describeStringArray(label, before, after) {
    const b = asArray(before), a = asArray(after);
    const bSet = new Set(b), aSet = new Set(a);
    const added = a.filter((x) => !bSet.has(x));
    const removed = b.filter((x) => !aSet.has(x));
    const parts = [];
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    return parts.length ? `${label}: ${parts.join('; ')}` : `${label} updated`;
}

/**
 * Prizes is a money map (Gold/Silver/Bronze) that also carries the per-medal
 * EXTRA prize rows under `Extra` (see js/compute/prizeRows.js). Feeding the
 * whole thing to describeMap would report the interesting half as an opaque
 * "changed Extra", so the two are diffed separately and the row count is
 * spelled out.
 */
function describePrizes(label, before, after) {
    const strip = (v) => {
        const o = isPlainObject(v) ? { ...v } : {};
        delete o[EXTRA_PRIZES_KEY];
        return o;
    };
    const nBefore = countExtraPrizeRows(before), nAfter = countExtraPrizeRows(after);
    const money = JSON.stringify(strip(before)) !== JSON.stringify(strip(after))
        ? describeMap(label, strip(before), strip(after))
        : null;
    const extraChanged = JSON.stringify(getExtraPrizeRows(before)) !== JSON.stringify(getExtraPrizeRows(after));
    if (!extraChanged) return money || `${label} updated`;
    const rows = nBefore === nAfter
        ? `extra prize rows edited (${nAfter})`
        : `extra prize rows ${nBefore} → ${nAfter}`;
    return money ? `${money}; ${rows}` : `${label}: ${rows}`;
}

// Object/map diff: added / changed / removed keys. Scalar values are shown
// inline — added `Dana (US)`, changed `Ori (IL → FR)` — objects stay by key only.
function describeMap(label, before, after) {
    const b = isPlainObject(before) ? before : {};
    const a = isPlainObject(after) ? after : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const added = [], removed = [], changed = [];
    for (const k of keys) {
        const inB = k in b, inA = k in a;
        if (inA && !inB) added.push(isScalar(a[k]) && !isEmpty(a[k]) ? `${k} (${a[k]})` : k);
        else if (inB && !inA) removed.push(k);
        else if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
            changed.push(isScalar(b[k]) && isScalar(a[k]) ? `${k} (${fmtScalar(b[k])} → ${fmtScalar(a[k])})` : k);
        }
    }
    const parts = [];
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (changed.length) parts.push(`changed ${changed.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    return parts.length ? `${label}: ${parts.join('; ')}` : `${label} updated`;
}

function fmtScalar(v) {
    if (isEmpty(v)) return null;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
}
// `quote` wraps free-text values in curly quotes (titles, reasons, names).
function describeScalar(label, before, after, quote = false) {
    const q = (x) => (x == null ? null : (quote ? `“${x}”` : String(x)));
    const b = q(before), a = q(after);
    if (b == null && a != null) return `${label} set to ${a}`;
    if (b != null && a == null) return `${label} cleared (was ${b})`;
    return `${label}: ${b} → ${a}`;
}
