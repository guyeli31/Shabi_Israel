// data/csvParser.js — parse raw CSV text into match objects.
//
// Each row of league CSV: playerA, prA, luckA, scoreA, playerB, prB, luckB, scoreB.
// Header rows ("Player,...") delimit rounds. "Bye" entries and all-zero
// rows are filtered out by the played-row parsers; -All variants keep them.
//
// Direct port of v1 js/data/csvParser.js — pure logic, no DOM, no fetch.

function parseRow(parts) {
    return {
        playerA: parts[0].trim(),
        prA:     parseFloat(parts[1]) || 0,
        luckA:   parseFloat(parts[2]) || 0,
        scoreA:  parseFloat(parts[3]) || 0,
        playerB: parts[4].trim(),
        prB:     parseFloat(parts[5]) || 0,
        luckB:   parseFloat(parts[6]) || 0,
        scoreB:  parseFloat(parts[7]) || 0,
    };
}

function isUnplayed({ scoreA, scoreB, prA, prB }) {
    return scoreA === 0 && scoreB === 0 && prA === 0 && prB === 0;
}

function isHeader(line) {
    return line.toLowerCase().startsWith("player");
}

export function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isHeader(trimmed)) continue;
        const parts = trimmed.split(",");
        if (parts.length < 8) continue;
        const row = parseRow(parts);
        if (row.playerA === "Bye" || row.playerB === "Bye") continue;
        if (isUnplayed(row)) continue;
        matches.push(row);
    }
    return matches;
}

export function parseCSVWithRounds(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    let round = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isHeader(trimmed)) { round += 1; continue; }
        const parts = trimmed.split(",");
        if (parts.length < 8) continue;
        const row = parseRow(parts);
        if (row.playerA === "Bye" || row.playerB === "Bye") continue;
        if (isUnplayed(row)) continue;
        matches.push({ ...row, round: round || 1 });
    }
    return { matches, roundCount: Math.max(round, 1) };
}

export function parseCSVAllWithRounds(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    let round = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isHeader(trimmed)) { round += 1; continue; }
        const parts = trimmed.split(",");
        if (parts.length < 8) continue;
        const row = parseRow(parts);
        if (row.playerA === "Bye" || row.playerB === "Bye") continue;
        matches.push({ ...row, round: round || 1, played: !isUnplayed(row) });
    }
    return { matches, roundCount: Math.max(round, 1) };
}

export function parseCSVAll(csvText) {
    const lines = csvText.split(/\r?\n/);
    const matches = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isHeader(trimmed)) continue;
        const parts = trimmed.split(",");
        if (parts.length < 8) continue;
        const row = parseRow(parts);
        if (row.playerA === "Bye" || row.playerB === "Bye") continue;
        matches.push(row);
    }
    return matches;
}

export function getAllPlayersFromCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const players = new Set();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || isHeader(trimmed)) continue;
        const parts = trimmed.split(",");
        if (parts.length < 8) continue;
        const a = parts[0].trim();
        const b = parts[4].trim();
        if (a && a !== "Bye") players.add(a);
        if (b && b !== "Bye") players.add(b);
    }
    return players;
}

export function countAllPlayers(csvText) {
    return getAllPlayersFromCSV(csvText).size;
}

export function getAllPlayers(matches) {
    const players = new Set();
    for (const m of matches) {
        players.add(m.playerA);
        players.add(m.playerB);
    }
    return [...players].sort();
}

/**
 * All matches for a single player, normalised so the queried player is
 * always "self". When `allPlayersSet` is provided, the result includes
 * unplayed opponents (zero-score entries with played:false).
 */
export function getPlayerMatches(matches, playerName, allPlayersSet) {
    const playerList = allPlayersSet ? [...allPlayersSet].sort() : getAllPlayers(matches);
    const opponents = playerList.filter((p) => p !== playerName);
    const byOpp = new Map();

    for (const m of matches) {
        if (m.playerA === playerName) {
            byOpp.set(m.playerB, {
                opponent: m.playerB,
                scoreSelf: m.scoreA, scoreOpp: m.scoreB,
                prSelf: m.prA, prOpp: m.prB,
                luckSelf: m.luckA, luckOpp: m.luckB,
                played: true,
                _technical: m._technical || false,
                _draw: m._draw || false,
                updatedAt: m.updatedAt || null,
            });
        } else if (m.playerB === playerName) {
            byOpp.set(m.playerA, {
                opponent: m.playerA,
                scoreSelf: m.scoreB, scoreOpp: m.scoreA,
                prSelf: m.prB, prOpp: m.prA,
                luckSelf: m.luckB, luckOpp: m.luckA,
                played: true,
                _technical: m._technical || false,
                _draw: m._draw || false,
                updatedAt: m.updatedAt || null,
            });
        }
    }

    return opponents.map((opp) =>
        byOpp.get(opp) || {
            opponent: opp,
            scoreSelf: 0, scoreOpp: 0,
            prSelf: 0, prOpp: 0,
            luckSelf: 0, luckOpp: 0,
            played: false,
        }
    );
}
