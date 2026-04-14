/**
 * titleConstants.js — Centralized title definitions, colors, and display helpers.
 *
 * Two title systems:
 *   1. BMAB titles (rank-based): Super Grandmaster → Intermediate
 *   2. Championship titles: World Champion / National Champion
 */

/* ── BMAB Title Definitions ─────────────────────────── */

export const BMAB_TITLES = [
    { code: 'S0', label: 'Super Grandmaster S0', group: 'Super Grandmaster', tier: 'gold' },
    { code: 'S1', label: 'Super Grandmaster S1', group: 'Super Grandmaster', tier: 'gold' },
    { code: 'S2', label: 'Super Grandmaster S2', group: 'Super Grandmaster', tier: 'gold' },
    { code: 'S3', label: 'Super Grandmaster S3', group: 'Super Grandmaster', tier: 'gold' },
    { code: 'G0', label: 'Grandmaster G0',       group: 'Grandmaster',       tier: 'gold' },
    { code: 'G1', label: 'Grandmaster G1',       group: 'Grandmaster',       tier: 'gold' },
    { code: 'G2', label: 'Grandmaster G2',       group: 'Grandmaster',       tier: 'gold' },
    { code: 'G3', label: 'Grandmaster G3',       group: 'Grandmaster',       tier: 'gold' },
    { code: 'M1', label: 'Master M1',            group: 'Master',            tier: 'silver' },
    { code: 'M2', label: 'Master M2',            group: 'Master',            tier: 'silver' },
    { code: 'M3', label: 'Master M3',            group: 'Master',            tier: 'silver' },
    { code: 'A1', label: 'Advanced A1',          group: 'Advanced',          tier: 'bronze' },
    { code: 'A2', label: 'Advanced A2',          group: 'Advanced',          tier: 'bronze' },
    { code: 'A3', label: 'Advanced A3',          group: 'Advanced',          tier: 'bronze' },
    { code: 'I1', label: 'Intermediate I1',      group: 'Intermediate',      tier: 'white' },
    { code: 'I2', label: 'Intermediate I2',      group: 'Intermediate',      tier: 'white' },
    { code: 'I3', label: 'Intermediate I3',      group: 'Intermediate',      tier: 'white' },
];

const _bmabByCode = Object.fromEntries(BMAB_TITLES.map(t => [t.code, t]));

/* ── Tier Colors ────────────────────────────────────── */

export const TIER_COLORS = {
    gold:   { bg: 'linear-gradient(135deg, #f59e0b, #fbbf24)', text: '#4a2700', border: '#b45309' },
    silver: { bg: 'linear-gradient(135deg, #94a3b8, #cbd5e1)', text: '#1e293b', border: '#64748b' },
    bronze: { bg: 'linear-gradient(135deg, #d97706, #f59e0b)', text: '#451a03', border: '#92400e' },
    white:  { bg: '#f8fafc',                                    text: '#475569', border: '#94a3b8' },
};

/* Tier priority for sorting (lower = higher priority) */
const TIER_PRIORITY = { gold: 0, silver: 1, bronze: 2, white: 3 };

/* ── BMAB Helpers ───────────────────────────────────── */

/**
 * Get BMAB info by code.
 * @returns {{ label, abbreviation, tier, colors }} or null
 */
export function getBmabInfo(code) {
    const entry = _bmabByCode[code];
    if (!entry) return null;
    return {
        label: entry.label,
        abbreviation: entry.code,
        tier: entry.tier,
        colors: TIER_COLORS[entry.tier],
    };
}

/* ── Championship Helpers ───────────────────────────── */

/**
 * Build a human-readable tooltip for a championship title object.
 * E.g. "2019 Israeli National Champion" or "2025 Monte Carlo Doubles World Champion"
 */
export function getChampionshipTooltip(title) {
    if (!title) return '';
    const parts = [];
    if (title.year) parts.push(String(title.year));
    if (title.type === 'world') {
        if (title.location) parts.push(title.location);
        if (title.doubles) parts.push('Doubles');
        parts.push('World Champion');
    } else {
        // national
        if (title.country) parts.push(title.country);
        if (title.doubles) parts.push('Doubles');
        parts.push('National Champion');
    }
    return parts.join(' ');
}

/**
 * Get championship display info.
 * @returns {{ abbreviation, tier, tooltip }}
 */
export function getChampionshipInfo(title) {
    const isWorld = title.type === 'world';
    return {
        abbreviation: isWorld ? 'WC' : 'NC',
        tier: isWorld ? 'gold' : 'silver',
        colors: TIER_COLORS[isWorld ? 'gold' : 'silver'],
        tooltip: getChampionshipTooltip(title),
    };
}

/* ── Combined HTML Generators ───────────────────────── */

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Generate full-size badge HTML for player card headers.
 * BMAB badge + championship badges, meant to appear to the RIGHT of the player name.
 */
export function getTitleBadgesHtml(meta) {
    if (!meta) return '';
    let html = '';

    // BMAB badge
    if (meta.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info) {
            html += `<span class="pg-bmab-badge pg-badge-${info.tier}" title="Official BMAB Title: ${esc(info.label)}">${esc(info.label)}</span>`;
        }
    }

    // Championship badges
    const titles = meta.championshipTitles || [];
    for (const t of titles) {
        const info = getChampionshipInfo(t);
        const fullLabel = t.type === 'world' ? 'World Champion' : 'National Champion';
        html += `<span class="pg-champ-badge pg-champ-${info.tier}" title="${esc(info.tooltip)}">${esc(fullLabel)}</span>`;
    }

    return html;
}

/**
 * Generate compact abbreviated badge HTML for table cells.
 * E.g. small "G0" badge, "WC" badge after player name.
 */
export function getTitleAbbreviationsHtml(meta) {
    if (!meta) return '';
    let html = '';

    // Championship abbreviations first (higher prestige)
    const titles = meta.championshipTitles || [];
    for (const t of titles) {
        const info = getChampionshipInfo(t);
        html += `<span class="title-abbr title-abbr-champ title-abbr-${info.tier}" title="${esc(info.tooltip)}">${esc(info.abbreviation)}</span>`;
    }

    // BMAB abbreviation
    if (meta.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info) {
            html += `<span class="title-abbr title-abbr-${info.tier}" title="${esc(info.label)}">${esc(info.abbreviation)}</span>`;
        }
    }

    return html;
}

/**
 * Returns the highest tier present in a player's titles (for styling the name).
 * @returns {string|null} 'gold'|'silver'|'bronze'|'white' or null
 */
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
        const tier = t.type === 'world' ? 'gold' : 'silver';
        if (TIER_PRIORITY[tier] < bestPri) {
            best = tier;
            bestPri = TIER_PRIORITY[tier];
        }
    }
    return best;
}

/** Check whether a player metadata object has any title. */
export function hasTitles(meta) {
    if (!meta) return false;
    return !!(meta.bmabTitle || (meta.championshipTitles && meta.championshipTitles.length > 0));
}

/**
 * Sort comparator for Notable Figures:
 * World Champions first → National Champions → BMAB by tier → alphabetical.
 */
export function compareTitlePriority(a, b) {
    // a, b are { name, meta } objects
    const aTitles = a.meta.championshipTitles || [];
    const bTitles = b.meta.championshipTitles || [];
    const aWorld = aTitles.some(t => t.type === 'world');
    const bWorld = bTitles.some(t => t.type === 'world');
    if (aWorld !== bWorld) return aWorld ? -1 : 1;

    const aNat = aTitles.some(t => t.type === 'national');
    const bNat = bTitles.some(t => t.type === 'national');
    if (aNat !== bNat) return aNat ? -1 : 1;

    // BMAB tier comparison
    const aTier = getHighestTier(a.meta);
    const bTier = getHighestTier(b.meta);
    const aPri = aTier ? (TIER_PRIORITY[aTier] ?? 99) : 99;
    const bPri = bTier ? (TIER_PRIORITY[bTier] ?? 99) : 99;
    if (aPri !== bPri) return aPri - bPri;

    return a.name.localeCompare(b.name);
}

/**
 * Build a full description string for all titles of a player (for Notable Figures list).
 * E.g. "2019 Israeli National Champion, Grandmaster G0"
 */
export function getFullTitleDescription(meta) {
    if (!meta) return '';
    const parts = [];

    // Championship titles first
    for (const t of (meta.championshipTitles || [])) {
        parts.push(getChampionshipTooltip(t));
    }

    // BMAB title
    if (meta.bmabTitle) {
        const info = getBmabInfo(meta.bmabTitle);
        if (info) parts.push(info.label);
    }

    return parts.join(', ');
}

/* ── BMAB Select Options HTML (for admin) ───────────── */

/**
 * Generate <option> and <optgroup> HTML for the BMAB dropdown in admin.
 * @param {string} selected — current code or ''
 */
export function bmabSelectOptionsHtml(selected = '') {
    let html = `<option value="">-- None --</option>`;
    let currentGroup = null;
    const tierLabels = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', white: 'White' };

    for (const t of BMAB_TITLES) {
        if (t.group !== currentGroup) {
            if (currentGroup !== null) html += '</optgroup>';
            html += `<optgroup label="${esc(t.group)} (${tierLabels[t.tier]})">`;
            currentGroup = t.group;
        }
        const sel = t.code === selected ? ' selected' : '';
        html += `<option value="${t.code}"${sel}>${esc(t.label)}</option>`;
    }
    if (currentGroup !== null) html += '</optgroup>';
    return html;
}

/* ── Country list for championship admin ────────────── */

export const COUNTRIES = [
    'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina',
    'Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados',
    'Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana',
    'Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon','Canada',
    'Cape Verde','Central African Republic','Chad','Chile','China','Colombia','Comoros',
    'Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti',
    'Dominica','Dominican Republic','East Timor','Ecuador','Egypt','El Salvador',
    'Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France',
    'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea',
    'Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia',
    'Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan',
    'Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon',
    'Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi',
    'Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico',
    'Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
    'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria',
    'North Korea','North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama',
    'Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania',
    'Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines',
    'Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia',
    'Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia',
    'South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname',
    'Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Togo','Tonga',
    'Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine',
    'United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu',
    'Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'
];
