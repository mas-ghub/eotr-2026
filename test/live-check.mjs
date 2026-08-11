// Quick live sanity: greeting prompt + hero pill exist on the deployed site.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://mas-ghub.github.io/eotr-2026';

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

await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => localStorage.removeItem('eotr2026.name.v1'));
await page.evaluate(() => localStorage.removeItem('eotr2026.nameasked.v1'));
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);

const promptShown = await page.$eval('.welcome-overlay.open', (el) => !!el).catch(() => false);
console.log((promptShown ? 'PASS' : 'FAIL') + '  live: welcome prompt appears');

await page.evaluate(() => {
  const input = document.querySelector('.welcome-card__input');
  input.value = 'Live Test';
  input.dispatchEvent(new Event('input'));
  document.querySelector('.welcome-card__go').click();
});
await sleep(600);
const pillText = await page.$eval('.hero__greeting', (el) => el.textContent.trim()).catch(() => null);
console.log((pillText && pillText.includes('Live Test') ? 'PASS' : 'FAIL') + `  live: hero pill shows name — ${pillText || 'n/a'}`);

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
console.log((realErrors.length === 0 ? 'PASS' : 'FAIL') + '  live: no console errors' + (realErrors.length ? ' — ' + realErrors.slice(0, 2).join(' | ') : ''));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
