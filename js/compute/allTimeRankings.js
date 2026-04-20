/**
 * allTimeRankings.js — Build all-time per-league-type ranking tables for every player.
 *
 * Single-pass aggregation across every loaded league of a given league type.
 * Mirrors the rules used by crossLeague.js (collectMedalsByType + aggregatePR)
 * so results stay consistent with the existing global player card.
 *
 * Used by (future chunks): main dashboard Achievements area (NEW-4) and the
 * global player card 5th achievement field + PR Leaders links (NEW-7).
 */

import { loadAllLeagues } from './crossLeague.js';
import { luckPercentileStats } from './luckPercentile.js';

const PR_TYPES = new Set(['doubling', 'ubc']); // league types that have PR

// Memoize per league type so repeat calls are cheap.
const cache = new Map();

/**
 * Build all-time rankings for one league type.
 * Running leagues contribute match-level stats (wins/games, luck percentile)
 * but do not contribute to placement-based metrics (medals, avg rank) since
 * placements aren't final yet.
 */
export async function buildAllTimeRankings(leagueType) {
    if (cache.has(leagueType)) return cache.get(leagueType);

    const promise = (async () => {
        const allLeagues = await loadAllLeagues();
        const typeLeagues = allLeagues.filter(
            l => l.leagueType === leagueType && !l.params.Hidden
        );

        const hasPR = PR_TYPES.has(leagueType);
        const isUBC = leagueType === 'ubc';
        const prWeight = (leagueType === 'regular') ? 5 : 7;

        // Merge custom flags from all leagues of this type
        const customFlags = {};
        for (const league of typeLeagues) {
            if (league.params.CustomFlags) {
                Object.assign(customFlags, league.params.CustomFlags);
            }
        }

        // Per-player tally
        // name -> {
        //   gold, silver, bronze, participations, rankSum,
        //   wins, games,
        //   prMatches: [{ prSelf, updatedAt, leagueOrderIdx }]
        // }
        const tally = new Map();
        const bump = name => {
            if (!tally.has(name)) {
                tally.set(name, {
                    gold: 0, silver: 0, bronze: 0,
                    participations: 0, rankSum: 0,
                    wins: 0, games: 0,
                    prWins: 0, prGames: 0,
                    prMatches: [],
                    luckMatches: []   // [{ m, matchLength }]
                });
            }
            return tally.get(name);
        };

        typeLeagues.forEach((league, leagueOrderIdx) => {
            const goldCount = league.params.GoldCount ?? 1;
            const silverCount = league.params.SilverCount ?? 1;
            const bronzeCount = league.params.BronzeCount ?? 1;
            const isRunning = league.params.Running === true;

            // Win-rate accumulation includes running leagues (wins/games are
            // factual). Placement-based metrics (medals, participations,
            // rankSum) only count completed leagues where placements are final.
            const played = league.rankings.filter(r => r.games > 0);
            played.forEach((r, i) => {
                const rank = i + 1;
                const t = bump(r.player);
                t.wins += r.wins;
                t.games += r.games;
                if (!isRunning) {
                    t.participations++;
                    t.rankSum += rank;
                    if (rank <= goldCount) t.gold++;
                    else if (rank <= goldCount + silverCount) t.silver++;
                    else if (rank <= goldCount + silverCount + bronzeCount) t.bronze++;
                }
            });

            // PR matches: walk raw matches once, push prSelf entries per side.
            if (hasPR) {
                const matchLength = league.params.MatchLength || 7;
                for (const m of league.matches) {
                    if (m._technical) continue;
                    // PR Leaders (totalPR / last300PR) only from completed leagues.
                    if (!isRunning) {
                        if (m.prA != null) {
                            bump(m.playerA).prMatches.push({
                                prSelf: m.prA,
                                updatedAt: m.updatedAt || null,
                                leagueOrderIdx
                            });
                        }
                        if (m.prB != null) {
                            bump(m.playerB).prMatches.push({
                                prSelf: m.prB,
                                updatedAt: m.updatedAt || null,
                                leagueOrderIdx
                            });
                        }
                    }
                    // PR-win rate (UBC only): count non-technical matches, includes running leagues.
                    if (isUBC) {
                        const pA = bump(m.playerA);
                        pA.prGames++;
                        if (m.prA < m.prB) pA.prWins++;
                        const pB = bump(m.playerB);
                        pB.prGames++;
                        if (m.prB < m.prA) pB.prWins++;
                    }
                    // Luck-percentile includes running leagues.
                    bump(m.playerA).luckMatches.push({ m, matchLength });
                    bump(m.playerB).luckMatches.push({ m, matchLength });
                }
            }
        });

        // Build per-player records.
        const players = [];
        for (const [name, t] of tally) {
            const avgRank = t.participations > 0 ? t.rankSum / t.participations : Infinity;
            const winRate = t.games > 0 ? t.wins / t.games : null;

            let totalPR = null, last300PR = null, last300Count = null, totalMatches = null;
            if (hasPR && t.prMatches.length > 0) {
                totalMatches = t.prMatches.length;
                totalPR = t.prMatches.reduce((s, m) => s + m.prSelf, 0) / totalMatches;

                // Sort matches by updatedAt DESC, fall back to league order
                // (display order is newest-first, so smaller idx = newer).
                const sorted = [...t.prMatches].sort((a, b) => {
                    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
                    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
                    if (at != null && bt != null) return bt - at;
                    if (at != null) return -1;
                    if (bt != null) return 1;
                    return a.leagueOrderIdx - b.leagueOrderIdx;
                });

                let wsum = 0, vsum = 0, used = 0;
                for (const m of sorted) {
                    vsum += m.prSelf * prWeight;
                    wsum += prWeight;
                    used++;
                    if (wsum >= 300) break;
                }
                last300PR = wsum > 0 ? vsum / wsum : totalPR;
                last300Count = used;
            }

            let luckPercentile = null, luckGames = 0, luckUnstable = true;
            if (hasPR && t.luckMatches.length > 0) {
                const lp = luckPercentileStats({ matchRefs: t.luckMatches, playerName: name });
                luckPercentile = lp.percentile;
                luckGames = lp.games;
                luckUnstable = lp.unstableSample;
            }

            const prWinRate = t.prGames > 0 ? t.prWins / t.prGames : null;

            players.push({
                name,
                gold: t.gold,
                silver: t.silver,
                bronze: t.bronze,
                participations: t.participations,
                avgRank,
                wins: t.wins,
                games: t.games,
                winRate,
                totalPR,
                last300PR,
                totalMatches,
                last300Count,
                luckPercentile,
                luckGames,
                luckUnstable,
                prWinRate,
                prGames: t.prGames
            });
        }

        // Build sorted ranking arrays per metric.
        // Each entry: { name, value, rank }
        const rankings = {
            gold:    rankByCount(players, 'gold'),
            silver:  rankByCount(players, 'silver'),
            bronze:  rankByCount(players, 'bronze'),
            avgRank: rankAvgRank(players),
            winRate: rankWinRate(players),
            totalPR:   hasPR ? rankPR(players, 'totalPR')   : null,
            last300PR: hasPR ? rankPR(players, 'last300PR') : null,
            luckPercentile: hasPR ? rankLuckPercentile(players) : null,
            prWinRate: isUBC ? rankPrWinRate(players) : null
        };

        return {
            players,
            rankings,
            totalPlayers: players.length,
            customFlags
        };
    })();

    cache.set(leagueType, promise);
    return promise;
}

/**
 * Convenience: rank a single player on a single metric in a league type.
 * Returns { rank, total, value } or null if the player isn't in the table.
 *
 * metric ∈ 'gold' | 'silver' | 'bronze' | 'avgRank' | 'winRate' | 'totalPR' | 'last300PR'
 */
export async function getPlayerRank(playerName, leagueType, metric) {
    const data = await buildAllTimeRankings(leagueType);
    const arr = data.rankings[metric];
    if (!arr) return null;
    const entry = arr.find(e => e.name === playerName);
    if (!entry) return null;
    return { rank: entry.rank, total: arr.length, value: entry.value };
}

// ---- internal ranking helpers ---------------------------------------------

// Medal counts: DESC, tie-break participations ASC (fewer needed = better).
// Skip players with no completed-league participations — they have no chance
// at medals by definition (running leagues don't award final medals).
function rankByCount(players, key) {
    const eligible = players.filter(p => p.participations > 0);
    eligible.sort((a, b) => {
        if (b[key] !== a[key]) return b[key] - a[key];
        return a.participations - b.participations;
    });
    return eligible.map((p, i) => ({
        name: p.name,
        value: p[key],
        rank: i + 1
    }));
}

// Avg rank: ASC (lower is better). Players with no participations skipped.
function rankAvgRank(players) {
    const eligible = players.filter(p => p.participations > 0);
    eligible.sort((a, b) => a.avgRank - b.avgRank);
    return eligible.map((p, i) => ({
        name: p.name,
        value: p.avgRank,
        rank: i + 1
    }));
}

// Win rate: DESC. Skip players with no games.
function rankWinRate(players) {
    const eligible = players.filter(p => p.games > 0);
    eligible.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.games - a.games; // tie-break: more games is more credible
    });
    return eligible.map((p, i) => ({
        name: p.name,
        value: p.winRate,
        rank: i + 1
    }));
}

// PR metrics: ASC (lower PR is better). Skip players with no PR matches.
function rankPR(players, key) {
    const eligible = players.filter(p => p[key] != null);
    eligible.sort((a, b) => a[key] - b[key]);
    return eligible.map((p, i) => ({
        name: p.name,
        value: p[key],
        rank: i + 1
    }));
}

// PR-win rate: DESC (higher PR-win % is better). UBC only.
// Filter out very-low-sample players (< 5 PR games) so the leaderboard isn't
// dominated by single-match outliers.
const PR_WIN_RATE_MIN_GAMES = 5;
function rankPrWinRate(players) {
    const eligible = players.filter(p => p.prGames >= PR_WIN_RATE_MIN_GAMES);
    eligible.sort((a, b) => {
        if (b.prWinRate !== a.prWinRate) return b.prWinRate - a.prWinRate;
        return b.prGames - a.prGames;
    });
    return eligible.map((p, i) => ({
        name: p.name,
        value: p.prWinRate,
        rank: i + 1
    }));
}

// Luck percentile: DESC. Includes low-sample players (flagged for striked rendering).
function rankLuckPercentile(players) {
    const eligible = players.filter(p => p.luckPercentile != null && p.luckGames > 0);
    eligible.sort((a, b) => {
        if (b.luckPercentile !== a.luckPercentile) return b.luckPercentile - a.luckPercentile;
        return b.luckGames - a.luckGames; // tie-break: more games is more credible
    });
    return eligible.map((p, i) => ({
        name: p.name,
        value: p.luckPercentile,
        games: p.luckGames,
        unstableSample: p.luckUnstable,
        rank: i + 1
    }));
}
