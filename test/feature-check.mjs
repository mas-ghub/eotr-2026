// Quick verification of dark mode + timetable day persistence against :4173.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

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

// Dark mode toggle
await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(1200);
const hasToggle = await page.$eval('.theme-toggle', (el) => !!el).catch(() => false);
ok('dark: theme toggle button in header', hasToggle);

const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const after = await page.evaluate(() => {
  document.querySelector('.theme-toggle').click();
  return document.documentElement.getAttribute('data-theme');
});
ok('dark: click flips html data-theme', before !== after && ['light', 'dark'].includes(after), `${before} -> ${after}`);

await sleep(400); // let the 0.25s background transition finish
const expectBg = after === 'dark' ? 'rgb(20, 26, 22)' : 'rgb(246, 241, 231)';
const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
ok('dark: body background matches theme', bodyBg === expectBg, `${bodyBg} (want ${expectBg})`);

await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);
const persisted = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
ok('dark: choice persists across reload', persisted === after, `data-theme=${persisted}`);

// Timetable day persistence
await page.goto(BASE + '/#/timetable', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(700);
await page.evaluate(() => document.querySelectorAll('.tt-tab')[2].click());
await sleep(400);
const activeAfter = await page.evaluate(() => document.querySelector('.tt-tab.active')?.getAttribute('data-day'));
ok('timetable: switched to Sat', activeAfter === '2026-09-05', activeAfter);

await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(700);
await page.goto(BASE + '/#/timetable', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(700);
const activeAfterReturn = await page.evaluate(() => document.querySelector('.tt-tab.active')?.getAttribute('data-day'));
ok('timetable: day preserved after navigating away + back', activeAfterReturn === '2026-09-05', activeAfterReturn);

// Clear persisted state to leave a clean slate for the smoke suite
await page.evaluate(() => {
  localStorage.removeItem('eotr2026.ttday.v1');
  localStorage.removeItem('eotr2026.theme.v1');
});

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
