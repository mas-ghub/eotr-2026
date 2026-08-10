// Multiple audio-preview providers. Each returns a list of candidate tracks;
// tracks are merged + de-duplicated upstream so artists get up to 5 clips even
// when a single provider is missing tracks.
import { fetchJson } from './lib/http.mjs';
import { nameScore, normalizeName } from './lib/normalize.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function cleanName(name) {
  return (name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\b&+\s*the\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimum artist-name similarity before an iTunes result is trusted. */
const MIN_ARTIST_SCORE = 0.7;

/**
 * Manual overrides for artists whose name collides with an unrelated,
 * higher-profile act on the providers. Same-name artists all score 1.0, so a
 * score gate cannot tell them apart — pin the correct provider artist ID here.
 * Keyed by artist slug (see data/artists.json).
 */
export const AUDIO_OVERRIDES = {
  // band caroline (Rough Trade, "caroline 2"), not the country/pop "Caroline".
  'caroline': { deezerArtistId: 106310322 },
  // indie Mia Wilson (piano/guitar, orchestral), not the "relaxation piano" one.
  'mia-wilson': { deezerArtistId: 344488281, blockItunes: true },
  // Joseph Scarisbrick's Big Red (The Orchestra (For Now) side project),
  // not Big Red Machine.
  'big-red': { deezerArtistId: 404858772, itunesArtistId: 6785573166 },
  // Irish post-punk four-piece, not the Hawaiian "Maoli".
  'mhaol': { deezerArtistId: 84745582 },
  // Michael Clark (South London), "In My Dreams You Were Golden".
  'lichen': { deezerArtistId: 180855427 },
  // Sheffield psych-punk four-piece.
  'femur': { deezerArtistId: 290277611 },
  // "Kurt Vile & The Violators" — the "& The" search term misses the Deezer
  // artist page (id 294912), so pin it directly.
  'kurt-vile-the-violators': { deezerArtistId: 294912 }
};

/**
 * Music artists that intentionally ship with no previews because no verifiable
 * streaming catalog exists for them (so a different same-named act is not
 * shown in their place).
 */
export const NO_PREVIEW_SLUGS = new Set([
  'warby', // Russell Lewis Warby — not on Deezer/iTunes; only a same-named choir exists
  'spanish-horses', // Paris jangly-guitar five-piece — no streaming catalog found
  'dj-crenshaw', // vinyl/psychedelic DJ — no streaming catalog
  'rose-of-nevada-live-score-by-the-cornish-sound-unit' // live film score — no streaming catalog
]);

/** Titles that are obviously not the artist performing. */
const BAD_TITLE = /\b(karaoke|instrumental|tribute)\b/i;
/** Titles that credit another performer against the target artist. */
const CREDIT_TITLE = /\b(feat(?:\.|uring)?|remix)\b/i;

/**
 * True when a candidate track is plausibly the target artist's own music.
 * Rejects karaoke/instrumental backing tracks and tracks that merely credit
 * the target as a guest or remixer (e.g. "(feat. Mac DeMarco)", "(Bug Teeth
 * Remix)").
 */
export function isArtistTrack(track, artistName) {
  const title = normalizeName(track.track || '');
  if (!title || BAD_TITLE.test(title)) return false;
  if (CREDIT_TITLE.test(title)) {
    const target = normalizeName(artistName);
    // The title names the target artist -> the target is a guest/remixer here,
    // not the primary performer.
    if (target && title.includes(target)) return false;
  }
  return true;
}

function pickBest(results, target, minScore = 0.7) {
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const s = Math.max(
      nameScore(r.name || r.artistName, target),
      nameScore(cleanName(r.name || r.artistName), cleanName(target))
    );
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return bestScore >= minScore ? best : null;
}

/** Deezer: search artist -> top tracks with 30s previews. Pass artistId to pin the exact artist. */
export async function deezerTracks(artistName, artistId = null) {
  const tracks = [];
  let matchId = artistId;
  if (!matchId) {
    const search = await fetchJson(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName(artistName))}&limit=10`,
      { delay: 350, force: true }
    );
    const match = pickBest(search.data || [], artistName);
    if (match) matchId = match.id;
  }
  if (matchId) {
    const top = await fetchJson(`https://api.deezer.com/artist/${matchId}/top?limit=10`, { delay: 0, force: true });
    for (const t of top.data || []) {
      if (!t.preview) continue;
      const track = {
        track: t.title,
        album: t.album?.title || '',
        url: t.preview,
        artwork: (t.album?.cover_medium || '').replace(/\/250x250-/, '/500x500-'),
        durationMs: t.duration ? t.duration * 1000 : null,
        source: 'deezer'
      };
      if (!isArtistTrack(track, artistName)) continue;
      tracks.push(track);
    }
  }
  return tracks;
}

/**
 * Apple Music / iTunes: 30s previews (songs then music videos).
 * The plain `term` search also matches track TITLES, so results are trusted
 * only when the result's artist name is close to the target. Pass artistId to
 * pin the exact artist via `lookup`.
 */
export async function itunesTracks(artistName, artistId = null) {
  const tracks = [];
  const seen = new Set();
  if (artistId) {
    const json = await fetchJson(
      `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=200`,
      { delay: 350, force: true }
    );
    for (const r of json.results || []) {
      if (!r.previewUrl || r.wrapperType !== 'track') continue;
      const track = {
        track: r.trackName,
        album: r.collectionName || '',
        url: r.previewUrl,
        artwork: (r.artworkUrl100 || '').replace(/100x100/, '600x600'),
        durationMs: r.trackTimeMillis || null,
        source: 'apple'
      };
      if (!isArtistTrack(track, artistName)) continue;
      const key = normalizeName(r.trackName);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
      if (tracks.length >= 10) break;
    }
    return tracks;
  }
  for (const entity of ['song', 'musicVideo']) {
    const q = cleanName(artistName).replace(/"/g, '');
    const json = await fetchJson(
      `https://itunes.apple.com/search?media=music&entity=${entity}&term=${encodeURIComponent(q)}&limit=25`,
      { delay: 350, force: true }
    );
    const results = json.results || [];
    // Trust only results whose ARTIST name matches; the term search also
    // returns tracks that merely share a title word with the artist name
    // (e.g. "War Pigs" for "WARBY").
    const ordered = results
      .filter((r) => nameScore(r.artistName, artistName) >= MIN_ARTIST_SCORE)
      .sort((a, b) => nameScore(b.artistName, artistName) - nameScore(a.artistName, artistName));
    for (const r of ordered) {
      if (!r.previewUrl) continue;
      const track = {
        track: r.trackName,
        album: r.collectionName || '',
        url: r.previewUrl,
        artwork: (r.artworkUrl100 || '').replace(/100x100/, '600x600'),
        durationMs: r.trackTimeMillis || null,
        source: entity === 'song' ? 'apple' : 'apple-video'
      };
      if (!isArtistTrack(track, artistName)) continue;
      const key = normalizeName(r.trackName);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
      if (tracks.length >= 10) break;
    }
    if (tracks.length >= 10) break;
  }
  return tracks;
}

/**
 * Spotify (optional): requires a free Spotify for Developers app.
 * Set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET to enable. Returns [] otherwise.
 */
export async function spotifyTracks(artistName, creds) {
  if (!creds || !creds.clientId || !creds.clientSecret) return [];
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token: token } = await tokenRes.json();
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=20&q=${encodeURIComponent(`artist:"${artistName.replace(/"/g, '')}"`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`search ${res.status}`);
    const json = await res.json();
    const tracks = [];
    const seen = new Set();
    for (const t of json.tracks?.items || []) {
      if (!t.preview_url) continue;
      const key = normalizeName(t.name);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({
        track: t.name,
        album: t.album?.name || '',
        url: t.preview_url,
        artwork: (t.album?.images?.[1]?.url) || (t.album?.images?.[0]?.url) || '',
        durationMs: t.duration_ms || null,
        source: 'spotify'
      });
    }
    return tracks;
  } catch (err) {
    console.warn(`  ! spotify provider skipped for "${artistName}": ${err.message}`);
    return [];
  }
}
