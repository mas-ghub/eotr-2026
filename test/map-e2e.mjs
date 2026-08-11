// Cross-device map: A and B share locations at different coords; each sees the
// other's presence (online chip) and location marker on the map.
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

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

async function device(name, lat, lng) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  // Set the name BEFORE any app script runs, so boot's presenceStart writes it.
  await page.evaluateOnNewDocument((n) => {
    try {
      localStorage.setItem('eotr2026.name.v1', n);
      localStorage.removeItem('eotr2026.nameasked.v1');
    } catch {}
  }, name);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 15 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  });
  await page.goto(BASE + '/#/map', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  return { page, errors };
}

const A = await device(`MapA${tag}`, 50.99, -2.08);
const B = await device(`MapB${tag}`, 50.98, -2.07);

// Both share location
await A.page.evaluate(() => document.querySelector('.map-share').click());
await sleep(2500);
await B.page.evaluate(() => document.querySelector('.map-share').click());
await sleep(2500);

const aSharing = await A.page.$eval('.map-share-note', (el) => el.textContent.includes('Sharing your location')).catch(() => false);
const bSharing = await B.page.$eval('.map-share-note', (el) => el.textContent.includes('Sharing your location')).catch(() => false);
ok('map: both devices sharing', aSharing && bSharing);

// A should see B's online chip
let aSeesB = false;
for (let i = 0; i < 20; i++) {
  aSeesB = await A.page.$eval('.map-online', (el, t) => el.textContent.includes(`MapB${t}`), tag).catch(() => false);
  if (aSeesB) break;
  await sleep(500);
}
ok('map: A sees B online', aSeesB);

// B should see A online
let bSeesA = false;
for (let i = 0; i < 20; i++) {
  bSeesA = await B.page.$eval('.map-online', (el, t) => el.textContent.includes(`MapA${t}`), tag).catch(() => false);
  if (bSeesA) break;
  await sleep(500);
}
ok('map: B sees A online', bSeesA);

// A should have >= 2 markers (both) on the Leaflet map
const markerCountA = await A.page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length).catch(() => 0);
ok('map: A has markers on the map', markerCountA >= 2, `${markerCountA} markers`);

// Tap B's chip -> a confirm sheet appears -> confirm -> DM opens (A -> B)
await A.page.evaluate((t) => {
  const chip = [...document.querySelectorAll('.map-online__chip')].find((c) => c.textContent.includes(`MapB${t}`));
  chip?.click();
}, tag);
await sleep(1200);
const sheetShown = await A.page.$eval('.sheet-overlay.open', (el) => !!el).catch(() => false);
ok('map: tapping a name shows a confirm sheet', sheetShown);

await A.page.evaluate(() => {
  const btn = document.querySelector('.map-ask .btn');
  btn?.click();
});
await sleep(2500);
const onChatConv = await A.page.$eval('.chat-title--conv', (el, t) => el.textContent.includes(`MapB${t}`), tag).catch(() => false);
ok('map: tapping an online chip starts a DM', onChatConv);

// Back to map; stop sharing on A -> A's location doc is deleted. A's presence
// (online chip) intentionally STAYS — presence and location-sharing are separate.
await A.page.goto(BASE + '/#/map', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(2500);
await A.page.evaluate(() => document.querySelector('.map-share').click());
await sleep(2500);
const aStopped = await A.page.$eval('.map-share-note', (el) => el.textContent.includes('Not sharing')).catch(() => false);
ok('map: A stops sharing', aStopped);

// A's presence chip should remain (still online), and A should still see B.
let aStillSeesB = false;
for (let i = 0; i < 20; i++) {
  aStillSeesB = await A.page.$eval('.map-online', (el, t) => el.textContent.includes(`MapB${t}`), tag).catch(() => false);
  if (aStillSeesB) break;
  await sleep(500);
}
ok('map: A still sees B after stopping (presence stays)', aStillSeesB);

const realErrors = [...A.errors, ...B.errors].filter(
  (e) =>
    !e.includes('net::ERR_INTERNET_DISCONNECTED') &&
    !e.includes('Failed to load resource') &&
    !e.includes('permission-denied')
);
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
