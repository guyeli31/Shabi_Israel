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
 * Build head-to-head tables from played matches, for the REGULAR tiebreak.
 *   pairWins.get(a).get(b)  = # matches a beat b
 *   pairDiff.get(a).get(b)  = Σ (a's score − b's score) over a-vs-b matches
 *   totalDiff.get(a)        = Σ (a's score − opponent's score) over ALL a's matches
 */
function buildRegularTables(matches) {
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
    return { pairWins, pairDiff, totalDiff };
}

/**
 * Resolve a group of players tied on Win Rate, by the REGULAR cascade,
 * applied to the *still-tied* subgroup at each level:
 *   (a) head-to-head wins among the subgroup
 *   (b) points-difference among the subgroup
 *   (c) points-difference across all league matches
 *   (d) alphabetical (deterministic final fallback)
 * `members` are row objects; returns them in resolved order.
 */
function resolveRegularTie(members, level, tables) {
    if (members.length <= 1) return members;
    if (level >= 3) {
        return [...members].sort((a, b) => a.player.localeCompare(b.player));
    }
    const { pairWins, pairDiff, totalDiff } = tables;
    const names = members.map(r => r.player);

    const value = (r) => {
        if (level === 0) {
            const w = pairWins.get(r.player);
            let s = 0;
            for (const o of names) if (o !== r.player) s += (w && w.get(o)) || 0;
            return s;
        }
        if (level === 1) {
            const d = pairDiff.get(r.player);
            let s = 0;
            for (const o of names) if (o !== r.player) s += (d && d.get(o)) || 0;
            return s;
        }
        return totalDiff.get(r.player) || 0;
    };

    const sorted = [...members].sort((a, b) => value(b) - value(a));
    const out = [];
    let i = 0;
    while (i < sorted.length) {
        let j = i + 1;
        const vi = value(sorted[i]);
        while (j < sorted.length && value(sorted[j]) === vi) j++;
        const sub = sorted.slice(i, j);
        if (sub.length === 1) out.push(sub[0]);
        else out.push(...resolveRegularTie(sub, level + 1, tables));
        i = j;
    }
    return out;
}

/**
 * Build a ranked table from a stats map.
 * Input: Map<playerName, statsObject> from stats.js
 * Returns: Array of { rank, player, games, wins, losses, winRate, meanPR, level, luck }
 *          sorted by config-driven primary/secondary, with optional H2H tiebreaker.
 */
export function buildRankings(statsMap, leagueConfig, matches = null) {
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

    // REGULAR tiebreak: players tied on Win Rate (primary) are resolved by the
    // (a) H2H wins → (b) internal points-diff → (c) total points-diff → alphabetical
    // cascade, narrowing over the still-tied subgroup at each level.
    if (ranking.h2hTiebreak && matches) {
        const tables = buildRegularTables(matches);
        let i = 0;
        while (i < rows.length) {
            let j = i + 1;
            while (j < rows.length && rows[j][primary] === rows[i][primary]) j++;
            if (j - i > 1) {
                const resolved = resolveRegularTie(rows.slice(i, j), 0, tables);
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
