/**
 * Generates the raster icons from one description of the mark.
 *
 * Written as a tiny PNG encoder rather than a browser screenshot because
 * Next.js decodes these at build time and rejects anything that is not RGBA —
 * and a headless screenshot drops the alpha channel whenever the image happens
 * to be fully opaque, which this one is.
 *
 *   npx tsx test/gen-icons.ts
 */
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";

// The mark, described once in a 32-unit square. src/app/icon.svg draws the
// same thing; keep them in step.
const BG = "#05090F";
const BLOCKS = [
  { x: 2, y: 2, face: "#19F28A", light: "#7DFFC4", dark: "#0B9B57" },
  { x: 17, y: 2, face: "#43A5FF", light: "#9CCEFF", dark: "#1D66B4" },
  { x: 2, y: 17, face: "#FFD84A", light: "#FFECA0", dark: "#A8871A" },
  { x: 17, y: 17, face: "#FF5C5C", light: "#FF9E9E", dark: "#A82C2C" },
];
const BLOCK = 13;
const BEVEL = 3;
const UNITS = 32;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Paints the mark into an RGBA buffer at the requested pixel size. */
function paint(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const s = size / UNITS;

  const fill = (ux: number, uy: number, uw: number, uh: number, color: RGB) => {
    const x0 = Math.round(ux * s);
    const y0 = Math.round(uy * s);
    const x1 = Math.round((ux + uw) * s);
    const y1 = Math.round((uy + uh) * s);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = (y * size + x) * 4;
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
        px[i + 3] = 255;
      }
    }
  };

  fill(0, 0, UNITS, UNITS, hex(BG));

  for (const b of BLOCKS) {
    const face = hex(b.face);
    const light = hex(b.light);
    const dark = hex(b.dark);
    fill(b.x, b.y, BLOCK, BLOCK, face);
    // Lit faces first, shaded faces last so the corners resolve dark — the
    // same order the board's block sprites use.
    fill(b.x, b.y, BLOCK, BEVEL, light);
    fill(b.x, b.y, BEVEL, BLOCK, light);
    fill(b.x, b.y + BLOCK - BEVEL, BLOCK, BEVEL, dark);
    fill(b.x + BLOCK - BEVEL, b.y, BEVEL, BLOCK, dark);
  }

  return px;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/** Minimal PNG encoder: 8-bit RGBA, no interlacing, filter type 0. */
function encodePng(rgba: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type 6 = RGBA
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // adaptive filtering
  ihdr.writeUInt8(0, 12); // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Wraps a PNG in an ICO container — the format allows PNG payloads at these sizes. */
function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset past header + entry

  return Buffer.concat([header, entry, png]);
}

const apple = encodePng(paint(180), 180);
writeFileSync("src/app/apple-icon.png", apple);
console.log(`apple-icon.png   180x180  ${apple.length} bytes  RGBA`);

const small = encodePng(paint(32), 32);
writeFileSync("src/app/favicon.ico", pngToIco(small, 32));
console.log(`favicon.ico       32x32   ${small.length + 22} bytes  RGBA`);
