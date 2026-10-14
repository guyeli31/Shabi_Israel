#!/usr/bin/env node
/**
 * gevkahoot-layout-check.mjs — nothing on a GevKahoot screen is cut off.
 *
 * Why this exists: the leaderboard shipped with its names squeezed to nothing
 * and its points running off the edge on a tall phone. It had been "checked" —
 * by asking whether any element left the viewport. Nothing had: the text was
 * clipped by its own row, inside the viewport, and in a window taller than the
 * one that was tested. Both gaps are closed here:
 *
 *   · the question asked is "is any visible text or picture cut by ANY clipping
 *     ancestor", and "is a truncated label left with room for almost nothing";
 *   · it is asked of every stage of a quiz, for every audience, at several
 *     window shapes — including the tall-narrow and the short-wide ones.
 *
 * It drives the real pages in ?preview mode and feeds them the editor's mock
 * state (js/preview/mock.js), so no login and no database are involved. It
 * ends with a control: the old leaderboard sizing is put back and the check
 * must FAIL on it — a check that cannot fail proves nothing.
 *
 *     node scripts/gevkahoot-layout-check.mjs          (dev server must be up on :8090)
 *
 * Exits 1 listing every screen/size with a cut-off element.
 */
import { chromium } from 'playwright';

const BASE = process.env.GEVKAHOOT_BASE || 'http://localhost:8090/gevkahoot/';

const probe = await fetch(`${BASE}index.html`).catch(() => null);
if (!probe?.ok) {
    console.error(`Dev server not reachable at ${BASE} — from the repo root: npx http-server -p 8090 --cors -c-1`);
    process.exit(2);
}

/** audience × window shapes. `touch` is what makes a wide tablet "compact". */
const TARGETS = [
    { name: 'projected screen', page: 'host.html?preview', sizes: [[1280, 720], [1920, 1080], [1024, 768]] },
    { name: 'desktop player', page: 'index.html?preview', sizes: [[1280, 720], [1100, 650], [1600, 1000]] },
    { name: 'phone player', page: 'index.html?preview', touch: true, sizes: [[430, 950], [430, 739], [390, 844], [360, 640]] },
];
const VIEWS = ['lobby', 'intro', 'ready', 'item', 'reveal', 'explain', 'fastest', 'firstfire', 'leadfire', 'leaderboard', 'podium', 'matrix'];
const PER_ITEM = new Set(['intro', 'ready', 'item', 'reveal', 'explain']);

// ---- runs in the page ------------------------------------------------------
async function showAndAudit({ view, itemIndex, sabotage }) {
    const { mock } = await import('./js/preview/mock.js');
    const { DEMO_QUIZ, DEMO_ITEMS } = await import('./js/demo/demoQuiz.js');
    const selected = itemIndex === null ? null : DEMO_ITEMS[itemIndex];
    // A long name and a long question are the realistic worst case for width.
    const items = DEMO_ITEMS.map((it) => (it === selected && it.kind === 'question'
        ? { ...it, title: `${it.title} — וגם המשך ארוך במיוחד כדי לבדוק שבירת שורות במסך צר` } : it));
    const payload = mock(view, DEMO_QUIZ, selected && items[itemIndex], items);
    window.postMessage({ type: 'gk-preview', ...payload }, location.origin);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The table places rows at their old rank, then moves them 700ms later.
    await sleep(view === 'leaderboard' ? 950 : 250);
    // Jump every finite animation and transition to its end state: what is
    // audited is where things come to rest, not a frame of an entrance.
    for (const a of document.getAnimations()) {
        try { if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish(); } catch { /* infinite */ }
    }
    await sleep(120);

    if (sabotage) {
        // The control: the leaderboard's original sizing, from height alone.
        const board = document.querySelector('.gk-board');
        board.style.fontSize = 'calc(100cqh / 8 * .4)';
        document.querySelectorAll('.gk-board-name').forEach((n) => { n.style.minWidth = '0'; });
        await sleep(120);
    }

    const problems = [];
    const size = Number(getComputedStyle(document.querySelector('.gk-board') || document.body).getPropertyValue('--rows')) || 8;
    for (const el of document.querySelectorAll('#app *')) {
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!ownText && !el.matches('img, video, canvas')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        let r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // A table row that has slid out of the top `size` is meant to be gone.
        const row = el.closest('.gk-board-row');
        if (row && row.getBoundingClientRect().top >= row.parentElement.getBoundingClientRect().bottom - 1) continue;
        // Inside the matrix the answer is a scrollbar, by design.
        if (el.closest('.gk-matrix-wrap')) continue;
        const label = `${el.className || el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 14)}"`;

        if (cs.textOverflow === 'ellipsis') {
            // Truncating a long name is fine; leaving it under ~3 characters is not.
            if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth < parseFloat(cs.fontSize) * 2.5) {
                problems.push(`truncated to ${el.clientWidth}px: ${label}`);
            }
            continue;
        }
        if (ownText) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const tr = range.getBoundingClientRect();
            if (tr.width) r = tr;
        }
        let left = 0, top = 0, right = innerWidth, bottom = innerHeight, by = 'the window';
        for (let a = el.parentElement; a; a = a.parentElement) {
            const s = getComputedStyle(a);
            const ar = a.getBoundingClientRect();
            if (s.overflowX !== 'visible') {
                if (ar.left > left) { left = ar.left; by = a.className; }
                if (ar.right < right) { right = ar.right; by = a.className; }
            }
            if (s.overflowY !== 'visible') {
                if (ar.top > top) { top = ar.top; by = a.className; }
                if (ar.bottom < bottom) { bottom = ar.bottom; by = a.className; }
            }
        }
        const tol = 1.5;
        if (r.left < left - tol || r.right > right + tol || r.top < top - tol || r.bottom > bottom + tol) {
            problems.push(`cut by .${String(by).split(' ')[0]}: ${label}`);
        }
    }
    // Names and answers hug the RIGHT edge of their box in any language. The
    // mock room includes a Latin name ("Avi") precisely for this: dir="auto"
    // once sent every English name to the far left, away from its rank.
    for (const el of document.querySelectorAll('.gk-board-name, .gk-tile-text, .gk-matrix-name')) {
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        if (cs.display === 'none' || !box.width || !el.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const gap = box.right - parseFloat(cs.paddingRight) - text.right;
        if (text.width && gap > 2) problems.push(`not right-aligned (${Math.round(gap)}px adrift): ${el.className} "${el.textContent.trim().slice(0, 14)}"`);
    }
    return [...new Set(problems)];
}

// ---- driver ---------------------------------------------------------------
const browser = await chromium.launch({ headless: true });
let failures = 0;
let screens = 0;

async function open(target, [width, height]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: !!target.touch, isMobile: !!target.touch });
    // GevKahoot loads no analytics, but every browser-driving script opts out.
    await context.addInitScript(() => { try { localStorage.setItem('shabi:no-analytics', '1'); } catch {} });
    const page = await context.newPage();
    await page.goto(BASE + target.page);
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
    return { context, page };
}

const itemCount = await (async () => {
    const { page, context } = await open(TARGETS[0], [800, 600]);
    const n = await page.evaluate(async () => (await import('./js/demo/demoQuiz.js')).DEMO_ITEMS.length);
    await context.close();
    return n;
})();

for (const target of TARGETS) {
    for (const size of target.sizes) {
        const { context, page } = await open(target, size);
        const bad = [];
        for (const view of VIEWS) {
            const indexes = PER_ITEM.has(view) ? [...Array(itemCount).keys()] : [null];
            for (const itemIndex of indexes) {
                screens += 1;
                const problems = await page.evaluate(showAndAudit, { view, itemIndex, sabotage: false });
                if (problems.length) bad.push(`    ${view}${itemIndex === null ? '' : ` (item ${itemIndex + 1})`}: ${problems.slice(0, 4).join(' · ')}`);
            }
        }
        const label = `${target.name} ${size[0]}×${size[1]}`;
        if (bad.length) { failures += bad.length; console.error(`✗ ${label}\n${bad.join('\n')}`); }
        else console.log(`✓ ${label}`);
        await context.close();
    }
}

// ---- control --------------------------------------------------------------
{
    const { context, page } = await open(TARGETS[2], [430, 950]);
    const problems = await page.evaluate(showAndAudit, { view: 'leaderboard', itemIndex: null, sabotage: true });
    await context.close();
    if (problems.length) console.log(`✓ control: the old leaderboard sizing is caught (${problems[0]})`);
    else { failures += 1; console.error('✗ control: the old leaderboard sizing was NOT caught — this check has gone blind'); }
}

await browser.close();
console.log(`\ngevkahoot layout check: ${screens} screens, ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
