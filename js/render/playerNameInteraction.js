/**
 * playerNameInteraction.js — Shared helpers for player name click behavior
 * in the dashboard and player-page header.
 *
 * Left click / tap → league-specific player card (player.html) when a leagueId
 *                    is in scope; otherwise the general card (player_general.html).
 * Right click / long-press → context menu with the general card as the
 *                    alternate option (and the league card, when leagueId exists).
 */

import { playerUrl, playerGeneralUrl } from '../utils/helpers.js';
import { getTitleAbbreviationsHtml } from '../data/titleConstants.js';

/**
 * Render an HTML <a> for a player name. The anchor is emitted with the
 * general-card URL as a safe default; `attachPlayerNameInteractions()` will
 * rewrite the href to the league-specific URL when a leagueId is in scope.
 *
 * @param {string} playerName
 * @param {object|null} meta — player metadata from players_metadata.json (optional).
 *        When provided, abbreviated title badges are appended after the name.
 */
export function playerNameLink(playerName, meta = null) {
    if (meta && meta.hidden) {
        return `<i class="player-hidden">N/A</i>`;
    }
    const badgeHtml = meta ? getTitleAbbreviationsHtml(meta) : '';
    return `<a class="player-name-link"
              data-player="${escapeAttr(playerName)}"
              href="${playerGeneralUrl(playerName)}"
              title="Open general player card">${escapeHtml(playerName)}</a>${badgeHtml}`;
}

/**
 * Attach click / context-menu handlers to all .player-name-link elements
 * within rootEl. When `leagueId` is provided, rewrite each link's href to
 * the league-specific card so left-click / tap lands there; right-click
 * exposes the general card as an alternate.
 */
export function attachPlayerNameInteractions(rootEl, leagueId) {
    const links = rootEl.querySelectorAll('.player-name-link');
    links.forEach(a => {
        if (leagueId) {
            const player = a.dataset.player;
            a.setAttribute('href', playerUrl(leagueId, player));
            a.setAttribute('title', 'Open league player card');
        }
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
    const generalItem = `
        <a class="cm-item"
           href="${playerGeneralUrl(playerName)}"
           title="Open cross-league player profile">Open general card</a>`;
    const leagueItem = leagueId ? `
        <a class="cm-item"
           href="${playerUrl(leagueId, playerName)}"
           title="Open this player's card for this league">Open league player card</a>` : '';
    menu.innerHTML = generalItem + leagueItem;
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
