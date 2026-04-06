/**
 * rankings.js — Sort players, assign ranks, and determine skill levels.
 */

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
    for (const level of LEVELS) {
        if (meanPR <= level.max) return level.label;
    }
    return 'Distracted';
}

/**
 * Build a ranked table from a stats map.
 * Input: Map<playerName, statsObject> from stats.js
 * Returns: Array of { rank, player, games, wins, losses, winRate, meanPR, level, luck }
 *          sorted by winRate desc, then meanPR asc.
 */
export function buildRankings(statsMap) {
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
            luck: s.luck
        });
    }

    // Sort: winRate descending, then meanPR ascending (lower is better)
    rows.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return a.meanPR - b.meanPR;
    });

    // Assign ranks
    rows.forEach((row, i) => row.rank = i + 1);

    return rows;
}

/**
 * Compute averages for the summary row.
 */
export function computeAverages(rankings) {
    if (rankings.length === 0) return null;
    const n = rankings.length;
    return {
        games: (rankings.reduce((s, r) => s + r.games, 0) / n),
        wins: (rankings.reduce((s, r) => s + r.wins, 0) / n),
        losses: (rankings.reduce((s, r) => s + r.losses, 0) / n),
        winRate: (rankings.reduce((s, r) => s + r.winRate, 0) / n),
        meanPR: (rankings.reduce((s, r) => s + r.meanPR, 0) / n),
        luck: (rankings.reduce((s, r) => s + r.luck, 0) / n)
    };
}

/**
 * Compute match stats: played matches, total possible, ratio.
 */
export function computeMatchStats(rankings) {
    const totalGames = rankings.reduce((s, r) => s + r.games, 0);
    const playedMatches = totalGames / 2;
    const n = rankings.length;
    const totalMatches = n * (n - 1) / 2;
    const playedRatio = totalMatches > 0 ? playedMatches / totalMatches : 0;
    return { playedMatches, totalMatches, playedRatio };
}

export { LEVELS };
