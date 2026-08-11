// Final live check: the deployed chat connects to Firestore and can post.
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
const tag = `live-${Date.now()}`;

await page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => localStorage.setItem('eotr2026.name.v1', 'Live Bot'));
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3500);

const status = await page.$eval('.chat-status', (el) => el.textContent.trim()).catch(() => null);
console.log((status && status.startsWith('Live') ? 'PASS' : 'FAIL') + `  live: chat connects — "${status}"`);

await page.evaluate((t) => {
  const input = document.querySelector('.chat-composer__input');
  if (!input) return;
  input.value = `Hello from the live site ${t}`;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.chat-composer__send')?.click();
}, tag);
await sleep(3000);

const posted = await page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(t)), tag);
console.log((posted ? 'PASS' : 'FAIL') + '  live: message posted to Firestore');

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
console.log((realErrors.length === 0 ? 'PASS' : 'FAIL') + '  live: no console errors' + (realErrors.length ? ' — ' + realErrors.slice(0, 2).join(' | ') : ''));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
