// Live sanity (READ-ONLY — never writes to Firestore): chat view renders, is
// live, nav has 5 tabs, no console errors.
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

await page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);

const chatView = await page.$eval('.chat-view', (el) => !!el).catch(() => false);
console.log((chatView ? 'PASS' : 'FAIL') + '  live: chat view renders');

const status = await page.$eval('.chat-status', (el) => el.textContent.trim()).catch(() => null);
console.log((status && status.startsWith('Live') ? 'PASS' : 'FAIL') + `  live: status "${status}"`);

const tabs = await page.$$eval('.app-nav__tab', (els) => els.length);
console.log((tabs === 5 ? 'PASS' : 'FAIL') + `  live: nav has ${tabs} tabs`);

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
console.log((realErrors.length === 0 ? 'PASS' : 'FAIL') + '  live: no console errors' + (realErrors.length ? ' — ' + realErrors.slice(0, 2).join(' | ') : ''));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
