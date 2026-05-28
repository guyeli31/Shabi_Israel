// data/titleConstants.js — pure data + helpers for player titles.
//
// Two parallel systems:
//   1. BMAB titles (rank-based): Super Grandmaster S0–S3, Grandmaster G0–G3,
//      Master M1–M3, Advanced A1–A3, Intermediate I1–I3.
//   2. Championship titles: world / national, with year + location/country
//      and optional doubles flag.
//
// In v1 this file also owned TIER_COLORS (an inline-style map) and emitted
// raw HTML for badges. v2 keeps the data + sort/comparison helpers here and
// pushes the *visual* concerns into Phase 3 components (PlayerCell title
// badges, PlayerHero chips/ribbons). The CSS class names those components
// expect live in `titleStyleMap.js`.

export const BMAB_TITLES = [
    { code: "S0", label: "Super Grandmaster S0", group: "Super Grandmaster", tier: "gold" },
    { code: "S1", label: "Super Grandmaster S1", group: "Super Grandmaster", tier: "gold" },
    { code: "S2", label: "Super Grandmaster S2", group: "Super Grandmaster", tier: "gold" },
    { code: "S3", label: "Super Grandmaster S3", group: "Super Grandmaster", tier: "gold" },
    { code: "G0", label: "Grandmaster G0",       group: "Grandmaster",       tier: "gold" },
    { code: "G1", label: "Grandmaster G1",       group: "Grandmaster",       tier: "gold" },
    { code: "G2", label: "Grandmaster G2",       group: "Grandmaster",       tier: "gold" },
    { code: "G3", label: "Grandmaster G3",       group: "Grandmaster",       tier: "gold" },
    { code: "M1", label: "Master M1",            group: "Master",            tier: "silver" },
    { code: "M2", label: "Master M2",            group: "Master",            tier: "silver" },
    { code: "M3", label: "Master M3",            group: "Master",            tier: "silver" },
    { code: "A1", label: "Advanced A1",          group: "Advanced",          tier: "bronze" },
    { code: "A2", label: "Advanced A2",          group: "Advanced",          tier: "bronze" },
    { code: "A3", label: "Advanced A3",          group: "Advanced",          tier: "bronze" },
    { code: "I1", label: "Intermediate I1",      group: "Intermediate",      tier: "white" },
    { code: "I2", label: "Intermediate I2",      group: "Intermediate",      tier: "white" },
    { code: "I3", label: "Intermediate I3",      group: "Intermediate",      tier: "white" },
];

const _bmabByCode = Object.fromEntries(BMAB_TITLES.map((t) => [t.code, t]));

const TIER_PRIORITY = { gold: 0, silver: 1, bronze: 2, white: 3 };

/** Look up a BMAB title by code. Returns null if unknown. */
export function getBmabInfo(code) {
    const entry = _bmabByCode[code];
    if (!entry) return null;
    return { label: entry.label, abbreviation: entry.code, tier: entry.tier };
}

/**
 * Build a human-readable tooltip for a championship title.
 * E.g. "2019 Israel National Champion", "2025 Monte Carlo Doubles World Champion".
 */
export function getChampionshipTooltip(title) {
    if (!title) return "";
    const parts = [];
    if (title.year) parts.push(String(title.year));
    if (title.type === "world") {
        if (title.location) parts.push(title.location);
        if (title.doubles) parts.push("Doubles");
        parts.push("World Champion");
    } else {
        if (title.country) parts.push(title.country);
        if (title.doubles) parts.push("Doubles");
        parts.push("National Champion");
    }
    return parts.join(" ");
}

/** Championship display info: abbreviation, tier, full tooltip. */
export function getChampionshipInfo(title) {
    const isWorld = title.type === "world";
    return {
        abbreviation: isWorld ? "WC" : "NC",
        tier: isWorld ? "gold" : "silver",
        tooltip: getChampionshipTooltip(title),
    };
}

/** Highest tier present across all of a player's titles, or null. */
export function getHighestTier(meta) {
    if (!meta) return null;
    let best = null;
    let bestPri = 99;
    if (meta.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info && TIER_PRIORITY[info.tier] < bestPri) {
            best = info.tier;
            bestPri = TIER_PRIORITY[info.tier];
        }
    }
    for (const t of (meta.championshipTitles || [])) {
        const tier = t.type === "world" ? "gold" : "silver";
        if (TIER_PRIORITY[tier] < bestPri) {
            best = tier;
            bestPri = TIER_PRIORITY[tier];
        }
    }
    return best;
}

export function hasTitles(meta) {
    if (!meta) return false;
    return Boolean(meta.bmabTitle || (meta.championshipTitles && meta.championshipTitles.length > 0));
}

/**
 * Notable-Figures sort order: World Champions → National Champions →
 * BMAB by tier → alphabetical. Operates on { name, meta } objects.
 */
export function compareTitlePriority(a, b) {
    const aTitles = a.meta.championshipTitles || [];
    const bTitles = b.meta.championshipTitles || [];
    const aWorld = aTitles.some((t) => t.type === "world");
    const bWorld = bTitles.some((t) => t.type === "world");
    if (aWorld !== bWorld) return aWorld ? -1 : 1;

    const aNat = aTitles.some((t) => t.type === "national");
    const bNat = bTitles.some((t) => t.type === "national");
    if (aNat !== bNat) return aNat ? -1 : 1;

    const aTier = getHighestTier(a.meta);
    const bTier = getHighestTier(b.meta);
    const aPri = aTier ? (TIER_PRIORITY[aTier] ?? 99) : 99;
    const bPri = bTier ? (TIER_PRIORITY[bTier] ?? 99) : 99;
    if (aPri !== bPri) return aPri - bPri;

    return a.name.localeCompare(b.name);
}

/** Comma-joined description of every title on a player, in display order. */
export function getFullTitleDescription(meta) {
    if (!meta) return "";
    const parts = [];
    for (const t of (meta.championshipTitles || [])) {
        parts.push(getChampionshipTooltip(t));
    }
    if (meta.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info) parts.push(info.label);
    }
    return parts.join(", ");
}

export const COUNTRIES = [
    "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina",
    "Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados",
    "Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana",
    "Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada",
    "Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros",
    "Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti",
    "Dominica","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador",
    "Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France",
    "Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea",
    "Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia",
    "Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan",
    "Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon",
    "Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi",
    "Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico",
    "Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
    "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria",
    "North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama",
    "Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania",
    "Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines",
    "Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia",
    "Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia",
    "South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname",
    "Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo","Tonga",
    "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine",
    "United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu",
    "Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
];
