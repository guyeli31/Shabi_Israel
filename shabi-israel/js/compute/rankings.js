/**
 * rankings.js — Sort players, assign ranks, and determine skill levels.
 *
 * ONE DOOR: call rankLeague(). It is the only supported way to turn a league's
 * matches into a ranked table, and it exists because the two-step form it
 * replaces —
 *
 *     const statsMap = computeAllStats(matches, players);
 *     const rankings = buildRankings(statsMap, config, matches);   // ← twice!
 *
 * — asked every caller to hand the SAME match list to two different functions,
 * and then quietly produced a plausible-looking wrong answer if they didn't.
 * A caller could pass it to one and not the other (which is exactly what
 * crossLeague.js did, misnaming the winner of every REGULAR league that ended
 * in a tie), or pass two DIFFERENT lists and rank one view of the season by
 * another view's tiebreaks. Neither mistake is visible at the call site.
 *
 * rankLeague() takes the match list once, so there is nothing left to get
 * wrong. buildRankings() stays exported for tests and now REFUSES to run a
 * tiebreak-carrying league type without its matches instead of skipping the
 * tiebreak in silence.
 */

import { computeAllStats } from './stats.js';
import { resolveTie, needsMatchData, assertTablesFor } from './tiebreaks.js';

/**
 * Level thresholds based on MeanPR.
 * Lower PR = better player.
 */
const LEVELS = [
    { max: 2.5,  label: 'World Champ' },
    { max: 5,    label: 'World Class' },
    { max: 7.5,  label: 'Expert' },
    { max: 12.5, label: 'Advanced' },
    { max: 17.5, label: 'Intermediate' },
    { max: 22.5, label: 'Casual Player' },
    { max: 30,   label: 'Beginner' },
    { max: Infinity, label: 'Distracted' }
];

/**
 * Get the skill level string for a given MeanPR value.
 */
export function getLevel(meanPR) {
    if (meanPR === null) return 'N/A';
    for (const level of LEVELS) {
        if (meanPR <= level.max) return level.label;
    }
    return 'Distracted';
}

/**
 * Match tables for the tiebreak cascade, in THIS runtime's shape: Maps keyed
 * by player name, wrapped in the lookup contract compute/tiebreaks.js defines.
 * Members here are ranking ROW OBJECTS, so each lookup reads .player itself —
 * the rules stay ignorant of what a member is, which is what lets the Monte
 * Carlo hand them array indices instead and run the very same policy.
 */
function buildMatchTables(matches) {
    const pairWins = new Map();
    const pairDiff = new Map();
    const totalDiff = new Map();
    const ensure = (map, k) => {
        if (!map.has(k)) map.set(k, new Map());
        return map.get(k);
    };
    for (const m of (matches || [])) {
        if (m.played === false) continue;
        const { playerA, playerB } = m;
        if (playerA === 'Bye' || playerB === 'Bye') continue;
        const scoreA = m.scoreA || 0;
        const scoreB = m.scoreB || 0;
        const diff = scoreA - scoreB;

        const winA = ensure(pairWins, playerA);
        const winB = ensure(pairWins, playerB);
        winA.set(playerB, (winA.get(playerB) || 0) + (scoreA > scoreB ? 1 : 0));
        winB.set(playerA, (winB.get(playerA) || 0) + (scoreB > scoreA ? 1 : 0));

        const diffA = ensure(pairDiff, playerA);
        const diffB = ensure(pairDiff, playerB);
        diffA.set(playerB, (diffA.get(playerB) || 0) + diff);
        diffB.set(playerA, (diffB.get(playerA) || 0) - diff);

        totalDiff.set(playerA, (totalDiff.get(playerA) || 0) + diff);
        totalDiff.set(playerB, (totalDiff.get(playerB) || 0) - diff);
    }
    return {
        pairWins:  (a, b) => pairWins.get(a.player)?.get(b.player) || 0,
        pairDiff:  (a, b) => pairDiff.get(a.player)?.get(b.player) || 0,
        totalDiff: (a)    => totalDiff.get(a.player) || 0,
        name:      (a)    => a.player
    };
}

/**
 * Build a ranked table from a stats map.
 * Input: Map<playerName, statsObject> from stats.js
 * Returns: Array of { rank, player, games, wins, losses, winRate, meanPR, level, luck }
 *          sorted by config-driven primary/secondary, then the league type's
 *          tiebreak cascade (see compute/tiebreaks.js).
 */
export function buildRankings(statsMap, leagueConfig, matches = null) {
    // A league type whose ranking is only half-decided by the sort (REGULAR:
    // everyone tied after Win Rate → Wins is separated by the cascade below)
    // cannot be ranked from the stats alone. Silently skipping the cascade left
    // the tied group in Map insertion order — a wrong champion, reported with
    // total confidence. Missing matches is now a crash, not a different answer.
    const steps = (leagueConfig && leagueConfig.ranking && leagueConfig.ranking.tiebreaks) || [];
    if (needsMatchData(steps) && !matches) {
        throw new Error(
            `buildRankings: league type "${leagueConfig.type}" resolves ties from the match list, ` +
            `which was not supplied. Call rankLeague({ matches, allPlayers, config }) instead.`
        );
    }

    const rows = [];

    for (const [player, s] of statsMap) {
        rows.push({
            rank: 0,
            player,
            games: s.games,
            wins: s.wins,
            losses: s.losses,
            winRate: s.winRate,
            meanPR: s.meanPR,
            level: getLevel(s.meanPR),
            luck: s.luck,
            prWins: s.prWins,
            points: s.points,
            avgPoints: s.avgPoints
        });
    }

    // Config-driven sort with null/unplayed handling
    const ranking = leagueConfig
        ? leagueConfig.ranking
        : { primary: 'winRate', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc' };
    const { primary, primaryDir, secondary, secondaryDir } = ranking;

    rows.sort((a, b) => {
        const aNull = a[primary] === null;
        const bNull = b[primary] === null;

        if (aNull && bNull) return a.player.localeCompare(b.player);
        if (aNull) return b[primary] > 0 ? 1 : -1;
        if (bNull) return a[primary] > 0 ? -1 : 1;

        const pMul = primaryDir === 'desc' ? -1 : 1;
        if (a[primary] !== b[primary]) return pMul * (a[primary] - b[primary]);

        if (secondary === 'player') return a.player.localeCompare(b.player);
        const aSecNull = a[secondary] === null;
        const bSecNull = b[secondary] === null;
        if (aSecNull && bSecNull) return a.player.localeCompare(b.player);
        if (aSecNull) return 1;
        if (bSecNull) return -1;
        const sMul = secondaryDir === 'asc' ? 1 : -1;
        return sMul * (a[secondary] - b[secondary]);
    });

    // Whoever is still tied on the primary gets the league type's tiebreak
    // cascade — WHICH criteria and in WHICH order is not decided here, it is
    // read from leagueTypes.js. This block knows only how to find a tied group
    // and how to look a number up (buildMatchTables); the policy itself is
    // shared verbatim with the championship predictor.
    if (steps.length) {
        const tables = buildMatchTables(matches);
        assertTablesFor(steps, tables, 'rankings.js');
        let i = 0;
        while (i < rows.length) {
            let j = i + 1;
            while (j < rows.length && rows[j][primary] === rows[i][primary]) j++;
            if (j - i > 1) {
                const resolved = resolveTie(rows.slice(i, j), steps, tables);
                rows.splice(i, j - i, ...resolved);
            }
            i = j;
        }
    }

    // Assign ranks
    rows.forEach((row, i) => {
        row.rank = i + 1;
        row.originalRank = i + 1;
    });

    return rows;
}

/**
 * THE one way to rank a league. Takes the match list ONCE and derives both the
 * stats and the ranked table from it, so the two can never be computed from
 * different views of the season and the tiebreak can never go missing.
 *
 * Every "view" of a league is just a different match list: the live season, a
 * historical snapshot, a match-length filter, a what-if simulation. Pass that
 * list here and both halves of the answer stay in step with it.
 *
 * @param {object} input
 *   matches    — the played matches THIS view is about
 *   allPlayers — full roster (so a 0-game player still gets a row)
 *   config     — getLeagueConfig(params)
 * @returns {{ statsMap: Map, rankings: Array }}
 */
export function rankLeague({ matches, allPlayers, config }) {
    const statsMap = computeAllStats(matches, allPlayers);
    const rankings = buildRankings(statsMap, config, matches);
    return { statsMap, rankings };
}

/**
 * Compute averages for the summary row.
 */
export function computeAverages(rankings, leagueConfig) {
    const played = rankings.filter(r => r.games > 0);
    if (played.length === 0) return null;
    const n = played.length;
    const withPR = played.filter(r => r.meanPR !== null);
    const nPR = withPR.length;
    const avg = {
        games: (played.reduce((s, r) => s + r.games, 0) / n),
        wins: (played.reduce((s, r) => s + r.wins, 0) / n),
        losses: (played.reduce((s, r) => s + r.losses, 0) / n),
        winRate: (played.reduce((s, r) => s + r.winRate, 0) / n),
        meanPR: nPR > 0 ? (withPR.reduce((s, r) => s + r.meanPR, 0) / nPR) : null,
        luck: nPR > 0 ? (withPR.reduce((s, r) => s + r.luck, 0) / nPR) : null
    };
    if (leagueConfig && leagueConfig.showPRWins) {
        avg.prWins = (played.reduce((s, r) => s + r.prWins, 0) / n);
        avg.points = (played.reduce((s, r) => s + (r.points || 0), 0) / n);
        avg.avgPoints = (played.reduce((s, r) => s + (r.avgPoints || 0), 0) / n);
    }
    return avg;
}

/**
 * Compute match stats: played matches, total possible, ratio.
 */
export function computeMatchStats(rankings, totalPlayers) {
    const n = totalPlayers || rankings.length;
    const totalGames = rankings.reduce((s, r) => s + r.games, 0);
    const playedMatches = totalGames / 2;
    const totalMatches = n * (n - 1) / 2;
    const playedRatio = totalMatches > 0 ? playedMatches / totalMatches : 0;
    return { playedMatches, totalMatches, playedRatio };
}

export { LEVELS };
