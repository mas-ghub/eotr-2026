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

await page.evaluate(() => {
  const input = document.querySelector('.welcome-card__input');
  input.value = '  Sam  ';
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
});
await sleep(500);
const stored = await page.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
ok('greeting: name trimmed + saved', stored === 'Sam', String(stored));

const heroText = await page.$eval('.hero__greeting', (el) => el.textContent.trim()).catch(() => null);
ok('greeting: hero pill shows greeting with name', !!heroText && heroText.includes('Sam'), heroText || 'n/a');

await page.reload({ waitUntil: 'networkidle2' });
await sleep(1500);
const noPromptAgain = await page.$eval('.welcome-overlay', (el) => el.getBoundingClientRect().width === 0).catch(() => true);
ok('greeting: prompt does not reappear once named', noPromptAgain);

// Tapping the pill re-opens the prompt to change name
await page.evaluate(() => document.querySelector('.hero__greeting').click());
await sleep(600);
const reopened = await page.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
ok('greeting: tapping pill reopens prompt', reopened);

// HTML-syntax characters are stripped (no injection can survive)
await page.evaluate(() => {
  const input = document.querySelector('.welcome-card__input');
  input.value = '<b>Rob</b>; drop table;';
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
});
await sleep(500);
const stored2 = await page.evaluate(() => localStorage.getItem('eotr2026.name.v1'));
const cleanStored = typeof stored2 === 'string' && !/[<>\;/=]/.test(stored2);
ok('greeting: HTML/punctuation stripped', cleanStored && stored2.includes('Rob'), String(stored2));

// The overlay closes after saving; reopen via the pill for the next change
await page.evaluate(() => document.querySelector('.hero__greeting').click());
await sleep(600);
await page.evaluate(() => {
  const input = document.querySelector('.welcome-card__input');
  input.value = 'Aisha';
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
});
await sleep(500);
const heroUpdated = await page.$eval('.hero__greeting', (el) => el.textContent.includes('Aisha')).catch(() => false);
ok('greeting: hero pill updates with new name in place', heroUpdated);

// Clean state
await page.evaluate(() => localStorage.removeItem('eotr2026.name.v1'));

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
