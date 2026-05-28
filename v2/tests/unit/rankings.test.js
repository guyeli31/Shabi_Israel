// Pure-logic tests for src/compute/rankings.js.

import { describe, it, expect } from "vitest";
import { buildRankings, computeAverages, computeMatchStats, getLevel } from "../../src/compute/rankings.js";
import { getLeagueConfig } from "../../src/compute/leagueTypes.js";

function statsMap(rows) {
    return new Map(rows.map((r) => [r.player, r]));
}

const DOUBLING = getLeagueConfig({ LeagueType: "doubling" });
const REGULAR  = getLeagueConfig({ LeagueType: "regular" });
const UBC      = getLeagueConfig({ LeagueType: "ubc" });

describe("getLevel", () => {
    it("buckets by MeanPR with World Champ at the strong end", () => {
        expect(getLevel(2)).toBe("World Champ");
        expect(getLevel(5)).toBe("World Class");
        expect(getLevel(10)).toBe("Advanced");
        expect(getLevel(25)).toBe("Beginner");
        expect(getLevel(40)).toBe("Distracted");
        expect(getLevel(null)).toBe("N/A");
    });
});

describe("buildRankings — doubling", () => {
    it("sorts by winRate DESC, then meanPR ASC", () => {
        const sm = statsMap([
            { player: "Alice",   games: 4, wins: 3, losses: 1, winRate: 0.75, meanPR: 5,  luck: 0, prWins: 0, points: 0, avgPoints: null },
            { player: "Bob",     games: 4, wins: 2, losses: 2, winRate: 0.5,  meanPR: 6,  luck: 0, prWins: 0, points: 0, avgPoints: null },
            { player: "Carol",   games: 4, wins: 2, losses: 2, winRate: 0.5,  meanPR: 4,  luck: 0, prWins: 0, points: 0, avgPoints: null },
            { player: "Dave",    games: 0, wins: 0, losses: 0, winRate: null, meanPR: null, luck: null, prWins: 0, points: null, avgPoints: null },
        ]);
        const r = buildRankings(sm, DOUBLING);
        expect(r.map((x) => x.player)).toEqual(["Alice", "Carol", "Bob", "Dave"]);
        expect(r[0].rank).toBe(1);
        expect(r[0].originalRank).toBe(1);
    });
});

describe("buildRankings — regular with H2H tiebreak", () => {
    it("breaks a winRate+wins tie by head-to-head wins", () => {
        const sm = statsMap([
            { player: "Alice", games: 2, wins: 1, losses: 1, winRate: 0.5, meanPR: null, luck: null, prWins: 0, points: 0, avgPoints: null },
            { player: "Bob",   games: 2, wins: 1, losses: 1, winRate: 0.5, meanPR: null, luck: null, prWins: 0, points: 0, avgPoints: null },
        ]);
        // Alice beat Bob, Bob beat someone else — but in this group Alice is ahead.
        const matches = [
            { playerA: "Alice", playerB: "Bob",   scoreA: 1, scoreB: 0, prA: 0, prB: 0, luckA: 0, luckB: 0 },
            { playerA: "Alice", playerB: "Carol", scoreA: 0, scoreB: 1, prA: 0, prB: 0, luckA: 0, luckB: 0 },
            { playerA: "Bob",   playerB: "Carol", scoreA: 1, scoreB: 0, prA: 0, prB: 0, luckA: 0, luckB: 0 },
        ];
        const r = buildRankings(sm, REGULAR, matches);
        expect(r[0].player).toBe("Alice");
        expect(r[1].player).toBe("Bob");
    });
});

describe("buildRankings — UBC", () => {
    it("sorts by avgPoints DESC, then meanPR ASC", () => {
        const sm = statsMap([
            { player: "Alice", games: 3, wins: 2, losses: 1, winRate: 2 / 3, meanPR: 5, luck: 0, prWins: 2, points: 4, avgPoints: 4 / 3 },
            { player: "Bob",   games: 3, wins: 1, losses: 2, winRate: 1 / 3, meanPR: 6, luck: 0, prWins: 1, points: 2, avgPoints: 2 / 3 },
        ]);
        const r = buildRankings(sm, UBC);
        expect(r.map((x) => x.player)).toEqual(["Alice", "Bob"]);
    });
});

describe("computeAverages", () => {
    it("averages only over played rows; PR fields only over rows with meanPR", () => {
        const rows = [
            { games: 4, wins: 3, losses: 1, winRate: 0.75, meanPR: 5,  luck:  0.1, prWins: 0, points: 0, avgPoints: 0 },
            { games: 4, wins: 1, losses: 3, winRate: 0.25, meanPR: 8,  luck: -0.2, prWins: 0, points: 0, avgPoints: 0 },
            { games: 0, wins: 0, losses: 0, winRate: null, meanPR: null, luck: null, prWins: 0, points: null, avgPoints: null },
        ];
        const avg = computeAverages(rows, DOUBLING);
        expect(avg.games).toBe(4);
        expect(avg.winRate).toBeCloseTo(0.5);
        expect(avg.meanPR).toBeCloseTo(6.5);
        expect(avg.luck).toBeCloseTo(-0.05);
    });

    it("returns null if nobody has played", () => {
        const rows = [{ games: 0, wins: 0, losses: 0, winRate: null, meanPR: null, luck: null }];
        expect(computeAverages(rows, DOUBLING)).toBe(null);
    });
});

describe("computeMatchStats", () => {
    it("derives playedMatches, totalMatches, and the ratio", () => {
        const rows = [{ games: 2 }, { games: 2 }, { games: 2 }, { games: 0 }];
        const s = computeMatchStats(rows, 4);
        expect(s.playedMatches).toBe(3);
        expect(s.totalMatches).toBe(6);
        expect(s.playedRatio).toBeCloseTo(0.5);
    });
});
