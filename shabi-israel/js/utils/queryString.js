/**
 * queryString.js — the two primitives behind the project's URL contract.
 *
 * See CLAUDE.md § URL contract for the rule this file exists to enforce:
 * a slug in the URL is ALWAYS the visible label, lowercased, spaces → hyphens.
 * Call sites DERIVE their slug from tabSlug() rather than declaring the id and
 * the label separately, so a label rename can never leave a stale slug behind.
 *
 * Verified with `node scripts/check-url-contract.js`, which imports tabSlug()
 * from here so the checker and the runtime can't disagree about what "kebab"
 * means.
 */

/**
 * Visible tab label → URL slug. Throws rather than sanitising: a label with a
 * character that can't survive a URL must be RENAMED, not silently mangled
 * into a slug nobody can predict from looking at the screen.
 *
 *   'Charts'        → 'charts'
 *   'Upload CSV'    → 'upload-csv'
 *   'H2H'           → 'h2h'
 *   'Pending Changes' → 'pending-changes'
 */
export function tabSlug(label) {
    const slug = String(label).trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        throw new Error(
            `tabSlug: ${JSON.stringify(label)} → ${JSON.stringify(slug)}, which is not a valid slug. ` +
            `Labels that reach the URL must be plain words separated by spaces — rename the label.`
        );
    }
    return slug;
}

/**
 * Return `pathname + search + hash` with exactly one query param
 * added / replaced (value) or removed (value === null), leaving every other
 * byte of location.search untouched.
 *
 * Why not `new URL(location)` + searchParams.set(): URLSearchParams
 * RE-SERIALISES the whole query on write, and its serialiser encodes a space
 * as `+` while encodeURIComponent — what helpers.js leagueUrl() uses — emits
 * `%20`. Editing one param therefore silently rewrote every other one:
 * `league.html?league=July%20 2026` became `?league=July+2026` in the address
 * bar, so the same league had two different URL strings depending on whether
 * the page happened to have tabs. Splicing the raw string keeps the URL the
 * author built byte-identical.
 *
 * @param {string} name — param name
 * @param {string|null} value — new value, or null to remove the param
 * @param {Location|URL} [loc] — defaults to window.location
 */
export function spliceQueryParam(name, value, loc = location) {
    const raw = loc.search.replace(/^\?/, '');
    const kept = raw ? raw.split('&').filter(pair => pair && paramName(pair) !== name) : [];
    if (value !== null && value !== undefined) {
        kept.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
    return loc.pathname + (kept.length ? `?${kept.join('&')}` : '') + loc.hash;
}

/**
 * Boolean URL flags (`?edit`, `?preview`) are written VALUELESS and read by
 * presence — one convention, so nobody has to remember which flag wanted `=1`
 * and which wanted `=true`. The two used to disagree, which made `?preview=false`
 * turn preview mode ON: it was read with `.has()` while `?edit` was read with
 * `=== '1'`.
 *
 * The old valued forms are still honoured on read so bookmarks and pasted links
 * from before the change keep working. An explicit falsy value (`?edit=0`,
 * `?preview=false`) reads as OFF — the one thing the old code got wrong.
 *
 * @param {string} name
 * @param {Location|URL} [loc]
 */
export function hasUrlFlag(name, loc = location) {
    const value = new URLSearchParams(loc.search).get(name);
    if (value === null) return false;                 // param absent
    if (value === '') return true;                    // `?edit` — the canonical form
    return !/^(0|false|no)$/i.test(value);            // `?edit=1`, `?preview=true`, …
}

/** Decoded name half of a raw `a=b` query pair. */
function paramName(pair) {
    const key = pair.split('=')[0];
    try { return decodeURIComponent(key); } catch { return key; }
}
