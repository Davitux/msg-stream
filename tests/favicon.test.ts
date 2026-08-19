import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLE_SIZE,
  ICO_SIZES,
  LOGO_SIZE,
  RING_FILL,
  RING_WIDTH,
  encodeIco,
  encodePng,
  parseRects,
  parseViewBox,
  rasterize,
  ringedGround,
  squareGround,
} from "@/scripts/generate-icons.mjs";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path));
const SVG = read("app/icon.svg").toString("utf8");
const CSS = read("app/globals.css").toString("utf8");

/** The first definition of a custom property, which is the dark palette. */
function token(name: string): string {
  const found = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!found) throw new Error(`globals.css has no --${name}`);
  return found[1];
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, "image/svg+xml");

describe("icon.svg is well-formed", () => {
  it("parses as XML", () => {
    // The mark shipped broken once because a comment mentioned the CSS custom
    // properties by name: XML forbids a double hyphen inside a comment, so the
    // whole file failed to parse and every browser drew a broken image.
    expect(parse(SVG).querySelector("parsererror")).toBeNull();
  });

  it("and this check has teeth", () => {
    // Proof the assertion above can actually fail, since a parser that quietly
    // accepted anything would make it worthless.
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><!-- --oops --></svg>`;
    expect(parse(broken).querySelector("parsererror")).not.toBeNull();
  });

  it("contains no double hyphen inside a comment", () => {
    for (const comment of SVG.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(comment.slice(4, -3)).not.toContain("--");
    }
  });

  it("is a square viewBox drawn from five rectangles", () => {
    expect(parseViewBox(SVG)).toBe(32);
    expect(parseRects(SVG)).toHaveLength(5);
  });
});

describe("the mark stays tied to the palette", () => {
  const [ground, ...bars] = parseRects(SVG);

  it("grounds the icon in the app's ink", () => {
    expect(ground.fill).toBe(token("ink"));
    expect({ x: ground.x, y: ground.y, w: ground.w, h: ground.h }).toEqual({
      x: 0,
      y: 0,
      w: 32,
      h: 32,
    });
  });

  it("uses each platform's own colour, straight from globals.css", () => {
    expect(bars.map((bar) => bar.fill)).toEqual([
      token("youtube"),
      token("twitch"),
      token("kick"),
      token("cash"),
    ]);
  });

  it("invents no colour of its own", () => {
    const allowed = new Set(["ink", "youtube", "twitch", "kick", "cash"].map(token));
    for (const fill of SVG.match(/fill="([^"]*)"/g) ?? []) {
      expect(allowed).toContain(fill.slice(6, -1));
    }
  });

  it("puts the merged feed in the money colour and makes it the long one", () => {
    // The whole idea of the mark: three short feeds in, one long one out. If
    // the amber bar ever stops being the widest, the mark stops meaning that.
    const merged = bars[bars.length - 1];
    expect(merged.fill).toBe(token("cash"));
    for (const feed of bars.slice(0, -1)) {
      expect(merged.w).toBeGreaterThan(feed.w);
      expect(feed.w).toBe(bars[0].w);
    }
  });

  it("keeps every bar inside the ground with even margins", () => {
    const left = Math.min(...bars.map((b) => b.x));
    const right = Math.max(...bars.map((b) => b.x + b.w));
    expect(left).toBe(ground.w - right);
    expect(Math.min(...bars.map((b) => b.y))).toBe(
      ground.h - Math.max(...bars.map((b) => b.y + b.h)),
    );
  });

  it("never lets two bars touch", () => {
    const sorted = [...bars].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].y).toBeGreaterThan(sorted[i - 1].y + sorted[i - 1].h);
    }
  });
});

describe("rasterizing", () => {
  const rects = parseRects(SVG);
  const viewBox = parseViewBox(SVG);

  it("fills the middle of a bar and leaves the gaps alone", () => {
    const pixels = rasterize(rects, viewBox, 32);
    const at = (x: number, y: number) => {
      const i = (y * 32 + x) * 4;
      return `#${[0, 1, 2].map((c) => pixels[i + c].toString(16).padStart(2, "0")).join("")}`;
    };
    // Centre of the first bar, and the gap just below it.
    expect(at(10, 7)).toBe(token("youtube"));
    expect(at(10, 10)).toBe(token("ink"));
  });

  it("antialiases rather than stair-stepping", () => {
    // A rounded corner that came out fully opaque or fully clear everywhere
    // would mean the supersampling silently stopped working.
    const pixels = rasterize(rects, viewBox, 48);
    const alphas = new Set<number>();
    for (let i = 3; i < pixels.length; i += 4) alphas.add(pixels[i]);
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true);
  });

  it("leaves the corners of the rounded ground transparent", () => {
    const pixels = rasterize(rects, viewBox, 32);
    expect(pixels[3]).toBe(0);
  });

  it("but fills them for Apple, which masks the icon itself", () => {
    const pixels = rasterize(squareGround(rects), viewBox, APPLE_SIZE);
    expect(pixels[3]).toBe(255);
  });
});

describe("the committed icons match the SVG", () => {
  const rects = parseRects(SVG);
  const viewBox = parseViewBox(SVG);

  it("favicon.ico is what the generator produces today", () => {
    const expected = encodeIco(
      ICO_SIZES.map((size) => ({
        size,
        png: encodePng(rasterize(rects, viewBox, size), size),
      })),
    );
    // Fails when someone edits icon.svg without re-running
    // `node scripts/generate-icons.mjs`.
    expect(read("app/favicon.ico").equals(expected)).toBe(true);
  });

  it("apple-icon.png is too", () => {
    const expected = encodePng(rasterize(squareGround(rects), viewBox, APPLE_SIZE), APPLE_SIZE);
    expect(read("app/apple-icon.png").equals(expected)).toBe(true);
  });

  it("docs/logo.png is too", () => {
    const expected = encodePng(rasterize(ringedGround(rects), viewBox, LOGO_SIZE), LOGO_SIZE);
    expect(read("docs/logo.png").equals(expected)).toBe(true);
  });

  it("and the create-next-app default is gone", () => {
    // The scaffold ships a 25KB Vercel triangle; ours is a fraction of that.
    expect(read("app/favicon.ico").length).toBeLessThan(4096);
  });
});

describe("favicon.ico is a valid icon file", () => {
  const ico = read("app/favicon.ico");

  it("declares the sizes it carries", () => {
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // 1 = icon, not cursor
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);

    const declared = ICO_SIZES.map((_, i) => ico[6 + i * 16]);
    expect(declared).toEqual(ICO_SIZES);
  });

  it("stores each size as a PNG whose header agrees with the directory", () => {
    ICO_SIZES.forEach((size, i) => {
      const entry = 6 + i * 16;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);

      expect(ico.subarray(offset, offset + 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(ico.readUInt32BE(offset + 16)).toBe(size);
      expect(ico.readUInt32BE(offset + 20)).toBe(size);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
    });
  });
});

describe("the README header", () => {
  const readme = read("README.md").toString("utf8");

  it("shows the logo, at half the size it was drawn", () => {
    // Drawn at 2x so it stays sharp on a retina screen; displaying it at its
    // full width would make it twice as big as intended.
    const tag = readme.match(/<img src="docs\/logo\.png"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag![0]).toContain(`width="${LOGO_SIZE / 2}"`);
  });

  it("leaves it out of the accessibility tree, since the title says the name", () => {
    expect(readme.match(/<img src="docs\/logo\.png"[^>]*>/)![0]).toContain('alt=""');
  });

  it("points at a file that exists", () => {
    expect(read("docs/logo.png").length).toBeGreaterThan(0);
  });
});

describe("apple-icon.png", () => {
  const png = read("app/apple-icon.png");

  it("is a 180px RGBA PNG, the one size iOS asks for", () => {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(APPLE_SIZE);
    expect(png.readUInt32BE(20)).toBe(APPLE_SIZE);
    expect(png[25]).toBe(6); // colour type 6 = RGBA
  });

  it("is the square variant, not the rounded one", () => {
    // The three rasters differ only in their ground, so a mix-up between them
    // would be easy to ship and hard to spot.
    const rects = parseRects(SVG);
    const viewBox = parseViewBox(SVG);
    expect(rasterize(rects, viewBox, APPLE_SIZE)[3]).toBe(0); // rounded: clear corner
    expect(rasterize(squareGround(rects), viewBox, APPLE_SIZE)[3]).toBe(255);
  });
});

describe("the hairline on the README logo", () => {
  const rects = parseRects(SVG);
  const viewBox = parseViewBox(SVG);

  it("adds a ring behind the ground without touching the bars", () => {
    const ringed = ringedGround(rects);
    expect(ringed).toHaveLength(rects.length + 1);
    expect(ringed[0].fill).toBe(RING_FILL);
    expect(ringed.slice(2)).toEqual(rects.slice(1));
  });

  it("insets the ground so the ring shows only at the edge", () => {
    const [ring, ground] = ringedGround(rects);
    expect(ground.x).toBe(ring.x + RING_WIDTH);
    expect(ground.w).toBe(ring.w - RING_WIDTH * 2);
    expect(ground.r).toBe(ring.r - RING_WIDTH);
  });

  it("shows the app's border colour just inside the corner", () => {
    // GitHub's dark theme is #0d1117 and our ink is #0e1013, close enough that
    // an unringed badge dissolves into the page. Sample a point on the left
    // edge, vertically centred, where the ring is the only thing drawn.
    const pixels = rasterize(ringedGround(rects), viewBox, LOGO_SIZE);
    const scale = LOGO_SIZE / viewBox;
    const i = (Math.round(LOGO_SIZE / 2) * LOGO_SIZE + Math.round(RING_WIDTH * scale * 0.5)) * 4;
    const hex = `#${[0, 1, 2].map((c) => pixels[i + c].toString(16).padStart(2, "0")).join("")}`;
    expect(hex).toBe(RING_FILL);
  });

  it("stays off the favicon, where it would cost a pixel of the mark", () => {
    const expected = encodeIco(
      ICO_SIZES.map((size) => ({
        size,
        png: encodePng(rasterize(rects, viewBox, size), size),
      })),
    );
    expect(read("app/favicon.ico").equals(expected)).toBe(true);
  });
});
