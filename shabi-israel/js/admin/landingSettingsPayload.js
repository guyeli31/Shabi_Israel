/**
 * landingSettingsPayload.js — build the staged `landing_settings` blob.
 *
 * Every writer stages the WHOLE row (publish ends in an upsert, see
 * supabaseAdmin.updateLandingSettings), so a payload assembled field-by-field
 * at each call site silently RESETS whatever field that site forgot. Adding
 * `completed_custom_order` made that concrete: three call sites build this
 * blob — landing edit mode, stageAddLeague and stageDeleteLeague — and the two
 * that only care about the order would have cleared the admin's A1 arrangement
 * as a side effect of adding or deleting an unrelated league.
 *
 * So the payload is built in exactly one place, from the current settings, with
 * only the fields the caller actually means to change passed as overrides. A
 * new column is then added here once instead of being remembered three times.
 *
 * `settings` may be EITHER shape and both occur at the call sites: the camelCase
 * object `loadLandingSettings()` returns, or an already-staged payload parsed
 * back out of the queue (which carries the PascalCase keys this function emits).
 * Reading both is what lets a second edit stack on top of a pending one instead
 * of resetting it — the `ls.DisplayOrder || ls.displayOrder` the call sites used
 * to spell out by hand, now written once.
 *
 * `settings` is READ-ONLY — `loadLandingSettings()` hands back the very object
 * its memo holds (see the note in leagueManager.stageAddLeague).
 */
export function landingSettingsPayload(settings, overrides = {}) {
    const s = settings || {};
    return {
        title:                s.title,
        subtitle:             s.subtitle,
        logoPath:             s.logoPath,
        DisplayOrder:         s.DisplayOrder ?? s.displayOrder ?? [],
        CompletedCustomOrder: (s.CompletedCustomOrder ?? s.completedCustomOrder) === true,
        ...overrides,
    };
}
