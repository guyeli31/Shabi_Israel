/**
 * playerAllMatchesPreset.js — C2 preset for the player.html
 * cross-league match history table. Mirrors lab's buildC2 shape; per-page
 * enrichments (league link, opponent cell with flag + interactive name link)
 * injected via callbacks.
 */

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

/**
 * PR / Opp PR / Luck cell. This table pools every league type a player has
 * appeared in, so REGULAR rows sit next to doubling/UBC ones. REGULAR leagues
 * record no rates at all — that's a property of the league, not a missing value,
 * so those cells read "—" rather than "N/A" (which here means "this particular
 * match has no number": a technical win, or a gap in the data).
 */
function rateCell(v, row) {
    if (row._noRates) return '<span class="na">—</span>';
    if (row._technical || v == null) return '<span class="na">N/A</span>';
    return v.toFixed(2);
}

/**
 * @param {object} input
 *   rows    — flattenAllMatches() output, already filtered by caller
 *   enrich  — { leagueLink(id, title) => html, opponentCell(name) => html }
 */
export function buildPlayerAllMatchesPreset({ rows, enrich = {} }) {
    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null,
          tdClass: 'league-cell',
          format: (v, row) => enrich.leagueLink ? enrich.leagueLink(row._leagueId, v) : v },
        { key: 'leagueType',  label: 'Type',   type: 'string', sortable: true, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'result',      label: 'Result', type: 'string', sortable: true, colorFn: null,
          sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : 1,
          format: (v, row) => {
              const t = row._technical ? ' <small>(T)</small>' : '';
              const cls = v === 'WIN'  ? 'result-win'
                        : v === 'LOSS' ? 'result-loss'
                        : 'result-draw';
              return `<span class="${cls}">${v}${t}</span>`;
          } },
        { key: 'opponent',    label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell',
          format: v => enrich.opponentCell ? enrich.opponentCell(v) : v },
        { key: 'score',       label: 'Score',  type: 'string', sortable: false, colorFn: null },
        { key: 'prSelf',      label: 'PR',     type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prSelf === 'number' ? row.prSelf : null,
          format: (v, row) => rateCell(v, row) },
        { key: 'prOpp',       label: 'Opp PR', type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prOpp === 'number' ? row.prOpp : null,
          format: (v, row) => rateCell(v, row) },
        { key: 'luck',        label: 'Luck',   type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.luck === 'number' ? row.luck : null,
          format: (v, row) => rateCell(v, row) },
        { key: 'date',        label: 'Date',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0,
          format: (v, row) => row._dateApprox
              ? `<span title="League start date — this league ran before per-match dates were recorded">${v}</span>`
              : v },
    ];

    const data = rows.map(r => {
        const matchLen = r.matchLength ?? 7;
        const score = r._technical
            ? (r.scoreSelf > r.scoreOpp ? `${matchLen}–0` : `0–${matchLen}`)
            : `${r.scoreSelf}–${r.scoreOpp}`;
        // matchDate falls back to the league's start date for pre-database
        // leagues that carry no per-match timestamps (see flattenAllMatches).
        const dateISO = r.matchDate ?? r.updatedAt ?? null;
        return {
            _leagueId:   r.leagueId,
            leagueTitle: r.leagueTitle,
            date:        dateISO ? new Date(dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
            _timestamp:  dateISO ? new Date(dateISO).getTime() : 0,
            _dateApprox: r._dateApprox || false,
            leagueType:  r.leagueType,
            opponent:    r.opponent,
            score,
            prSelf:      r._technical ? null : r.prSelf,
            prOpp:       r._technical ? null : r.prOpp,
            luck:        (r._technical || r.luckSelf == null || r.luckOpp == null) ? null : (r.luckSelf - r.luckOpp),
            result:      r.result,
            _technical:  r._technical || false,
            _noRates:    r.leagueType === 'regular',
        };
    });

    return {
        tableId:    'C2',
        data,
        cols,
        fontClass:  'font-small',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   10,
    };
}
