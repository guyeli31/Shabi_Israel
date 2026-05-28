// compute/stats.js — per-player statistics derived from a match list.
//
// Pure logic: takes match objects (from data/csvParser) and an optional
// roster of all league players (so unplayed entrants still appear in the
// table with null stats) and returns Map<name, stats>.

import { getAllPlayers } from "../data/csvParser.js";

function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
    const avg = mean(arr);
    const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}

function emptyStats() {
    return {
        games: 0, wins: 0, losses: 0,
        winRate: null, meanPR: null, prStd: null,
        highestPR: null, lowestPR: null, oppMeanPR: null,
        luck: null,
        prWins: 0, points: null, avgPoints: null,
    };
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

        // Technical matches carry null PR/luck — count the game but exclude
        // it from the PR/luck averages and from PR-win/points credit.
        const isTechnical = prSelf === null || prOpp === null;

        games++;
        const matchWin = scoreSelf > scoreOpp;
        if (m._draw) {
            // technical draw: neither win nor loss
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
            // Technical win/loss: match-win point only, no PR win possible.
            points += matchWin ? 1 : 0;
        }
    }

    const hasPR = prValues.length > 0;
    return {
        games, wins, losses,
        winRate: games > 0 ? wins / games : null,
        meanPR: hasPR ? mean(prValues) : null,
        prStd: prValues.length >= 3 ? stdDev(prValues) : null,
        highestPR: hasPR ? Math.max(...prValues) : null,
        lowestPR: hasPR ? Math.min(...prValues) : null,
        oppMeanPR: hasPR ? mean(oppPrValues) : null,
        luck: hasPR ? mean(luckValues) - mean(oppLuckValues) : null,
        prWins,
        points,
        avgPoints: games > 0 ? points / games : null,
    };
}

/**
 * Stats for every player who appears in `matches`, plus any entrants in
 * `allPlayers` who do not (they receive an emptyStats() placeholder).
 */
export function computeAllStats(matches, allPlayers) {
    const players = getAllPlayers(matches);
    const statsMap = new Map();

    for (const player of players) {
        statsMap.set(player, computePlayerStats(matches, player));
    }
    if (allPlayers) {
        for (const player of allPlayers) {
            if (!statsMap.has(player)) statsMap.set(player, emptyStats());
        }
    }
    return statsMap;
}
