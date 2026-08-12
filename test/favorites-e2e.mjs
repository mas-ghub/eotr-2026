// Shared-picks ("Who's going where") e2e: two devices against the isolated
// devtest_ bundle. Device A auto-shares its My Day; device B sees it; clearing
// My Day removes it; going offline degrades gracefully and re-syncs online.
// Requires the updated firestore.rules (favorites + devtest_favorites mirror)
// to be published.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `fav-${Date.now()}`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

async function newDevice() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors };
}

/** Poll a probe; returns its last value when truthy, else null. A thrown probe
 *  (transient re-render) is treated as "keep waiting". */
async function pollValue(probe, tries = 60, gap = 400) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await probe();
      if (v) return v;
      last = v ?? last;
    } catch {
      /* keep polling */
    }
    await sleep(gap);
  }
  return last;
}

// A real pair of acts so the ids resolve to names on device B's chips.
const acts = await (await fetch(BASE + '/data/acts.json')).json();
const realActs = acts.filter((a) => a && a.id && a.name && !a.placeholder).slice(0, 2);
const id1 = realActs[0].id;
const id2 = realActs[1].id;
ok('fav: data has real acts to share', !!id1 && !!id2, `${realActs[0].name} + ${realActs[1].name}`);

// ---- Device A (Alice) saves 2 sets -> auto-share ----
const A = await newDevice();
const alice = `Alice${tag}`;
await A.page.goto(BASE + '/#/myday', { waitUntil: 'domcontentloaded', timeout: 30000 });
await A.page.evaluate(() => localStorage.clear());
await A.page.evaluate((n) => localStorage.setItem('eotr2026.name.v1', n), alice);
await A.page.reload({ waitUntil: 'domcontentloaded' });

await A.page.evaluate(([a, b]) => localStorage.setItem('eotr2026.schedule.v1', JSON.stringify([a, b])), [id1, id2]);
await A.page.reload({ waitUntil: 'domcontentloaded' });
const syncedA = await pollValue(() => A.page.$eval('.fav-status', (el) => (el.classList.contains('synced') ? el.textContent.trim() : null)).catch(() => null));
if (syncedA !== 'Sharing my picks · live') {
  const diag = await A.page.evaluate(() => ({
    status: document.querySelector('.fav-status')?.textContent.trim() || null,
    statusClass: document.querySelector('.fav-status')?.className || null,
    scheduled: localStorage.getItem('eotr2026.schedule.v1') || null,
    name: localStorage.getItem('eotr2026.name.v1') || null
  }));
  console.log('DIAG A:', JSON.stringify(diag));
}
ok('fav: A shares 2 picks when online', syncedA === 'Sharing my picks · live', syncedA || 'n/a');

// ---- Device B (Bob) opens My Day and sees A's picks ----
const B = await newDevice();
await B.page.goto(BASE + '/#/myday', { waitUntil: 'domcontentloaded', timeout: 30000 });
await B.page.evaluate(() => localStorage.clear());
await B.page.evaluate((n) => localStorage.setItem('eotr2026.name.v1', n), `Bob${tag}`);
await B.page.reload({ waitUntil: 'domcontentloaded' });
// Wait for B's own Firebase connection (status becomes synced) so the
// "everyone else's picks" snapshot listener is definitely live before polling.
const bSynced = await pollValue(() => B.page.$eval('.fav-status', (el) => (el.classList.contains('synced') ? el.textContent.trim() : null)).catch(() => null));
ok('fav: B connects to shared picks', bSynced === 'Sharing my picks · live', bSynced || 'n/a');

const aliceName = await pollValue(() =>
  B.page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.fav-person')];
    const row = rows.find((r) => r.querySelector('.fav-person__name')?.textContent.includes(name));
    return row ? row.querySelector('.fav-person__name')?.textContent || null : null;
  }, alice)
);
ok('fav: B sees A in "Who\'s going where"', aliceName === alice, aliceName || 'n/a');

const aliceRow = await pollValue(() =>
  B.page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.fav-person')];
    const row = rows.find((r) => r.querySelector('.fav-person__name')?.textContent.includes(name));
    if (!row) return null;
    const chips = [...row.querySelectorAll('.fav-chip')].map((c) => c.textContent);
    return { count: row.querySelector('.fav-person__count')?.textContent.trim() || '', chipText: chips.join(' | ') };
  }, alice).then((r) => (r && r.count === '2 sets' && r.chipText.includes(realActs[0].name) && r.chipText.includes(realActs[1].name) ? r : null))
);
ok(
  'fav: B sees A\'s set count + names',
  !!aliceRow,
  aliceRow ? `count=${aliceRow.count} chips=${aliceRow.chipText}` : 'no row yet'
);

// ---- Offline: A edits picks with no connection -> graceful pill, then re-syncs ----
await A.page.setOfflineMode(true);
await sleep(1500);
await A.page.evaluate(([a]) => localStorage.setItem('eotr2026.schedule.v1', JSON.stringify([a])), [id1]);
await A.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
const offlinePill = await pollValue(() =>
  A.page.$eval('.fav-status', (el) => (el.classList.contains('offline') && el.textContent.includes('back online') ? el.textContent.trim() : null)).catch(() => null)
);
if (!offlinePill) {
  const diag = await A.page.evaluate(() => ({
    status: document.querySelector('.fav-status')?.textContent.trim() || null,
    statusClass: document.querySelector('.fav-status')?.className || null,
    onLine: navigator.onLine
  }));
  console.log('DIAG A-OFFLINE:', JSON.stringify(diag));
}
ok('fav: offline A shows graceful "share later" pill', offlinePill === 'Picks will share when you’re back online', offlinePill || 'n/a');

await A.page.setOfflineMode(false);
const reSynced = await pollValue(() => A.page.$eval('.fav-status', (el) => (el.classList.contains('synced') ? el.textContent.trim() : null)).catch(() => null));
ok('fav: A re-syncs when back online', reSynced === 'Sharing my picks · live', reSynced || 'n/a');

// ---- A clears everything -> entry disappears for B ----
await A.page.evaluate(() => localStorage.setItem('eotr2026.schedule.v1', '[]'));
await A.page.reload({ waitUntil: 'domcontentloaded' });
const gone = await pollValue(() =>
  B.page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.fav-person')];
    return !rows.some((r) => r.querySelector('.fav-person__name')?.textContent.includes(name)) ? true : null;
  }, alice),
  45
);
ok('fav: clearing My Day removes A from B\'s list', gone === true);

const realErrors = [...A.errors, ...B.errors].filter(
  (e) =>
    !e.includes('net::ERR_INTERNET_DISCONNECTED') &&
    !e.includes('Failed to load resource') &&
    !e.includes('Could not reach Cloud Firestore backend') &&
    !e.includes('operate in offline mode')
);
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
