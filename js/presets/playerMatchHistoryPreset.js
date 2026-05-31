/**
 * playerMatchHistoryPreset.js — E preset for the player.html match history table.
 * Matches lab's buildE shape; per-page enrichments injected via callbacks.
 */

import { getFlagCode, formatNumber } from '../utils/helpers.js';

function pct(n, total) { return ((n / total) * 100).toFixed(1) + '% wins'; }

/**
 * @param {object} input
 *   playerMatches — getPlayerMatches() output
 *   leagueConfig  — getLeagueConfig(params)
 *   params        — league_params.json
 *   flagUrl       — (countryCode) => string
 *   enrich        — { opponentLink(name) => {open,close}, opponentSuffix(name) => html, isHidden(name) => boolean }
 */
export function buildPlayerMatchHistoryPreset({ playerMatches, leagueConfig, params, flagUrl, enrich = {} }) {
    const customFlags = params.CustomFlags || {};

    function oppCell(name, opts = {}) {
        if (enrich.isHidden && enrich.isHidden(name)) return `<i class="player-hidden">N/A</i>`;
        const code = getFlagCode(name, customFlags);
        const img  = `<img class="flag" src="${flagUrl(code)}" alt="${code}">`;
        const link = enrich.opponentLink ? enrich.opponentLink(name) : { open: '', close: '' };
        const suffix = enrich.opponentSuffix ? enrich.opponentSuffix(name) : '';
        const text = opts.italic ? `<i style="color:var(--color-text-muted)">${name}</i>` : name;
        return `${img}${link.open}${text}${link.close}${suffix}`;
    }

    const cols = [
        { key: 'opponent', label: 'Opponent', type: 'string', sortable: true, colorFn: null,
          tdClass: 'player-cell',
          format: (v, row) => oppCell(v, row._unplayed ? { italic: true } : {}) },
        { key: 'date',  label: 'Date',  type: 'string', sortable: true, colorFn: null,
          sortKey: row => row._timestamp ?? 0 },
        { key: 'score', label: 'Score', type: 'string', sortable: false, colorFn: null,
          format: (v, row) => row.result === 'WIN' && v !== '—' ? `<b>${v}</b>` : v },
        ...(leagueConfig.showPR ? [
            { key: 'pr', label: 'PR', type: 'number', sortable: true, colorFn: null,
              sortKey: row => typeof row.pr === 'number' ? row.pr : null,
              format: (v, row) => {
                  if (typeof v !== 'number') return '—';
                  return (typeof row.oppPR === 'number' && v < row.oppPR) ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
              } },
            { key: 'oppPR', label: 'Opp PR', type: 'number', sortable: true, colorFn: null,
              sortKey: row => typeof row.oppPR === 'number' ? row.oppPR : null,
              format: (v, row) => {
                  if (typeof v !== 'number') return '—';
                  return (typeof row.pr === 'number' && v < row.pr) ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
              } },
        ] : []),
        ...(leagueConfig.showLuck !== false ? [
            { key: 'luck', label: 'Luck', type: 'number', sortable: true, colorFn: null,
              sortKey: row => typeof row.luck === 'number' ? row.luck : null,
              format: v => {
                  if (typeof v !== 'number') return '—';
                  return v > 0 ? `<b>${v.toFixed(2)}</b>` : v.toFixed(2);
              } },
        ] : []),
        ...(leagueConfig.playerResultMode === 'points' ? [
            { key: 'matchPoints', label: 'Points', type: 'number', sortable: true, colorFn: null,
              sortKey: row => typeof row.matchPoints === 'number' ? row.matchPoints : null,
              format: v => {
                  if (typeof v !== 'number') return '';
                  if (v === 2) return `<b style="color:var(--color-win)">${v}</b>`;
                  if (v === 0) return `<b style="color:var(--color-loss)">${v}</b>`;
                  return String(v);
              } },
        ] : [
            { key: 'result', label: 'Result', type: 'string', sortable: true, colorFn: null,
              sortKey: row => row.result === 'WIN' ? 2 : row.result === 'LOSS' ? 0 : row.result === 'DRAW' ? 1 : -1,
              format: (v, row) => {
                  const t = row._technical ? ' <small>(T)</small>' : '';
                  if (v === 'WIN')  return `<b style="color:var(--color-win)">WIN</b>${t}`;
                  if (v === 'LOSS') return `<b style="color:var(--color-loss)">LOSS</b>${t}`;
                  if (v === 'DRAW') return `<b>DRAW</b>`;
                  return v;
              } },
        ]),
    ];

    const data = playerMatches.map(m => {
        if (!m.played) {
            return {
                opponent: m.opponent, date: '', score: '',
                pr: null, oppPR: null, luck: null,
                result: 'Not played', matchPoints: null,
                _unplayed: true, _timestamp: 0,
            };
        }
        const isTechnical = m._technical || false;
        const isDraw      = m._draw || false;
        const won         = m.scoreSelf > m.scoreOpp;
        const result      = isDraw ? 'DRAW' : won ? 'WIN' : 'LOSS';
        const matchWin    = won ? 1 : 0;
        const prWin       = (!isTechnical && typeof m.prSelf === 'number' && typeof m.prOpp === 'number' && m.prSelf < m.prOpp) ? 1 : 0;
        return {
            opponent:    m.opponent,
            date:        m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-GB') : '—',
            _timestamp:  m.updatedAt ? new Date(m.updatedAt).getTime() : 0,
            score:       isTechnical ? '—' : `${m.scoreSelf}-${m.scoreOpp}`,
            pr:          isTechnical ? null : m.prSelf,
            oppPR:       isTechnical ? null : m.prOpp,
            luck:        isTechnical ? null : (m.luckSelf - m.luckOpp),
            result,
            matchPoints: matchWin + prWin,
            _technical:  isTechnical,
        };
    });

    const buildSummaryRow = (data) => {
        const played = data.filter(r => !r._unplayed);
        const n = played.length;
        if (!n) return { opponent: 'AVERAGES', result: '0 games', matchPoints: '0 games' };
        const nonTech = played.filter(r => r.pr !== null);
        const nt = nonTech.length;
        const avgPR    = nt ? formatNumber(nonTech.reduce((s, r) => s + r.pr,    0) / nt) : null;
        const avgOppPR = nt ? formatNumber(nonTech.reduce((s, r) => s + r.oppPR, 0) / nt) : null;
        const avgLuck  = nt ? formatNumber(nonTech.reduce((s, r) => s + r.luck,  0) / nt) : null;
        const wins     = played.filter(r => r.result === 'WIN').length;
        const totalPts = played.reduce((s, r) => s + (r.matchPoints ?? 0), 0);
        const avgPts   = (totalPts / n).toFixed(2);
        const statLine = leagueConfig.playerResultMode === 'points'
            ? `${n} games<br>${avgPts} avg pts`
            : `${n} games<br>${pct(wins, n)}`;
        return {
            opponent: 'AVERAGES',
            date: '', score: '',
            ...(leagueConfig.showPR ? { pr: avgPR, oppPR: avgOppPR } : {}),
            luck: avgLuck,
            result:      statLine,
            matchPoints: statLine,
        };
    };

    const getRowClass = (row) => row._unplayed ? 'unplayed' : null;

    return {
        tableId:    'E',
        data,
        cols,
        fontClass:  'font-small',
        stickyCols: 1,
        medalRows:  false,
        showTopN:   null,
        getRowClass,
        buildSummaryRow,
    };
}
