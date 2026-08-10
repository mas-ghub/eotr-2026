// One-off: re-bundle audio previews for a single artist (by slug) after adding
// an AUDIO_OVERRIDES entry, without re-running the whole pipeline.
// Usage: node src/rebundle-one.mjs <slug>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleArtist } from './previews.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../app/public/data');
const slug = process.argv[2];
if (!slug) {
  console.error('usage: node src/rebundle-one.mjs <slug>');
  process.exit(1);
}

const artists = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'artists.json'), 'utf8'));
const idx = artists.findIndex((a) => a.slug === slug);
if (idx < 0) {
  console.error(`artist not found: ${slug}`);
  process.exit(1);
}
const artist = artists[idx];
const row = await bundleArtist(artist, null, artist.previews || []);
console.log(
  `re-bundled ${row.name}: ${row.tracks.length} tracks (found ${row.found}, ${row.failed.length} failed)`
);
if (row.failed.length) console.log('  failed:', row.failed.join(', '));
artists[idx] = { ...artist, previews: row.tracks, artwork: row.artwork || artist.artwork };
fs.writeFileSync(path.join(OUT_DIR, 'artists.json'), JSON.stringify(artists), 'utf8');

const manifest = [];
for (const a of artists) for (const p of a.previews) if (p.local) manifest.push(p.local);
manifest.sort();
fs.writeFileSync(path.join(OUT_DIR, 'previews-manifest.json'), JSON.stringify(manifest), 'utf8');
console.log(`manifest updated (${manifest.length} clips)`);
