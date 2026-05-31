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

  console.log('→ Switching to Tournaments tab');
  const tabsRow = page.locator('tr').filter({ has: page.getByRole('columnheader', { name: 'Live matches' }) });
  await tabsRow.locator('th').nth(1).click();

  await page.locator('text="Tournament sections"').waitFor({ timeout: 10000 });

  console.log('→ Opening Leagues');
  await page.locator('tr').filter({ hasText: 'Leagues' }).locator('button').first().click();

  await page.locator('text="Online leagues"').waitFor({ timeout: 10000 });

  console.log(`→ Opening league "${LEAGUE_NAME}"`);
  await page.getByRole('button', { name: LEAGUE_NAME, exact: true }).first().click();

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
  process.exitCode = 1;
} finally {
  await browser.close();
}
