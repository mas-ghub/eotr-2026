// Chat feature checks against :4173 (no Firebase .env present -> "coming soon" state).
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

await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(1500);

// Nav has 5 tabs including Chat
const tabCount = await page.$$eval('.app-nav__tab', (els) => els.length);
const chatTab = await page.$eval('.app-nav__tab[href="#/chat"]', (el) => !!el).catch(() => false);
ok('chat: nav shows 5 tabs incl. Chat', tabCount === 5 && chatTab, `${tabCount} tabs`);

// Active-tab highlight works (regression fix) on the Lineup page
const lineupActive = await page.$eval('.app-nav__tab[href="#/lineup"]', (el) => el.classList.contains('active')).catch(() => false);
ok('chat: lineup tab is highlighted on #/lineup', lineupActive);

// Navigate to chat
await page.goto(BASE + '/#/chat', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(1500);
const chatView = await page.$eval('.chat-view', (el) => !!el).catch(() => false);
ok('chat: chat view renders', chatView);

const chatActive = await page.$eval('.app-nav__tab[href="#/chat"]', (el) => el.classList.contains('active')).catch(() => false);
ok('chat: chat tab is highlighted on #/chat', chatActive);

const statusText = await page.$eval('.chat-status', (el) => el.textContent.trim()).catch(() => null);
// With app/.env set the wall is live; without keys it falls back to "coming soon".
const configured = statusText === 'Live' || statusText === 'Connecting…' || (statusText && statusText.startsWith('Live'));
const comingSoon = statusText === 'Chat is coming soon';
ok('chat: status is live or coming-soon', configured || comingSoon, statusText || 'n/a');

const hasComposer = await page.$eval('.chat-composer', (el) => !!el).catch(() => false);
ok('chat: composer rendered', hasComposer);

const setnameBtn = await page.$eval('.chat-composer__setname', (el) => !!el).catch(() => false);
ok('chat: prompts to set a name first', setnameBtn);

// Back to lineup - no unread badge with no messages
await page.goto(BASE + '/#/lineup', { waitUntil: 'networkidle2', timeout: 20000 });
await sleep(1000);
const chatBadgeShown = await page.$eval('.app-nav__badge.chat-badge', (el) => el.classList.contains('show')).catch(() => false);
ok('chat: no unread badge without messages', !chatBadgeShown);

const realErrors = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
