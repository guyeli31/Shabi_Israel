/**
 * annualLeaderboardPreset.js — A2 (Annual Leaderboard) preset for mountMFTable.
 *
 * Cols + data shape match the lab reference in table-lab/lab-loader.js → buildA2().
 * Live landing page enriches the Player cell with playerNameLink() so the
 * post-mount attach can wire context menus. UBC vs non-UBC variants share the
 * shape; the metric label and the optional Win% / Avg PTS column differ.
 *
 * The PR column is gated on league type: REGULAR leagues have no PR data
 * (leagueTypes.js → REGULAR_CONFIG.showPR === false), so the column is omitted
 * entirely rather than rendered as an empty "N/A" column.
 */

import { playerNameLink } from '../render/playerNameInteraction.js';
import { formatPercent, formatNumber } from '../utils/helpers.js';

/**
 * @param {object} input
 *   rows         — already filtered, ranked, hidden-players-removed:
 *                  { rank, player, flagCode, meta, monthly{abbr: number}, total, winRate, meanPR, avgPoints }
 *   months       — array of month abbreviations (e.g. ['Jan','Feb',...]) in display order
 *   isUBC        — boolean (controls Win% vs Avg PTS column)
 *   leagueType   — 'doubling' | 'regular' | 'ubc' (REGULAR omits the PR column)
 *   flagUrl      — (code) => url
 */
export function buildAnnualLeaderboardPreset({ rows, months, isUBC, leagueType, flagUrl }) {
    const showPR = leagueType !== 'regular';
    const monthCols = months.map(abbr => ({
        key:      abbr.toLowerCase(),
        label:    abbr,
        type:     'number',
        sortable: true,
        colorFn:  null,
        format:   v => v != null ? v : '–',
    }));

    // Column order: # | Player | Tot | [month cols…] | Win%/Avg PTS | [PR].
    // The monthly breakdown sits between the total and the aggregate metrics;
    // PR (when present) is always the rightmost column.
    const cols = [
        { key: 'rank',   label: '#',           type: 'number', sortable: false, colorFn: null },
        { key: 'player', label: 'Player',      type: 'string', sortable: true,  colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => `<img class="flag" src="${flagUrl(row._flagCode)}" alt="${row._flagCode}"> ${playerNameLink(v, row._meta)}` },
        { key: 'total',  label: '<b>Tot</b>',  type: 'number', sortable: true, colorFn: null,
          tdClass: 'total-col' },
        ...monthCols,
        ...(isUBC
            ? [{ key: 'avgPoints', label: 'Avg PTS', type: 'number', sortable: true, colorFn: null,
                 format: v => v != null ? formatNumber(v) : '—' }]
            : [{ key: 'winRate',   label: 'Win%',    type: 'number', sortable: true, colorFn: null,
                 format: v => v != null ? formatPercent(v) : '—' }]),
        ...(showPR
            ? [{ key: 'meanPR', label: 'PR', type: 'number', sortable: true, colorFn: null,
                 format: v => v != null ? formatNumber(v) : 'N/A' }]
            : []),
    ];

    const data = rows.map(r => ({
        rank:      r.rank,
        player:    r.player,
        _flagCode: r.flagCode,
        _meta:     r.meta,
        ...Object.fromEntries(months.map(m => [m.toLowerCase(), r.monthly[m] ?? null])),
        total:     r.total,
        winRate:   r.winRate,
        avgPoints: r.avgPoints,
        meanPR:    r.meanPR,
    }));

    return {
        tableId:    'A2',
        data, cols,
        fontClass:  'font-small',
        stickyCols: 2,
        medalRows:  true,
        medalCounts: { gold: 1, silver: 1, bronze: 1 },
        showTopN:   5,
        mfMb:       'var(--space-xl)',
        flagSize:   '1em',
    };
}
