/**
 * csvIntegrity.js — Two-layer validation for a league CSV (leaguedata format).
 *
 * A league's CSV shape is FIXED the moment the league is created: the same roster,
 * the same number of rounds, the same number of rows per round, always the 8-column
 * `Player,PR,Luck,Score,Player,PR,Luck,Score` layout, with a repeated header line
 * separating each round. Unplayed matches are still present as rows (all zeros) —
 * so a structurally complete CSV exists from day one, and the source site's
 * "rounds played" counter says nothing about export completeness.
 *
 *   LAYER 1 — structure: does this CSV even belong to THIS league?
 *     Roster / round count / rows-per-round / column layout must line up. If they
 *     don't, the export is for a different league (or is garbage).
 *
 *   LAYER 2 — regression: is a match that ALREADY HAS A RESULT missing or unplayed
 *     in this CSV? Split by cause (see splitRegressions), because the two cases are
 *     opposites:
 *       • real — played per the DATA, unplayed in the new CSV. The source served a
 *         stale/partial export. BLOCKING: nothing is written, results stay as they
 *         are, and the exact matches are named.
 *       • overridden — has a result only because of a MANUAL OVERRIDE. Overrides
 *         live outside the CSV, so the source showing it unplayed is EXPECTED.
 *         A warning, never a block.
 *
 * Shared by scripts/sync-source.js (Node) and js/admin/csvValidation.js (browser),
 * so both paths judge a CSV by exactly the same rules.
 */

const HEADER_RE = /^player\s*,/i;

/** Order-independent key for a pairing. */
export function pairKey(a, b) {
    return [a, b].sort().join('|');
}

/**
 * The structural skeleton of a raw CSV — no stats, no filtering.
 * `players`, `matchCounts` and `totalMatches` all EXCLUDE 'Bye' rows, so they line
 * up with what parseCSVAllWithRounds() and the `matches` table hold. `roundSizes`
 * counts the RAW rows (Bye included) — that's what the uniformity check needs.
 */
export function readCsvStructure(csvText) {
    const lines = String(csvText || '').split(/\r?\n/);
    const roundSizes = [];
    const matchCounts = [];
    const players = new Set();
    const pairs = new Set();
    const malformed = [];
    let rounds = 0;

    lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;

        if (HEADER_RE.test(line)) {
            rounds += 1;
            roundSizes.push(0);
            matchCounts.push(0);
            return;
        }
        if (rounds === 0) {
            malformed.push({ line: i + 1, reason: 'data row before any round header' });
            return;
        }
        const parts = line.split(',');
        if (parts.length < 8) {
            malformed.push({ line: i + 1, reason: `${parts.length} columns, expected 8` });
            return;
        }

        const a = parts[0].trim();
        const b = parts[4].trim();
        roundSizes[rounds - 1] += 1;
        if (a && a !== 'Bye') players.add(a);
        if (b && b !== 'Bye') players.add(b);
        if (a !== 'Bye' && b !== 'Bye') {
            matchCounts[rounds - 1] += 1;
            pairs.add([a, b].sort().join('|'));
        }
    });

    const uniformRoundSize = roundSizes.length > 0 && roundSizes.every((n) => n === roundSizes[0]);
    return {
        rounds,
        roundSizes,
        matchCounts,
        rowsPerRound: uniformRoundSize ? roundSizes[0] : null,
        uniformRoundSize,
        players,
        pairs,
        totalMatches: matchCounts.reduce((s, n) => s + n, 0),
        malformed,
    };
}

/**
 * The set of PAIRINGS in a match list, as orientation-independent keys.
 *
 * "Dan vs Ron" and "Ron vs Dan" are one fixture, so the key is the two names
 * sorted. This matters in practice: a league's own round-robin is generated in
 * one orientation and an imported file may carry the other, and comparing raw
 * A/B columns would report every match as both added and removed.
 *
 * This is the identity of a league's SHAPE — which pairs meet at all — as
 * distinct from describeLeagueShape below, which counts rounds and rows. Two
 * files can agree on every count and still describe different tournaments.
 */
export function collectPairs(matches) {
    const out = new Set();
    for (const m of matches || []) {
        if (!m.playerA || !m.playerB) continue;
        if (m.playerA === 'Bye' || m.playerB === 'Bye') continue;
        out.add([m.playerA, m.playerB].sort().join('|'));
    }
    return out;
}

/** "Dan|Ron" → "Dan vs Ron", for display. */
export function formatPair(key) {
    return key.split('|').join(' vs ');
}

/** Every pairing a full round robin over `names` would contain. */
export function allPossiblePairs(names) {
    const list = [...names].sort();
    const out = new Set();
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            out.add([list[i], list[j]].sort().join('|'));
        }
    }
    return out;
}

/**
 * The expected shape of a league, derived from the matches it already has.
 * @param {Array} matches — ALL matches incl. unplayed, Bye already excluded
 *   (i.e. parseCSVAllWithRounds().matches, or the `matches` table).
 */
export function describeLeagueShape(matches) {
    const pairs = collectPairs(matches);
    const players = new Set();
    const matchesPerRound = new Map();
    for (const m of matches || []) {
        players.add(m.playerA);
        players.add(m.playerB);
        const r = m.round || 1;
        matchesPerRound.set(r, (matchesPerRound.get(r) || 0) + 1);
    }
    return {
        players,
        pairs,
        rounds: matchesPerRound.size ? Math.max(...matchesPerRound.keys()) : 0,
        matchesPerRound,
        totalMatches: (matches || []).length,
    };
}

/**
 * LAYER 1 — is this CSV structurally this league's?
 * `expected` may be null (brand-new league): then only self-consistency is checked,
 * since there is nothing to compare against.
 * @returns {{ok: boolean, errors: string[], structure: object}}
 */
export function validateCsvStructure(csvText, expected = null) {
    const structure = readCsvStructure(csvText);
    const errors = [];

    if (structure.rounds === 0) {
        errors.push('The file has no round header line — this is not a league CSV.');
    }
    if (structure.malformed.length > 0) {
        const sample = structure.malformed.slice(0, 3)
            .map((m) => `line ${m.line} (${m.reason})`).join('; ');
        errors.push(`${structure.malformed.length} row(s) don't have the expected 8 columns — ${sample}.`);
    }
    if (structure.rounds > 0 && !structure.uniformRoundSize) {
        const sizes = structure.roundSizes
            .map((n, i) => `round ${i + 1}: ${n}`)
            .filter((_, i) => structure.roundSizes[i] !== structure.roundSizes[0])
            .slice(0, 3).join(', ');
        errors.push(`Rounds don't all have the same number of rows (expected ${structure.roundSizes[0]} — ${sizes}).`);
    }

    if (expected && expected.rounds > 0) {
        if (structure.rounds !== expected.rounds) {
            errors.push(`The CSV has ${structure.rounds} round(s); this league has ${expected.rounds}.`);
        }
        const missing = [...expected.players].filter((p) => !structure.players.has(p)).sort();
        const extra = [...structure.players].filter((p) => !expected.players.has(p)).sort();
        if (missing.length > 0) {
            errors.push(`${missing.length} league player(s) missing from the CSV: ${missing.join(', ')}.`);
        }
        if (extra.length > 0) {
            errors.push(`${extra.length} player(s) in the CSV don't belong to this league: ${extra.join(', ')}.`);
        }
        if (structure.totalMatches !== expected.totalMatches) {
            errors.push(`The CSV has ${structure.totalMatches} match rows; this league has ${expected.totalMatches}.`);
        }
        // THE PAIRINGS THEMSELVES. Every check above compares counts and name
        // sets, and a file can satisfy all of them while describing a different
        // draw: same players, same rounds, same row count, different opponents.
        // A league's fixture list is fixed when it is created, so a file that
        // re-draws it is not this league's data — whoever is importing it.
        //
        // Lives HERE, in the shared integrity layer, rather than in the admin's
        // report: the scheduled External Source sync runs these same two layers
        // headlessly and writes without anyone watching. A rule that only the
        // admin screen enforced would be a rule the automated path could quietly
        // break, which is the failure mode this file exists to prevent.
        if (expected.pairs) {
            const addedPairs = [...structure.pairs].filter((p) => !expected.pairs.has(p)).sort();
            const gonePairs = [...expected.pairs].filter((p) => !structure.pairs.has(p)).sort();
            const show = (list) => list.slice(0, 6).map((p) => p.split('|').join(' vs ')).join(', ')
                + (list.length > 6 ? ` … and ${list.length - 6} more` : '');
            if (addedPairs.length > 0) {
                errors.push(`${addedPairs.length} pairing(s) in the CSV are not fixtures of this league: ${show(addedPairs)}.`);
            }
            if (gonePairs.length > 0) {
                errors.push(`${gonePairs.length} of this league's fixtures are missing from the CSV: ${show(gonePairs)}.`);
            }
        }
    }

    return { ok: errors.length === 0, errors, structure };
}

/**
 * Collapse a league's current state into the list of pairings that ALREADY have a
 * result — from the data itself or from a manual override. A 'not_played' override
 * explicitly un-plays a pairing, so it removes one.
 *
 * @param {Array} allMatches — every match row incl. unplayed (Bye excluded)
 * @param {Array} overrides — manual_overrides rows ({type, playerA, playerB, ...})
 * @returns {Array} [{playerA, playerB, scoreA, scoreB, prA, prB, luckA, luckB, source}]
 */
export function collectPlayed(allMatches, overrides) {
    const byKey = new Map();
    for (const m of allMatches || []) {
        if (m.played) byKey.set(pairKey(m.playerA, m.playerB), { ...m, source: 'csv' });
    }
    for (const o of overrides || []) {
        const k = pairKey(o.playerA, o.playerB);
        if (o.type === 'not_played') { byKey.delete(k); continue; }
        byKey.set(k, {
            playerA: o.playerA, playerB: o.playerB,
            scoreA: o.scoreA, scoreB: o.scoreB,
            prA: o.prA, prB: o.prB, luckA: o.luckA, luckB: o.luckB,
            source: 'manual',
        });
    }
    return [...byKey.values()];
}

/**
 * LAYER 2 — which already-played matches come back unplayed/absent in this CSV?
 * A non-empty result is the signature of a stale/partial export from the source.
 *
 * @param {Array} newMatches — parseCSVAllWithRounds(csv).matches
 * @param {Array} previouslyPlayed — from collectPlayed()
 * @returns {Array} [{playerA, playerB, source}]
 */
export function findPlayedRegressions(newMatches, previouslyPlayed) {
    const nowPlayed = new Set(
        (newMatches || []).filter((m) => m.played).map((m) => pairKey(m.playerA, m.playerB)),
    );
    return (previouslyPlayed || [])
        .filter((p) => !nowPlayed.has(pairKey(p.playerA, p.playerB)))
        .map((p) => ({ playerA: p.playerA, playerB: p.playerB, source: p.source || 'csv' }));
}

/**
 * Split regressions by what they actually mean. The two are NOT the same problem:
 *
 *   real       — the pairing was played according to the DATA, and the new CSV says
 *                it isn't. That's a genuine loss of results: the source served a
 *                stale/partial export. Blocking.
 *
 *   overridden — the pairing only has a result because an admin entered a MANUAL
 *                OVERRIDE. Overrides live outside the CSV — the source has never
 *                heard of them — so the CSV showing the pairing as unplayed is the
 *                EXPECTED, correct state, not data loss. The override wins on
 *                render either way (applyOverrides runs on top of the CSV).
 *                Worth surfacing, never worth blocking.
 */
export function splitRegressions(regressions) {
    const list = regressions || [];
    return {
        real: list.filter((r) => r.source !== 'manual'),
        overridden: list.filter((r) => r.source === 'manual'),
    };
}

/** "A vs B, C vs D (manual), and 3 more" — for a log line or an admin warning. */
export function formatRegressions(regressions, max = 8) {
    const list = regressions || [];
    const shown = list.slice(0, max)
        .map((r) => `${r.playerA} vs ${r.playerB}${r.source === 'manual' ? ' (manual)' : ''}`);
    const rest = list.length - shown.length;
    return shown.join(', ') + (rest > 0 ? `, and ${rest} more` : '');
}
