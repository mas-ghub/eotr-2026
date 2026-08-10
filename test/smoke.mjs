// Headless smoke test against the built PWA using system Edge.
// Assumes `npm run build` + `npx vite preview` are already running on :4173.
import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4173';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))
  ]);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await withTimeout(page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 }), 40000, 'goto lineup');
console.log('step 1 done');

const cards = await page.$$eval('.artist-card', (els) => els.length);
ok('lineup: artist cards rendered', cards > 100, `${cards} cards`);

await page.type('.search', 'pulp');
await sleep(600);
const filtered = await page.$$eval('.artist-card .artist-card__name', (els) => els.map((e) => e.textContent.trim()));
ok('lineup: search "pulp"', filtered.some((n) => n.toLowerCase().includes('pulp')), filtered.join(', '));

await page.evaluate(() => {
  const i = document.querySelector('.search');
  i.value = '';
  i.dispatchEvent(new Event('input'));
});
await sleep(500);
console.log('step 2 done');

await withTimeout(page.evaluate(() => document.querySelectorAll('.artist-card')[0].click()), 5000, 'click card');
await sleep(1500);
const artistName = await page.$eval('.artist-name', (el) => el.textContent.trim()).catch(() => null);
ok('artist: page rendered', !!artistName, artistName || 'n/a');

const tracks = await page.$$eval('.track-row', (els) => els.length);
ok('artist: preview tracks listed', tracks > 0, `${tracks} tracks`);
console.log('step 3 done');

const played = await withTimeout(
  page.evaluate(async () => {
    const btn = document.querySelector('.track-play');
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    return btn.classList.contains('playing');
  }),
  10000,
  'play preview'
);
ok('artist: preview plays', played);

const clipOk = await withTimeout(
  page.evaluate(async () => {
    const clipBtn = document.querySelector('.track-clip');
    if (!clipBtn) return 'no-clip-btn';
    clipBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    // choose the 10s clip so the test finishes quickly
    const chip10 = document.querySelector('.clip-panel .chip[data-s="10"]');
    if (chip10) chip10.click();
    const recordBtn = document.querySelector('.clip-panel .btn-primary');
    if (!recordBtn) return 'no-record-btn';
    recordBtn.click();
    await new Promise((r) => setTimeout(r, 15000));
    const state = document.querySelector('.clip-panel__state')?.textContent || '';
    return state.includes('Saved') ? 'saved' : state.slice(0, 60);
  }),
  22000,
  'extract clip'
);
ok('artist: clip extracted + saved', clipOk === 'saved', String(clipOk));
console.log('step 4 done');

const setAdded = await page.evaluate(() => {
  const btn = document.querySelector('.set-row .sch-btn');
  if (!btn) return false;
  btn.click();
  return btn.classList.contains('on');
});
ok('artist: added set to My Day', !!setAdded);

await withTimeout(page.goto(BASE + '/#/myday', { waitUntil: 'networkidle2', timeout: 20000 }), 30000, 'goto myday');
await sleep(700);
const mydayRows = await page.$$eval('.myday-row', (els) => els.length);
ok('myday: rows shown', mydayRows >= 1, `${mydayRows} rows`);
console.log('step 5 done');

await withTimeout(page.goto(BASE + '/#/timetable', { waitUntil: 'networkidle2', timeout: 20000 }), 30000, 'goto timetable');
await sleep(700);
const dayTabs = await page.$$eval('.tt-tab', (els) => els.length);
const actBlocks = await page.$$eval('.act-block', (els) => els.length);
ok('timetable: 4 day tabs', dayTabs === 4, `${dayTabs} tabs`);
ok('timetable: act blocks rendered', actBlocks > 20, `${actBlocks} blocks`);

await page.evaluate(() => document.querySelectorAll('.tt-tab')[1].click());
await sleep(500);
const friBlocks = await page.$$eval('.act-block', (els) => els.length);
ok('timetable: day switch works', friBlocks > 0, `${friBlocks} blocks on Fri`);
console.log('step 6 done');

const printOk = await withTimeout(
  page
    .goto(BASE + '/#/print/program', { waitUntil: 'networkidle2', timeout: 15000 })
    .then(() => page.evaluate(() => !!document.querySelector('#printRoot .print-sheet')))
    .catch(() => false),
  25000,
  'print'
);
ok('print: program sheet generated', printOk);
await sleep(500);

const manifestCheck = await page.evaluate(async () => {
  const r = await fetch('./manifest.webmanifest');
  const j = await r.json();
  return j.name && j.icons.length >= 2;
});
ok('manifest: valid', manifestCheck);

const swRegistered = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.length > 0;
});
ok('service worker registered', swRegistered);
console.log('step 7 done');

// ---- Data coverage checks ----
// Kurt Vile must have a full set of previews now.
await page.goto(BASE + '/#/artist/kurt-vile-the-violators', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await sleep(2500);
const kurtTracks = await page.$$eval('.track-row', (els) => els.length).catch(() => 0);
ok('kurt vile has a full set of previews', kurtTracks === 5, `${kurtTracks} tracks`);

// Cinema filter shows films in the lineup.
await page.goto(BASE + '/#/lineup', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await sleep(2500);
const hasCinemaChip = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.type-chips .chip')];
  return chips.some((c) => c.textContent.trim() === 'Cinema');
});
ok('lineup: cinema filter chip exists', hasCinemaChip);

await page.evaluate(() => {
  const c = [...document.querySelectorAll('.type-chips .chip')].find((x) => x.textContent.trim() === 'Cinema');
  if (c) c.click();
});
await sleep(1200);
const filmCards = await page.$$eval('.artist-card', (els) => els.length).catch(() => 0);
ok('lineup: cinema filter shows film cards', filmCards >= 10, `${filmCards} film cards`);

// Film detail page renders with bio + badge, no errors.
await page.goto(BASE + '/#/artist/film-1', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await sleep(2500);
const filmName = await page.$eval('.artist-name', (el) => el.textContent.trim()).catch(() => null);
const filmBadge = await page.$eval('.type-badge', (el) => el.textContent.trim()).catch(() => null);
const filmBio = await page.$eval('.artist-bio', (el) => el.textContent.trim().length).catch(() => 0);
ok('film: detail page renders', !!filmName && filmBadge === 'Cinema' && filmBio > 30, `${filmName} (${filmBadge}, ${filmBio} chars)`);

// A page without previews (e.g. a comedy act) must render a designed empty state.
const noPrevArtist = await page.evaluate(async () => {
  const data = await fetch('./data/artists.json').then((r) => r.json());
  const a = data.find((x) => x.previews.length === 0);
  return a ? a.slug : null;
});
if (noPrevArtist) {
  await page.goto(BASE + '/#/artist/' + noPrevArtist, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await sleep(2000);
  const hasEmpty = await page.$eval('.empty-previews', (el) => !!el).catch(() => false);
  ok('no-preview artist shows designed empty state', hasEmpty, noPrevArtist);
} else {
  ok('no-preview artist empty state', true, 'every artist has previews');
}
console.log('step 8 done');

await withTimeout(
  page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs[0]?.active) await navigator.serviceWorker.ready;
  }).catch(() => {}),
  15000,
  'sw ready'
);
await page.setOfflineMode(true);
await page.goto(BASE + '/#/lineup', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await sleep(3500);
const offlineCards = await page.$$eval('.artist-card', (els) => els.length).catch(() => -1);
ok('offline: lineup still renders from cache', offlineCards > 50, `${offlineCards} cards offline`);

// ---- Offline playback of EVERY preview track for several artists ----
const artistsToCheck = ['pulp', 'cmat', 'mac-demarco', 'ty-segall', 'earl-sweatshirt-mike', 'the-felice-brothers'];
let totalTracks = 0;
let playedTracks = 0;
let failedTracks = [];
for (const slug of artistsToCheck) {
  await page.goto(BASE + '/#/artist/' + slug, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const res = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('.track-play')];
    let ok = 0;
    const failNames = [];
    for (const b of btns) {
      const name = b.closest('.track-row')?.querySelector('.track-meta__name')?.textContent?.trim() || '?';
      b.click();
      await new Promise((r) => setTimeout(r, 1600));
      if (b.classList.contains('playing')) {
        ok++;
      } else {
        failNames.push(name);
      }
      b.click(); // stop
      await new Promise((r) => setTimeout(r, 300));
    }
    return { total: btns.length, ok, failNames };
  }).catch(() => ({ total: 0, ok: 0, failNames: ['page-error'] }));
  totalTracks += res.total;
  playedTracks += res.ok;
  if (res.failNames.length) failedTracks.push(`${slug}: ${res.failNames.join(', ')}`);
}
ok(
  'offline: every preview track plays with no network',
  playedTracks === totalTracks && totalTracks > 20,
  `${playedTracks}/${totalTracks} tracks played offline`
);
if (failedTracks.length) console.log('  failed tracks:', failedTracks.join(' | '));

// Confirm the exact error message never appeared
ok('no "offline or expired" playback errors', !errors.some((e) => e.includes('offline or expired')), '');
await page.setOfflineMode(false);

const realErrors = errors.filter(
  (e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource')
);
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'shot-lineup.png' }).catch(() => {});
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failures:', failed.map((f) => f.name).join(', '));
}
process.exit(failed.length ? 1 : 0);
