// Interactive data-refresh CLI.
//
//   npm run clips                    # refresh everything (Deezer + Apple + optional Spotify)
//   npm run clips -- --films         # also fetch film trailer audio (needs yt-dlp)
//
// Optional "login"-style sources (set before running):
//   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   -> enables Spotify previews
//   EOTR_FILM_AUDIO=1                            -> same as --films
import { runBuild, credsFromEnv } from './build.mjs';
import { hasYtDlp } from './films.mjs';
import { execFile } from 'node:child_process';

const args = process.argv.slice(2);
const wantFilms = args.includes('--films') || process.env.EOTR_FILM_AUDIO === '1';
const creds = credsFromEnv();

const banner = `
==========================================================
  End of the Road 2026 — data refresh CLI
  Fetches set times, artist info, audio previews and clips.
==========================================================`;
console.log(banner);

// --- Spotify check ---
if (creds) {
  console.log('  Spotify: enabled (client credentials detected)');
} else {
  console.log('  Spotify: not configured — using Deezer + Apple Music/iTunes previews only.');
  console.log('    To enable Spotify previews too, create a free app at');
  console.log('    https://developer.spotify.com/dashboard  then run:');
  console.log('      set SPOTIFY_CLIENT_ID=<id>   (or $env:SPOTIFY_CLIENT_ID=... on PowerShell)');
  console.log('      set SPOTIFY_CLIENT_SECRET=<secret>');
}

// --- yt-dlp check (film trailer audio) ---
const yt = await hasYtDlp();
if (wantFilms && !yt) {
  console.log('\n  Film trailer audio requested but yt-dlp was not found.');
  console.log('  Install it with:  pip install yt-dlp   (or https://github.com/yt-dlp/yt-dlp)');
  console.log('  then re-run:      npm run clips -- --films');
} else if (wantFilms) {
  console.log('\n  Film trailer audio: enabled via yt-dlp (each trailer trimmed to 20s)');
} else {
  console.log('\n  Film trailer audio: off. Add --films to fetch 20s trailer clips (needs yt-dlp).');
}

console.log('\n  Starting build...\n');
try {
  await runBuild({ creds, filmAudio: wantFilms });
  console.log('\n✅ Done. Run `npm run build` in app/ and redeploy to publish.');
  if (creds || wantFilms) {
    console.log('   Sources used this run: Deezer + Apple Music/iTunes' + (creds ? ' + Spotify' : '') + (wantFilms ? ' + YouTube trailers' : ''));
  }
} catch (err) {
  console.error('\n❌ Build failed:', err.message);
  process.exit(1);
}
