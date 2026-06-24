/**
 * tabIcons.js — Decorative icons for the main app-tab bars (mountAppTabs).
 *
 * Each value is inline HTML that appTabs.js drops inside
 *   <span class="app-tab-icon" aria-hidden="true"> … </span>
 * before the tab label, so the glyph aids visual scanning without being read
 * by screen readers. Keyed by tab id, shared across pages so the same concept
 * (Leagues, Matches, Records) always shows the same icon.
 *
 * Mix decided 2026-06-25: Leagues reuses the search bar's table/grid SVG
 * line-glyph (theme-aware via currentColor); the rest are emoji.
 */

// Table/grid glyph — same artwork as the search bar's league icon
// (js/render/navigation.js search results). currentColor → takes the tab's
// active/inactive text colour automatically.
const LEAGUE_GLYPH =
    '<svg class="app-tab-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
    ' stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/>' +
    '<line x1="2" y1="6.5" x2="14" y2="6.5"/>' +
    '<line x1="8" y1="6.5" x2="8" y2="13"/></svg>';

export const TAB_ICONS = {
    // INDEX (landing)
    leagues:     LEAGUE_GLYPH,
    leaderboard: '👑',
    records:     '📜',
    players:     '👥',
    // LEAGUE CARD (dashboard)
    standings:   '📊',
    matches:     '🎲',
    predictor:   '🔮',
    insights:    '📈',
    // PLAYER CARD (player general) — leagues/matches/records reuse the above
    statistics:  '📊',
    h2h:         '🆚',
};
