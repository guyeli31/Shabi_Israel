/**
 * playerTotalLuckPreset.js — C6 preset for the player.html Records tab's
 * "Total Luck" section.
 *
 * Same MF shape and cell vocabulary as C1 (Leagues), narrowed to the four
 * columns the section is about — League, Type, Rank, Luck — with one row per
 * COMPLETED league the player took part in. The luck figure is the site's
 * canonical Luck Confidence percentile D (0–100, see compute/luckConfidence.js),
 * computed from that league's own matches for this player and tinted on the
 * shared red→amber→green value scale.
 *
 * Running leagues are excluded on purpose: a mid-season luck reading would sit
 * next to finished seasons as if it were a settled result.
 *
 * REGULAR leagues are excluded too, and the reason is NOT the one the rest of
 * the Records tab uses. **D is not the luck column.** `luckConfidenceStats`
 * never reads `luckA`/`luckB`; it builds D from `getWinProbability(prA, prB)`,
 * and that calibration table is valid for DOUBLING-CUBE matches only — a
 * caveat the site publishes to readers on the table itself
 * (`prProbabilityTableHtml`, "Doubling-cube matches only"). A Regular league is
 * precisely a league without the cube, so the model does not describe its
 * matches.
 *
 * So the gate here is `typeTracksPR`, NOT `typeTracksLuck` — the one place in
 * the Records tab where those two must differ. Its sibling sections (Best Luck
 * For / Worst Luck Against) gate on luck because they read the per-match luck
 * figure the analysis engine recorded, which owes nothing to this table.
 *
 * Do not "fix" this to match them. That was tried: Regular matches DO carry a
 * PR in the data, so D computes happily and returns a plausible number — which
 * is exactly the failure mode. The question is never whether the number can be
 * produced, it is whether the model was calibrated for these matches.
 */

import { colorForValue } from '../compute/colorScale.js';
import { typeTracksPR } from '../compute/leagueTypes.js';
import { luckConfidenceStats } from '../compute/luckConfidence.js';
import { typePillHtml, rankCellHtml } from './playerLeaguesPreset.js';

/**
 * Build the row data (one per completed, PR-tracking league). Kept separate
 * from the preset so the section can count/filter rows before mounting.
 *
 * @param {object[]} perLeague  loadPlayerAcrossLeagues() output
 * @param {string}   playerName
 * @returns {object[]} [{ _leagueId, _type, _luck, leagueTitle, type, rank, luck }]
 */
export function collectPlayerLeagueLuck(perLeague, playerName) {
    const rows = [];
    for (const e of perLeague) {
        const league = e.league;
        if (league.params?.Running === true) continue;
        if (!typeTracksPR(league.leagueType)) continue;   // see header — D needs the cube-calibrated model

        const matchLength = league.params?.MatchLength ?? 7;
        const matchRefs = league.matches
            .filter(m => m.playerA === playerName || m.playerB === playerName)
            .map(m => ({ m, matchLength }));
        const lp = luckConfidenceStats({ matchRefs, playerName });
        if (lp.percentile == null) continue;

        rows.push({
            _leagueId:   league.id,
            _type:       league.leagueType,
            _rank:       e.playerRank,
            _luck:       lp.percentile,
            _games:      lp.games,
            leagueTitle: league.title,
            type:        typePillHtml(league.leagueType),
            rank:        rankCellHtml(league, e.playerRank, e.totalPlayers),
            luck:        lp.percentile,
        });
    }
    return rows;
}

/**
 * @param {object} input
 *   rows   — collectPlayerLeagueLuck() output, already filtered to one pill
 *   enrich — { leagueLink(id, title) => html string (full <a>…</a>) }
 */
export function buildPlayerTotalLuckPreset({ rows, enrich = {} }) {
    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null,
          tdClass: 'league-cell',
          sortKey: row => row.leagueTitle,
          format: (v, row) => enrich.leagueLink ? enrich.leagueLink(row._leagueId, v) : v },
        { key: 'type', label: 'Type', type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._type,
          format: v => v },
        { key: 'rank', label: 'Rank', type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._rank ?? 9999,
          format: v => v },
        // Tinted off the fixed 0–100 D scale rather than the column's own
        // min/max: 50 must always read as "on model" regardless of which
        // leagues happen to be in view.
        { key: 'luck', label: 'Luck', type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._luck,
          format: (v, row) =>
              `<span style="color:${colorForValue(row._luck, 0, 100)};font-weight:600">${Math.round(row._luck)}</span>` },
    ];

    return {
        tableId:    'C6',
        data:       rows,
        cols,
        // font-small, not C1's font-large. C6 borrows C1's CELL VOCABULARY, but
        // the font tier is a separate, deliberate choice: on the Records tab this
        // sits directly under the four font-small C5 tables and was matched to
        // them so the tab reads as one set. Nothing derives this — a different
        // tier here would be equally valid.
        fontClass:  'font-small',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   null,
    };
}
