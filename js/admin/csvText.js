/**
 * csvText.js — reconstruct leaguedata.csv-style text from Supabase match rows.
 *
 * Supabase is the source of truth for matches, but several admin flows still
 * reason about a league as CSV text (player renames, integrity checks, the
 * staged content published by bulkImportCSV). This is the single serializer
 * they share, so the three former copies can't drift apart.
 *
 * Rows are grouped by round with a "Player,..." header line per round —
 * parseCSV*'s round detection keys off any line starting with "player", so the
 * reconstructed text round-trips back through the parsers unchanged.
 */

export function matchesToCsvText(matches) {
    const byRound = new Map();
    for (const m of matches) {
        const r = m.round || 1;
        if (!byRound.has(r)) byRound.set(r, []);
        byRound.get(r).push(m);
    }
    const lines = [];
    for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        lines.push('Player,PR,Luck,Score,Player,PR,Luck,Score');
        for (const m of byRound.get(round)) {
            lines.push([m.playerA, m.prA, m.luckA, m.scoreA, m.playerB, m.prB, m.luckB, m.scoreB].join(','));
        }
    }
    return lines.join('\n');
}
