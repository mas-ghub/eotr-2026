// Films / cinema programme: classification + info (Wikipedia) + optional
// trailer audio via yt-dlp (used by the CLI on the user's machine).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchJson } from './lib/http.mjs';
import { normalizeName } from './lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILMS_DIR = path.resolve(__dirname, '../../app/public/previews');
fs.mkdirSync(FILMS_DIR, { recursive: true });

const exec = promisify(execFile);
const WIKI_UA = 'EOTR-2026-fan-app/1.0 (personal)';
const FILM_CACHE_FILE = path.resolve(__dirname, '../../cache/films-info.json');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadFilmCache() {
  try {
    return JSON.parse(fs.readFileSync(FILM_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveFilmCache(cache) {
  try {
    fs.writeFileSync(FILM_CACHE_FILE, JSON.stringify(cache, null, 0), 'utf8');
  } catch {
    /* non-fatal */
  }
}

async function wikiFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

// Curated programme from the official cinema page. `wiki` is a preferred
// Wikipedia title hint; `event` marks non-film sessions (Q&As, live gameplay).
export const FILM_LIST = [
  { name: 'Irma Vep', wiki: 'Irma Vep (1996 film)' },
  { name: 'Spend It All', wiki: 'Spend It All' },
  { name: "The Blues Accordin' To Lightnin' Hopkins", wiki: "The Blues Accordin' to Lightnin' Hopkins", alias: ["The Blues According To Lightnin' Hopkins"] },
  { name: 'The Cook, The Thief, His Wife and Her Lover', wiki: 'The Cook, the Thief, His Wife & Her Lover' },
  { name: 'Klute', wiki: 'Klute' },
  { name: 'Mikey & Nicky', wiki: 'Mikey and Nicky' },
  { name: 'The Singing Ringing Tree', wiki: 'The Singing Ringing Tree (1957 film)' },
  { name: 'Speed Racer', wiki: 'Speed Racer (film)' },
  { name: 'Super Nature', wiki: 'Super Nature (film)' },
  { name: 'The Last Sacrifice', wiki: 'The Last Sacrifice (2011 film)' },
  { name: 'The Haunted Moustache', wiki: 'The Haunted Moustache' },
  { name: 'Ebony & Ivory', wiki: 'Ebony & Ivory' },
  { name: 'Normal', wiki: 'Normal (2003 film)', alias: ['Normal + Q&A'] },
  { name: 'Bulk', wiki: 'Bulk (film)' },
  { name: 'Reflection In A Dead Diamond', wiki: 'Reflection in a Dead Diamond' },
  { name: 'The Sword In The Stone', wiki: 'The Sword in the Stone (1963 film)' },
  { name: 'Erupcja', wiki: 'Erupcja' },
  { name: 'Drive', wiki: 'Drive (2011 film)' },
  { name: 'Annihilation', wiki: 'Annihilation (film)' },
  { name: 'Mandy', wiki: 'Mandy (2018 film)' },
  { name: 'Wizard Of Oz', wiki: 'The Wizard of Oz' },
  { name: 'Up', wiki: 'Up (2009 film)' },
  { name: 'Oh Brother Where Art Thou?', wiki: "O Brother, Where Art Thou?", alias: ['O Brother, Where Art Thou?'] },
  { name: 'Duel', wiki: 'Duel (1971 film)' },
  { name: 'Sunlight', wiki: 'Sunlight (2025 film)' },
  { name: 'Badlands', wiki: 'Badlands (film)' },
  { name: 'My Own Private Idaho', wiki: 'My Own Private Idaho' },
  { name: 'Mad Max: Fury Road', wiki: 'Mad Max: Fury Road' },
  { name: 'Sirāt', wiki: 'SIRAT' },
  { name: 'Live game play of Red Dead Redemption 2', event: true, blurb: 'A live gameplay session of Red Dead Redemption 2 with commentary by Calamity Calling.' },
  { name: 'Soundtracking Q&A', event: true, blurb: 'Soundtracking Q&A hosted by Edith Bowman with Geoff Barrow, Ben Salisbury, Gazelle Twin and Mark Jenkin.' },
  { name: 'GAME', event: true, blurb: 'A screening event from the Curzon-curated cinema programme.' },
  { name: 'GAME Q&A', event: true, blurb: 'Post-screening Q&A with the filmmakers.' },
  { name: 'Andrea Arnold Q&A', event: true, blurb: 'A Q&A with Oscar-winning director Andrea Arnold.' }
];

export function filmForName(name) {
  const norm = normalizeName(name);
  const nTokens = norm.split(' ').filter(Boolean);
  for (const f of FILM_LIST) {
    if (normalizeName(f.name) === norm) return f;
    const fTokens = normalizeName(f.name).split(' ').filter(Boolean);
    // Whole-token containment only for multi-word titles (prevents "Up" matching "Super Furry Animals").
    if (fTokens.length >= 2 && fTokens.every((t) => nTokens.includes(t))) return f;
    for (const a of f.alias || []) {
      if (normalizeName(a) === norm) return f;
    }
  }
  return null;
}

async function wikipediaSearch(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const json = await wikiFetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&srnamespace=0`
      );
      return json.query?.search?.[0]?.title || null;
    } catch (err) {
      if (attempt < 2) await sleep(1500 * (attempt + 1));
      else throw err;
    }
  }
  return null;
}

async function wikipediaPage(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1) + Math.random() * 800);
      continue;
    }
    if (!res.ok) return null;
    const j = await res.json();
    if (j.type === 'disambiguation' || !j.title) return null;
    const info = {
      title: j.title,
      extract: j.extract || '',
      thumbnail: j.thumbnail?.source || null,
      url: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    };
    // Some film pages expose a poster via pageimages but not via the summary API.
    if (!info.thumbnail) {
      try {
        const json = await wikiFetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(j.title)}&prop=pageimages&piprop=thumbnail&pithumbsize=900&format=json&redirects=1`
        );
        const page = Object.values(json.query?.pages || {})[0];
        info.thumbnail = page?.thumbnail?.source || null;
      } catch {
        /* non-fatal */
      }
    }
    return info;
  }
  return null;
}

/** Fetch a film's info (lead paragraph + poster) from Wikipedia, cached on disk. */
export async function filmInfo(film) {
  if (film.event) return { title: film.name, extract: film.blurb || '', thumbnail: null, url: null };
  const cache = loadFilmCache();
  if (cache[film.name]?.extract) return cache[film.name];
  try {
    const hint = film.wiki || film.name;
    let page = await wikipediaPage(hint);
    if (!page || !page.extract) {
      const found = await wikipediaSearch(hint.replace(/_/g, ' '));
      if (found && found !== hint) page = await wikipediaPage(found);
    }
    if (page && page.extract) {
      cache[film.name] = { title: page.title, extract: page.extract, thumbnail: page.thumbnail, url: page.url };
      saveFilmCache(cache);
      return cache[film.name];
    }
  } catch (err) {
    console.warn(`  ! wikipedia failed for ${film.name}: ${err.message}`);
  }
  const fallback = { title: film.name, extract: 'A screening from the Curzon-curated cinema programme at End of the Road 2026.', thumbnail: null, url: null };
  cache[film.name] = fallback;
  saveFilmCache(cache);
  return fallback;
}

/** Detect film acts from the clashfinder programme. */
export function classifyFilms(acts) {
  return acts.filter((a) => {
    const f = filmForName(a.name);
    return f || a.stage === 'Cinema';
  });
}

/** Check whether yt-dlp is available for trailer audio extraction. */
export function hasYtDlp() {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], (err) => resolve(!err));
  });
}

/**
 * Download ~20s of audio from a YouTube trailer for a film.
 * Requires yt-dlp (Python) installed on the user's machine.
 * Returns { local, seconds } on success, or null.
 */
export async function trailerAudio(film, index = 0) {
  const outFile = path.join(FILMS_DIR, `film-${index}.mp3`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    return { local: `./previews/${path.basename(outFile)}`, seconds: 20 };
  }
  const tmp = path.join(FILMS_DIR, `._film_${index}.%(ext)s`);
  // Search the top 5 results in one pass with --ignore-errors, so unavailable
  // / region-blocked results are skipped and the first available trailer wins.
  try {
    await exec('yt-dlp', [
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '-f',
      'bestaudio/best',
      '--ignore-errors',
      '--no-overwrites',
      '--postprocessor-args',
      '-t 20',
      '-o',
      tmp,
      `ytsearch5:${film.name} official trailer`
    ]);
  } catch {
    // yt-dlp exits non-zero when nothing was downloadable
  }
  const produced = fs
    .readdirSync(FILMS_DIR)
    .filter((f) => f.startsWith(`._film_${index}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
  if (!produced.length) {
    for (const f of fs.readdirSync(FILMS_DIR)) {
      if (f.startsWith(`._film_${index}.`)) fs.rmSync(path.join(FILMS_DIR, f), { force: true });
    }
    console.warn(`  ! trailer audio failed for "${film.name}": no available YouTube result`);
    return null;
  }
  const src = path.join(FILMS_DIR, produced[0]);
  fs.renameSync(src, outFile);
  return { local: `./previews/${path.basename(outFile)}`, seconds: 20 };
}
