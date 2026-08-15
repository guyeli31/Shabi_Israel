/**
 * supabaseLoader.js — Admin-only granular Supabase read path (see
 * docs/data-architecture/02-query-standards.md rule 9). Public pages read
 * through js/data/store.js's cached get_site_bundle() instead — this file's
 * every query always hits the DB fresh, on purpose: admin needs to see its
 * own writes immediately, never a stale cached copy.
 */

import { supabase } from './supabaseClient.js';
import { mergeHistoryIntoMatches } from '../compute/matchHistory.js';

function mapDbLeagueToParams(row) {
    return {
        LeagueTitle: row.title,
        LeagueType: row.league_type,
        Running: row.running,
        Hidden: row.hidden,
        GoldCount: row.gold_count,
        SilverCount: row.silver_count,
        BronzeCount: row.bronze_count,
        MatchLength: row.match_length,
        IssueDate: row.issue_date,
        InLeaderboard: row.in_leaderboard !== false, // opt-out — see bundleMapper.js
        EntryFee: row.entry_fee ?? 0,
        Prizes: row.prizes || { Gold: 0, Silver: 0, Bronze: 0 },
        CustomFlags: row.custom_flags || {},
        RetiredPlayers: row.retired_players || [],
        ExternalSourceSync: row.external_source_sync || undefined,
        LastUpdated: row.last_updated || undefined,
    };
}

function mapDbMatch(row) {
    return {
        playerA: row.player_a,
        prA: row.pr_a,
        luckA: row.luck_a,
        scoreA: row.score_a,
        playerB: row.player_b,
        prB: row.pr_b,
        luckB: row.luck_b,
        scoreB: row.score_b,
    };
}

function mapDbMatchAll(row) {
    return { ...mapDbMatch(row), round: row.round, played: row.played };
}

function mapDbOverride(row) {
    return {
        type: row.type,
        playerA: row.player_a,
        playerB: row.player_b,
        winner: row.winner || undefined,
        scoreA: row.score_a ?? undefined,
        scoreB: row.score_b ?? undefined,
        prA: row.pr_a ?? undefined,
        prB: row.pr_b ?? undefined,
        luckA: row.luck_a ?? undefined,
        luckB: row.luck_b ?? undefined,
        reason: row.reason || undefined,
        // Surface the stored edit date under the key the round editor reads
        // (`timestamp`), so F3 shows the authored date even after publish — not
        // just from the staged JSON before it.
        timestamp: row.edited_at || undefined,
    };
}

/**
 * Load full landing settings (title, subtitle, logo, display order).
 */
export async function loadLandingSettings() {
    const { data, error } = await supabase.from('landing_settings').select('*').eq('id', 1).single();
    if (error || !data) throw new Error('Failed to load landing settings');
    return {
        title: data.title || 'Shabi Israel',
        subtitle: data.subtitle || '',
        logoPath: data.logo_path || 'assets/logo/logo.png',
        displayOrder: data.display_order || [],
    };
}

/**
 * Load the display order of leagues.
 * Returns array of league folder names (strings).
 */
export async function loadLeagueOrder() {
    const settings = await loadLandingSettings();
    return settings.displayOrder;
}

/**
 * Load a single league's params (JSON config).
 */
export async function loadLeagueParams(leagueId) {
    const { data, error } = await supabase.from('leagues').select('*').eq('id', leagueId).single();
    if (error || !data) throw new Error(`Failed to load params for "${leagueId}"`);
    return mapDbLeagueToParams(data);
}

/**
 * Load a single league's match data (played matches only).
 * Returns parsed array of match objects, plus totalPlayers/allPlayers.
 * (lastModified lives on the league row itself — see loadLeagueParams/loadLeague —
 * not fetched here to avoid a duplicate query for a value callers already have.)
 */
export async function loadLeagueMatches(leagueId) {
    const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('league_id', leagueId)
        .order('round', { ascending: true });
    if (error) throw new Error(`Failed to load matches for "${leagueId}"`);

    const allRows = data || [];
    // allPlayers must come from the FULL roster (played + unplayed rows) —
    // a player with only unplayed matches still belongs on the table as a
    // 0-game row, matching the historical getAllPlayersFromCSV() behavior.
    const allPlayers = new Set();
    for (const row of allRows) {
        allPlayers.add(row.player_a);
        allPlayers.add(row.player_b);
    }

    const matches = allRows.filter((row) => row.played).map(mapDbMatch);

    return { matches, totalPlayers: allPlayers.size, allPlayers };
}

/**
 * Load a league's match data including unplayed rows (for admin editor parity —
 * not used by admin itself, which still reads the static files, but kept for
 * signature parity with the historical file loader).
 */
export async function loadLeagueMatchesAll(leagueId) {
    const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('league_id', leagueId)
        .order('round', { ascending: true });
    if (error) throw new Error(`Failed to load matches for "${leagueId}"`);

    const matches = (data || []).map(mapDbMatchAll);
    const allPlayers = new Set();
    for (const m of matches) {
        allPlayers.add(m.playerA);
        allPlayers.add(m.playerB);
    }
    return { matches, allPlayers };
}

/**
 * Load manual overrides for a league (if they exist).
 * Returns the overrides array, or empty array if none.
 */
export async function loadOverrides(leagueId) {
    const { data, error } = await supabase.from('manual_overrides').select('*').eq('league_id', leagueId);
    if (error || !data) return [];
    return data.map(mapDbOverride);
}

export async function loadMatchHistory(leagueId) {
    const { data, error } = await supabase.from('match_history').select('*').eq('league_id', leagueId);
    if (error || !data) return { matches: [] };
    return {
        matches: data.map((row) => ({
            playerA: row.player_a,
            playerB: row.player_b,
            scoreA: row.score_a,
            scoreB: row.score_b,
            prA: row.pr_a,
            prB: row.pr_b,
            luckA: row.luck_a,
            luckB: row.luck_b,
            round: row.round,
            updatedAt: row.updated_at,
            source: row.source,
        })),
    };
}

// Overrides are applied identically no matter where the matches came from —
// re-exported here so admin callers keep a single import surface.
export { applyOverrides } from './applyOverrides.js';

/**
 * Load params for all leagues (for the landing page — needs title, status, etc.).
 * Returns array of { id, params }, re-sorted to match the requested leagueIds order
 * (callers rely on DisplayOrder sequencing).
 */
export async function loadAllLeagueParams(leagueIds) {
    const { data, error } = await supabase.from('leagues').select('*').in('id', leagueIds);
    if (error || !data) throw new Error('Failed to load league params');

    const byId = new Map(data.map((row) => [row.id, mapDbLeagueToParams(row)]));
    return leagueIds
        .filter((id) => byId.has(id))
        .map((id) => ({ id, params: byId.get(id) }));
}
