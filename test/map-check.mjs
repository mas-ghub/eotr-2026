// Map view + location-sharing UI checks against :4173 (geolocation overridden).
// Firestore writes need the presence/locations rules published; the share
// status flips on a geolocation fix regardless, so this covers the UI layer.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4173';

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
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
const ctx = await browser.createBrowserContext();
await ctx.overridePermissions(BASE, ['geolocation']);
const page = await ctx.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// Override geolocation to a spot near the festival.
const cdp = await page.createCDPSession();
await cdp.send('Page.setGeolocationOverride', { latitude: 50.9904, longitude: -2.0861, accuracy: 12 });

await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => localStorage.setItem('eotr2026.name.v1', 'MapTest'));
await page.goto(BASE + '/#/map', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(3000);

// Nav has 5 tabs including Map
const tabCount = await page.$$eval('.app-nav__tab', (els) => els.length);
const mapTab = await page.$eval('.app-nav__tab[href="#/map"]', (el) => !!el).catch(() => false);
ok('map: nav shows 5 tabs incl. Map', tabCount === 5 && mapTab, `${tabCount} tabs`);

const mapView = await page.$eval('.map-view', (el) => !!el).catch(() => false);
ok('map: map view renders', mapView);

const mapActive = await page.$eval('.app-nav__tab[href="#/map"]', (el) => el.classList.contains('active')).catch(() => false);
ok('map: map tab is highlighted', mapActive);

const onlineRow = await page.$eval('.map-online', (el) => !!el).catch(() => false);
ok("map: who's-online strip present", onlineRow);

const shareBtn = await page.$eval('.map-share', (el) => el.textContent.includes('Share my location')).catch(() => false);
ok('map: share button present (off by default)', shareBtn);

// Tap share -> geolocation fix -> status "Sharing your location"
await page.evaluate(() => document.querySelector('.map-share').click());
await sleep(2500);
const sharing = await page.$eval('.map-share-note', (el) => el.textContent.includes('Sharing your location')).catch(() => false);
const stopLabel = await page.$eval('.map-share', (el) => el.textContent.includes('Stop sharing')).catch(() => false);
ok('map: sharing starts + button flips', sharing && stopLabel);

// Leaflet map is live
const hasTiles = await page.$eval('.leaflet-container', (el) => !!el).catch(() => false);
ok('map: leaflet map initialised', hasTiles);

// Privacy note present
const privacy = await page.$eval('.map-privacy', (el) => el.textContent.includes('Only you decide to share')).catch(() => false);
ok('map: privacy note shown', privacy);

// Tap stop -> back to off
await page.evaluate(() => document.querySelector('.map-share').click());
await sleep(1200);
const stopped = await page.$eval('.map-share-note', (el) => el.textContent.includes('Not sharing')).catch(() => false);
ok('map: stopping sharing returns to off', stopped);

// The permission-denied snapshot error only appears while the presence/locations
// rules are NOT yet published; once they are, this is gone. Kept as an allowance.
const realErrors = errors.filter(
  (e) =>
    !e.includes('net::ERR_INTERNET_DISCONNECTED') &&
    !e.includes('Failed to load resource') &&
    !e.includes('permission-denied')
);
ok('no console errors (rules-permitting)', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
