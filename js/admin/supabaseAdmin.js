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
import { matchKey } from '../compute/matchHistory.js';

function b64ToUint8Array(base64) {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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

/** Sync a league's full matches table to match this CSV text (delete-stale + upsert). */
export async function bulkImportCSV(leagueId, csvText) {
    const { matches } = parseCSVAllWithRounds(csvText);

    const { data: existing, error: fetchErr } = await supabase
        .from('matches')
        .select('id, round, player_a, player_b')
        .eq('league_id', leagueId);
    if (fetchErr) throw new Error(`bulkImportCSV fetch failed for ${leagueId}: ${fetchErr.message}`);

    const freshKeys = new Set(matches.map((m) => `${m.round}|${m.playerA}|${m.playerB}`));
    const staleIds = (existing || [])
        .filter((row) => !freshKeys.has(`${row.round}|${row.player_a}|${row.player_b}`))
        .map((row) => row.id);
    if (staleIds.length > 0) {
        const { error } = await supabase.from('matches').delete().in('id', staleIds);
        if (error) throw new Error(`bulkImportCSV stale-delete failed for ${leagueId}: ${error.message}`);
    }

    if (matches.length === 0) return;
    const rows = matches.map((m) => ({
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
        .select('id, player_a, player_b')
        .eq('league_id', leagueId);
    if (fetchErr) throw new Error(`syncOverrides fetch failed for ${leagueId}: ${fetchErr.message}`);

    const freshKeys = new Set(overrides.map((o) => `${o.playerA}|${o.playerB}`));
    const staleIds = (existing || [])
        .filter((row) => !freshKeys.has(`${row.player_a}|${row.player_b}`))
        .map((row) => row.id);
    if (staleIds.length > 0) {
        const { error } = await supabase.from('manual_overrides').delete().in('id', staleIds);
        if (error) throw new Error(`syncOverrides stale-delete failed for ${leagueId}: ${error.message}`);
    }

    if (overrides.length === 0) return;
    const rows = overrides.map((o) => ({
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
    }));
    const { error } = await supabase.from('manual_overrides').upsert(rows, { onConflict: 'league_id,player_a,player_b' });
    if (error) throw new Error(`syncOverrides upsert failed for ${leagueId}: ${error.message}`);
}

/** Sync the whole players_metadata table to match this {[nickname]: {...}} object. */
export async function syncPlayersMetadata(metadataObj) {
    const { data: existing, error: fetchErr } = await supabase.from('players_metadata').select('id');
    if (fetchErr) throw new Error(`syncPlayersMetadata fetch failed: ${fetchErr.message}`);

    const freshIds = new Set(Object.keys(metadataObj));
    const staleIds = (existing || []).map((row) => row.id).filter((id) => !freshIds.has(id));
    if (staleIds.length > 0) {
        const { error } = await supabase.from('players_metadata').delete().in('id', staleIds);
        if (error) throw new Error(`syncPlayersMetadata stale-delete failed: ${error.message}`);
    }

    const rows = Object.entries(metadataObj).map(([id, m]) => ({
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
    const now = new Date().toISOString();

    const { data: matchRows } = await supabase
        .from('matches')
        .select('*')
        .eq('league_id', leagueId)
        .eq('played', true)
        .order('round', { ascending: true });
    const { data: overrideRows } = await supabase.from('manual_overrides').select('*').eq('league_id', leagueId);
    const { data: historyRows } = await supabase.from('match_history').select('*').eq('league_id', leagueId);

    const csvMatches = (matchRows || []).map((m) => ({
        playerA: m.player_a, playerB: m.player_b,
        scoreA: m.score_a, scoreB: m.score_b, prA: m.pr_a, prB: m.pr_b, luckA: m.luck_a, luckB: m.luck_b,
        round: m.round,
    }));
    const overrides = (overrideRows || []).map((o) => ({
        type: o.type, playerA: o.player_a, playerB: o.player_b, winner: o.winner,
        scoreA: o.score_a, scoreB: o.score_b, prA: o.pr_a, prB: o.pr_b, luckA: o.luck_a, luckB: o.luck_b,
    }));
    const previous = (historyRows || []).map((h) => ({
        playerA: h.player_a, playerB: h.player_b,
        scoreA: h.score_a, scoreB: h.score_b, prA: h.pr_a, prB: h.pr_b, luckA: h.luck_a, luckB: h.luck_b,
        round: h.round, updatedAt: h.updated_at, source: h.source,
    }));
    const prevByKey = new Map(previous.map((m) => [matchKey(m.playerA, m.playerB), m]));

    // Postgres `numeric` columns round-trip through PostgREST as strings
    // (precision preservation), while override `record`s below are built
    // from JS number literals — a strict === would read "0" !== 0 as a real
    // change and mark the row dirty on every single comparison.
    function numEq(x, y) {
        if (x === null || x === undefined) return y === null || y === undefined;
        if (y === null || y === undefined) return false;
        return Number(x) === Number(y);
    }

    function sameNumericFields(a, b) {
        return numEq(a.scoreA, b.scoreA) && numEq(a.scoreB, b.scoreB)
            && numEq(a.prA, b.prA) && numEq(a.prB, b.prB)
            && numEq(a.luckA, b.luckA) && numEq(a.luckB, b.luckB);
    }

    const next = [];
    const changedKeys = new Set();
    for (const m of csvMatches) {
        const key = matchKey(m.playerA, m.playerB);
        const prev = prevByKey.get(key);
        if (prev && sameNumericFields(prev, m) && prev.source !== 'manual') {
            next.push({ ...prev, round: m.round });
            if (prev.round !== m.round) changedKeys.add(key);
        } else if (prev && prev.source === 'manual') {
            next.push({ ...prev, round: m.round });
            if (prev.round !== m.round) changedKeys.add(key);
        } else {
            next.push({
                playerA: m.playerA, playerB: m.playerB,
                scoreA: m.scoreA, scoreB: m.scoreB, prA: m.prA, prB: m.prB, luckA: m.luckA, luckB: m.luckB,
                round: m.round, updatedAt: now, source: 'csv',
            });
            changedKeys.add(key);
        }
    }

    for (const o of overrides) {
        const key = matchKey(o.playerA, o.playerB);
        let record;
        if (o.type === 'result') {
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: o.scoreA, scoreB: o.scoreB, prA: o.prA, prB: o.prB, luckA: o.luckA, luckB: o.luckB };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1, prA: null, prB: null, luckA: null, luckB: null };
        } else if (o.type === 'technical_draw') {
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: 0, scoreB: 0, prA: null, prB: null, luckA: null, luckB: null };
        } else if (o.type === 'not_played') {
            record = { playerA: o.playerA, playerB: o.playerB, scoreA: 0, scoreB: 0, prA: 0, prB: 0, luckA: 0, luckB: 0 };
        } else continue;

        const idx = next.findIndex((x) => matchKey(x.playerA, x.playerB) === key);
        // A match with no played=true row in `matches` (e.g. a 'not_played'
        // override, or an override on a round nobody's played yet) never gets
        // an entry in `next` from the loop above, so idx is always -1 here.
        // Fall back to the existing match_history row (prevByKey) for the
        // unchanged-comparison — otherwise "not found in `next`" reads as
        // "must be new", and this row gets rewritten (and audit-logged) on
        // every single publish, forever, regardless of what was published.
        const prevForKey = prevByKey.get(key);
        const round = idx >= 0 ? next[idx].round : (prevForKey ? prevForKey.round : null);
        const stamped = { ...record, round, updatedAt: now, source: 'manual' };
        if (idx >= 0) {
            const old = next[idx];
            const unchanged = old.source === 'manual' && old.round === round && sameNumericFields(old, record);
            if (unchanged) continue;
            next[idx] = stamped;
            changedKeys.add(key);
        } else {
            const unchanged = prevForKey && prevForKey.source === 'manual' && prevForKey.round === round && sameNumericFields(prevForKey, record);
            // Still push *something* so this key stays out of the stale-delete
            // set below even when unchanged — only skip re-upserting it.
            next.push(unchanged ? prevForKey : stamped);
            if (!unchanged) changedKeys.add(key);
        }
    }

    // Sync (delete-stale + upsert only rows that actually changed). Upserting
    // unchanged rows would still fire an UPDATE in Postgres, which trips the
    // updated_at/audit_log triggers on every row of the league for a no-op change.
    const freshKeys = new Set(next.map((m) => matchKey(m.playerA, m.playerB)));
    const staleIds = (historyRows || [])
        .filter((row) => !freshKeys.has(matchKey(row.player_a, row.player_b)))
        .map((row) => row.id);
    if (staleIds.length > 0) {
        const { error } = await supabase.from('match_history').delete().in('id', staleIds);
        if (error) throw new Error(`reconcileMatchHistory stale-delete failed for ${leagueId}: ${error.message}`);
    }
    const toUpsert = next.filter((m) => changedKeys.has(matchKey(m.playerA, m.playerB)));
    if (toUpsert.length > 0) {
        const rows = toUpsert.map((m) => ({
            league_id: leagueId,
            player_a: m.playerA, player_b: m.playerB,
            score_a: m.scoreA, score_b: m.scoreB, pr_a: m.prA, pr_b: m.prB, luck_a: m.luckA, luck_b: m.luckB,
            round: m.round, source: m.source, updated_at: m.updatedAt,
        }));
        const { error } = await supabase.from('match_history').upsert(rows, { onConflict: 'league_id,player_a,player_b' });
        if (error) throw new Error(`reconcileMatchHistory upsert failed for ${leagueId}: ${error.message}`);
    }
}
