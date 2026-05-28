/**
 * crossLeague.js — Aggregation helpers for the general (cross-league) player profile.
 *
 * Loads every league, computes per-league stats, and exposes functions that
 * aggregate across leagues for the Phase G general player card.
 */

import { loadLeagueOrder, loadLeague } from '../data/leagueLoader.js';
import { computeAllStats } from './stats.js';
import { buildRankings, getLevel } from './rankings.js';
import { getLeagueConfig } from './leagueTypes.js';

// Memoized load of every league.
let allLeaguesPromise = null;

/**
 * Load every league once, return enriched entries.
 * Each entry: { id, title, params, leagueType, config, matches, allPlayers,
 *               statsMap, rankings }
 */
export function loadAllLeagues() {
    if (allLeaguesPromise) return allLeaguesPromise;
    allLeaguesPromise = (async () => {
        const displayOrder = await loadLeagueOrder();
        // Folder id = title with " - " replaced by " "
        const entries = displayOrder.map(title => ({
            title,
            id: title.replace(' - ', ' ')
        }));

        const results = await Promise.allSettled(
            entries.map(async e => {
                const league = await loadLeague(e.id);
                const config = getLeagueConfig(league.params);
                const leagueType = config.type;
                const statsMap = computeAllStats(league.matches, league.allPlayers);
                const rankings = buildRankings(statsMap, config);
                return {
                    id: e.id,
                    title: league.params.LeagueTitle || e.title,
                    params: league.params,
                    leagueType,
                    config,
                    matches: league.matches,
                    allPlayers: league.allPlayers,
                    lastModified: league.lastModified,
                    statsMap,
                    rankings
                };
            })
        );
        return results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);
    })();
    return allLeaguesPromise;
}

/**
 * Load only non-hidden leagues. Used by all public-facing cross-league
 * aggregations so HIDDEN leagues never leak into player stats, achievements,
 * rankings, or match history. The admin panel keeps using loadAllLeagues.
 */
export async function loadVisibleLeagues() {
    const all = await loadAllLeagues();
    return all.filter(l => !l.params.Hidden);
}

/**
 * Build per-league player data for one player. Returns array of:
 *   { league (the loadAllLeagues entry), playerStats, playerRank, totalPlayers,
 *     playerMatches }
 * Only leagues where the player is in allPlayers are included.
 *
 * playerMatches: array of { opponent, scoreSelf, scoreOpp, prSelf, prOpp,
 *                           luckSelf, luckOpp, _technical, _draw, updatedAt }
 */
export async function loadPlayerAcrossLeagues(playerName) {
    const leagues = await loadVisibleLeagues();
    const out = [];
    for (const league of leagues) {
        if (!league.allPlayers.has(playerName)) continue;
        const playerStats = league.statsMap.get(playerName) || null;
        const rankEntry = league.rankings.find(r => r.player === playerName);
        const playerRank = rankEntry ? rankEntry.rank : null;
        const totalPlayers = league.rankings.length;
        const playerMatches = extractPlayerMatches(league.matches, playerName);
        out.push({
            league,
            playerStats,
            playerRank,
            totalPlayers,
            playerMatches
        });
    }
    return out;
}

/**
 * Walk merged matches and return played matches for this player,
 * preserving updatedAt (from match_history merge) when present.
 * Unplayed matches are omitted.
 */
export function extractPlayerMatches(matches, playerName) {
    const out = [];
    for (const m of matches) {
        let rec = null;
        if (m.playerA === playerName) {
            rec = {
                opponent: m.playerB,
                scoreSelf: m.scoreA, scoreOpp: m.scoreB,
                prSelf: m.prA, prOpp: m.prB,
                luckSelf: m.luckA, luckOpp: m.luckB
            };
        } else if (m.playerB === playerName) {
            rec = {
                opponent: m.playerA,
                scoreSelf: m.scoreB, scoreOpp: m.scoreA,
                prSelf: m.prB, prOpp: m.prA,
                luckSelf: m.luckB, luckOpp: m.luckA
            };
        }
        if (!rec) continue;
        rec._technical = m._technical || false;
        rec._draw = m._draw || false;
        rec.updatedAt = m.updatedAt || null;
        out.push(rec);
    }
    return out;
}

/**
 * Aggregate PR stats across leagues of the given league type.
 * Returns { totalPR, totalLevel, last300PR, last300Level, totalMatches }
 * or null if no played non-technical matches exist.
 *
 * "Last 300 PR" = weighted mean of prSelf over most-recent matches accumulated
 * until weight ≥ 300. Weight per match derived from LeagueType:
 *   regular → 5, doubling/ubc → 7.
 */
export function aggregatePR(perLeagueData, leagueType) {
    const weight = (leagueType === 'regular') ? 5 : 7;

    // Collect all played non-technical matches for that leagueType
    const all = [];
    for (const entry of perLeagueData) {
        if (entry.league.leagueType !== leagueType) continue;
        for (const m of entry.playerMatches) {
            if (m._technical) continue;
            if (m.prSelf == null) continue;
            all.push({
                prSelf: m.prSelf,
                updatedAt: m.updatedAt,
                leagueOrderIdx: perLeagueData.indexOf(entry)
            });
        }
    }
    if (all.length === 0) return null;

    const totalPR = all.reduce((s, m) => s + m.prSelf, 0) / all.length;

    // Sort by updatedAt DESC; missing updatedAt falls back to league order (newer league first)
    const sorted = [...all].sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
        if (at != null && bt != null) return bt - at;
        if (at != null) return -1;
        if (bt != null) return 1;
        return a.leagueOrderIdx - b.leagueOrderIdx; // displayOrder is newest-first
    });

    let wsum = 0, vsum = 0, used = 0;
    for (const m of sorted) {
        vsum += m.prSelf * weight;
        wsum += weight;
        used++;
        if (wsum >= 300) break;
    }
    const last300PR = wsum > 0 ? vsum / wsum : totalPR;

    return {
        totalPR,
        totalLevel: getLevel(totalPR),
        last300PR,
        last300Level: getLevel(last300PR),
        totalMatches: all.length,
        last300Count: used
    };
}

/**
 * Rank the target player among all players who have played a given metric
 * in the given leagueType during a given calendar year.
 *
 * metric: 'totalPR' | 'last300PR'
 * Lower is better for both.
 *
 * Returns { rank, total, value } or null if the player has no qualifying matches.
 */
/**
 * Build the full ordered ranking for a given year/metric. Returns an array of
 * { rank, name, value } sorted from best to worst (PR: lower is better).
 * Used both internally by rankWithinYear and externally for the player page's
 * expandable ranking table.
 */
export async function listYearRanking(leagueType, year, metric) {
    const leagues = await loadVisibleLeagues();
    const typeLeagues = leagues.filter(l => l.leagueType === leagueType);
    if (typeLeagues.length === 0) return [];

    const byPlayer = new Map();
    typeLeagues.forEach((league, li) => {
        for (const m of league.matches) {
            if (m._technical) continue;
            const yr = m.updatedAt ? new Date(m.updatedAt).getFullYear() : null;
            if (yr !== year) continue;
            const pushFor = (name, prSelf) => {
                if (!byPlayer.has(name)) byPlayer.set(name, []);
                byPlayer.get(name).push({ prSelf, updatedAt: m.updatedAt, leagueOrderIdx: li });
            };
            if (m.prA != null) pushFor(m.playerA, m.prA);
            if (m.prB != null) pushFor(m.playerB, m.prB);
        }
    });

    if (byPlayer.size === 0) return [];

    const weight = (leagueType === 'regular') ? 5 : 7;
    function computeMetric(matches) {
        if (metric === 'totalPR') {
            return matches.reduce((s, m) => s + m.prSelf, 0) / matches.length;
        }
        const sorted = [...matches].sort((a, b) => {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bt - at;
        });
        let ws = 0, vs = 0;
        for (const m of sorted) {
            vs += m.prSelf * weight;
            ws += weight;
            if (ws >= 300) break;
        }
        return ws > 0 ? vs / ws : 0;
    }

    const scores = [];
    for (const [name, matches] of byPlayer) scores.push({ name, value: computeMetric(matches) });
    scores.sort((a, b) => a.value - b.value); // lower PR = better
    return scores.map((s, i) => ({ rank: i + 1, name: s.name, value: s.value }));
}

/**
 * Same as listYearRanking but across ALL history (no year filter).
 * Used by the player general card PR section so players without recent
 * matches still get a meaningful rank.
 */
export async function listAllTimeRanking(leagueType, metric) {
    const leagues = await loadVisibleLeagues();
    const typeLeagues = leagues.filter(l => l.leagueType === leagueType);
    if (typeLeagues.length === 0) return [];

    const byPlayer = new Map();
    typeLeagues.forEach((league, li) => {
        for (const m of league.matches) {
            if (m._technical) continue;
            const pushFor = (name, prSelf) => {
                if (!byPlayer.has(name)) byPlayer.set(name, []);
                byPlayer.get(name).push({ prSelf, updatedAt: m.updatedAt, leagueOrderIdx: li });
            };
            if (m.prA != null) pushFor(m.playerA, m.prA);
            if (m.prB != null) pushFor(m.playerB, m.prB);
        }
    });

    if (byPlayer.size === 0) return [];

    const weight = (leagueType === 'regular') ? 5 : 7;
    function computeMetric(matches) {
        if (metric === 'totalPR') {
            return matches.reduce((s, m) => s + m.prSelf, 0) / matches.length;
        }
        const sorted = [...matches].sort((a, b) => {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bt - at;
        });
        let ws = 0, vs = 0;
        for (const m of sorted) {
            vs += m.prSelf * weight;
            ws += weight;
            if (ws >= 300) break;
        }
        return ws > 0 ? vs / ws : 0;
    }

    const scores = [];
    for (const [name, matches] of byPlayer) {
        const leagues = new Set(matches.map(m => m.leagueOrderIdx)).size;
        scores.push({ name, value: computeMetric(matches), leagues });
    }
    scores.sort((a, b) => a.value - b.value);
    return scores.map((s, i) => ({ rank: i + 1, name: s.name, value: s.value, leagues: s.leagues }));
}

export async function rankAllTime(playerName, leagueType, metric) {
    const sorted = await listAllTimeRanking(leagueType, metric);
    if (!sorted.length) return null;
    const idx = sorted.findIndex(s => s.name === playerName);
    if (idx === -1) return null;
    return { rank: idx + 1, total: sorted.length, value: sorted[idx].value };
}

export async function rankWithinYear(playerName, leagueType, year, metric) {
    const sorted = await listYearRanking(leagueType, year, metric);
    if (!sorted.length) return null;
    const idx = sorted.findIndex(s => s.name === playerName);
    if (idx === -1) return null;
    return { rank: idx + 1, total: sorted.length, value: sorted[idx].value };
}

// Original implementation kept below for callers that don't need the full list.
// (Unused now — listYearRanking is the source of truth.)
// eslint-disable-next-line no-unused-vars
async function _legacyRankWithinYear(playerName, leagueType, year, metric) {
    const leagues = await loadAllLeagues();
    const typeLeagues = leagues.filter(l => l.leagueType === leagueType);
    if (typeLeagues.length === 0) return null;

    // Build per-player match list (non-technical, played, in `year`, in these leagues)
    const byPlayer = new Map(); // name -> array<{ prSelf, updatedAt, leagueOrderIdx }>
    typeLeagues.forEach((league, li) => {
        for (const m of league.matches) {
            if (m._technical) continue;
            const year1 = m.updatedAt ? new Date(m.updatedAt).getFullYear() : null;
            // If no updatedAt, we can't year-filter reliably — only include when year matches current
            if (year1 !== year) continue;

            const pushFor = (name, prSelf) => {
                if (!byPlayer.has(name)) byPlayer.set(name, []);
                byPlayer.get(name).push({
                    prSelf,
                    updatedAt: m.updatedAt,
                    leagueOrderIdx: li
                });
            };
            if (m.prA != null) pushFor(m.playerA, m.prA);
            if (m.prB != null) pushFor(m.playerB, m.prB);
        }
    });

    if (byPlayer.size === 0) return null;

    const weight = (leagueType === 'regular') ? 5 : 7;

    function computeMetric(matches) {
        if (metric === 'totalPR') {
            return matches.reduce((s, m) => s + m.prSelf, 0) / matches.length;
        }
        const sorted = [...matches].sort((a, b) => {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bt - at;
        });
        let ws = 0, vs = 0;
        for (const m of sorted) {
            vs += m.prSelf * weight;
            ws += weight;
            if (ws >= 300) break;
        }
        return ws > 0 ? vs / ws : 0;
    }

    const scores = [];
    for (const [name, matches] of byPlayer) {
        scores.push({ name, value: computeMetric(matches) });
    }
    scores.sort((a, b) => a.value - b.value); // lower PR = better

    const idx = scores.findIndex(s => s.name === playerName);
    if (idx === -1) return null;
    return { rank: idx + 1, total: scores.length, value: scores[idx].value };
}

/**
 * Collect medal tallies across all leagues of one league type, compared to
 * every other player of that type (all time — not year-filtered).
 *
 * Returns {
 *   self: { gold, silver, bronze, avgRank, participations },
 *   goldRank, silverRank, bronzeRank, avgRankRank,
 *   totalPlayers
 * } or null if the player hasn't participated.
 */
export async function collectMedalsByType(playerName, leagueType) {
    const leagues = await loadVisibleLeagues();
    // Exclude leagues that are still running — placements aren't final yet,
    // so no achievements (medals / avg-rank) should accrue for them.
    const typeLeagues = leagues.filter(l =>
        l.leagueType === leagueType && l.params.Running !== true
    );
    if (typeLeagues.length === 0) return null;

    // Per-player tallies
    const tally = new Map(); // name -> { gold, silver, bronze, rankSum, participations, totalWins, totalGames }
    const bump = name => {
        if (!tally.has(name)) tally.set(name, { gold: 0, silver: 0, bronze: 0, rankSum: 0, participations: 0, totalWins: 0, totalGames: 0 });
        return tally.get(name);
    };

    for (const league of typeLeagues) {
        const goldCount = league.params.GoldCount ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;

        // Only rank players who actually played at least one game
        const played = league.rankings.filter(r => r.games > 0);
        played.forEach((r, i) => {
            const rank = i + 1;
            const t = bump(r.player);
            t.participations++;
            t.rankSum += rank;
            t.totalWins += r.wins || 0;
            t.totalGames += r.games || 0;
            if (rank <= goldCount) t.gold++;
            else if (rank <= goldCount + silverCount) t.silver++;
            else if (rank <= goldCount + silverCount + bronzeCount) t.bronze++;
        });
    }

    if (!tally.has(playerName)) return null;

    // Compute avgRank and winRate per player
    const records = [];
    for (const [name, t] of tally) {
        records.push({
            name,
            gold: t.gold,
            silver: t.silver,
            bronze: t.bronze,
            participations: t.participations,
            avgRank: t.participations > 0 ? t.rankSum / t.participations : Infinity,
            winRate: t.totalGames > 0 ? t.totalWins / t.totalGames : 0,
            totalWins: t.totalWins,
            totalGames: t.totalGames
        });
    }

    const self = records.find(r => r.name === playerName);

    // Rank among all: count DESC, tie-break by participations ASC (fewer needed = better)
    function medalRank(metric) {
        const sorted = [...records].sort((a, b) => {
            if (b[metric] !== a[metric]) return b[metric] - a[metric];
            return a.participations - b.participations;
        });
        return sorted.findIndex(r => r.name === playerName) + 1;
    }

    // Avg rank: ASC (lower is better)
    const byAvg = [...records].sort((a, b) => a.avgRank - b.avgRank);
    const avgRankRank = byAvg.findIndex(r => r.name === playerName) + 1;

    // Win rate: DESC (higher is better)
    const byWinRate = [...records].sort((a, b) => b.winRate - a.winRate || a.totalGames - b.totalGames);
    const winRateRank = byWinRate.findIndex(r => r.name === playerName) + 1;

    return {
        self: {
            gold: self.gold,
            silver: self.silver,
            bronze: self.bronze,
            avgRank: self.avgRank,
            participations: self.participations,
            winRate: self.winRate,
            totalWins: self.totalWins,
            totalGames: self.totalGames
        },
        goldRank: medalRank('gold'),
        silverRank: medalRank('silver'),
        bronzeRank: medalRank('bronze'),
        avgRankRank,
        winRateRank,
        totalPlayers: records.length
    };
}

/**
 * Build the full ordered ranking for a medal-style metric across all
 * non-running leagues of the given type. Used by the player page expandable
 * tables under the Achievements card.
 *
 * metric: 'gold' | 'silver' | 'bronze' | 'avgRank' | 'winRate'
 * Returns array of { rank, name, value } sorted best→worst.
 */
export async function listMedalRanking(leagueType, metric) {
    const leagues = await loadVisibleLeagues();
    const typeLeagues = leagues.filter(l =>
        l.leagueType === leagueType && l.params.Running !== true
    );
    if (typeLeagues.length === 0) return [];

    const tally = new Map();
    const bump = name => {
        if (!tally.has(name)) tally.set(name, { gold: 0, silver: 0, bronze: 0, rankSum: 0, participations: 0, totalWins: 0, totalGames: 0 });
        return tally.get(name);
    };

    for (const league of typeLeagues) {
        const goldCount = league.params.GoldCount ?? 1;
        const silverCount = league.params.SilverCount ?? 1;
        const bronzeCount = league.params.BronzeCount ?? 1;
        const played = league.rankings.filter(r => r.games > 0);
        played.forEach((r, i) => {
            const rank = i + 1;
            const t = bump(r.player);
            t.participations++;
            t.rankSum += rank;
            t.totalWins += r.wins || 0;
            t.totalGames += r.games || 0;
            if (rank <= goldCount) t.gold++;
            else if (rank <= goldCount + silverCount) t.silver++;
            else if (rank <= goldCount + silverCount + bronzeCount) t.bronze++;
        });
    }

    const records = [];
    for (const [name, t] of tally) {
        records.push({
            name,
            gold: t.gold, silver: t.silver, bronze: t.bronze,
            participations: t.participations,
            avgRank: t.participations > 0 ? t.rankSum / t.participations : Infinity,
            winRate: t.totalGames > 0 ? t.totalWins / t.totalGames : 0,
            totalGames: t.totalGames
        });
    }

    let sorted;
    if (metric === 'avgRank') {
        sorted = [...records].sort((a, b) => a.avgRank - b.avgRank);
    } else if (metric === 'winRate') {
        sorted = [...records].sort((a, b) => b.winRate - a.winRate || a.totalGames - b.totalGames);
    } else {
        // gold/silver/bronze: count DESC, tie-break by participations ASC
        sorted = [...records].sort((a, b) => {
            if (b[metric] !== a[metric]) return b[metric] - a[metric];
            return a.participations - b.participations;
        });
    }
    // Filter out players with no participation in this metric (zero medals / inf rank)
    const filtered = sorted.filter(r => {
        if (metric === 'avgRank') return isFinite(r.avgRank);
        if (metric === 'winRate') return r.totalGames > 0;
        return r[metric] > 0 || r.participations > 0;
    });
    return filtered.map((r, i) => ({ rank: i + 1, name: r.name, value: r[metric], leagues: r.participations }));
}

/**
 * Flatten all played matches across leagues into one array for the history table
 * and bar chart. Sorted by updatedAt DESC (unknown dates sorted to end by
 * league order, newest league first).
 *
 * Each row: { leagueId, leagueTitle, leagueType, year, opponent, scoreSelf,
 *             scoreOpp, prSelf, prOpp, luckSelf, luckOpp, _technical, _draw,
 *             updatedAt, result }
 */
export function flattenAllMatches(perLeagueData) {
    const rows = [];
    perLeagueData.forEach((entry, li) => {
        for (const m of entry.playerMatches) {
            const year = m.updatedAt ? new Date(m.updatedAt).getFullYear() : null;
            let result;
            if (m._draw) result = 'DRAW';
            else if (m.scoreSelf > m.scoreOpp) result = 'WIN';
            else if (m.scoreSelf < m.scoreOpp) result = 'LOSS';
            else result = 'DRAW';

            rows.push({
                leagueId: entry.league.id,
                leagueTitle: entry.league.title,
                leagueType: entry.league.leagueType,
                matchLength: entry.league.params?.MatchLength ?? 7,
                year,
                leagueOrderIdx: li,
                ...m,
                result
            });
        }
    });

    rows.sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
        if (at != null && bt != null) return bt - at;
        if (at != null) return -1;
        if (bt != null) return 1;
        return a.leagueOrderIdx - b.leagueOrderIdx;
    });

    return rows;
}

/**
 * Batch-compute Last 300 PR for multiple players in a single pass.
 * Returns Map<playerName, last300PR>.
 * Efficient: loads all visible leagues once (memoized), iterates each league once.
 */
export async function batchLast300PR(playerNames, leagueType) {
    const leagues = await loadVisibleLeagues();
    const typeLeagues = leagues.filter(l => (l.leagueType || 'doubling') === leagueType);
    const weight = (leagueType === 'regular') ? 5 : 7;

    // Build per-player match arrays in one pass over all leagues
    const playerMatchesMap = new Map();
    for (const name of playerNames) {
        playerMatchesMap.set(name, []);
    }

    for (let li = 0; li < typeLeagues.length; li++) {
        const league = typeLeagues[li];
        for (const m of league.matches) {
            const processPlayer = (name, prSelf) => {
                const arr = playerMatchesMap.get(name);
                if (!arr) return;
                if (m._technical || prSelf == null) return;
                arr.push({ prSelf, updatedAt: m.updatedAt || null, leagueOrderIdx: li });
            };
            processPlayer(m.playerA, m.prA);
            processPlayer(m.playerB, m.prB);
        }
    }

    // Compute Last 300 PR for each player
    const result = new Map();
    for (const name of playerNames) {
        const all = playerMatchesMap.get(name);
        if (!all || all.length === 0) continue;

        // Sort by updatedAt DESC; missing falls back to league order (newest first)
        all.sort((a, b) => {
            const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
            const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
            if (at != null && bt != null) return bt - at;
            if (at != null) return -1;
            if (bt != null) return 1;
            return a.leagueOrderIdx - b.leagueOrderIdx;
        });

        let wsum = 0, vsum = 0;
        const prVals = [];
        for (const m of all) {
            vsum += m.prSelf * weight;
            wsum += weight;
            prVals.push(m.prSelf);
            if (wsum >= 300) break;
        }
        if (wsum > 0) {
            const mean = vsum / wsum;
            let std = 2.0; // default when insufficient data
            if (prVals.length >= 3) {
                const avg = prVals.reduce((s, v) => s + v, 0) / prVals.length;
                const variance = prVals.reduce((s, v) => s + (v - avg) ** 2, 0) / prVals.length;
                std = Math.sqrt(variance) || 2.0;
            }
            result.set(name, { mean, std });
        }
    }
    return result;
}
