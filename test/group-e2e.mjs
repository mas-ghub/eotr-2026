// Group chat e2e: A creates a group with B + C, all three see it, B sends a message.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4173';

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `grp-${Date.now()}`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

async function newDevice(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((n) => localStorage.setItem('eotr2026.name.v1', n), name);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(3000);
  return { page, errors };
}

// B and C post to the wall so A knows their identities
const B = await newDevice('Bravo');
const C = await newDevice('Charlie');
for (const [dev, nm] of [[B, 'Bravo'], [C, 'Charlie']]) {
  await dev.page.evaluate(([n, t]) => {
    const input = document.querySelector('.chat-composer__input');
    input.value = `wall ping from ${n} ${t}`;
    input.dispatchEvent(new Event('input'));
    document.querySelector('.chat-composer__send').click();
  }, [nm, tag]);
  await sleep(3000);
}

const A = await newDevice('Alpha');
await sleep(2500);

// A opens the Chats list, then the New chat picker
await A.page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.chat-seg__tab')];
  const tab = tabs.find((t) => t.textContent.includes('Chats'));
  if (tab) tab.click();
});
await sleep(800);
const newBtn = await A.page.$eval('.chat-newbtn', (el) => !!el).catch(() => false);
ok('group: New chat button present', newBtn);
await A.page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const nb = btns.find((b) => b.textContent.includes('New chat'));
  if (nb) nb.click();
});
await sleep(800);

const pickerOpen = await A.page.$eval('.sheet-overlay', (el) => !!el).catch(() => false);
ok('group: picker sheet opens', pickerOpen);

// Select ONLY Bravo + Charlie (there are old test users on the wall)
await A.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.chat-picker__row')];
  rows.forEach((r) => {
    const txt = r.textContent.trim();
    if (txt === 'Bravo' || txt === 'Charlie') {
      r.click();
    }
  });
});
await sleep(400);
const goBtnText = await A.page.$eval('.chat-picker__go', (el) => el.textContent.trim()).catch(() => null);
ok('group: selecting 2 people enables "Start group (2)"', goBtnText && goBtnText.includes('Start group (2)'), goBtnText || 'n/a');

await A.page.evaluate(() => {
  const input = document.querySelector('.chat-picker__title');
  if (input) {
    input.value = 'Camp Crew';
    input.dispatchEvent(new Event('input'));
  }
  document.querySelector('.chat-picker__go').click();
});
await sleep(3000);

const convTitleA = await A.page.$eval('.chat-title--conv', (el) => el.textContent.trim()).catch(() => null);
ok('group: A lands in the group', convTitleA === 'Camp Crew', convTitleA || 'n/a');

await A.page.evaluate((t) => {
  const input = document.querySelector('.chat-composer__input');
  input.value = `group hello ${t}`;
  input.dispatchEvent(new Event('input'));
  document.querySelector('.chat-composer__send').click();
}, tag);
await sleep(3000);

// B should see the group in Chats and read the message
await B.page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(2500);
await B.page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.chat-seg__tab')];
  const tab = tabs.find((t) => t.textContent.includes('Chats'));
  if (tab) tab.click();
});
await sleep(1200);
const bSeesGroup = await B.page.$eval('.chat-conv-row', (el) => el.textContent.includes('Camp Crew')).catch(() => false);
ok('group: B sees the group in Chats', bSeesGroup);

await B.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.chat-conv-row')];
  const row = rows.find((r) => r.textContent.includes('Camp Crew'));
  if (row) row.click();
});
await sleep(2000);
const bReads = await B.page.evaluate((t) => [...document.querySelectorAll('.chat-msg__bubble')].some((b) => b.textContent.includes(`group hello ${t}`)), tag);
ok('group: B reads the group message', bReads);

const realErrors = [...A.errors, ...B.errors, ...C.errors].filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
