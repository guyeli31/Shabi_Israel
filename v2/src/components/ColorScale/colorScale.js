// components/ColorScale/colorScale.js — theme-aware red→amber→green
// colour gradient for data-emphasis cells (PR / Luck / WinRate /
// Remaining). Direct port of v1 js/compute/colorScale.js with the
// theme-name set updated to match v2's theme catalogue.

const DARK_THEMES = new Set(["dark", "vegas", "casino", "x22"]);

function isDarkTheme() {
    if (typeof document === "undefined") return false;
    const t = document.documentElement.getAttribute("data-theme");
    return DARK_THEMES.has(t);
}

const LIGHT_ANCHORS = {
    red:   [185, 28, 28],
    amber: [146, 86, 0],
    green: [21, 112, 58],
};

const DARK_ANCHORS = {
    red:   [255, 128, 128],
    amber: [255, 184, 74],
    green: [93, 216, 128],
};

function interpolate(ratio) {
    const t = Math.max(0, Math.min(1, ratio));
    const a = isDarkTheme() ? DARK_ANCHORS : LIGHT_ANCHORS;
    const lerp = (x, y, p) => Math.round(x + (y - x) * p);
    let r, g, b;
    if (t < 0.5) {
        const p = t * 2;
        r = lerp(a.red[0], a.amber[0], p);
        g = lerp(a.red[1], a.amber[1], p);
        b = lerp(a.red[2], a.amber[2], p);
    } else {
        const p = (t - 0.5) * 2;
        r = lerp(a.amber[0], a.green[0], p);
        g = lerp(a.amber[1], a.green[1], p);
        b = lerp(a.amber[2], a.green[2], p);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

export function colorForValue(value, min, max) {
    if (min === max) return interpolate(0.5);
    return interpolate((value - min) / (max - min));
}

export function colorForValueInverted(value, min, max) {
    if (min === max) return interpolate(0.5);
    return interpolate(1 - (value - min) / (max - min));
}

export function colorForGames(value) {
    return colorForValue(value, 0, 25);
}

const LEVEL_COLORS_LIGHT = {
    "World Champ":   "#047857",
    "World Class":   "#2E7D32",
    "Expert":        "#4a7a28",
    "Advanced":      "#6b6d00",
    "Intermediate":  "#a85a00",
    "Casual Player": "#c24500",
    "Beginner":      "#a33000",
    "Distracted":    "#8b1212",
};

const LEVEL_COLORS_DARK = {
    "World Champ":   "#5dd880",
    "World Class":   "#6fd8a0",
    "Expert":        "#a8d860",
    "Advanced":      "#d8d860",
    "Intermediate":  "#ffb84a",
    "Casual Player": "#ff9450",
    "Beginner":      "#ff7a6a",
    "Distracted":    "#ff6b6b",
};

export function colorForLevel(level) {
    const table = isDarkTheme() ? LEVEL_COLORS_DARK : LEVEL_COLORS_LIGHT;
    return table[level] || (isDarkTheme() ? "#b0b0b0" : "#555");
}
