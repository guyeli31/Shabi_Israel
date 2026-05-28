// Pure-logic tests for src/compute/leagueTypes.js.

import { describe, it, expect } from "vitest";
import { getLeagueConfig } from "../../src/compute/leagueTypes.js";

describe("getLeagueConfig", () => {
    it("defaults to doubling when no LeagueType is set", () => {
        const cfg = getLeagueConfig({});
        expect(cfg.type).toBe("doubling");
        expect(cfg.showPR).toBe(true);
        expect(cfg.ranking.primary).toBe("winRate");
    });

    it("returns regular config with h2hTiebreak", () => {
        const cfg = getLeagueConfig({ LeagueType: "regular" });
        expect(cfg.type).toBe("regular");
        expect(cfg.showPR).toBe(false);
        expect(cfg.ranking.h2hTiebreak).toBe(true);
    });

    it("returns ubc config with avgPoints primary + points mode", () => {
        const cfg = getLeagueConfig({ LeagueType: "ubc" });
        expect(cfg.type).toBe("ubc");
        expect(cfg.showPRWins).toBe(true);
        expect(cfg.ranking.primary).toBe("avgPoints");
        expect(cfg.playerResultMode).toBe("points");
    });

    it("unknown LeagueType falls back to doubling", () => {
        const cfg = getLeagueConfig({ LeagueType: "freeform" });
        expect(cfg.type).toBe("doubling");
    });
});
