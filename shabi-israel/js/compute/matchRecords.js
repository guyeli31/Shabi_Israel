/**
 * matchRecords.js — Per-match record collectors for the landing Match Records section.
 *
 * Unlike allTimeRankings which aggregates per player, these functions surface
 * individual single-match highlights across all loaded leagues of a given type.
 */

/**
 * Collect one entry per non-technical match where both luck values exist.
 * The "player" is the side that benefited (higher luck); opponent is the other side.
 * Returns: [{ luckGap, player, opponent, score, result, leagueId, leagueTitle, date, customFlags }]
 */
export function collectLuckMatches(leagues) {
    const out = [];
    for (const league of leagues) {
        const customFlags = league.params?.CustomFlags || {};
        const leagueId = league.id;
        const leagueTitle = league.title;
        const fallbackDate = league.params?.IssueDate || null;
        for (const m of league.matches) {
            if (m._technical) continue;
            if (m.luckA == null || m.luckB == null) continue;
            const luckGap = Math.abs(m.luckA - m.luckB);
            const aBenefits = m.luckA >= m.luckB;
            const player    = aBenefits ? m.playerA : m.playerB;
            const opponent  = aBenefits ? m.playerB : m.playerA;
            const scoreSelf = aBenefits ? m.scoreA : m.scoreB;
            const scoreOpp  = aBenefits ? m.scoreB : m.scoreA;
            out.push({
                luckGap,
                player,
                opponent,
                scoreSelf,
                scoreOpp,
                result: resultFrom(scoreSelf, scoreOpp, m._draw),
                leagueId,
                leagueTitle,
                date: m.updatedAt || fallbackDate,
                customFlags
            });
        }
    }
    return out;
}

/**
 * Collect one entry per side (A and B emitted separately) for non-technical
 * matches where that side's PR is defined.
 * Returns: [{ pr, player, opponent, scoreSelf, scoreOpp, result, leagueId, leagueTitle, date, customFlags }]
 */
export function collectPRMatches(leagues) {
    const out = [];
    for (const league of leagues) {
        const customFlags = league.params?.CustomFlags || {};
        const leagueId = league.id;
        const leagueTitle = league.title;
        const fallbackDate = league.params?.IssueDate || null;
        for (const m of league.matches) {
            if (m._technical) continue;
            const date = m.updatedAt || fallbackDate;
            if (m.prA != null) {
                out.push({
                    pr: m.prA,
                    player: m.playerA,
                    opponent: m.playerB,
                    scoreSelf: m.scoreA,
                    scoreOpp: m.scoreB,
                    result: resultFrom(m.scoreA, m.scoreB, m._draw),
                    leagueId, leagueTitle, date, customFlags
                });
            }
            if (m.prB != null) {
                out.push({
                    pr: m.prB,
                    player: m.playerB,
                    opponent: m.playerA,
                    scoreSelf: m.scoreB,
                    scoreOpp: m.scoreA,
                    result: resultFrom(m.scoreB, m.scoreA, m._draw),
                    leagueId, leagueTitle, date, customFlags
                });
            }
        }
    }
    return out;
}

export function topLuckiestMatches(entries, limit = 100) {
    return [...entries].sort((a, b) => b.luckGap - a.luckGap).slice(0, limit);
}

export function topBestPRMatches(entries, limit = 100) {
    return [...entries].sort((a, b) => a.pr - b.pr).slice(0, limit);
}

/**
 * Walk a player's per-league entries and emit oriented per-match rows for
 * the given league type. Shared by the three player-scoped collectors.
 * Returns: [{ m, league }] passthrough so each collector can compute its
 * own metric filter.
 */
function* walkPlayerMatches(perLeague, leagueType) {
    for (const entry of perLeague) {
        const league = entry.league;
        if (league.leagueType !== leagueType) continue;
        for (const m of entry.playerMatches) {
            if (m._technical) continue;
            yield { m, league };
        }
    }
}

function playerRowBase(m, league) {
    return {
        opponent: m.opponent,
        scoreSelf: m.scoreSelf,
        scoreOpp: m.scoreOpp,
        result: resultFrom(m.scoreSelf, m.scoreOpp, m._draw),
        leagueId: league.id,
        leagueTitle: league.title,
        date: m.updatedAt || league.params?.IssueDate || null,
        customFlags: league.params?.CustomFlags || {}
    };
}

export function collectPlayerBestPR(perLeague, leagueType, limit = 100) {
    const out = [];
    for (const { m, league } of walkPlayerMatches(perLeague, leagueType)) {
        if (m.prSelf == null) continue;
        out.push({ metric: m.prSelf, ...playerRowBase(m, league) });
    }
    return out.sort((a, b) => a.metric - b.metric).slice(0, limit);
}

export function collectPlayerBestOpponentPR(perLeague, leagueType, limit = 100) {
    const out = [];
    for (const { m, league } of walkPlayerMatches(perLeague, leagueType)) {
        if (m.prOpp == null) continue;
        out.push({ metric: m.prOpp, ...playerRowBase(m, league) });
    }
    return out.sort((a, b) => a.metric - b.metric).slice(0, limit);
}

export function collectPlayerBestLuckFor(perLeague, leagueType, limit = 100) {
    const out = [];
    for (const { m, league } of walkPlayerMatches(perLeague, leagueType)) {
        if (m.luckSelf == null || m.luckOpp == null) continue;
        const gap = m.luckSelf - m.luckOpp;
        if (gap <= 0) continue;
        out.push({ metric: gap, ...playerRowBase(m, league) });
    }
    return out.sort((a, b) => b.metric - a.metric).slice(0, limit);
}

export function collectPlayerWorstLuckAgainst(perLeague, leagueType, limit = 100) {
    const out = [];
    for (const { m, league } of walkPlayerMatches(perLeague, leagueType)) {
        if (m.luckSelf == null || m.luckOpp == null) continue;
        const gap = m.luckSelf - m.luckOpp;
        if (gap >= 0) continue;
        out.push({ metric: Math.abs(gap), _signed: gap, ...playerRowBase(m, league) });
    }
    return out.sort((a, b) => a._signed - b._signed).slice(0, limit);
}

function resultFrom(self, opp, draw) {
    if (draw) return 'D';
    if (self > opp) return 'W';
    if (self < opp) return 'L';
    return 'D';
}
