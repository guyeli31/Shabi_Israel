/**
 * csvParser.js — Parse raw CSV text into an array of match objects.
 * Handles header rows, "Bye" entries, and empty rows.
 *
 * Each match object: { playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB }
 */

export function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip header rows
        if (trimmed.toLowerCase().startsWith('player')) continue;

        const parts = trimmed.split(',');
        if (parts.length < 8) continue;

        const playerA = parts[0].trim();
        const prA = parseFloat(parts[1]) || 0;
        const luckA = parseFloat(parts[2]) || 0;
        const scoreA = parseFloat(parts[3]) || 0;
        const playerB = parts[4].trim();
        const prB = parseFloat(parts[5]) || 0;
        const luckB = parseFloat(parts[6]) || 0;
        const scoreB = parseFloat(parts[7]) || 0;

        // Skip Bye entries (either side)
        if (playerA === 'Bye' || playerB === 'Bye') continue;

        // Skip rows where both scores are 0 and both PRs are 0 (unplayed/invalid)
        if (scoreA === 0 && scoreB === 0 && prA === 0 && prB === 0) continue;

        matches.push({ playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB });
    }

    return matches;
}

/**
 * Get list of all unique player names from matches.
 */
export function getAllPlayers(matches) {
    const players = new Set();
    for (const m of matches) {
        players.add(m.playerA);
        players.add(m.playerB);
    }
    return [...players].sort();
}

/**
 * Get all matches for a specific player, normalized so the player is always "self".
 * Returns array of: { opponent, scoreSelf, scoreOpp, prSelf, prOpp, luckSelf, luckOpp, played }
 */
export function getPlayerMatches(matches, playerName) {
    const allPlayers = getAllPlayers(matches);
    const opponents = allPlayers.filter(p => p !== playerName);
    const matchMap = new Map();

    // Collect all played matches for this player
    for (const m of matches) {
        if (m.playerA === playerName) {
            matchMap.set(m.playerB, {
                opponent: m.playerB,
                scoreSelf: m.scoreA,
                scoreOpp: m.scoreB,
                prSelf: m.prA,
                prOpp: m.prB,
                luckSelf: m.luckA,
                luckOpp: m.luckB,
                played: true
            });
        } else if (m.playerB === playerName) {
            matchMap.set(m.playerA, {
                opponent: m.playerA,
                scoreSelf: m.scoreB,
                scoreOpp: m.scoreA,
                prSelf: m.prB,
                prOpp: m.prA,
                luckSelf: m.luckB,
                luckOpp: m.luckA,
                played: true
            });
        }
    }

    // Build full list including unplayed opponents
    return opponents.map(opp => {
        if (matchMap.has(opp)) {
            return matchMap.get(opp);
        }
        return {
            opponent: opp,
            scoreSelf: 0,
            scoreOpp: 0,
            prSelf: 0,
            prOpp: 0,
            luckSelf: 0,
            luckOpp: 0,
            played: false
        };
    });
}
