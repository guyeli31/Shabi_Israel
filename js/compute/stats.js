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

        // Technical match: PR/Luck are null — count games/wins/losses but not PR/Luck averages
        const isTechnical = prSelf === null || prOpp === null;

        games++;
        const matchWin = scoreSelf > scoreOpp;
        if (m._draw) {
            // Technical draw: neither win nor loss
        } else if (matchWin) {
            wins++;
        } else if (scoreSelf < scoreOpp) {
            losses++;
        }

        if (!isTechnical) {
            const prWin = prSelf < prOpp;
            if (prWin) prWins++;
            points += (matchWin ? 1 : 0) + (prWin ? 1 : 0);

            prValues.push(prSelf);
            oppPrValues.push(prOpp);
            luckValues.push(luckSelf);
            oppLuckValues.push(luckOpp);
        } else {
            // Technical win/loss: award points for match win only, no PR win possible
            points += (matchWin ? 1 : 0);
        }
    }

    const hasPR = prValues.length > 0;
    const meanPR = hasPR ? mean(prValues) : null;
    const highestPR = hasPR ? Math.max(...prValues) : null;
    const lowestPR = hasPR ? Math.min(...prValues) : null;
    const oppMeanPR = hasPR ? mean(oppPrValues) : null;
    const luck = hasPR ? mean(luckValues) - mean(oppLuckValues) : null;
    const winRate = games > 0 ? wins / games : null;

    const avgPoints = games > 0 ? points / games : null;

    return { games, wins, losses, winRate, meanPR, highestPR, lowestPR, oppMeanPR, luck, prWins, points, avgPoints };
}

function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}
