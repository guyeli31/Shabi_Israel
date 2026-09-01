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
    showLuck: true,
    showWinRate: true,
    showPRWins: false,
    ranking: { primary: 'winRate', primaryDir: 'desc', secondary: 'wins', secondaryDir: 'desc', h2hTiebreak: true },
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
 * ALL — the type-agnostic filter token. Not a league type: every league-type
 * pill bar uses it for the "no filter" tab, and every type-filtered compute
 * function has to recognise it, so it lives here — the single source for league
 * types — rather than in the render layer the compute layer must not import.
 * `subTabs.js` re-exports it for the pill bars.
 */
export const ALL_TYPES_ID = 'all';

/**
 * Does a league of `leagueType` pass the filter `filter`?
 *
 * The one predicate every type-filtered collector uses, so "what does ALL mean
 * here" is answered once. `filter` may be:
 *   null / ALL_TYPES_ID  → everything
 *   a type id            → that type only
 *   an array of type ids → those types only
 *
 * The array form is the one that matters: a section whose pills are already
 * narrowed (Match Records offers only the PR-tracking types) must pool exactly
 * those under ALL, not silently widen to every league in the app.
 */
export function matchesLeagueType(leagueType, filter) {
    if (filter == null || filter === ALL_TYPES_ID) return true;
    if (Array.isArray(filter)) return filter.includes(leagueType);
    return leagueType === filter;
}

/**
 * Match weight for the "last 300 PR" rolling window. Per LEAGUE, not per query:
 * pooling types under ALL mixes 5-point and 7-point leagues in one window, so
 * the weight has to come from the match's own league.
 */
export function prWeightFor(leagueType) {
    return leagueType === 'regular' ? 5 : 7;
}

/**
 * Get the league configuration for a given league's params.
 * @param {object} params — contents of league_params.json
 * @returns {object} league config
 */
export function getLeagueConfig(params) {
    const type = resolveType(params);
    return CONFIGS[type] || DOUBLING_CONFIG;
}
