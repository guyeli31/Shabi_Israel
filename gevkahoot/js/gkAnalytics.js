/**
 * gkAnalytics.js — analytics.html: what PLAYERS did, live and in the demo.
 *
 * The GevKahoot twin of shabi-israel/analytics.html, built on the same
 * principles: an admin-only page reached by its URL (an inline login gate, the
 * same Supabase login), one month at a time (opens on the current one, Israel
 * time), the audience split into Visitors / Other operators / Me, and one tab
 * per question an analyst asks, ordered population → who → what → visit →
 * event. The raw rows are fetched once per month and every filter re-renders
 * in the browser with no round trip.
 *
 * Two sources (sql/gevkahoot_analytics.sql):
 *   gk_analytics_raw   the beacon (js/data/analytics.js): visits, clicks, the
 *                      demo's screens
 *   gk_analytics_runs  the live runs, read from the quiz's own tables — what a
 *                      live player answered is never beaconed, the quiz
 *                      already holds it exactly
 *
 * The host's own work is not measured here. All DOM through h() (no
 * innerHTML in gevkahoot/): a live player's name is a stranger's text.
 */
import { h, clear } from './ui/dom.js';
import { supabase } from './data/api.js';
import { login, isLoggedIn, getUsername } from '../../shabi-israel/js/admin/auth.js';
import { mountAppTabs } from '../../shabi-israel/js/render/appTabs.js';
import { mountFilterToggle } from '../../shabi-israel/js/render/subTabs.js';
import { spliceQueryParam } from '../../shabi-israel/js/utils/queryString.js';

const content = document.getElementById('content');
const ALL_TIME = 'all';
const TZ = 'Asia/Jerusalem';

// ---- icons: one vocabulary for every tab ------------------------------------
const MODE = {
    live:   { icon: '🔴', label: 'Live' },
    demo:   { icon: '🎮', label: 'Demo' },
    saved:  { icon: '📚', label: 'Saved demo' },
    browse: { icon: '👀', label: 'Browse only' },
};
const PHASE_ICON = {
    lobby: '🛋️', countdown: '⏳', interlude: '📺', intro: '📘', question: '❓', reveal: '✅',
    explain: '📖', fastest: '⚡', fire: '🔥', leaderboard: '📊', podium: '🏆', matrix: '🧮',
};
const KIND = {
    question: { icon: '❓', label: 'Question' }, puzzle: { icon: '🧩', label: 'Puzzle' },
    spot: { icon: '🔍', label: 'Spot it' }, complete: { icon: '🖼️', label: 'Complete the picture' },
    slider: { icon: '🎚️', label: 'Slider' }, rank: { icon: '🔢', label: 'Ranking' },
    memory: { icon: '🧠', label: 'Memory' }, action: { icon: '🏀', label: 'Action round' },
    roulette: { icon: '🎰', label: 'Roulette' }, interlude: { icon: '📺', label: 'Interlude' },
};
const kindLabel = (k) => `${KIND[k]?.icon || '•'} ${KIND[k]?.label || k || '—'}`;
const DEVICE_ICON = { desktop: '🖥️', mobile: '📱', tablet: '📋' };
const REFERRER_ICON = { direct: '🔗', search: '🔍', social: '💬', internal: '↪', other: '🌐' };
// Every click_target starts with its kind, so a prefix picks its icon.
const CLICK_ICONS = [
    ['Entry: demo', '🎮'], ['Entry: saved', '📚'], ['Entry: admin login', '🔑'],
    ['Join: ok', '🚪'], ['Join: ', '⚠️'], ['Relink: approved', '✅'], ['Relink: rejected', '⛔'],
    ['Relink: not me', '🙅'], ['Relink: ', '🔗'], ['Live: kicked', '🗑'], ['Exit: handoff', '👋'],
    ['Demo: joined', '🎮'], ['Demo: continue', '▶'], ['Demo: restart', '↺'], ['Demo: menu', '⌂'],
    ['Demo: play again', '🔁'], ['Demo: exit', '🚪'], ['Saved: unavailable', '🔒'], ['Nav: refresh', '🔄'], ['Nav: back', '⬅️'], ['Nav: forward', '➡️'],
];
const clickIcon = (t) => (CLICK_ICONS.find(([p]) => t.startsWith(p)) || [, '🖱️'])[1];
function eventLabel(e) {
    if (e.event_type === 'pageview') return `📄 Opened the page (${MODE[e.mode]?.label || e.mode})`;
    if (e.event_type === 'duration') return `⏱️ Visible for ${fmtMs(e.duration_ms)}`;
    if (e.event_type === 'stage') {
        const q = e.item_no ? ` · Q${e.item_no} ${KIND[e.item_kind]?.icon || ''}` : '';
        const verdict = e.phase === 'reveal' && e.item_kind ? (e.correct === true ? ' · ✓ correct' : e.correct === false ? ' · ✕ wrong' : ' · no answer') : '';
        const pts = e.points != null && (e.phase === 'reveal' || e.phase === 'podium') ? ` · ${e.points} pts` : '';
        return `${PHASE_ICON[e.phase] || '•'} ${e.phase}${q}${verdict}${pts}`;
    }
    return `${clickIcon(e.click_target || '')} ${e.click_target}`;
}

// ---- formatting ---------------------------------------------------------------
const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
function fmtMs(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
/** An answer's speed: tenths of a second matter. */
const fmtSpeed = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = (xs) => {
    const v = xs.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
function countBy(xs, key) {
    const m = new Map();
    for (const x of xs) { const k = key(x); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
}

// ---- month ranges (Israel time) -------------------------------------------------
function israelMidnight(y, m) {           // the instant the 1st of month m starts in Israel
    const utc = Date.UTC(y, m - 1, 1);
    for (const off of [2, 3]) {
        const d = new Date(utc - off * 3600e3);
        if (d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }) === '00') return d;
    }
    return new Date(utc);
}
function monthRange(key) {
    if (key === ALL_TIME) return { from: new Date('2020-01-01T00:00:00Z'), to: new Date(Date.now() + 86400e3) };
    const [y, m] = key.split('-').map(Number);
    return { from: israelMidnight(y, m), to: israelMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) };
}
const monthLabel = (key) => (key === ALL_TIME ? 'All time'
    : new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);

// ---- building blocks (the main site's classes) ------------------------------------
const section = (title, ...children) => h('div', { class: 'app-section app-section--card' },
    h('h2', { class: 'app-section-h2', text: title }), ...children);
const note = (text) => h('p', { class: 'analytics-mix-note', text });
const empty = () => h('p', { class: 'muted', text: 'No data yet.' });

/** A table: columns [{label, value(row) → string | Node}]. */
function table(rows, columns) {
    if (!rows.length) return empty();
    return h('div', { class: 'mf-wrap' },
        h('table', { class: 'dash-table font-small' },
            h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', text: c.label })))),
            h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => {
                const v = c.value(r);
                return h('td', { dir: c.auto ? 'auto' : null }, v instanceof Node ? v : String(v ?? ''));
            }))))));
}

/** Horizontal bars: [[label, value]] — plain DOM, themed by the tokens. */
function bars(pairs, { total = null } = {}) {
    if (!pairs.length) return empty();
    const max = Math.max(...pairs.map(([, v]) => v), 1);
    return h('div', { class: 'gka-bars' }, pairs.map(([label, v]) => h('div', { class: 'gka-bar-row' },
        h('span', { class: 'gka-bar-label', dir: 'auto', text: label }),
        h('span', { class: 'gka-bar-track' }, h('span', { class: 'gka-bar', style: { width: `${(100 * v) / max}%` } })),
        h('span', { class: 'gka-bar-value', text: total ? `${v} · ${pct(v, total)}` : String(v) }))));
}

/** A funnel: each step's bar against the first step. */
function funnel(steps) {
    const top = steps[0]?.[1] || 0;
    return h('div', { class: 'gka-bars gka-funnel' }, steps.map(([label, v]) => h('div', { class: 'gka-bar-row' },
        h('span', { class: 'gka-bar-label', text: label }),
        h('span', { class: 'gka-bar-track' }, h('span', { class: 'gka-bar', style: { width: `${top ? (100 * v) / top : 0}%` } })),
        h('span', { class: 'gka-bar-value', text: `${v} · ${pct(v, top)}` }))));
}

function cards(list) {
    return h('div', { class: 'dashboard-cards' }, list.map(([label, value, flex]) =>
        h('div', { class: `dash-card${flex ? ' dash-card--flex' : ''}` },
            h('div', { class: 'dash-card-label', text: label }),
            h('div', { class: 'dash-card-value', text: String(value) }))));
}

// ---- the audience (Visitors / Other operators / Me) ---------------------------------
let audience = { visitor: true, other: true, self: false };
try { Object.assign(audience, JSON.parse(localStorage.getItem('gk-analytics:audience') || '{}')); } catch { /* defaults */ }
const viewer = () => (getUsername() || '').split('@')[0] || null;
function keep(e) {
    if (!e.admin_user) return audience.visitor;
    return e.admin_user === viewer() ? audience.self : audience.other;
}

// ---- derived views ---------------------------------------------------------------
/** Visits: the Israel / signed-in route links a tab's events by session_id; a
 *  global-route event has no id, so each of its pageviews is a visit of its own. */
function visitsOf(events) {
    const by = new Map();
    for (const e of events) {
        const id = e.session_id || (e.event_type === 'pageview' ? `g:${e.created_at}:${by.size}` : null);
        if (!id) continue;
        if (!by.has(id)) by.set(id, []);
        by.get(id).push(e);
    }
    return [...by].map(([id, evs]) => {
        const modes = new Set(evs.map((e) => e.mode).filter((m) => m && m !== 'browse'));
        const first = evs[0];
        return {
            id, linked: !id.startsWith('g:'), events: evs, start: first.created_at, end: evs[evs.length - 1].created_at,
            device: first.device_type, os: first.os, browser: first.browser,
            referrer: evs.find((e) => e.event_type === 'pageview')?.referrer_kind || null,
            region: first.region, admin: first.admin_user,
            modes: modes.size ? [...modes] : ['browse'],
            dwell: evs.filter((e) => e.event_type === 'duration').reduce((s, e) => s + (e.duration_ms || 0), 0),
        };
    }).sort((a, b) => (a.start < b.start ? 1 : -1));
}
const clicks = (events, prefix) => events.filter((e) => e.event_type === 'click' && e.click_target?.startsWith(prefix));

// ---- page state --------------------------------------------------------------------
let months = [];
let monthKey = currentMonth();
let raw = [];
let runs = [];
let quizTitles = new Map();
let ordinals = {};
let fetchedAt = null;
const params = new URLSearchParams(location.search);
let runId = params.get('run');

async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
}

async function load() {
    clear(content);
    content.append(h('p', { class: 'muted', text: 'Loading…' }));
    if (!isLoggedIn()) { loginGate(); return; }
    const { from, to } = monthRange(monthKey);
    try {
        const range = { from_date: from.toISOString(), to_date: to.toISOString() };
        [months, raw, runs, ordinals] = await Promise.all([rpc('gk_analytics_months'), rpc('gk_analytics_raw', range),
            rpc('gk_analytics_runs', range), rpc('gk_analytics_session_ordinals')]);
        const { data: qs } = await supabase.from('gk_quizzes').select('id, title');
        quizTitles = new Map((qs || []).map((q) => [q.id, q.title]));
    } catch (err) {
        clear(content);
        const denied = /not authorized|permission|JWT/i.test(err.message || '');
        content.append(h('div', { class: 'admin-msg admin-msg-error',
            text: denied ? 'This account is not on the admin allowlist.' : err.message }));
        if (denied) loginGate(true);
        return;
    }
    fetchedAt = new Date();
    render();
}

function loginGate(again = false) {
    if (!again) clear(content);
    const email = h('input', { type: 'email', class: 'gk-login-input', placeholder: 'Email', autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', class: 'gk-login-input', placeholder: 'Password', autocomplete: 'current-password', required: true });
    const msg = h('p', { class: 'muted' });
    content.append(section('🔒 Admin login',
        note('The analytics are for the quiz admins — the same login as the host screen and the main site.'),
        h('form', { class: 'gka-login', onsubmit: async (e) => {
            e.preventDefault();
            msg.textContent = 'Signing in…';
            if (await login(email.value, pass.value)) load();
            else msg.textContent = 'Wrong email or password.';
        } }, email, pass, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Log in' }), msg)));
}

// ---- render --------------------------------------------------------------------------
function render() {
    clear(content);
    const events = raw.filter(keep);
    const visits = visitsOf(events);

    // ── KPI cards ──
    const demoJoins = clicks(events, 'Demo: joined');
    const demoPodiums = events.filter((e) => e.event_type === 'stage' && e.phase === 'podium' && (e.mode === 'demo' || e.mode === 'saved'));
    const livePlayers = runs.reduce((s, r) => s + r.players.length, 0);
    const linked = visits.filter((v) => v.linked);
    content.append(cards([
        ['Visits', visits.length],
        [`Live players (${runs.length} runs)`, livePlayers],
        ['Demo games', demoJoins.length],
        ['Demo finished', pct(demoPodiums.length, demoJoins.length)],
        ['Avg. visit', fmtMs(median(linked.map((v) => v.dwell || null)))],
        ['Last updated', fetchedAt.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }), true],
    ]));

    // ── range + audience ──
    const bar = h('div', { class: 'analytics-range-bar' });
    const keys = [...new Set([currentMonth(), ...months])];
    const select = h('select', { class: 'analytics-range-select', 'aria-label': 'Month',
        onchange: (e) => { monthKey = e.target.value; load(); } },
    [...keys, ALL_TIME].map((k) => h('option', { value: k, selected: k === monthKey, text: monthLabel(k) })));
    bar.append(select, h('span', { class: 'analytics-audience-label', text: 'Show:' }));
    const pill = (label, key, title) => mountFilterToggle(bar, { label, title, pressed: audience[key], onToggle: (on) => {
        audience = { ...audience, [key]: on };
        try { localStorage.setItem('gk-analytics:audience', JSON.stringify(audience)); } catch { /* fine */ }
        render();
    } });
    pill('Visitors', 'visitor', 'Players with no operator account');
    pill('Other operators', 'other', 'Other admins trying the quiz');
    pill('Me', 'self', 'Your own visits');
    content.append(bar);

    const shell = mountAppTabs({
        tabs: [
            { id: 'overview', label: 'Overview', icon: '📈' },
            { id: 'audience', label: 'Audience', icon: '🌍' },
            { id: 'live', label: 'Live', icon: '🔴' },
            { id: 'demos', label: 'Demos', icon: '🎮' },
            { id: 'questions', label: 'Questions', icon: '🧩' },
            { id: 'journeys', label: 'Journeys', icon: '👣' },
            { id: 'activity', label: 'Activity', icon: '🖱️' },
            { id: 'health', label: 'Health', icon: '🩺' },
            { id: 'quizzes-opened', label: 'Quizzes Opened', icon: '🗂️' },
        ],
        urlKey: 'tab',
        ariaLabel: 'Analytics sections',
        shellClass: 'analytics-tabs-shell',
        panelClass: 'analytics-tab-panel',
    });
    content.append(shell.root);
    const P = shell.panels;

    overviewTab(P.overview, events, visits);
    audienceTab(P.audience, visits);
    liveTab(P.live, events);
    demosTab(P.demos, events, visits);
    questionsTab(P.questions, events);
    journeysTab(P.journeys, visits);
    activityTab(P.activity, events);
    healthTab(P.health, events);
    quizzesTab(P['quizzes-opened'], visits);
}

// ── 📈 Overview: how much, of what, when ──
function overviewTab(panel, events, visits) {
    const mix = countBy(visits.flatMap((v) => v.modes), (m) => m).map(([m, n]) => [`${MODE[m].icon} ${MODE[m].label}`, n]);
    panel.append(section('Activity mix', bars(mix, { total: visits.length }),
        note('Per visit: what the visit went on to do. A visit that played the demo and then joined a live quiz counts under both; "Browse only" opened the page and played nothing.')));
    const days = countBy(events.filter((e) => e.event_type === 'pageview'), (e) => fmtDay(e.created_at)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    panel.append(section('Visits over time', bars(days)));
    const hours = countBy(events.filter((e) => e.event_type === 'pageview'),
        (e) => new Date(e.created_at).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }))
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([hh, n]) => [`${hh}:00`, n]);
    panel.append(section('Visits by hour (Israel time)', bars(hours)));
}

// ── 🌍 Audience: who, on what, from where ──
function audienceTab(panel, visits) {
    const n = visits.length;
    panel.append(section('Device', bars(countBy(visits, (v) => v.device).map(([k, c]) => [`${DEVICE_ICON[k] || '❓'} ${k}`, c]), { total: n })));
    panel.append(section('Operating system & browser',
        h('h4', { text: 'OS' }), bars(countBy(visits, (v) => v.os), { total: n }),
        h('h4', { text: 'Browser' }), bars(countBy(visits, (v) => v.browser), { total: n })));
    panel.append(section('Referrer', bars(countBy(visits, (v) => v.referrer).map(([k, c]) => [`${REFERRER_ICON[k] || '•'} ${k}`, c]), { total: n }),
        note('"internal" includes arriving from the Shabi Israel site or the domain hub.')));
    panel.append(section('By region', bars(countBy(visits.filter((v) => v.region), (v) => v.region)),
        note('Global route only — an Asia/Jerusalem visit carries no region by design, so it is absent here rather than missing.')));
}

// ── 🔴 Live: the runs, from the quiz's own tables ──
function liveTab(panel, events) {
    if (!runs.length) { panel.append(section('Live runs', empty())); return; }
    const pick = (id) => {
        runId = id;
        history.replaceState(history.state, '', spliceQueryParam(location.href, 'run', id));
        clear(panel); liveTab(panel, events);
    };
    panel.append(section('Live runs', table(runs, [
        { label: 'Date', value: (r) => fmtTime(r.created_at) },
        { label: 'Quiz', auto: true, value: (r) => r.quiz_title },
        { label: 'Status', value: (r) => ({ finished: '🏁 finished', running: '🔴 on air', lobby: '🛋️ lobby', aborted: '⛔ aborted' }[r.status] || r.status) },
        { label: 'Players', value: (r) => r.players.length },
        { label: 'Questions', value: (r) => r.items.length },
        { label: 'Answer rate', value: (r) => pct(r.items.reduce((s, i) => s + i.answered, 0), r.items.length * r.players.filter((p) => !p.kicked).length) },
        { label: 'Correct', value: (r) => pct(r.items.reduce((s, i) => s + i.correct, 0), r.items.reduce((s, i) => s + i.answered, 0)) },
        { label: '', value: (r) => h('button', { class: `btn ${r.id === runId ? 'btn-primary' : ''}`, type: 'button', text: r.id === runId ? 'Shown ▾' : 'Details', onclick: () => pick(r.id) }) },
    ])));
    const run = runs.find((r) => r.id === runId) || runs[0];
    const mine = events.filter((e) => e.run_id === run.id);
    const opened = new Set(mine.filter((e) => e.session_id).map((e) => e.session_id)).size
        + mine.filter((e) => !e.session_id && e.event_type === 'pageview').length;
    const active = run.players.filter((p) => !p.kicked);
    const nItems = run.items.length;
    panel.append(section(`🚪 Funnel — ${run.quiz_title} (${fmtTime(run.created_at)})`,
        funnel([
            ['📄 Opened the page while on air', Math.max(opened, run.players.length)],
            ['🚪 Joined', run.players.length],
            ['❓ Answered at least one', active.filter((p) => p.answered > 0).length],
            ['✅ Answered every question', active.filter((p) => nItems && p.answered >= nItems).length],
            ['🏆 Reached the podium', new Set(mine.filter((e) => e.event_type === 'stage' && e.phase === 'podium').map((e) => e.session_id)).size],
        ]),
        note('"Opened" is from the beacon (visits carrying this run); joined and answers are the quiz\'s own records. The podium step counts phones that showed it.')));
    panel.append(section('🧩 Questions', table(run.items, [
        { label: '#', value: (i) => i.no },
        { label: 'Kind', value: (i) => kindLabel(i.kind) },
        { label: 'Question', auto: true, value: (i) => i.title },
        { label: 'Answered', value: (i) => `${i.answered} · ${pct(i.answered, active.length)}` },
        { label: 'Correct', value: (i) => (i.kind === 'action' || i.kind === 'slider' ? '—' : pct(i.correct, i.answered)) },
        { label: 'Median time', value: (i) => fmtSpeed(i.median_ms) },
    ]), note('In asked order. Slider and action rounds are scored on a scale, so "correct" is not shown for them.')));
    const lastNo = (p) => {
        if (!p.last_answer_at) return 'never answered';
        return p.answered >= nItems ? 'to the end' : `after ${p.answered} of ${nItems}`;
    };
    panel.append(section('👥 Players', table(run.players, [
        { label: 'Name', auto: true, value: (p) => `${p.kicked ? '🗑 ' : ''}${p.name}` },
        { label: 'Joined', value: (p) => fmtTime(p.joined_at) },
        { label: 'Answered', value: (p) => `${p.answered} / ${nItems}` },
        { label: 'Correct', value: (p) => p.correct },
        { label: 'Points', value: (p) => p.points },
        { label: 'Stayed', value: (p) => (p.kicked ? 'removed' : lastNo(p)) },
    ])));
    const rel = run.relinks;
    panel.append(section('📶 Connection', table([
        ['🔗 Relink requests', rel.pending + rel.approved + rel.rejected],
        ['✅ Relinks approved', rel.approved],
        ['⛔ Relinks rejected', rel.rejected],
        ['🗑 Removed by the host', run.players.filter((p) => p.kicked).length],
        ['🔄 Page refreshes', clicks(mine, 'Nav: refresh').length],
        ['⬅️ Back / ➡️ Forward', clicks(mine, 'Nav: back').length + clicks(mine, 'Nav: forward').length],
        ['⚠️ Join refused', clicks(mine, 'Join: ').filter((e) => e.click_target !== 'Join: ok').length],
    ], [{ label: 'Event', value: (r) => r[0] }, { label: 'Count', value: (r) => r[1] }])));
}

// ── 🎮 Demos: the built-in demo and the saved quizzes played alone ──
function demosTab(panel, events, visits) {
    for (const mode of ['demo', 'saved']) {
        const evs = events.filter((e) => e.mode === mode);
        const reveals = evs.filter((e) => e.event_type === 'stage' && e.phase === 'reveal' && e.item_kind);
        panel.append(section(`${MODE[mode].icon} ${MODE[mode].label} — funnel`, funnel([
            ['📄 Opened', evs.filter((e) => e.event_type === 'pageview').length],
            ['🎮 Started a game', clicks(evs, 'Demo: joined').length],
            ['✅ Reached a first reveal', new Set(reveals.map((e) => `${e.session_id || e.created_at}`)).size],
            ['🏆 Reached the podium', evs.filter((e) => e.event_type === 'stage' && e.phase === 'podium').length],
        ])));
        if (mode === 'saved') {
            const byQuiz = countBy(clicks(evs, 'Demo: joined'), (e) => quizTitles.get(e.quiz_id) || e.quiz_id || '?');
            panel.append(section('📚 Saved quizzes played', bars(byQuiz)));
        }
    }
    // Where a game stopped: per visit, the last screen after each start.
    const stops = [];
    for (const v of visits.filter((x) => x.linked)) {
        let last = null;
        for (const e of v.events) {
            if (e.mode !== 'demo' && e.mode !== 'saved') continue;
            if (e.click_target === 'Demo: joined') { if (last) stops.push(last); last = 'lobby'; }
            else if (e.event_type === 'stage' && last) last = e.item_no ? `Q${e.item_no} · ${e.phase}` : e.phase;
        }
        if (last) stops.push(last);
    }
    panel.append(section('🛑 Where demo games stopped', bars(countBy(stops, (s) => s)),
        note('The last screen of each game (Israel / signed-in visits). "podium" or "matrix" = played to the end.')));
    const btn = (p) => clicks(events.filter((e) => e.mode === 'demo' || e.mode === 'saved'), p).length;
    panel.append(section('🖱️ Demo controls', table([
        ['▶ Continue', btn('Demo: continue')], ['↺ Restart', btn('Demo: restart')], ['⌂ Menu', btn('Demo: menu')],
        ['🔁 Play again', btn('Demo: play again')], ['🚪 Exit', btn('Demo: exit')],
    ], [{ label: 'Button', value: (r) => r[0] }, { label: 'Clicks', value: (r) => r[1] }]),
    note('Every demo screen waits for "Continue" except the question clock and the countdown, so its clicks are the demo\'s pace.')));
}

// ── 🧩 Questions: difficulty by kind, live and demo ──
function questionsTab(panel, events) {
    const live = new Map();
    for (const r of runs) for (const i of r.items) {
        const k = live.get(i.kind) || { items: 0, answered: 0, correct: 0, ms: [] };
        k.items++; k.answered += i.answered; k.correct += i.correct; if (i.median_ms != null) k.ms.push(i.median_ms);
        live.set(i.kind, k);
    }
    panel.append(section('🔴 Live — by kind', table([...live], [
        { label: 'Kind', value: ([k]) => kindLabel(k) },
        { label: 'Asked', value: ([, v]) => v.items },
        { label: 'Answers', value: ([, v]) => v.answered },
        { label: 'Correct', value: ([k, v]) => (k === 'action' || k === 'slider' ? '—' : pct(v.correct, v.answered)) },
        { label: 'Median time', value: ([, v]) => fmtSpeed(median(v.ms)) },
    ])));
    const reveals = events.filter((e) => e.event_type === 'stage' && e.phase === 'reveal' && e.item_kind && e.item_kind !== 'interlude');
    const group = (keyFn) => {
        const m = new Map();
        for (const e of reveals) {
            const k = keyFn(e);
            const g = m.get(k) || { kind: e.item_kind, mode: e.mode, quiz: e.quiz_id, no: e.item_no, n: 0, answered: 0, correct: 0, pts: [] };
            g.n++; if (e.correct !== null && e.correct !== undefined) g.answered++; if (e.correct) g.correct++; if (e.points != null) g.pts.push(e.points);
            m.set(k, g);
        }
        return [...m.values()];
    };
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : '—');
    panel.append(section('🎮 Demo — by kind', table(group((e) => e.item_kind), [
        { label: 'Kind', value: (g) => kindLabel(g.kind) },
        { label: 'Reveals', value: (g) => g.n },
        { label: 'Answered', value: (g) => pct(g.answered, g.n) },
        { label: 'Correct', value: (g) => (g.kind === 'action' || g.kind === 'slider' ? '—' : pct(g.correct, g.answered)) },
        { label: 'Avg. points', value: (g) => avg(g.pts) },
    ])));
    const perQ = group((e) => `${e.mode}|${e.quiz_id || ''}|${e.item_no}`).sort((a, b) => (a.mode + a.quiz).localeCompare(b.mode + b.quiz) || a.no - b.no);
    panel.append(section('🎮 Demo — per question', table(perQ, [
        { label: 'Quiz', auto: true, value: (g) => (g.mode === 'demo' ? '🎮 Built-in demo' : `📚 ${quizTitles.get(g.quiz) || '?'}`) },
        { label: '#', value: (g) => g.no ?? '—' },
        { label: 'Kind', value: (g) => kindLabel(g.kind) },
        { label: 'Reveals', value: (g) => g.n },
        { label: 'Correct', value: (g) => (g.kind === 'action' || g.kind === 'slider' ? '—' : pct(g.correct, g.answered)) },
        { label: 'Avg. points', value: (g) => avg(g.pts) },
    ])));
}

// ── 👣 Journeys: one visit at a time ──
function journeysTab(panel, visits) {
    const list = visits.filter((v) => v.linked).slice(0, 100);
    const s = section('Visits — Israel & signed-in (most recent 100)');
    if (!list.length) s.append(empty());
    for (const v of list) {
        const t0 = new Date(v.start).getTime();
        s.append(h('details', { class: 'gka-visit' },
            h('summary', null,
                h('span', { text: fmtTime(v.start) }),
                h('span', { text: ` · ${DEVICE_ICON[v.device] || '❓'} ${v.os}/${v.browser}` }),
                h('span', { text: ` · ${v.modes.map((m) => MODE[m].icon).join('')}` }),
                h('span', { text: ` · ${v.events.length} events · ${fmtMs(v.dwell)}` }),
                v.admin && h('span', { class: 'muted', text: ` · operator ${v.admin}` })),
            table(v.events, [
                { label: '+', value: (e) => fmtMs(new Date(e.created_at).getTime() - t0) },
                { label: 'Event', value: (e) => eventLabel(e) },
                { label: 'Mode', value: (e) => MODE[e.mode]?.icon || '' },
            ])));
    }
    panel.append(s);
}

// ── 🖱️ Activity: every interaction ──
function activityTab(panel, events) {
    const all = events.filter((e) => e.event_type === 'click').reverse();
    const host = h('div');
    const draw = (q) => {
        clear(host);
        const rows = (q ? all.filter((e) => e.click_target.toLowerCase().includes(q.toLowerCase())) : all).slice(0, 500);
        host.append(table(rows, [
            { label: 'Time', value: (e) => fmtTime(e.created_at) },
            { label: 'Interaction', value: (e) => `${clickIcon(e.click_target)} ${e.click_target}` },
            { label: 'Mode', value: (e) => `${MODE[e.mode]?.icon || ''} ${MODE[e.mode]?.label || ''}` },
            { label: 'Device', value: (e) => DEVICE_ICON[e.device_type] || '' },
        ]));
    };
    const input = h('input', { type: 'text', class: 'analytics-clicks-search-input app-search-input', placeholder: 'Search an interaction… (browse shows the latest 500)',
        oninput: (e) => draw(e.target.value) });
    panel.append(section('All clicks & interactions', h('div', { class: 'analytics-clicks-search' }, input), host));
    draw('');
    panel.append(section('Interactions by type', bars(countBy(all, (e) => `${clickIcon(e.click_target)} ${e.click_target.replace(/^(Entry: saved|Demo: (continue|restart|menu)).*/, '$1')}`))));
}

// ── 🩺 Health: what got in the player's way ──
function healthTab(panel, events) {
    const joinErr = countBy(clicks(events, 'Join: ').filter((e) => e.click_target !== 'Join: ok'), (e) => e.click_target);
    panel.append(section('⚠️ Join refused', bars(joinErr),
        note('name_taken starts a relink request by itself; locked = registration closed; bad_name = length.')));
    panel.append(section('Trouble signals', table([
        ['🔄 Page refreshes (live)', clicks(events, 'Nav: refresh').filter((e) => e.mode === 'live').length],
        ['🔄 Page refreshes (demo)', clicks(events, 'Nav: refresh').filter((e) => e.mode === 'demo' || e.mode === 'saved').length],
        ['⬅️ Back', clicks(events, 'Nav: back').length],
        ['➡️ Forward', clicks(events, 'Nav: forward').length],
        ['🔗 Relink requested', clicks(events, 'Relink: requested').length],
        ['🙅 "Not me" after a relink', clicks(events, 'Relink: not me').length],
        ['🗑 Removed by the host', clicks(events, 'Live: kicked').length],
        ['🔒 Saved quiz unavailable', clicks(events, 'Saved: unavailable').length],
    ], [{ label: 'Signal', value: (r) => r[0] }, { label: 'Count', value: (r) => r[1] }]),
    note('Not measured yet: a browser too old for the quiz (legacy.js runs where no module can, so it cannot use this beacon).')));
}

// ── 🗂️ Quizzes Opened: every game a player played, slide by slide ──
/** The games inside one visit. A live game is the visit's events for one run;
 *  a demo game runs from a "Demo: joined" to the next one (a restart or a
 *  reload starts a new game). Each slide's time on screen is the gap to the
 *  NEXT event of the visit, whatever it was — so the last slide's ends at the
 *  menu click, the next game, or the tab being hidden. */
function gamesOf(v) {
    const games = [];
    let demoGame = null;
    const liveGames = new Map();
    /** The navigation that loaded the page this screen is on, if the screen
     *  came straight after one ('Nav: refresh' / 'Nav: back' …). */
    const via = (i) => {
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
            const p = v.events[j];
            if (p.click_target?.startsWith('Nav: ')) return p.click_target.slice(5);
            if (p.event_type === 'stage') return null;
        }
        return null;
    };
    v.events.forEach((e, i) => {
        if (e.mode === 'demo' || e.mode === 'saved') {
            // A restart, the menu or the exit ends the game there and then
            // (a restart passes through the lobby on its way back to the form).
            if (demoGame && /^Demo: (restart|menu|exit)/.test(e.click_target || '')) {
                demoGame.exit = e.click_target.replace(/^Demo: /, '').replace(/ at .*/, '');
                demoGame.exitAt = e.created_at;
                demoGame = null;
            } else if (e.click_target === 'Demo: joined') {
                demoGame = { visit: v, mode: e.mode, quiz: e.quiz_id, start: e.created_at, stages: [] };
                games.push(demoGame);
            } else if (e.event_type === 'stage' && demoGame) demoGame.stages.push({ e, next: v.events[i + 1], via: via(i) });
        } else if (e.mode === 'live' && e.run_id && (e.event_type === 'stage' || e.click_target === 'Join: ok' || e.click_target === 'Relink: approved')) {
            let g = liveGames.get(e.run_id);
            if (!g) { g = { visit: v, mode: 'live', run: e.run_id, start: e.created_at, stages: [] }; liveGames.set(e.run_id, g); games.push(g); }
            if (e.event_type === 'stage') g.stages.push({ e, next: v.events[i + 1], via: via(i) });
        }
    });
    for (const g of games) {
        for (const st of g.stages) st.ms = st.next ? new Date(st.next.created_at) - new Date(st.e.created_at) : null;
        const last = g.stages[g.stages.length - 1];
        g.end = g.exitAt || last?.next?.created_at || last?.e.created_at || g.start;
        g.finished = g.stages.some((st) => st.e.phase === 'podium');
        g.stoppedAt = last ? slideName(last.e) : 'before the first screen';
        const reveals = g.stages.filter((st) => st.e.phase === 'reveal' && st.e.item_kind);
        g.asked = reveals.length;
        g.answered = reveals.filter((st) => st.e.correct !== null && st.e.correct !== undefined).length;
        g.correct = reveals.filter((st) => st.e.correct).length;
        g.points = g.stages.find((st) => st.e.phase === 'podium')?.e.points ?? reveals.reduce((s, st) => s + (st.e.points || 0), 0);
        g.speed = median(reveals.map((st) => st.e.answered_ms));
        g.title = g.mode === 'live' ? runs.find((r) => r.id === g.run)?.quiz_title || 'Live quiz'
            : g.mode === 'saved' ? quizTitles.get(g.quiz) || 'Saved quiz' : 'Built-in demo';
    }
    return games;
}
const slideName = (e) => (e.item_no ? `Q${e.item_no} · ${e.phase}` : e.item_kind === 'interlude' ? `interlude “${e.item_title || ''}”` : e.phase);

/** The slide rows: one row per question or interlude (and per screen outside
 *  any item — lobby, countdown, podium), its own screens indented under it. */
function slideRows(g) {
    const groups = [];
    for (const st of g.stages) {
        const id = st.e.item_id;
        const top = groups[groups.length - 1];
        if (id && top?.id === id) top.subs.push(st);
        else groups.push({ id, head: st.e, subs: id ? [st] : [], st });
    }
    const rows = [];
    for (const gr of groups) {
        if (!gr.id) { rows.push({ level: 0, label: `${PHASE_ICON[gr.head.phase] || '•'} ${gr.head.phase}${gr.st.via ? ` (after 🔄 ${gr.st.via})` : ''}`, ms: gr.st.ms, e: gr.head }); continue; }
        const reveal = gr.subs.find((st) => st.e.phase === 'reveal')?.e;
        const total = gr.subs.reduce((s, st) => s + (st.ms || 0), 0);
        const kind = KIND[gr.head.item_kind] || { icon: '•', label: gr.head.item_kind };
        rows.push({ level: 0, label: `${gr.head.item_no ? `Q${gr.head.item_no} ` : ''}${kind.icon} ${gr.head.item_title || kind.label}`, ms: total, e: reveal, item: true });
        for (const st of gr.subs) rows.push({ level: 1, label: `${PHASE_ICON[st.e.phase] || '•'} ${st.e.phase}${st.via ? ` (after 🔄 ${st.via})` : ''}`, ms: st.ms, e: null });
    }
    return rows;
}

function quizzesTab(panel, visits) {
    const games = visits.filter((v) => v.linked).flatMap(gamesOf).sort((a, b) => (a.start < b.start ? 1 : -1));
    const s = section(`Quizzes opened (${games.length})`,
        note('Every game a player played — 🔴 live or 🎮/📚 alone against the bots. Open one for its slides: each question or interlude is a row, the screens inside it indented under it, each with the time it was on this player\'s screen. Israel / signed-in visits only: a global-route visit has no id to tie its screens together.'));
    if (!games.length) s.append(empty());
    for (const g of games) {
        const sess = ordinals[g.visit.id] ? `#${ordinals[g.visit.id]}` : '—';
        const verdict = (e) => {
            if (!e || !e.item_kind) return '';
            if (e.correct === null || e.correct === undefined) return '— no answer';
            if (e.item_kind === 'slider' || e.item_kind === 'action') return '• scored';
            return e.correct ? '✓ correct' : '✕ wrong';
        };
        s.append(h('details', { class: 'gka-game', dataset: { mode: g.mode } },
            h('summary', null,
                h('span', { class: 'gka-game-mode', text: `${MODE[g.mode].icon} ${MODE[g.mode].label}` }),
                h('span', { class: 'gka-game-title', dir: 'auto', text: g.title }),
                h('span', { class: 'gka-game-meta', text: [
                    `session ${sess}`,
                    fmtTime(g.start),
                    `⏱ ${fmtMs(new Date(g.end) - new Date(g.start))}`,
                    `${g.correct}/${g.asked} correct`,
                    `${g.points} pts`,
                    g.speed != null ? `median ${fmtSpeed(g.speed)}` : null,
                    g.finished ? '🏁 finished' : `🛑 stopped at ${g.stoppedAt}${g.exit ? ` (${{ restart: '↺ restart', menu: '⌂ menu', exit: '🚪 exit' }[g.exit] || g.exit})` : ''}`,
                ].filter(Boolean).join(' · ') })),
            table(slideRows(g), [
                { label: 'Slide', value: (r) => h('span', { class: r.level ? 'gka-sub' : r.item ? 'gka-item' : null, dir: 'auto', text: r.level ? `↳ ${r.label}` : r.label }) },
                { label: 'On screen', value: (r) => fmtMs(r.ms) },
                { label: 'Result', value: (r) => verdict(r.e) },
                { label: 'Points', value: (r) => (r.e && r.e.item_kind && r.e.points != null ? r.e.points : '') },
                { label: 'Speed', value: (r) => (r.e?.answered_ms != null ? fmtSpeed(r.e.answered_ms) : '') },
            ])));
    }
    panel.append(s);
}

load();
