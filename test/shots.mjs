import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:4174';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const shots = [
  { name: 'lineup-mobile', url: '#/lineup', w: 390, h: 844 },
  { name: 'lineup-desktop', url: '#/lineup', w: 1440, h: 900 },
  { name: 'timetable-mobile', url: '#/timetable', w: 390, h: 844 },
  { name: 'timetable-desktop', url: '#/timetable', w: 1440, h: 900 },
  { name: 'artist-mobile', url: '#/artist/pulp', w: 390, h: 844 },
  { name: 'artist-desktop', url: '#/artist/pulp', w: 1440, h: 900 },
  { name: 'myday-mobile', url: '#/myday', w: 390, h: 844 }
];

for (const s of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 1 });
  await page.goto(BASE + '/' + s.url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `shot-${s.name}.png` });
  console.log('shot', s.name);
  await page.close();
}
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
process.exit(0);
