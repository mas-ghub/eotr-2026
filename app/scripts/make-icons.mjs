// Generates the PWA icon set (pure Node, no dependencies).
// Draws a small festival scene: sunset gradient, sun disc, rolling hills.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- minimal PNG encoder ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing ----------
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function drawIcon(size, radiusFrac = 0.22, rounded = true) {
  const px = Buffer.alloc(size * size * 4);
  const top = hex('#2f6b4f');
  const bottom = hex('#0e241c');
  const sun = hex('#f2c14e');
  const sunGlow = hex('#e8602f');
  const hillA = hex('#20483a');
  const hillB = hex('#1a3a2e');
  const radius = Math.round(size * radiusFrac);

  const inRound = (x, y) => {
    if (!rounded) return true;
    const cx = Math.min(Math.max(x, radius), size - 1 - radius);
    const cy = Math.min(Math.max(y, radius), size - 1 - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = y / (size - 1);
      const [r, g, b] = mix(top, bottom, t);
      // sun glow (radial, upper area)
      const sunX = size * 0.5;
      const sunY = size * 0.36;
      const dist = Math.hypot(x - sunX, y - sunY) / size;
      const glow = clamp01(1 - dist * 2.4);
      // warm glow overlay
      const gCol = mix([r, g, b], sunGlow, glow * 0.35);
      // sun disc
      const isSun = Math.hypot(x - sunX, y - sunY) < size * 0.145;
      // hills
      let col = gCol;
      const h1 = size * 0.78;
      const h2 = size * 0.92;
      if (y > h1) {
        const off1 = Math.sin((x / size) * Math.PI) * size * 0.16;
        if (y > h1 + off1) col = hillA;
        else col = mix(gCol, hillA, clamp01((y - h1) / (size * 0.1)));
      }
      if (y > h2) {
        const off2 = Math.sin((x / size) * Math.PI * 0.8 + 0.6) * size * 0.1;
        col = y > h2 + off2 ? hillB : mix(col, hillB, clamp01((y - h2) / (size * 0.08)));
      }
      let out = isSun ? sun : col;
      // simple radial shading on the sun
      if (isSun) {
        const edge = Math.hypot(x - sunX, y - sunY) / (size * 0.145);
        out = mix(sun, hex('#e09a2e'), edge * 0.5);
      }
      const i = (y * size + x) * 4;
      px[i] = out[0];
      px[i + 1] = out[1];
      px[i + 2] = out[2];
      px[i + 3] = inRound(x, y) ? 255 : 0;
    }
  }
  return px;
}

const sizes = [
  { size: 512, file: 'icon-512.png', rounded: true, radius: 0.2 },
  { size: 192, file: 'icon-192.png', rounded: true, radius: 0.2 },
  { size: 180, file: 'apple-touch-icon.png', rounded: false },
  { size: 32, file: 'favicon.png', rounded: true, radius: 0.18 }
];

for (const { size, file, rounded, radius } of sizes) {
  const rgba = drawIcon(size, radius, rounded);
  const png = encodePng(size, size, rgba);
  fs.writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`  wrote icons/${file} (${png.length} bytes)`);
}
