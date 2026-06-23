/**
 * completedLeaguesPreset.js — A1 (Completed Leagues) preset for mountMFTable.
 *
 * Cols + data shape match the lab reference in table-lab/lab-loader.js → buildA1().
 * Live landing page enriches via `format` callbacks so league titles stay clickable
 * (link to the league dashboard) and winners use playerNameLink() so the post-mount
 * attach can wire context menus.
 */

import { playerNameLink } from '../render/playerNameInteraction.js';

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };

/**
 * @param {object} input
 *   rows         — pre-formatted display rows: { league, dateStr, leagueType, leagueId,
 *                                                leaderName|null, leaderHidden, leaderFlagCode, leaderMeta }
 *   flagUrl      — (code) => url
 *   leagueUrl — (leagueId) => url
 */
export function buildCompletedLeaguesPreset({ rows, flagUrl, leagueUrl }) {
    const cols = [
        { key: 'league', label: 'League', type: 'string', sortable: false, colorFn: null,
          format: (v, row) => `<a href="${leagueUrl(row._leagueId)}">${escapeHtml(v)}</a>` },
        { key: 'type',   label: 'Type',   type: 'string', sortable: false, colorFn: null,
          format: v => `<span class="league-type-pill type-${v}">${TYPE_LABELS[v] || v}</span>` },
        { key: 'winner', label: 'Winner', type: 'string', sortable: false, colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => {
              if (!v) return '—';
              const flagImg = row._leaderHidden
                  ? ''
                  : `<img class="flag" src="${flagUrl(row._leaderFlagCode)}" alt="${row._leaderFlagCode}"> `;
              return `${flagImg}${playerNameLink(v, row._leaderMeta)}`;
          } },
        { key: 'date',   label: 'Date',   type: 'string', sortable: false, colorFn: null },
    ];

    const data = rows.map(r => ({
        league:           r.league,
        date:             r.dateStr,
        type:             r.leagueType,
        winner:           r.leaderName,
        _leagueId:        r.leagueId,
        _leaderHidden:    r.leaderHidden,
        _leaderFlagCode:  r.leaderFlagCode,
        _leaderMeta:      r.leaderMeta,
    }));

    return {
        tableId:    'A1',
        data, cols,
        fontClass:  'font-small',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   10,
        flagSize:   '1em',
    };
}
