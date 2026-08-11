// Greeting feature check against :4173 — welcome prompt, persistence, hero pill.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4173';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Names are claimed in Firestore permanently, so each run needs fresh ones.
const tag = Date.now().toString(36);
const name1 = `Sam${tag}`;
const name2 = `Aisha${tag}`;

// Fresh state: no name, no "asked" flag
await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluate(() => localStorage.removeItem('eotr2026.name.v1'));
await page.evaluate(() => localStorage.removeItem('eotr2026.nameasked.v1'));
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2500);

const promptShown = await page.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
ok('greeting: welcome prompt appears on first launch', promptShown);

// Empty submit -> error shake state, then valid name
await page.evaluate(() => document.querySelector('.welcome-card__go').click());
await sleep(300);
const invalidShown = await page.evaluate(() => !!document.querySelector('.welcome-card__input.invalid'));
ok('greeting: empty name shows validation', invalidShown);

await page.evaluate((n) => {
  const input = document.querySelector('.welcome-card__input');
  input.value = `  ${n}  `;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
}, name1);
await sleep(1100);
const stored = await page.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
ok('greeting: name trimmed + saved', stored === name1, String(stored));

const heroText = await page.$eval('.hero__greeting', (el) => el.textContent.trim()).catch(() => null);
ok('greeting: hero pill shows greeting with name', !!heroText && heroText.includes(name1), heroText || 'n/a');

await page.reload({ waitUntil: 'networkidle2' });
await sleep(1500);
const noPromptAgain = await page.$eval('.welcome-overlay', (el) => el.getBoundingClientRect().width === 0).catch(() => true);
ok('greeting: prompt does not reappear once named', noPromptAgain);

// Tapping the pill re-opens the prompt to change name
await page.evaluate(() => document.querySelector('.hero__greeting').click());
await sleep(800);
const reopened = await page.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
ok('greeting: tapping pill reopens prompt', reopened);

// HTML-syntax characters are stripped (no injection can survive)
const xssToken = `Safe${tag}`;
await page.evaluate((n) => {
  const input = document.querySelector('.welcome-card__input');
  input.value = `${n}<script>alert(1)</script>; drop table;`;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
}, xssToken);
await sleep(1100);
const stored2 = await page.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
const cleanStored = typeof stored2 === 'string' && !/[<>\;/=]/.test(stored2);
ok('greeting: HTML/punctuation stripped', cleanStored && stored2.includes(xssToken), String(stored2));

// The overlay closes after saving; reopen via the pill for the next change
await page.evaluate(() => document.querySelector('.hero__greeting').click());
await sleep(800);
await page.evaluate((n) => {
  const input = document.querySelector('.welcome-card__input');
  input.value = n;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
}, name2);
let heroUpdated = false;
for (let i = 0; i < 20; i++) {
  heroUpdated = await page.$eval('.hero__greeting', (el, n) => el.textContent.includes(n), name2).catch(() => false);
  if (heroUpdated) break;
  await sleep(300);
}
ok('greeting: hero pill updates with new name in place', heroUpdated);

// Clean state
await page.evaluate(() => localStorage.removeItem('eotr2026.name.v1'));

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
