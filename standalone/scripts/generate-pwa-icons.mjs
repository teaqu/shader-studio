// Regenerates the raster install icons in public/icons from the SVG app icon.
// Run after changing public/shader-studio-icon.svg:
//   npm run icons -w @shader-studio/standalone
// Chromium rasterises the SVG; Node encodes the PNGs so opaque icons are
// written as RGB. iOS and maskable launchers need an opaque tile, and an RGBA
// file would leave that property to whatever the rasteriser chose.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BACKGROUND = '#1e1e1e';

// `scale` is the drawn SVG's edge as a fraction of the tile. Maskable icons
// must keep the artwork inside the central circle of radius 40%: the
// triangle's far corners sit 0.597 of the SVG's edge from its centre, so
// 0.64 keeps them at 0.38 of the tile.
const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1, background: null },
  { file: 'icon-512.png', size: 512, scale: 1, background: null },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.64, background: BACKGROUND },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.8, background: BACKGROUND },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit PNG, dropping alpha when `opaque`. */
function encodePng(rgba, size, opaque) {
  const channels = opaque ? 3 : 4;
  const rows = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1);
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < channels; c++) {
        rows[row + 1 + x * channels + c] = rgba[(y * size + x) * 4 + c];
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = await readFile(join(publicDir, 'shader-studio-icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  await mkdir(join(publicDir, 'icons'), { recursive: true });
  for (const icon of ICONS) {
    const pixels = await page.evaluate(async ({ svg, size, scale, background }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d');
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, size, size);
      }
      const drawn = size * scale;
      const offset = (size - drawn) / 2;
      context.drawImage(image, offset, offset, drawn, drawn);
      return Array.from(context.getImageData(0, 0, size, size).data);
    }, { svg, ...icon });
    await writeFile(join(publicDir, 'icons', icon.file), encodePng(pixels, icon.size, icon.background !== null));
    console.log(`Wrote public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
