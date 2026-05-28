// Pure-logic tests for src/data/matchHistory.js (no fetch path).

import { describe, it, expect } from "vitest";
import {
    matchKey,
    mergeHistoryIntoMatches,
    getMatchesAsOf,
    getUpdateDates,
} from "../../src/data/matchHistory.js";

describe("matchKey", () => {
    it("is unordered (A,B and B,A produce identical keys)", () => {
        expect(matchKey("Alice", "Bob")).toBe(matchKey("Bob", "Alice"));
    });
});

describe("mergeHistoryIntoMatches", () => {
    it("returns the CSV array unchanged if history is empty", () => {
        const csv = [{ playerA: "Alice", playerB: "Bob", scoreA: 1, scoreB: 0 }];
        expect(mergeHistoryIntoMatches(csv, [])).toBe(csv);
    });

    it("replaces a CSV match when a history entry shares the same unordered key", () => {
        const csv = [
            { playerA: "Alice", playerB: "Bob",   scoreA: 1, scoreB: 0, prA: 5, prB: 7, luckA: 0, luckB: 0 },
            { playerA: "Alice", playerB: "Carol", scoreA: 0, scoreB: 1, prA: 8, prB: 4, luckA: 0, luckB: 0 },
        ];
        const history = [
            { playerA: "Bob", playerB: "Alice", scoreA: 1, scoreB: 0, prA: 4.5, prB: 6.2,
              luckA: 0.1, luckB: -0.1, round: 1, updatedAt: "2026-04-01T12:00:00Z", source: "manual" },
        ];
        const merged = mergeHistoryIntoMatches(csv, history);
        expect(merged).toHaveLength(2);
        const aliceBob = merged.find((m) =>
            [m.playerA, m.playerB].sort().join("|") === ["Alice", "Bob"].sort().join("|"));
        expect(aliceBob.prA).toBe(4.5);
        expect(aliceBob.source).toBe("manual");
    });

    it("appends history-only matches when not present in CSV", () => {
        const csv = [];
        const history = [
            { playerA: "Alice", playerB: "Bob", scoreA: 1, scoreB: 0, prA: 5, prB: 7,
              luckA: 0, luckB: 0, round: 1, updatedAt: "2026-04-02T00:00:00Z", source: "manual" },
        ];
        const merged = mergeHistoryIntoMatches(csv, history);
        expect(merged).toHaveLength(1);
        expect(merged[0].playerA).toBe("Alice");
    });
});

describe("getMatchesAsOf", () => {
    const history = {
        matches: [
            { playerA: "Alice", playerB: "Bob",   updatedAt: "2026-04-01T10:00:00Z" },
            { playerA: "Alice", playerB: "Carol", updatedAt: "2026-04-05T10:00:00Z" },
            { playerA: "Bob",   playerB: "Carol", updatedAt: null },
        ],
    };
    it("filters by cutoff date inclusive", () => {
        const before = getMatchesAsOf(history, "2026-04-02T00:00:00Z");
        expect(before).toHaveLength(1);
    });
    it("excludes matches with no updatedAt under a cutoff", () => {
        const before = getMatchesAsOf(history, "2026-04-10T00:00:00Z");
        expect(before).toHaveLength(2);
    });
    it("returns a copy of all matches when no cutoff is provided", () => {
        const all = getMatchesAsOf(history, null);
        expect(all).toHaveLength(3);
    });
});

describe("getUpdateDates", () => {
    it("returns unique yyyy-mm-dd days, descending", () => {
        const history = {
            matches: [
                { updatedAt: "2026-04-01T10:00:00Z" },
                { updatedAt: "2026-04-05T10:00:00Z" },
                { updatedAt: "2026-04-05T18:00:00Z" },
                { updatedAt: null },
            ],
        };
        expect(getUpdateDates(history)).toEqual(["2026-04-05", "2026-04-01"]);
    });
});
