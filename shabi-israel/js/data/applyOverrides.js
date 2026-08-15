/**
 * applyOverrides.js — pure override application, shared by every read path.
 *
 * Lives on its own (rather than inside a loader) because it is data-source
 * agnostic: store.js, supabaseLoader.js and the offline scripts all layer the
 * same override semantics on top of matches they fetched however they like.
 */

/**
 * Apply manual overrides on top of CSV-parsed matches.
 * Each override replaces or adds a match by playerA+playerB key.
 */
export function applyOverrides(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;

    const result = [...matches];

    for (const o of overrides) {
        const key = [o.playerA, o.playerB].sort().join('|');

        // Find existing match
        const idx = result.findIndex(m => {
            const mKey = [m.playerA, m.playerB].sort().join('|');
            return mKey === key;
        });

        let newMatch;
        if (o.type === 'result') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                _overridden: true
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true
            };
        } else if (o.type === 'technical_draw') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                _overridden: true, _technical: true, _draw: true
            };
        } else if (o.type === 'not_played') {
            // Remove match from played matches (treat as unplayed)
            if (idx !== -1) result.splice(idx, 1);
            continue;
        }

        if (newMatch) {
            if (idx !== -1) {
                result[idx] = newMatch;
            } else {
                result.push(newMatch);
            }
        }
    }

    return result;
}
