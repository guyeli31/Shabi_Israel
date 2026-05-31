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

  console.log('→ Opening login form');
  await page.locator('button:has-text("Login"):not(.dialogbutton)').click();

  console.log('→ Filling credentials');
  await page.locator('#username').fill(username);
  await page.locator('#pass').fill(password);

  console.log('→ Submitting login');
  await page.locator('button.dialogbutton:has-text("Login")').click();

  await page.getByRole('columnheader', { name: 'Live matches' }).waitFor({ timeout: 15000 });

  console.log('→ Dismissing post-login news/welcome modal if present');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const hide = (el) => { if (el) el.style.display = 'none'; };
    document.querySelectorAll('*').forEach((el) => {
      const t = (el.textContent || '').slice(0, 200);
      if (/Welcome (back|to Heroes)|News for you today/.test(t)) {
        let cur = el;
        for (let i = 0; i < 8 && cur && cur.tagName !== 'BODY'; i++) {
          const cs = getComputedStyle(cur);
          if (cs.position === 'fixed' || cs.position === 'absolute' || parseInt(cs.zIndex || '0', 10) > 0) {
            hide(cur);
            return;
          }
          cur = cur.parentElement;
        }
      }
    });
  });
  await page.waitForTimeout(200);

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

  await page.locator('a[download="leaguedata.csv"]').waitFor({ timeout: 10000 });

  console.log('→ Extracting CSV from data URI');
  const csv = await page.evaluate(() => {
    const link = document.querySelector('a[download="leaguedata.csv"]');
    if (!link) throw new Error('Download link not found in popup');
    return decodeURIComponent(link.href.split(',').slice(1).join(','));
  });

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
