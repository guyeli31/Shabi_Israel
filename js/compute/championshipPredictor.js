/**
 * championshipPredictor.js — Monte Carlo / Exact simulation engine
 * for predicting championship win probabilities.
 *
 * Pure compute module: no DOM, no async.
 */

// ── Probability lookup table ────────────────────────────────────────
// Win probability (%) for the better (lower PR) player, indexed by
// PR difference (rows 0-10) and match length (columns).
const PR_PROBABILITY_TABLE = {
    matchLengths: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25],
    probabilitiesByPrDiff: {
        0:  [50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0],
        1:  [50.9, 51.6, 52.1, 52.5, 52.8, 53.1, 53.4, 53.7, 53.9, 54.1, 54.3, 54.5, 54.7],
        2:  [51.9, 53.3, 54.2, 55.0, 55.7, 56.3, 56.8, 57.3, 57.8, 58.2, 58.6, 59.0, 59.4],
        3:  [52.8, 54.9, 56.3, 57.5, 58.5, 59.3, 60.1, 60.9, 61.5, 62.2, 62.8, 63.3, 63.9],
        4:  [53.8, 56.5, 58.4, 59.9, 61.2, 62.3, 63.4, 64.3, 65.2, 66.0, 66.7, 67.5, 68.1],
        5:  [54.7, 58.2, 60.5, 62.3, 63.9, 65.2, 66.5, 67.6, 68.6, 69.6, 70.5, 71.3, 72.1],
        6:  [55.7, 59.7, 62.5, 64.6, 66.5, 68.0, 69.5, 70.7, 71.9, 73.0, 74.0, 74.9, 75.8],
        7:  [56.6, 61.3, 64.4, 66.9, 69.0, 70.7, 72.3, 73.7, 75.0, 76.1, 77.2, 78.2, 79.1],
        8:  [57.5, 62.9, 66.4, 69.1, 71.3, 73.3, 74.9, 76.4, 77.8, 79.0, 80.1, 81.1, 82.0],
        9:  [58.5, 64.4, 68.2, 71.2, 73.6, 75.7, 77.4, 79.0, 80.4, 81.6, 82.7, 83.8, 84.7],
        10: [59.4, 65.9, 70.0, 73.2, 75.8, 77.9, 79.7, 81.3, 82.7, 84.0, 85.1, 86.1, 87.0]
    }
};

/**
 * Find the nearest index in matchLengths for a given match length.
 */
function nearestMatchLengthIdx(matchLength) {
    const lens = PR_PROBABILITY_TABLE.matchLengths;
    let bestIdx = 0;
    let bestDist = Math.abs(lens[0] - matchLength);
    for (let i = 1; i < lens.length; i++) {
        const d = Math.abs(lens[i] - matchLength);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
}

/**
 * Get win probability (0-1) for playerA given both players' PRs and match length.
 * Lower PR = stronger player.
 * For PR diffs > 10: linear extrapolation from rows 9 & 10, clamped to [0.5, 0.999].
 */
function getWinProbability(prA, prB, mlIdx) {
    const diff = Math.abs(prA - prB);
    const diffRounded = Math.round(diff);
    const table = PR_PROBABILITY_TABLE.probabilitiesByPrDiff;

    let pctBetter; // win % for the better (lower PR) player
    if (diffRounded <= 10) {
        pctBetter = table[diffRounded][mlIdx];
    } else {
        // Extrapolate linearly from rows 9 and 10
        const v9 = table[9][mlIdx];
        const v10 = table[10][mlIdx];
        const slope = v10 - v9;
        pctBetter = v10 + (diffRounded - 10) * slope;
        pctBetter = Math.min(Math.max(pctBetter, 50), 99.9);
    }

    // Lower PR = better player gets pctBetter
    if (prA <= prB) {
        return pctBetter / 100;
    } else {
        return (100 - pctBetter) / 100;
    }
}

/**
 * Determine the champion index from simulated final standings.
 * Uses league-specific ranking criteria.
 */
function findChampion(wins, games, points, tiebreakerPR, rankingConfig, n) {
    let bestIdx = 0;
    const primary = rankingConfig.primary;
    const primaryDesc = rankingConfig.primaryDir === 'desc';
    const secondary = rankingConfig.secondary;
    const secondaryAsc = rankingConfig.secondaryDir === 'asc';

    function getPrimary(i) {
        if (primary === 'winRate') return games[i] > 0 ? wins[i] / games[i] : 0;
        if (primary === 'avgPoints') return games[i] > 0 ? points[i] / games[i] : 0;
        return wins[i];
    }

    function getSecondary(i) {
        if (secondary === 'meanPR') return tiebreakerPR[i];
        if (secondary === 'wins') return wins[i];
        return 0;
    }

    let bestPrimary = getPrimary(0);
    let bestSecondary = getSecondary(0);

    for (let i = 1; i < n; i++) {
        const p = getPrimary(i);
        const s = getSecondary(i);
        let better = false;

        if (primaryDesc ? p > bestPrimary : p < bestPrimary) {
            better = true;
        } else if (p === bestPrimary) {
            if (secondaryAsc ? s < bestSecondary : s > bestSecondary) {
                better = true;
            }
        }

        if (better) {
            bestIdx = i;
            bestPrimary = p;
            bestSecondary = s;
        }
    }
    return bestIdx;
}

/**
 * Monte Carlo simulation.
 * Returns Float64Array of championship win counts per player.
 */
function simulateMonteCarlo(setup, N) {
    const { n, currentWins, currentGames, currentPoints, tiebreakerPR,
            remainingA, remainingB, remainingProbA, rankingConfig, isUBC, remainingPRWinA } = setup;
    const X = remainingA.length;
    const champWins = new Float64Array(n);

    const simWins = new Int32Array(n);
    const simGames = new Int32Array(n);
    const simPoints = new Int32Array(n);

    for (let iter = 0; iter < N; iter++) {
        // Reset to current standings
        for (let i = 0; i < n; i++) {
            simWins[i] = currentWins[i];
            simGames[i] = currentGames[i];
            simPoints[i] = currentPoints[i];
        }

        // Simulate each remaining match
        for (let m = 0; m < X; m++) {
            const a = remainingA[m];
            const b = remainingB[m];
            simGames[a]++;
            simGames[b]++;

            if (Math.random() < remainingProbA[m]) {
                simWins[a]++;
                if (isUBC) {
                    simPoints[a] += 1; // match win point
                    // PR win point goes deterministically
                    if (remainingPRWinA[m]) simPoints[a] += 1;
                    else simPoints[b] += 1;
                }
            } else {
                simWins[b]++;
                if (isUBC) {
                    simPoints[b] += 1; // match win point
                    if (remainingPRWinA[m]) simPoints[a] += 1;
                    else simPoints[b] += 1;
                }
            }
        }

        const champ = findChampion(simWins, simGames, simPoints, tiebreakerPR, rankingConfig, n);
        champWins[champ]++;
    }

    return champWins;
}

/**
 * Exact brute-force enumeration over all 2^X scenarios.
 * Uses Gray code for O(1) updates per step.
 * Returns Float64Array of weighted championship wins per player.
 */
function simulateExact(setup) {
    const { n, currentWins, currentGames, currentPoints, tiebreakerPR,
            remainingA, remainingB, remainingProbA, rankingConfig, isUBC, remainingPRWinA } = setup;
    const X = remainingA.length;
    const totalScenarios = 1 << X;
    const champWins = new Float64Array(n);

    // Start with all B-wins (mask = 0)
    const simWins = new Int32Array(n);
    const simGames = new Int32Array(n);
    const simPoints = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        simWins[i] = currentWins[i];
        simGames[i] = currentGames[i];
        simPoints[i] = currentPoints[i];
    }

    // Add all games (both players play regardless of outcome)
    for (let m = 0; m < X; m++) {
        simGames[remainingA[m]]++;
        simGames[remainingB[m]]++;
    }

    // Initial state: all B wins
    for (let m = 0; m < X; m++) {
        simWins[remainingB[m]]++;
        if (isUBC) {
            simPoints[remainingB[m]] += 1; // match win
            if (remainingPRWinA[m]) simPoints[remainingA[m]] += 1;
            else simPoints[remainingB[m]] += 1;
        }
    }

    // Compute initial weight (all B wins)
    let logWeight = 0;
    for (let m = 0; m < X; m++) {
        logWeight += Math.log(1 - remainingProbA[m]);
    }

    // Process scenario 0 (all B wins)
    let weight = Math.exp(logWeight);
    let champ = findChampion(simWins, simGames, simPoints, tiebreakerPR, rankingConfig, n);
    champWins[champ] += weight;

    // Gray code iteration
    let prevGray = 0;
    for (let i = 1; i < totalScenarios; i++) {
        const gray = i ^ (i >> 1);
        const changed = prevGray ^ gray;
        // Find the bit that changed
        const bit = Math.log2(changed) | 0;
        const a = remainingA[bit];
        const b = remainingB[bit];

        if (gray & changed) {
            // Bit turned on: switch from B-win to A-win
            simWins[b]--;
            simWins[a]++;
            if (isUBC) {
                simPoints[b] -= 1; // remove B match win
                simPoints[a] += 1; // add A match win
            }
            // Update weight: multiply by probA / (1-probA)
            const pA = remainingProbA[bit];
            weight *= pA / (1 - pA);
        } else {
            // Bit turned off: switch from A-win to B-win
            simWins[a]--;
            simWins[b]++;
            if (isUBC) {
                simPoints[a] -= 1;
                simPoints[b] += 1;
            }
            const pA = remainingProbA[bit];
            weight *= (1 - pA) / pA;
        }

        champ = findChampion(simWins, simGames, simPoints, tiebreakerPR, rankingConfig, n);
        champWins[champ] += weight;
        prevGray = gray;
    }

    return champWins;
}

/**
 * Main entry point: predict championship probabilities.
 *
 * @param {Object} params
 * @param {Map} params.statsMap          - Map<player, stats> from computeAllStats
 * @param {Array} params.remainingMatches - Unplayed match objects [{playerA, playerB, ...}]
 * @param {number} params.matchLength     - Target score (e.g. 7)
 * @param {Object} params.leagueConfig    - From getLeagueConfig
 * @param {Map} params.last300Map         - Map<player, last300PR>
 * @param {Set} params.allPlayers         - Set of all player names
 * @returns {Object} { rankings, moe, method, iterations }
 */
export function predictChampionship({ statsMap, remainingMatches, matchLength, leagueConfig, last300Map, allPlayers }) {
    const players = [...allPlayers].filter(p => p !== 'Bye');
    const n = players.length;
    const playerIdx = new Map();
    players.forEach((p, i) => playerIdx.set(p, i));

    const mlIdx = nearestMatchLengthIdx(matchLength);
    const isUBC = leagueConfig.type === 'ubc';

    // Build current standings arrays
    const currentWins = new Int32Array(n);
    const currentGames = new Int32Array(n);
    const currentPoints = new Int32Array(n);
    const leagueMeanPR = new Float64Array(n); // league mean PR (0 if no data)

    for (let i = 0; i < n; i++) {
        const stats = statsMap.get(players[i]);
        if (stats) {
            currentWins[i] = stats.wins || 0;
            currentGames[i] = stats.games || 0;
            currentPoints[i] = stats.points || 0;
            leagueMeanPR[i] = stats.meanPR || 0;
        }
    }

    // Effective PR: league meanPR if player has games with PR data, else last300PR, else 10.0
    const effectivePR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const stats = statsMap.get(players[i]);
        if (stats && stats.games > 0 && leagueMeanPR[i] > 0) {
            effectivePR[i] = leagueMeanPR[i];
        } else if (last300Map.has(players[i]) && last300Map.get(players[i]) != null) {
            effectivePR[i] = last300Map.get(players[i]);
        } else {
            effectivePR[i] = 10.0;
        }
    }

    // Tiebreaker PR: weighted avg of league meanPR (played) + last300PR (for remaining)
    // Count remaining matches per player
    const remainingCount = new Int32Array(n);
    for (let m = 0; m < remainingMatches.length; m++) {
        const ai = playerIdx.get(remainingMatches[m].playerA);
        const bi = playerIdx.get(remainingMatches[m].playerB);
        if (ai !== undefined) remainingCount[ai]++;
        if (bi !== undefined) remainingCount[bi]++;
    }

    const tiebreakerPR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const last300 = (last300Map.has(players[i]) && last300Map.get(players[i]) != null)
            ? last300Map.get(players[i]) : effectivePR[i];
        const played = currentGames[i];
        const rem = remainingCount[i];
        const total = played + rem;
        if (total > 0 && played > 0) {
            tiebreakerPR[i] = (leagueMeanPR[i] * played + last300 * rem) / total;
        } else {
            tiebreakerPR[i] = last300;
        }
    }

    // Build remaining matches arrays
    const X = remainingMatches.length;
    const remainingA = new Int32Array(X);
    const remainingB = new Int32Array(X);
    const remainingProbA = new Float64Array(X);
    const remainingPRWinA = new Uint8Array(X); // 1 if player A has better PR

    for (let m = 0; m < X; m++) {
        const match = remainingMatches[m];
        const ai = playerIdx.get(match.playerA);
        const bi = playerIdx.get(match.playerB);
        if (ai === undefined || bi === undefined) continue;
        remainingA[m] = ai;
        remainingB[m] = bi;
        remainingProbA[m] = getWinProbability(effectivePR[ai], effectivePR[bi], mlIdx);
        remainingPRWinA[m] = effectivePR[ai] <= effectivePR[bi] ? 1 : 0;
    }

    const setup = {
        n, currentWins, currentGames, currentPoints, tiebreakerPR,
        remainingA, remainingB, remainingProbA, rankingConfig: leagueConfig.ranking,
        isUBC, remainingPRWinA
    };

    // Choose method and run
    let champWins;
    let method;
    let iterations;

    if (X > 20) {
        iterations = Math.floor(50_000_000 / X);
        method = 'montecarlo';
        champWins = simulateMonteCarlo(setup, iterations);
    } else if (X > 0) {
        iterations = 1 << X;
        method = 'exact';
        champWins = simulateExact(setup);
    } else {
        // No remaining matches — current standings are final
        iterations = 0;
        method = 'exact';
        champWins = new Float64Array(n);
        const champ = findChampion(currentWins, currentGames, currentPoints, tiebreakerPR, leagueConfig.ranking, n);
        champWins[champ] = 1;
    }

    // Normalize to percentages
    const total = method === 'montecarlo' ? iterations : champWins.reduce((s, v) => s + v, 0);
    const rankings = players.map((player, i) => {
        const stats = statsMap.get(player);
        const pct = total > 0 ? (champWins[i] / total) * 100 : 0;
        return {
            player,
            championshipPct: pct,
            games: stats ? stats.games : 0,
            wins: stats ? stats.wins : 0,
            losses: stats ? stats.losses : 0,
            meanPR: stats ? stats.meanPR : null,
            winRate: stats ? stats.winRate : null
        };
    });

    // Sort by championship % DESC
    rankings.sort((a, b) => b.championshipPct - a.championshipPct);

    // Compute Margin of Error for leading player (MC only)
    let moe = 0;
    if (method === 'montecarlo' && rankings.length > 0) {
        const p = rankings[0].championshipPct / 100;
        moe = 1.96 * Math.sqrt(p * (1 - p) / iterations) * 100;
    }

    return { rankings, moe, method, iterations };
}
