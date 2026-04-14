/**
 * playerNameInteraction.js — Shared helpers for player name click behavior
 * in the dashboard and player-page header.
 *
 * Left click  → general player card (player_general.html)
 * Right click → context menu:
 *                 1. "Open league player card" (links to player.html)
 *                 2. "Open general player card" (player_general.html)
 */

import { playerUrl, playerGeneralUrl } from '../utils/helpers.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';

/**
 * Render an HTML <a> for a player name. Left click navigates to the
 * general (cross-league) player card; right click opens a context menu
 * for choosing the league-specific card instead.
 *
 * @param {string} playerName
 * @param {object|null} meta — player metadata from players_metadata.json (optional).
 *        When provided, abbreviated title badges are appended after the name.
 */
export function playerNameLink(playerName, meta = null) {
    const badgeHtml = meta ? getTitleAbbreviationsHtml(meta) : '';
    return `<a class="player-name-link"
              data-player="${escapeAttr(playerName)}"
              href="${playerGeneralUrl(playerName)}"
              title="Open general player card">${escapeHtml(playerName)}</a>${badgeHtml}`;
}

/**
 * Attach context menu handlers to all .player-name-link elements within
 * rootEl, scoped to a leagueId. Left click follows the anchor (general card).
 */
export function attachPlayerNameInteractions(rootEl, leagueId) {
    const links = rootEl.querySelectorAll('.player-name-link');
    links.forEach(a => {
        a.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const player = a.dataset.player;
            showContextMenu(e.clientX, e.clientY, leagueId, player);
        });
    });
}

let activeMenu = null;

function showContextMenu(x, y, leagueId, playerName) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'player-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <a class="cm-item"
           href="${playerUrl(leagueId, playerName)}"
           title="Open this player's card for this league">Open league player card</a>
        <a class="cm-item"
           href="${playerGeneralUrl(playerName)}"
           title="Open cross-league player profile">Open general player card</a>
    `;
    document.body.appendChild(menu);
    activeMenu = menu;

    setTimeout(() => {
        document.addEventListener('click', closeMenu, { once: true });
        document.addEventListener('contextmenu', closeMenu, { once: true });
    }, 0);
}

function closeMenu() {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
