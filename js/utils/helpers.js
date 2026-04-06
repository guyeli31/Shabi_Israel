/**
 * helpers.js — Shared utilities for URL params, formatting, and flag paths.
 */

export function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

export function formatPercent(value) {
    return (value * 100).toFixed(2) + '%';
}

export function formatNumber(value, decimals = 2) {
    return Number(value).toFixed(decimals);
}

export function flagUrl(countryCode) {
    return `assets/flags/${countryCode}.png`;
}

export function leagueUrl(leagueId) {
    return `league.html?league=${encodeURIComponent(leagueId)}`;
}

export function playerUrl(leagueId, playerName) {
    return `player.html?league=${encodeURIComponent(leagueId)}&player=${encodeURIComponent(playerName)}`;
}

export function getFlagCode(playerName, customFlags) {
    if (customFlags && customFlags[playerName]) {
        return customFlags[playerName];
    }
    return 'IL';
}
