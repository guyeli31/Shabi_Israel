/**
 * playerLuckBadge.js — the luck percentile shown beside a player's name in the
 * player pickers of the two LUCK sections, alongside playerTitleBadge.js
 * (titles) and the flag.
 *
 * Scope is deliberately narrow. This belongs ONLY to the two sections whose
 * subject is the luck metric:
 *
 *   • league dashboard — "Player PR difference ↔ Result ↔ Luck"
 *   • player page      — "Total PR difference ↔ Result ↔ Luck"
 *
 * Both stack one chart per player and exist to compare them, so the picker that
 * chooses the next player to stack is the one place where seeing each
 * candidate's luck before picking changes what you pick. Every other player
 * search in the project (What-If, the site search, the landing directory, the
 * H2H opponent lookup, admin) is about identity or scheduling, not luck, and
 * carries no such figure.
 *
 * It does NOT re-implement the metric or the colour scale. The value is the
 * site's canonical Luck Confidence percentile D (compute/luckConfidence.js) —
 * the same number the Luck bar above each chart shows — tinted with the shared
 * red→amber→green `colorForValue(D, 0, 100)` the Luck Percentile card and the
 * Total Luck table use. A picker row and the bar therefore agree.
 *
 * Two scopes, matching the two sections:
 *
 *   createLeagueLuckSource(league)  — one league's own matches, for the league
 *                                     dashboard section (which charts exactly
 *                                     that league).
 *   createAllTimeLuckSource(opts)   — every rated match in every visible
 *                                     PR-tracking league, optionally narrowed
 *                                     to one league type, for the player page
 *                                     section (which charts across leagues and
 *                                     has a league-type pill).
 *
 * Both return { valueFor, gamesFor, htmlFor } and look up synchronously — what
 * a `decorate` hook needs. The all-time source primes in the background and
 * yields nothing until it lands, which the combobox's re-render on the next
 * keystroke picks up.
 *
 * REGULAR leagues record no PR, so no model exists to be lucky against: they
 * contribute nothing, and a player with no rated matches gets no badge at all
 * rather than a misleading 50.
 */

import { luckConfidenceStats } from '../compute/luckConfidence.js';
import { colorForValue } from '../compute/colorScale.js';
import { loadVisibleLeagues } from '../compute/crossLeague.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * Build the badge markup for one D value. Returns '' for a player with no
 * rated matches — an empty slot says "not applicable" honestly, where a dash
 * or a 50 would read as a measured result.
 *
 * The colour is inline because it is a per-value gradient (and theme-aware),
 * exactly as the Luck Percentile table's cells do it. Sizing/spacing stay in
 * CSS, em-relative, so the badge tracks the row's font size.
 */
export function luckBadgeHtml(D, { games = null, scopeLabel = '' } = {}) {
    if (D == null) return '';
    const v = Math.round(D);
    const title = `Luck percentile ${v}/100`
        + (games != null ? ` from ${games} rated match${games === 1 ? '' : 'es'}` : '')
        + (scopeLabel ? ` (${scopeLabel})` : '')
        + '. 50 = exactly on-model; above = results ran better than the level of play predicted, below = worse.';
    return `<span class="player-luck-badge" style="color:${colorForValue(v, 0, 100)}" title="${escapeHtml(title)}">${v}</span>`;
}

/** Shared shape returned by both sources. */
function makeSource(getEntry, scopeLabel) {
    return {
        valueFor: (name) => getEntry(name)?.percentile ?? null,
        gamesFor: (name) => getEntry(name)?.games ?? 0,
        htmlFor: (name) => {
            const e = getEntry(name);
            return e ? luckBadgeHtml(e.percentile, { games: e.games, scopeLabel }) : '';
        },
    };
}

/**
 * Luck within ONE league, computed on first lookup per player and cached.
 * Lazy rather than up-front: the picker may never be opened, and a league with
 * 60 players would otherwise pay for 60 grid integrations at page load.
 *
 * @param {object} league  { matches, params, config } — a loadLeague()-shaped
 *                         object, or a page ctx carrying the same three fields.
 */
export function createLeagueLuckSource(league) {
    const cache = new Map();
    const showPR = league?.config?.showPR ?? true;
    const matchLength = league?.params?.MatchLength ?? 7;
    const matches = league?.matches || [];

    function getEntry(name) {
        if (!showPR || !name) return null;
        if (cache.has(name)) return cache.get(name);
        const matchRefs = matches
            .filter(m => m.playerA === name || m.playerB === name)
            .map(m => ({ m, matchLength }));
        const lp = matchRefs.length ? luckConfidenceStats({ matchRefs, playerName: name }) : null;
        const entry = lp && lp.percentile != null ? { percentile: lp.percentile, games: lp.games } : null;
        cache.set(name, entry);
        return entry;
    }

    return makeSource(getEntry, 'this league');
}

/**
 * Luck across every visible PR-tracking league, optionally narrowed to one
 * league type — the same set the player page's section charts under the
 * matching pill, so the number a candidate shows in the picker is the number
 * their Luck bar will show once they are stacked.
 *
 * `leagueType` is null for the "All" pill (every PR type pooled).
 *
 * @returns source + `ready`, a promise resolving once the leagues are loaded.
 */
export function createAllTimeLuckSource({ leagueType = null } = {}) {
    const cache = new Map();
    let refs = null;              // name -> [{ m, matchLength }]

    const ready = loadVisibleLeagues().then(leagues => {
        refs = new Map();
        for (const league of leagues) {
            if (!league.config?.showPR) continue;
            if (leagueType && league.leagueType !== leagueType) continue;
            const matchLength = league.params?.MatchLength ?? 7;
            for (const m of league.matches) {
                for (const name of [m.playerA, m.playerB]) {
                    if (!name || name === 'Bye') continue;
                    if (!refs.has(name)) refs.set(name, []);
                    refs.get(name).push({ m, matchLength });
                }
            }
        }
        return refs;
    }).catch(() => (refs = new Map()));

    function getEntry(name) {
        if (!refs || !name) return null;      // still loading — no badge yet
        if (cache.has(name)) return cache.get(name);
        const matchRefs = refs.get(name);
        const lp = matchRefs ? luckConfidenceStats({ matchRefs, playerName: name }) : null;
        const entry = lp && lp.percentile != null ? { percentile: lp.percentile, games: lp.games } : null;
        cache.set(name, entry);
        return entry;
    }

    const label = leagueType ? `${leagueType.toUpperCase()} leagues` : 'all leagues';
    return { ...makeSource(getEntry, label), ready };
}
