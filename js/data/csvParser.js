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
 * Parse CSV and assign each match a `round` number based on header rows.
 * Each `Player,...` header row begins a new round (round 1 starts after the first header).
 * Returns { matches, roundCount }.
 */
export function parseCSVWithRounds(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    let round = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.toLowerCase().startsWith('player')) {
            round += 1;
            continue;
        }

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

        if (playerA === 'Bye' || playerB === 'Bye') continue;
        if (scoreA === 0 && scoreB === 0 && prA === 0 && prB === 0) continue;

        matches.push({
            playerA, prA, luckA, scoreA,
            playerB, prB, luckB, scoreB,
            round: round || 1
        });
    }

    return { matches, roundCount: Math.max(round, 1) };
}

/**
 * Same as parseCSVWithRounds, but includes unplayed rows (zero scores/PRs).
 */
export function parseCSVAllWithRounds(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    let round = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().startsWith('player')) { round += 1; continue; }

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

        if (playerA === 'Bye' || playerB === 'Bye') continue;

        matches.push({
            playerA, prA, luckA, scoreA,
            playerB, prB, luckB, scoreB,
            round: round || 1,
            played: !(scoreA === 0 && scoreB === 0 && prA === 0 && prB === 0)
        });
    }
    return { matches, roundCount: Math.max(round, 1) };
}

/**
 * Parse CSV including unplayed rows (all-zero scores/PRs).
 * Same as parseCSV but without the zero-row filter.
 */
export function parseCSVAll(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
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

        if (playerA === 'Bye' || playerB === 'Bye') continue;

        matches.push({ playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB });
    }

    return matches;
}

/**
 * Get all unique player names from raw CSV text, including those with no played matches.
 * Unlike getAllPlayers(), this does NOT filter out unplayed rows (all-zero scores/PRs).
 * Returns a Set<string>.
 */
export function getAllPlayersFromCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const players = new Set();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().startsWith('player')) continue;

        const parts = trimmed.split(',');
        if (parts.length < 8) continue;

        const playerA = parts[0].trim();
        const playerB = parts[4].trim();

        if (playerA && playerA !== 'Bye') players.add(playerA);
        if (playerB && playerB !== 'Bye') players.add(playerB);
    }

    return players;
}

/**
 * Count all unique players from raw CSV text, including those with no played matches.
 */
export function countAllPlayers(csvText) {
    return getAllPlayersFromCSV(csvText).size;
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
 * If allPlayersSet is provided, uses it to include all league players (even those with no matches).
 * Returns array of: { opponent, scoreSelf, scoreOpp, prSelf, prOpp, luckSelf, luckOpp, played }
 */
export function getPlayerMatches(matches, playerName, allPlayersSet) {
    const playerList = allPlayersSet ? [...allPlayersSet].sort() : getAllPlayers(matches);
    const opponents = playerList.filter(p => p !== playerName);
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
                played: true,
                _technical: m._technical || false,
                _draw: m._draw || false
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
                played: true,
                _technical: m._technical || false,
                _draw: m._draw || false
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
