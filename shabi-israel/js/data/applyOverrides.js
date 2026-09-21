/**
 * applyOverrides.js — pure override application, shared by every read path.
 *
 * Lives on its own (rather than inside a loader) because it is data-source
 * agnostic: store.js, supabaseLoader.js and the offline scripts all layer the
 * same override semantics on top of matches they fetched however they like.
 */

/**
 * Is this fixture cancelled — a retired player's match, which will never be
 * played and is not waiting to be?
 *
 * THE ONE PLACE THAT ANSWERS THIS. `_cancelled` and `played:false` travel
 * together (applyOverridesToAll sets both), so every site that filters on bare
 * `!played` is silently also selecting cancelled fixtures — and four of them
 * mean "still to come" by it: the Championship Predictor's remaining set, the
 * What-If baseline (current AND historical), and the Remaining Matches tables.
 * Left unguarded, a retired player's fixtures are matches the league waits for
 * forever.
 *
 * Exported as one predicate rather than repeated inline, because a rule copied
 * to four call sites is a rule that will disagree with itself at the fifth.
 */
export function isCancelled(m) {
    return !!(m && m._cancelled);
}

/**
 * The fixtures a league still has to play: unplayed, and not cancelled.
 * Use this instead of `.filter(m => !m.played)` anywhere "remaining" is meant.
 */
export function remainingFixtures(matches) {
    return (matches || []).filter(m => !m.played && !isCancelled(m));
}

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
        } else if (o.type === 'cancelled') {
            // A retired player's fixture: the match does not exist. In the
            // PLAYED list that is the same outcome as not_played — it leaves.
            // The two only diverge in applyOverridesToAll (dashboardPage.js),
            // where not_played still means "to be played" and cancelled means
            // "never will be". See docs/RETIREMENT-POLICY.md §2.
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


/**
 * Apply overrides to the FULL fixture list, unplayed rows included.
 *
 * Unlike applyOverrides(), which works on the played set and may drop rows,
 * this keeps every fixture and rewrites it in place — the league's schedule is
 * the subject, so a fixture that stops being a result becomes an unplayed or
 * cancelled row rather than disappearing.
 *
 * ── ONE IMPLEMENTATION, TWO RUNTIMES ───────────────────────────────────────
 * The browser (js/render/dashboardPage.js) and the Node projection job
 * (scripts/project-title-race.js) both need this, and they used to carry a copy
 * each — written separately, with different algorithms, under a comment in the
 * job's copy that said "Mirrors dashboardPage.js". It did not.
 *
 * When `cancelled` was introduced the browser's copy learned it and the job's
 * did not, so the two disagreed about which matches a league had played: 253
 * against 300 in April 2026. They were projecting different leagues. Every
 * league with a retired player — five of seventeen, an exact correlation — ended
 * up with no stored projection at all, and the only visible symptom was a Title
 * Race chart that quietly recomputed in every visitor's browser.
 *
 * A shared module is not tidiness here. The two callers must agree about the
 * fixture list or the per-point fingerprints cannot match, which makes the whole
 * projection cache unreadable. See docs/RETIREMENT-POLICY.md §2.
 */
export function applyOverridesToAll(matches, overrides) {
    if (!overrides || overrides.length === 0) return matches;
    const result = [...matches];
    for (const o of overrides) {
        const key = [o.playerA, o.playerB].sort().join('|');
        const idx = result.findIndex(m => {
            const mKey = [m.playerA, m.playerB].sort().join('|');
            return mKey === key;
        });

        if (o.type === 'not_played' || o.type === 'cancelled') {
            if (idx !== -1) {
                result[idx] = {
                    ...result[idx],
                    played: false,
                    scoreA: null, scoreB: null,
                    prA: null, prB: null,
                    luckA: null, luckB: null,
                    _overridden: true,
                    // THE DISTINCTION THAT MATTERS. Both clear the result, but
                    // `not_played` means "still to come" and `cancelled` means
                    // "never will be" — and four consumers below read bare
                    // `!played` as the former. Without this flag a retired
                    // player's 24 fixtures become 24 matches the league is
                    // still waiting for: listed in B7, simulated by B3, and
                    // offered as stageable by B4, forever.
                    // See docs/RETIREMENT-POLICY.md §2.
                    _cancelled: o.type === 'cancelled' || undefined,
                };
            }
            continue;
        }

        let newMatch;
        if (o.type === 'result') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: o.scoreA, scoreB: o.scoreB,
                prA: o.prA, prB: o.prB,
                luckA: o.luckA, luckB: o.luckB,
                played: true, _overridden: true
            };
        } else if (o.type === 'technical_win') {
            const aWins = o.winner === o.playerA;
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1,
                prA: null, prB: null,
                luckA: null, luckB: null,
                played: true, _overridden: true, _technical: true
            };
        } else if (o.type === 'technical_draw') {
            newMatch = {
                playerA: o.playerA, playerB: o.playerB,
                scoreA: 0, scoreB: 0,
                prA: null, prB: null,
                luckA: null, luckB: null,
                played: true, _overridden: true, _technical: true, _draw: true
            };
        }

        if (newMatch) {
            if (idx !== -1) {
                // An override replaces the RESULT, so the row is rebuilt from
                // scratch rather than merged (a former technical_win must not
                // keep its `_technical` flag when it becomes a plain result).
                // The fixture's IDENTITY is not part of the result and has to be
                // carried across by hand: `round` always was, and `id` must be
                // too — it is the fixture's position in the Rounds table, which
                // is what orders the timeline within a shared instant (see
                // js/compute/matchHistory.js → buildFixtureIndex). Dropped, every
                // overridden match sorts to the end of its own instant.
                newMatch.round = result[idx].round;
                newMatch.id = result[idx].id;
                result[idx] = newMatch;
            } else {
                result.push(newMatch);
            }
        }
    }
    return result;
}
