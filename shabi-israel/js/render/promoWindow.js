/**
 * promoWindow.js — GENERATED, DO NOT EDIT.
 *
 * Source: assets/promo/promo-config.json
 * Regenerate: node scripts/build-promo-window.mjs   (--check to verify)
 *
 * The UBC announcement's date window, in Israel wall-clock days (inclusive at
 * both ends), as a pair of constants rather than a fetched config — because
 * js/analytics.js has to know whether the announcement is on screen BEFORE it
 * sends the pageview, and a fetch resolves far too late for that. Full
 * rationale in scripts/build-promo-window.mjs.
 *
 * TEMPORARY, with js/render/promoNotice.js — delete both together.
 */

export const PROMO_STARTS_ON = '2026-09-20';
export const PROMO_ENDS_ON = '2026-10-01';
