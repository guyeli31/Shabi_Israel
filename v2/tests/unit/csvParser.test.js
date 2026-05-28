// Pure-logic tests for src/data/csvParser.js. No fetch, no DOM.

import { describe, it, expect } from "vitest";
import {
    parseCSV,
    parseCSVAll,
    parseCSVWithRounds,
    parseCSVAllWithRounds,
    getAllPlayersFromCSV,
    countAllPlayers,
    getAllPlayers,
    getPlayerMatches,
} from "../../src/data/csvParser.js";

const SAMPLE = `Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B
Alice,5.1,0.2,1,Bob,7.3,-0.1,0
Bob,6.8,0.0,1,Carol,9.0,0.4,0
Player A,PR A,Luck A,Score A,Player B,PR B,Luck B,Score B
Alice,4.5,0.1,1,Carol,8.2,-0.2,0
Bye,0,0,0,Dave,0,0,0
Alice,0,0,0,Dave,0,0,0
`;

describe("parseCSV", () => {
    it("returns only played, non-Bye rows with header-row skipping", () => {
        const matches = parseCSV(SAMPLE);
        expect(matches).toHaveLength(3);
        expect(matches[0]).toEqual({
            playerA: "Alice", prA: 5.1, luckA: 0.2, scoreA: 1,
            playerB: "Bob",   prB: 7.3, luckB: -0.1, scoreB: 0,
        });
    });

    it("ignores empty rows and rows with fewer than 8 columns", () => {
        const tricky = "Player,a,b,c,d,e,f,g\n\nshort,line\nAlice,1,0,1,Bob,2,0,0\n";
        expect(parseCSV(tricky)).toHaveLength(1);
    });
});

describe("parseCSVAll", () => {
    it("keeps unplayed (all-zero) rows but still drops Byes", () => {
        const matches = parseCSVAll(SAMPLE);
        expect(matches).toHaveLength(4);
        const unplayed = matches.find((m) => m.playerA === "Alice" && m.playerB === "Dave");
        expect(unplayed).toBeDefined();
        expect(unplayed.scoreA).toBe(0);
    });
});

describe("parseCSVWithRounds", () => {
    it("counts a new round per header row", () => {
        const { matches, roundCount } = parseCSVWithRounds(SAMPLE);
        expect(roundCount).toBe(2);
        expect(matches[0].round).toBe(1);
        expect(matches.at(-1).round).toBe(2);
    });
});

describe("parseCSVAllWithRounds", () => {
    it("marks played boolean correctly", () => {
        const { matches } = parseCSVAllWithRounds(SAMPLE);
        const played = matches.find((m) => m.playerA === "Alice" && m.playerB === "Bob");
        const unplayed = matches.find((m) => m.playerA === "Alice" && m.playerB === "Dave");
        expect(played.played).toBe(true);
        expect(unplayed.played).toBe(false);
    });
});

describe("player roster helpers", () => {
    it("getAllPlayersFromCSV omits Bye and yields a Set", () => {
        const set = getAllPlayersFromCSV(SAMPLE);
        expect(set).toBeInstanceOf(Set);
        expect([...set].sort()).toEqual(["Alice", "Bob", "Carol", "Dave"]);
        expect(set.has("Bye")).toBe(false);
    });

    it("countAllPlayers returns the cardinality", () => {
        expect(countAllPlayers(SAMPLE)).toBe(4);
    });

    it("getAllPlayers returns a sorted array from matches", () => {
        const m = parseCSV(SAMPLE);
        expect(getAllPlayers(m)).toEqual(["Alice", "Bob", "Carol"]);
    });
});

describe("getPlayerMatches", () => {
    it("normalises self / opponent regardless of column position", () => {
        const m = parseCSV(SAMPLE);
        const aliceVsBob = getPlayerMatches(m, "Alice").find((x) => x.opponent === "Bob");
        expect(aliceVsBob.scoreSelf).toBe(1);
        expect(aliceVsBob.scoreOpp).toBe(0);
        expect(aliceVsBob.prSelf).toBe(5.1);

        const bobVsAlice = getPlayerMatches(m, "Bob").find((x) => x.opponent === "Alice");
        expect(bobVsAlice.scoreSelf).toBe(0);
        expect(bobVsAlice.scoreOpp).toBe(1);
        expect(bobVsAlice.prSelf).toBe(7.3);
    });

    it("includes unplayed opponents when allPlayersSet is provided", () => {
        const m = parseCSV(SAMPLE);
        const roster = new Set(["Alice", "Bob", "Carol", "Dave"]);
        const list = getPlayerMatches(m, "Alice", roster);
        const dave = list.find((x) => x.opponent === "Dave");
        expect(dave).toBeDefined();
        expect(dave.played).toBe(false);
    });
});
