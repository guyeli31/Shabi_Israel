/**
 * analyticsPage.js — Reads the analytics_summary() RPC and renders it.
 * Not a public nav destination — reached only by direct URL (analytics.html).
 * Read path only; the RPC is SECURITY DEFINER and returns aggregates only,
 * never raw analytics_events rows (see sql/analytics_poc.sql) — there is no
 * session identifier anywhere in this system, so there is no per-visit view
 * to build here even in principle; everything below is a population-level
 * statistic, never a trace of one visitor.
 *
 * Sections/tables follow the same conventions as the production pages
 * (`.app-section`/wireSectionCollapse from css/sections.css, MF table format
 * from table-lab/formats/mf/mf.css) instead of the generic admin look.
 */

import { supabase } from '../data/supabaseClient.js';
import { escapeHtml } from '../utils/sanitize.js';
import { wireSectionCollapse } from './sectionCollapse.js';
import { mountAppTabs } from './appTabs.js';
import { TAB_ICONS } from './tabIcons.js';

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
// League IDs are folder names (e.g. "Shabi Israel July 2026" — see CLAUDE.md's
// "Key Conventions"); stripping the fixed "Shabi Israel " prefix leaves the
// short display form ("July 2026") already used elsewhere in the site's own
// nav (js/render/siteSidebar.js's league menu entries).
const shortLeague = (leagueId) => (leagueId ? leagueId.replace(/^Shabi Israel /, '') : leagueId);
const contextLabel = (page, leagueId, player) => {
    if (page === 'player_league' && player) {
        return `Player in league (${player}${leagueId ? ', ' + shortLeague(leagueId) : ''})`;
    }
    const base = pageLabel(page);
    if (player) return `${base} (${player})`;
    if (leagueId) return `${base} (${leagueId})`;
    return base;
};

const RANGE_OPTIONS = [
    { key: '30d', label: 'Last 30 days', days: 30, granularity: 'day' },
    { key: '3m', label: 'Last 3 months', days: 90, granularity: 'month' },
    { key: '6m', label: 'Last 6 months', days: 182, granularity: 'month' },
    { key: '12m', label: 'Last 12 months', days: 365, granularity: 'month' },
];

function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Exact "Last Updated" convention used by the League Dashboard's own card. */
function formatLastUpdated(dateOrNull) {
    if (!dateOrNull) return 'N/A';
    const opts = { timeZone: 'Asia/Jerusalem' };
    return dateOrNull.toLocaleDateString('en-GB', { ...opts, day: '2-digit', month: 'short', year: 'numeric' })
        + ' ' + dateOrNull.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit' });
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

/** Chronological, un-aggregated, click-to-sort log of every transition —
 *  same From/To pair repeats across rows on purpose (each occurrence is its
 *  own row); `running_count` is that pair's cumulative count so far. Rows
 *  are tinted by device type, reusing the site's existing per-theme medal
 *  tint tokens (already themed across all 8 themes, no new tokens needed).
 *  `section` must contain #transitions-log-from/#transitions-log-to (the
 *  time-window filter inputs) and #table-transitions-log (the table host). */
function renderTransitionsLog(section, transitionsLog) {
    const host = section.querySelector('#table-transitions-log');
    const fromInput = section.querySelector('#transitions-log-from');
    const toInput = section.querySelector('#transitions-log-to');

    const allRows = (transitionsLog || []).map((t) => ({
        date: new Date(t.created_at),
        from: contextLabel(t.from_page, t.from_league_id, t.from_player),
        to: contextLabel(t.to_page, t.to_league_id, t.to_player),
        device: t.device_type || 'unknown',
        count: t.running_count,
    }));

    if (allRows.length === 0) {
        fromInput.disabled = true;
        toInput.disabled = true;
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

    const columns = [
        { key: 'date', label: 'Date' },
        { key: 'from', label: 'From' },
        { key: 'to', label: 'To' },
        { key: 'device', label: 'Device' },
        { key: 'count', label: 'Count' },
    ];
    let sortKey = 'date';
    let sortDir = 'desc'; // newest first by default

    function draw() {
        const fromTime = fromInput.value ? new Date(fromInput.value).getTime() : -Infinity;
        const toTime = toInput.value ? new Date(toInput.value).getTime() : Infinity;
        const rows = allRows.filter((r) => r.date.getTime() >= fromTime && r.date.getTime() <= toTime);

        const sorted = [...rows].sort((a, b) => {
            let av = a[sortKey];
            let bv = b[sortKey];
            if (av instanceof Date) { av = av.getTime(); bv = bv.getTime(); }
            else if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        if (sorted.length === 0) {
            host.innerHTML = '<p class="muted">No transitions in this time window.</p>';
            return;
        }

        const theadHtml = columns.map((c) => {
            const arrow = c.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            return `<th scope="col" data-sort-key="${c.key}" style="cursor:pointer">${escapeHtml(c.label)}${arrow}</th>`;
        }).join('');

        const rowsHtml = sorted.map((r) => `
            <tr class="device-${escapeHtml(r.device)}">
                <td>${escapeHtml(formatLastUpdated(r.date))}</td>
                <td>${escapeHtml(r.from)}</td>
                <td>${escapeHtml(r.to)}</td>
                <td>${escapeHtml(r.device)}</td>
                <td>${r.count}</td>
            </tr>`).join('');

        host.innerHTML = `
            <div class="mf-wrap">
                <table class="dash-table font-small" id="transitions-log-table">
                    <thead><tr>${theadHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;

        host.querySelectorAll('th[data-sort-key]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                else { sortKey = key; sortDir = 'asc'; }
                draw();
            });
        });
    }

    fromInput.addEventListener('change', draw);
    toInput.addEventListener('change', draw);
    draw();
}

// Fixed icon per click_target TYPE prefix (js/analytics.js's own
// classification) — purely a display affordance in the "All clicks" table,
// never stored. "League link: " is a plain content link like any other, so
// it shares the generic Link icon rather than a distinct one.
const CLICK_TYPE_ICONS = [
    { prefix: 'What if: ', icon: '🧪' },
    { prefix: 'Export: ', icon: '🖼️' },
    { prefix: 'Search: ', icon: '🔍' },
    { prefix: 'Action: ', icon: '💾' },
    { prefix: 'Player link: ', icon: '🔗' },
    { prefix: 'League link: ', icon: '🔗' },
    { prefix: 'Link: ', icon: '🔗' },
];

// Logout's icon is an inline SVG defined directly on its own button (not in
// the shared ICON map — js/admin/render/adminSidebarNav.js /
// js/render/siteSidebar.js both use this same markup), so it's copied here
// rather than referenced.
const LOGOUT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>';

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
};

/** Best-effort icon for a click_target string. Rows recorded before this
 *  prefix convention existed (no recognised prefix at all) fall back to a
 *  generic click glyph. */
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
        return MENU_LABEL_ICONS[label] || '';
    }
    const match = CLICK_TYPE_ICONS.find((c) => target.startsWith(c.prefix));
    return match ? match.icon : '🖱️';
}

/** Chronological, click-to-sort log of every click/interaction event (Export
 *  Image, Run Simulation with its staged summary, search outcomes, link
 *  clicks). Same shape/behaviour as renderTransitionsLog (device-tinted rows,
 *  default From/To window = dawn of history → now on every refresh), but
 *  flat (no from/to pair, no running count) since click_target text is often
 *  unique per row rather than a small repeating set. `section` must contain
 *  #clicks-log-from/#clicks-log-to and #table-clicks-log. */
function renderClicksLog(section, clicksLog) {
    const host = section.querySelector('#table-clicks-log');
    const fromInput = section.querySelector('#clicks-log-from');
    const toInput = section.querySelector('#clicks-log-to');

    const allRows = (clicksLog || []).map((c) => ({
        date: new Date(c.created_at),
        page: contextLabel(c.page, c.league_id, c.player),
        target: c.click_target || '',
        device: c.device_type || 'unknown',
    }));

    if (allRows.length === 0) {
        fromInput.disabled = true;
        toInput.disabled = true;
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }

    const toLocalInputValue = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    fromInput.value = toLocalInputValue(new Date(0));
    toInput.value = toLocalInputValue(new Date());

    const columns = [
        { key: 'date', label: 'Date' },
        { key: 'page', label: 'Page' },
        { key: 'target', label: 'Click target' },
        { key: 'device', label: 'Device' },
    ];
    let sortKey = 'date';
    let sortDir = 'desc';

    function draw() {
        const fromTime = fromInput.value ? new Date(fromInput.value).getTime() : -Infinity;
        const toTime = toInput.value ? new Date(toInput.value).getTime() : Infinity;
        const rows = allRows.filter((r) => r.date.getTime() >= fromTime && r.date.getTime() <= toTime);

        const sorted = [...rows].sort((a, b) => {
            let av = a[sortKey];
            let bv = b[sortKey];
            if (av instanceof Date) { av = av.getTime(); bv = bv.getTime(); }
            else if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        if (sorted.length === 0) {
            host.innerHTML = '<p class="muted">No clicks in this time window.</p>';
            return;
        }

        const theadHtml = columns.map((c) => {
            const arrow = c.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            return `<th scope="col" data-sort-key="${c.key}" style="cursor:pointer">${escapeHtml(c.label)}${arrow}</th>`;
        }).join('');

        const rowsHtml = sorted.map((r) => {
            const icon = clickIcon(r.target);
            return `
            <tr class="device-${escapeHtml(r.device)}">
                <td>${escapeHtml(formatLastUpdated(r.date))}</td>
                <td>${escapeHtml(r.page)}</td>
                <td>${icon ? icon + ' ' : ''}${escapeHtml(r.target)}</td>
                <td>${escapeHtml(r.device)}</td>
            </tr>`;
        }).join('');

        host.innerHTML = `
            <div class="mf-wrap">
                <table class="dash-table font-small" id="clicks-log-table">
                    <thead><tr>${theadHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;

        host.querySelectorAll('th[data-sort-key]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                else { sortKey = key; sortDir = 'asc'; }
                draw();
            });
        });
    }

    fromInput.addEventListener('change', draw);
    toInput.addEventListener('change', draw);
    draw();
}

function renderKpiCards(host, data, fetchedAt) {
    const cards = [
        { label: 'Pageviews', value: data.total_pageviews },
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

export async function renderAnalyticsPage(rangeKey = '30d') {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="loading">Loading analytics...</div>';

    const range = RANGE_OPTIONS.find((r) => r.key === rangeKey) || RANGE_OPTIONS[0];
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - range.days * DAY_MS);

    const { data, error } = await supabase.rpc('analytics_summary', {
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
    });

    if (error) {
        content.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(error.message)}</div>`;
        return;
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
    select.innerHTML = RANGE_OPTIONS.map((r) => `<option value="${r.key}" ${r.key === range.key ? 'selected' : ''}>${r.label}</option>`).join('');
    select.addEventListener('change', () => renderAnalyticsPage(select.value));
    rangeBar.appendChild(select);
    content.appendChild(rangeBar);

    // ── Tabs (same chrome as the League Dashboard — mountAppTabs) ──
    const shell = mountAppTabs({
        tabs: [
            { id: 'overview', label: 'Overview', icon: '📈' },
            { id: 'traffic', label: 'Traffic Patterns', icon: '🕒' },
            { id: 'content', label: 'Content', icon: '📄' },
            { id: 'behavior', label: 'Behavior', icon: '🖱️' },
        ],
        urlKey: 'tab',
        ariaLabel: 'Analytics sections',
        shellClass: 'analytics-tabs-shell',
        panelClass: 'analytics-tab-panel',
    });
    content.appendChild(shell.root);

    // ── Overview: Pageviews over time + device/referrer breakdown ──
    const tsSection = makeSection('Pageviews over time');
    const tsChart = document.createElement('div');
    tsChart.id = 'chart-timeseries';
    tsSection.appendChild(tsChart);
    shell.panels.overview.appendChild(tsSection);
    const timeseries = (data.timeseries || []).map((t) => ({
        day: new Date(`${t.day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        views: t.views,
    }));
    drawBarChart(tsChart, timeseries, { labelKey: 'day', valueKey: 'views' });

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
    shell.panels.overview.appendChild(breakdownSection);
    drawBarChart(breakdownSection.querySelector('#chart-device'), data.by_device, { labelKey: 'device_type', valueKey: 'views' });
    drawBarChart(breakdownSection.querySelector('#chart-referrer'), data.by_referrer, { labelKey: 'referrer_kind', valueKey: 'views' });

    // ── Traffic Patterns: day/hour heatmap, then dwell time (bottom section) ──
    const heatmapSection = makeSection('Traffic by day & hour');
    heatmapSection.innerHTML += `<div id="heatmap-traffic"></div>`;
    shell.panels.traffic.appendChild(heatmapSection);
    const heatmapRows = range.granularity === 'month' ? data.by_hour_month : data.by_hour_day;
    drawDateHeatmap(heatmapSection.querySelector('#heatmap-traffic'), heatmapRows, range.granularity);

    const dwellSection = makeSection('Dwell time by page');
    const dwellHost = document.createElement('div');
    dwellHost.id = 'dwell-buckets';
    dwellHost.style.cssText = 'display:flex;gap:var(--space-md);flex-wrap:wrap';
    dwellSection.appendChild(dwellHost);
    shell.panels.traffic.appendChild(dwellSection);
    renderDwellBuckets(dwellHost, data.dwell_buckets);

    // ── Content: top pages/leagues/players ──
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

    const transitionsLogSection = makeSection('All page-to-page transitions');
    transitionsLogSection.innerHTML += `
        <div class="analytics-time-filter">
            <label>From <input type="datetime-local" id="transitions-log-from"></label>
            <label>To <input type="datetime-local" id="transitions-log-to"></label>
        </div>
        <div id="table-transitions-log"></div>`;
    shell.panels.content.appendChild(transitionsLogSection);
    renderTransitionsLog(transitionsLogSection, data.transitions_log);

    // ── Behavior: clicks & interactions ──
    const clicksLogSection = makeSection('All clicks & interactions');
    clicksLogSection.innerHTML += `
        <div class="analytics-time-filter">
            <label>From <input type="datetime-local" id="clicks-log-from"></label>
            <label>To <input type="datetime-local" id="clicks-log-to"></label>
        </div>
        <div id="table-clicks-log"></div>`;
    shell.panels.behavior.appendChild(clicksLogSection);
    renderClicksLog(clicksLogSection, data.clicks_log);

    content.querySelectorAll('.app-section').forEach((s) => wireSectionCollapse(s, { defaultOpen: true }));
}
