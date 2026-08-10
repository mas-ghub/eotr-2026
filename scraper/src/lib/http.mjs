import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function cacheFile(url) {
  const name =
    url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .slice(-180) + '.txt';
  return path.join(CACHE_DIR, name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { force = false, delay = 500, retries = 6 } = {}) {
  const file = cacheFile(url);
  if (!force && fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  }
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (delay) await sleep(delay + Math.random() * 200);
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      if (res.status === 429 || res.status === 403) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1);
        lastErr = new Error(`HTTP ${res.status} (rate limited)`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const text = await res.text();
      fs.writeFileSync(file, text);
      return text;
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr && lastErr.message}`);
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    // cache may hold an error page; retry without cache
    const text2 = await fetchText(url, { ...opts, force: true });
    return JSON.parse(text2);
  }
}

/** Run an async map over items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = undefined;
        console.warn(`  ! item ${i} (${JSON.stringify(items[i])}) failed: ${err.message}`);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
