// Downloads latin-subset woff2 files from Google Fonts for offline use.
// Generates app/public/fonts/fonts.css + the woff2 binaries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/fonts');
fs.mkdirSync(OUT_DIR, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600;700&display=swap';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

const blocks = css.split('@font-face').slice(1);
const faces = [];
for (const block of blocks) {
  const inLatin = block.includes('/* latin */');
  const fam = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
  const style = block.match(/font-style:\s*(\w+)/)?.[1] || 'normal';
  const url = block.match(/url\((\S+?)\)\s*format\('woff2'\)/)?.[1];
  const subset = block.match(/\/\*\s*([\w-]+)\s*\*\//)?.[1];
  if (!inLatin || !fam || !url) continue;
  faces.push({ fam, weight, style, url, subset });
}

const unique = [];
const seen = new Set();
for (const f of faces) {
  const key = `${f.fam}|${f.weight}|${f.style}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(f);
}

const fontCss = [];
for (const f of unique) {
  const file = `${f.fam.replace(/\s+/g, '')}-${f.style !== 'normal' ? 'italic' : ''}${f.weight}.woff2`;
  const dest = path.join(OUT_DIR, file);
  const buf = Buffer.from(await (await fetch(f.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  fs.writeFileSync(dest, buf);
  fontCss.push(
    `@font-face{font-family:'${f.fam}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url('./${file}') format('woff2');}`
  );
  console.log(`  ${file} (${buf.length} bytes)`);
}

fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), fontCss.join('\n'), 'utf8');
console.log(`\nWrote ${fontCss.length} @font-face rules to public/fonts/fonts.css`);
