/**
 * typoEditor.js — Multi-page typography editor (Phase 2B).
 *
 * Loaded by typo-editor.html (the shell). The shell renders a sidebar in the
 * outer frame and an iframe pointing at any of the 6 app pages. This module
 * runs in the OUTER frame and reaches into iframe.contentDocument for all
 * DOM operations: scanning, hover outlines, right-click menu, live overrides.
 *
 * State:
 *   localStorage['shabi-typo-editor-state']    — current size+bold per group + per-table bolds
 *   localStorage['shabi-typo-additions']       — selectors the user accepted via the review dialog
 *   localStorage['shabi-typo-ignore']          — selectors the user said "ignore forever"
 *   localStorage['shabi-typo-viewport']        — 'desktop' | 'tablet' | 'mobile'
 *   localStorage['shabi-typo-preset']          — 'a1' | 'b1' | 'c1' | 'custom'
 *   In-memory only:
 *     fileHandle (FileSystemFileHandle for css/typography-overrides.css)
 *
 * Save target: css/typography-overrides.css — overwritten on every Save.
 * Linked from every page so a regular page reload picks up the latest values.
 */

/* ── 7-size presets (anchor: A1) ──────────────────────── */

const PRESETS = {
    a1: { t1: '2.00rem', t2: '1.50rem', t3: '1.25rem', t4: '1.05rem', t5: '0.93rem', t6: '0.85rem', t7: '0.78rem' },
    b1: { t1: '2.40rem', t2: '1.75rem', t3: '1.40rem', t4: '1.10rem', t5: '0.93rem', t6: '0.80rem', t7: '0.72rem' },
    c1: { t1: '1.875rem', t2: '1.500rem', t3: '1.250rem', t4: '1.125rem', t5: '0.875rem', t6: '0.750rem', t7: '0.625rem' }
};

const TIERS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];

const TIER_LABELS = {
    t1: 'T1 — Display',
    t2: 'T2 — Stat',
    t3: 'T3 — Section H2',
    t4: 'T4 — Sub H3',
    t5: 'T5 — Body-L · .font-large (C1)',
    t6: 'T6 — Body-S · .font-small (C4)',
    t7: 'T7 — Micro'
};

const PAGES = ['index', 'league', 'league_table', 'player', 'player_league', 'admin'];

/* ── Manual registry: per-page, friendly-named groups ──────────────────── */

const ALL_PAGES = '*'; // sentinel for "applies on every page"

const GROUPS = [
    // ── Cross-page (header / nav / breadcrumb) ──
    { id: 'page-h1',           pages: ALL_PAGES, tier: 't1', bold: true,  label: 'Page H1',                 sel: '.page-header h1' },
    { id: 'page-subtitle',     pages: ALL_PAGES, tier: 't4', bold: false, label: 'Page subtitle',           sel: '.page-header .subtitle' },
    { id: 'section-heading',   pages: ALL_PAGES, tier: 't3', bold: true,  label: 'Section heading (all)',   sel: '.dash-section h2, .leaderboard-section h2, .pg-section > h2, .collapsible-header' },
    { id: 'card-h3',           pages: ALL_PAGES, tier: 't4', bold: true,  label: 'Card sub-heading',        sel: '.achv-table-card h3' },
    { id: 'show-more-btn',     pages: ALL_PAGES, tier: 't6', bold: false, label: 'Show all/top button',     sel: '.show-more-btn' },
    { id: 'tab-button',        pages: ALL_PAGES, tier: 't6', bold: false, label: 'Tab button',              sel: '.achv-tab' },
    { id: 'export-controls',   pages: ALL_PAGES, tier: 't7', bold: false, label: 'Image-export controls',   sel: '.pdf-export-btn, .img-export-btn, .img-export-label' },
    { id: 'retired-badge',     pages: ALL_PAGES, tier: 't7', bold: false, label: 'Retired badge',           sel: '.retired-badge' },

    // ── Nav (cross-page) ──
    { id: 'nav-home',          pages: ALL_PAGES, tier: 't5', bold: true,  label: 'Nav: home (brand)',       sel: '.nav-home' },
    { id: 'nav-search-input',  pages: ALL_PAGES, tier: 't5', bold: false, label: 'Nav: search input',       sel: '.nav-search input' },
    { id: 'nav-result-name',   pages: ALL_PAGES, tier: 't6', bold: true,  label: 'Nav: result player name', sel: '.nav-search-results .search-player-name' },
    { id: 'nav-result-real',   pages: ALL_PAGES, tier: 't6', bold: false, label: 'Nav: result real name',   sel: '.nav-search-results .search-player-realname' },
    { id: 'nav-result-hint',   pages: ALL_PAGES, tier: 't7', bold: false, label: 'Nav: result hint',        sel: '.nav-search-results .search-league-hint' },
    { id: 'nav-leagues-btn',   pages: ALL_PAGES, tier: 't6', bold: false, label: 'Nav: Leagues button',     sel: '.nav-leagues-btn' },
    { id: 'nav-dropdown-link', pages: ALL_PAGES, tier: 't6', bold: false, label: 'Nav: dropdown link',      sel: '.nav-leagues-dropdown a' },
    { id: 'nav-dropdown-sec',  pages: ALL_PAGES, tier: 't7', bold: true,  label: 'Nav: dropdown section',   sel: '.nav-leagues-dropdown .dropdown-section' },
    { id: 'nav-admin-label',   pages: ALL_PAGES, tier: 't7', bold: false, label: 'Nav: admin badge',        sel: '.nav-admin-label, .nav-admin-name' },
    { id: 'breadcrumbs',       pages: ALL_PAGES, tier: 't6', bold: false, label: 'Breadcrumbs',             sel: '.breadcrumbs ol' },

    // ── Stat cards (shared by index + dashboard) ──
    { id: 'stat-numbers',      pages: ALL_PAGES, tier: 't2', bold: true,  label: 'Stat numbers',            sel: '.dash-card-value' },
    { id: 'stat-labels',       pages: ALL_PAGES, tier: 't6', bold: false, label: 'Stat labels',             sel: '.dash-card-label' },

    // ── Index page ──
    { id: 'league-card-title', pages: ['index'], tier: 't4', bold: true,  label: 'League-card title',       sel: '.league-card-title' },
    { id: 'league-card-body',  pages: ['index'], tier: 't5', bold: false, label: 'League-card meta+leader', sel: '.league-card-meta, .league-card-leader' },

    // ── Tables (per page) ──
    // A1-A6 — index
    { id: 'a1-table', pages: ['index'], tier: 't5', bold: false, label: 'A1 — Completed Leagues', sel: '[data-mf-table-id="A1"] th, [data-mf-table-id="A1"] td', isTable: true, tableSel: '[data-mf-table-id="A1"]' },
    { id: 'a2-table', pages: ['index'], tier: 't5', bold: false, label: 'A2 — Annual Leaderboard', sel: '[data-mf-table-id="A2"] th, [data-mf-table-id="A2"] td', isTable: true, tableSel: '[data-mf-table-id="A2"]' },
    { id: 'a3-table', pages: ['index'], tier: 't6', bold: false, label: 'A3 — Achievements',       sel: '[data-mf-table-id="A3"] th, [data-mf-table-id="A3"] td', isTable: true, tableSel: '[data-mf-table-id="A3"]' },
    { id: 'a4-table', pages: ['index'], tier: 't6', bold: false, label: 'A4 — PR Leaders',         sel: '[data-mf-table-id="A4"] th, [data-mf-table-id="A4"] td', isTable: true, tableSel: '[data-mf-table-id="A4"]' },
    { id: 'a5-table', pages: ['index'], tier: 't6', bold: false, label: 'A5 — Match Records',      sel: '[data-mf-table-id="A5"] th, [data-mf-table-id="A5"] td', isTable: true, tableSel: '[data-mf-table-id="A5"]' },
    { id: 'a6-table', pages: ['index'], tier: 't6', bold: false, label: 'A6 — League Records',     sel: '[data-mf-table-id="A6"] th, [data-mf-table-id="A6"] td', isTable: true, tableSel: '[data-mf-table-id="A6"]' },

    // B1-B6 — dashboard
    // NOTE: dash-card-value/-label/-section-h2 were removed — they duplicated
    // stat-numbers / stat-labels / section-heading and produced cascade conflicts.
    { id: 'dash-controls',     pages: ['league'], tier: 't7', bold: false, label: 'Dashboard controls',      sel: '.dash-controls label, .dash-controls select, .dash-controls button' },
    { id: 'b1-table',          pages: ['league'], tier: 't5', bold: false, label: 'B1 — Prizes & Medals',   sel: '[data-mf-table-id="B1"] th, [data-mf-table-id="B1"] td', isTable: true, tableSel: '[data-mf-table-id="B1"]' },
    { id: 'b2-table',          pages: ['league'], tier: 't5', bold: false, label: 'B2 — Historical view',   sel: '[data-mf-table-id="B2"] th, [data-mf-table-id="B2"] td', isTable: true, tableSel: '[data-mf-table-id="B2"]' },
    { id: 'b3-table',          pages: ['league'], tier: 't5', bold: false, label: 'B3 — Championship Predictor', sel: '[data-mf-table-id="B3"] th, [data-mf-table-id="B3"] td', isTable: true, tableSel: '[data-mf-table-id="B3"]' },
    { id: 'b4-table',          pages: ['league'], tier: 't5', bold: false, label: 'B4 — What If Simulator', sel: '[data-mf-table-id="B4"] th, [data-mf-table-id="B4"] td', isTable: true, tableSel: '[data-mf-table-id="B4"]' },
    { id: 'b5-table',          pages: ['league'], tier: 't5', bold: false, label: 'B5 — Rounds',            sel: '[data-mf-table-id="B5"] th, [data-mf-table-id="B5"] td', isTable: true, tableSel: '[data-mf-table-id="B5"]' },
    { id: 'b6a-table',         pages: ['league'], tier: 't5', bold: false, label: 'B6a — All Remaining',    sel: '[data-mf-table-id="B6a"] th, [data-mf-table-id="B6a"] td', isTable: true, tableSel: '[data-mf-table-id="B6a"]' },
    { id: 'b6b-table',         pages: ['league'], tier: 't5', bold: false, label: 'B6b — Remaining Per Player', sel: '[data-mf-table-id="B6b"] th, [data-mf-table-id="B6b"] td', isTable: true, tableSel: '[data-mf-table-id="B6b"]' },
    { id: 'b6c-table',         pages: ['league'], tier: 't5', bold: false, label: 'B6c — Unplayed Opponents', sel: '[data-mf-table-id="B6c"] th, [data-mf-table-id="B6c"] td', isTable: true, tableSel: '[data-mf-table-id="B6c"]' },
    { id: 'forward-link',      pages: ['league', 'league_table'], tier: 't7', bold: false, label: 'Forward link',  sel: '.forward-link' },
    { id: 'league-nav-arrow',  pages: ['league', 'league_table'], tier: 't4', bold: false, label: 'League nav arrow', sel: '.league-nav .nav-arrow' },

    // C1-C5 — player_general
    { id: 'pg-player-alias',   pages: ['player'], tier: 't6', bold: false, label: 'Player alias',         sel: '.pg-player-alias' },
    { id: 'pg-card-h2',        pages: ['player'], tier: 't3', bold: true,  label: 'PG card heading',      sel: '.pg-card h2, .pg-card-title' },
    { id: 'pg-pr-label',       pages: ['player'], tier: 't7', bold: false, label: 'PR label',             sel: '.pg-pr-label' },
    { id: 'c0-rank',           pages: ['player'], tier: 't6', bold: false, label: 'C0 — Card expand (PR/Achv)', sel: '[data-mf-table-id="C0"] th, [data-mf-table-id="C0"] td', isTable: true, tableSel: '[data-mf-table-id="C0"]' },
    { id: 'c1-leagues',        pages: ['player'], tier: 't5', bold: false, label: 'C1 — Leagues',         sel: '[data-mf-table-id="C1"] th, [data-mf-table-id="C1"] td', isTable: true, tableSel: '[data-mf-table-id="C1"]' },
    { id: 'c2-matches',        pages: ['player'], tier: 't5', bold: false, label: 'C2 — Match History',   sel: '[data-mf-table-id="C2"] th, [data-mf-table-id="C2"] td', isTable: true, tableSel: '[data-mf-table-id="C2"]' },
    { id: 'c3-matchup',        pages: ['player'], tier: 't5', bold: false, label: 'C3 — Matchup (H2H)',   sel: '[data-mf-table-id="C3"] th, [data-mf-table-id="C3"] td', isTable: true, tableSel: '[data-mf-table-id="C3"]' },
    { id: 'c4-opponents',      pages: ['player'], tier: 't6', bold: false, label: 'C4 — All Opponents (H2H)', sel: '[data-mf-table-id="C4"] th, [data-mf-table-id="C4"] td', isTable: true, tableSel: '[data-mf-table-id="C4"]' },
    { id: 'c5-mr',             pages: ['player'], tier: 't6', bold: false, label: 'C5 — Match Records',   sel: '[data-mf-table-id="C5"] th, [data-mf-table-id="C5"] td', isTable: true, tableSel: '[data-mf-table-id="C5"]' },

    // D / E — league / per-league player tables (out of unification scope per TABLE-DESIGN, but still useful)
    { id: 'league-table',      pages: ['league_table'], tier: 't5', bold: false, label: 'D — League Table',          sel: '[data-mf-table-id="D"] th, [data-mf-table-id="D"] td', isTable: true, tableSel: '[data-mf-table-id="D"]' },
    { id: 'player-table',      pages: ['player_league'], tier: 't5', bold: false, label: 'E — Player Match History',  sel: '[data-mf-table-id="E"] th, [data-mf-table-id="E"] td', isTable: true, tableSel: '[data-mf-table-id="E"]' },

    // F1-F2 — admin
    { id: 'admin-h1',          pages: ['admin'], tier: 't2', bold: true,  label: 'Admin page H1',         sel: '.admin-main h1' },
    { id: 'admin-sidebar-h2',  pages: ['admin'], tier: 't4', bold: true,  label: 'Admin sidebar H2',      sel: '.admin-sidebar h2' },
    { id: 'admin-welcome-name',pages: ['admin'], tier: 't6', bold: false, label: 'Admin welcome name',    sel: '.admin-welcome-name' },
    { id: 'admin-welcome-label',pages: ['admin'],tier: 't7', bold: false, label: 'Admin welcome label',   sel: '.admin-welcome-label' },
    { id: 'admin-controls',    pages: ['admin'], tier: 't6', bold: false, label: 'Admin form controls',   sel: '.admin-card label, .admin-card select, .admin-card input, .admin-card button' },
    { id: 'admin-add-league-form', pages: ['admin'], tier: 't6', bold: false, label: 'Admin: Add League form', sel: '.add-league-row label, .add-league-row input, .add-league-row select' },
    { id: 'admin-staging',     pages: ['admin'], tier: 't7', bold: true,  label: 'Pending Changes badge', sel: '.staging-badge' },
    { id: 'admin-pending-desc',pages: ['admin'], tier: 't6', bold: false, label: 'Pending Changes — item description', sel: '.pending-item-desc' },
    { id: 'admin-pending-time',pages: ['admin'], tier: 't7', bold: false, label: 'Pending Changes — item time', sel: '.pending-item-time' },
    { id: 'admin-pending-h3',  pages: ['admin'], tier: 't4', bold: true,  label: 'Pending Changes — heading', sel: '.pending-panel h3' },
    { id: 'f1-table',          pages: ['admin'], tier: 't5', bold: false, label: 'F1 — Leagues admin',    sel: '.admin-table th, .admin-table td', isTable: true, tableSel: '.admin-table' },
    { id: 'f2-table',          pages: ['admin'], tier: 't6', bold: false, label: 'F2 — Round editor',     sel: '.admin-round-table th, .admin-round-table td', isTable: true, tableSel: '.admin-round-table' },
    { id: 'f6-table',          pages: ['admin'], tier: 't6', bold: false, label: 'F6 — Medals & Prizes',  sel: '[data-mf-table-id="F6"] th, [data-mf-table-id="F6"] td', isTable: true, tableSel: '[data-mf-table-id="F6"]' },

    // ── Dashboard extras (What-If Simulator, MoE, Open-full button) ──
    { id: 'open-full-btn',     pages: ['league'], tier: 't7', bold: false, label: 'Open Full Table button', sel: '.open-full-btn' },
    { id: 'whatif-input',      pages: ['league'], tier: 't6', bold: false, label: 'What-If: input',         sel: '.whatif-input, .whatif-vs' },
    { id: 'whatif-buttons',    pages: ['league'], tier: 't6', bold: false, label: 'What-If: buttons',       sel: '.whatif-add-btn, .whatif-run-btn, .whatif-clear-btn' },
    { id: 'whatif-row',        pages: ['league'], tier: 't6', bold: false, label: 'What-If: row text',      sel: '.whatif-row, .whatif-empty, .whatif-err' },
    { id: 'whatif-info-popup', pages: ['league'], tier: 't6', bold: false, label: 'What-If: info popup',    sel: '.whatif-info-popup p, .whatif-info-popup ul, .whatif-info-popup li' },
    { id: 'whatif-info-h4',    pages: ['league'], tier: 't4', bold: true,  label: 'What-If: info popup heading', sel: '.whatif-info-popup h4' },
    { id: 'predictor-moe',     pages: ['league'], tier: 't7', bold: false, label: 'Margin of Error (MoE)',  sel: '.predictor-moe' }
];

/* ── State ─────────────────────────────────────────────── */

const STATE_KEY    = 'shabi-typo-editor-state';
const ADD_KEY      = 'shabi-typo-additions';
const IGNORE_KEY   = 'shabi-typo-ignore';
const VP_KEY       = 'shabi-typo-viewport';
const VP_ROT_KEY   = 'shabi-typo-viewport-rot';
const A11Y_KEY     = 'shabi-typo-a11y-scale';
const PRESET_KEY   = 'shabi-typo-preset';
const VERSIONS_KEY = 'shabi-typo-versions';

/* Device viewport simulation — 10 representative phones from the last 3 years
   plus iPhone 7 (per request) and 2 tablets. Width AND height are honoured so
   we don't only fake the narrow axis. CSS-pixel logical dimensions (matches
   what the browser reports as window.innerWidth/innerHeight on the device). */
const DEVICES = [
    { id: 'desktop',           label: 'Desktop (full)',          group: 'desktop' },
    { id: 'ipad',              label: 'iPad',                    group: 'tablet', w: 820, h: 1180 },
    { id: 'ipad-mini',         label: 'iPad Mini',               group: 'tablet', w: 768, h: 1024 },
    { id: 'iphone-14',         label: 'iPhone 13/14',            group: 'mobile', w: 390, h: 844 },
    { id: 'iphone-15-pro',     label: 'iPhone 15 Pro',           group: 'mobile', w: 393, h: 852 },
    { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max',       group: 'mobile', w: 430, h: 932 },
    { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max',       group: 'mobile', w: 440, h: 956 },
    { id: 'iphone-17',         label: 'iPhone 17',               group: 'mobile', w: 402, h: 874 },
    { id: 'galaxy-s22',        label: 'Samsung Galaxy S22',      group: 'mobile', w: 360, h: 780 },
    { id: 'galaxy-s23-ultra',  label: 'Samsung Galaxy S23 Ultra',group: 'mobile', w: 384, h: 824 },
    { id: 'galaxy-s24',        label: 'Samsung Galaxy S24',      group: 'mobile', w: 360, h: 780 },
    { id: 'galaxy-s25-63',     label: 'Samsung Galaxy S25 (6.3″)',  group: 'mobile', w: 360, h: 780 },
    { id: 'galaxy-s25-67',     label: 'Samsung Galaxy S25+ (6.7″)', group: 'mobile', w: 384, h: 832 },
    { id: 'galaxy-s26-63',     label: 'Samsung Galaxy S26 (6.3″)',  group: 'mobile', w: 360, h: 780 },
    { id: 'galaxy-s26-67',     label: 'Samsung Galaxy S26+ (6.7″)', group: 'mobile', w: 384, h: 832 },
    { id: 'galaxy-zfold5',     label: 'Galaxy Z Fold 5 (folded)',group: 'mobile', w: 344, h: 882 },
    { id: 'pixel-8',           label: 'Google Pixel 8',          group: 'mobile', w: 412, h: 915 }
];
const DEVICE_BY_ID = Object.fromEntries(DEVICES.map(d => [d.id, d]));

function resolveDevice(id) {
    if (DEVICE_BY_ID[id]) return DEVICE_BY_ID[id];
    // Back-compat: previous 3-mode toggle + retired iPhone 7
    if (id === 'tablet') return DEVICE_BY_ID['ipad-mini'];
    if (id === 'mobile' || id === 'iphone-7') return DEVICE_BY_ID['iphone-14'];
    return DEVICE_BY_ID['desktop'];
}

let state = null;          // { sizes, groups: {id: {tier,bold}}, tableBolds: {id: [scope]} }
let additions = {};        // { selector: {label, tier, bold, isTable?, pages: [page]} }
let ignoreList = [];       // [selector]
let pendingReview = [];    // [{selector, fontSize, sample}]
let fileHandle = null;     // FileSystemFileHandle
let activeMenu = null;
let lastHoveredEl = null;
let tooltipEl = null;
let currentPage = 'index';
let iframeEl = null;       // <iframe> in shell
let ifd = null;            // iframe.contentDocument shortcut (refreshed per-page)
let observer = null;       // MutationObserver attached inside iframe
let viewport = 'desktop';  // device id from DEVICES
let viewportRot = false;   // true = landscape (swap width/height)
let a11yScale = 1;         // root-font multiplier — uniform across all devices
let versionsLog = [];      // append-only history of all saves

function defaultState(presetName) {
    const groups = {};
    for (const g of GROUPS) groups[g.id] = { tier: g.tier, bold: g.bold };
    const tableBolds = {};
    for (const g of GROUPS.filter(g => g.isTable)) tableBolds[g.id] = [];
    return { sizes: { ...PRESETS[presetName] }, groups, tableBolds };
}

function loadAllState() {
    const presetName = localStorage.getItem(PRESET_KEY) || 'a1';

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch {}
    if (saved) {
        const def = defaultState(presetName);
        // Backfill any newly-added groups
        for (const id of Object.keys(def.groups)) {
            if (!saved.groups[id]) saved.groups[id] = def.groups[id];
        }
        for (const id of Object.keys(def.tableBolds)) {
            if (!saved.tableBolds[id]) saved.tableBolds[id] = [];
        }
        if (!saved.sizes) saved.sizes = { ...PRESETS[presetName] };
        state = saved;
    } else {
        state = defaultState(presetName);
    }

    try { additions = JSON.parse(localStorage.getItem(ADD_KEY) || '{}'); } catch { additions = {}; }
    try { ignoreList = JSON.parse(localStorage.getItem(IGNORE_KEY) || '[]'); } catch { ignoreList = []; }

    viewport = localStorage.getItem(VP_KEY) || 'desktop';
    try { viewportRot = localStorage.getItem(VP_ROT_KEY) === '1'; } catch { viewportRot = false; }
    try {
        const a = parseFloat(localStorage.getItem(A11Y_KEY) || '1');
        a11yScale = isFinite(a) && a > 0 ? a : 1;
    } catch { a11yScale = 1; }
    loadVersionsFromLocalStorage();
}

function persistState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }
function persistAdditions() { try { localStorage.setItem(ADD_KEY, JSON.stringify(additions)); } catch {} }
function persistIgnoreList() { try { localStorage.setItem(IGNORE_KEY, JSON.stringify(ignoreList)); } catch {} }
function persistViewport() { try { localStorage.setItem(VP_KEY, viewport); } catch {} }
function persistViewportRot() { try { localStorage.setItem(VP_ROT_KEY, viewportRot ? '1' : '0'); } catch {} }
function persistA11y() { try { localStorage.setItem(A11Y_KEY, String(a11yScale)); } catch {} }
function persistPreset(p) { try { localStorage.setItem(PRESET_KEY, p); } catch {} }
function persistVersions() { try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(versionsLog)); } catch {} }

function loadVersionsFromLocalStorage() {
    try { versionsLog = JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]'); } catch { versionsLog = []; }
}

function appendVersion(label) {
    const entry = {
        timestamp: new Date().toISOString(),
        label: label || `Save ${new Date().toLocaleString()}`,
        preset: localStorage.getItem(PRESET_KEY) || 'a1',
        sizes: { ...state.sizes },
        groups: JSON.parse(JSON.stringify(state.groups)),
        tableBolds: JSON.parse(JSON.stringify(state.tableBolds)),
        additions: JSON.parse(JSON.stringify(additions))
    };
    versionsLog.push(entry);
    persistVersions();
    return entry;
}

function restoreVersion(idx) {
    const v = versionsLog[idx];
    if (!v) return;
    state.sizes = { ...v.sizes };
    state.groups = JSON.parse(JSON.stringify(v.groups));
    state.tableBolds = JSON.parse(JSON.stringify(v.tableBolds || {}));
    if (v.additions) additions = JSON.parse(JSON.stringify(v.additions));
    persistState();
    persistAdditions();
    persistPreset(v.preset || 'custom');
    const ps = document.querySelector('.te-preset-select');
    if (ps) ps.value = v.preset || 'custom';
    injectOverridesIntoIframe();
    renderSidebar();
    renderHistoryList();
    setStatus(`Restored: ${v.label} (not yet saved — click Save to commit a new version)`);
}

/* ── Page detection ────────────────────────────────────── */

function pageFromUrl(url) {
    try {
        const u = new URL(url, location.href);
        const path = u.pathname.replace(/^\/+/, '');
        const file = path.split('/').pop() || 'index.html';
        const base = file.replace(/\.html$/, '') || 'index';
        return PAGES.includes(base) ? base : 'index';
    } catch { return 'index'; }
}

function groupsForPage(page) {
    return GROUPS.filter(g => g.pages === ALL_PAGES || g.pages.includes(page));
}

function additionsForPage(page) {
    return Object.entries(additions)
        .filter(([_, a]) => !a.pages || a.pages.includes(page) || a.pages === ALL_PAGES)
        .map(([sel, a]) => ({ id: 'add::' + sel, sel, ...a, isAddition: true }));
}

/* ── CSS generation ────────────────────────────────────── */

function buildCss({ forSave = false } = {}) {
    const lines = [];
    if (forSave) {
        lines.push(`/* typography-overrides.css — generated ${new Date().toISOString()} by typo-editor.html`);
        lines.push(`   Loaded LAST in every page's CSS chain so its rules win.`);
        lines.push(`   All sizes in rem. Fluid scaling via root html { clamp() }. */`);
        lines.push('');
        // Embed version log as a parsable comment block. The editor reads this
        // back from the file on next open to restore history across sessions.
        lines.push('/* TYPOGRAPHY-EDITOR-VERSIONS-BEGIN');
        lines.push(JSON.stringify(versionsLog, null, 2));
        lines.push('TYPOGRAPHY-EDITOR-VERSIONS-END */');
        lines.push('');
    }
    // Preview-only: simulate OS / browser accessibility zoom by scaling the root
    // clamp() against a11yScale. NOT written to the saved file — that file is the
    // typography artefact, the a11y zoom is a runtime simulator.
    if (!forSave && a11yScale && Math.abs(a11yScale - 1) > 0.001) {
        lines.push(`/* Accessibility simulator — root font-size ×${a11yScale} */`);
        lines.push(`html { font-size: calc(clamp(0.8125em, calc(0.75em + 0.3vw), 0.9375em) * ${a11yScale}) !important; }`);
        lines.push('');
    }

    lines.push(':root {');
    for (const t of TIERS) {
        const note = t === 't5' ? '  /* .font-large (C1) */' : t === 't6' ? '  /* .font-small (C4) */' : '';
        lines.push(`    --fs-${t}: ${state.sizes[t]};${note}`);
    }
    lines.push('}');
    lines.push('');

    // All groups (manual + additions)
    const allGroups = [
        ...GROUPS.map(g => ({ ...g, fromManual: true })),
        ...Object.entries(additions).map(([sel, a]) => ({ id: 'add::' + sel, sel, ...a, isAddition: true }))
    ];
    for (const g of allGroups) {
        const gs = (state.groups[g.id]) || { tier: g.tier || 't5', bold: !!g.bold };
        const weight = gs.bold ? 700 : 400;
        const tag = g.isAddition ? '[user-added]' : '';
        lines.push(`/* ${g.label || g.sel} (${gs.tier.toUpperCase()}, ${gs.bold ? 'bold' : 'regular'}) ${tag} */`);
        const selFmt = g.sel.split(',').map(s => s.trim()).join(',\n');
        lines.push(`${selFmt} { font-size: var(--fs-${gs.tier}) !important; font-weight: ${weight} !important; }`);
        lines.push('');
    }

    // Table bold-cell scopes
    for (const g of GROUPS.filter(g => g.isTable)) {
        const list = state.tableBolds[g.id] || [];
        if (!list.length) continue;
        lines.push(`/* Bold overrides — ${g.label} */`);
        for (const scope of list) {
            lines.push(`${scopeToSelector(g.tableSel, scope)} { font-weight: 700 !important; }`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function scopeToSelector(tableSel, scope) {
    if (scope.type === 'col-with-header') {
        return `${tableSel} tbody td:nth-child(${scope.n}),\n${tableSel} thead th:nth-child(${scope.n})`;
    }
    if (scope.type === 'col-no-header') {
        return `${tableSel} tbody td:nth-child(${scope.n})`;
    }
    if (scope.type === 'row') {
        if (scope.header) return `${tableSel} thead tr th`;
        return `${tableSel} tbody tr:nth-child(${scope.n}) td`;
    }
    return '';
}

function injectOverridesIntoIframe() {
    if (!ifd) return;
    let style = ifd.getElementById('typo-editor-overrides');
    if (!style) {
        style = ifd.createElement('style');
        style.id = 'typo-editor-overrides';
        ifd.head.appendChild(style);
    }
    style.textContent = buildCss({ forSave: false });
}

/* ── DOM walking inside iframe ───────────────────────── */

function findGroupForElement(el) {
    if (!el) return null;
    let node = el;
    const candidates = [...groupsForPage(currentPage), ...additionsForPage(currentPage)];
    while (node && node !== ifd.body) {
        for (const g of candidates) {
            try { if (node.matches && node.matches(g.sel)) return g; } catch {}
        }
        node = node.parentElement;
    }
    return null;
}

/* Build a sensible CSS selector for any element, used when an element is NOT
   covered by the manual registry or any user-added rule (ad-hoc fallback). */
function generateSelectorForElement(el) {
    if (!el || !ifd) return null;
    if (el.id) return '#' + el.id;
    const elClasses = classListClean(el);
    if (elClasses.length) return '.' + elClasses[0];

    // Walk up to find a useful parent anchor, then qualify with the element's tag
    const tag = el.tagName.toLowerCase();
    let parent = el.parentElement;
    while (parent && parent !== ifd.body) {
        if (parent.id) return `#${parent.id} ${tag}`;
        const pClasses = classListClean(parent);
        if (pClasses.length) return `.${pClasses[0]} ${tag}`;
        parent = parent.parentElement;
    }
    return tag;
}

function classListClean(el) {
    const cn = el && el.className;
    if (typeof cn !== 'string') return [];
    return cn.trim().split(/\s+/).filter(Boolean).filter(c => !c.startsWith('te-'));
}

function elementBriefLabel(el) {
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return text ? `"${text}${(el.textContent || '').trim().length > 30 ? '…' : ''}"` : '';
}

/* Returns an ad-hoc group object built on the fly for an unregistered element.
   The group has isAdHoc=true so that the first config change "promotes" it
   into a persistent user-addition automatically. */
function makeAdHocGroup(el) {
    const sel = generateSelectorForElement(el);
    if (!sel) return null;
    // If a user-addition already exists for this selector, surface it (already in additions)
    if (additions[sel]) {
        return { id: 'add::' + sel, sel, ...additions[sel], isAddition: true };
    }
    const brief = elementBriefLabel(el);
    return {
        id: 'add::' + sel,
        sel,
        label: brief ? `${sel} ${brief}` : sel,
        tier: 't5',
        bold: false,
        isAdHoc: true,
        pages: [currentPage]
    };
}

function findTableContext(el) {
    if (!el) return null;
    let node = el;
    let cell = null;
    while (node && node !== ifd.body) {
        if (node.tagName === 'TD' || node.tagName === 'TH') { cell = node; break; }
        node = node.parentElement;
    }
    if (!cell) return null;
    const tableEl = cell.closest('table');
    if (!tableEl) return null;
    const tableGroup = groupsForPage(currentPage).find(g => g.isTable && tableEl.matches(g.tableSel));
    if (!tableGroup) return null;
    const row = cell.parentElement;
    const isHeader = cell.tagName === 'TH' || row.parentElement.tagName === 'THEAD';
    let colIndex = 1, n = cell;
    while ((n = n.previousElementSibling)) colIndex++;
    let rowIndex = 0;
    if (!isHeader && row.parentElement.tagName === 'TBODY') {
        rowIndex = 1;
        let r = row;
        while ((r = r.previousElementSibling)) rowIndex++;
    }
    return { group: tableGroup, tableEl, colIndex, rowIndex, isHeader };
}

function findMatchingAncestor(el, selector) {
    let n = el;
    while (n && n !== ifd.body) {
        try { if (n.matches && n.matches(selector)) return n; } catch {}
        n = n.parentElement;
    }
    return null;
}

/* ── CSS scanner — auto-detect rules with font-size ─────── */

function selectorAlreadyKnown(selector) {
    const all = [...groupsForPage(currentPage), ...additionsForPage(currentPage)];
    return all.some(g => g.sel.split(',').map(s => s.trim()).includes(selector.trim()))
        || ignoreList.includes(selector.trim());
}

function looksLikeIcon(rule) {
    // Skip rules that are obviously about icons / pixels and not body text.
    const fs = (rule.style.fontSize || '').toLowerCase();
    if (!fs) return true;
    if (fs.endsWith('px')) return true;             // pixel-only — likely icon size
    if (fs.includes('em') && parseFloat(fs) <= 0.7) return true; // tiny em — likely badge
    return false;
}

function selectorOnPage(selector) {
    try { return ifd.querySelectorAll(selector).length > 0; } catch { return false; }
}

function scanIframeStylesheets() {
    pendingReview = [];
    if (!ifd) return;
    const seen = new Set();
    for (const sheet of ifd.styleSheets || []) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }   // cross-origin
        if (!rules) continue;
        for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            if (!rule.style.fontSize) continue;
            if (looksLikeIcon(rule)) continue;
            const selector = rule.selectorText.trim();
            if (selectorAlreadyKnown(selector)) continue;
            if (!selectorOnPage(selector)) continue;          // only surface what's actually on this page
            if (seen.has(selector)) continue;
            seen.add(selector);
            pendingReview.push({ selector, fontSize: rule.style.fontSize });
        }
    }
    updatePendingBell();
}

function updatePendingBell() {
    const bell = document.querySelector('.te-pending');
    if (!bell) return;
    if (pendingReview.length === 0) { bell.hidden = true; return; }
    bell.hidden = false;
    const count = bell.querySelector('.te-pending-count');
    if (count) count.textContent = pendingReview.length;
}

/* ── Sidebar render ────────────────────────────────────── */

function buildSidebarShell() {
    // Wire the static elements that exist in typo-editor.html
    document.querySelector('.te-page-select').value = currentPage + '.html';
    document.querySelector('.te-page-select').addEventListener('change', e => {
        const page = e.target.value;
        navigateIframeTo(page);
    });

    document.querySelector('.te-preset-select').value = localStorage.getItem(PRESET_KEY) || 'a1';
    document.querySelector('.te-preset-select').addEventListener('change', e => {
        const v = e.target.value;
        persistPreset(v);
        if (v !== 'custom') {
            state.sizes = { ...PRESETS[v] };
            persistState();
            injectOverridesIntoIframe();
            renderScale();
        }
    });

    document.querySelector('.te-reset').addEventListener('click', () => {
        if (!confirm('Reset all typography settings to current preset defaults?')) return;
        const presetName = (localStorage.getItem(PRESET_KEY) || 'a1');
        const p = (presetName === 'custom') ? 'a1' : presetName;
        state = defaultState(p);
        persistState();
        injectOverridesIntoIframe();
        renderSidebar();
    });

    document.querySelector('.te-save').addEventListener('click', saveOverrides);

    document.querySelector('.te-pending').addEventListener('click', openReviewDialog);

    document.querySelector('.te-scale-toggle').addEventListener('click', () => {
        const rows = document.querySelector('.te-scale-rows');
        const open = !rows.hidden;
        rows.hidden = open;
        document.querySelector('.te-scale-toggle').textContent = open ? 'Edit scale ▾' : 'Edit scale ▴';
    });

    document.querySelector('.te-history-toggle').addEventListener('click', () => {
        const list = document.querySelector('.te-history-list');
        const open = !list.hidden;
        list.hidden = open;
        const btn = document.querySelector('.te-history-toggle');
        btn.innerHTML = `History (<span class="te-history-count">${versionsLog.length}</span>) ${open ? '▾' : '▴'}`;
        if (!open) renderHistoryList();
    });

    // Accessibility (uniform font-size scale across all devices)
    const a11ySel = document.querySelector('.te-a11y-select');
    if (a11ySel) {
        a11ySel.value = String(a11yScale);
        a11ySel.addEventListener('change', e => {
            a11yScale = parseFloat(e.target.value) || 1;
            persistA11y();
            injectOverridesIntoIframe();
            const pct = Math.round(a11yScale * 100);
            setStatus(`A11y zoom: ${pct}% (uniform across all devices).`);
        });
    }

    // Device picker + rotate
    const deviceSel = document.querySelector('.te-device-select');
    if (deviceSel) {
        deviceSel.addEventListener('change', e => {
            viewportRot = false;          // reset rotation when switching devices
            persistViewportRot();
            setViewport(e.target.value);
        });
    }
    const rotBtn = document.querySelector('.te-vp-rotate');
    if (rotBtn) {
        rotBtn.addEventListener('click', () => {
            const dev = resolveDevice(viewport);
            if (dev.group === 'desktop') return; // rotation has no effect on full desktop
            viewportRot = !viewportRot;
            persistViewportRot();
            setViewport(viewport);
        });
    }
    setViewport(viewport, /*initial*/ true);
}

function setViewport(deviceId, initial = false) {
    const device = resolveDevice(deviceId);
    viewport = device.id;
    persistViewport();

    const sel = document.querySelector('.te-device-select');
    if (sel) sel.value = device.id;

    const rotBtn = document.querySelector('.te-vp-rotate');
    if (rotBtn) {
        rotBtn.disabled = device.group === 'desktop';
        rotBtn.classList.toggle('active', viewportRot && device.group !== 'desktop');
    }

    const wrap = document.querySelector('.te-frame-wrap');
    if (wrap) {
        wrap.dataset.vp = device.group;
        if (device.group === 'desktop') {
            wrap.style.width = '';
            wrap.style.height = '';
            wrap.style.maxWidth = '';
            wrap.style.maxHeight = '';
        } else {
            const w = viewportRot ? device.h : device.w;
            const h = viewportRot ? device.w : device.h;
            wrap.style.width = w + 'px';
            wrap.style.height = h + 'px';
            wrap.style.maxWidth = w + 'px';
            wrap.style.maxHeight = h + 'px';
        }
    }
    if (!initial) {
        const orient = device.group === 'desktop' ? '' : (viewportRot ? ' (landscape)' : ' (portrait)');
        const dims = device.group === 'desktop' ? '' : ` — ${viewportRot ? device.h : device.w}×${viewportRot ? device.w : device.h}`;
        setStatus(`Device: ${device.label}${dims}${orient}.`);
    }
}

function renderSidebar() {
    renderScale();
    renderGroups();
    renderHistoryList();
}

function renderHistoryList() {
    const root = document.querySelector('.te-history-list');
    const count = document.querySelector('.te-history-count');
    if (count) count.textContent = versionsLog.length;
    if (!root) return;
    if (versionsLog.length === 0) {
        root.innerHTML = '<div class="te-empty">No saves yet. Click 💾 Save to commit a version.</div>';
        return;
    }
    // Newest first
    const items = versionsLog.slice().reverse();
    root.innerHTML = items.map((v, i) => {
        const realIdx = versionsLog.length - 1 - i;
        const ts = new Date(v.timestamp);
        const label = `v${realIdx + 1} — ${ts.toLocaleString()}`;
        const summary = `preset: ${v.preset || '?'}, sizes: T1=${v.sizes?.t1 || '?'}, ${Object.keys(v.groups || {}).length} groups`;
        return `
            <div class="te-history-item">
                <div class="te-history-meta">
                    <strong>${escapeHtml(label)}</strong>
                    <span class="te-history-summary">${escapeHtml(summary)}</span>
                </div>
                <button class="te-history-restore" data-idx="${realIdx}" type="button" title="Restore this version (preview only — Save to commit)">↺ Restore</button>
            </div>
        `;
    }).join('');
    root.querySelectorAll('.te-history-restore').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            if (confirm(`Restore to "${versionsLog[idx]?.label}"? Your current unsaved state will be replaced.`)) {
                restoreVersion(idx);
            }
        });
    });
}

function renderScale() {
    const root = document.querySelector('.te-scale-rows');
    if (!root) return;
    root.innerHTML = TIERS.map(t => `
        <div class="te-scale-row">
            <label>${TIER_LABELS[t]}</label>
            <input type="text" data-tier="${t}" value="${state.sizes[t]}" pattern="[0-9.]+rem" spellcheck="false">
        </div>
    `).join('');
    root.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => {
            const t = input.dataset.tier;
            const v = input.value.trim();
            if (!/^[0-9.]+rem$/.test(v)) { input.value = state.sizes[t]; return; }
            state.sizes[t] = v;
            persistPreset('custom');
            const ps = document.querySelector('.te-preset-select');
            if (ps) ps.value = 'custom';
            persistState();
            injectOverridesIntoIframe();
            renderGroups();
        });
    });
}

function renderGroups() {
    const root = document.querySelector('.te-groups');
    if (!root) return;
    const groups = groupsForPage(currentPage);
    const adds = additionsForPage(currentPage);
    const all = [...groups, ...adds];

    if (!all.length) {
        root.innerHTML = `<div class="te-empty-state">No editable rules registered for "${currentPage}". The auto-scanner will surface anything it finds in the bell above.</div>`;
        return;
    }

    const tierBuckets = TIERS.map(tier => ({
        tier,
        list: all.filter(g => (state.groups[g.id]?.tier || g.tier) === tier)
    }));

    root.innerHTML = tierBuckets.map(({ tier, list }) => `
        <details class="te-tier-section" ${list.length ? 'open' : ''} data-tier="${tier}">
            <summary>
                <span class="te-tier-title">${TIER_LABELS[tier]}</span>
                <span class="te-tier-size">${state.sizes[tier]}</span>
                <span class="te-tier-count">${list.length}</span>
            </summary>
            <div class="te-rule-list">
                ${list.map(g => renderRuleRow(g)).join('') || '<div class="te-empty">—</div>'}
            </div>
        </details>
    `).join('');

    root.querySelectorAll('.te-rule-row').forEach(row => bindRuleRow(row));
}

function renderRuleRow(g) {
    const gs = state.groups[g.id] || { tier: g.tier, bold: g.bold };
    if (!state.groups[g.id]) state.groups[g.id] = gs;
    const sizeOptions = TIERS.map(t => `<option value="${t}" ${gs.tier === t ? 'selected' : ''}>${TIER_LABELS[t]} — ${state.sizes[t]}</option>`).join('');
    const tableExtra = g.isTable
        ? `<div class="te-table-bolds"><div class="te-bolds-list">${renderBoldsList(g.id)}</div></div>`
        : `<label class="te-bold-toggle"><input type="checkbox" data-action="bold" ${gs.bold ? 'checked' : ''}> Bold</label>`;
    const userTag = g.isAddition
        ? `<span class="te-user-tag">user-added</span><button class="te-rule-remove" type="button" data-action="remove-addition" data-sel="${escapeHtml(g.sel)}" title="Remove this user-added rule">×</button>`
        : '';
    return `
        <div class="te-rule-row" data-group-id="${g.id}">
            <div class="te-rule-label">${escapeHtml(g.label)} ${userTag}</div>
            <select class="te-size-select" data-action="tier">${sizeOptions}</select>
            ${tableExtra}
        </div>
    `;
}

function renderBoldsList(groupId) {
    const list = state.tableBolds[groupId] || [];
    if (list.length === 0) return '<span class="te-bolds-empty">No bold scopes (right-click a cell)</span>';
    return list.map((s, i) => `
        <div class="te-bold-chip" data-idx="${i}">
            ${formatScope(s)}
            <button type="button" data-action="remove-scope" data-idx="${i}" title="Remove">×</button>
        </div>
    `).join('');
}

function formatScope(s) {
    if (s.type === 'col-with-header') return `Col ${s.n} (with header)`;
    if (s.type === 'col-no-header') return `Col ${s.n} (no header)`;
    if (s.type === 'row') return s.header ? 'Header row' : `Row ${s.n}`;
    return '';
}

function bindRuleRow(row) {
    const id = row.dataset.groupId;
    if (!state.groups[id]) state.groups[id] = { tier: 't5', bold: false };
    const gs = state.groups[id];

    row.querySelector('select[data-action="tier"]').addEventListener('change', e => {
        gs.tier = e.target.value;
        persistState();
        injectOverridesIntoIframe();
        renderGroups();
    });
    const boldToggle = row.querySelector('input[data-action="bold"]');
    if (boldToggle) {
        boldToggle.addEventListener('change', e => {
            gs.bold = e.target.checked;
            persistState();
            injectOverridesIntoIframe();
        });
    }
    row.querySelectorAll('button[data-action="remove-scope"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            if (state.tableBolds[id]) {
                state.tableBolds[id].splice(idx, 1);
                persistState();
                injectOverridesIntoIframe();
                renderGroups();
            }
        });
    });
    row.querySelectorAll('button[data-action="remove-addition"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sel = btn.dataset.sel;
            if (!confirm(`Remove user-added rule for "${sel}"?`)) return;
            delete additions[sel];
            delete state.groups['add::' + sel];
            persistAdditions();
            persistState();
            injectOverridesIntoIframe();
            renderGroups();
        });
    });
}

/* ── Right-click menu ──────────────────────────────────── */

function attachIframeListeners() {
    if (!ifd) return;
    injectInframeStyles();
    ifd.addEventListener('contextmenu', onContext, true);
    ifd.addEventListener('click', () => closeMenu());
    ifd.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    ifd.addEventListener('mousemove', onHoverMove);
    ifd.addEventListener('mouseleave', clearHover);
}

function injectInframeStyles() {
    // Hover outline + flash styles applied to elements INSIDE the iframe.
    let s = ifd.getElementById('typo-editor-iframe-styles');
    if (s) return;
    s = ifd.createElement('style');
    s.id = 'typo-editor-iframe-styles';
    s.textContent = `
        .te-hover { outline: 1px dashed #2563eb !important; outline-offset: 2px !important; }
        @keyframes te-flash-anim {
            0%   { background-color: rgba(251, 191, 36, 0.5); }
            100% { background-color: transparent; }
        }
        .te-flash { animation: te-flash-anim 1.6s ease-out !important; }
    `;
    ifd.head.appendChild(s);
}

function onContext(e) {
    if (e.shiftKey) return;  // pass-through to existing handlers
    const tableCtx = findTableContext(e.target);
    let group = tableCtx ? tableCtx.group : findGroupForElement(e.target);
    if (!group) {
        // No registered group matched anywhere up the chain — fall back to ad-hoc.
        // The user just clicked something we don't know about, so make it editable.
        group = makeAdHocGroup(e.target);
    }
    if (!group) return;

    e.preventDefault();
    e.stopPropagation();
    closeMenu();

    // Translate iframe-relative coords to outer-frame coords
    const iframeRect = iframeEl.getBoundingClientRect();
    const x = iframeRect.left + e.clientX;
    const y = iframeRect.top + e.clientY;
    showMenu(x, y, group, tableCtx);
}

function showMenu(x, y, group, tableCtx) {
    const menu = document.createElement('div');
    menu.className = 'te-context-menu';
    menu.dataset.groupId = group.id;
    if (!state.groups[group.id]) state.groups[group.id] = { tier: group.tier || 't5', bold: !!group.bold };
    const gs = state.groups[group.id];
    const sizeOptions = TIERS.map(t => `<option value="${t}" ${gs.tier === t ? 'selected' : ''}>${TIER_LABELS[t]} — ${state.sizes[t]}</option>`).join('');

    const adHocBadge = group.isAdHoc ? '<span class="te-adhoc-badge">new — choose to save</span>' : '';
    const selPreview = `<div class="te-cm-selector" title="CSS selector">${escapeHtml(group.sel)}</div>`;
    let html = `
        <div class="te-cm-header">${group.label || group.sel} ${adHocBadge}</div>
        ${selPreview}
        <label class="te-cm-row"><span>Size</span><select class="te-cm-size">${sizeOptions}</select></label>
    `;

    if (group.isTable && tableCtx) {
        const { colIndex, rowIndex, isHeader } = tableCtx;
        html += `
            <div class="te-cm-section-label">Bold scope (cell)</div>
            <label class="te-cm-row"><input type="radio" name="te-bold" value="none" checked> Regular</label>
            <label class="te-cm-row"><input type="radio" name="te-bold" value="col-with-header"> Whole column ${colIndex} <em>incl. header</em></label>
            <label class="te-cm-row"><input type="radio" name="te-bold" value="col-no-header"> Whole column ${colIndex} <em>excl. header</em></label>
            ${isHeader
                ? `<label class="te-cm-row"><input type="radio" name="te-bold" value="row-header"> Whole header row</label>`
                : `<label class="te-cm-row"><input type="radio" name="te-bold" value="row-${rowIndex}"> Whole row ${rowIndex}</label>`
            }
        `;
    } else {
        html += `<label class="te-cm-row"><input type="checkbox" class="te-cm-bold" ${gs.bold ? 'checked' : ''}> Bold</label>`;
    }

    menu.innerHTML = html;
    document.body.appendChild(menu);
    activeMenu = menu;

    const w = menu.offsetWidth, h = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(x, vw - w - 8) + 'px';
    menu.style.top  = Math.min(y, vh - h - 8) + 'px';

    // Ad-hoc promotion: first config change registers the group permanently.
    const promoteIfAdHoc = () => {
        if (!group.isAdHoc) return;
        additions[group.sel] = {
            label: group.label,
            tier: gs.tier,
            bold: gs.bold,
            pages: [currentPage]
        };
        persistAdditions();
        group.isAdHoc = false;
    };

    menu.querySelector('.te-cm-size').addEventListener('change', e => {
        gs.tier = e.target.value;
        promoteIfAdHoc();
        persistState();
        injectOverridesIntoIframe();
        renderGroups();
    });

    if (group.isTable && tableCtx) {
        // Pre-check the radio that matches an active scope at this cell, if any
        const activeScopes = state.tableBolds[group.id] || [];
        const matchingScope = activeScopes.find(s =>
            (s.type === 'col-with-header' && s.n === tableCtx.colIndex) ||
            (s.type === 'col-no-header'   && s.n === tableCtx.colIndex) ||
            (s.type === 'row' && s.header === true && tableCtx.isHeader) ||
            (s.type === 'row' && !s.header && s.n === tableCtx.rowIndex)
        );
        if (matchingScope) {
            const valueForScope =
                matchingScope.type === 'col-with-header' ? 'col-with-header' :
                matchingScope.type === 'col-no-header'   ? 'col-no-header' :
                matchingScope.header                     ? 'row-header'   :
                                                           `row-${tableCtx.rowIndex}`;
            const rb = menu.querySelector(`input[name="te-bold"][value="${valueForScope}"]`);
            if (rb) rb.checked = true;
        }
        menu.querySelectorAll('input[name="te-bold"]').forEach(rb => {
            rb.addEventListener('change', () => {
                if (!rb.checked) return;
                const v = rb.value;
                if (v === 'none') {
                    // Remove ALL scopes that affect this cell
                    state.tableBolds[group.id] = activeScopes.filter(s =>
                        !((s.type === 'col-with-header' && s.n === tableCtx.colIndex) ||
                          (s.type === 'col-no-header'   && s.n === tableCtx.colIndex) ||
                          (s.type === 'row' && s.header === true && tableCtx.isHeader) ||
                          (s.type === 'row' && !s.header && s.n === tableCtx.rowIndex))
                    );
                    persistState();
                    injectOverridesIntoIframe();
                    renderGroups();
                    closeMenu();
                    return;
                }
                let scope;
                if (v === 'col-with-header') scope = { type: 'col-with-header', n: tableCtx.colIndex };
                else if (v === 'col-no-header') scope = { type: 'col-no-header', n: tableCtx.colIndex };
                else if (v === 'row-header')  scope = { type: 'row', header: true };
                else if (v.startsWith('row-')) scope = { type: 'row', n: tableCtx.rowIndex };
                if (!scope) return;
                if (!state.tableBolds[group.id].some(s => sameScope(s, scope))) {
                    state.tableBolds[group.id].push(scope);
                    persistState();
                    injectOverridesIntoIframe();
                    renderGroups();
                }
                closeMenu();
            });
        });
    } else {
        const boldCb = menu.querySelector('.te-cm-bold');
        if (boldCb) {
            boldCb.addEventListener('change', e => {
                gs.bold = e.target.checked;
                promoteIfAdHoc();
                persistState();
                injectOverridesIntoIframe();
                renderGroups();
            });
        }
    }

    menu.addEventListener('click', e => e.stopPropagation());
    setTimeout(() => {
        document.addEventListener('click', closeMenu, { once: true });
    }, 0);
}

function sameScope(a, b) {
    return a.type === b.type && a.n === b.n && !!a.header === !!b.header;
}

function closeMenu() {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
}

/* ── Hover outline + tooltip ──────────────────────────── */

function ensureTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'te-tooltip';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function onHoverMove(e) {
    const tableCtx = findTableContext(e.target);
    let group = tableCtx ? tableCtx.group : findGroupForElement(e.target);
    let isAdHoc = false;
    if (!group) {
        // Try ad-hoc — show the user that ANY element is editable
        group = makeAdHocGroup(e.target);
        isAdHoc = group?.isAdHoc;
    }
    if (!group) {
        clearHover();
        return;
    }
    const target = findMatchingAncestor(e.target, group.sel.split(',')[0].trim()) || e.target;
    if (target !== lastHoveredEl) {
        if (lastHoveredEl) lastHoveredEl.classList.remove('te-hover');
        lastHoveredEl = target;
        if (target) target.classList.add('te-hover');
    }
    const gs = state.groups[group.id] || { tier: group.tier, bold: group.bold };
    const tooltip = ensureTooltip();
    const tableTag = tableCtx ? ` · col ${tableCtx.colIndex}${tableCtx.isHeader ? '' : `, row ${tableCtx.rowIndex}`}` : '';
    const adHocTag = isAdHoc ? ' · NEW (right-click to add)' : '';
    tooltip.textContent = `${group.label || group.sel} · ${gs.tier.toUpperCase()} (${state.sizes[gs.tier]})${tableTag}${adHocTag}`;
    const iframeRect = iframeEl.getBoundingClientRect();
    tooltip.style.left = (iframeRect.left + e.clientX + 12) + 'px';
    tooltip.style.top = (iframeRect.top + e.clientY + 12) + 'px';
    tooltip.style.display = 'block';
}

function clearHover() {
    if (lastHoveredEl) { lastHoveredEl.classList.remove('te-hover'); lastHoveredEl = null; }
    if (tooltipEl) tooltipEl.style.display = 'none';
}

/* ── Iframe management ─────────────────────────────────── */

/* Default URL parameters per page so the iframe actually renders content
   when the user picks a page from the sidebar dropdown. The active league
   and a sample player are best-effort defaults; the user can navigate inside
   the iframe to a different league/player at any time. */
const PAGE_DEFAULT_PARAMS = {
    'index.html':         '',
    'league.html':        '?league=Shabi%20Israel%20May%202026',
    'league_table.html':  '?league=Shabi%20Israel%20May%202026',
    'player.html':        '?player=YKwin',
    'player_league.html': '?league=Shabi%20Israel%20May%202026&player=YKwin',
    'admin.html':         ''
};

function navigateIframeTo(page) {
    if (!iframeEl) return;
    const params = PAGE_DEFAULT_PARAMS[page] !== undefined ? PAGE_DEFAULT_PARAMS[page] : '';
    iframeEl.src = page + params;
}

function bindIframe() {
    iframeEl = document.getElementById('te-iframe');
    iframeEl.addEventListener('load', onIframeLoad);
    // Safety: if iframe already finished loading before we attached, fire manually
    try {
        const doc = iframeEl.contentDocument;
        if (doc && doc.readyState === 'complete') setTimeout(onIframeLoad, 0);
    } catch {}
}

function onIframeLoad() {
    try {
        ifd = iframeEl.contentDocument;
    } catch (err) {
        setStatus('Cannot access iframe DOM (cross-origin?). Editor disabled.');
        return;
    }
    if (!ifd) { setStatus('Iframe content not available.'); return; }

    currentPage = pageFromUrl(iframeEl.contentWindow.location.href);
    document.querySelector('.te-page-select').value = currentPage + '.html';

    injectOverridesIntoIframe();
    attachIframeListeners();
    watchIframeMutations();
    scanIframeStylesheets();
    renderSidebar();
    setStatus(`Loaded ${currentPage}.html — right-click any text element.`);
}

function watchIframeMutations() {
    if (observer) try { observer.disconnect(); } catch {}
    observer = new MutationObserver(() => {
        injectOverridesIntoIframe();   // re-apply if dynamic content was added
    });
    observer.observe(ifd.body, { childList: true, subtree: true });
}

/* ── Save (FSAA + download fallback) ──────────────────── */

function setStatus(msg) {
    const el = document.querySelector('.te-status');
    if (el) el.textContent = msg;
}

async function saveOverrides() {
    // First save → pick file → also try to read back any pre-existing version log
    if (!fileHandle && window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'typography-overrides.css',
                types: [{ description: 'CSS file', accept: { 'text/css': ['.css'] } }]
            });
            await tryLoadVersionsFromFile();
        } catch (err) {
            if (err && err.name === 'AbortError') { setStatus('Save cancelled.'); return; }
            console.warn('Could not establish file handle:', err);
        }
    }

    // Append a new version entry BEFORE building CSS, so the saved file contains
    // its own history (including this save).
    const entry = appendVersion(`Save ${new Date().toLocaleString()}`);
    const css = buildCss({ forSave: true });
    const blob = new Blob([css], { type: 'text/css' });

    try {
        if (fileHandle) {
            const w = await fileHandle.createWritable();
            await w.write(blob);
            await w.close();
            renderHistoryList();
            setStatus(`Saved ✓ ${new Date().toLocaleTimeString()} (v${versionsLog.length}). Reload any regular page to see changes.`);
            return;
        }
    } catch (err) {
        console.warn('FSAA write failed, falling back to download:', err);
    }
    // Fallback: download the file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'typography-overrides.css';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    renderHistoryList();
    setStatus(`Downloaded v${versionsLog.length}. Replace css/typography-overrides.css with this file.`);
}

async function tryLoadVersionsFromFile() {
    if (!fileHandle) return;
    try {
        const file = await fileHandle.getFile();
        const text = await file.text();
        const m = text.match(/\/\*\s*TYPOGRAPHY-EDITOR-VERSIONS-BEGIN\s*([\s\S]*?)TYPOGRAPHY-EDITOR-VERSIONS-END\s*\*\//);
        if (!m) return;
        const log = JSON.parse(m[1].trim());
        if (!Array.isArray(log)) return;
        // Merge: prefer the file (canonical) over localStorage
        versionsLog = log;
        persistVersions();
        renderHistoryList();
    } catch {}
}

/* ── Review dialog (for newly-detected rules) ────────── */

function openReviewDialog() {
    const dlg = document.querySelector('.te-review-dialog');
    const backdrop = document.querySelector('.te-modal-backdrop');
    const list = dlg.querySelector('.te-review-list');
    if (pendingReview.length === 0) { setStatus('No new rules to review.'); return; }

    list.innerHTML = pendingReview.map((r, i) => `
        <div class="te-review-item" data-idx="${i}">
            <div class="te-review-sel"><code>${escapeHtml(r.selector)}</code></div>
            <div class="te-review-meta">in CSS: <code>${escapeHtml(r.fontSize)}</code>
                <button class="te-review-flash" type="button" data-idx="${i}">💡 Show in page</button>
            </div>
            <label class="te-review-name">Name: <input type="text" data-field="label" placeholder="${escapeHtml(r.selector)}" data-idx="${i}"></label>
            <label class="te-review-tier">Tier:
                <select data-field="tier" data-idx="${i}">
                    ${TIERS.map(t => `<option value="${t}">${TIER_LABELS[t]}</option>`).join('')}
                </select>
            </label>
            <label class="te-review-bold">
                <input type="checkbox" data-field="bold" data-idx="${i}"> Bold
            </label>
            <div class="te-review-actions">
                <button class="te-review-add"     type="button" data-idx="${i}">✓ Add</button>
                <button class="te-review-skip"    type="button" data-idx="${i}">⏭ Skip</button>
                <button class="te-review-ignore"  type="button" data-idx="${i}">🚫 Ignore forever</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.te-review-flash').forEach(b => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx, 10);
        flashSelector(pendingReview[idx].selector);
    }));
    list.querySelectorAll('.te-review-add').forEach(b => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx, 10);
        const item = pendingReview[idx];
        const labelInput = list.querySelector(`input[data-field="label"][data-idx="${idx}"]`);
        const tierSelect = list.querySelector(`select[data-field="tier"][data-idx="${idx}"]`);
        const boldCb = list.querySelector(`input[data-field="bold"][data-idx="${idx}"]`);
        additions[item.selector] = {
            label: labelInput.value.trim() || item.selector,
            tier: tierSelect.value,
            bold: !!boldCb.checked,
            pages: [currentPage]
        };
        persistAdditions();
        // Initialize state for the new group id
        const id = 'add::' + item.selector;
        state.groups[id] = { tier: tierSelect.value, bold: !!boldCb.checked };
        persistState();
        // Remove from pending
        pendingReview.splice(idx, 1);
        injectOverridesIntoIframe();
        renderGroups();
        if (pendingReview.length === 0) closeReviewDialog();
        else openReviewDialog();
    }));
    list.querySelectorAll('.te-review-skip').forEach(b => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx, 10);
        pendingReview.splice(idx, 1);
        if (pendingReview.length === 0) closeReviewDialog();
        else openReviewDialog();
        updatePendingBell();
    }));
    list.querySelectorAll('.te-review-ignore').forEach(b => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx, 10);
        const sel = pendingReview[idx].selector;
        if (!ignoreList.includes(sel)) ignoreList.push(sel);
        persistIgnoreList();
        pendingReview.splice(idx, 1);
        if (pendingReview.length === 0) closeReviewDialog();
        else openReviewDialog();
        updatePendingBell();
    }));

    dlg.querySelector('.te-review-close').onclick = closeReviewDialog;
    dlg.querySelector('.te-review-done').onclick = closeReviewDialog;
    backdrop.hidden = false;
    dlg.hidden = false;
    if (typeof dlg.showModal === 'function' && !dlg.open) try { dlg.showModal(); } catch {}
}

function closeReviewDialog() {
    const dlg = document.querySelector('.te-review-dialog');
    const backdrop = document.querySelector('.te-modal-backdrop');
    if (dlg && typeof dlg.close === 'function' && dlg.open) try { dlg.close(); } catch {}
    if (dlg) dlg.hidden = true;
    if (backdrop) backdrop.hidden = true;
}

function flashSelector(selector) {
    if (!ifd) return;
    let els;
    try { els = ifd.querySelectorAll(selector); } catch { return; }
    els.forEach(el => {
        el.classList.add('te-flash');
        setTimeout(() => el.classList.remove('te-flash'), 1800);
    });
    if (els.length) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Public entry ──────────────────────────────────────── */

export async function initTypoEditor() {
    loadAllState();
    bindIframe();
    buildSidebarShell();
    renderSidebar();
    setStatus('Initializing…');
    // The first iframe `load` event fires once the iframe finishes its initial src.
}
