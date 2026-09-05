/**
 * supabaseLoader.js — Admin-only granular Supabase read path (see
 * docs/data-architecture/02-query-standards.md rule 9). Public pages read
 * through js/data/store.js's cached get_site_bundle() instead.
 *
 * ── Freshness, and why "no cache" was the wrong way to get it ──────────────
 *
 * This file used to re-query on every single call, on the stated grounds that
 * admin must see its own writes immediately. The requirement is real. The
 * implementation was not a way of meeting it — it was the absence of any
 * mechanism at all, and it cost accordingly: eight admin modules
 * (leagueManager, roundEditor, playerManager, flagRegistry, overridesList,
 * csvValidation, excelImporter, stagingStore) each independently call
 * loadLeagueParams / loadOverrides / loadLeagueMatchesAll / loadLeagueOrder,
 * with no idea the module next door fetched the same rows a moment ago. Every
 * switch between admin views re-downloaded the same data from scratch, even
 * when nothing had been written in between.
 *
 * So: a session-scoped memo whose invalidation is EXACT, not hopeful. Two
 * independent triggers, either of which is sufficient on its own:
 *
 *  1. `site_meta.data_version` — a counter the DB bumps (statement-level) on
 *     every write to leagues / matches / manual_overrides / match_history /
 *     players_metadata / landing_settings. Reading it is one tiny row. Before
 *     serving anything from memory, this file checks the counter; if it moved,
 *     the whole memo is dropped. This covers writes by anyone — a colleague in
 *     another tab, the scheduled source sync, the mail ingest.
 *
 *  2. `invalidateAdminCache()` — called by supabaseAdmin.js after each of its
 *     own writes, so the admin's own edit never even waits for a version check.
 *
 * The result is strictly stronger than the old behaviour, not a trade against
 * it: with the counter checked before every serve, a stale read is not merely
 * unlikely, it cannot happen without the DB failing to bump — and if the check
 * itself fails, the code below refuses to serve from memory rather than
 * guessing. What went away is only the re-downloading of rows already known to
 * be current.
 */

import { supabase } from './supabaseClient.js';
import { mergeHistoryIntoMatches } from '../compute/matchHistory.js';

// ── Version-gated memo ─────────────────────────────────────────────────────

/** Cached rows for the current data_version. Cleared whenever it moves. */
let _memo = new Map();
/** The data_version every entry in _memo belongs to. */
let _memoVersion = null;
/** In-flight/last version read, and when it was taken. */
let _versionAt = 0;
let _versionValue = null;
let _versionPromise = null;
/**
 * How long one data_version read is reused.
 *
 * Rendering a single admin view fires a burst of loader calls (params, then
 * matches, then overrides, then history). Checking the counter once per call
 * would replace one wasteful pattern with another, so a read is shared across
 * a short window. It is deliberately about the length of one render, not a
 * cache TTL: two seconds after any user action the next call re-checks.
 */
const VERSION_TTL_MS = 2_000;

function currentVersion() {
    if (_versionPromise) return _versionPromise;
    if (_versionValue !== null && Date.now() - _versionAt < VERSION_TTL_MS) {
        return Promise.resolve(_versionValue);
    }
    _versionPromise = supabase
        .from('site_meta').select('data_version').eq('id', 1).single()
        .then(({ data, error }) => {
            // A failed check must NOT be treated as "unchanged". Returning null
            // makes every caller below bypass the memo and query the DB
            // directly — slower, and exactly right: freshness is the property
            // this file exists to guarantee, so when it cannot be verified the
            // cache is not used.
            _versionValue = error ? null : (data?.data_version ?? null);
            _versionAt = Date.now();
            return _versionValue;
        })
        .catch(() => { _versionValue = null; _versionAt = Date.now(); return null; })
        .finally(() => { _versionPromise = null; });
    return _versionPromise;
}

/**
 * Drop every memoised row. Called by supabaseAdmin.js after its own writes —
 * the admin knows exactly when it changed something and need not wait for the
 * counter to be re-read to see it.
 */
export function invalidateAdminCache() {
    _memo.clear();
    _memoVersion = null;
    _versionValue = null;
    _versionAt = 0;
}

/**
 * Serve `key` from memory if the DB is still at the version the memo was built
 * against; otherwise fetch, and remember. Rejections are never cached, so a
 * transient failure does not stick to the session.
 */
async function memoised(key, fetcher) {
    const version = await currentVersion();
    if (version === null) return fetcher();      // can't verify → don't trust memory
    if (version !== _memoVersion) {              // someone wrote → everything we hold is suspect
        _memo.clear();
        _memoVersion = version;
    }
    if (_memo.has(key)) return _memo.get(key);
    const promise = fetcher();
    _memo.set(key, promise);
    promise.catch(() => { if (_memo.get(key) === promise) _memo.delete(key); });
    return promise;
}

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
        DurationMode: row.duration_mode || undefined, // absent ⇒ 'month' (see leagueDuration.js)
        DurationDays: row.duration_days ?? undefined,
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
    return memoised('landing_settings', async () => {
        const { data, error } = await supabase.from('landing_settings').select('*').eq('id', 1).single();
        if (error || !data) throw new Error('Failed to load landing settings');
        return {
            title: data.title || 'Shabi Israel',
            subtitle: data.subtitle || '',
            logoPath: data.logo_path || 'assets/logo/logo.png',
            displayOrder: data.display_order || [],
            // Mirrors mapLandingSettingsRow() in bundleMapper.js — see
            // sql/landing_completed_custom_order.sql.
            completedCustomOrder: data.completed_custom_order === true,
        };
    });
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
    return memoised(`league:${leagueId}`, async () => {
        const { data, error } = await supabase.from('leagues').select('*').eq('id', leagueId).single();
        if (error || !data) throw new Error(`Failed to load params for "${leagueId}"`);
        return mapDbLeagueToParams(data);
    });
}

/**
 * Load a single league's match data (played matches only).
 * Returns parsed array of match objects, plus totalPlayers/allPlayers.
 * (lastModified lives on the league row itself — see loadLeagueParams/loadLeague —
 * not fetched here to avoid a duplicate query for a value callers already have.)
 */
export async function loadLeagueMatches(leagueId) {
    return memoised(`matches:${leagueId}`, async () => {
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
    });
}

/**
 * Load a league's match data including unplayed rows (for admin editor parity —
 * not used by admin itself, which still reads the static files, but kept for
 * signature parity with the historical file loader).
 */
export async function loadLeagueMatchesAll(leagueId) {
    return memoised(`matchesAll:${leagueId}`, async () => {
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
    });
}

/**
 * Load manual overrides for a league (if they exist).
 * Returns the overrides array, or empty array if none.
 */
export async function loadOverrides(leagueId) {
    return memoised(`overrides:${leagueId}`, async () => {
        const { data, error } = await supabase.from('manual_overrides').select('*').eq('league_id', leagueId);
        if (error || !data) return [];
        return data.map(mapDbOverride);
    });
}

export async function loadMatchHistory(leagueId) {
    return memoised(`history:${leagueId}`, async () => {
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
    });
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
    return memoised(`allParams:${[...leagueIds].join('|')}`, async () => {
        const { data, error } = await supabase.from('leagues').select('*').in('id', leagueIds);
        if (error || !data) throw new Error('Failed to load league params');

        const byId = new Map(data.map((row) => [row.id, mapDbLeagueToParams(row)]));
        return leagueIds
            .filter((id) => byId.has(id))
            .map((id) => ({ id, params: byId.get(id) }));
    });
}
