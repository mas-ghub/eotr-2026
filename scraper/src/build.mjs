import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scrapeClashfinder } from './clashfinder.mjs';
import { scrapeEotrArtists } from './eotr.mjs';
import { scrapePreviews, TRACK_TARGET } from './previews.mjs';
import { NO_PREVIEW_SLUGS } from './providers.mjs';
import { classifyFilms, filmInfo, filmForName, trailerAudio, hasYtDlp, sleep } from './films.mjs';
import { nameScore, normalizeName } from './lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../app/public/data');
const PREVIEWS_DIR = path.resolve(__dirname, '../../app/public/previews');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PREVIEWS_DIR, { recursive: true });

export const credsFromEnv = () =>
  process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    ? { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET }
    : null;

/** Manual name aliases where act names and artist names differ structurally. */
const ALIASES = [
  ['m(h)aol', 'M(h)aol'],
  ['yhwh nailgun', 'YHWH Nailgun'],
  ['kelly lee owens', 'Kelly Lee Owens (DJ)'],
  ['kurt vile', 'Kurt Vile & The Violators'],
  ['earl sweatshirt', 'Earl Sweatshirt & MIKE'],
  ['beverly glenn copeland', 'Beverly Glenn-Copeland & Elizabeth Copeland'],
  ['david thomas broughton', 'David Thomas Broughton'],
  ['ryan davis', 'Ryan Davis & The Roadhouse Band'],
  ['working men club', "Working Men's Club"],
  ['nana benz', 'Nana Benz Du Togo'],
  ['caroline', 'caroline']
];

function bestArtistMatch(actName, artists) {
  const norm = normalizeName(actName);
  let best = null;
  let bestScore = 0;
  for (const artist of artists) {
    const s = nameScore(actName, artist.name);
    if (s > bestScore) {
      bestScore = s;
      best = artist;
    }
  }
  for (const [alias, full] of ALIASES) {
    if (normalizeName(alias) === norm || norm.includes(normalizeName(alias))) {
      const found = artists.find((a) => normalizeName(a.name) === normalizeName(full));
      if (found && bestScore < 0.9) return found;
    }
  }
  if (bestScore >= 0.8) return best;
  return null;
}

function isPlaceholder(name) {
  return (
    name === '?' ||
    /^\?\s*\(DJ\)$/i.test(name) ||
    /secret/i.test(name) ||
    /not confirmed/i.test(name) ||
    /^TBA/i.test(name)
  );
}

function inferType(name) {
  if (filmForName(name)) return 'cinema';
  if (/comedy/i.test(name)) return 'comedy';
  if (/silent disco/i.test(name)) return 'other';
  if (/\(dj\)/i.test(name) || name === '?') return 'dj';
  return 'other';
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 0), 'utf8');
  console.log(`  wrote ${path.relative(process.cwd(), file)} (${Buffer.byteLength(JSON.stringify(data))} bytes)`);
}

export async function runBuild({ creds = null, filmAudio = false } = {}) {
  console.log('=== Step 1: Clashfinder set times ===');
  const clash = await scrapeClashfinder();

  console.log('=== Step 2: EOTR artist pages ===');
  const { artists } = await scrapeEotrArtists();

  console.log('=== Step 3: Music previews (multi-source) ===');
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'artists.json'), 'utf8'));
  } catch {
    /* first run */
  }
  const previews = await scrapePreviews(artists, { creds, repairRounds: 2, previous });

  console.log('=== Step 3b: Cinema programme ===');
  const filmActs = classifyFilms(clash.days.flatMap((d) => d.acts));
  const films = [];
  let filmIndex = 0;
  const wantFilmAudio = filmAudio && (await hasYtDlp());
  if (filmAudio && !wantFilmAudio) console.warn('  ! EOTR_FILM_AUDIO set but yt-dlp not found — installing it enables trailer audio (pip install yt-dlp).');
  for (const act of filmActs) {
    const f = filmForName(act.name);
    if (!f) {
      films.push({ slug: `film-${filmIndex++}`, name: act.name, type: 'cinema', image: null, bio: 'A screening from the Curzon-curated cinema programme at End of the Road 2026.', links: [], spotifyId: null, previews: [], artwork: null, sets: [], isFilm: true });
      continue;
    }
    const info = await filmInfo(f);
    await sleep(600);
    let previewsFilm = [];
    if (wantFilmAudio) {
      const clip = await trailerAudio(f, filmIndex);
      if (clip) previewsFilm = [{ track: `${f.name} (trailer)`, album: 'Trailer audio', url: '', local: clip.local, artwork: info.thumbnail, durationMs: 20000 }];
    }
    films.push({
      slug: `film-${filmIndex++}`,
      name: f.name,
      type: 'cinema',
      image: info.thumbnail,
      bio: info.extract || 'A screening from the Curzon-curated cinema programme at End of the Road 2026.',
      links: info.url ? [{ label: 'wikipedia', url: info.url }] : [],
      spotifyId: null,
      previews: previewsFilm,
      artwork: info.thumbnail,
      sets: [],
      isFilm: true
    });
  }
  console.log(`  ${films.length} film screenings classified`);

  console.log('=== Step 4: Merge ===');
  const acts = [];
  const artistSets = new Map();
  const matched = new Set();
  const unmatchedActs = [];

  for (const day of clash.days) {
    for (const act of day.acts) {
      const film = filmForName(act.name);
      let artist = null;
      if (!film) artist = bestArtistMatch(act.name, artists);
      const slug = film ? `film-${films.findIndex((x) => x.name === film.name)}` : artist ? artist.slug : null;
      if (film) {
        const fi = films.find((x) => x.name === film.name);
        if (fi) fi.sets.push({ dayKey: day.key, stage: act.stage, start: act.start, end: act.end });
      } else if (artist) {
        matched.add(slug);
        if (!artistSets.has(slug)) artistSets.set(slug, []);
        artistSets.get(slug).push({ dayKey: day.key, stage: act.stage, start: act.start, end: act.end });
      } else {
        unmatchedActs.push(act.name);
      }
      const type = film ? 'cinema' : artist ? artist.type : inferType(act.name);
      acts.push({
        id: `${day.key}|${act.stage}|${act.name}|${act.start}`,
        name: act.name,
        dayKey: day.key,
        stage: act.stage,
        startMs: act.startMs,
        endMs: act.endMs,
        start: act.start,
        end: act.end,
        mbid: act.mbid,
        short: act.short,
        artistSlug: slug,
        type,
        placeholder: isPlaceholder(act.name)
      });
    }
  }

  const artistRecords = artists.map((artist) => ({
    slug: artist.slug,
    name: artist.name,
    type: artist.type || 'other',
    image: artist.image,
    bio: artist.bio,
    links: artist.links,
    spotifyId: artist.spotifyId,
    previews: (previews[artist.slug]?.tracks || []).map((t) => ({
      track: t.track,
      album: t.album,
      url: t.url,
      local: t.local || null,
      artwork: t.artwork,
      durationMs: t.durationMs
    })),
    artwork: previews[artist.slug]?.artwork || null,
    sets: artistSets.get(artist.slug) || [],
    isFilm: false
  }));

  const allArtists = [...artistRecords, ...films];

  const localPreviewFiles = [];
  for (const a of allArtists) {
    for (const p of a.previews) if (p.local) localPreviewFiles.push(p.local);
  }
  localPreviewFiles.sort();
  writeJson(path.join(OUT_DIR, 'previews-manifest.json'), localPreviewFiles);

  const unmatchedArtists = artists.filter((a) => !matched.has(a.slug) && a.type === 'music');

  const meta = {
    festival: 'End of the Road 2026',
    year: 2026,
    venue: 'Larmer Tree Gardens, Dorset, UK',
    dates: 'Thursday 3 – Sunday 6 September 2026',
    clashfinderUrl: 'https://clashfinder.com/s/eotr2026/',
    officialSite: 'https://endoftheroadfestival.com/line-up/',
    generatedAt: new Date().toISOString(),
    days: clash.days.map((d) => ({ key: d.key, label: d.label, short: d.short })),
    stages: clash.stages,
    stats: {
      acts: acts.length,
      artists: allArtists.length,
      artistsWithPreviews: allArtists.filter((a) => a.previews.length).length,
      films: films.length,
      matchedArtists: matched.size,
      unmatchedActs: unmatchedActs.length
    }
  };

  writeJson(path.join(OUT_DIR, 'meta.json'), meta);
  writeJson(path.join(OUT_DIR, 'acts.json'), acts);
  writeJson(path.join(OUT_DIR, 'artists.json'), allArtists);

  // ================= Verification =================
  const previewRoot = path.resolve(__dirname, '../../app/public');
  const missing = [];
  let totalTracks = 0;
  for (const a of allArtists) {
    for (const p of a.previews) {
      totalTracks++;
      if (!p.local) {
        missing.push(`${a.slug} :: "${p.track}" has no offline clip`);
        continue;
      }
      const file = path.join(previewRoot, p.local.replace(/^\.\//, ''));
      if (!fs.existsSync(file)) missing.push(`${a.slug} :: "${p.track}" -> missing file ${p.local}`);
    }
  }
  if (missing.length) {
    console.error('\n=== FAIL: missing offline clips ===');
    missing.forEach((m) => console.error('  ' + m));
    console.error(`\n${missing.length} of ${totalTracks} preview tracks are not available offline. Fix before shipping.`);
    process.exit(1);
  }

  // Track-coverage check: music artists should have TRACK_TARGET clips
  // (except NO_PREVIEW_SLUGS artists, which intentionally have no catalog).
  const musicArtists = allArtists.filter((a) => a.type === 'music');
  const zeroClips = musicArtists.filter((a) => a.previews.length === 0 && !NO_PREVIEW_SLUGS.has(a.slug));
  const failedDownloads = musicArtists.filter((a) => a.previews.length < TRACK_TARGET);
  if (zeroClips.length) {
    console.error('\n=== FAIL: music artists with ZERO offline clips ===');
    zeroClips.forEach((a) => console.error('  ' + a.name));
    process.exit(1);
  }
  if (failedDownloads.length) {
    console.log('\n=== Note: music artists below ' + TRACK_TARGET + ' clips (see report) ===');
    for (const a of failedDownloads) {
      const row = previews[a.slug];
      const why =
        row && row.found > 0 && row.found < TRACK_TARGET
          ? `only ${row.found} track(s) available across sources`
          : row && row.failed.length
            ? `${row.failed.length} download(s) failed`
            : 'fewer tracks available';
      console.log(`  ${a.name}: ${a.previews.length}/${TRACK_TARGET} — ${why}`);
    }
  }

  console.log(`\n=== Verify OK: all ${totalTracks} preview tracks have offline clips; ${musicArtists.length - failedDownloads.length}/${musicArtists.length} music artists at full ${TRACK_TARGET} ===`);

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(meta.stats, null, 2));
  if (unmatchedActs.length) {
    console.log('\nUnmatched acts (no artist page match):');
    console.log([...new Set(unmatchedActs)].join('\n'));
  }
  if (unmatchedArtists.length) {
    console.log('\nMusic artists without a set time in clashfinder:');
    console.log(unmatchedArtists.map((a) => a.name).join('\n'));
  }
}

// Run directly when invoked from the CLI, otherwise allow the cli.mjs wrapper
// to call runBuild() with extra sources (Spotify, film trailer audio).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuild({ creds: credsFromEnv() }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
