/**
 * sanitize.js — escape text sourced from the DB before inserting via innerHTML.
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}
