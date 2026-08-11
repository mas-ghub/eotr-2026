// Unique-name enforcement: second device is rejected with "already taken".
// Requires the `names` rules to be published (firestore.rules) AND a local
// preview running on :4173 with app/.env configured.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36);
const claimed = `Unique${tag}`;
const fallback = `Unique${tag}b`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

async function freshPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2800);
  return page;
}

async function enterName(page, name) {
  await page.evaluate((n) => {
    const input = document.querySelector('.welcome-card__input');
    if (!input) return;
    input.value = n;
    input.dispatchEvent(new Event('input'));
    document.querySelector('.welcome-card__go').click();
  }, name);
}

// Device A claims the name
const A = await freshPage();
const promptA = await A.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
ok('unique: prompt shows on device A', promptA);
await enterName(A, claimed);
await sleep(1200);
const aStored = await A.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
ok('unique: A claims the name', aStored === claimed, String(aStored));

// Device B (different anonymous uid) tries the SAME name -> rejected
const B = await freshPage();
const promptB = await B.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
ok('unique: prompt shows on device B', promptB);
await enterName(B, claimed);
await sleep(1500);
const bErr = await B.evaluate(() => document.querySelector('.welcome-card__err')?.textContent.trim() || '');
const bStored = await B.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
ok('unique: B is told the name is taken', /taken/i.test(bErr), bErr || '(no error)');
ok('unique: B did not save the taken name', bStored === null, String(bStored));

// B tries a different name -> accepted
await enterName(B, fallback);
await sleep(1200);
const bStored2 = await B.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
ok('unique: B can take a different name', bStored2 === fallback, String(bStored2));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
