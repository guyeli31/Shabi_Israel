/**
 * playerNameInteraction.js — Shared helpers for player name click behavior
 * in the dashboard and player-page header.
 *
 * Left click  → general player card (NOT YET BUILT — disabled with tooltip)
 * Right click → context menu:
 *                 1. "Open league player card" (links to player.html)
 *                 2. "Open general player card" (disabled)
 */

import { playerUrl } from '../utils/helpers.js';

const TOOLTIP_GENERAL = 'General player card — coming soon';

/**
 * Render an HTML <a> for a player name where left-click is disabled
 * (placeholder for general card) and a custom contextmenu is wired separately.
 *
 * Usage: insert returned HTML; then call attachContextMenus(rootEl, leagueId).
 */
export function playerNameLink(playerName) {
    return `<a class="player-name-link disabled-link"
              data-player="${escapeAttr(playerName)}"
              href="#"
              title="${TOOLTIP_GENERAL}">${escapeHtml(playerName)}</a>`;
}

/**
 * Attach context menu + disabled left-click handlers to all .player-name-link
 * elements within rootEl, scoped to a leagueId.
 */
export function attachPlayerNameInteractions(rootEl, leagueId) {
    const links = rootEl.querySelectorAll('.player-name-link');
    links.forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            // Left click currently inert (general card not built)
        });
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
        <a class="cm-item disabled"
           title="${TOOLTIP_GENERAL}">Open general player card</a>
    `;
    document.body.appendChild(menu);
    activeMenu = menu;

    menu.querySelector('.cm-item.disabled').addEventListener('click', e => e.preventDefault());

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
