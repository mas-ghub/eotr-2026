// Chat e2e with two devices: public wall + private DM flow (requires Anonymous auth enabled).
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `e2e-${Date.now()}`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
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

// ---- Device A (Alpha) ----
const A = await newDevice();
await A.page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await A.page.evaluate(() => localStorage.clear());
await A.page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 30000 });
await A.page.evaluate(() => localStorage.setItem('eotr2026.name.v1', 'Alpha'));
await A.page.reload({ waitUntil: 'networkidle2' });
await sleep(3000);

const statusA = await A.page.$eval('.chat-status', (el) => el.textContent.trim()).catch(() => null);
ok('dm: device A chat is live', !!statusA && statusA.startsWith('Live'), statusA || 'n/a');

// ---- Device B (Bravo) posts to the wall ----
const B = await newDevice();
await B.page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 30000 });
await B.page.evaluate(() => localStorage.clear());
await B.page.evaluate(() => localStorage.setItem('eotr2026.name.v1', 'Bravo'));
await B.page.reload({ waitUntil: 'networkidle2' });
await sleep(3000);

await B.page.evaluate((t) => {
  const input = document.querySelector('.chat-composer__input');
  input.value = `hello from Bravo ${t}`;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.chat-composer__send').click();
}, tag);
await sleep(3500);

const seenOnA = await A.page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(t)), `hello from Bravo ${tag}`);
ok('dm: public wall still works cross-device', seenOnA);

// ---- A taps Bravo's FRESH message on the wall -> DM (so senderId = B's uid) ----
const tapOK = await A.page.evaluate((t) => {
  const msgs = [...document.querySelectorAll('.chat-msg')];
  const fresh = msgs.find((m) => m.querySelector('.chat-msg__bubble')?.textContent.includes(t));
  const btn = fresh?.querySelector('.chat-msg__name--tap');
  if (!btn) return false;
  btn.click();
  return true;
}, `hello from Bravo ${tag}`);
ok('dm: Bravo name is tappable on the wall', tapOK);
await sleep(2500);

const inConvA = await A.page.$eval('.chat-headrow', (el) => !!el).catch(() => false);
const convTitleA = await A.page.$eval('.chat-title--conv', (el) => el.textContent.trim()).catch(() => null);
ok('dm: A opens a private conversation', inConvA && convTitleA === 'Bravo', convTitleA || 'n/a');

await A.page.evaluate((t) => {
  const input = document.querySelector('.chat-composer__input');
  input.value = `private hi ${t}`;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.chat-composer__send').click();
}, tag);
await sleep(3000);

const inOwnConv = await A.page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(`private hi ${t}`)), tag);
ok('dm: DM message shows in A conversation', inOwnConv);

// ---- B checks Chats list + opens the DM ----
await B.page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(2500);
const convTab = await B.page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.chat-seg__tab')];
  const tab = tabs.find((t) => t.textContent.includes('Chats'));
  if (!tab) return false;
  tab.click();
  return true;
});
ok('dm: B can switch to Chats', convTab);
await sleep(1200);

const listHasConv = await B.page.$eval('.chat-conv-row', (el) => el.textContent.includes('Alpha')).catch(() => false);
ok('dm: B sees the conversation in Chats', listHasConv);

await B.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.chat-conv-row')];
  const row = rows.find((r) => r.textContent.includes('Alpha'));
  row.click();
});
await sleep(2000);
const seesDM = await B.page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(`private hi ${t}`)), tag);
ok('dm: B reads the private message', seesDM);

// Privacy: the DM text must NOT be on the public wall
await B.page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.chat-seg__tab')];
  const tab = tabs.find((t) => t.textContent.trim() === 'Everyone');
  if (tab) tab.click();
});
await sleep(800);
const leaked = await B.page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(`private hi ${t}`)), tag);
ok('dm: private message is NOT on the public wall', !leaked);

const realErrors = [...A.errors, ...B.errors].filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
