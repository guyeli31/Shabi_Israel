// Pure-logic tests for the synchronous bits of src/data/leagueLoader.js.
// The fetch helpers (loadLandingSettings / loadLeague) are exercised in the
// Phase 6 page-level tests against the live dev server.

import { describe, it, expect } from "vitest";
import { applyOverrides } from "../../src/data/leagueLoader.js";

const baseCsv = [
    { playerA: "Alice", playerB: "Bob",   scoreA: 1, scoreB: 0, prA: 5, prB: 7, luckA: 0, luckB: 0 },
    { playerA: "Alice", playerB: "Carol", scoreA: 0, scoreB: 1, prA: 8, prB: 4, luckA: 0, luckB: 0 },
];

describe("applyOverrides", () => {
    it("returns the input unchanged for an empty override list", () => {
        expect(applyOverrides(baseCsv, [])).toBe(baseCsv);
    });

    it("replaces a match with a 'result' override", () => {
        const out = applyOverrides(baseCsv, [{
            type: "result",
            playerA: "Bob", playerB: "Alice",
            scoreA: 0, scoreB: 1, prA: 6, prB: 4, luckA: 0, luckB: 0,
        }]);
        expect(out).toHaveLength(2);
        const aliceBob = out.find((m) =>
            [m.playerA, m.playerB].sort().join("|") === ["Alice", "Bob"].sort().join("|"));
        expect(aliceBob._overridden).toBe(true);
        expect(aliceBob.prA).toBe(6);
    });

    it("applies a 'technical_win' override with null PR/luck", () => {
        const out = applyOverrides(baseCsv, [{
            type: "technical_win",
            playerA: "Alice", playerB: "Bob", winner: "Alice",
        }]);
        const m = out.find((x) => x.playerA === "Alice" && x.playerB === "Bob");
        expect(m._technical).toBe(true);
        expect(m.scoreA).toBe(1);
        expect(m.scoreB).toBe(0);
        expect(m.prA).toBe(null);
    });

    it("applies a 'technical_draw' override with null PR/luck and _draw flag", () => {
        const out = applyOverrides(baseCsv, [{
            type: "technical_draw",
            playerA: "Alice", playerB: "Bob",
        }]);
        const m = out.find((x) => x.playerA === "Alice" && x.playerB === "Bob");
        expect(m._draw).toBe(true);
        expect(m._technical).toBe(true);
        expect(m.scoreA).toBe(0);
        expect(m.scoreB).toBe(0);
    });

    it("'not_played' removes the matching CSV row", () => {
        const out = applyOverrides(baseCsv, [{
            type: "not_played", playerA: "Alice", playerB: "Bob",
        }]);
        expect(out).toHaveLength(1);
        expect(out[0].playerA).toBe("Alice");
        expect(out[0].playerB).toBe("Carol");
    });

    it("appends an override for a match not in the CSV", () => {
        const out = applyOverrides(baseCsv, [{
            type: "result",
            playerA: "Dave", playerB: "Erin",
            scoreA: 1, scoreB: 0, prA: 5, prB: 7, luckA: 0, luckB: 0,
        }]);
        expect(out).toHaveLength(3);
        expect(out.at(-1).playerA).toBe("Dave");
    });
});
