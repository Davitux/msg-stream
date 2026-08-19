/**
 * Regenerates the raster app icons from app/icon.svg.
 *
 *     node scripts/generate-icons.mjs
 *
 * Run it by hand after editing the SVG, then commit the results — it is not
 * wired into the build, because the icons change roughly never and adding a
 * rasterizer to CI would cost more than it saves. tests/favicon.test.ts checks
 * that the outputs still match the SVG, so a forgotten run fails the suite
 * rather than shipping a stale icon.
 *
 * There is no image library here on purpose: the mark is four rounded
 * rectangles, which is little enough geometry to rasterize directly, and that
 * keeps the whole thing dependency-free and deterministic across machines.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* --- reading the mark ------------------------------------------------- */

/** One `<rect>` from the SVG, in user units. */
export function parseRects(svg) {
  const rects = [];
  for (const tag of svg.match(/<rect\b[^>]*\/>/g) ?? []) {
    const attr = (name) => {
      const found = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      return found ? found[1] : undefined;
    };
    rects.push({
      x: Number(attr("x") ?? 0),
      y: Number(attr("y") ?? 0),
      w: Number(attr("width")),
      h: Number(attr("height")),
      r: Number(attr("rx") ?? 0),
      fill: attr("fill"),
    });
  }
  return rects;
}

/** The `viewBox` side length. The mark is square; anything else is a mistake. */
export function parseViewBox(svg) {
  const found = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!found) throw new Error("icon.svg has no square viewBox starting at 0 0");
  const [, w, h] = found;
  if (w !== h) throw new Error(`icon.svg viewBox is not square: ${w}x${h}`);
  return Number(w);
}

/* --- rasterizing ------------------------------------------------------ */

/** Is this point inside a rounded rectangle? */
function inside(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) return true;

  // Only the four corner boxes can fall outside; everything else is in.
  const cx = px < x + radius ? x + radius : px > x + w - radius ? x + w - radius : px;
  const cy = py < y + radius ? y + radius : py > y + h - radius ? y + h - radius : py;
  if (cx === px && cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius;
}

const CHANNELS = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Draws the rects into an RGBA buffer at `size` px, supersampling each pixel
 * so the rounded corners and pill ends get proper antialiasing.
 */
export function rasterize(rects, viewBox, size, samples = 4) {
  const pixels = Buffer.alloc(size * size * 4); // transparent
  const scale = viewBox / size;
  const step = 1 / samples;
  const offset = step / 2;

  for (const rect of rects) {
    const [r, g, b] = CHANNELS(rect.fill);
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        let hits = 0;
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            const ux = (px + offset + sx * step) * scale;
            const uy = (py + offset + sy * step) * scale;
            if (inside(ux, uy, rect)) hits += 1;
          }
        }
        if (hits === 0) continue;

        // Source-over: shapes are opaque, so alpha is pure coverage.
        const alpha = hits / (samples * samples);
        const i = (py * size + px) * 4;
        const under = pixels[i + 3] / 255;
        const out = alpha + under * (1 - alpha);
        for (const [channel, value] of [[0, r], [1, g], [2, b]]) {
          pixels[i + channel] = Math.round(
            (value * alpha + pixels[i + channel] * under * (1 - alpha)) / out,
          );
        }
        pixels[i + 3] = Math.round(out * 255);
      }
    }
  }
  return pixels;
}

/* --- PNG -------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlacing.

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- ICO -------------------------------------------------------------- */

/**
 * Packs PNGs into an .ico. PNG-compressed entries are what every browser and
 * every Windows since Vista reads, and they are a fraction of the size of the
 * BMP encoding the format originally called for.
 */
export function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette size
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/* --- outputs ---------------------------------------------------------- */

/** The sizes packed into favicon.ico. */
export const ICO_SIZES = [16, 32, 48];
/** Apple wants exactly this, and only this. */
export const APPLE_SIZE = 180;
/**
 * The README header, at twice its display width so it stays sharp on a retina
 * screen. A raster rather than the SVG because a README gets rendered by more
 * than one thing — GitHub, npm, editors, mirrors — and not all of them agree
 * about inline SVG.
 */
export const LOGO_SIZE = 144;

/**
 * iOS masks the icon into its own squircle and composites it on an unknown
 * background, so the Apple variant is drawn full-bleed and square: rounded
 * corners here would either be clipped or show through as dark notches.
 */
export function squareGround(rects) {
  return rects.map((rect, index) => (index === 0 ? { ...rect, r: 0 } : rect));
}

/** The hairline the README variant wears, and how thick it is in user units. */
export const RING_FILL = "#2a2f3a";
export const RING_WIDTH = 0.75;

/**
 * Draws the ground twice, the lower one slightly larger, so the mark gets a
 * hairline edge.
 *
 * This exists for one specific background: GitHub's dark theme is #0d1117 and
 * our ink is #0e1013, near enough that the badge dissolves into the page and
 * leaves the bars apparently floating. The ring is the app's own border colour,
 * so it stays invisible against a light page and separates the mark against a
 * dark one. The favicon deliberately does not get this — at 16px the ring would
 * cost a pixel of the mark and buy nothing.
 */
export function ringedGround(rects, width = RING_WIDTH, fill = RING_FILL) {
  const [ground, ...bars] = rects;
  return [
    { ...ground, fill },
    {
      ...ground,
      x: ground.x + width,
      y: ground.y + width,
      w: ground.w - width * 2,
      h: ground.h - width * 2,
      r: Math.max(0, ground.r - width),
    },
    ...bars,
  ];
}

function main() {
  const svg = readFileSync(join(ROOT, "app/icon.svg"), "utf8");
  const viewBox = parseViewBox(svg);
  const rects = parseRects(svg);
  if (rects.length !== 5) throw new Error(`expected 5 rects in icon.svg, found ${rects.length}`);

  const ico = encodeIco(
    ICO_SIZES.map((size) => ({ size, png: encodePng(rasterize(rects, viewBox, size), size) })),
  );
  writeFileSync(join(ROOT, "app/favicon.ico"), ico);

  const apple = encodePng(
    rasterize(squareGround(rects), viewBox, APPLE_SIZE),
    APPLE_SIZE,
  );
  writeFileSync(join(ROOT, "app/apple-icon.png"), apple);

  const logo = encodePng(rasterize(ringedGround(rects), viewBox, LOGO_SIZE), LOGO_SIZE);
  writeFileSync(join(ROOT, "docs/logo.png"), logo);

  console.log(`app/favicon.ico    ${ICO_SIZES.join("/")}px  ${ico.length} bytes`);
  console.log(`app/apple-icon.png ${APPLE_SIZE}px      ${apple.length} bytes`);
  console.log(`docs/logo.png      ${LOGO_SIZE}px      ${logo.length} bytes`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
