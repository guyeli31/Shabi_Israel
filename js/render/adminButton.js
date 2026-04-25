/**
 * adminButton.js — Floating admin gear button.
 * Logged in → navigates to admin.html.
 * Logged out → opens a login modal overlay.
 */

import { isLoggedIn, login } from '../admin/auth.js';

const GEAR_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>';

export function initAdminButton() {
    const wrapper = document.createElement('div');
    wrapper.className = 'admin-button';

    const tooltip = document.createElement('span');
    tooltip.className = 'floating-btn-tooltip';
    tooltip.textContent = 'Admin Mode';

    const btn = document.createElement('button');
    btn.className = 'admin-button-toggle';
    btn.setAttribute('aria-label', 'Admin Mode');
    btn.innerHTML = GEAR_SVG;
    btn.addEventListener('click', () => {
        if (isLoggedIn()) {
            location.href = 'admin.html';
        } else {
            openLoginModal();
        }
    });

    wrapper.appendChild(tooltip);
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);
}

function openLoginModal() {
    if (document.querySelector('.admin-login-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'admin-login-overlay';

    const modal = document.createElement('div');
    modal.className = 'admin-login-modal';
    modal.innerHTML = `
        <h2 class="admin-login-modal-title">Admin Login</h2>
        <div id="admin-modal-msg"></div>
        <div class="form-group">
            <label for="admin-modal-user">Username</label>
            <input type="text" id="admin-modal-user" autocomplete="username">
        </div>
        <div class="form-group">
            <label for="admin-modal-pass">Password</label>
            <input type="password" id="admin-modal-pass" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block" id="admin-modal-btn">Login</button>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Trigger enter animation
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const userInput = modal.querySelector('#admin-modal-user');
    const passInput = modal.querySelector('#admin-modal-pass');
    const loginBtn = modal.querySelector('#admin-modal-btn');

    userInput.focus();

    function closeModal() {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        document.removeEventListener('keydown', onEsc);
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    function onEsc(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEsc);

    async function doLogin() {
        const user = userInput.value.trim();
        const pass = passInput.value;
        if (!user || !pass) {
            showMsg('Please enter username and password.', 'error');
            return;
        }
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in…';
        const ok = await login(user, pass);
        if (ok) {
            location.href = 'admin.html';
        } else {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
            showMsg('Invalid username or password.', 'error');
        }
    }

    function showMsg(msg, type) {
        const el = modal.querySelector('#admin-modal-msg');
        if (el) el.innerHTML = `<div class="admin-msg admin-msg-${type}">${msg}</div>`;
    }

    loginBtn.addEventListener('click', doLogin);
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    userInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
