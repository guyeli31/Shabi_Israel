/**
 * colorScale.js — Dynamic color gradient calculations for data visualization.
 * Generates CSS color strings based on value position within a min/max range.
 */

/**
 * Interpolate between red and green based on a normalized ratio (0 = red, 1 = green).
 * Returns a CSS rgb() string.
 */
function interpolateRedGreen(ratio) {
    // Clamp
    const t = Math.max(0, Math.min(1, ratio));
    // Red (255,0,0) → Yellow (255,255,0) → Green (0,200,0)
    let r, g, b = 0;
    if (t < 0.5) {
        const p = t * 2; // 0→1 for first half
        r = 220;
        g = Math.round(140 * p);
    } else {
        const p = (t - 0.5) * 2; // 0→1 for second half
        r = Math.round(220 * (1 - p));
        g = Math.round(140 + 60 * p);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get color for a value within a range.
 * Higher value = greener (good).
 */
export function colorForValue(value, min, max) {
    if (min === max) return interpolateRedGreen(0.5);
    const ratio = (value - min) / (max - min);
    return interpolateRedGreen(ratio);
}

/**
 * Get color for a value where LOWER is better (e.g., PR, Losses).
 * Lower value = greener.
 */
export function colorForValueInverted(value, min, max) {
    if (min === max) return interpolateRedGreen(0.5);
    const ratio = 1 - (value - min) / (max - min);
    return interpolateRedGreen(ratio);
}

/**
 * Color for Games column: fixed scale 0–25.
 */
export function colorForGames(value) {
    return colorForValue(value, 0, 25);
}

/**
 * Level color mapping (discrete).
 */
const LEVEL_COLORS = {
    'World Champ':   '#00C853',
    'World Class':   '#2E7D32',
    'Expert':        '#558B2F',
    'Advanced':      '#9E9D24',
    'Intermediate':  '#F57F17',
    'Casual Player': '#E65100',
    'Beginner':      '#BF360C',
    'Distracted':    '#B71C1C'
};

export function colorForLevel(level) {
    return LEVEL_COLORS[level] || '#666';
}
