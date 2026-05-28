// compute/leagueTypes.js — league-type configuration.
//
// Three league formats are supported; each carries:
//   - showPR / showLuck / showWinRate / showPRWins  → column visibility
//   - ranking { primary, primaryDir, secondary, secondaryDir, h2hTiebreak? }
//   - playerResultMode "winloss" | "points"        → cell content style
//
// Resolution rule: params.LeagueType (case sensitive) → config; defaults to
// doubling. Unknown types also fall back to doubling — we never throw on
// older league files.

const DOUBLING_CONFIG = {
    type: "doubling",
    showPR: true,
    showLuck: true,
    showWinRate: true,
    showPRWins: false,
    ranking: { primary: "winRate", primaryDir: "desc", secondary: "meanPR", secondaryDir: "asc" },
    playerResultMode: "winloss",
};

const REGULAR_CONFIG = {
    type: "regular",
    showPR: false,
    showLuck: true,
    showWinRate: true,
    showPRWins: false,
    ranking: {
        primary: "winRate", primaryDir: "desc",
        secondary: "wins", secondaryDir: "desc",
        h2hTiebreak: true,
    },
    playerResultMode: "winloss",
};

const UBC_CONFIG = {
    type: "ubc",
    showPR: true,
    showLuck: true,
    showWinRate: false,
    showPRWins: true,
    ranking: { primary: "avgPoints", primaryDir: "desc", secondary: "meanPR", secondaryDir: "asc" },
    playerResultMode: "points",
};

const CONFIGS = {
    doubling: DOUBLING_CONFIG,
    regular: REGULAR_CONFIG,
    ubc: UBC_CONFIG,
};

function resolveType(params) {
    return params?.LeagueType || "doubling";
}

export function getLeagueConfig(params) {
    return CONFIGS[resolveType(params)] || DOUBLING_CONFIG;
}
