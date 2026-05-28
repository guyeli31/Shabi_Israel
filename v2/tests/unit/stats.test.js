// Pure-logic tests for src/compute/stats.js.

import { describe, it, expect } from "vitest";
import { computeAllStats } from "../../src/compute/stats.js";

function m(playerA, prA, scoreA, playerB, prB, scoreB, luckA = 0, luckB = 0) {
    return { playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB };
}

describe("computeAllStats", () => {
    it("computes basic win/loss/games", () => {
        const matches = [
            m("Alice", 5, 1, "Bob", 7, 0),
            m("Alice", 4, 1, "Carol", 9, 0),
            m("Bob",   6, 1, "Carol", 8, 0),
        ];
        const s = computeAllStats(matches);
        expect(s.get("Alice")).toMatchObject({ games: 2, wins: 2, losses: 0, winRate: 1 });
        expect(s.get("Bob")).toMatchObject({ games: 2, wins: 1, losses: 1, winRate: 0.5 });
        expect(s.get("Carol")).toMatchObject({ games: 2, wins: 0, losses: 2, winRate: 0 });
    });

    it("computes meanPR and oppMeanPR", () => {
        const matches = [
            m("Alice", 4, 1, "Bob", 8, 0),
            m("Alice", 6, 0, "Carol", 5, 1),
        ];
        const a = computeAllStats(matches).get("Alice");
        expect(a.meanPR).toBeCloseTo(5);
        expect(a.oppMeanPR).toBeCloseTo(6.5);
        expect(a.highestPR).toBe(6);
        expect(a.lowestPR).toBe(4);
    });

    it("luck = mean(selfLuck) - mean(oppLuck)", () => {
        const matches = [
            m("Alice", 5, 1, "Bob", 7, 0, 0.5, -0.5),
            m("Alice", 4, 1, "Carol", 9, 0, -0.1, 0.3),
        ];
        const a = computeAllStats(matches).get("Alice");
        // selfLuck mean = 0.2, oppLuck mean = -0.1 ⇒ 0.3
        expect(a.luck).toBeCloseTo(0.3);
    });

    it("computes prWins, points, and avgPoints (UBC fields)", () => {
        const matches = [
            m("Alice", 4, 1, "Bob", 8, 0),   // Alice: match win + PR win
            m("Alice", 6, 0, "Carol", 4, 1), // Alice: 0 + 0
            m("Bob",   7, 1, "Carol", 9, 0), // Bob: match win + PR win
        ];
        const s = computeAllStats(matches);
        expect(s.get("Alice").prWins).toBe(1);
        expect(s.get("Alice").points).toBe(2);
        expect(s.get("Alice").avgPoints).toBeCloseTo(1);
        expect(s.get("Bob").points).toBe(2);
    });

    it("excludes technical (null-PR) matches from PR/luck averages but counts the game", () => {
        const matches = [
            m("Alice", 5, 1, "Bob", 7, 0),
            { playerA: "Alice", playerB: "Carol",
              scoreA: 1, scoreB: 0, prA: null, prB: null, luckA: null, luckB: null,
              _technical: true },
        ];
        const a = computeAllStats(matches).get("Alice");
        expect(a.games).toBe(2);
        expect(a.wins).toBe(2);
        expect(a.meanPR).toBeCloseTo(5);  // technical excluded from PR avg
        expect(a.points).toBe(3);         // 1 (match+PR) + 1 (technical match-win, no PR win)
        expect(a.prWins).toBe(1);
    });

    it("technical draw is neither win nor loss", () => {
        const matches = [
            { playerA: "Alice", playerB: "Bob",
              scoreA: 0, scoreB: 0, prA: null, prB: null, luckA: null, luckB: null,
              _technical: true, _draw: true },
        ];
        const a = computeAllStats(matches).get("Alice");
        expect(a.games).toBe(1);
        expect(a.wins).toBe(0);
        expect(a.losses).toBe(0);
    });

    it("emits emptyStats() for roster members with no matches", () => {
        const matches = [m("Alice", 5, 1, "Bob", 7, 0)];
        const roster = new Set(["Alice", "Bob", "Carol"]);
        const s = computeAllStats(matches, roster);
        expect(s.has("Carol")).toBe(true);
        expect(s.get("Carol")).toMatchObject({
            games: 0, wins: 0, winRate: null, meanPR: null,
        });
    });
});
