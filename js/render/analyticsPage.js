/**
 * analyticsPage.js — Reads the analytics_summary() RPC and renders it.
 * Not a public nav destination — reached only by direct URL (analytics.html),
 * and the RPC itself is authenticated-only (SECURITY DEFINER, execute granted
 * to `authenticated`, anon explicitly revoked).
 *
 * What this page may and may not show is set by the two-route privacy model in
 * sql/analytics_poc.sql and js/analytics.js. No IP is ever read, sent or stored;
 * visitors are differentiated by their browser's own timezone alone:
 *   • Israel route (timezone 'Asia/Jerusalem') — carries a per-visit session_id
 *     held in sessionStorage and wiped when the tab closes. These events CAN be
 *     grouped, and the "Sessions from Israel" section does exactly that: one
 *     card per visit, expanding into that visit's own chronological trace.
 *     There is no cross-visit linkage and no returning-visitor identity to
 *     build one from — a session is one tab, once.
 *   • Everyone else — zero-correlation: no id, nothing written to their device,
 *     every event standing alone. They can NEVER be grouped into a session, and
 *     appear only as individual rows in the all-clicks log, marked "External"
 *     with at most a coarse continent. Don't add per-row identity to them.
 *
 * admin_user is the site operator's OWN username and never a visitor identity.
 * It drives the session-id chip — one shared operator red (with the admin's name
 * spelled out in the label) against one shared neutral for every ordinary
 * visitor — so the operator's own browsing is visually separable from real
 * audience traffic.
 *
 * Sections/tables follow the same conventions as the production pages
 * (`.app-section`/wireSectionCollapse from css/sections.css, MF table format
 * from table-lab/formats/mf/mf.css) instead of the generic admin look.
 */

import { supabase } from '../data/supabaseClient.js';
import { isLoggedIn, login } from '../admin/auth.js';
import { escapeHtml } from '../utils/sanitize.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';
import { mountSearchField } from '../utils/combobox.js';
import { installSearchOverlay } from './searchOverlay.js';
import { typePillHtml } from '../presets/playerLeaguesPreset.js';
import { primeTitleMeta, titleHtmlFor } from '../utils/playerTitleBadge.js';
import { getPlayerFlagCode, ensurePlayerIndex } from './navigation.js';
import { searchFlagHtml } from '../utils/helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DWELL_BUCKET_ORDER = ['<10s', '10-30', '30-60', '1-5m', '5m+'];
const PAGE_LABELS = {
    landing: 'Home',
    league: 'League Dashboard',
    league_table: 'League Table',
    player: 'Player',
    player_league: 'Player History',
    admin: 'Admin',
};
const pageLabel = (p) => PAGE_LABELS[p] || p;
// A league is shown by its id + TYPE, e.g. "July 2026 · Doubling". The id is now
// the league's full, unique name everywhere (display + primary key + ?league=
// URL) — the cosmetic `title` column was retired — so the id alone is
// unambiguous; the type pill is kept only to tell same-month leagues apart (e.g.
// "July 2026" vs "July 2026 Regular"). `_leagueMeta` (id → {type}) is loaded once
// per page from the leagues table; an id missing from it (a legacy league) falls
// back to the raw id so nothing renders blank.
let _leagueMeta = new Map();
let _leagueMetaLoaded = false;
const LEAGUE_TYPE_LABELS = { doubling: 'Doubling', regular: 'Regular', ubc: 'UBC' };
const typeLabel = (t) => LEAGUE_TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
const leagueDisplay = (leagueId) => {
    const m = _leagueMeta.get(leagueId);
    return m ? `${leagueId} · ${typeLabel(m.type)}` : leagueId;
};
const contextLabel = (page, leagueId, player) => {
    if (page === 'player_league' && player) {
        return `Player in league (${player}${leagueId ? ', ' + leagueDisplay(leagueId) : ''})`;
    }
    const base = pageLabel(page);
    if (player) return `${base} (${player})`;
    if (leagueId) return `${base} (${leagueDisplay(leagueId)})`;
    return base;
};

// Rich (HTML) counterparts of the two entities the text labels above name, so a
// log cell shows a player/league exactly as the rest of the site does: a player
// gets their flag before the name and their title badges (BMAB rank + WC/NC …)
// after it (shared searchFlagHtml + titleHtmlFor + getPlayerFlagCode — the same
// primitives every player picker uses), and a league shows its title followed by
// the real league-type PILL (typePillHtml) instead of the word "Doubling". The
// text contextLabel() is kept for the sort key; these feed the column `render`.
function playerHtml(name) {
    if (!name) return '';
    return `<span class="ana-entity">${searchFlagHtml(getPlayerFlagCode(name))}${escapeHtml(name)}${titleHtmlFor(name)}</span>`;
}
function leagueHtml(leagueId) {
    const m = _leagueMeta.get(leagueId);
    // Always the full league id (e.g. "Shabi Israel July 2026"), never the short
    // stored title — the _leagueMeta lookup is only for the type pill now.
    if (!m) return escapeHtml(leagueId);
    return `<span class="ana-entity">${escapeHtml(leagueId)}${typePillHtml(m.type)}</span>`;
}
function contextHtml(page, leagueId, player) {
    if (page === 'player_league' && player) {
        return `Player in league (${playerHtml(player)}${leagueId ? ', ' + leagueHtml(leagueId) : ''})`;
    }
    const base = escapeHtml(pageLabel(page));
    if (player) return `${base} (${playerHtml(player)})`;
    if (leagueId) return `${base} (${leagueHtml(leagueId)})`;
    return base;
}
// The Click-target cell reuses the same entity rendering for its "Player link:"
// / "League link:" values (the name/id is the tail after the prefix); everything
// else stays plain text via displayTarget.
function clickTargetHtml(target) {
    if (target.startsWith('Player link: ')) return `Player link: ${playerHtml(target.slice(13))}`;
    if (target.startsWith('League link: ')) return `League link: ${leagueHtml(target.slice(13))}`;
    return escapeHtml(displayTarget(target));
}

// The range is a calendar MONTH, not a rolling window. Rolling windows straddle
// the format break (see the header) and blend legacy rows with new-format ones
// into a single number that means neither. "All time" survives because a month
// is at most 31 bars — without it the timeseries can never show growth.
const ALL_TIME = 'all';

/** Month boundaries in Asia/Jerusalem, NOT UTC. `new Date(y, m, 1)` builds the
 *  boundary in the BROWSER's zone, which is only correct for an admin sitting in
 *  Israel; anywhere else it misfiles events in the 21:00–00:00 window into the
 *  neighbouring month — the exact bug sql/analytics_poc.sql's header warns about.
 *  Israel is UTC+2 (winter) / UTC+3 (summer), so the offset is derived from the
 *  date itself rather than assumed. */
function israelMonthRange(monthKey) {
    if (monthKey === ALL_TIME) return { from: new Date(0), to: new Date(Date.now() + DAY_MS) };
    const [y, m] = monthKey.split('-').map(Number);
    return { from: israelMidnight(y, m), to: israelMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) };
}

/** Midnight on the 1st of (year, month) in Israel, as a real instant. Probes the
 *  zone's actual offset at that date rather than hardcoding +2/+3, so it is
 *  correct across the DST switch either way.
 *
 *  Uses formatToParts, not toLocaleString+parse: the latter round-trips through
 *  a locale string whose exact shape is implementation-defined, and en-US with
 *  hour12:false renders midnight as "24" rather than "00" — which is precisely
 *  the value a month boundary hits. */
function israelMidnight(year, month) {
    const wall = Date.UTC(year, month - 1, 1, 0, 0, 0);
    const parts = Object.fromEntries(IL_PARTS.formatToParts(new Date(wall)).map((p) => [p.type, p.value]));
    // What Israel's clock reads at that UTC instant, re-encoded as if it were
    // UTC; the gap is the zone's offset. `% 24` absorbs the hour12 "24" quirk.
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return new Date(wall - (asUtc - wall));
}

const IL_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const monthKey = (isoDate) => isoDate.slice(0, 7); // "2026-07-01" -> "2026-07"
const monthLabel = (key) => {
    if (key === ALL_TIME) return 'All time';
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** A session's wall-clock span, which is routinely hours — formatMs above tops
 *  out at minutes (correct for the per-page dwell it was written for) and would
 *  render 8 hours as "480m 0s". */
function formatSpan(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Exact "Last Updated" convention used by the League Dashboard's own card. */
function formatLastUpdated(dateOrNull) {
    if (!dateOrNull) return 'N/A';
    const opts = { timeZone: 'Asia/Jerusalem' };
    return dateOrNull.toLocaleDateString('en-GB', { ...opts, day: '2-digit', month: 'short', year: 'numeric' })
        + ' ' + dateOrNull.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit' });
}

/** Same Asia/Jerusalem convention as formatLastUpdated, plus SECONDS — used by
 *  every event log. Those are read chronologically, and a click and the pageview
 *  it causes almost always share a minute: without seconds they look
 *  simultaneous and their order reads as arbitrary. formatLastUpdated stays at
 *  minute precision — it stamps a refresh, not an ordering. */
function formatEventTime(date) {
    const opts = { timeZone: 'Asia/Jerusalem' };
    return date.toLocaleDateString('en-GB', { ...opts, day: '2-digit', month: 'short', year: 'numeric' })
        + ' ' + date.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** The session-id chip, shown in the all-clicks table and on each session card.
 *
 *  Two states only, keyed on ADMIN_USER. An operator's visit is one shared
 *  pleasant red — the SAME for every admin, because the colour only has to
 *  answer "is this me or a real visitor?", never "which admin?"; the operator's
 *  name is spelled out in the label now, so the hue no longer has to carry
 *  identity. An ordinary visitor is one shared neutral chip. That two-way
 *  uniformity is the whole signal. An admin label reads `user_########` (email
 *  local part, an underscore, then the first 8 of the session id); a visitor
 *  chip is the bare 8-char code. */
function sessionChip(sessionId, adminUser) {
    const short = escapeHtml(String(sessionId).slice(0, 8));
    if (!adminUser) return `<span class="analytics-sid analytics-sid--visitor">${short}</span>`;
    // Label carries the operator's name; title keeps the FULL session id that
    // the 8-char label drops. Both are escaped like any other text.
    const label = `${escapeHtml(adminUser)}_${short}`;
    return `<span class="analytics-sid" title="${escapeHtml(String(sessionId))}">${label}</span>`;
}

/** A global-route row: no session id exists at all — by design, not by omission
 *  (see js/analytics.js). Shows the coarse continent when there is one; rows
 *  recorded before the region column existed have neither and read plain
 *  "External". The continent is already visible in this row's own aggregate
 *  (by_region) and the row already shows device_type, so this adds no new
 *  category of data — and it stays continent-level, never the city-level IANA
 *  string. With no id, two Europe/desktop rows remain uncorrelatable, which is
 *  the whole invariant. */
function externalChip(region) {
    return `<span class="analytics-sid analytics-sid--external">External${region ? ' · ' + escapeHtml(region) : ''}</span>`;
}

const sessionCell = (r) => (r.session ? sessionChip(r.session, r.adminUser) : externalChip(r.region));

// Tablet's glyph is a taste call — there is no good tablet emoji; 📋 is the
// least-wrong distinct shape next to 🖥️/📱.
const DEVICE_ICONS = { desktop: '🖥️', mobile: '📱', tablet: '📋', unknown: '❓' };

/** Session cards have no row to tint (that's a table affordance), so they state
 *  the device explicitly. Reuses the same device-<type> class, and therefore the
 *  same medal tokens, as the row tints — so "gold = desktop" means one thing
 *  across the whole page. Deliberately NOT used in the tables' Device column:
 *  those rows are already tinted by device, and a pill inside a tinted row just
 *  doubles the visual weight of the least important column. */
function devicePill(device) {
    const d = device || 'unknown';
    return `<span class="analytics-device-pill device-${escapeHtml(d)}">`
         + `<span aria-hidden="true">${DEVICE_ICONS[d] || DEVICE_ICONS.unknown}</span>${escapeHtml(d)}</span>`;
}

// The five referrer_kind buckets (js/analytics.js detectReferrer). 'internal'
// as an ENTRY referrer is the rare case of a visit whose first recorded hit
// already had a same-site referrer; the others are external arrivals.
const REFERRER_ICONS = { direct: '🔗', search: '🔍', social: '💬', internal: '↪', other: '🌐' };

/** How the visit STARTED — a neutral categorical pill next to the device pill,
 *  same shape but no medal tint (there is no device-style token set for referrer
 *  sources, and colouring it would compete with the operator-red chip). Empty
 *  when a visit carried no referrer (e.g. a session with no in-range pageview). */
function referrerPill(kind) {
    if (!kind) return '';
    return `<span class="analytics-referrer-pill" title="Entry referrer">`
         + `<span aria-hidden="true">${REFERRER_ICONS[kind] || REFERRER_ICONS.other}</span>${escapeHtml(kind)}</span>`;
}

// Compact node for the entry→exit route: page label plus the player when the
// hit was a player page (the entity that gives that page meaning). League is
// deliberately omitted — the arc is about page-to-page movement, and the full
// context is one click away in the expanded timeline. Keeps each node short
// enough that "A → B" fits one line.
const routeNode = (page, player) => {
    const base = pageLabel(page || '');
    return player ? `${base} · ${player}` : base;
};

/** The visit's arc as a distinct one-line path under the stats row — an entry
 *  page, an arrow, an exit page. NOT a pill: the pills above are categorical
 *  facts (device, referrer), this is a movement, and giving it its own visual
 *  form keeps the head scannable. A single-page visit (entry === exit) collapses
 *  to one node with no arrow. Empty when the visit had no in-range pageview. */
function sessionRoute(s) {
    if (!s.entry_page) return '';
    const entry = routeNode(s.entry_page, s.entry_player);
    const exit = routeNode(s.exit_page, s.exit_player);
    const body = (entry === exit)
        ? `<span class="rt-node">${escapeHtml(entry)}</span>`
        : `<span class="rt-node">${escapeHtml(entry)}</span>`
          + `<span class="rt-arrow" aria-hidden="true">→</span>`
          + `<span class="rt-node">${escapeHtml(exit)}</span>`;
    return `<span class="analytics-session-route" title="Entry → exit page">${body}</span>`;
}

function hexToRgba(color, alpha) {
    const hex = color.replace('#', '');
    if (![3, 6].includes(hex.length)) return `rgba(74,144,217,${alpha})`;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function makeSection(title) {
    const section = document.createElement('div');
    section.className = 'app-section app-section--card';
    const h2 = document.createElement('h2');
    h2.className = 'app-section-h2';
    h2.textContent = title;
    section.appendChild(h2);
    return section;
}

/** Bar chart — host div + canvas. Reads theme colours live, clamps every
 *  label/value to its own bar width so nothing can overlap or overflow, and
 *  thins labels on dense charts (e.g. a 12-month timeseries). */
function drawBarChart(host, items, { labelKey, valueKey, labelFmt = (v) => v }) {
    host.innerHTML = '';
    if (!items || items.length === 0) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }
    const canvas = document.createElement('canvas');
    const width = host.clientWidth || 600;
    const height = 220;
    canvas.width = width;
    canvas.height = height;
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const max = Math.max(...items.map((i) => i[valueKey]), 1);
    const barW = width / items.length;
    const style = getComputedStyle(document.documentElement);
    const barColor = (style.getPropertyValue('--color-accent') || '#4a90d9').trim() || '#4a90d9';
    const valueColor = (style.getPropertyValue('--color-text') || '#333').trim() || '#333';
    const labelColor = (style.getPropertyValue('--color-text-muted') || valueColor).trim() || valueColor;
    const axisColor = (style.getPropertyValue('--color-border') || '#ddd').trim() || '#ddd';
    const baseY = height - 20;

    const labelEvery = Math.max(1, Math.ceil((items.length * 32) / width));

    ctx.strokeStyle = axisColor;
    ctx.beginPath();
    ctx.moveTo(0, baseY + 0.5);
    ctx.lineTo(width, baseY + 0.5);
    ctx.stroke();

    ctx.textAlign = 'center';
    items.forEach((item, i) => {
        const val = item[valueKey];
        const barH = (val / max) * (height - 40);
        const x = i * barW + 4;
        const y = baseY - barH;
        const cx = x + (barW - 8) / 2;
        ctx.fillStyle = barColor;
        ctx.fillRect(x, y, barW - 8, barH);
        if (val > 0) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = valueColor;
            ctx.fillText(String(val), cx, y - 4, barW - 2);
        }
        if (i % labelEvery === 0) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = labelColor;
            ctx.fillText(labelFmt(item[labelKey]), cx, height - 6, barW - 2);
        }
    });
}

/** Traffic heatmap: real calendar buckets (day or month, Israel time) x hour-of-day,
 *  with a colour-scale legend whose range matches the data actually shown. */
function drawDateHeatmap(host, rows, granularity) {
    host.innerHTML = '';
    if (!rows || rows.length === 0) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }
    const buckets = [...new Set(rows.map((r) => r.bucket))].sort();
    const max = Math.max(...rows.map((r) => r.views), 1);

    const style = getComputedStyle(document.documentElement);
    const accent = (style.getPropertyValue('--color-accent') || '#4a90d9').trim() || '#4a90d9';
    const textColor = (style.getPropertyValue('--color-text') || '#333').trim() || '#333';

    const grid = new Map();
    for (const b of buckets) grid.set(b, Array(24).fill(0));
    for (const r of rows) grid.get(r.bucket)[r.hour] = r.views;

    const bucketLabel = (b) => {
        // Bucket comes from Postgres as a bare "YYYY-MM-DD" date already
        // computed in Israel time; appending a local midnight avoids the
        // UTC-parse day-shift that plain `new Date("YYYY-MM-DD")` causes.
        const d = new Date(`${b}T00:00:00`);
        return granularity === 'month'
            ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
            : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const table = document.createElement('table');
    table.className = 'analytics-heatmap';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    for (let h = 0; h < 24; h++) {
        const th = document.createElement('th');
        th.textContent = h % 3 === 0 ? String(h) : '';
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const b of buckets) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = bucketLabel(b);
        tr.appendChild(th);
        const hours = grid.get(b);
        for (let h = 0; h < 24; h++) {
            const td = document.createElement('td');
            const v = hours[h];
            const alpha = v === 0 ? 0 : 0.12 + 0.88 * (v / max);
            td.style.backgroundColor = v === 0 ? 'transparent' : hexToRgba(accent, alpha);
            td.style.color = textColor;
            td.title = `${bucketLabel(b)} ${h}:00 — ${v} view${v === 1 ? '' : 's'}`;
            if (v > 0) td.textContent = v;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    const legend = document.createElement('div');
    legend.className = 'analytics-heatmap-legend';
    legend.innerHTML = `
        <span>0</span>
        <div class="analytics-heatmap-gradient" style="background: linear-gradient(to right, transparent, ${accent})"></div>
        <span>${max}</span>`;
    host.appendChild(legend);
}

function renderMfTable(host, items, columns) {
    if (!items || items.length === 0) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }
    const rows = items.map((item) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(item[c.key] ?? ''))}</td>`).join('')}</tr>`
    ).join('');
    host.innerHTML = `
        <div class="mf-wrap">
            <table class="dash-table font-small">
                <thead><tr>${columns.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function cmp(av, bv) {
    if (av instanceof Date) return av.getTime() - bv.getTime();
    if (typeof av === 'string') {
        const a = av.toLowerCase();
        const b = bv.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
    }
    return av < bv ? -1 : av > bv ? 1 : 0;
}

/** The one log-table renderer on this page: the transitions log, the all-clicks
 *  log, and each session's own trace all render through it, so they are the same
 *  table by construction rather than by three hand-synced copies.
 *
 *  `columns` is the single source of truth for header AND cells — each column
 *  owns its own render(row), so a column can no longer appear in the <thead>
 *  without a matching <td>. render() returns RAW html, so every column must
 *  escape its own text; icons are raw on purpose (some are inline SVG or <img>).
 *
 *  `sort` is the CALLER's object and is mutated in place: mountFilteredLog
 *  re-calls this with a new row set on every From/To change, and passing the
 *  same object back is what makes the chosen sort survive a filter change.
 *
 *  Emits class="log-table", not an id: css/analytics.css's device tints have to
 *  apply to N per-session tables at once, which an id can never do. */
function renderLogTable(host, rows, columns, { emptyText = 'No data yet.', sort } = {}) {
    const st = sort || { key: 'date', dir: 'desc' };

    function draw() {
        if (rows.length === 0) {
            host.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
            return;
        }
        const sorted = [...rows].sort((a, b) => cmp(a[st.key], b[st.key]) * (st.dir === 'asc' ? 1 : -1));

        const theadHtml = columns.map((c) => {
            const arrow = c.key === st.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '';
            return `<th scope="col" data-sort-key="${c.key}" style="cursor:pointer">${escapeHtml(c.label)}${arrow}</th>`;
        }).join('');

        const rowsHtml = sorted.map((r) =>
            `<tr class="device-${escapeHtml(r.device || 'unknown')}">${
                columns.map((c) => `<td>${c.render(r)}</td>`).join('')
            }</tr>`).join('');

        host.innerHTML = `
            <div class="mf-wrap">
                <table class="dash-table font-small log-table">
                    <thead><tr>${theadHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;

        host.querySelectorAll('th[data-sort-key]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (st.key === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
                else { st.key = key; st.dir = 'asc'; }
                draw();
            });
        });
    }
    draw();
}

/** The shared From/To time window, layered on top of renderLogTable — kept out
 *  of the table renderer itself because the per-session tables don't want one.
 *  Known pre-existing quirk, unchanged here: the datetime-local inputs read the
 *  BROWSER's timezone while the Date column renders Asia/Jerusalem, so filter
 *  boundaries only line up with displayed times for an admin sitting in Israel.
 *  `section` must contain the three selectors passed in. */
function mountFilteredLog(section, { hostSel, fromSel, toSel, rows, columns, emptyWindowText, search }) {
    const host = section.querySelector(hostSel);
    const fromInput = section.querySelector(fromSel);
    const toInput = section.querySelector(toSel);

    if (rows.length === 0) {
        fromInput.disabled = true;
        toInput.disabled = true;
        if (search) { const si = section.querySelector(search.inputSel); if (si) si.disabled = true; }
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }

    // datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time (no timezone
    // suffix) — toISOString() is UTC, so build it from local getters instead.
    const toLocalInputValue = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    // Default window on every refresh: from the dawn of history to right now
    // — i.e. show everything — rather than clamping to the fetched data's own
    // min/max (which shifted every time new data arrived).
    fromInput.value = toLocalInputValue(new Date(0));
    toInput.value = toLocalInputValue(new Date());

    // Optional smart-search filter (the all-clicks log). `query` is the active
    // filter text — set by the search field on every keystroke AND on a pick, so
    // it doubles as a live substring filter and an exact "pick this click" one.
    // `windowCounts` holds the per-value occurrence count over the CURRENT date
    // window (query-independent, so the browse-all list always shows every click
    // with its true count regardless of what is typed) — the search's own
    // getOptions/decorate read it, so it is recomputed inside draw().
    let query = '';
    let windowCounts = new Map();

    // Created once and handed to every renderLogTable call below, so re-drawing
    // on a filter change preserves whatever column the admin sorted by.
    const sort = { key: 'date', dir: 'desc' }; // newest first by default
    const draw = () => {
        const fromTime = fromInput.value ? new Date(fromInput.value).getTime() : -Infinity;
        const toTime = toInput.value ? new Date(toInput.value).getTime() : Infinity;
        const inWindow = rows.filter((r) => r.date.getTime() >= fromTime && r.date.getTime() <= toTime);
        if (search) {
            windowCounts = new Map();
            for (const r of inWindow) {
                const v = r[search.field];
                if (v) windowCounts.set(v, (windowCounts.get(v) || 0) + 1);
            }
        }
        const q = query.trim().toLowerCase();
        const shown = q
            ? inWindow.filter((r) => {
                const raw = String(r[search.field] || '').toLowerCase();
                const disp = search.labelFor ? String(search.labelFor(r[search.field]) || '').toLowerCase() : raw;
                return raw.includes(q) || disp.includes(q);
            })
            : inWindow;
        renderLogTable(host, shown, columns,
            { emptyText: q ? 'No clicks match this search.' : emptyWindowText, sort });
    };

    fromInput.addEventListener('change', draw);
    toInput.addEventListener('change', draw);

    if (search) {
        const searchInput = section.querySelector(search.inputSel);
        if (searchInput) {
            // The mobile search sheet is installed by the site sidebar / admin
            // shell, neither of which analytics.html loads — so install it here
            // too (idempotent, touch-only) or the .app-search-input tap would have
            // no sheet to open on a phone.
            installSearchOverlay();
            mountSearchField(searchInput, {
                // Distinct field values in the current window, most-clicked first.
                getOptions: () => [...windowCounts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([value]) => ({ value, label: search.labelFor ? search.labelFor(value) : value })),
                // Each option carries its own icon + a count badge — this IS the
                // "always show the count per click" the browse-all list provides.
                decorate: (value) => ({
                    iconHtml: search.iconFor ? (search.iconFor(value) || '') : '',
                    badge: { text: String(windowCounts.get(value) || 0), kind: 'count' },
                }),
                // Fires on every keystroke (live substring filter) and on a pick
                // (the full click_target), and with '' when cleared — one hook.
                onChange: (value) => { query = value || ''; draw(); },
                allowFreeText: true,
            });
        }
    }

    draw();
}

/** Chronological, un-aggregated, click-to-sort log of every transition —
 *  same From/To pair repeats across rows on purpose (each occurrence is its
 *  own row); `running_count` is that pair's cumulative count so far. Rows
 *  are tinted by device type, reusing the site's existing per-theme medal
 *  tint tokens (already themed across all 8 themes, no new tokens needed).
 *  `section` must contain #transitions-log-from/#transitions-log-to (the
 *  time-window filter inputs) and #table-transitions-log (the table host). */
function renderTransitionsLog(section, transitionsLog) {
    mountFilteredLog(section, {
        hostSel: '#table-transitions-log',
        fromSel: '#transitions-log-from',
        toSel: '#transitions-log-to',
        emptyWindowText: 'No transitions in this time window.',
        rows: (transitionsLog || []).map((t) => ({
            date: new Date(t.created_at),
            from: contextLabel(t.from_page, t.from_league_id, t.from_player), // text = sort key
            to: contextLabel(t.to_page, t.to_league_id, t.to_player),
            fromRaw: [t.from_page, t.from_league_id || '', t.from_player || ''], // rich render
            toRaw: [t.to_page, t.to_league_id || '', t.to_player || ''],
            device: t.device_type || 'unknown',
            count: t.running_count,
        })),
        columns: [
            { key: 'date', label: 'Date', render: (r) => escapeHtml(formatEventTime(r.date)) },
            { key: 'from', label: 'From', render: (r) => contextHtml(...r.fromRaw) },
            { key: 'to', label: 'To', render: (r) => contextHtml(...r.toRaw) },
            { key: 'device', label: 'Device', render: (r) => escapeHtml(r.device) },
            { key: 'count', label: 'Count', render: (r) => r.count },
        ],
    });
}

// Fixed icon per click_target TYPE prefix (js/analytics.js's own
// classification) — purely a display affordance in the "All clicks" table,
// never stored. "League link: " is a plain content link like any other, so
// it shares the generic Link icon rather than a distinct one.
const CLICK_TYPE_ICONS = [
    // ── What If (dashboard B4) ────────────────────────────────────────────
    // Every control in the section is 🧪 + one glyph naming the control, so a
    // What-If row is recognisable at a glance yet still tells you WHICH control
    // produced it. ORDER MATTERS: the match is startsWith (see clickIcon
    // below), so each specific prefix must stay ABOVE the bare 'What if: '
    // fallback — otherwise all of them collapse onto the plain 🧪.
    // Prefixes are also mutually exclusive by design: 'What if: section '
    // (the whole panel folding) vs 'What if: table ' (the result list
    // expanding) never share a leading string.
    { prefix: 'What if baseline: ', icon: '🧪🕘' },  // rewind the starting point
    { prefix: 'What if topx: ', icon: '🧪🔝' },      // P(finish in top X) metric
    { prefix: 'What if: player ', icon: '🧪👤' },    // A / B picker
    { prefix: 'What if: add match', icon: '🧪🆚' },  // pair staged
    { prefix: 'What if: winner ', icon: '🧪🏅' },    // forced a winner
    { prefix: 'What if: not played ', icon: '🧪↩️' }, // rolled a result back
    { prefix: 'What if: remove match', icon: '🧪🗑️' },
    { prefix: 'What if: clear all', icon: '🧪🧹' },
    { prefix: 'What if: run', icon: '🧪▶️' },
    { prefix: 'What if: table ', icon: '🧪👁️' },    // rows shown, numbers unchanged
    { prefix: 'What if: section ', icon: '🧪🔽' },
    { prefix: 'What if: help language', icon: '🧪🌐' },
    // Bare fallback — also what pre-existing 'What if: <n> staged' rows
    // (logged before 'What if: run — ' replaced that format) still resolve to.
    { prefix: 'What if: ', icon: '🧪' },
    { prefix: 'Export: ', icon: '🖼️' },
    { prefix: 'Search: ', icon: '🔍' },
    { prefix: 'Action: ', icon: '💾' },
    { prefix: 'Info: ', icon: 'ℹ️' },
    { prefix: 'History view: ', icon: '🕘' },
    { prefix: 'Privacy: ', icon: '🛡️' },
    { prefix: 'Nav: previous', icon: '⬅️' },
    { prefix: 'Nav: next', icon: '➡️' },
    { prefix: 'Breadcrumb: ', icon: '🧭' }, // proposed — pending approval
    // Statistical chart controls share ONE math glyph (∑): the Gaussian-fit /
    // Trim / Table-Validation toggles and every legend series-toggle, on both
    // the dashboard PR-correlation panels and the player "Total PR ↔ Result"
    // section. The chart-comparison controls get their own distinct icons:
    // adding a comparison chart (➕), removing one (🗑️), and re-pointing a row's
    // player picker (👤, fired via shabi:interaction since a <select> change is
    // not a DOM click). Listed before the generic Link entries so these specific
    // prefixes win the startsWith match.
    { prefix: 'Chart tool: ', icon: '∑' },
    { prefix: 'Compare: add', icon: '➕' },
    { prefix: 'Compare: remove', icon: '🗑️' },
    { prefix: 'Compare: change', icon: '👤' },
    { prefix: 'H2H: ', icon: '🆚' }, // player page H2H opponent picker

    { prefix: 'Player link: ', icon: '🔗' },
    { prefix: 'League link: ', icon: '🔗' },
    { prefix: 'Link: ', icon: '🔗' },
];

// Logout's icon is an inline SVG defined directly on its own button (not in
// the shared ICON map — js/admin/render/adminSidebarNav.js /
// js/render/siteSidebar.js both use this same markup), so it's copied here
// rather than referenced.
const LOGOUT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>';

// Site brand logo, scaled down to icon size — used for the "Shabi Israel"
// brand link in the sidebar (both the current "Menu: Shabi Israel" click and
// the bare legacy "Shabi Israel" text recorded before this classification
// existed).
const BRAND_ICON = '<img src="assets/favicon-round.png" alt="" style="width:14px;height:14px;border-radius:50%;vertical-align:-2px">';

// The sidebar's own icon per nav item (js/render/siteSidebar.js's ICON map),
// keyed by the same clean label js/analytics.js now reads from
// .site-nav-label/.site-nav-flyout-label — so "Menu: <label>" shows the
// EXACT icon that item has in the real sidebar, not a guess. Items with no
// distinct icon there (theme swatches, Username/Full name, per-league
// entries) get none. "Dashboard: <league>"/"Table: <league>" are the final
// leaf click under the 2-level Leagues flyout (js/analytics.js skips the
// "Leagues"/"Dashboard"/"Table" toggle clicks themselves) — Dashboard gets
// its own icon, Table reuses the site's line-glyph league icon (an inline
// SVG, the one case here that isn't a plain emoji).
const MENU_LABEL_ICONS = {
    Players: '👥',
    Dashboard: '📊',
    Records: '📜',
    Achievements: '🏅',
    PR: '🧠',
    Match: '🎲',
    Leaders: '👑',
    Settings: '⚙️',
    'Theme Customize': '🎨',
    'Show name as': '🔤',
    'Admin Login': '👷',
    'Admin Mode': '👷',
    'Main Dashboard': '🏠',
    'Pending Changes': '📝',
    'Historical Changes': '🕘',
    'Shabi Israel': BRAND_ICON,
};

/** Best-effort icon for a click_target string. Rows recorded before today's
 *  "Type: label" convention existed have no prefix at all — but the click
 *  listener back then only ever tracked data-track/.img-export-btn/<a> (see
 *  js/analytics.js's history), so any such unprefixed text is safe to assume
 *  was a plain link click, EXCEPT the two known literal values the old code
 *  produced for other cases ('export_image', and the brand link's own text). */
function clickIcon(target) {
    if (target.startsWith('Tab: ')) {
        const id = target.slice(5).trim();
        return TAB_ICONS[id] || '🗂️';
    }
    if (target.startsWith('Menu: ')) {
        // Strip the "(Admin Mode)" suffix (js/analytics.js appends it AFTER
        // the label) before matching — otherwise every admin-sidebar item's
        // label becomes e.g. "Settings (Admin Mode)" and never exact-matches
        // MENU_LABEL_ICONS at all.
        const label = target.slice(6).trim().replace(/ \(Admin Mode\)$/, '');
        if (label.startsWith('Dashboard: ')) return MENU_LABEL_ICONS.Dashboard;
        if (label.startsWith('Table: ')) return TAB_ICONS.leagues;
        if (label === 'Logout') return LOGOUT_ICON;
        // Specific icon where the item has one (Players 👥, Records 📜, …);
        // otherwise the hamburger-menu glyph ☰, so any nav-menu click still
        // reads as "came from the navigation menu" rather than showing nothing.
        return MENU_LABEL_ICONS[label] || '☰';
    }
    // The What-If "?" is logged generically by js/analytics.js as `Info: <section
    // heading>` like every other "?" on the site, so it can't carry a What-If
    // prefix of its own. Exact-matched here (before the prefix scan) purely so
    // the section's help control joins its 🧪 family instead of showing the
    // generic ℹ️.
    if (target === 'Info: What If') return '🧪ℹ️';
    const match = CLICK_TYPE_ICONS.find((c) => target.startsWith(c.prefix));
    if (match) return match.icon;
    if (target === 'export_image') return CLICK_TYPE_ICONS.find((c) => c.prefix === 'Export: ').icon;
    if (target === 'Shabi Israel') return BRAND_ICON;
    if (!target) return '';
    // Legacy sidebar/tab clicks (recorded before Tab/Menu classification
    // existed) captured the element's full raw textContent, icon glyph
    // included (e.g. "👥 Players") — those already have their own icon, so
    // adding 🔗 on top would double up. Only plain content text with no
    // leading icon (e.g. "July 2026", "Home") gets the generic Link icon.
    return /^\p{Extended_Pictographic}/u.test(target) ? '' : '🔗';
}

// Display label per tab id, matching EXACTLY what each tab button shows across
// the site (mountAppTabs definitions in landingPage/dashboardPage/
// playerGeneralPage.js). A "Tab: <id>" click stores the stable dataset.tab SLUG
// — translation-proof, unlike the visible label — so the button's own casing is
// reapplied here at render time, not at capture. Several ids aren't a plain
// capitalisation (h2h→H2H, leaderboard→Leaders, insights→Charts,
// statistics→Stats), so this is an explicit map, not an auto-title-case.
const TAB_LABELS = {
    leagues: 'Leagues',
    leaderboard: 'Leaders',
    records: 'Records',
    players: 'Players',
    standings: 'Standings',
    matches: 'Matches',
    predictor: 'Predictor',
    insights: 'Charts',
    statistics: 'Stats',
    h2h: 'H2H',
};

/** Prettify a click_target for display only (the stored string stays the stable
 *  slug). Currently just "Tab: <id>" → "Tab: <ButtonLabel>"; any unknown id
 *  falls back to capitalising its first letter so nothing renders lower-case. */
function displayTarget(target) {
    if (target.startsWith('Tab: ')) {
        const id = target.slice(5).trim();
        return `Tab: ${TAB_LABELS[id] || (id.charAt(0).toUpperCase() + id.slice(1))}`;
    }
    return target;
}

/** The column set for the all-clicks table AND for each session's own trace —
 *  the same array, so "the session view is the clicks table" holds by
 *  construction rather than by agreement.
 *
 *  `withSession` is off inside a session card: the id is constant for every row
 *  there and is already the card's own header chip, so repeating it would cost a
 *  column of width to say nothing. Session ID sits second in the main table so
 *  it reads left-to-right as when → who; sorting on it clusters one visit's rows
 *  together and pools all the external ones. */
const clickColumns = ({ withSession = false } = {}) => [
    { key: 'date', label: 'Date', render: (r) => escapeHtml(formatEventTime(r.date)) },
    ...(withSession ? [{ key: 'session', label: 'Session ID', render: (r) => sessionCell(r) }] : []),
    // Rich page/entity render (flag + name + title, or league title + type pill);
    // the plain-text r.page is kept only as the sort key (set on the row).
    { key: 'page', label: 'Page', render: (r) => contextHtml(r.pageType, r.leagueId, r.player) },
    // Wrap icon+label in a nowrap span so the icon never orphans onto its own
    // line. A plain &nbsp; is NOT enough here (it was tried and verified to fail):
    // the icon can be an inline-block SVG glyph (TAB_ICONS, e.g. "Tab: leagues"),
    // and a no-break space only glues text-to-text — it does not suppress the
    // break between an ATOMIC INLINE (the SVG) and the text after it. nowrap keeps
    // the whole cell on one line; long labels ride the .mf-wrap horizontal scroll.
    { key: 'target', label: 'Click target', render: (r) => `<span class="ana-click-target">${r.icon ? r.icon + ' ' : ''}${clickTargetHtml(r.target)}</span>` },
    { key: 'device', label: 'Device', render: (r) => escapeHtml(r.device) },
];

/** Chronological, click-to-sort log of every click/interaction event (Export
 *  Image, Run Simulation with its staged summary, search outcomes, link
 *  clicks). Same shape/behaviour as renderTransitionsLog (device-tinted rows,
 *  default From/To window = dawn of history → now on every refresh), but
 *  flat (no from/to pair, no running count) since click_target text is often
 *  unique per row rather than a small repeating set. `section` must contain
 *  #clicks-log-from/#clicks-log-to and #table-clicks-log.
 *
 *  The Session ID column is where the two collection routes become visible: an
 *  Israel-route click carries an id (and joins a card in the Sessions section
 *  above), while every other click shows "External" — it has no id to show, on
 *  purpose.
 *
 *  `sessions` is passed in only to colour that column consistently — see
 *  sessionAdminUser below. */
function renderClicksLog(section, clicksLog, sessions) {
    // A row's OWN admin_user is per-event, so an admin who logs in mid-visit
    // leaves earlier rows null and later ones tagged — which would paint one
    // session id in two different colours in this table, while the card for that
    // same visit (where any non-null tags the whole session) shows one. The
    // chip's only question is "is this visit the operator or a real visitor?",
    // and that is a property of the VISIT, so resolve it per session and let the
    // row's own value stand in only for clicks whose session fell outside the
    // sessions cap. `has` rather than `||`: a session present with a null
    // admin_user is a real answer (an ordinary visitor), not a missing one.
    const bySession = new Map((sessions || []).map((s) => [s.session_id, s.admin_user]));
    const sessionAdminUser = (c) =>
        (bySession.has(c.session_id) ? bySession.get(c.session_id) : c.admin_user) || null;

    mountFilteredLog(section, {
        hostSel: '#table-clicks-log',
        fromSel: '#clicks-log-from',
        toSel: '#clicks-log-to',
        emptyWindowText: 'No clicks in this time window.',
        rows: (clicksLog || []).map((c) => ({
            date: new Date(c.created_at),
            page: contextLabel(c.page, c.league_id, c.player), // plain text = sort key
            pageType: c.page, leagueId: c.league_id || '', player: c.player || '', // rich render
            target: c.click_target || '',
            icon: clickIcon(c.click_target || ''),
            device: c.device_type || 'unknown',
            // '' rather than null so sorting pools every external row together
            // instead of comparing null against a string.
            session: c.session_id || '',
            region: c.region || '',
            adminUser: sessionAdminUser(c),
        })),
        columns: clickColumns({ withSession: true }),
        // Smart-search the log by click target: browse-all lists every distinct
        // click with its count badge, picking one filters the table to it, and
        // it works on mobile via the shared sheet (mountSearchField). Label +
        // icon match exactly what the "Click target" column shows.
        search: {
            inputSel: '#clicks-log-search',
            field: 'target',
            labelFor: displayTarget,
            iconFor: clickIcon,
        },
    });
}

/** One CLICK in the all-clicks table's own row shape, so both feed the same
 *  columns. The session timeline is clicks-only (see renderSessions), so this
 *  only ever formats a click — no pageview/duration branch. `device` comes from
 *  the SESSION: device_type is constant within a visit (one browser, one tab),
 *  which is why timeline rows don't carry it. */
function timelineRow(e, sessionDevice) {
    return {
        date: new Date(e.created_at),
        page: contextLabel(e.page, e.league_id, e.player), // plain text = sort key
        pageType: e.page, leagueId: e.league_id || '', player: e.player || '', // rich render
        target: e.click_target || '',
        icon: clickIcon(e.click_target || ''),
        device: sessionDevice || 'unknown',
    };
}

/** Per-visit traces — the Israel route ONLY, and the only place on this page
 *  where one visitor's events are shown as a sequence rather than as a
 *  population statistic. Foreign visitors carry no session id by design and can
 *  never appear here; they exist in the all-clicks log below as unlinked
 *  individual rows, which is the entire point of the two-route model (see
 *  sql/analytics_poc.sql's header). `section` must contain #sessions-list.
 *
 *  Each card is a native <details>: no expand JS, keyboard and aria-expanded for
 *  free, and a `toggle` event that doubles as the lazy-render hook. Note it must
 *  NOT be an .app-section — renderAnalyticsPage ends with a blanket
 *  wireSectionCollapse over every .app-section, and that helper isn't idempotent,
 *  so a nested one would get double-wired and toggle twice per click. */
function renderSessions(section, sessions) {
    const host = section.querySelector('#sessions-list');
    if (!sessions || sessions.length === 0) {
        host.innerHTML = '<p class="muted">No sessions yet. Only visits from an Asia/Jerusalem '
            + 'timezone carry a session id — every other visitor is recorded as unlinked '
            + 'individual events by design, and appears only in the clicks log below.</p>';
        return;
    }

    host.innerHTML = sessions.map((s) => `
        <details class="analytics-session">
            <summary class="analytics-session-head">
                ${sessionChip(s.session_id, s.admin_user)}
                <span class="analytics-session-time">${escapeHtml(formatEventTime(new Date(s.started_at)))}</span>
                <span class="analytics-session-meta">${escapeHtml(formatSpan(s.duration_ms))}</span>
                <span class="analytics-session-meta">${s.pageview_count} view${s.pageview_count === 1 ? '' : 's'} · ${s.click_count} click${s.click_count === 1 ? '' : 's'}</span>
                ${devicePill(s.device_type)}
                ${referrerPill(s.entry_referrer)}
                ${sessionRoute(s)}
            </summary>
            <div class="analytics-session-body"></div>
        </details>`).join('');

    // Lazy: 200 sessions x up to 500 timeline events is ~100k rows built upfront
    // for tables nobody has opened yet. <details> fires `toggle` on first expand,
    // and dataset.drawn keeps it to once.
    host.querySelectorAll('.analytics-session').forEach((el, i) => {
        el.addEventListener('toggle', () => {
            if (!el.open || el.dataset.drawn) return;
            el.dataset.drawn = '1';
            const s = sessions[i];
            const timeline = s.timeline || [];
            const body = el.querySelector('.analytics-session-body');
            // Clicks ONLY. Pageview and Dwell rows are both non-interactions: the
            // visit's navigation is already told by the card head's entry→exit
            // route and its view count, and its total dwell by the head's span, so
            // listing every page-view/timer here is redundant noise. What's left
            // that a header can't summarise is the actual interactions — the
            // clicks — so the trace is exactly those. A pure-browse visit (no
            // clicks) shows the empty note below, which is itself the signal.
            const events = timeline.filter((e) => e.event_type === 'click');
            // Same columns as the all-clicks table, minus Session ID (constant
            // here); ascending, because a trace is read forwards.
            renderLogTable(body, events.map((e) => timelineRow(e, s.device_type)),
                clickColumns(), { emptyText: 'No clicks in this visit.', sort: { key: 'date', dir: 'asc' } });
            // click_count is counted over the WHOLE visit server-side, so if the
            // 500-event timeline cap dropped some clicks, this still flags it.
            if (events.length < s.click_count) {
                body.insertAdjacentHTML('beforeend',
                    `<p class="muted">Showing the first ${events.length} of ${s.click_count} clicks.</p>`);
            }
        });
    });
}

function renderKpiCards(host, data, fetchedAt) {
    const cards = [
        { label: 'Pageviews', value: data.total_pageviews },
        // Israel-route visits only — every other visitor is recorded without a
        // session id and so cannot be counted as a distinct visit at all. Hence
        // the label: this is not a visitor count.
        { label: 'Sessions (Israel)', value: data.total_sessions },
        { label: 'Avg. dwell time', value: formatMs(data.avg_dwell_ms) },
        { label: 'Bounce rate', value: `${data.bounce_pct}%` },
        // Confirms this view is live — every refresh means a fresh request to
        // Supabase, so this always shows "just now", not the underlying data's
        // own timestamp (that's `data.last_event_at`, unused here on purpose).
        { label: 'Last Updated', value: formatLastUpdated(fetchedAt), flex: true },
    ];
    host.innerHTML = cards.map((c) => `
        <div class="dash-card${c.flex ? ' dash-card--flex' : ''}">
            <div class="dash-card-label">${escapeHtml(c.label)}</div>
            <div class="dash-card-value">${c.value}</div>
        </div>
    `).join('');
}

function renderDwellBuckets(host, dwellBuckets) {
    host.innerHTML = '';
    const byPage = new Map();
    for (const row of dwellBuckets || []) {
        if (!byPage.has(row.page)) byPage.set(row.page, new Map());
        byPage.get(row.page).set(row.bucket, row.n);
    }
    if (byPage.size === 0) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }
    // Two passes: attach every card first, then measure/draw — reading
    // clientWidth mid-loop sees a flex row that hasn't settled on its final
    // per-item width yet, which would bake a stale (too-wide) canvas size.
    const pending = [];
    for (const [page, buckets] of byPage) {
        const card = document.createElement('div');
        card.className = 'admin-card';
        card.style.flex = '1';
        card.style.minWidth = '220px';
        const h4 = document.createElement('h4');
        h4.textContent = pageLabel(page);
        card.appendChild(h4);
        const chartHost = document.createElement('div');
        card.appendChild(chartHost);
        host.appendChild(card);
        const items = DWELL_BUCKET_ORDER.map((b) => ({ bucket: b, n: buckets.get(b) || 0 }));
        pending.push({ chartHost, items });
    }
    for (const { chartHost, items } of pending) {
        drawBarChart(chartHost, items, { labelKey: 'bucket', valueKey: 'n' });
    }
}

/** `monthKeyArg` is "YYYY-MM" or ALL_TIME; null = pick the newest month that
 *  actually has new-format data (NOT today's month — the current month can be
 *  empty, which would open the dashboard on a blank page).
 *  `excludeAdmin` defaults ON: the operator's own browsing is not audience, and
 *  every number here was silently inflated by it until admin_user existed. */
/** What the selected range is actually MADE of, and how much of it is the
 *  operator's own. Reads traffic_mix, which the RPC computes BEFORE the admin
 *  filter, so the "excluded" count survives its own filter being on. This is the
 *  panel that tells you how much to trust every other number on the page. */
function renderTrafficMix(section, mix, excludeAdmin) {
    const host = section.querySelector('#chart-mix');
    const note = section.querySelector('#mix-note');
    if (!mix || !mix.total) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        note.textContent = '';
        return;
    }
    drawBarChart(host, [
        { route: 'Israel (sessionized)', n: mix.israel },
        { route: 'Global (anonymous)', n: mix.global },
    ], { labelKey: 'route', valueKey: 'n' });

    const n = mix.internal;
    note.textContent = excludeAdmin
        ? (n
            ? `${n} event${n === 1 ? '' : 's'} from your own admin browsing excluded from every number on this page.`
            : 'No admin browsing recorded in this range — these numbers are all real audience.')
        : (n
            ? `Includes ${n} event${n === 1 ? '' : 's'} of your own admin browsing. Tick "Exclude my own traffic" for audience-only numbers.`
            : 'No admin browsing recorded in this range.');
}

/** The aggregated top A→B flows — `transitions`, which the RPC has always
 *  computed and nothing ever rendered. Already `order by n desc limit 30`. */
function renderFlows(section, transitions) {
    renderMfTable(section.querySelector('#table-flows'),
        (transitions || []).map((t) => ({
            from: contextLabel(t.from_page, t.from_league_id, t.from_player),
            to: contextLabel(t.to_page, t.to_league_id, t.to_player),
            n: t.n,
            last: formatEventTime(new Date(t.last_seen)),
        })),
        [
            { key: 'from', label: 'From' },
            { key: 'to', label: 'To' },
            { key: 'n', label: 'Count' },
            { key: 'last', label: 'Last seen' },
        ]);
}

/** The pre-format archive. Everything here predates the timezone-routed identity
 *  model, so these rows support NO sessions, NO region and NO admin_user — the
 *  columns did not exist when they were written. Render only what the data can
 *  honestly answer, and never let it blend with the live tabs' numbers.
 *
 *  Fetched lazily: nothing new ever lands here, so don't pay for it unless it is
 *  opened. Same dataset.drawn guard the session cards use. */
function mountHistoryTab(shell, from, to) {
    const panel = shell.panels.history;
    panel.innerHTML = '<div class="loading">Loading archive…</div>';
    let drawn = false;
    // Default ON, mirroring the live tabs' "exclude my own traffic".
    let hideMine = true;

    const load = async () => {
        panel.innerHTML = '<div class="loading">Loading archive…</div>';
        const { data, error } = await supabase.rpc('analytics_summary', {
            from_date: from.toISOString(),
            to_date: to.toISOString(),
            scope: 'legacy',
            // Pointless on legacy rows — they never carried admin_user. The
            // derived page='admin' proxy below is the only handle that exists.
            exclude_admin: false,
            hide_admin_pages: hideMine,
        });
        if (error) {
            panel.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(error.message)}</div>`;
            return;
        }
        renderHistory(panel, data, hideMine, (next) => { hideMine = next; load(); });
    };

    const drawOnce = () => {
        if (drawn || panel.hidden) return;
        drawn = true;
        load();
    };

    // Watch the PANEL, not the tab button: appTabs routes every activation path
    // — click, arrow-key roving, 1-N hotkey, and the initial ?tab= URL — through
    // activate(), which toggles panel.hidden. Observing that catches all of them
    // and stays correct if the tablist's internals ever change.
    new MutationObserver(drawOnce).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    drawOnce(); // ?tab=history — already visible before the observer attached
}

function renderHistory(panel, data, hideMine, onToggle) {
    const mix = data.traffic_mix || {};
    panel.innerHTML = `
        <div class="app-section app-section--card">
            <h2 class="app-section-h2">Archive (pre-identity model)</h2>
            <p class="analytics-mix-note">
                Events collected before the timezone-routed identity model. These rows carry no
                session and no region — those were never collected, so they cannot be recovered
                and nothing new will ever land here.
                <br>At least <strong>${mix.provably_internal || 0}</strong> of these
                ${mix.total || 0} events are provably yours (the Admin page requires a login).
                For the rest there is no way to tell — do not compare these numbers to the live tabs.
            </p>
            <label class="analytics-admin-toggle">
                <input type="checkbox" id="history-hide-mine"${hideMine ? ' checked' : ''}>
                Hide events that are provably mine
            </label>
        </div>
        <div class="dashboard-cards" id="history-kpis"></div>
        <div id="history-sections"></div>`;

    panel.querySelector('#history-hide-mine').addEventListener('change', (e) => onToggle(e.target.checked));

    panel.querySelector('#history-kpis').innerHTML = [
        { label: 'Pageviews', value: data.total_pageviews },
        { label: 'Avg. dwell time', value: formatMs(data.avg_dwell_ms) },
        { label: 'Bounce rate', value: `${data.bounce_pct}%` },
    ].map((c) => `
        <div class="dash-card">
            <div class="dash-card-label">${escapeHtml(c.label)}</div>
            <div class="dash-card-value">${c.value}</div>
        </div>`).join('');

    const host = panel.querySelector('#history-sections');
    const add = (title, inner) => {
        const s = makeSection(title);
        s.innerHTML += inner;
        host.appendChild(s);
        return s;
    };

    const tsSection = add('Pageviews over time', `<div id="history-timeseries"></div>`);
    drawBarChart(tsSection.querySelector('#history-timeseries'),
        (data.timeseries || []).map((t) => ({
            day: new Date(`${t.day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            views: t.views,
        })), { labelKey: 'day', valueKey: 'views' });

    const heat = add('Traffic by day & hour', `<div id="history-heatmap"></div>`);
    drawDateHeatmap(heat.querySelector('#history-heatmap'), data.by_hour_day, 'day');

    const cont = add('Content', `
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
            <div style="flex:1;min-width:220px"><h4>Top pages</h4><div id="history-pages"></div></div>
            <div style="flex:1;min-width:220px"><h4>Top leagues</h4><div id="history-leagues"></div></div>
            <div style="flex:1;min-width:220px"><h4>Top players</h4><div id="history-players"></div></div>
        </div>`);
    renderMfTable(cont.querySelector('#history-pages'), (data.top_pages || []).map((p) => ({ ...p, page: pageLabel(p.page) })), [{ key: 'page', label: 'Page' }, { key: 'views', label: 'Views' }]);
    renderMfTable(cont.querySelector('#history-leagues'), data.top_leagues, [{ key: 'league_id', label: 'League' }, { key: 'views', label: 'Views' }]);
    renderMfTable(cont.querySelector('#history-players'), data.top_players, [{ key: 'player', label: 'Player' }, { key: 'views', label: 'Views' }]);

    const clicks = add('All clicks & interactions', `
        <div class="analytics-time-filter">
            <label>From <input type="datetime-local" id="history-clicks-from"></label>
            <label>To <input type="datetime-local" id="history-clicks-to"></label>
        </div>
        <div id="history-clicks"></div>`);
    // Own selectors, so the ids never collide with the live Activity tab's log.
    mountFilteredLog(clicks, {
        hostSel: '#history-clicks',
        fromSel: '#history-clicks-from',
        toSel: '#history-clicks-to',
        emptyWindowText: 'No clicks in this time window.',
        rows: (data.clicks_log || []).map((c) => ({
            date: new Date(c.created_at),
            page: contextLabel(c.page, c.league_id, c.player),
            target: c.click_target || '',
            icon: clickIcon(c.click_target || ''),
            device: c.device_type || 'unknown',
        })),
        // No Session ID column: these rows never had one.
        columns: clickColumns(),
    });

    host.querySelectorAll('.app-section').forEach((s) => wireSectionCollapse(s, { defaultOpen: true }));
}

// Distinguishes "you are not authenticated" (→ show the login gate) from any
// other RPC failure (→ surface verbatim). PostgREST returns 42501 /
// "permission denied for function ..." when an anon role hits an
// authenticated-only function; an expired JWT reads as 401 / a JWT message. A
// missing function (unmigrated DB) is 42883 / "could not find" and must NOT be
// treated as auth — it needs the raw message so the operator runs the migration.
const isAuthError = (e) => /permission denied|jwt|not authenticated|unauthorized|\b401\b|42501/i
    .test(`${e?.message || ''} ${e?.code || ''} ${e?.hint || ''}`);

/** Inline login for the analytics page (which has no nav and no login UI of its
 *  own — see analytics.html). Reuses the site's existing `.admin-login-modal`
 *  chrome (already loaded via css/admin.css) and the shared `login()` from
 *  auth.js, but stays IN PLACE on success (re-renders the dashboard) instead of
 *  redirecting to admin.html the way the gear-button modal does — the whole
 *  point here is to land the operator on the analytics they asked for. */
function renderLoginGate(content, monthKeyArg, excludeAdmin) {
    content.innerHTML = `
        <div class="admin-login-modal" style="margin:8vh auto 0;max-width:360px">
            <h2 class="admin-login-modal-title">Admin Login</h2>
            <p class="muted" style="margin-top:0">The analytics dashboard is authenticated-only. Sign in to continue.</p>
            <div id="analytics-login-msg"></div>
            <div class="form-group">
                <label for="analytics-login-user">Email</label>
                <input type="email" id="analytics-login-user" autocomplete="username">
            </div>
            <div class="form-group">
                <label for="analytics-login-pass">Password</label>
                <input type="password" id="analytics-login-pass" autocomplete="current-password">
            </div>
            <button class="btn btn-primary btn-block" id="analytics-login-btn">Login</button>
        </div>`;

    const userInput = content.querySelector('#analytics-login-user');
    const passInput = content.querySelector('#analytics-login-pass');
    const btn = content.querySelector('#analytics-login-btn');
    const msg = content.querySelector('#analytics-login-msg');
    const say = (text) => { msg.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(text)}</div>`; };
    userInput.focus();

    const doLogin = async () => {
        const email = userInput.value.trim();
        const pass = passInput.value;
        if (!email || !pass) { say('Please enter email and password.'); return; }
        btn.disabled = true;
        btn.textContent = 'Logging in…';
        const ok = await login(email, pass);
        if (ok) {
            // Same origin, so the session auth.js just cached is the one the RPC
            // will now send. Re-enter with the caller's original view intent.
            renderAnalyticsPage(monthKeyArg, excludeAdmin);
        } else {
            btn.disabled = false;
            btn.textContent = 'Login';
            say('Invalid email or password.');
        }
    };
    btn.addEventListener('click', doLogin);
    userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

// The two view controls (which month, and whether to exclude the operator's own
// traffic) persist across a refresh. localStorage, not the URL: it matches the
// site's other persisted UI (css bootstrap reads shabi-theme the same way), and
// unlike the ?tab= deep-link these two are a personal default, not something you
// share. Reads are defensive — a corrupt/absent value just falls back.
const VIEW_STORE_KEY = 'shabi-analytics-view';
function loadView() {
    try { return JSON.parse(localStorage.getItem(VIEW_STORE_KEY)) || {}; } catch { return {}; }
}
function saveView(monthKeyValue, excludeAdmin) {
    try { localStorage.setItem(VIEW_STORE_KEY, JSON.stringify({ month: monthKeyValue, excludeAdmin })); } catch { /* private mode / quota — persistence is best-effort */ }
}

// Default param evaluates ONLY when the arg is undefined — i.e. a fresh page
// load, never a control-driven re-render (those always pass an explicit boolean).
// `?? true` keeps a stored `false` intact (nullish, not falsy) and only defaults
// when nothing was ever saved.
export async function renderAnalyticsPage(monthKeyArg = null, excludeAdmin = loadView().excludeAdmin ?? true) {
    const content = document.getElementById('content');

    // The RPCs are authenticated-only (see header). A Supabase session lives in
    // localStorage PER ORIGIN, so being logged in on the live domain does NOT
    // carry to a 127.0.0.2 / localhost preview — that different origin has no
    // session and every call comes back "permission denied". Rather than dump
    // the raw SQL error, gate the page with an inline login; on success we
    // re-render in place (same origin, so the new session persists for next time).
    if (!isLoggedIn()) {
        renderLoginGate(content, monthKeyArg, excludeAdmin);
        return;
    }

    content.innerHTML = '<div class="loading">Loading analytics...</div>';

    const { data: months, error: monthsError } = await supabase.rpc('analytics_months');
    if (monthsError) {
        // A live session can still expire mid-use: a permission/JWT error means
        // "not really authenticated", so fall back to the same gate. A "function
        // does not exist" error is different — the DB is missing the migration —
        // and must surface verbatim so it can be acted on, not hidden behind login.
        if (isAuthError(monthsError)) { renderLoginGate(content, monthKeyArg, excludeAdmin); return; }
        content.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(monthsError.message)}</div>`;
        return;
    }

    // analytics_months() is already ordered newest-first.
    const monthRows = months || [];
    // Always open on the CURRENT calendar month (Israel time) — the operator
    // asked for "this month" on every open, not the newest month that happens to
    // hold data, and not a remembered last-viewed month. An explicit control
    // change (monthKeyArg, from the picker or the admin toggle) still wins. The
    // current month may have no rows yet; it is force-added as a picker option
    // below so the select shows it and its panels say "No data yet".
    const currentMonthKey = new Date()
        .toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7); // "YYYY-MM"
    const activeKey = monthKeyArg || currentMonthKey;
    // Persist the exclude-admin choice (loadView feeds its default); the month is
    // deliberately NOT restored across loads — see above.
    saveView(activeKey, excludeAdmin);
    const { from, to } = israelMonthRange(activeKey);

    // Live tabs are new-format only. Legacy rows predate the route model and
    // would otherwise drown every panel (they are ~98% of the table today);
    // they live in the History tab instead.
    const { data, error } = await supabase.rpc('analytics_summary', {
        from_date: from.toISOString(),
        to_date: to.toISOString(),
        exclude_admin: excludeAdmin,
        scope: 'new',
    });

    if (error) {
        content.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(error.message)}</div>`;
        return;
    }

    // League id → {title, type} for the log context labels, plus the player
    // title/flag caches the rich entity render reads. All loaded once (none
    // change mid-session); every failure is non-fatal — the labels degrade to the
    // raw id / no-flag / no-badge rather than throwing. Not awaited on re-renders.
    if (!_leagueMetaLoaded) {
        const [{ data: leagues }] = await Promise.all([
            supabase.from('leagues').select('id, league_type'), // no `title` — column retired
            primeTitleMeta().catch(() => {}),   // players_metadata → titleHtmlFor()
            ensurePlayerIndex().catch(() => {}), // custom flags → getPlayerFlagCode()
        ]);
        for (const l of leagues || []) _leagueMeta.set(l.id, { type: l.league_type });
        _leagueMetaLoaded = true;
    }

    const fetchedAt = new Date();
    content.innerHTML = '';

    // ── KPI cards (includes "Last Updated" = when THIS refresh actually queried Supabase) ──
    const cardsHost = document.createElement('div');
    cardsHost.className = 'dashboard-cards';
    content.appendChild(cardsHost);
    renderKpiCards(cardsHost, data, fetchedAt);

    // ── Range control — themed like the desktop player-search pill ──
    const rangeBar = document.createElement('div');
    rangeBar.className = 'analytics-range-bar';
    const select = document.createElement('select');
    select.id = 'analytics-range';
    select.className = 'analytics-range-select';
    const monthOpts = monthRows.map((m) => monthKey(m.month));
    // The current month is the default but may not yet have any events, so
    // analytics_months() can omit it — add it at the front (newest) so the
    // picker still offers it. monthRows is newest-first, so if present it's
    // already here and this is a no-op.
    if (!monthOpts.includes(currentMonthKey)) monthOpts.unshift(currentMonthKey);
    select.innerHTML = [...monthOpts, ALL_TIME]
        .map((k) => `<option value="${k}"${k === activeKey ? ' selected' : ''}>${escapeHtml(monthLabel(k))}</option>`)
        .join('');
    select.addEventListener('change', () => renderAnalyticsPage(select.value, excludeAdmin));
    rangeBar.appendChild(select);

    // Default ON. This is the whole point of admin_user: without it every KPI,
    // chart and top-list on this page counts the operator's own browsing as
    // audience. The label says "my own" rather than "internal" because the
    // column can only ever name the person reading this page.
    const adminToggle = document.createElement('label');
    adminToggle.className = 'analytics-admin-toggle';
    adminToggle.innerHTML = `<input type="checkbox" id="analytics-exclude-admin"${excludeAdmin ? ' checked' : ''}> Exclude my own traffic`;
    adminToggle.querySelector('input').addEventListener('change', (e) => renderAnalyticsPage(activeKey, e.target.checked));
    rangeBar.appendChild(adminToggle);
    content.appendChild(rangeBar);

    // ── Tabs (same chrome as the League Dashboard — mountAppTabs) ──
    // One tab per analyst question, ordered by resolution: population → cut by
    // who → cut by what → session → event. "Traffic Patterns" is deliberately
    // gone: a day×hour heatmap and a dwell histogram never answered the same
    // question, so they moved to Overview and Content respectively.
    const shell = mountAppTabs({
        tabs: [
            { id: 'overview', label: 'Overview', icon: '📈' },
            { id: 'audience', label: 'Audience', icon: '🌍' },
            { id: 'content', label: 'Content', icon: '📄' },
            { id: 'journeys', label: 'Journeys', icon: '👣' },
            { id: 'activity', label: 'Activity', icon: '🖱️' },
            { id: 'history', label: 'History', icon: '🗄️' },
        ],
        urlKey: 'tab',
        ariaLabel: 'Analytics sections',
        shellClass: 'analytics-tabs-shell',
        panelClass: 'analytics-tab-panel',
    });
    content.appendChild(shell.root);

    // ── Overview: what this is made of, how much of it, and when ──
    const mixSection = makeSection('Traffic composition');
    mixSection.innerHTML += `<div id="chart-mix"></div><p class="analytics-mix-note" id="mix-note"></p>`;
    shell.panels.overview.appendChild(mixSection);
    renderTrafficMix(mixSection, data.traffic_mix, excludeAdmin);

    // "Traffic over time" — a Pageviews ↔ Sessions toggle over the same daily
    // buckets. Both come from data.timeseries (views + sessions per day); the
    // note under the toggle explains what the active metric counts, since
    // "traffic" is ambiguous between "pages served" and "visits".
    const tsSection = makeSection('Traffic over time');
    tsSection.insertAdjacentHTML('beforeend', `
        <div class="analytics-metric-toggle" role="group" aria-label="Traffic metric">
            <button type="button" class="analytics-metric-btn is-active" data-metric="views">Pageviews</button>
            <button type="button" class="analytics-metric-btn" data-metric="sessions">Sessions</button>
        </div>
        <p class="analytics-mix-note" id="ts-metric-note"></p>
        <div id="chart-timeseries"></div>`);
    shell.panels.overview.appendChild(tsSection);
    const tsChart = tsSection.querySelector('#chart-timeseries');
    const tsNote = tsSection.querySelector('#ts-metric-note');
    const timeseries = (data.timeseries || []).map((t) => ({
        day: new Date(`${t.day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        views: t.views,
        sessions: t.sessions ?? 0,
    }));
    const TS_METRIC_NOTES = {
        views: 'Pageviews — every page load is counted, so one visitor who opens several pages adds several. This is the current default: the raw volume of pages served.',
        sessions: 'Sessions — one per visit, however many pages it viewed, so it reads closer to "how many people came". Israel-route visits only (global visitors stay anonymous and are not grouped into sessions), so this line sits at or below Pageviews.',
    };
    const drawTs = (metric) => {
        drawBarChart(tsChart, timeseries, { labelKey: 'day', valueKey: metric });
        tsNote.textContent = TS_METRIC_NOTES[metric];
    };
    tsSection.querySelectorAll('.analytics-metric-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            tsSection.querySelectorAll('.analytics-metric-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
            drawTs(btn.dataset.metric);
        });
    });
    drawTs('views');

    // A single month is at most 31 days, so the daily grid is always readable;
    // only All time needs the monthly grid.
    const granularity = activeKey === ALL_TIME ? 'month' : 'day';
    const heatmapSection = makeSection('Traffic by day & hour');
    heatmapSection.innerHTML += `<div id="heatmap-traffic"></div>`;
    shell.panels.overview.appendChild(heatmapSection);
    drawDateHeatmap(heatmapSection.querySelector('#heatmap-traffic'),
        granularity === 'month' ? data.by_hour_month : data.by_hour_day, granularity);

    // ── Audience: who they are and where they came from ──
    const regionSection = makeSection('By region');
    regionSection.innerHTML += `<div id="chart-region"></div>
        <p class="analytics-mix-note">Global route only — visits from an Asia/Jerusalem timezone
        carry no region by design, so they are absent here rather than missing.</p>`;
    shell.panels.audience.appendChild(regionSection);
    drawBarChart(regionSection.querySelector('#chart-region'), data.by_region, { labelKey: 'region', valueKey: 'views' });

    const breakdownSection = makeSection('Device & referrer breakdown');
    breakdownSection.innerHTML += `
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
            <div class="admin-card" style="flex:1;min-width:260px">
                <h4>Device</h4>
                <div id="chart-device"></div>
            </div>
            <div class="admin-card" style="flex:1;min-width:260px">
                <h4>Referrer</h4>
                <div id="chart-referrer"></div>
            </div>
        </div>`;
    shell.panels.audience.appendChild(breakdownSection);
    drawBarChart(breakdownSection.querySelector('#chart-device'), data.by_device, { labelKey: 'device_type', valueKey: 'views' });
    drawBarChart(breakdownSection.querySelector('#chart-referrer'), data.by_referrer, { labelKey: 'referrer_kind', valueKey: 'views' });

    // ── Content: top pages/leagues/players, then engagement per page ──
    const contentSection = makeSection('Content');
    contentSection.innerHTML += `
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
            <div style="flex:1;min-width:220px">
                <h4>Top pages</h4>
                <div id="table-pages"></div>
            </div>
            <div style="flex:1;min-width:220px">
                <h4>Top leagues</h4>
                <div id="table-leagues"></div>
            </div>
            <div style="flex:1;min-width:220px">
                <h4>Top players</h4>
                <div id="table-players"></div>
            </div>
        </div>`;
    shell.panels.content.appendChild(contentSection);
    renderMfTable(contentSection.querySelector('#table-pages'), (data.top_pages || []).map((p) => ({ ...p, page: pageLabel(p.page) })), [{ key: 'page', label: 'Page' }, { key: 'views', label: 'Views' }]);
    renderMfTable(contentSection.querySelector('#table-leagues'), data.top_leagues, [{ key: 'league_id', label: 'League' }, { key: 'views', label: 'Views' }]);
    renderMfTable(contentSection.querySelector('#table-players'), data.top_players, [{ key: 'player', label: 'Player' }, { key: 'views', label: 'Views' }]);

    // Engagement per page is a property of the CONTENT, not of the clock — it
    // sat beside the day×hour heatmap only because both were called "patterns".
    const dwellSection = makeSection('Dwell time by page');
    const dwellHost = document.createElement('div');
    dwellHost.id = 'dwell-buckets';
    dwellHost.style.cssText = 'display:flex;gap:var(--space-md);flex-wrap:wrap';
    dwellSection.appendChild(dwellHost);
    shell.panels.content.appendChild(dwellSection);
    renderDwellBuckets(dwellHost, data.dwell_buckets);

    // ── Journeys: how visits move (session resolution) ──
    // Sessions are the real thing; the flows aggregate is what the global route
    // gets instead, since those events can never be linked into a visit.
    // "most recent 200" is in the title because the Sessions KPI counts every
    // visit in range and the two will disagree once traffic passes the cap.
    const sessionsSection = makeSection('Sessions from Israel (most recent 200)');
    sessionsSection.innerHTML += `<div id="sessions-list"></div>`;
    shell.panels.journeys.appendChild(sessionsSection);
    renderSessions(sessionsSection, data.sessions);

    const flowsSection = makeSection('Top navigation flows');
    flowsSection.innerHTML += `<div id="table-flows"></div>
        <p class="analytics-mix-note">Aggregated from the browser's own referrer on independent
        pageviews — an A→B count, not a trace of one visitor. Covers both routes, so this is the
        only navigation signal that exists for global-route traffic.</p>`;
    shell.panels.journeys.appendChild(flowsSection);
    renderFlows(flowsSection, data.transitions);

    // ── Activity: the raw event log (event resolution) ──
    const clicksLogSection = makeSection('All clicks & interactions');
    clicksLogSection.innerHTML += `
        <div class="analytics-clicks-search">
            <input type="text" id="clicks-log-search" class="analytics-clicks-search-input app-search-input"
                   placeholder="Search a click… (browse all to see counts)" autocomplete="off"
                   aria-label="Search clicks by target">
        </div>
        <div class="analytics-time-filter">
            <label>From <input type="datetime-local" id="clicks-log-from"></label>
            <label>To <input type="datetime-local" id="clicks-log-to"></label>
        </div>
        <div id="table-clicks-log"></div>`;
    shell.panels.activity.appendChild(clicksLogSection);
    renderClicksLog(clicksLogSection, data.clicks_log, data.sessions);

    const transitionsLogSection = makeSection('All page-to-page transitions');
    transitionsLogSection.innerHTML += `
        <div class="analytics-time-filter">
            <label>From <input type="datetime-local" id="transitions-log-from"></label>
            <label>To <input type="datetime-local" id="transitions-log-to"></label>
        </div>
        <div id="table-transitions-log"></div>`;
    shell.panels.activity.appendChild(transitionsLogSection);
    renderTransitionsLog(transitionsLogSection, data.transitions_log);

    // ── History: the pre-format archive, fetched only if opened ──
    mountHistoryTab(shell, from, to);

    content.querySelectorAll('.app-section').forEach((s) => wireSectionCollapse(s, { defaultOpen: true }));
}
