/**
 * playerAllMatchesPreset.js — C2 preset for the player_general.html
 * cross-league match history table. Mirrors lab's buildC2 shape; per-page
 * enrichments (league link, opponent cell with flag + interactive name link)
 * injected via callbacks.
 */

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

/**
 * @param {object} input
 *   rows    — flattenAllMatches() output, already filtered by caller
 *   enrich  — { leagueLink(id, title) => html, opponentCell(name) => html }
 */
export function buildPlayerAllMatchesPreset({ rows, enrich = {} }) {
    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null,
          format: (v, row) => enrich.leagueLink ? enrich.leagueLink(row._leagueId, v) : v },
        { key: 'date',        label: 'Date',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0 },
        { key: 'leagueType',  label: 'Type',   type: 'string', sortable: true, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'opponent',    label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell',
          format: v => enrich.opponentCell ? enrich.opponentCell(v) : v },
        { key: 'score',       label: 'Score',  type: 'string', sortable: false, colorFn: null },
        { key: 'prSelf',      label: 'PR',     type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prSelf === 'number' ? row.prSelf : null,
          format: (v, row) => (row._technical || v == null)
              ? '<span class="na">N/A</span>'
              : v.toFixed(2) },
        { key: 'prOpp',       label: 'Opp PR', type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.prOpp === 'number' ? row.prOpp : null,
          format: (v, row) => (row._technical || v == null)
              ? '<span class="na">N/A</span>'
              : v.toFixed(2) },
        { key: 'luck',        label: 'Luck',   type: 'number', sortable: true, colorFn: null,
          sortKey: row => typeof row.luck === 'number' ? row.luck : null,
          format: (v, row) => (row._technical || v == null)
              ? '<span class="na">N/A</span>'
              : v.toFixed(2) },
        { key: 'result',      label: 'Result', type: 'string', sortable: true, colorFn: null,
          sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : 1,
          format: (v, row) => {
              const t = row._technical ? ' <small>(T)</small>' : '';
              const cls = v === 'WIN'  ? 'result-win'
                        : v === 'LOSS' ? 'result-loss'
                        : 'result-draw';
              return `<span class="${cls}">${v}${t}</span>`;
          } },
    ];

    const data = rows.map(r => {
        const matchLen = r.matchLength ?? 7;
        const score = r._technical
            ? (r.scoreSelf > r.scoreOpp ? `${matchLen}–0` : `0–${matchLen}`)
            : `${r.scoreSelf}–${r.scoreOpp}`;
        return {
            _leagueId:   r.leagueId,
            leagueTitle: r.leagueTitle,
            date:        r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
            _timestamp:  r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
            leagueType:  r.leagueType,
            opponent:    r.opponent,
            score,
            prSelf:      r._technical ? null : r.prSelf,
            prOpp:       r._technical ? null : r.prOpp,
            luck:        (r._technical || r.luckSelf == null || r.luckOpp == null) ? null : (r.luckSelf - r.luckOpp),
            result:      r.result,
            _technical:  r._technical || false,
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
