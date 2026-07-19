/**
 * changeVocabulary.js — SINGLE SOURCE OF TRUTH for how a change is described,
 * shared by BOTH the Pending Changes list (adminPage.js) and the Historical
 * Changes view (historicalChanges.js). Neither view formats a label itself;
 * both funnel through renderChangeLabel() so the two can never drift.
 *
 * Every change is described in three parts, in this fixed order:
 *   {primary topic icon} {Topic}  ·  {subject}  ·  {secondary icon} {specific}{ — detail}
 *
 *   • TOPIC  — the general area the change belongs to (League / Player / Settings),
 *              carried by a PRIMARY icon. League reuses the site's own league glyph
 *              (the table/grid SVG from tabIcons.js), NOT a trophy emoji.
 *   • SUBJECT — WHICH league / player / setting (bold).
 *   • SPECIFIC — WHAT changed, carried by a SECONDARY icon + short text.
 *
 * Pending maps its 15 staging `category` strings through CATEGORY_TAXONOMY.
 * Historical maps DB (table_name, action, diff) to the SAME {topic, icon, text}
 * shape and calls renderChangeLabel directly.
 */

import { TAB_ICONS } from '../../render/tabIcons.js';

/**
 * Primary topic icons + labels. League reuses TAB_ICONS.leagues (inline SVG,
 * theme-aware via currentColor). Player/Settings are emoji.
 */
export const TOPIC_META = {
    league:   { icon: TAB_ICONS.leagues, label: 'League' },
    player:   { icon: '👤', label: 'Player' },
    settings: { icon: '⚙️', label: 'Settings' },
};

/**
 * Staging category → { topic, icon (secondary), text (specific) }.
 * The single place a pending change's topic + specific icon/text is decided.
 */
export const CATEGORY_TAXONOMY = {
    'create-league':   { topic: 'league',   icon: '🆕', text: 'Created' },
    'delete-league':   { topic: 'league',   icon: '🗑️', text: 'Deleted' },
    'league-settings': { topic: 'league',   icon: '⚙️', text: 'Settings updated' },
    'league-players':  { topic: 'league',   icon: '🚩', text: 'Players updated' },
    'league-data':     { topic: 'league',   icon: '📊', text: 'Match data updated' },
    'match-override':  { topic: 'league',   icon: '⚖️', text: 'Override added' },
    'edit-override':   { topic: 'league',   icon: '✏️', text: 'Override edited' },
    'remove-override': { topic: 'league',   icon: '➖', text: 'Override removed' },
    'create-player':   { topic: 'player',   icon: '🆕', text: 'Created' },
    'player-meta':     { topic: 'player',   icon: '📝', text: 'Details updated' },
    'player-photo':    { topic: 'player',   icon: '📷', text: 'Photo updated' },
    'player-rename':   { topic: 'player',   icon: '🏷️', text: 'Renamed across leagues' },
    'flag-upload':     { topic: 'settings', icon: '🏳️', text: 'Flag uploaded' },
    'bgsync':          { topic: 'settings', icon: '🔄', text: 'Auto-sync updated' },
    'landing':         { topic: 'settings', icon: '🏠', text: 'Landing updated' },
};

/**
 * Intent rank per category — mirrors public.audit_row_intent()'s `rank` in
 * sql/audit_batching.sql. When one Publish bundles several staged changes, the
 * highest-rank one headlines the batch (same rule the retroactive backfill uses).
 */
export const CATEGORY_RANK = {
    'create-league': 100, 'delete-league': 100,
    'league-settings': 80, 'league-players': 80,
    'create-player': 80, 'player-meta': 80, 'player-photo': 80, 'player-rename': 80,
    'match-override': 75, 'edit-override': 75, 'remove-override': 75,
    'league-data': 70, 'bgsync': 60, 'landing': 50, 'flag-upload': 50,
};

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

/**
 * Canonical label HTML. The ONLY function that decides the on-screen wording.
 *   {topicIcon} {Topic} · <b>{subject}</b> · {specificIcon} {text}{ — detail}
 * Subject and detail are optional; the topic + specific text always show.
 *
 * @param {object} p
 * @param {string} p.topic   — key into TOPIC_META ('league'|'player'|'settings')
 * @param {string} [p.subject] — which league/player/setting (bolded)
 * @param {string} [p.icon]  — secondary (specific-change) icon
 * @param {string} p.text    — specific-change wording
 * @param {string} [p.detail] — trailing free-text detail (e.g. "A vs B (result)")
 */
export function renderChangeLabel({ topic, subject, icon, text, detail }) {
    const t = TOPIC_META[topic] || { icon: '📄', label: topic || 'Change' };
    let s = `<span class="change-topic-icon" aria-hidden="true">${t.icon}</span>&nbsp;${esc(t.label)}`;
    if (subject) s += ` · <b>${esc(subject)}</b>`;
    s += ` · `;
    if (icon) s += `<span aria-hidden="true">${icon}</span> `;
    s += esc(text || '');
    if (detail) s += ` — ${esc(detail)}`;
    return s;
}

/**
 * Bridge for the Pending list: map a staging `category` to the shared label.
 * Returns null for an unknown category so callers keep their legacy fallback.
 * `actionOverride` (a change's explicit `action`) wins over the taxonomy default.
 */
export function renderCategoryLabel(category, subject, detail, actionOverride) {
    const c = CATEGORY_TAXONOMY[category];
    if (!c) return null;
    return renderChangeLabel({
        topic: c.topic,
        subject,
        icon: c.icon,
        text: actionOverride || c.text,
        detail,
    });
}
