/**
 * matchupPreset.js — C3 preset for the player.html head-to-head
 * (matchup) table. Mirrors lab's buildC3 shape; per-page enrichments
 * (league link) injected via callbacks.
 */

import { displayPlayerName } from '../utils/nameDisplay.js';

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

/**
 * @param {object} input
 *   rows       — flattenAllMatches() output, pre-filtered to one opponent
 *   playerName — self
 *   opponent   — selected opponent name
 *   enrich     — { leagueLink(id, title) => html }
 */
export function buildMatchupPreset({ rows, playerName, opponent, enrich = {} }) {
    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null,
          tdClass: 'matchup-league-cell',
          format: (v, row) => enrich.leagueLink ? enrich.leagueLink(row._leagueId, v) : v },
        { key: 'leagueType',  label: 'Type',   type: 'string', sortable: true, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'winner',      label: 'Winner', type: 'string', sortable: false, colorFn: null,
          format: (v, row) => {
              const cls = row._selfWon ? 'matchup-winner-win' : 'matchup-winner-loss';
              const t = row._technical ? ' <small>(T)</small>' : '';
              return `<span class="${cls}">${displayPlayerName(v)}${t}</span>`;
          } },
        { key: 'score',       label: 'Score',  type: 'string', sortable: false, colorFn: null },
        { key: 'prA',         label: 'PR A',   type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '<span class="na">N/A</span>';
              const better = typeof row.prB === 'number' && v <= row.prB;
              return `<span class="${better ? 'matchup-pr-best' : 'matchup-pr-other'}">${v.toFixed(2)}</span>`;
          } },
        { key: 'prB',         label: 'PR B',   type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '<span class="na">N/A</span>';
              const better = typeof row.prA === 'number' && v <= row.prA;
              return `<span class="${better ? 'matchup-pr-best' : 'matchup-pr-other'}">${v.toFixed(2)}</span>`;
          } },
        { key: 'luckA',       label: 'Luck A', type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '<span class="na">N/A</span>';
              const better = typeof row.luckB === 'number' && v >= row.luckB;
              return `<span class="${better ? 'matchup-luck-best' : 'matchup-luck-other'}">${v.toFixed(2)}</span>`;
          } },
        { key: 'luckB',       label: 'Luck B', type: 'number', sortable: true, colorFn: null,
          format: (v, row) => {
              if (typeof v !== 'number') return '<span class="na">N/A</span>';
              const better = typeof row.luckA === 'number' && v >= row.luckA;
              return `<span class="${better ? 'matchup-luck-best' : 'matchup-luck-other'}">${v.toFixed(2)}</span>`;
          } },
        { key: 'date',        label: 'Date',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0 },
    ];

    const data = rows.map(r => {
        const matchLen = r.matchLength ?? 7;
        const won = r.scoreSelf > r.scoreOpp;
        const winnerName = won ? playerName : opponent;
        const score = r._technical
            ? (won ? `${matchLen}–0` : `0–${matchLen}`)
            : `${r.scoreSelf}–${r.scoreOpp}`;
        return {
            _leagueId:   r.leagueId,
            leagueTitle: r.leagueTitle || r.leagueId,
            leagueType:  r.leagueType,
            date:        r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
            _timestamp:  r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
            winner:      winnerName,
            _selfWon:    won,
            _technical:  r._technical || false,
            score,
            prA:   r._technical ? null : r.prSelf,
            prB:   r._technical ? null : r.prOpp,
            luckA: (r._technical || r.luckSelf == null) ? null : r.luckSelf,
            luckB: (r._technical || r.luckOpp  == null) ? null : r.luckOpp,
        };
    });

    return {
        tableId:    'C3',
        data,
        cols,
        fontClass:  'font-small',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   10,
    };
}
