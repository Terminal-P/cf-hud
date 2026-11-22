#!/usr/bin/env node
/**
 * Dependency-free source-icon generator for CF HUD.
 *
 * Draws a 1024x1024 PNG (dark rounded square + teal "rising bars" HUD glyph)
 * using nothing but Node's built-in `zlib`/`fs`, then writes it to
 * `assets/icon.png`. Regenerate with:
 *
 *   node src-tauri/scripts/gen-icon.mjs
 *
 * The generated PNG is the source for `npx tauri icon assets/icon.png`,
 * which produces every platform icon under `src-tauri/icons/`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024; // final icon size
const SS = 3; // supersampling factor (render at SIZE*SS, then box-downsample)
const W = SIZE * SS;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'icon.png');

// ---- tiny color helpers -----------------------------------------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
  lerp(c1[3], c2[3], t),
];
const rgba = (hex, a = 1) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a * 255];
};
const over = (dst, src) => {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return [0, 0, 0, 0];
  return [
    (src[0] * sa + dst[0] * da * (1 - sa)) / oa,
    (src[1] * sa + dst[1] * da * (1 - sa)) / oa,
    (src[2] * sa + dst[2] * da * (1 - sa)) / oa,
    oa * 255,
  ];
};

// signed distance to a rounded rectangle centred at (cx, cy)
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// ---- scene in normalised (0..W) coordinates --------------------------------
const BG_TOP = rgba('#0e1b2b');
const BG_BOTTOM = rgba('#070d16');
const BORDER = rgba('#2dd4bf', 0.55);
const TRACK = rgba('#2a3a4d', 0.9);
const BAR_TOP = rgba('#5eead4');
const BAR_BOTTOM = rgba('#0f9e8e');
const DOT_RED = rgba('#f87171');
const DOT_AMBER = rgba('#fbbf24');
const DOT_GREEN = rgba('#34d399');

// geometry (in 1024-space, scaled by SS below)
const P = (v) => v * SS;
const CARD = { cx: 512, cy: 512, hw: 456, hh: 456, r: 224 };
const BARS = [
  { cx: 330, hw: 48, bottom: 764, top: 574 },
  { cx: 512, hw: 48, bottom: 764, top: 464 },
  { cx: 694, hw: 48, bottom: 764, top: 344 },
];
const BAR_R = 24;
const TRACK_RECT = { cx: 512, cy: 790, hw: 252, hh: 9, r: 9 };
const DOTS = [
  { cx: 208, cy: 208, r: 17, c: DOT_RED },
  { cx: 262, cy: 208, r: 17, c: DOT_AMBER },
  { cx: 316, cy: 208, r: 17, c: DOT_GREEN },
];

function sample(x, y) {
  // x, y are in supersampled pixel space; convert to 1024-space for geometry
  const sx = x / SS;
  const sy = y / SS;
  let out = [0, 0, 0, 0];

  // card (dark rounded square, vertical gradient)
  const dCard = sdRoundRect(sx, sy, CARD.cx, CARD.cy, CARD.hw, CARD.hh, CARD.r);
  if (dCard <= 0) {
    const t = clamp01((sy - (CARD.cy - CARD.hh)) / (CARD.hh * 2));
    out = mix(BG_TOP, BG_BOTTOM, t);
    out[3] = 255;

    // soft teal glow rising from the bottom of the card
    const gx = (sx - 512) / 420;
    const gy = (sy - 690) / 330;
    const glow = clamp01(1 - Math.hypot(gx, gy));
    if (glow > 0) out = over(out, rgba('#14b8a6', 0.22 * glow * glow));
  } else if (dCard <= 5) {
    // inner hairline border
    out = [BORDER[0], BORDER[1], BORDER[2], BORDER[3] * clamp01(1 - dCard / 5)];
  }

  // three dots (HUD status lights)
  for (const d of DOTS) {
    const dist = Math.hypot(sx - d.cx, sy - d.cy);
    if (dist <= d.r) out = over(out, d.c);
  }

  // baseline track
  if (sdRoundRect(sx, sy, TRACK_RECT.cx, TRACK_RECT.cy, TRACK_RECT.hw, TRACK_RECT.hh, TRACK_RECT.r) <= 0) {
    out = over(out, TRACK);
  }

  // three rising bars (teal top -> green bottom gradient)
  for (const b of BARS) {
    const hh = (b.bottom - b.top) / 2;
    const cy = (b.bottom + b.top) / 2;
    if (sdRoundRect(sx, sy, b.cx, cy, b.hw, hh, BAR_R) <= 0) {
      const t = clamp01((sy - b.top) / (b.bottom - b.top));
      out = over(out, mix(BAR_TOP, BAR_BOTTOM, t));
      // subtle top highlight
      out = over(out, rgba('#ffffff', 0.10 * clamp01(1 - (sy - b.top) / 42)));
    }
  }

  return out;
}

// ---- render with SS x SS supersampling -------------------------------------
const img = Buffer.alloc(SIZE * SIZE * 4);
const inv = 1 / (SS * SS);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const c = sample(x * SS + i + 0.5, y * SS + j + 0.5);
        r += c[0] * c[3];
        g += c[1] * c[3];
        b += c[2] * c[3];
        a += c[3];
      }
    }
    const o = (y * SIZE + x) * 4;
    if (a > 0) {
      img[o] = Math.round(r / a);
      img[o + 1] = Math.round(g / a);
      img[o + 2] = Math.round(b / a);
    }
    img[o + 3] = Math.round(a * inv);
  }
}

// ---- minimal PNG encoder (RGBA8, filter 0, zlib) ---------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  img.copy(raw, row + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`);
