/**
 * supabaseAdmin.js — Admin write path. Replaces githubApi.js as the
 * destination for everything staged by leagueManager.js/playerManager.js/
 * roundEditor.js/csvEditor.js/excelImporter.js/overridesList.js.
 *
 * These callers still stage plain {type, path, content, binary, description}
 * objects into stagingStore.js exactly as before (the staging/review UX is
 * unchanged) — only stagingStore.js's publishAll() changed, to interpret
 * `path` and dispatch to the functions here instead of PUT/DELETE-ing files
 * on GitHub. Every staged path already carries the FULL current content for
 * whatever it represents (e.g. leaguedata.csv is always the whole league's
 * CSV, players_metadata.json is always the whole registry) — including for
 * global player renames, where the client already rewrote every affected
 * file's text before staging. So each function here is a straightforward
 * "sync this whole table/row to match this content", not a diff/patch.
 */

import { supabase } from '../data/supabaseClient.js';
import { parseCSVAllWithRounds } from '../data/csvParser.js';
import { computeMatchHistoryReconcile } from '../data/matchHistoryReconcile.js';

function b64ToUint8Array(base64) {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Postgres `numeric` round-trips through PostgREST as a string; the parsed CSV
// / staged JSON carry JS numbers. A strict === would read "0" !== 0 as a change.
function numEq(x, y) {
    if (x === null || x === undefined) return y === null || y === undefined;
    if (y === null || y === undefined) return false;
    return Number(x) === Number(y);
}

// Row-equality checks so the *sync functions below only UPSERT rows that
// actually changed. Upserting an unchanged row still runs ON CONFLICT DO UPDATE,
// which fires the updated_at + audit triggers on every row of the league — the
// root cause of the "one edit → hundreds of ghost history rows" fan-out.
function sameMatchRow(row, m) {
    return numEq(row.pr_a, m.prA) && numEq(row.luck_a, m.luckA) && numEq(row.score_a, m.scoreA)
        && numEq(row.pr_b, m.prB) && numEq(row.luck_b, m.luckB) && numEq(row.score_b, m.scoreB)
        && row.played === m.played;
}

// Compare two timestamps as instants, not strings — a timestamptz round-trips
// from Postgres in a different textual shape than the ISO string the client
// staged, so a string === would report every unchanged override as "changed".
function sameInstant(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return new Date(a).getTime() === new Date(b).getTime();
}

function sameOverrideRow(row, o) {
    return row.type === o.type
        && (row.winner || null) === (o.winner || null)
        && numEq(row.score_a, o.scoreA) && numEq(row.score_b, o.scoreB)
        && numEq(row.pr_a, o.prA) && numEq(row.pr_b, o.prB)
        && numEq(row.luck_a, o.luckA) && numEq(row.luck_b, o.luckB)
        && (row.reason || null) === (o.reason || null)
        && sameInstant(row.edited_at, o.timestamp);
}

function samePlayerRow(row, m) {
    return (row.full_name || null) === (m.fullName || null)
        && (row.bmab_title || null) === (m.bmabTitle || null)
        && JSON.stringify(row.championship_titles || []) === JSON.stringify(m.championshipTitles || [])
        && row.hidden === (m.hidden === true)
        && (row.photo_path || null) === (m.photoPath || null)
        && row.inactive === (m.inactive === true)
        && (row.joined || null) === (m.joined || null);
}

function mapParamsToLeagueRow(leagueId, p) {
    return {
        id: leagueId,
        title: p.LeagueTitle || leagueId,
        league_type: p.LeagueType || 'doubling',
        running: p.Running === true,
        hidden: p.Hidden === true,
        gold_count: p.GoldCount ?? 1,
        silver_count: p.SilverCount ?? 1,
        bronze_count: p.BronzeCount ?? 4,
        match_length: p.MatchLength ?? null,
        issue_date: p.IssueDate || null,
        entry_fee: p.EntryFee ?? 0,
        prizes: p.Prizes || { Gold: 0, Silver: 0, Bronze: 0 },
        custom_flags: p.CustomFlags || {},
        retired_players: p.RetiredPlayers || [],
        external_source_sync: p.ExternalSourceSync || null,
        last_updated: p.LastUpdated || null,
    };
}

/** Create or update a league's params row. */
export async function upsertLeague(leagueId, params) {
    const { error } = await supabase.from('leagues').upsert(mapParamsToLeagueRow(leagueId, params));
    if (error) throw new Error(`upsertLeague failed for ${leagueId}: ${error.message}`);
}

/** Delete a league. Cascades to matches/manual_overrides/match_history/league_snapshots via FK. */
export async function deleteLeague(leagueId) {
    const { error } = await supabase.from('leagues').delete().eq('id', leagueId);
    if (error) throw new Error(`deleteLeague failed for ${leagueId}: ${error.message}`);
}

/** Sync a league's full matches table to match this CSV text (delete-stale + upsert ONLY changed rows). */
export async function bulkImportCSV(leagueId, csvText) {
    const { matches } = parseCSVAllWithRounds(csvText);

    const { data: existing, error: fetchErr } = await supabase
        .from('matches')
        .select('id, round, player_a, player_b, pr_a, luck_a, score_a, pr_b, luck_b, score_b, played')
        .eq('league_id', leagueId);
    if (fetchErr) throw new Error(`bulkImportCSV fetch failed for ${leagueId}: ${fetchErr.message}`);

    const keyOf = (round, a, b) => `${round}|${a}|${b}`;
    const existingByKey = new Map((existing || []).map((row) => [keyOf(row.round, row.player_a, row.player_b), row]));
    const freshKeys = new Set(matches.map((m) => keyOf(m.round, m.playerA, m.playerB)));

    const staleIds = (existing || [])
        .filter((row) => !freshKeys.has(keyOf(row.round, row.player_a, row.player_b)))
        .map((row) => row.id);
    if (staleIds.length > 0) {
        const { error } = await supabase.from('matches').delete().in('id', staleIds);
        if (error) throw new Error(`bulkImportCSV stale-delete failed for ${leagueId}: ${error.message}`);
    }

    // Only new or genuinely-changed matches — never re-write the untouched ones.
    const changed = matches.filter((m) => {
        const cur = existingByKey.get(keyOf(m.round, m.playerA, m.playerB));
        return !cur || !sameMatchRow(cur, m);
    });
    if (changed.length === 0) return;
    const rows = changed.map((m) => ({
        league_id: leagueId,
        round: m.round,
        player_a: m.playerA,
        player_b: m.playerB,
        pr_a: m.prA,
        luck_a: m.luckA,
        score_a: m.scoreA,
        pr_b: m.prB,
        luck_b: m.luckB,
        score_b: m.scoreB,
        played: m.played,
    }));
    const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'league_id,round,player_a,player_b' });
    if (error) throw new Error(`bulkImportCSV upsert failed for ${leagueId}: ${error.message}`);
}

/** Sync a league's full manual_overrides table to match this overrides array. */
export async function syncOverrides(leagueId, overrides) {
    const { data: existing, error: fetchErr } = await supabase
        .from('manual_overrides')
        .select('id, player_a, player_b, type, winner, score_a, score_b, pr_a, pr_b, luck_a, luck_b, reason, edited_at')
        .eq('league_id', leagueId);
    if (fetchErr) throw new Error(`syncOverrides fetch failed for ${leagueId}: ${fetchErr.message}`);

    const keyOf = (a, b) => `${a}|${b}`;
    const existingByKey = new Map((existing || []).map((row) => [keyOf(row.player_a, row.player_b), row]));
    const freshKeys = new Set(overrides.map((o) => keyOf(o.playerA, o.playerB)));
    const staleIds = (existing || [])
        .filter((row) => !freshKeys.has(keyOf(row.player_a, row.player_b)))
        .map((row) => row.id);
    if (staleIds.length > 0) {
        const { error } = await supabase.from('manual_overrides').delete().in('id', staleIds);
        if (error) throw new Error(`syncOverrides stale-delete failed for ${leagueId}: ${error.message}`);
    }

    // Only new or genuinely-changed overrides — leave untouched ones alone.
    const changed = overrides.filter((o) => {
        const cur = existingByKey.get(keyOf(o.playerA, o.playerB));
        return !cur || !sameOverrideRow(cur, o);
    });
    if (changed.length === 0) return;
    const rows = changed.map((o) => ({
        league_id: leagueId,
        player_a: o.playerA,
        player_b: o.playerB,
        type: o.type,
        winner: o.winner || null,
        score_a: o.scoreA ?? null,
        score_b: o.scoreB ?? null,
        pr_a: o.prA ?? null,
        pr_b: o.prB ?? null,
        luck_a: o.luckA ?? null,
        luck_b: o.luckB ?? null,
        reason: o.reason || null,
        // The admin-authored edit date (round editor's date picker → staged JSON
        // `timestamp`). Persisted so match_history's updated_at can reflect WHEN
        // the result actually changed, not when a sync last ran over it.
        edited_at: o.timestamp || null,
    }));
    const { error } = await supabase.from('manual_overrides').upsert(rows, { onConflict: 'league_id,player_a,player_b' });
    if (error) throw new Error(`syncOverrides upsert failed for ${leagueId}: ${error.message}`);
}

/** Sync the whole players_metadata table to match this {[nickname]: {...}} object. */
export async function syncPlayersMetadata(metadataObj) {
    const { data: existing, error: fetchErr } = await supabase
        .from('players_metadata')
        .select('id, full_name, bmab_title, championship_titles, hidden, photo_path, inactive, joined');
    if (fetchErr) throw new Error(`syncPlayersMetadata fetch failed: ${fetchErr.message}`);

    const existingById = new Map((existing || []).map((row) => [row.id, row]));
    const freshIds = new Set(Object.keys(metadataObj));
    const staleIds = (existing || []).map((row) => row.id).filter((id) => !freshIds.has(id));
    if (staleIds.length > 0) {
        const { error } = await supabase.from('players_metadata').delete().in('id', staleIds);
        if (error) throw new Error(`syncPlayersMetadata stale-delete failed: ${error.message}`);
    }

    // Only new or genuinely-changed players — don't re-write the whole registry
    // when a single player is edited.
    const rows = Object.entries(metadataObj)
        .filter(([id, m]) => {
            const cur = existingById.get(id);
            return !cur || !samePlayerRow(cur, m);
        })
        .map(([id, m]) => ({
            id,
            full_name: m.fullName || null,
            bmab_title: m.bmabTitle || null,
            championship_titles: m.championshipTitles || [],
            hidden: m.hidden === true,
            photo_path: m.photoPath || null,
            inactive: m.inactive === true,
            joined: m.joined || null,
        }));
    if (rows.length === 0) return;
    const { error } = await supabase.from('players_metadata').upsert(rows);
    if (error) throw new Error(`syncPlayersMetadata upsert failed: ${error.message}`);
}

/** Update landing_settings (title/subtitle/logo stay pass-through fallback fields; DisplayOrder is the only field any UI actually edits today). */
export async function updateLandingSettings({ title, subtitle, logoPath, DisplayOrder }) {
    const { error } = await supabase.from('landing_settings').upsert({
        id: 1,
        title: title || 'Shabi Israel',
        subtitle: subtitle || null,
        logo_path: logoPath || null,
        display_order: DisplayOrder || [],
    });
    if (error) throw new Error(`updateLandingSettings failed: ${error.message}`);
}

/**
 * Mirror leagues/sync_settings.json into the plan-scheduler tables the pg_cron
 * check reads (see sql/external_source_scheduler.sql):
 *   • sync_plans           — one row per named plan
 *   • sync_plan_members    — plan ↔ league membership
 *   • leagues.source_league_name — per-league source-site search name
 * The file is always the WHOLE current state, so this is a full reconcile:
 * upsert what's present, delete what's gone. `sourceNames` is authoritative for
 * every league — a league absent from the map has its name cleared (which also
 * removes it from any plan on the next scheduled tick).
 */
export async function updateSyncSettings(payload) {
    try {
        return await _updateSyncSettings(payload);
    } catch (err) {
        // The whole feature depends on sql/external_source_scheduler.sql having been
        // run. Turn PostgREST's cryptic "schema cache" / missing-column errors into
        // one actionable line so the site owner knows exactly what to do.
        const m = (err && err.message) || '';
        if (/schema cache|could not find the table|could not find the .*column|does not exist|relation .* does not exist/i.test(m)) {
            throw new Error('Sync tables are not set up yet — run sql/external_source_scheduler.sql in Supabase (SQL Editor) once, then Publish again.');
        }
        throw err;
    }
}

async function _updateSyncSettings({ plans = [], sourceNames = {} }) {
    // 1. Plans — upsert present, delete absent.
    const planRows = plans.map((p) => ({
        id: p.id,
        name: p.name || p.id,
        enabled: p.enabled !== false,
        mode: p.mode === 'fast' ? 'fast' : 'full',
        times: Array.isArray(p.times) ? p.times : [],
        jitter_minutes: p.jitterMinutes ?? 60,
        start_date: p.startDate || null,
        end_date: p.endDate || null,
        updated_at: new Date().toISOString(),
    }));
    if (planRows.length) {
        const { error } = await supabase.from('sync_plans').upsert(planRows);
        if (error) throw new Error(`updateSyncSettings: sync_plans upsert failed: ${error.message}`);
    }
    const keepIds = plans.map((p) => p.id);
    {
        // Delete plans no longer in the file (cascades to sync_plan_members).
        const del = supabase.from('sync_plans').delete();
        const { error } = keepIds.length
            ? await del.not('id', 'in', `(${keepIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`)
            : await del.neq('id', '__no_rows__'); // no plans kept → delete all
        if (error) throw new Error(`updateSyncSettings: stale sync_plans delete failed: ${error.message}`);
    }

    // 2. Membership — replace each plan's members wholesale.
    for (const p of plans) {
        const { error: delErr } = await supabase.from('sync_plan_members').delete().eq('plan_id', p.id);
        if (delErr) throw new Error(`updateSyncSettings: member clear failed for ${p.id}: ${delErr.message}`);
        const members = Array.isArray(p.leagues) ? [...new Set(p.leagues)] : [];
        if (members.length) {
            const rows = members.map((league_id) => ({ plan_id: p.id, league_id }));
            const { error: insErr } = await supabase.from('sync_plan_members').insert(rows);
            if (insErr) throw new Error(`updateSyncSettings: member insert failed for ${p.id}: ${insErr.message}`);
        }
    }

    // 3. Per-league source name — faithful mirror across ALL leagues, but only
    // WRITE the ones whose value actually changed. A blanket update of every
    // league fires the audit/updated_at triggers on each row, so a single-league
    // sync-name edit used to leave a flock of no-op "ghost" rows across all the
    // others (see sql/audit_batching.sql).
    const { data: leagueRows, error: lErr } = await supabase.from('leagues').select('id, source_league_name');
    if (lErr) throw new Error(`updateSyncSettings: leagues fetch failed: ${lErr.message}`);
    for (const row of leagueRows || []) {
        const name = sourceNames[row.id] || null;
        if ((row.source_league_name || null) === name) continue; // unchanged → don't touch
        const { error } = await supabase.from('leagues').update({ source_league_name: name }).eq('id', row.id);
        if (error) throw new Error(`updateSyncSettings: source name update failed for ${row.id}: ${error.message}`);
    }
}

/** Upload a flag PNG (base64 content, as staged) to the public `flags` bucket. */
export async function uploadFlagAsset(code, base64Content) {
    const { error } = await supabase.storage.from('flags').upload(`${code}.png`, b64ToUint8Array(base64Content), {
        contentType: 'image/png',
        upsert: true,
    });
    if (error) throw new Error(`uploadFlagAsset failed for ${code}: ${error.message}`);
}

/** Upload a player photo (base64 content, as staged) to the public `player-photos` bucket. */
export async function uploadPlayerPhoto(filename, base64Content) {
    const ext = (filename.match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
    const { error } = await supabase.storage.from('player-photos').upload(filename, b64ToUint8Array(base64Content), {
        contentType,
        upsert: true,
    });
    if (error) throw new Error(`uploadPlayerPhoto failed for ${filename}: ${error.message}`);
}

/** Remove a player photo from the `player-photos` bucket. */
export async function deletePlayerPhoto(filename) {
    const { error } = await supabase.storage.from('player-photos').remove([filename]);
    if (error) throw new Error(`deletePlayerPhoto failed for ${filename}: ${error.message}`);
}

/**
 * Snapshot a league's current state (mirrors the old saveSnapshot()) and bump
 * leagues.last_updated. Reads current matches+overrides from Supabase itself
 * (now the source of truth), not from any file.
 */
export async function createSnapshot(leagueId) {
    const { data: matches } = await supabase
        .from('matches')
        .select('round, player_a, player_b, pr_a, luck_a, score_a, pr_b, luck_b, score_b, played')
        .eq('league_id', leagueId)
        .order('round', { ascending: true });
    const { data: overridesRows } = await supabase.from('manual_overrides').select('*').eq('league_id', leagueId);

    const csvContent = (matches || [])
        .map((m) => [m.player_a, m.pr_a, m.luck_a, m.score_a, m.player_b, m.pr_b, m.luck_b, m.score_b].join(','))
        .join('\n');
    const overrides = (overridesRows || []).map((o) => ({
        type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
        scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
        reason: o.reason,
    }));

    const { error: snapErr } = await supabase.from('league_snapshots').insert({
        league_id: leagueId,
        csv_content: csvContent,
        overrides,
    });
    if (snapErr) throw new Error(`createSnapshot failed for ${leagueId}: ${snapErr.message}`);

    const { error: updErr } = await supabase.from('leagues').update({ last_updated: new Date().toISOString() }).eq('id', leagueId);
    if (updErr) throw new Error(`createSnapshot last_updated bump failed for ${leagueId}: ${updErr.message}`);
}

/**
 * Reconcile match_history for a league (mirrors the old updateMatchHistory()),
 * reading matches + overrides from Supabase instead of GitHub files.
 */
export async function reconcileMatchHistory(leagueId) {
    const { data: matchRows } = await supabase
        .from('matches')
        .select('*')
        .eq('league_id', leagueId)
        .eq('played', true)
        .order('round', { ascending: true });
    const { data: overrideRows } = await supabase.from('manual_overrides').select('*').eq('league_id', leagueId);
    const { data: historyRows } = await supabase.from('match_history').select('*').eq('league_id', leagueId);

    const { skipped, staleIds, upsertRows } = computeMatchHistoryReconcile({
        matchRows, overrideRows, historyRows, leagueId, now: new Date().toISOString(),
    });
    if (skipped) return;

    if (staleIds.length > 0) {
        const { error } = await supabase.from('match_history').delete().in('id', staleIds);
        if (error) throw new Error(`reconcileMatchHistory stale-delete failed for ${leagueId}: ${error.message}`);
    }
    if (upsertRows.length > 0) {
        const { error } = await supabase.from('match_history').upsert(upsertRows, { onConflict: 'league_id,player_a,player_b' });
        if (error) throw new Error(`reconcileMatchHistory upsert failed for ${leagueId}: ${error.message}`);
    }
}
