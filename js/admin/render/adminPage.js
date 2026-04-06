/**
 * adminPage.js — Render the admin panel shell: login, sidebar, settings, pending changes.
 */

import { isLoggedIn, login, logout, getToken, setToken, getRepo, setRepo, isGitHubConfigured } from '../auth.js';
import { testConnection } from '../githubApi.js';
import { getChanges, removeChange, getChangeCount, publishAll, clearChanges } from '../stagingStore.js';

let currentView = 'leagues';
let onNavigate = null; // callback set by admin.html to handle view switching

/**
 * Initialize the admin page. Called once on load.
 * @param {function} viewCallback — called with (viewName) when nav changes
 */
export function initAdminPage(viewCallback) {
    onNavigate = viewCallback;

    if (!isLoggedIn()) {
        renderLoginForm();
    } else {
        renderAdminShell();
        navigateTo('leagues');
    }
}

/**
 * Navigate to a view.
 */
export function navigateTo(view) {
    currentView = view;

    // Update active nav item
    document.querySelectorAll('.admin-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    const main = document.getElementById('admin-content');
    if (!main) return;

    if (view === 'settings') {
        renderSettings(main);
    } else if (view === 'pending') {
        renderPendingChanges(main);
    } else if (onNavigate) {
        onNavigate(view, main);
    }
}

/**
 * Refresh the staging badge count.
 */
export function refreshBadge() {
    const badge = document.getElementById('staging-badge');
    if (!badge) return;
    const count = getChangeCount();
    badge.textContent = count;
    badge.classList.toggle('empty', count === 0);
}

// ---- Login ----

function renderLoginForm() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="admin-login-wrapper">
            <div class="admin-login-box">
                <h1>Admin Login</h1>
                <div id="login-msg"></div>
                <div class="form-group">
                    <label for="login-user">Username</label>
                    <input type="text" id="login-user" autocomplete="username">
                </div>
                <div class="form-group">
                    <label for="login-pass">Password</label>
                    <input type="password" id="login-pass" autocomplete="current-password">
                </div>
                <button class="btn btn-primary btn-block" id="login-btn">Login</button>
            </div>
        </div>`;

    const btn = document.getElementById('login-btn');
    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');

    async function doLogin() {
        const user = userInput.value.trim();
        const pass = passInput.value;
        if (!user || !pass) {
            showMsg('login-msg', 'Please enter username and password.', 'error');
            return;
        }
        btn.disabled = true;
        const ok = await login(user, pass);
        btn.disabled = false;
        if (ok) {
            renderAdminShell();
            navigateTo('leagues');
        } else {
            showMsg('login-msg', 'Invalid username or password.', 'error');
        }
    }

    btn.addEventListener('click', doLogin);
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    userInput.focus();
}

// ---- Admin Shell ----

function renderAdminShell() {
    const app = document.getElementById('app');
    const count = getChangeCount();

    app.innerHTML = `
        <div class="admin-layout">
            <aside class="admin-sidebar">
                <h2>Shabi Admin</h2>
                <nav>
                    <button class="admin-nav-item" data-view="leagues">Leagues</button>
                    <button class="admin-nav-item" data-view="pending">
                        Pending Changes <span id="staging-badge" class="staging-badge ${count === 0 ? 'empty' : ''}">${count}</span>
                    </button>
                    <button class="admin-nav-item" data-view="settings">Settings</button>
                </nav>
                <div class="admin-sidebar-footer">
                    <button class="admin-nav-item" id="logout-btn">Logout</button>
                </div>
            </aside>
            <main class="admin-main" id="admin-content">
                <div class="loading">Loading...</div>
            </main>
        </div>`;

    // Nav clicks
    document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        logout();
        renderLoginForm();
    });
}

// ---- Settings ----

function renderSettings(container) {
    const repo = getRepo();
    const repoStr = repo ? `${repo.owner}/${repo.repo}` : '';
    const token = getToken();
    const masked = token ? token.slice(0, 8) + '...' + token.slice(-4) : '';

    container.innerHTML = `
        <h1>Settings</h1>

        <div class="admin-card">
            <h2>GitHub Repository</h2>
            <div id="settings-msg"></div>
            <div class="form-group">
                <label for="settings-repo">Repository (owner/repo)</label>
                <input type="text" id="settings-repo" value="${repoStr}" placeholder="owner/repo">
            </div>
            <div class="form-group">
                <label for="settings-token">Personal Access Token</label>
                <input type="password" id="settings-token" value="${token}" placeholder="ghp_...">
                ${masked ? `<small style="color:var(--color-text-muted)">Current: ${masked}</small>` : ''}
            </div>
            <button class="btn btn-primary" id="settings-save">Save</button>
            <button class="btn btn-secondary" id="settings-test" style="margin-left:var(--space-sm)">Test Connection</button>
        </div>

        <div class="admin-card">
            <h2>Session</h2>
            <p style="color:var(--color-text-secondary);font-size:0.9rem">
                Logged in as <b>admin</b>.
                Token and repo settings persist across sessions in localStorage.
            </p>
        </div>`;

    document.getElementById('settings-save').addEventListener('click', () => {
        const repoVal = document.getElementById('settings-repo').value.trim();
        const tokenVal = document.getElementById('settings-token').value.trim();

        if (repoVal && !repoVal.includes('/')) {
            showMsg('settings-msg', 'Repo must be in "owner/repo" format.', 'error');
            return;
        }

        if (repoVal) setRepo(repoVal);
        if (tokenVal) setToken(tokenVal);
        showMsg('settings-msg', 'Settings saved.', 'success');
    });

    document.getElementById('settings-test').addEventListener('click', async () => {
        if (!isGitHubConfigured()) {
            showMsg('settings-msg', 'Please save repo and token first.', 'error');
            return;
        }
        const btn = document.getElementById('settings-test');
        btn.disabled = true;
        btn.textContent = 'Testing...';
        try {
            const ok = await testConnection();
            showMsg('settings-msg', ok ? 'Connection successful!' : 'Connection failed — check credentials.', ok ? 'success' : 'error');
        } catch (err) {
            showMsg('settings-msg', `Error: ${err.message}`, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Test Connection';
    });
}

// ---- Pending Changes ----

function renderPendingChanges(container) {
    const changes = getChanges();

    if (changes.length === 0) {
        container.innerHTML = `
            <h1>Pending Changes</h1>
            <div class="admin-card">
                <p style="color:var(--color-text-muted);text-align:center;padding:var(--space-lg)">
                    No pending changes. Make changes in the Leagues section and they'll appear here.
                </p>
            </div>`;
        return;
    }

    let listHtml = '';
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const time = new Date(c.timestamp).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        listHtml += `
            <li class="pending-item">
                <span class="pending-item-desc">${escHtml(c.description)}</span>
                <span class="pending-item-time">${time}</span>
                <button class="btn btn-danger btn-sm" data-remove="${i}">Cancel</button>
            </li>`;
    }

    container.innerHTML = `
        <h1>Pending Changes</h1>
        <div class="pending-panel">
            <h3>${changes.length} change${changes.length === 1 ? '' : 's'} waiting to be published</h3>
            <ul class="pending-list">${listHtml}</ul>
            <div id="publish-msg"></div>
            <div id="publish-progress"></div>
            <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-success" id="publish-btn">Publish to Site</button>
                <button class="btn btn-danger" id="discard-all-btn">Discard All</button>
            </div>
        </div>`;

    // Cancel individual change
    container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
            removeChange(parseInt(btn.dataset.remove));
            refreshBadge();
            renderPendingChanges(container);
        });
    });

    // Discard all
    document.getElementById('discard-all-btn').addEventListener('click', () => {
        if (confirm('Discard all pending changes?')) {
            clearChanges();
            refreshBadge();
            renderPendingChanges(container);
        }
    });

    // Publish
    document.getElementById('publish-btn').addEventListener('click', async () => {
        if (!isGitHubConfigured()) {
            showMsg('publish-msg', 'GitHub not configured. Go to Settings first.', 'error');
            return;
        }

        const pubBtn = document.getElementById('publish-btn');
        pubBtn.disabled = true;
        pubBtn.textContent = 'Publishing...';

        const progressEl = document.getElementById('publish-progress');
        progressEl.innerHTML = `
            <div class="publish-progress">
                <div class="publish-progress-bar"><div class="publish-progress-fill" id="progress-fill" style="width:0%"></div></div>
                <div class="publish-progress-text" id="progress-text">Starting...</div>
            </div>`;

        const result = await publishAll((index, total, desc) => {
            const pct = ((index + 1) / total * 100).toFixed(0);
            const fill = document.getElementById('progress-fill');
            const text = document.getElementById('progress-text');
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = `${index + 1}/${total}: ${desc}`;
        });

        if (result.success) {
            showMsg('publish-msg', `Published ${result.published} change${result.published === 1 ? '' : 's'} successfully!`, 'success');
        } else {
            const errList = result.errors.map(e => `<li>${escHtml(e)}</li>`).join('');
            showMsg('publish-msg', `Published ${result.published} changes with ${result.errors.length} error(s):<ul>${errList}</ul>`, 'error');
        }

        refreshBadge();

        // Re-render after short delay
        setTimeout(() => renderPendingChanges(container), 1500);
    });
}

// ---- Helpers ----

function showMsg(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="admin-msg admin-msg-${type}">${message}</div>`;
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
