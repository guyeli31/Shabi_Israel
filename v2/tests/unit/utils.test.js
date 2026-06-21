// Tests for src/utils/{urlParams,formatting,flagUrl}.js.

import { describe, it, expect, beforeEach } from "vitest";
import {
    getQueryParam,
    leagueTableUrl,
    leagueUrl,
    playerLeagueUrl,
    playerUrl,
} from "../../src/utils/urlParams.js";
import {
    formatPercent,
    formatNumber,
    thLabel,
    parseLeagueDate,
    getLeagueYear,
} from "../../src/utils/formatting.js";
import { flagUrl, getFlagCode } from "../../src/utils/flagUrl.js";

describe("urlParams", () => {
    beforeEach(() => {
        globalThis.window = { location: { search: "" } };
    });

    it("getQueryParam reads from window.location.search", () => {
        window.location.search = "?league=Foo&player=Alice";
        expect(getQueryParam("league")).toBe("Foo");
        expect(getQueryParam("missing")).toBe(null);
    });

    it("URL builders URI-encode their parameters", () => {
        expect(leagueTableUrl("Shabi Israel April 2026"))
            .toBe("league_table.html?league=Shabi%20Israel%20April%202026");
        expect(leagueUrl("Shabi Israel April 2026"))
            .toBe("league.html?league=Shabi%20Israel%20April%202026");
        expect(playerLeagueUrl("A B", "C D"))
            .toBe("player_league.html?league=A%20B&player=C%20D");
        expect(playerUrl("Alice"))
            .toBe("player.html?player=Alice");
    });
});

describe("formatting", () => {
    it("formatPercent multiplies by 100 and emits 2 decimals", () => {
        expect(formatPercent(0.5)).toBe("50.00%");
        expect(formatPercent(0.1234)).toBe("12.34%");
    });

    it("formatNumber rounds to N decimals (default 2)", () => {
        expect(formatNumber(3.14159)).toBe("3.14");
        expect(formatNumber(3.14159, 3)).toBe("3.142");
    });

    it("thLabel emits dual-label spans, abbr defaults to full", () => {
        expect(thLabel("Mean PR", "PR"))
            .toBe('<span class="th-full">Mean PR</span><span class="th-abbr">PR</span>');
        expect(thLabel("Games", ""))
            .toBe('<span class="th-full">Games</span><span class="th-abbr">Games</span>');
    });

    it("parseLeagueDate extracts year + month from folder id", () => {
        expect(parseLeagueDate("Shabi Israel April 2026"))
            .toEqual({ year: 2026, monthIndex: 3, monthShort: "Apr" });
        expect(parseLeagueDate("nonsense"))
            .toEqual({ year: null, monthIndex: -1, monthShort: undefined });
    });

    it("getLeagueYear prefers IssueDate, then StartDate, then folder", () => {
        expect(getLeagueYear({ id: "x", params: { IssueDate: "2025-06-15" } })).toBe(2025);
        expect(getLeagueYear({ id: "x", params: { StartDate: "2024-02-01" } })).toBe(2024);
        expect(getLeagueYear({ id: "Shabi Israel April 2026", params: {} })).toBe(2026);
        expect(getLeagueYear({ id: "bare", params: {} })).toBe(null);
    });
});

describe("flagUrl", () => {
    it("emits /assets/flags/<code>.png", () => {
        expect(flagUrl("IL")).toBe("/assets/flags/IL.png");
        expect(flagUrl("US")).toBe("/assets/flags/US.png");
    });

    it("getFlagCode defaults to IL and respects customFlags overrides", () => {
        expect(getFlagCode("Alice")).toBe("IL");
        expect(getFlagCode("Alice", {})).toBe("IL");
        expect(getFlagCode("Alice", { Alice: "US" })).toBe("US");
        expect(getFlagCode("Bob",   { Alice: "US" })).toBe("IL");
    });
});
