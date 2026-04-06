/**
 * stats.js — Compute per-player statistics from match data.
 */

import { getAllPlayers } from '../data/csvParser.js';

/**
 * Compute stats for all players in a league.
 * Input: array of match objects from csvParser.
 * Returns: Map<playerName, statsObject>
 *
 * Stats per player:
 *   games, wins, losses, winRate, meanPR, highestPR, lowestPR, oppMeanPR, luck
 */
export function computeAllStats(matches, allPlayers) {
    const players = getAllPlayers(matches);
    const statsMap = new Map();

    for (const player of players) {
        statsMap.set(player, computePlayerStats(matches, player));
    }

    // Add unplayed players (in allPlayers but not in matches) with null stats
    if (allPlayers) {
        for (const player of allPlayers) {
            if (!statsMap.has(player)) {
                statsMap.set(player, {
                    games: 0, wins: 0, losses: 0,
                    winRate: null, meanPR: null, highestPR: null,
                    lowestPR: null, oppMeanPR: null, luck: null,
                    prWins: 0, points: null, avgPoints: null
                });
            }
        }
    }

    return statsMap;
}

function computePlayerStats(matches, playerName) {
    const prValues = [];
    const oppPrValues = [];
    const luckValues = [];
    const oppLuckValues = [];
    let games = 0;
    let wins = 0;
    let losses = 0;
    let prWins = 0;
    let points = 0;

    for (const m of matches) {
        let scoreSelf, scoreOpp, prSelf, prOpp, luckSelf, luckOpp;

        if (m.playerA === playerName) {
            scoreSelf = m.scoreA; scoreOpp = m.scoreB;
            prSelf = m.prA; prOpp = m.prB;
            luckSelf = m.luckA; luckOpp = m.luckB;
        } else if (m.playerB === playerName) {
            scoreSelf = m.scoreB; scoreOpp = m.scoreA;
            prSelf = m.prB; prOpp = m.prA;
            luckSelf = m.luckB; luckOpp = m.luckA;
        } else {
            continue;
        }

        games++;
        const matchWin = scoreSelf > scoreOpp;
        if (matchWin) wins++;
        else if (scoreSelf < scoreOpp) losses++;

        const prWin = prSelf < prOpp;
        if (prWin) prWins++;
        points += (matchWin ? 1 : 0) + (prWin ? 1 : 0);

        prValues.push(prSelf);
        oppPrValues.push(prOpp);
        luckValues.push(luckSelf);
        oppLuckValues.push(luckOpp);
    }

    const meanPR = games > 0 ? mean(prValues) : 0;
    const highestPR = games > 0 ? Math.max(...prValues) : 0;
    const lowestPR = games > 0 ? Math.min(...prValues) : 0;
    const oppMeanPR = games > 0 ? mean(oppPrValues) : 0;
    const luck = games > 0 ? mean(luckValues) - mean(oppLuckValues) : 0;
    const winRate = games > 0 ? wins / games : 0;

    const avgPoints = games > 0 ? points / games : 0;

    return { games, wins, losses, winRate, meanPR, highestPR, lowestPR, oppMeanPR, luck, prWins, points, avgPoints };
}

function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}
