/**
 * playerLeaguesPreset.js — C1 preset for the player.html Leagues
 * history table. Mirrors lab's buildC1 shape; page-specific enrichments
 * (league link, primary-col tooltip, medal-tinted rank cell) injected
 * via callbacks.
 */

const TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatLeagueDate(league, parseLeagueDate) {
    const iso = league.params?.IssueDate || league.params?.StartDate;
    if (iso) {
        const d = new Date(iso);
        if (!isNaN(d)) {
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    }
    if (parseLeagueDate) {
        const parsed = parseLeagueDate(league.id);
        if (parsed.year != null) return `${parsed.monthShort} ${parsed.year}`;
    }
    return '—';
}

/**
 * @param {object} input
 *   perLeague        — loadPlayerAcrossLeagues() output
 *   parseLeagueDate  — utils/helpers.parseLeagueDate (for fallback date string)
 *   enrich           — { leagueLink(id, title) => html string (full <a>…</a>) }
 */
export function buildPlayerLeaguesPreset({ perLeague, parseLeagueDate, enrich = {} }) {
    const cols = [
        { key: 'leagueTitle', label: 'League', type: 'string', sortable: true, colorFn: null,
          tdClass: 'league-cell',
          sortKey: row => row.leagueTitle,
          format: (v, row) => enrich.leagueLink ? enrich.leagueLink(row._leagueId, v) : v },
        { key: 'date',        label: 'Date',   type: 'string', sortable: true, colorFn: null },
        { key: 'type',        label: 'Type',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._type,
          format: v => v },
        { key: 'status',      label: 'Status', type: 'string', sortable: true, colorFn: null,
          format: v => v === 'Running'
              ? '<span class="status-pill status-running">Running</span>'
              : '<span class="status-pill status-completed">Completed</span>' },
        { key: 'rank',        label: 'Rank',   type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._rank ?? 9999,
          tdClass: null,
          format: (v, row) => v },
        { key: 'gp',          label: 'MP',     type: 'number', sortable: true, colorFn: null },
        { key: 'wins',        label: 'W',      type: 'number', sortable: true, colorFn: null },
        { key: 'losses',      label: 'L',      type: 'number', sortable: true, colorFn: null },
        { key: 'primary',     label: 'Primary',type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._primary ?? -Infinity,
          format: (v, row) => `<span title="${row._primaryLabel}">${v}</span>` },
        { key: 'pr',          label: 'PR',     type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._pr ?? Infinity },
    ];

    const data = perLeague.map(e => {
        const s         = e.playerStats || {};
        const cfg       = e.league.config;
        const isUbc     = cfg.type === 'ubc';
        const primary   = isUbc
            ? (s.avgPoints != null ? s.avgPoints.toFixed(2) : '—')
            : (s.winRate   != null ? `${(s.winRate * 100).toFixed(1)}%` : '—');
        const primaryLabel = isUbc ? 'Avg Points' : 'Win Rate';
        const meanPR    = (s.meanPR != null && cfg.showPR) ? s.meanPR.toFixed(2) : '—';
        const running   = e.league.params?.Running === true;
        const typeLabel = TYPE_LABELS[cfg.type] || cfg.type;

        const goldCount   = e.league.params?.GoldCount   ?? 1;
        const silverCount = e.league.params?.SilverCount ?? 1;
        const bronzeCount = e.league.params?.BronzeCount ?? 1;
        const rankClass = e.playerRank == null ? ''
            : e.playerRank <= goldCount                              ? 'rank-cell-gold'
            : e.playerRank <= goldCount + silverCount                ? 'rank-cell-silver'
            : e.playerRank <= goldCount + silverCount + bronzeCount  ? 'rank-cell-bronze'
            : '';
        const rankCell = e.playerRank != null
            ? `<span class="${rankClass}">${e.playerRank} / ${e.totalPlayers}</span>`
            : '—';

        return {
            _leagueId:     e.league.id,
            leagueTitle:   e.league.title,
            date:          formatLeagueDate(e.league, parseLeagueDate),
            type:          `<span class="league-type-pill type-${cfg.type}">${typeLabel}</span>`,
            _type:         cfg.type,
            status:        running ? 'Running' : 'Completed',
            rank:          rankCell,
            _rank:         e.playerRank,
            gp:            s.games  || 0,
            wins:          s.wins   || 0,
            losses:        s.losses || 0,
            primary,
            _primary:      isUbc ? s.avgPoints : s.winRate,
            _primaryLabel: primaryLabel,
            pr:            meanPR,
            _pr:           s.meanPR,
        };
    });

    return {
        tableId:    'C1',
        data,
        cols,
        fontClass:  'font-large',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   null,
    };
}
