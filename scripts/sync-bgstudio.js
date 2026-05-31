import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_URL = 'https://heroes3.backgammonstudio.com/';
const LEAGUE_NAME = 'Shabi Israel';
const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'out', 'leaguedata.csv');

const username = process.env.BGSTUDIO_USER;
const password = process.env.BGSTUDIO_PASS;

if (!username || !password) {
  console.error('Missing BGSTUDIO_USER or BGSTUDIO_PASS env vars.');
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

try {
  console.log(`→ Opening ${SITE_URL}`);
  await page.goto(SITE_URL);
  await page.waitForLoadState('domcontentloaded');

  console.log('→ Injecting CSS to suppress intro/news/welcome dialogs');
  await page.addStyleTag({
    content: '#introdialog, #myrooms, #newsdialog, #welcomedialog { display: none !important; }',
  });

  console.log('→ Opening login form');
  await page.locator('button:has-text("Login"):not(.dialogbutton)').click();

  console.log('→ Filling credentials');
  await page.locator('#username').fill(username);
  await page.locator('#pass').fill(password);

  console.log('→ Submitting login');
  await page.locator('button.dialogbutton:has-text("Login")').click();

  await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });

  console.log('→ Diagnosing welcome modal');
  const diag = await page.evaluate(() => {
    const dump = (el) => el ? {
      tag: el.tagName,
      id: el.id || null,
      cls: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').slice(0, 50).trim(),
      onclick: el.getAttribute('onclick'),
    } : null;
    return {
      at_top_right: dump(document.elementFromPoint(1517, 182)),
      modals: Array.from(document.querySelectorAll('[id*="dialog" i], [id*="modal" i], [class*="dialog" i], [class*="modal" i]'))
        .filter((el) => el.offsetParent !== null)
        .slice(0, 10)
        .map((el) => ({ tag: el.tagName, id: el.id, cls: (el.className || '').toString().slice(0, 60) })),
    };
  });
  console.log(`  At (1517,182): ${JSON.stringify(diag.at_top_right)}`);
  console.log(`  Visible dialog-like elements: ${JSON.stringify(diag.modals)}`);

  console.log('→ Closing welcome modal (multi-strategy)');
  const closed = await page.evaluate(() => {
    const xChars = /^[✕×Xx⨯⊗⊠✗]$/;
    const visible = (el) => el.offsetParent !== null;
    const fullClick = (el) => {
      const o = { bubbles: true, cancelable: true };
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.click();
    };
    const tried = [];

    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      if (!visible(el)) continue;
      const text = (el.textContent || '').trim();
      if (xChars.test(text)) {
        fullClick(el);
        if (el.parentElement) fullClick(el.parentElement);
        tried.push({ s: 'char-leaf', tag: el.tagName, text });
      }
    }
    for (const el of document.querySelectorAll('[onclick*="close" i], [onclick*="hide" i], [class*="close" i]')) {
      if (!visible(el)) continue;
      fullClick(el);
      tried.push({ s: 'class-attr', tag: el.tagName, cls: (el.className || '').toString().slice(0, 40) });
    }
    return tried;
  });
  console.log(`  Tried: ${JSON.stringify(closed)}`);
  await page.mouse.click(1517, 182);
  await page.waitForTimeout(800);

  const stillThere = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').slice(0, 100);
      if (/Welcome back|News for you today/.test(text)) {
        return { id: el.id, cls: (el.className || '').toString().slice(0, 60), tag: el.tagName };
      }
    }
    return null;
  });
  console.log(`  Welcome modal still visible? ${JSON.stringify(stillThere)}`);

  console.log('→ Switching to Tournaments tab');
  await page.locator('th').filter({ hasText: /^\s*Tournaments\s*$/ }).first().click({ timeout: 10000 });
  await page.locator('tr').filter({ hasText: 'Leagues' }).first().waitFor({ timeout: 10000 });

  console.log('→ Opening Leagues');
  await page.locator('tr').filter({ hasText: 'Leagues' }).locator('.button.tablebutton').first().click();

  console.log(`→ Opening league "${LEAGUE_NAME}"`);
  const leagueBtn = page.locator('button').filter({ hasText: new RegExp(`^\\s*${LEAGUE_NAME}\\s*$`) });
  await leagueBtn.first().click({ timeout: 15000 });

  await page.locator('button:has-text("Export results")').waitFor({ timeout: 15000 });

  console.log('→ Triggering Export results');
  await page.locator('button:has-text("Export results")').click();
  await page.waitForTimeout(1500);

  console.log('→ Locating Download element');
  const downloadCandidates = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter((el) => el.offsetParent !== null && el.children.length === 0)
      .filter((el) => (el.textContent || '').trim() === 'Download')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          onclick: el.getAttribute('onclick') || null,
        };
      });
  });
  console.log(`  Found ${downloadCandidates.length} 'Download' leaf(s)`);
  downloadCandidates.forEach((c, i) => {
    console.log(`    [${i}] ${c.tag} @ (${c.rect.x},${c.rect.y}) ${c.rect.w}x${c.rect.h} onclick=${c.onclick}`);
  });

  async function checkForCsv() {
    return await page.evaluate(() => {
      const a = document.querySelector('a[download="leaguedata.csv"]');
      if (a) {
        const href = a.href || '';
        if (href.startsWith('data:')) {
          return { source: 'anchor', data: decodeURIComponent(href.split(',').slice(1).join(',')) };
        }
      }
      for (const ta of document.querySelectorAll('textarea')) {
        if (ta.value && /Player,\s*PR,\s*Luck,\s*Score/.test(ta.value) && ta.value.length > 500) {
          return { source: 'textarea', data: ta.value };
        }
      }
      for (const pre of document.querySelectorAll('pre, div')) {
        const t = pre.textContent || '';
        if (/^Player,\s*PR,\s*Luck,\s*Score/.test(t) && t.length > 500) {
          return { source: pre.tagName.toLowerCase(), data: t };
        }
      }
      return null;
    });
  }

  let csv = null;
  for (const c of downloadCandidates) {
    const positions = [
      [0.5, 0.5, 'center'],
      [0.25, 0.5, 'left'],
      [0.75, 0.5, 'right'],
      [0.5, 0.25, 'top'],
      [0.5, 0.75, 'bottom'],
    ];
    for (const [dx, dy, name] of positions) {
      const px = c.rect.x + Math.round(c.rect.w * dx);
      const py = c.rect.y + Math.round(c.rect.h * dy);
      console.log(`  Click [${c.tag}] ${name} @ (${px},${py})`);
      await page.mouse.click(px, py);
      await page.waitForTimeout(600);
      const got = await checkForCsv();
      if (got) {
        console.log(`  ✓ Got CSV from ${got.source} (${got.data.length} bytes)`);
        csv = got.data;
        break;
      }
    }
    if (csv) break;
  }

  if (!csv) {
    throw new Error('No click position produced CSV data');
  }

  const lines = csv.split('\n').filter(Boolean).length;
  console.log(`✓ CSV: ${csv.length} bytes, ${lines} lines`);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, csv, 'utf8');
  console.log(`✓ Saved to ${OUTPUT_PATH}`);
} catch (err) {
  console.error('✗ Sync failed:', err.message);
  try {
    const shotPath = OUTPUT_PATH.replace(/leaguedata\.csv$/, 'failure.png');
    await mkdir(dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });
    console.error(`✗ Saved failure screenshot to ${shotPath}`);
  } catch (shotErr) {
    console.error('✗ Could not capture failure screenshot:', shotErr.message);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
