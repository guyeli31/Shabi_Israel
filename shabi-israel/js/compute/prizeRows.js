/**
 * prizeRows.js — the row list behind the Prizes & Medals table (B1 on the league
 * dashboard, F6 in the admin).
 *
 * A league has exactly three medals, but it can hand out more than three KINDS
 * of prize: gold takes ₪500, the two runners-up take ₪250 each, the next four
 * take ₪100. So each medal tier carries an optional list of EXTRA rows, each
 * with its own Places count and its own prize amount, rendered under that
 * medal's own row.
 *
 * An extra row is a real prize level, so it awards real medals: two Gold rows of
 * one place each ARE two gold medals, and every ranking surface has to agree —
 * the podium tinting on the league table (D) and the historical view (B2), how
 * many rows B2 shows, the medal tallies on the landing page and the player
 * pages. `getMedalPlaces()` is the ONE place that answers "how many places does
 * this tier award", and every one of those call sites reads it rather than the
 * raw *Count params, so a tier can never mean one thing in B1 and another in D.
 *
 * Storage lives INSIDE the existing `Prizes` object (a jsonb column, so no
 * migration and no new params key), under `Extra`, keyed by tier:
 *
 *   "Prizes": {
 *     "Gold": 500, "Silver": 300, "Bronze": 100,
 *     "Extra": { "Gold": [{ "count": 2, "prize": 250 }] }
 *   }
 *
 * `Extra` is omitted entirely when no tier has one, so a league that never uses
 * the feature keeps the exact JSON it has today.
 */

/** The key inside Prizes that holds the extra rows. */
export const EXTRA_PRIZES_KEY = 'Extra';

/**
 * The three medal tiers, in podium order. `icon` is the literal emoji (for the
 * places that put the value into a table cell as text); `iconHtml` is the
 * numeric entity (for the places that build an HTML string).
 */
export const MEDAL_TIERS = [
    { tier: 'Gold',   icon: '🥇', iconHtml: '&#x1F947;', cls: 'medal-gold',   countKey: 'GoldCount',   defaultCount: 1 },
    { tier: 'Silver', icon: '🥈', iconHtml: '&#x1F948;', cls: 'medal-silver', countKey: 'SilverCount', defaultCount: 1 },
    { tier: 'Bronze', icon: '🥉', iconHtml: '&#x1F949;', cls: 'medal-bronze', countKey: 'BronzeCount', defaultCount: 0 },
];

function toCount(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function toPrize(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Normalise the extra rows out of a Prizes object into a full tier→array map.
 * Always returns every tier key with an array (possibly empty), so callers never
 * need their own `|| []`. Rows with no places are dropped — a row that awards
 * nobody is not a row.
 *
 * @param {object} [prizes] — a league's params.Prizes
 * @returns {{Gold: Array<{count:number,prize:number}>, Silver: Array, Bronze: Array}}
 */
export function getExtraPrizeRows(prizes) {
    const raw = (prizes && prizes[EXTRA_PRIZES_KEY]) || {};
    const out = {};
    for (const { tier } of MEDAL_TIERS) {
        const list = Array.isArray(raw[tier]) ? raw[tier] : [];
        out[tier] = list
            .map(r => ({ count: toCount(r && r.count), prize: toPrize(r && r.prize) }))
            .filter(r => r.count > 0);
    }
    return out;
}

/**
 * Write an extra-row map back into a Prizes object, returning a NEW object.
 * Empty tiers are dropped and the whole `Extra` key is omitted when nothing is
 * left, so an admin who adds a row and then removes it again gets back the
 * original JSON rather than an empty husk that shows up as a pending change.
 *
 * @param {object} basePrizes — { Gold, Silver, Bronze } money amounts
 * @param {object} extra — tier → array of { count, prize }
 */
export function withExtraPrizeRows(basePrizes, extra) {
    const out = { ...basePrizes };
    delete out[EXTRA_PRIZES_KEY];
    const kept = {};
    for (const { tier } of MEDAL_TIERS) {
        const list = (extra && Array.isArray(extra[tier]) ? extra[tier] : [])
            .map(r => ({ count: toCount(r && r.count), prize: toPrize(r && r.prize) }))
            .filter(r => r.count > 0);
        if (list.length) kept[tier] = list;
    }
    if (Object.keys(kept).length) out[EXTRA_PRIZES_KEY] = kept;
    return out;
}

/** How many extra rows a Prizes object carries in total (for change summaries). */
export function countExtraPrizeRows(prizes) {
    const extra = getExtraPrizeRows(prizes);
    return MEDAL_TIERS.reduce((n, { tier }) => n + extra[tier].length, 0);
}

/**
 * How many PLACES each medal tier awards: the tier's own Places count plus the
 * Places of every extra prize row under it. This is the number every ranking
 * surface means by "gold count" — B1 shows the breakdown, D/B2/the leaderboard
 * need the total.
 *
 * A tier whose own count is 0 is not in the league, so it awards 0 places
 * however many extra rows are configured under it — the same rule
 * buildPrizeRows() uses when it hides that tier's rows.
 *
 * @param {object} params — a league's params
 * @param {{gold?:number,silver?:number,bronze?:number}} [defaults] — what to use
 *        when a *Count param is absent. Call sites differ here (bronze has been
 *        defaulted to 1, 3 and 4 in different tables), so each passes its own
 *        rather than having one silently imposed on it.
 */
export function getMedalPlaces(params, defaults = {}) {
    const extra = getExtraPrizeRows(params && params.Prizes);
    const out = {};
    for (const t of MEDAL_TIERS) {
        const key = t.tier.toLowerCase();
        const base = (params && params[t.countKey]) ?? defaults[key] ?? t.defaultCount;
        out[key] = base ? base + extra[t.tier].reduce((n, r) => n + r.count, 0) : 0;
    }
    return out;
}

/**
 * The full row list for the Prizes & Medals table, base rows and extra rows
 * interleaved in podium order.
 *
 * A tier with a Places count of 0 is not in the league at all, so its extra rows
 * are hidden with it — the extras hang off the medal, they are not a tier of
 * their own.
 *
 * @param {object} params — a league's params (needs the *Count keys and Prizes)
 * @returns {Array<{tier,icon,iconHtml,cls,count,prize,isExtra}>} prize is a
 *          number or null (null renders as an em dash).
 */
export function buildPrizeRows(params) {
    const prizes = (params && params.Prizes) || {};
    const extra = getExtraPrizeRows(prizes);
    const rows = [];
    for (const t of MEDAL_TIERS) {
        const count = params[t.countKey] ?? t.defaultCount;
        if (!count) continue;
        rows.push({
            tier: t.tier, icon: t.icon, iconHtml: t.iconHtml, cls: t.cls,
            count,
            prize: prizes[t.tier] != null ? prizes[t.tier] : null,
            isExtra: false,
        });
        for (const r of extra[t.tier]) {
            rows.push({
                tier: t.tier, icon: t.icon, iconHtml: t.iconHtml, cls: t.cls,
                count: r.count, prize: r.prize, isExtra: true,
            });
        }
    }
    return rows;
}

/** Shared money formatting for the prize column ('—' when there is no amount). */
export function formatPrize(value) {
    return value == null ? '—' : `₪${Number(value).toLocaleString()}`;
}
