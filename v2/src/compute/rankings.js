// compute/rankings.js — sort, rank, and bucket players by skill level.
//
// Pure logic over the stats map produced by ./stats.js. The sort comparator
// is driven by `leagueConfig.ranking` so the same rankings function serves
// doubling / regular / UBC leagues.

/**
 * Skill bands based on MeanPR. Lower PR ⇒ stronger player.
 * Bands are inclusive of `max`; the last bucket catches the rest.
 */
const LEVELS = [
    { max: 2.5,      label: "World Champ" },
    { max: 5,        label: "World Class" },
    { max: 7.5,      label: "Expert" },
    { max: 12.5,     label: "Advanced" },
    { max: 17.5,     label: "Intermediate" },
    { max: 22.5,     label: "Casual Player" },
    { max: 30,       label: "Beginner" },
    { max: Infinity, label: "Distracted" },
];

export function getLevel(meanPR) {
    if (meanPR === null) return "N/A";
    for (const level of LEVELS) {
        if (meanPR <= level.max) return level.label;
    }
    return "Distracted";
}

/** Head-to-head wins map, used as a tiebreak on regular leagues. */
function buildH2H(matches) {
    const h2h = new Map();
    for (const m of (matches || [])) {
        if (m.played === false) continue;
        const { playerA, playerB, scoreA, scoreB } = m;
        if (!h2h.has(playerA)) h2h.set(playerA, new Map());
        if (!h2h.has(playerB)) h2h.set(playerB, new Map());
        const mapA = h2h.get(playerA);
        const mapB = h2h.get(playerB);
        mapA.set(playerB, (mapA.get(playerB) || 0) + (scoreA > scoreB ? 1 : 0));
        mapB.set(playerA, (mapB.get(playerA) || 0) + (scoreB > scoreA ? 1 : 0));
    }
    return h2h;
}

/**
 * Build a ranked table from a stats map.
 *
 * @param {Map<string,object>} statsMap   - output of computeAllStats
 * @param {object} leagueConfig           - from compute/leagueTypes.js
 * @param {object[]} [matches]            - needed only for H2H tiebreak
 * @returns {object[]} rows, sorted, with `.rank` and `.originalRank` assigned
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
            avgPoints: s.avgPoints,
        });
    }

    const ranking = leagueConfig
        ? leagueConfig.ranking
        : { primary: "winRate", primaryDir: "desc", secondary: "meanPR", secondaryDir: "asc" };
    const { primary, primaryDir, secondary, secondaryDir } = ranking;

    rows.sort((a, b) => {
        const aNull = a[primary] === null;
        const bNull = b[primary] === null;
        if (aNull && bNull) return a.player.localeCompare(b.player);
        if (aNull) return b[primary] > 0 ? 1 : -1;
        if (bNull) return a[primary] > 0 ? -1 : 1;

        const pMul = primaryDir === "desc" ? -1 : 1;
        if (a[primary] !== b[primary]) return pMul * (a[primary] - b[primary]);

        if (secondary === "player") return a.player.localeCompare(b.player);
        const aSecNull = a[secondary] === null;
        const bSecNull = b[secondary] === null;
        if (aSecNull && bSecNull) return a.player.localeCompare(b.player);
        if (aSecNull) return 1;
        if (bSecNull) return -1;
        const sMul = secondaryDir === "asc" ? 1 : -1;
        return sMul * (a[secondary] - b[secondary]);
    });

    // H2H tiebreak: groups where BOTH primary and secondary match get
    // re-sorted by head-to-head wins inside the group.
    if (ranking.h2hTiebreak && matches) {
        const h2h = buildH2H(matches);
        let i = 0;
        while (i < rows.length) {
            let j = i + 1;
            while (
                j < rows.length &&
                rows[j][primary] === rows[i][primary] &&
                rows[j][secondary] === rows[i][secondary]
            ) {
                j++;
            }
            if (j - i > 1) {
                const group = rows.slice(i, j);
                const groupNames = new Set(group.map((r) => r.player));
                group.sort((a, b) => {
                    const aWins = [...groupNames].filter((p) => p !== a.player)
                        .reduce((s, p) => s + (h2h.get(a.player)?.get(p) || 0), 0);
                    const bWins = [...groupNames].filter((p) => p !== b.player)
                        .reduce((s, p) => s + (h2h.get(b.player)?.get(p) || 0), 0);
                    if (aWins !== bWins) return bWins - aWins;
                    return a.player.localeCompare(b.player);
                });
                rows.splice(i, j - i, ...group);
            }
            i = j;
        }
    }

    rows.forEach((row, idx) => {
        row.rank = idx + 1;
        row.originalRank = idx + 1;
    });
    return rows;
}

/** Per-column averages over played rows, for the summary footer. */
export function computeAverages(rankings, leagueConfig) {
    const played = rankings.filter((r) => r.games > 0);
    if (played.length === 0) return null;
    const n = played.length;
    const withPR = played.filter((r) => r.meanPR !== null);
    const nPR = withPR.length;

    const avg = {
        games:   played.reduce((s, r) => s + r.games,   0) / n,
        wins:    played.reduce((s, r) => s + r.wins,    0) / n,
        losses:  played.reduce((s, r) => s + r.losses,  0) / n,
        winRate: played.reduce((s, r) => s + r.winRate, 0) / n,
        meanPR:  nPR > 0 ? withPR.reduce((s, r) => s + r.meanPR, 0) / nPR : null,
        luck:    nPR > 0 ? withPR.reduce((s, r) => s + r.luck,   0) / nPR : null,
    };
    if (leagueConfig && leagueConfig.showPRWins) {
        avg.prWins    = played.reduce((s, r) => s + r.prWins,            0) / n;
        avg.points    = played.reduce((s, r) => s + (r.points    || 0),  0) / n;
        avg.avgPoints = played.reduce((s, r) => s + (r.avgPoints || 0),  0) / n;
    }
    return avg;
}

/** Played matches, total possible matches, and the played-ratio. */
export function computeMatchStats(rankings, totalPlayers) {
    const n = totalPlayers || rankings.length;
    const totalGames = rankings.reduce((s, r) => s + r.games, 0);
    const playedMatches = totalGames / 2;
    const totalMatches = (n * (n - 1)) / 2;
    return {
        playedMatches,
        totalMatches,
        playedRatio: totalMatches > 0 ? playedMatches / totalMatches : 0,
    };
}

export { LEVELS };
