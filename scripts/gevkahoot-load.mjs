#!/usr/bin/env node
/**
 * gevkahoot-load.mjs — a real quiz, played by twenty real browsers at once.
 *
 * Where gevkahoot-sim.mjs proves the server's logic with scripted calls, this
 * asks what twenty people would actually live through: every player is a real
 * browser page (Chrome, Edge, WebKit for the iPhone, Firefox; phones emulated
 * by screen, touch and user agent) that opens the quiz's page, joins through
 * the form, taps answers and throws at the basket with a real pointer — the
 * same code path as a person. A short quiz with very short times runs from
 * this script as the host:
 *
 *     question (8s) → basketball round (10s) → question ×2 (6s)
 *
 * and the script measures:
 *   - every server call each page made (time per function, failures),
 *   - how long after the host's step each page showed the new screen
 *     (the Realtime fan-out, as a person sees it),
 *   - tap → "נקלט" on a question, throw → feedback in the round,
 *   - console errors,
 * per browser family, and prints them as a table.
 *
 *     node scripts/gevkahoot-load.mjs --password-file <file>              local (Docker + :8090)
 *     node scripts/gevkahoot-load.mjs --password-file <file> --target cloud --yes   golan.me.uk
 *
 * The host's password is read from a FILE (outside the repo), never taken on
 * the command line — an approved command line is written to a tracked file.
 * Refuses to run while any quiz is on air. The quiz is ABORTED at the end
 * (not finished: nothing enters the archive) and deleted. Every page sets the
 * site's no-analytics flag before it loads anything.
 */
import fs from 'node:fs';
import { chromium, firefox, webkit, devices } from 'playwright';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } from '../shabi-israel/js/data/supabaseConfig.js';

// ---- arguments --------------------------------------------------------------
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(`--${name}`);
const TARGET = arg('target') || 'local';
const PW_FILE = arg('password-file');
const HEADED = flag('headed');
if (!['local', 'cloud'].includes(TARGET)) throw new Error('--target local|cloud');
if (!PW_FILE) { console.error('--password-file <file> is required (the host password, read from a file).'); process.exit(2); }
if (TARGET === 'cloud' && !flag('yes')) { console.error('A run against golan.me.uk writes to production: add --yes once you mean it.'); process.exit(2); }

const SITE = TARGET === 'cloud' ? 'https://golan.me.uk/gevkahoot/' : 'http://localhost:8090/gevkahoot/';
const API = TARGET === 'cloud' ? SUPABASE_URL : LOCAL_SUPABASE_URL;
const KEY = TARGET === 'cloud' ? SUPABASE_ANON_KEY : LOCAL_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = 'claude-demo@example.com';

// ---- the room: who plays on what ----------------------------------------------
const EDGE_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0';
const FIREFOX_ANDROID_UA = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const phoneLike = (d) => ({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, hasTouch: true });
const GROUPS = [
    { tag: 'Chrome Android', n: 5, engine: chromium, channel: 'chrome', ctx: (i) => devices[['Pixel 7', 'Galaxy S9+', 'Pixel 5'][i % 3]] },
    { tag: 'Edge Android', n: 3, engine: chromium, channel: 'msedge', ctx: () => ({ ...devices['Galaxy S9+'], userAgent: EDGE_ANDROID_UA }) },
    { tag: 'iPhone WebKit', n: 4, engine: webkit, ctx: (i) => devices[['iPhone 15 Pro Max', 'iPhone 13', 'iPhone SE'][i % 3]] },
    // Firefox has no isMobile: a phone's screen, touch and user agent.
    { tag: 'Firefox Android', n: 2, engine: firefox, ctx: () => ({ ...phoneLike(devices['Pixel 7']), userAgent: FIREFOX_ANDROID_UA }) },
    { tag: 'Chrome desktop', n: 3, engine: chromium, channel: 'chrome', ctx: () => ({ viewport: { width: 1366, height: 800 } }) },
    { tag: 'Edge desktop', n: 3, engine: chromium, channel: 'msedge', ctx: () => ({ viewport: { width: 1280, height: 760 } }) },
];
const N = GROUPS.reduce((n, g) => n + g.n, 0);

// ---- the host, over the REST API --------------------------------------------
let jwt = null;
async function signIn() {
    const password = fs.readFileSync(PW_FILE, 'utf8').trim();
    const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`host sign-in failed: ${body.error_description || body.msg || res.status}`);
    jwt = body.access_token;
}
const hdr = (auth = true) => ({ apikey: KEY, Authorization: `Bearer ${auth ? jwt : KEY}`, 'Content-Type': 'application/json' });
async function call(fn, args = {}) {
    const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(), body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn}: ${text}`);
    return text ? JSON.parse(text) : null;
}
async function rest(path, init = {}) {
    const res = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...hdr(init.auth !== false), Prefer: 'return=representation', ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path}: ${text}`);
    return text ? JSON.parse(text) : null;
}
const publicState = async () => (await rest('gk_public_state?id=eq.1&select=status,phase,rev,data', { auth: false }))[0];
const publicLive = async () => (await rest('gk_public_live?id=eq.1&select=players,answered', { auth: false }))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Steps of the host, each with the moment it took effect and the new rev. */
const steps = [];
async function step(label, fn, args) {
    await call(fn, args);
    const at = Date.now();
    const st = await publicState();
    steps.push({ label, at, rev: st.rev, phase: st.phase });
    return st;
}

// ---- what runs in each page -----------------------------------------------
/** Installed before the page's own scripts: the analytics opt-out, and the
 *  instruments — every RPC timed, every screen change stamped. */
function instrument() {
    try { localStorage.setItem('shabi:no-analytics', '1'); } catch { /* ignore */ }
    const m = (window.__gk = { rpc: [], views: [], errors: [], taps: [], fb: [], nofb: 0 });
    // Timed INSIDE the page, from the real press: a driver's own waits (a
    // click waits for the element to stop moving) are not the player's.
    let tapAt = null, throwAt = null, tries = null;
    document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.st-options button')) tapAt = Date.now(); }, true);
    document.addEventListener('pointerup', (e) => {
        if (!e.target.closest?.('.ac[data-live]')) return;
        if (throwAt) m.nofb += 1;          // the previous one never answered
        throwAt = Date.now(); tries = document.querySelector('.ac-tries')?.textContent;
    }, true);
    setInterval(() => {
        if (throwAt) {
            const now = document.querySelector('.ac-tries')?.textContent;
            if (now !== tries) { m.fb.push(Date.now() - throwAt); throwAt = null; }
            else if (Date.now() - throwAt > 5000) { m.nofb += 1; throwAt = null; }
        }
    }, 20);
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const name = /\/rest\/v1\/rpc\/(\w+)/.exec(url)?.[1] || (/\/rest\/v1\/(gk_public_\w+)/.exec(url)?.[1]);
        if (!name) return realFetch(input, init);
        const t0 = performance.now();
        try {
            const res = await realFetch(input, init);
            m.rpc.push({ name, ms: performance.now() - t0, ok: res.ok, status: res.status });
            return res;
        } catch (err) {
            m.rpc.push({ name, ms: performance.now() - t0, ok: false, status: 0 });
            throw err;
        }
    };
    addEventListener('error', (e) => m.errors.push(String(e.message)));
    addEventListener('unhandledrejection', (e) => m.errors.push(String(e.reason?.message || e.reason)));
    // The stage's main area carries its view key ("question|<id>|<rev>|…"):
    // its change is the moment this page SHOWS a new step.
    new MutationObserver((list) => {
        for (const r of list) {
            if (r.attributeName === 'data-tone' && r.target.classList?.contains('pl-strip') && r.target.dataset.tone === 'sent' && tapAt) {
                m.taps.push(Date.now() - tapAt); tapAt = null;
            }
            if (r.attributeName === 'data-view-key' && r.target.classList?.contains('st-main')) {
                m.views.push({ at: Date.now(), key: r.target.dataset.viewKey });
            }
        }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-view-key', 'data-tone'] });
}

// ---- a player: a loop that does what a person would ------------------------
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) / 3; };

function playerLoop(p, signal) {
    p.taps = []; p.throws = []; p.answered = new Set(); p.joined = false;
    return (async () => {
        while (!signal.done) {
            try {
                await turn(p);
            } catch (err) {
                if (!signal.done) p.loopErrors = (p.loopErrors || 0) + 1;
            }
            await sleep(120);
        }
    })();
}

async function turn(p) {
    const { page } = p;
    if (!p.joined) {
        const input = page.locator('input.gk-input');
        if (await input.count()) {
            await input.fill(p.name);
            await page.locator('form.pl-form button[type="submit"]').click();
            p.joined = true;
        }
        return;
    }
    // A question with tiles: answer once, after a human pause.
    const look = await page.evaluate(() => {
        const main = document.querySelector('.st-main');
        const key = main?.dataset.viewKey || '';
        const tiles = [...document.querySelectorAll('.st-options button.gk-tile')].filter((b) => !b.disabled);
        const court = document.querySelector('.ac[data-live]');
        const timer = document.querySelector('.st-timer');
        return { key, tiles: tiles.length, court: !!court, running: timer && !timer.hidden };
    });
    const id = look.key.split('|')[1];
    if (look.key.startsWith('question|') && look.tiles && !p.answered.has(id)) {
        p.answered.add(id);
        await sleep(rnd(400, 2600));
        const tiles = page.locator('.st-options button.gk-tile:not([disabled])');
        const n = await tiles.count();
        if (!n) return;
        await tiles.nth(Math.floor(Math.random() * n)).click({ timeout: 3000 });
        return;
    }
    if (look.court && look.running) {
        const box = await page.locator('.ac[data-live]').boundingBox();
        if (!box) return;
        // Aim and power with a person's scatter: about a third go in.
        const up = 0.325 + gauss() * 0.045, dx = gauss() * 0.022;
        const x0 = box.x + box.width * 0.5, y0 = box.y + box.height * 0.62;
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        for (let k = 1; k <= 6; k++) { await page.mouse.move(x0 + box.width * dx * k / 6, y0 - box.height * up * k / 6); await sleep(25); }
        await page.mouse.up();
        p.throws.push(1);
        await sleep(rnd(2300, 2900));   // the ball's flight and its return to the line
    }
}

// ---- the run --------------------------------------------------------------
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const fmt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}`);

const browsers = [];
const players = [];
let quizId = null;
let opened = false;
const signal = { done: false };

try {
    await signIn();
    const st0 = await publicState();
    if (st0 && st0.status !== 'idle') throw new Error(`a quiz is on air (${st0.status}/${st0.phase}) — refusing to run.`);

    // ---- the test quiz
    const [quiz] = await rest('gk_quizzes', { method: 'POST', body: JSON.stringify({ title: 'בדיקת עומס (נמחק אוטומטית)', lead_in_s: 2, music_on: false }) });
    quizId = quiz.id;
    await rest('gk_items', { method: 'POST', body: JSON.stringify([
        { quiz_id: quizId, position: 1, kind: 'question', title: 'שאלת עומס ראשונה', options: ['אחת', 'שתיים', 'שלוש', 'ארבע'], correct: [1], weight: 1, time_limit_s: 8, anim_on: false },
        { quiz_id: quizId, position: 2, kind: 'action', title: 'קליעות בעומס', options: [], correct: [], weight: 1, time_limit_s: 10, anim_on: false },
        { quiz_id: quizId, position: 3, kind: 'question', title: 'שאלת עומס שנייה', options: ['כן', 'לא', 'אולי'], correct: [0], weight: 2, time_limit_s: 6, anim_on: false },
        { quiz_id: quizId, position: 4, kind: 'question', title: 'שאלת עומס אחרונה', options: ['א', 'ב', 'ג', 'ד', 'ה'], correct: [4], weight: 1, time_limit_s: 6, anim_on: false },
    ]) });
    await call('gk_admin_open', { p_quiz: quizId });
    opened = true;
    console.log(`Quiz opened on ${TARGET}. Launching ${N} browsers…`);

    // ---- the room
    let k = 0;
    for (const g of GROUPS) {
        const browser = await g.engine.launch({ headless: !HEADED, ...(g.channel ? { channel: g.channel } : {}) });
        browsers.push(browser);
        for (let i = 0; i < g.n; i++) {
            const context = await browser.newContext({ ...g.ctx(i), locale: 'he-IL' });
            await context.addInitScript(instrument);
            const page = await context.newPage();
            const p = { group: g.tag, name: `בוט ${String(++k).padStart(2, '0')}`, page, console: [] };
            page.on('console', (msg) => { if (msg.type() === 'error') p.console.push(msg.text()); });
            page.on('pageerror', (err) => p.console.push(String(err.message)));
            players.push(p);
        }
    }
    const t0 = Date.now();
    await Promise.all(players.map((p) => p.page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 })));
    console.log(`All pages loaded in ${Date.now() - t0}ms. Joining…`);
    const loops = players.map((p) => playerLoop(p, signal));

    for (let i = 0; i < 120; i++) { if ((await publicLive()).players >= N) break; await sleep(500); }
    const joined = (await publicLive()).players;
    console.log(`${joined} of ${N} joined.`);

    // ---- the quiz, as a host runs it
    const untilAnsweredOrTime = async (st) => {
        const deadline = st.data.deadline;
        while (Date.now() < deadline + 1500) {
            const s = await publicState();
            if (s.phase !== 'question') return;        // revealed by itself
            await sleep(300);
        }
        await step('reveal (time)', 'gk_admin_reveal');
    };
    let st = await step('start → question 1', 'gk_admin_next');
    await untilAnsweredOrTime(st);
    await step('fastest', 'gk_admin_next');
    await step('table', 'gk_admin_next');
    st = await step('→ basketball (instructions)', 'gk_admin_next');
    await sleep(2500);
    st = await step('basketball starts', 'gk_admin_next');
    await sleep(Math.max(0, st.data.deadline - Date.now()) + 1200);
    await step('basketball reveal', 'gk_admin_reveal');
    await step('fastest', 'gk_admin_next');
    await step('table', 'gk_admin_next');
    for (let q = 2; q <= 3; q++) {
        st = await step(`→ question ${q}`, 'gk_admin_next');
        // the special slide may come first (the leader, before the last question)
        while (st.phase !== 'question') { await sleep(1500); st = await step('special slide → next', 'gk_admin_next'); }
        await untilAnsweredOrTime(st);
        await step('fastest', 'gk_admin_next');
        await step('table', 'gk_admin_next');
    }
    await sleep(1500);
} catch (err) {
    console.error(`\nRUN FAILED: ${err.message}`);
    process.exitCode = 1;
} finally {
    signal.done = true;
    // ---- collect
    for (const p of players) {
        try { p.m = await p.page.evaluate(() => window.__gk); } catch { p.m = null; }
    }
    // ---- clean up: abort (no archive), delete the quiz
    try { if (opened) await call('gk_admin_close'); } catch (err) { console.error(`close failed: ${err.message}`); }
    try { if (quizId) await rest(`gk_quizzes?id=eq.${quizId}`, { method: 'DELETE' }); } catch (err) { console.error(`delete failed: ${err.message}`); }
    for (const b of browsers) await b.close().catch(() => {});
}

// ---- report ---------------------------------------------------------------
const byGroup = new Map();
for (const p of players) { if (!byGroup.has(p.group)) byGroup.set(p.group, []); byGroup.get(p.group).push(p); }

console.log(`\n=== ${TARGET.toUpperCase()} · ${players.length} browsers · ${steps.length} host steps ===`);

// 1. how long each step took to reach each screen
const lags = (ps) => {
    const out = [];
    let missed = 0;
    for (const s of steps) {
        for (const p of ps) {
            const seen = p.m?.views.find((v) => v.at >= s.at - 50 && v.key.split('|').includes(String(s.rev)));
            if (seen) out.push(seen.at - s.at); else missed += 1;
        }
    }
    return { out, missed };
};
console.log('\nHost step → shown on the player\'s screen (ms)');
console.log('group'.padEnd(18), 'p50'.padStart(6), 'p95'.padStart(6), 'max'.padStart(6), 'missed'.padStart(7));
for (const [g, ps] of byGroup) {
    const { out, missed } = lags(ps);
    console.log(g.padEnd(18), fmt(pct(out, 0.5)).padStart(6), fmt(pct(out, 0.95)).padStart(6), fmt(pct(out, 1)).padStart(6), String(missed).padStart(7));
}

// 2. tap → "נקלט", throw → feedback
console.log('\nPlayer actions (ms)');
console.log('group'.padEnd(18), 'tap→נקלט p50'.padStart(13), 'p95'.padStart(6), 'throws'.padStart(7), 'fb p50'.padStart(7), 'fb p95'.padStart(7), 'no fb'.padStart(6));
for (const [g, ps] of byGroup) {
    const taps = ps.flatMap((p) => p.m?.taps || []);
    const fb = ps.flatMap((p) => p.m?.fb || []);
    const nofb = ps.reduce((n, p) => n + (p.m?.nofb || 0), 0);
    console.log(g.padEnd(18), fmt(pct(taps, 0.5)).padStart(13), fmt(pct(taps, 0.95)).padStart(6), String(fb.length + nofb).padStart(7),
        fmt(pct(fb, 0.5)).padStart(7), fmt(pct(fb, 0.95)).padStart(7), String(nofb).padStart(6));
}

// 3. server calls, all pages together
console.log('\nServer calls from the pages (ms)');
const calls = new Map();
for (const p of players) for (const c of p.m?.rpc || []) { if (!calls.has(c.name)) calls.set(c.name, []); calls.get(c.name).push(c); }
console.log('call'.padEnd(22), 'n'.padStart(5), 'p50'.padStart(6), 'p95'.padStart(6), 'max'.padStart(6), 'failed'.padStart(7));
for (const [name, cs] of [...calls].sort((a, b) => b[1].length - a[1].length)) {
    const ms = cs.map((c) => c.ms);
    const failed = cs.filter((c) => !c.ok);
    console.log(name.padEnd(22), String(cs.length).padStart(5), fmt(pct(ms, 0.5)).padStart(6), fmt(pct(ms, 0.95)).padStart(6), fmt(pct(ms, 1)).padStart(6),
        String(failed.length).padStart(7), failed.length ? ` (${[...new Set(failed.map((f) => f.status))].join(',')})` : '');
}

// 4. errors
console.log('\nErrors in the pages');
let anyErr = false;
for (const [g, ps] of byGroup) {
    const errs = ps.flatMap((p) => [...(p.console || []), ...(p.m?.errors || [])]);
    const loopErrs = ps.reduce((n, p) => n + (p.loopErrors || 0), 0);
    if (errs.length || loopErrs) {
        anyErr = true;
        console.log(`  ${g}: ${errs.length} console error(s)${loopErrs ? `, ${loopErrs} driver hiccup(s)` : ''}`);
        for (const e of [...new Set(errs)].slice(0, 5)) console.log(`     · ${e.slice(0, 200)}`);
    }
}
if (!anyErr) console.log('  none');
console.log('\nHost steps:', steps.map((s) => `${s.label} (rev ${s.rev})`).join(' · '));
