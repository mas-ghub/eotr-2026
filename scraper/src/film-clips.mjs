// Add 20s YouTube trailer audio clips to existing film records (by slug),
// without re-running the whole pipeline. Requires yt-dlp.
// Usage: node src/film-clips.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filmForName, trailerAudio, hasYtDlp, sleep } from './films.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../app/public/data');

const artists = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'artists.json'), 'utf8'));
const films = artists.filter((a) => a.isFilm === true && a.previews.length === 0);

if (!films.length) {
  console.log('No films missing trailer audio.');
  process.exit(0);
}
if (!(await hasYtDlp())) {
  console.error('yt-dlp not found. Install it first: pip install yt-dlp');
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const film of films) {
  const f = filmForName(film.name);
  if (!f || f.event) {
    console.log(`  skip (no FILM_LIST entry or event): ${film.name}`);
    continue;
  }
  const m = film.slug.match(/^film-(\d+)$/);
  const index = m ? Number(m[1]) : 0;
  try {
    const clip = await trailerAudio(f, index);
    await sleep(600);
    if (clip) {
      film.previews = [
        {
          track: `${f.name} (trailer)`,
          album: 'Trailer audio',
          url: '',
          local: clip.local,
          artwork: film.artwork,
          durationMs: 20000
        }
      ];
      ok++;
      console.log(`  + ${film.name} (${clip.local})`);
    } else {
      fail++;
      console.log(`  - ${film.name}: no trailer audio`);
    }
  } catch (err) {
    fail++;
    console.log(`  - ${film.name}: ${err.message}`);
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'artists.json'), JSON.stringify(artists), 'utf8');

const manifest = [];
for (const a of artists) for (const p of a.previews) if (p.local) manifest.push(p.local);
manifest.sort();
fs.writeFileSync(path.join(OUT_DIR, 'previews-manifest.json'), JSON.stringify(manifest), 'utf8');

console.log(`\ndone: ${ok} trailer clips added, ${fail} failed. Manifest now ${manifest.length} clips.`);
