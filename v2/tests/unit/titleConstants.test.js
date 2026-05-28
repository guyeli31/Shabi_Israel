// Pure-logic tests for src/data/titleConstants.js.

import { describe, it, expect } from "vitest";
import {
    BMAB_TITLES,
    getBmabInfo,
    getChampionshipInfo,
    getChampionshipTooltip,
    getHighestTier,
    hasTitles,
    compareTitlePriority,
    getFullTitleDescription,
    COUNTRIES,
} from "../../src/data/titleConstants.js";

describe("BMAB lookup", () => {
    it("getBmabInfo resolves known codes to {label, abbreviation, tier}", () => {
        expect(getBmabInfo("G0")).toEqual({
            label: "Grandmaster G0",
            abbreviation: "G0",
            tier: "gold",
        });
        expect(getBmabInfo("M2").tier).toBe("silver");
        expect(getBmabInfo("A3").tier).toBe("bronze");
        expect(getBmabInfo("I1").tier).toBe("white");
    });

    it("returns null for unknown codes", () => {
        expect(getBmabInfo("ZZ")).toBe(null);
    });

    it("17 BMAB titles cover S0–S3, G0–G3, M1–M3, A1–A3, I1–I3", () => {
        expect(BMAB_TITLES).toHaveLength(17);
    });
});

describe("championship helpers", () => {
    it("builds World Champion tooltip with location + doubles", () => {
        const t = { type: "world", year: 2025, location: "Monte Carlo", doubles: true };
        expect(getChampionshipTooltip(t)).toBe("2025 Monte Carlo Doubles World Champion");
    });

    it("builds National Champion tooltip with country", () => {
        const t = { type: "national", year: 2019, country: "Israel" };
        expect(getChampionshipTooltip(t)).toBe("2019 Israel National Champion");
    });

    it("getChampionshipInfo maps world → gold/WC, national → silver/NC", () => {
        const w = getChampionshipInfo({ type: "world", year: 2025 });
        expect(w.abbreviation).toBe("WC");
        expect(w.tier).toBe("gold");
        const n = getChampionshipInfo({ type: "national", year: 2019, country: "Israel" });
        expect(n.abbreviation).toBe("NC");
        expect(n.tier).toBe("silver");
    });
});

describe("getHighestTier", () => {
    it("returns null for empty metadata", () => {
        expect(getHighestTier(null)).toBe(null);
        expect(getHighestTier({})).toBe(null);
    });

    it("picks gold if a world championship is present", () => {
        const meta = { bmabTitle: "M1", championshipTitles: [{ type: "world", year: 2025 }] };
        expect(getHighestTier(meta)).toBe("gold");
    });

    it("picks the highest tier across BMAB + championships", () => {
        expect(getHighestTier({ bmabTitle: "I1" })).toBe("white");
        expect(getHighestTier({ bmabTitle: "A1" })).toBe("bronze");
        expect(getHighestTier({ bmabTitle: "M1" })).toBe("silver");
        expect(getHighestTier({ bmabTitle: "G0" })).toBe("gold");
    });
});

describe("hasTitles", () => {
    it("true for any BMAB or championship title", () => {
        expect(hasTitles({ bmabTitle: "G0" })).toBe(true);
        expect(hasTitles({ championshipTitles: [{ type: "national", year: 2020 }] })).toBe(true);
        expect(hasTitles({})).toBe(false);
        expect(hasTitles(null)).toBe(false);
    });
});

describe("compareTitlePriority", () => {
    it("World > National > BMAB > alphabetical", () => {
        const players = [
            { name: "Zara",  meta: { bmabTitle: "G0" } },
            { name: "Yoav",  meta: { championshipTitles: [{ type: "national", year: 2020, country: "Israel" }] } },
            { name: "Avi",   meta: { championshipTitles: [{ type: "world", year: 2022 }] } },
            { name: "Bobby", meta: { bmabTitle: "G0" } },
        ];
        players.sort(compareTitlePriority);
        expect(players.map((p) => p.name)).toEqual(["Avi", "Yoav", "Bobby", "Zara"]);
    });
});

describe("getFullTitleDescription", () => {
    it("concatenates championship titles before BMAB", () => {
        const meta = {
            bmabTitle: "G0",
            championshipTitles: [{ type: "national", year: 2019, country: "Israel" }],
        };
        expect(getFullTitleDescription(meta))
            .toBe("2019 Israel National Champion, Grandmaster G0");
    });
});

describe("COUNTRIES list", () => {
    it("covers Israel and is in alphabetical order", () => {
        expect(COUNTRIES).toContain("Israel");
        const sorted = [...COUNTRIES].sort((a, b) => a.localeCompare(b));
        expect(COUNTRIES).toEqual(sorted);
    });
});
