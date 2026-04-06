/**
 * auth.js — Admin authentication (login/logout, session, token management).
 *
 * Security layers:
 *  1. Username + password hash (cosmetic — deters casual users)
 *  2. GitHub PAT in localStorage (real protection — required for writes)
 *  3. GitHub repo permissions (absolute — only collaborators can generate valid tokens)
 */

// SHA-256 hash of "admin123"
const ADMIN_USER = 'admin';
const ADMIN_PASS_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

const KEYS = {
    session: 'shabi-admin-session',
    token: 'shabi-github-token',
    repo: 'shabi-github-repo'
};

/**
 * Compute SHA-256 hex digest of a string (uses Web Crypto API).
 */
async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Attempt login. Returns true on success.
 */
export async function login(username, password) {
    if (username !== ADMIN_USER) return false;
    const hash = await sha256(password);
    if (hash !== ADMIN_PASS_HASH) return false;
    localStorage.setItem(KEYS.session, 'true');
    return true;
}

/**
 * Log out — clears session (keeps token and repo for convenience).
 */
export function logout() {
    localStorage.removeItem(KEYS.session);
}

/**
 * Check if admin is currently logged in.
 */
export function isLoggedIn() {
    return localStorage.getItem(KEYS.session) === 'true';
}

/**
 * Get the stored GitHub Personal Access Token.
 */
export function getToken() {
    return localStorage.getItem(KEYS.token) || '';
}

/**
 * Save GitHub PAT.
 */
export function setToken(token) {
    localStorage.setItem(KEYS.token, token.trim());
}

/**
 * Get the stored GitHub repo as { owner, repo }.
 * Stored as "owner/repo" string.
 */
export function getRepo() {
    const raw = localStorage.getItem(KEYS.repo) || '';
    const parts = raw.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
        return { owner: parts[0], repo: parts[1] };
    }
    return null;
}

/**
 * Save GitHub repo (expects "owner/repo" string).
 */
export function setRepo(repoString) {
    localStorage.setItem(KEYS.repo, repoString.trim());
}

/**
 * Check if GitHub config is complete (token + repo).
 */
export function isGitHubConfigured() {
    return !!getToken() && !!getRepo();
}
