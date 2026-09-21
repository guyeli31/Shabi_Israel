/**
 * retirementMarks.js — the ONE place that renders "this player retired" and
 * "this match was cancelled".
 *
 * Two marks, one visual language, deliberately different words:
 *
 *   RETIRED    describes a PERSON   — D's grey row, player_league.html's header
 *   CANCELLED  describes a MATCH    — B6 Rounds, E, C2
 *
 * The whole retirement design rests on those being separate statements: the
 * flag `leagues.retired_players` marks the person and drives display only,
 * while a `cancelled` override marks the match and drives every computation
 * (docs/RETIREMENT-POLICY.md §1). A match row tagged RETIRED would re-merge the
 * two concepts in the one place a reader can actually see them, so the styling
 * is shared here and the wording is not.
 *
 * Shared as a module rather than as a class name each table writes for itself,
 * because this project has paid for the alternative before: a treatment copied
 * to four call sites is a treatment that disagrees with itself at the fifth.
 * Call sites take the constants and helpers from here; the CSS lives once in
 * css/components.css.
 */

/** Pill on a retired player's name/row. */
export const RETIRED_BADGE_CLASS = 'retired-badge';
/** Pill in place of a cancelled match's date. */
export const CANCELLED_MARK_CLASS = 'cancelled-mark';
/** Row modifiers — the grey treatment D uses, reused by the match tables. */
export const RETIRED_ROW_CLASS = 'retired-row';
export const CANCELLED_ROW_CLASS = 'cancelled-row';

export function retiredBadgeHtml() {
    return `<span class="${RETIRED_BADGE_CLASS}">RETIRED</span>`;
}

export function cancelledMarkHtml() {
    return `<span class="${CANCELLED_MARK_CLASS}">CANCELLED</span>`;
}

/**
 * Is this player retired from this league?
 *
 * DISPLAY ONLY. This is the one question `retired_players` is allowed to
 * answer, and only a renderer may ask it — see the standing rule in
 * docs/RETIREMENT-POLICY.md §5.2. A compute module that finds itself wanting
 * this is asking the wrong question: what it actually needs is whether the
 * match is cancelled, which `isCancelled()` in js/data/applyOverrides.js
 * answers from the fixture itself.
 */
export function isRetired(params, playerName) {
    return ((params && params.RetiredPlayers) || []).includes(playerName);
}
