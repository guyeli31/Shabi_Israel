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
    if (meanPR === null) return 'N/A';
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
export function buildRankings(statsMap, leagueConfig) {
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
    const { primary, primaryDir, secondary, secondaryDir } = leagueConfig
        ? leagueConfig.ranking
        : { primary: 'winRate', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc' };

    rows.sort((a, b) => {
        const aNull = a[primary] === null;
        const bNull = b[primary] === null;

        if (aNull && bNull) return a.player.localeCompare(b.player);
        if (aNull) return b[primary] > 0 ? 1 : -1;
        if (bNull) return a[primary] > 0 ? -1 : 1;

        const pMul = primaryDir === 'desc' ? -1 : 1;
        if (a[primary] !== b[primary]) return pMul * (a[primary] - b[primary]);

        if (secondary === 'player') return a.player.localeCompare(b.player);
        const sMul = secondaryDir === 'asc' ? 1 : -1;
        return sMul * (a[secondary] - b[secondary]);
    });

    // Assign ranks
    rows.forEach((row, i) => {
        row.rank = i + 1;
        row.originalRank = i + 1;
    });

    return rows;
}

/**
 * Compute averages for the summary row.
 */
export function computeAverages(rankings, leagueConfig) {
    const played = rankings.filter(r => r.games > 0);
    if (played.length === 0) return null;
    const n = played.length;
    const avg = {
        games: (played.reduce((s, r) => s + r.games, 0) / n),
        wins: (played.reduce((s, r) => s + r.wins, 0) / n),
        losses: (played.reduce((s, r) => s + r.losses, 0) / n),
        winRate: (played.reduce((s, r) => s + r.winRate, 0) / n),
        meanPR: (played.reduce((s, r) => s + r.meanPR, 0) / n),
        luck: (played.reduce((s, r) => s + r.luck, 0) / n)
    };
    if (leagueConfig && leagueConfig.showPRWins) {
        avg.prWins = (played.reduce((s, r) => s + r.prWins, 0) / n);
        avg.points = (played.reduce((s, r) => s + r.points, 0) / n);
        avg.avgPoints = (played.reduce((s, r) => s + r.avgPoints, 0) / n);
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
