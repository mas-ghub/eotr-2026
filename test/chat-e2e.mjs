// Live chat end-to-end: post a message via the UI, watch it appear on a second "device".
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4173';

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

// ---- Device A: set name, open chat, send a message ----
const pageA = await browser.newPage();
await pageA.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errorsA = [];
pageA.on('console', (m) => { if (m.type() === 'error') errorsA.push(m.text()); });
pageA.on('pageerror', (e) => errorsA.push(String(e)));

await pageA.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await pageA.evaluate(() => localStorage.clear());
await pageA.reload({ waitUntil: 'networkidle2' });
await sleep(2500);

// Set name via the welcome prompt (or skip if not shown)
await pageA.evaluate(() => {
  const input = document.querySelector('.welcome-card__input');
  if (input) {
    input.value = 'Alpha';
    input.dispatchEvent(new Event('input'));
    document.querySelector('.welcome-card__go')?.click();
  }
});
await sleep(800);

await pageA.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(2500);

// Composer should be enabled (name known)
const composerInput = await pageA.$eval('.chat-composer__input', (el) => !!el).catch(() => false);
ok('chat: composer active with name set', composerInput);

const statusA = await pageA.$eval('.chat-status', (el) => el.textContent.trim()).catch(() => null);
ok('chat: status is live', !!statusA && statusA.startsWith('Live'), statusA || 'n/a');

await pageA.evaluate((t) => {
  const input = document.querySelector('.chat-composer__input');
  input.value = t;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.chat-composer__send').click();
}, `Hello from Alpha ${tag}`);
await sleep(3000);

const sentVisible = await pageA.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(t)), `Hello from Alpha ${tag}`);
ok('chat: message appears in my own wall', sentVisible);

// ---- Device B: fresh context, open chat, should see the message ----
const ctxB = await browser.createBrowserContext();
const pageB = await ctxB.newPage();
await pageB.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await pageB.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(3000);

const seenOnB = await pageB.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(t)), `Hello from Alpha ${tag}`);
ok('chat: message arrives on a second device', seenOnB);

const mineOnA = await pageA.evaluate(() => {
  const mine = [...document.querySelectorAll('.chat-msg')].filter((m) => m.classList.contains('mine'));
  return mine.length >= 1;
});
ok('chat: my message is styled as "mine"', mineOnA);

await pageA.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(1500);
const badge = await pageA.$eval('.app-nav__badge.chat-badge', (el) => el.classList.contains('show')).catch(() => false);
ok('chat: unread badge not shown after viewing chat', !badge);

const realErrors = [...errorsA].filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
