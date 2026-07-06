/**
 * analyticsPage.js — Reads the analytics_summary() RPC and renders it.
 * Not a public nav destination — reached only by direct URL (analytics.html).
 * Read path only; the RPC is SECURITY DEFINER and returns aggregates only,
 * never raw analytics_events rows (see sql/analytics_poc.sql) — there is no
 * session identifier anywhere in this system, so there is no per-visit view
 * to build here even in principle; everything below is a population-level
 * statistic, never a trace of one visitor.
 */

import { supabase } from '../data/supabaseClient.js';
import { escapeHtml } from '../utils/sanitize.js';
import { mountAppTabs } from './appTabs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DWELL_BUCKET_ORDER = ['<10s', '10-30', '30-60', '1-5m', '5m+'];
const PAGE_LABELS = {
    landing: 'Home',
    league: 'League Dashboard',
    league_table: 'League Table',
    player: 'Player',
    player_league: 'Player History',
};
const pageLabel = (p) => PAGE_LABELS[p] || p;

function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Simple canvas bar chart — host div + canvas, matching the site's existing
 *  "draw into a host div" pattern (js/render/playerBarChart.js) at a smaller scale. */
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

    // Dense charts (e.g. a 30-day timeseries) would otherwise overlap every
    // label into an unreadable smear — thin them out to roughly one per
    // 40px of bar width instead of forcing every single one.
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

/** Day-of-week x hour-of-day traffic heatmap. Purely aggregate counts — no
 *  correlation to any individual visit, just "how many pageviews land in this
 *  hour/day bucket overall". */
function drawHeatmap(host, rows) {
    host.innerHTML = '';
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of rows || []) {
        if (r.dow >= 0 && r.dow < 7 && r.hour >= 0 && r.hour < 24) grid[r.dow][r.hour] = r.views;
    }
    const max = Math.max(...grid.flat(), 1);

    const style = getComputedStyle(document.documentElement);
    const accent = (style.getPropertyValue('--color-accent') || '#4a90d9').trim();
    const textColor = (style.getPropertyValue('--color-text') || '#333').trim();

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
    for (let d = 0; d < 7; d++) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = DOW_LABELS[d];
        tr.appendChild(th);
        for (let h = 0; h < 24; h++) {
            const td = document.createElement('td');
            const v = grid[d][h];
            const alpha = v === 0 ? 0 : 0.12 + 0.88 * (v / max);
            td.style.backgroundColor = v === 0 ? 'transparent' : hexToRgba(accent, alpha);
            td.style.color = textColor;
            td.title = `${DOW_LABELS[d]} ${h}:00 — ${v} view${v === 1 ? '' : 's'}`;
            if (v > 0) td.textContent = v;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);
}

function hexToRgba(color, alpha) {
    // Accepts #rgb/#rrggbb; falls back to a flat accent blue if parsing fails.
    const hex = color.replace('#', '');
    if (![3, 6].includes(hex.length)) return `rgba(74,144,217,${alpha})`;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function renderTable(host, items, columns) {
    if (!items || items.length === 0) {
        host.innerHTML = '<p class="muted">No data yet.</p>';
        return;
    }
    const rows = items.map((item) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(item[c.key] ?? ''))}</td>`).join('')}</tr>`
    ).join('');
    host.innerHTML = `
        <table class="admin-table">
            <thead><tr>${columns.map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderKpiCards(host, data) {
    const cards = [
        { label: 'Pageviews (30d)', value: data.total_pageviews },
        { label: 'Avg. dwell time', value: formatMs(data.avg_dwell_ms) },
        { label: 'Bounce rate', value: `${data.bounce_pct}%` },
    ];
    host.innerHTML = cards.map((c) => `
        <div class="dash-card">
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
    // Two passes: attach every card first, then measure/draw. Reading
    // clientWidth mid-loop (draw right after each card is inserted) sees a
    // flex row that hasn't settled on its final per-item width yet — each
    // canvas would bake in whatever stale width existed when *that* card was
    // inserted, then silently overflow its own (correctly-sized) box since
    // nothing clips a canvas by default.
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

export async function renderAnalyticsPage() {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="loading">Loading analytics...</div>';

    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 30 * DAY_MS);

    const { data, error } = await supabase.rpc('analytics_summary', {
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
    });

    if (error) {
        content.innerHTML = `<div class="admin-msg admin-msg-error">${escapeHtml(error.message)}</div>`;
        return;
    }

    content.innerHTML = '';

    const cardsHost = document.createElement('div');
    cardsHost.className = 'dashboard-cards';
    content.appendChild(cardsHost);
    renderKpiCards(cardsHost, data);

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

    // ---- Overview ----
    shell.panels.overview.innerHTML = `
        <div class="admin-card" style="margin-bottom:var(--space-md)">
            <h3>Pageviews over time</h3>
            <div id="chart-timeseries"></div>
        </div>
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
            <div class="admin-card" style="flex:1;min-width:260px">
                <h3>Device breakdown</h3>
                <div id="chart-device"></div>
            </div>
            <div class="admin-card" style="flex:1;min-width:260px">
                <h3>Referrer breakdown</h3>
                <div id="chart-referrer"></div>
            </div>
        </div>`;

    const timeseries = (data.timeseries || []).map((t) => ({ day: new Date(t.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), views: t.views }));
    drawBarChart(document.getElementById('chart-timeseries'), timeseries, { labelKey: 'day', valueKey: 'views' });
    drawBarChart(document.getElementById('chart-device'), data.by_device, { labelKey: 'device_type', valueKey: 'views' });
    drawBarChart(document.getElementById('chart-referrer'), data.by_referrer, { labelKey: 'referrer_kind', valueKey: 'views' });

    // ---- Traffic Patterns ----
    shell.panels.traffic.innerHTML = `
        <div class="admin-card">
            <h3>Traffic by day &amp; hour</h3>
            <p class="muted">Aggregate pageview counts only — no individual visit is tracked.</p>
            <div id="heatmap-traffic" style="overflow-x:auto"></div>
        </div>`;
    drawHeatmap(document.getElementById('heatmap-traffic'), data.by_hour_dow);

    // ---- Content ----
    shell.panels.content.innerHTML = `
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap;margin-bottom:var(--space-md)">
            <div class="admin-card" style="flex:1;min-width:260px">
                <h3>Top pages</h3>
                <div id="table-pages"></div>
            </div>
            <div class="admin-card" style="flex:1;min-width:260px">
                <h3>Top leagues</h3>
                <div id="table-leagues"></div>
            </div>
            <div class="admin-card" style="flex:1;min-width:260px">
                <h3>Top players</h3>
                <div id="table-players"></div>
            </div>
        </div>`;
    renderTable(document.getElementById('table-pages'), (data.top_pages || []).map(p => ({ ...p, page: pageLabel(p.page) })), [{ key: 'page', label: 'Page' }, { key: 'views', label: 'Views' }]);
    renderTable(document.getElementById('table-leagues'), data.top_leagues, [{ key: 'league_id', label: 'League' }, { key: 'views', label: 'Views' }]);
    renderTable(document.getElementById('table-players'), data.top_players, [{ key: 'player', label: 'Player' }, { key: 'views', label: 'Views' }]);

    // ---- Behavior ----
    shell.panels.behavior.innerHTML = `
        <div class="admin-card" style="margin-bottom:var(--space-md)">
            <h3>Dwell time by page</h3>
            <div id="dwell-buckets" style="display:flex;gap:var(--space-md);flex-wrap:wrap"></div>
        </div>
        <div class="admin-card">
            <h3>Page-to-page flow</h3>
            <p class="muted">Derived from the browser's own referrer on the next pageview — not a tracked session.</p>
            <div id="table-transitions"></div>
        </div>`;
    renderDwellBuckets(document.getElementById('dwell-buckets'), data.dwell_buckets);
    renderTable(
        document.getElementById('table-transitions'),
        (data.transitions || []).map(t => ({ from: pageLabel(t.from_page), to: pageLabel(t.to_page), n: t.n })),
        [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'n', label: 'Count' }]
    );
}
