import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mapLimit } from './lib/http.mjs';
import { normalizeName } from './lib/normalize.mjs';
import { deezerTracks, itunesTracks, spotifyTracks, AUDIO_OVERRIDES, isArtistTrack } from './providers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEWS_DIR = path.resolve(__dirname, '../../app/public/previews');
fs.mkdirSync(PREVIEWS_DIR, { recursive: true });

const exec = promisify(execFile);

/** How many clips we want per artist (when the artist has that many). */
export const TRACK_TARGET = 5;
/** Fetch this many candidates so a few failed downloads can be swapped out. */
const CANDIDATE_POOL = 12;
const CLIP_SECONDS = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function dedupeTracks(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const key = normalizeName(t.track.replace(/\(feat.*\)/i, '').replace(/\(feat\..*\)/i, ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function downloadBuffer(url, attempts = 6) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.deezer.com/' } });
      if (!res.ok) throw new Error(`audio download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function trimToClip(inputBuffer, outFile) {
  const tmp = path.join(PREVIEWS_DIR, `._tmp_${path.basename(outFile)}`);
  fs.writeFileSync(tmp, inputBuffer);
  try {
    await exec('ffmpeg', [
      '-y',
      '-i',
      tmp,
      '-t',
      String(CLIP_SECONDS),
      '-ac',
      '1',
      '-ar',
      '44100',
      '-b:a',
      '64k',
      outFile
    ]);
  } finally {
    fs.unlink(tmp, () => {});
  }
  return fs.statSync(outFile).size;
}

async function gatherCandidates(artist, creds, attempts = 3) {
  const over = AUDIO_OVERRIDES[artist.slug] || {};
  let lastCount = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const lists = await Promise.allSettled([
      deezerTracks(artist.name, over.deezerArtistId || null),
      over.blockItunes ? Promise.resolve([]) : itunesTracks(artist.name, over.itunesArtistId || null),
      creds ? spotifyTracks(artist.name, creds) : Promise.resolve([])
    ]);
    lists.forEach((l, idx) => {
      if (l.status === 'rejected') {
        const who = ['deezer', 'itunes', 'spotify'][idx];
        console.warn(`  ! ${who} gather failed for "${artist.name}": ${l.reason?.message}`);
      }
    });
    const tracks = dedupeTracks(
      lists
        .filter((l) => l.status === 'fulfilled')
        .flatMap((l) => l.value)
        .filter((t) => isArtistTrack(t, artist.name))
    );
    if (tracks.length) return tracks.slice(0, CANDIDATE_POOL);
    lastCount = tracks.length;
    await sleep(1500 * (attempt + 1));
  }
  return [];
}

/**
 * Bundle offline clips for one artist. Returns
 * { slug, name, tracks: [{track, album, url, artwork, durationMs, local}], found, bundled, failed }
 * Only tracks that downloaded + trimmed successfully get a `local` path and are returned.
 * `prev` is the artist's previews from the previous run; matching clips are reused.
 */
export async function bundleArtist(artist, creds, prev = []) {
  const out = { slug: artist.slug, name: artist.name, tracks: [], artwork: null, found: 0, bundled: 0, failed: [] };
  // Track which `<slug>-<n>.mp3` filenames are already claimed so reused clips
  // and fresh downloads never collide on the same file.
  const claimed = new Set();
  const freeIndex = () => {
    let i = 0;
    while (claimed.has(`${artist.slug}-${i}.mp3`)) i++;
    claimed.add(`${artist.slug}-${i}.mp3`);
    return i;
  };
  try {
    const candidates = await gatherCandidates(artist, creds);
    out.found = candidates.length;
    for (let i = 0; i < candidates.length && out.tracks.length < TRACK_TARGET; i++) {
      const cand = candidates[i];

      // Reuse an existing clip when the same track was bundled before and its
      // file is not already claimed by another track.
      const reused = prev.find(
        (p) => p.local && !claimed.has(path.basename(p.local)) && normalizeName(p.track) === normalizeName(cand.track)
      );
      if (reused && reused.local) {
        const existing = path.join(__dirname, '../../app/public', reused.local.replace(/^\.\//, ''));
        if (fs.existsSync(existing) && fs.statSync(existing).size > 0) {
          claimed.add(path.basename(reused.local));
          out.tracks.push({ ...cand, local: reused.local });
          continue;
        }
      }

      const idx = freeIndex();
      const localFile = path.join(PREVIEWS_DIR, `${artist.slug}-${idx}.mp3`);
      const local = `./previews/${artist.slug}-${idx}.mp3`;
      try {
        const buf = await downloadBuffer(cand.url);
        const size = await trimToClip(buf, localFile);
        if (size <= 0) {
          fs.rmSync(localFile, { force: true });
          out.failed.push(cand.track);
          continue;
        }
        out.tracks.push({ ...cand, local });
      } catch (err) {
        out.failed.push(cand.track);
        fs.rmSync(localFile, { force: true });
      }
    }
    out.bundled = out.tracks.length;
    out.artwork = out.tracks[0]?.artwork || null;
  } catch (err) {
    console.warn(`  ! previews failed for ${artist.name}: ${err.message}`);
  }
  return out;
}

/**
 * Fetch + bundle offline clips for all music artists.
 * A repair loop re-tries artists that end up below the target, so a few flaky
 * downloads don't leave artists short. Pass `previous` (the previously written
 * artists array) to reuse unchanged clips and make iterative runs fast.
 */
export async function scrapePreviews(artists, { creds = null, repairRounds = 2, previous = [] } = {}) {
  const targets = artists.filter((a) => a.type === 'music' || a.type === null);
  console.log(`Fetching previews (Deezer + Apple + ${creds ? 'Spotify' : 'no Spotify creds'}) for ${targets.length} artists...`);

  const prevMap = new Map();
  for (const a of previous) {
    if (a.type === 'music') prevMap.set(a.slug, a.previews || []);
  }

  let rows = await mapLimit(targets, 3, (a) => bundleArtist(a, creds, prevMap.get(a.slug)));

  for (let round = 0; round < repairRounds; round++) {
    // Re-bundle artists below target, including those whose gather returned nothing.
    const short = rows.filter((r) => r && r.tracks.length < TRACK_TARGET);
    if (!short.length) break;
    console.log(`  repair round ${round + 1}: re-bundling ${short.length} artists below target...`);
    const retried = await mapLimit(short.map((r) => targets.find((a) => a.slug === r.slug)), 2, (a) => bundleArtist(a, creds, prevMap.get(a.slug)));
    for (const r of retried) {
      const idx = rows.findIndex((x) => x && x.slug === r.slug);
      if (idx >= 0) rows[idx] = r;
    }
  }

  const map = {};
  for (const row of rows) {
    if (row && (row.tracks.length || row.artwork)) map[row.slug] = row;
  }
  const withTracks = Object.values(map).filter((r) => r.tracks.length).length;
  const belowTarget = rows.filter((r) => r && r.tracks.length < TRACK_TARGET);
  console.log(`  ${withTracks} artists have clips (target ${TRACK_TARGET}/artist)`);
  if (belowTarget.length) {
    console.log('  artists below target:');
    for (const r of belowTarget) {
      console.log(`    ${r.name}: ${r.tracks.length}/${TRACK_TARGET} (found ${r.found} across sources, ${r.failed.length} downloads failed)`);
    }
  }

  // Clean stale clip files not referenced by any artist.
  const expected = new Set();
  for (const row of Object.values(map)) {
    for (const t of row.tracks) if (t.local) expected.add(path.basename(t.local));
  }
  for (const file of fs.readdirSync(PREVIEWS_DIR)) {
    if (file.startsWith('._tmp_')) {
      fs.rmSync(path.join(PREVIEWS_DIR, file), { force: true });
      continue;
    }
    if (!expected.has(file)) fs.rmSync(path.join(PREVIEWS_DIR, file), { force: true });
  }
  return map;
}
