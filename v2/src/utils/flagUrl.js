// utils/flagUrl.js — resolve a flag image URL and per-league custom flag.
//
// Flags live in the shared `../assets/flags/{CODE}.png` directory; the
// Vite shared-assets-proxy mounts them at `/assets/flags/`. v1's path
// (`assets/flags/...`) also works as a relative URL when serving from
// repo root, so post-cutover this remains valid.

export function flagUrl(countryCode) {
    return `/assets/flags/${countryCode}.png`;
}

/**
 * Pick a country code for a player. `customFlags` is the per-league
 * { playerName: "US" } override map; defaults to "IL".
 */
export function getFlagCode(playerName, customFlags) {
    if (customFlags && customFlags[playerName]) return customFlags[playerName];
    return "IL";
}
