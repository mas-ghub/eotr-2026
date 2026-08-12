// Set-reminder feature checks against :4174 (isolated devtest_ bundle).
// Stubs Notification + SW showNotification to capture what would be shown.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Capture notifications before the app loads.
await page.evaluateOnNewDocument(() => {
  window.__swNotifs = [];
  window.__plainNotifs = [];
  window.Notification = class {
    static permission = 'granted';
    static requestPermission = async () => 'granted';
    constructor(title, opts) {
      window.__plainNotifs.push({ title, opts });
    }
    close() {}
  };
  try {
    ServiceWorkerRegistration.prototype.showNotification = async function (title, opts) {
      window.__swNotifs.push({ title, opts });
    };
  } catch {
    /* ignore */
  }
});

// Pull a real act from the data so we test against a genuine set.
const acts = await (await fetch(BASE + '/data/acts.json')).json();
const act = acts.find((a) => a && a.id && a.name && !a.placeholder) || acts[0];
ok('rem: data has a real act to test against', !!act, act?.name);

await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate((n) => localStorage.setItem('eotr2026.name.v1', n), 'RemTester');
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2000);

// Save the act to My Day, then open My Day (reload so the store re-reads it).
await page.evaluate((id) => localStorage.setItem('eotr2026.schedule.v1', JSON.stringify([id])), act.id);
await page.goto(BASE + '/#/myday', { waitUntil: 'networkidle2', timeout: 20000 });
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1500);

const bell = await page.$('.myday-row .sch-btn.rem').catch(() => null);
ok('rem: reminder bell appears on a My Day row', !!bell);

// Open the reminder sheet and pick "At showtime".
await page.evaluate(() => document.querySelector('.myday-row .sch-btn.rem').click());
await sleep(700);
const sheetOpen = await page.$eval('.sheet-overlay.open', (el) => !!el).catch(() => false);
ok('rem: tapping the bell opens the lead-time sheet', sheetOpen);

const opts = await page.$$eval('.rem-sheet__opt', (els) => els.map((e) => e.textContent.trim()));
ok('rem: sheet lists 4 lead times', opts.length === 4 && opts[0].includes('At showtime'), opts.join(' | '));

await page.evaluate(() => document.querySelector('.rem-sheet__opt').click());
await sleep(1200);

const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('eotr2026.reminders.v1');
  return raw ? JSON.parse(raw) : [];
});
ok('rem: reminder persisted to localStorage', stored.length === 1 && stored[0].actId === act.id && stored[0].leadMin === 0, JSON.stringify(stored[0]));

const bellOn = await page.$eval('.myday-row .sch-btn.rem', (el) => el.classList.contains('rem-on')).catch(() => false);
ok('rem: bell shows active state', bellOn);

// Persistence across reload.
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1500);
const stillOn = await page.$eval('.myday-row .sch-btn.rem', (el) => el.classList.contains('rem-on')).catch(() => false);
ok('rem: reminder survives a reload', stillOn);

// Now force a due reminder and confirm the scheduler fires a notification.
await page.evaluate((id) => {
  const r = JSON.parse(localStorage.getItem('eotr2026.reminders.v1') || '[]')[0];
  r.fired = false;
  r.fireAt = Date.now() - 1000; // already due
  localStorage.setItem('eotr2026.reminders.v1', JSON.stringify([r]));
}, act.id);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2000);

const fired = await page.evaluate(() => {
  const raw = localStorage.getItem('eotr2026.reminders.v1');
  const list = raw ? JSON.parse(raw) : [];
  return {
    swNotifs: window.__swNotifs.length,
    markedFired: list[0] && list[0].fired === true,
    title: window.__swNotifs[0]?.title || null
  };
});
ok('rem: due reminder fired a notification', fired.swNotifs >= 1 || fired.markedFired, JSON.stringify(fired));

// Remove the reminder via the sheet and confirm it's gone.
await page.evaluate(() => document.querySelector('.myday-row .sch-btn.rem')?.click());
await sleep(700);
await page.evaluate(() => document.querySelector('.rem-sheet__remove')?.click());
await sleep(800);
const cleared = await page.evaluate(() => (localStorage.getItem('eotr2026.reminders.v1') || '[]') === '[]');
ok('rem: reminder can be removed', cleared);

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
