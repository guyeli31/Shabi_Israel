/**
 * device.js — "this browser is this player".
 *
 * Players have no account. Identity is a random 128-bit token minted here and
 * kept in localStorage; the server stores only its sha256 and hands the player
 * back whenever the same token returns. So a refresh, a dropped connection, or
 * closing and reopening the tab all resume the same player with no action.
 *
 * What does NOT survive: private browsing, a cleared site-data, or opening the
 * link in a different browser (WhatsApp's in-app browser and Safari keep
 * separate storage). Those arrive as a stranger, and are linked back to their
 * name by the host — see gk_request_relink.
 */

const KEY = 'gevkalil:device';
let memoryToken = null;

function mint() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceToken() {
    try {
        let token = localStorage.getItem(KEY);
        if (!/^[0-9a-f]{32}$/.test(token || '')) {
            token = mint();
            localStorage.setItem(KEY, token);
        }
        return token;
    } catch {
        // Storage blocked: the token lives for this page only. The player can
        // still play; a refresh will need the host to link them back.
        return (memoryToken ??= mint());
    }
}
