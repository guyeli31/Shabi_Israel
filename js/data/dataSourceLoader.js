/**
 * dataSourceLoader.js — facade in front of supabaseLoader.js / leagueLoader.js
 * (the original static-file loader). Public render modules import from HERE
 * instead of picking one directly, so the 'files' fallback mode (see
 * dataSourceConfig.js) is a single switch, not a per-file decision.
 */

import { getDataSource } from './dataSourceConfig.js';
import * as supabaseImpl from './supabaseLoader.js';
import * as filesImpl from './leagueLoader.js';
import { loadMatchHistory as loadMatchHistoryFromFiles } from '../compute/matchHistory.js';

function impl() {
    return getDataSource() === 'files' ? filesImpl : supabaseImpl;
}

export function setLeaguesBase(...args) { return impl().setLeaguesBase(...args); }
export function loadLandingSettings(...args) { return impl().loadLandingSettings(...args); }
export function loadLeagueOrder(...args) { return impl().loadLeagueOrder(...args); }
export function loadLeagueParams(...args) { return impl().loadLeagueParams(...args); }
export function loadLeagueMatches(...args) { return impl().loadLeagueMatches(...args); }
export function loadLeagueMatchesAll(...args) { return impl().loadLeagueMatchesAll(...args); }
export function loadOverrides(...args) { return impl().loadOverrides(...args); }
export function loadLeague(...args) { return impl().loadLeague(...args); }
export function loadAllLeagueParams(...args) { return impl().loadAllLeagueParams(...args); }

// Pure function, identical in both implementations — either works.
export function applyOverrides(...args) { return impl().applyOverrides(...args); }

// supabaseLoader.js exposes loadMatchHistory (DB-backed) for dashboardPage.js's
// direct call; the file-based equivalent lives in compute/matchHistory.js.
export function loadMatchHistory(...args) {
    return getDataSource() === 'files'
        ? loadMatchHistoryFromFiles(...args)
        : supabaseImpl.loadMatchHistory(...args);
}
