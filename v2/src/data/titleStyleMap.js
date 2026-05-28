// data/titleStyleMap.js — map title tiers to CSS class names.
//
// v1 carried inline colour styles (TIER_COLORS) and emitted raw HTML from
// titleConstants. In v2 the colours come from theme tokens via component
// CSS (PlayerCell title badges, PlayerHero chips). This module is the
// declarative join between the pure title data and those component class
// names, so the data layer never references CSS literals.

/** BMAB-tier → CSS class for compact in-table badges (PlayerCell). */
export const TIER_ABBR_CLASS = {
    gold:   "title-abbr--gold",
    silver: "title-abbr--silver",
    bronze: "title-abbr--bronze",
    white:  "title-abbr--white",
};

/** Championship-tier → CSS class for compact championship badge (WC / NC). */
export const CHAMP_ABBR_CLASS = {
    gold:   "title-abbr--champ title-abbr--gold",
    silver: "title-abbr--champ title-abbr--silver",
};

/** BMAB-tier → CSS class for full-size hero ribbon (PlayerHero). */
export const TIER_RIBBON_CLASS = {
    gold:   "title-ribbon--gold",
    silver: "title-ribbon--silver",
    bronze: "title-ribbon--bronze",
    white:  "title-ribbon--white",
};

/** Championship-tier → CSS class for full-size championship ribbon. */
export const CHAMP_RIBBON_CLASS = {
    gold:   "title-ribbon--champ title-ribbon--gold",
    silver: "title-ribbon--champ title-ribbon--silver",
};

/** Highest-tier → optional name-glow class (used by PlayerCell). */
export const NAME_TIER_CLASS = {
    gold:   "player-name--gold",
    silver: "player-name--silver",
    bronze: "player-name--bronze",
    white:  "player-name--white",
};
