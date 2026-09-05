/**
 * leagueTypes.js — League type configuration.
 * Defines per-type column visibility, ranking logic, and display modes.
 *
 * TIEBREAKS — this file is the ONLY place a league's tiebreak policy is
 * written. `ranking.tiebreaks` is an ordered list of rule ids from
 * compute/tiebreaks.js, applied to whoever is still tied after
 * primary → secondary. Every consumer (the rendered table AND the championship
 * Monte Carlo) reads this list; neither hard-codes a rule. Reorder it or extend
 * it here and both follow.
 *
 * Every list must END in a total order (today: 'tbAlphabetical'), and that is enforced at
 * import — see assertPolicy. A list that can run out while players are still
 * level does not mean "they are equal": it means each engine falls back to its
 * own storage order, which is precisely how the table and the predictor come to
 * crown different champions.
 */

import { assertPolicy } from './tiebreaks.js';

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
    ranking: { primary: 'winRate', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc',
               tiebreaks: ['tbAlphabetical'] },
    playerResultMode: 'winloss'
};

const REGULAR_CONFIG = {
    type: 'regular',
    showPR: false,
    showLuck: true,
    showWinRate: true,
    showPRWins: false,
    ranking: { primary: 'winRate', primaryDir: 'desc', secondary: 'wins', secondaryDir: 'desc',
               tiebreaks: ['tbH2hWins', 'tbH2hDiff', 'tbLeagueDiff', 'tbAlphabetical'] },
    playerResultMode: 'winloss'
};

const UBC_CONFIG = {
    type: 'ubc',
    showPR: true,
    showLuck: true,
    showWinRate: false,
    showPRWins: true,
    ranking: { primary: 'avgPoints', primaryDir: 'desc', secondary: 'meanPR', secondaryDir: 'asc',
               tiebreaks: ['tbAlphabetical'] },
    playerResultMode: 'points'
};

const CONFIGS = {
    doubling: DOUBLING_CONFIG,
    regular: REGULAR_CONFIG,
    ubc: UBC_CONFIG
};

// Validated at import, so a policy that could leave two players level — the
// exact condition under which the table and the championship predictor drift
// apart — is a startup error rather than a silently different champion.
for (const [id, cfg] of Object.entries(CONFIGS)) assertPolicy(cfg.ranking.tiebreaks, `leagueTypes.${id}`);

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
 * Canonical display rank of a league type: **Doubling → UBC → Regular**.
 *
 * This is the order H1 (Active Leagues cards) has always used, and every other
 * list that groups or tie-breaks by type now reads it from here rather than
 * declaring its own — H1, A1 (Completed Leagues) and F1 (admin Leagues list).
 * It is deliberately NOT `Object.keys(CONFIGS)`: that order (doubling, regular,
 * ubc) is the order the configs happened to be written in, and deriving the
 * display rank from it would have silently swapped UBC and Regular in H1.
 * An unknown type sorts last rather than first.
 */
const TYPE_ORDER = ['doubling', 'ubc', 'regular'];
export function leagueTypeRank(leagueType) {
    const i = TYPE_ORDER.indexOf(leagueType);
    return i === -1 ? TYPE_ORDER.length : i;
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
