/**
 * supabaseLoader.js — Drop-in replacement for leagueLoader.js.
 * Same exported function signatures/shapes; data now comes from Supabase
 * instead of static leagues/**\/*.csv|json files.
 */

import { supabase } from './supabaseClient.js';
import { matchKey, mergeHistoryIntoMatches } from '../compute/matchHistory.js';
import { getCachedLeague, setCachedLeague } from './leagueCache.js';

// No-op compat shim — supabaseLoader.js has no notion of a "base path".
export function setLeaguesBase() {}

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
    // 0-game row, matching leagueLoader.js's getAllPlayersFromCSV() behavior.
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
 * signature parity with leagueLoader.js).
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

/**
 * Load everything for a single league: params + matches + overrides applied.
 * Checks the short-TTL sessionStorage cache first — see leagueCache.js — so a
 * league already fetched moments ago (e.g. by the landing page's bulk load)
 * doesn't get re-fetched from scratch on a fresh page navigation.
 */
export async function loadLeague(leagueId) {
    const cached = getCachedLeague(leagueId);
    if (cached) return cached;

    const [params, matchData, overrides, history] = await Promise.all([
        loadLeagueParams(leagueId),
        loadLeagueMatches(leagueId),
        loadOverrides(leagueId),
        loadMatchHistory(leagueId),
    ]);

    const withOverrides = applyOverrides(matchData.matches, overrides);
    const mergedMatches = mergeHistoryIntoMatches(withOverrides, history.matches);

    const league = {
        id: leagueId,
        params,
        matches: mergedMatches,
        lastModified: params.LastUpdated || null,
        totalPlayers: matchData.totalPlayers,
        allPlayers: matchData.allPlayers,
        history,
    };
    setCachedLeague(leagueId, league);
    return league;
}

/**
 * Load every league in leagueIds with a fixed small number of round trips
 * (4 total, regardless of how many leagues) instead of loadLeague()'s 4-per-
 * league — used by crossLeague.js's loadAllLeagues(), which otherwise fans
 * out to 4×N requests for the landing page's cross-league aggregations.
 * Also populates the per-league sessionStorage cache so a subsequent direct
 * loadLeague(id) call (e.g. after navigating into that league's own page)
 * is served instantly instead of re-querying.
 * Returns Map<leagueId, league> (same per-league shape as loadLeague()).
 * Leagues missing a `leagues` row are silently omitted (matches loadLeague()
 * throwing + Promise.allSettled filtering it out).
 */
// Supabase/PostgREST caps a single response at 1000 rows by default — with 11
// leagues × ~100-300 matches each, `matches` alone can hold 3000+ rows, well
// past that cap. A plain .in() query silently truncates instead of erroring,
// so this pages through with .range() until a page comes back short.
const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
    const rows = [];
    let from = 0;
    for (;;) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return rows;
}

export async function loadLeaguesBulk(leagueIds) {
    // Every paginated query orders by its primary key as a final, unique
    // tiebreaker. Without one, .range() pagination over a column with many
    // ties (e.g. `round`, which repeats across every league) is NOT
    // guaranteed stable between the separate page requests — Postgres can
    // place a tied row on either side of the page boundary differently each
    // time, so a row can come back twice (inflating that match into a
    // player's stats) while a different tied row is silently dropped.
    const [leagueRows, matchRows, overrideRows, historyRows] = await Promise.all([
        fetchAllRows(() => supabase.from('leagues').select('*').in('id', leagueIds).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('matches').select('*').in('league_id', leagueIds).order('round', { ascending: true }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('manual_overrides').select('*').in('league_id', leagueIds).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('match_history').select('*').in('league_id', leagueIds).order('id', { ascending: true })),
    ]);

    const paramsById = new Map(leagueRows.map((row) => [row.id, mapDbLeagueToParams(row)]));

    const matchesById = new Map();
    const allPlayersById = new Map();
    for (const row of matchRows) {
        if (!matchesById.has(row.league_id)) {
            matchesById.set(row.league_id, []);
            allPlayersById.set(row.league_id, new Set());
        }
        allPlayersById.get(row.league_id).add(row.player_a);
        allPlayersById.get(row.league_id).add(row.player_b);
        if (row.played) matchesById.get(row.league_id).push(mapDbMatch(row));
    }

    const overridesById = new Map();
    for (const row of overrideRows) {
        if (!overridesById.has(row.league_id)) overridesById.set(row.league_id, []);
        overridesById.get(row.league_id).push(mapDbOverride(row));
    }

    const historyById = new Map();
    for (const row of historyRows) {
        if (!historyById.has(row.league_id)) historyById.set(row.league_id, []);
        historyById.get(row.league_id).push({
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
        });
    }

    const results = new Map();
    for (const leagueId of leagueIds) {
        const params = paramsById.get(leagueId);
        if (!params) continue;

        const matches = matchesById.get(leagueId) || [];
        const allPlayers = allPlayersById.get(leagueId) || new Set();
        const overrides = overridesById.get(leagueId) || [];
        const history = { matches: historyById.get(leagueId) || [] };

        const withOverrides = applyOverrides(matches, overrides);
        const mergedMatches = mergeHistoryIntoMatches(withOverrides, history.matches);

        const league = {
            id: leagueId,
            params,
            matches: mergedMatches,
            lastModified: params.LastUpdated || null,
            totalPlayers: allPlayers.size,
            allPlayers,
            history,
        };
        setCachedLeague(leagueId, league);
        results.set(leagueId, league);
    }
    return results;
}

/**
 * Apply manual overrides on top of parsed matches. Pure function — identical
 * to leagueLoader.js's implementation, re-exported here for signature parity.
 * Each override replaces or adds a match by playerA+playerB key.
 */
export function applyOverrides(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;

    const result = [...matches];

    for (const o of overrides) {
        const key = matchKey(o.playerA, o.playerB);

        const idx = result.findIndex((m) => matchKey(m.playerA, m.playerB) === key);

        let newMatch;
        if (o.type === 'result') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                _overridden: true,
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true,
            };
        } else if (o.type === 'technical_draw') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true, _draw: true,
            };
        } else if (o.type === 'not_played') {
            if (idx !== -1) result.splice(idx, 1);
            continue;
        }

        if (newMatch) {
            if (idx !== -1) result[idx] = newMatch;
            else result.push(newMatch);
        }
    }

    return result;
}

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
