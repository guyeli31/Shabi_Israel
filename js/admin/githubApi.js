/**
 * githubApi.js — Wrapper for GitHub REST API (Contents API).
 * Handles reading, creating, updating, and deleting files in a GitHub repo.
 */

import { getToken, getRepo } from './auth.js';

const API_BASE = 'https://api.github.com';
const BRANCH = 'main';

/**
 * Build authorization headers.
 */
function authHeaders() {
    const token = getToken();
    return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };
}

/**
 * Build the API URL for a file path.
 */
function contentsUrl(path) {
    const { owner, repo } = getRepo();
    return `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
}

/**
 * Get a file's content and metadata from the repo.
 * Returns { content (decoded string), sha, path } or null if not found.
 */
export async function getFile(path) {
    const url = `${contentsUrl(path)}?ref=${BRANCH}`;
    const resp = await fetch(url, { headers: authHeaders() });

    if (resp.status === 404) return null;
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`GitHub API error ${resp.status}: ${err.message || resp.statusText}`);
    }

    const data = await resp.json();

    // If it's a directory, return the listing
    if (Array.isArray(data)) {
        return { type: 'dir', entries: data, path };
    }

    const content = decodeBase64(data.content);
    return { type: 'file', content, sha: data.sha, path: data.path };
}

/**
 * Create or update a file in the repo.
 * @param {string} path — file path in repo
 * @param {string} content — file content (string)
 * @param {string|null} sha — current SHA (for updates). null = create new file.
 * @param {string} message — commit message
 */
export async function putFile(path, content, sha, message) {
    const body = {
        message,
        content: encodeBase64(content),
        branch: BRANCH
    };
    if (sha) body.sha = sha;

    const resp = await fetch(contentsUrl(path), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`GitHub PUT error ${resp.status}: ${err.message || resp.statusText}`);
    }

    return resp.json();
}

/**
 * Upload a binary file (e.g., PNG) to the repo.
 * @param {string} path — file path in repo
 * @param {ArrayBuffer|Uint8Array} binaryData — raw binary content
 * @param {string|null} sha — current SHA (for updates)
 * @param {string} message — commit message
 */
export async function putBinaryFile(path, binaryData, sha, message) {
    const bytes = new Uint8Array(binaryData);
    const base64 = btoa(String.fromCharCode(...bytes));

    const body = {
        message,
        content: base64,
        branch: BRANCH
    };
    if (sha) body.sha = sha;

    const resp = await fetch(contentsUrl(path), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`GitHub PUT binary error ${resp.status}: ${err.message || resp.statusText}`);
    }

    return resp.json();
}

/**
 * Delete a file from the repo.
 * @param {string} path — file path
 * @param {string} sha — current SHA (required)
 * @param {string} message — commit message
 */
export async function deleteFile(path, sha, message) {
    const body = {
        message,
        sha,
        branch: BRANCH
    };

    const resp = await fetch(contentsUrl(path), {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`GitHub DELETE error ${resp.status}: ${err.message || resp.statusText}`);
    }

    return resp.json();
}

/**
 * Test the connection — tries to read the repo root.
 * Returns true if successful.
 */
export async function testConnection() {
    const { owner, repo } = getRepo();
    const url = `${API_BASE}/repos/${owner}/${repo}`;
    const resp = await fetch(url, { headers: authHeaders() });
    return resp.ok;
}

// ---- Base64 helpers (handle Unicode) ----

function encodeBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
}

function decodeBase64(base64) {
    const cleaned = base64.replace(/\n/g, '');
    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
