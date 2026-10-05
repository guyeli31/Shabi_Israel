/**
 * retirementStaging.js — the ONE place the admin stages a retirement.
 *
 * A retirement is two writes that live in different tables and mean different
 * things (docs/RETIREMENT-POLICY.md §1):
 *
 *   the PERSON   leagues.retired_players          display only
 *   the MATCHES  manual_overrides type=cancelled  every computation
 *
 * They used to be two separate acts on two separate screens — the Retired tick
 * in the Players tab wrote the first, the Retire bar in the Round Editor wrote
 * the second — joined by nothing but a reminder message, shown on one of the
 * two screens only. October 2026 UBC is what that produced: an admin ticked
 * Retired, published "1 change", and the league went live with a player
 * wearing the RETIRED mark whose 14 fixtures every table still listed as
 * matches to be played.
 *
 * Both entry points now call into here, so neither half can be staged without
 * the other. The two concepts stay separate in storage and in meaning; what is
 * shared is only the act of writing them.
 */

import { addChange, getStagedContent, readOverridesForEdit, stageManualOverrides, overrideKey, T } from './stagingStore.js';
import { loadLeagueParams } from '../data/supabaseLoader.js';

/** A player's fixtures, played or not. A 'Bye' pairing is not a match. */
export function fixturesOf(matches, player) {
    return (matches || []).filter(m =>
        (m.playerA === player || m.playerB === player) &&
        m.playerA !== 'Bye' && m.playerB !== 'Bye');
}

/**
 * Bring the league's `cancelled` overrides in line with who is retired.
 *
 * Every fixture of a retired player gets a `cancelled` override — the played
 * ones too, deliberately: a retired player's season is withdrawn whole, not
 * truncated at the point they walked away (§4 case 2). A fixture that already
 * carries one is left alone, so re-saving an already-retired league stages
 * nothing.
 *
 * A player in `unretired` gets his `cancelled` overrides removed, which is the
 * whole of the undo: `matches` was never edited, so the reconcile restores each
 * pairing from it (§4 case 6). A fixture against someone who is STILL retired
 * stays cancelled (§4 case 3).
 *
 * @param {string}   leagueId
 * @param {object[]} matches    every fixture of the league (loadLeagueMatchesAll)
 * @param {object}   opts
 *   retired    names that are retired after this save
 *   unretired  names that were retired before it and no longer are
 *   nameOf     maps a name as `matches` spells it to the name it will carry
 *              once this save is published (a rename staged alongside)
 * @returns {Promise<{cancelled:number, restored:number}>}
 */
export async function syncRetirementOverrides(leagueId, matches, { retired = [], unretired = [], nameOf = (n) => n } = {}) {
    const retiredSet = new Set(retired);
    const unretiredSet = new Set(unretired);
    const isRetired = (o) => retiredSet.has(o.playerA) || retiredSet.has(o.playerB);

    let restored = 0;
    const overrides = (await readOverridesForEdit(leagueId)).filter(o => {
        if (o.type !== 'cancelled') return true;
        if (!unretiredSet.has(o.playerA) && !unretiredSet.has(o.playerB)) return true;
        if (isRetired(o)) return true;
        restored++;
        return false;
    });

    let cancelled = 0;
    const ts = new Date().toISOString();
    for (const m of (matches || [])) {
        if (m.playerA === 'Bye' || m.playerB === 'Bye') continue;
        const pair = { playerA: nameOf(m.playerA), playerB: nameOf(m.playerB) };
        if (!isRetired(pair)) continue;
        const key = overrideKey(pair);
        const idx = overrides.findIndex(o => overrideKey(o) === key);
        if (idx !== -1 && overrides[idx].type === 'cancelled') continue;
        const who = retiredSet.has(pair.playerA) ? pair.playerA : pair.playerB;
        const override = { type: 'cancelled', ...pair, reason: `Cancelled — ${who} retired`, timestamp: ts };
        if (idx !== -1) overrides[idx] = override; else overrides.push(override);
        cancelled++;
    }

    if (cancelled || restored) await stageManualOverrides(leagueId, overrides);
    return { cancelled, restored };
}

/**
 * Stage the PERSON half for one player: add him to the league's RetiredPlayers.
 * Builds on a params change already pending, so it never discards one.
 *
 * @returns {Promise<boolean>} false when he was flagged already
 */
export async function stageRetiredFlag(leagueId, player) {
    const target = T.leagueParams(leagueId);
    const staged = getStagedContent(target);
    const base = staged ? JSON.parse(staged) : await loadLeagueParams(leagueId);
    const list = base.RetiredPlayers || [];
    if (list.includes(player)) return false;
    addChange({
        type: 'update',
        target,
        content: JSON.stringify({ ...base, RetiredPlayers: [...list, player] }, null, 2),
        description: `Update players: ${leagueId}`,
        category: 'league-players',
        subject: leagueId,
        detail: `retired ${player}`,
        group: `edit-players-${leagueId}`,
        groupDescription: `Players updated: ${leagueId}`,
    });
    return true;
}
