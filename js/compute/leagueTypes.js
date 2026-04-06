/**
 * leagueTypes.js — League type configuration.
 * Defines per-type column visibility, ranking logic, and display modes.
 */

function resolveType(params) {
    if (params.LeagueType) return params.LeagueType;
    return 'doubling';
}

const DOUBLING_CONFIG = {
    type: 'doubling',
    showPR: true,
    showLuck: true,
    showWinRate: true,
    showPRWins: false,
    ranking: { primary: 'winRate', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc' },
    playerResultMode: 'winloss'
};

const REGULAR_CONFIG = {
    type: 'regular',
    showPR: false,
    showLuck: false,
    showWinRate: false,
    showPRWins: false,
    ranking: { primary: 'wins', primaryDir: 'desc', secondary: 'player', secondaryDir: 'asc' },
    playerResultMode: 'winloss'
};

const UBC_CONFIG = {
    type: 'ubc',
    showPR: true,
    showLuck: true,
    showWinRate: false,
    showPRWins: true,
    ranking: { primary: 'avgPoints', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc' },
    playerResultMode: 'points'
};

const CONFIGS = {
    doubling: DOUBLING_CONFIG,
    regular: REGULAR_CONFIG,
    ubc: UBC_CONFIG
};

/**
 * Get the league configuration for a given league's params.
 * @param {object} params — contents of league_params.json
 * @returns {object} league config
 */
export function getLeagueConfig(params) {
    const type = resolveType(params);
    return CONFIGS[type] || DOUBLING_CONFIG;
}
