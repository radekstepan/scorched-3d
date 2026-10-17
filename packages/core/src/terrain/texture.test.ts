import { describe, expect, it } from "vitest";
import { buildPalette, palRGB } from "./palette.js";
import { composeAlbedo, composeAlbedoWindow, composeHeight, composeMinimap } from "./texture.js";
import { TILE_PIXELS, type TNTMap } from "./types.js";

// texture.ts targets the DOM ImageData API, which the node test environment
// lacks — install a minimal capture stub so the compose() pixel logic stays
// testable without a browser canvas.
class StubImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

if (typeof globalThis.ImageData === "undefined") {
  (globalThis as Record<string, unknown>).ImageData = StubImageData;
}

function makeMap(): TNTMap {
  const palette = buildPalette();
  // 2x2 attribute grid -> a single 32x32 tile.
  const tile = new Uint8Array(TILE_PIXELS * TILE_PIXELS);
  tile.fill(16);
  tile[0] = 96; // top-left pixel uses a different palette index
  return {
    name: "Test",
    world: "Test",
    preset: "greenreach",
    seed: 1,
    version: 0x2000,
    width: 2,
    height: 2,
    seaLevel: 75,
    heights: new Uint8Array([80, 81, 82, 83]),
    features: new Uint16Array(4),
    tileMap: new Uint16Array([0]),
    tiles: [tile],
    tileKinds: ["grass"],
    featureTable: [],
    palette,
    units: [],
    hqs: [],
    minimap: { width: 4, height: 2, pixels: new Uint8Array([16, 96, 160, 180, 16, 16, 16, 16]) },
  };
}

describe("composeAlbedo", () => {
  it("emits a TILE_PIXELS image with opaque pixels from the palette", () => {
    const map = makeMap();
    const img = composeAlbedo(map) as unknown as StubImageData;
    expect(img.width).toBe(TILE_PIXELS);
    expect(img.height).toBe(TILE_PIXELS);
    expect(img.data).toHaveLength(TILE_PIXELS * TILE_PIXELS * 4);
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });

  it("maps tile indices through the palette", () => {
    const map = makeMap();
    const img = composeAlbedo(map) as unknown as StubImageData;
    const [r, g, b] = palRGB(map.palette, 96);
    expect(img.data[0]).toBe(r);
    expect(img.data[1]).toBe(g);
    expect(img.data[2]).toBe(b);
    // second pixel uses palette index 16.
    const [r2, g2, b2] = palRGB(map.palette, 16);
    expect(img.data[4]).toBe(r2);
    expect(img.data[5]).toBe(g2);
    expect(img.data[6]).toBe(b2);
  });
});

describe("composeAlbedoWindow", () => {
  // 4x4 attribute grid -> 2x2 tiles with distinct top-left pixels per tile.
  function makeWindowMap(): TNTMap {
    const base = makeMap();
    const tiles = [0, 1, 2, 3].map((t) => {
      const tile = new Uint8Array(TILE_PIXELS * TILE_PIXELS);
      tile.fill(16 + t);
      tile[0] = 96 + t;
      return tile;
    });
    return {
      ...base,
      width: 4,
      height: 4,
      tileMap: new Uint16Array([0, 1, 2, 3]),
      tiles,
      tileKinds: ["grass", "grass", "grass", "grass"],
    };
  }

  it("matches the full compose at the same tile coordinates", () => {
    const map = makeWindowMap();
    const full = composeAlbedo(map) as unknown as StubImageData;
    const win = composeAlbedoWindow(map, 1, 0, 1, 2) as unknown as StubImageData;
    expect(win.width).toBe(TILE_PIXELS);
    expect(win.height).toBe(2 * TILE_PIXELS);
    // Right column of the full image, both rows.
    for (const [wx, wy, fx, fy] of [[0, 0, TILE_PIXELS, 0], [0, TILE_PIXELS, TILE_PIXELS, TILE_PIXELS]] as const) {
      const wOff = (wy * win.width + wx) * 4;
      const fOff = (fy * full.width + fx) * 4;
      expect(Array.from(win.data.slice(wOff, wOff + 4))).toEqual(Array.from(full.data.slice(fOff, fOff + 4)));
    }
    // Top-left pixel of tile 1 resolves through the palette.
    const [r, g, b] = palRGB(map.palette, 97);
    expect(win.data[0]).toBe(r);
    expect(win.data[1]).toBe(g);
    expect(win.data[2]).toBe(b);
    expect(win.data[3]).toBe(255);
  });

  it("clamps the origin into the map and the size to fit", () => {
    const map = makeWindowMap();
    const clamped = composeAlbedoWindow(map, -5, 99, 4, 4) as unknown as StubImageData;
    // Origin clamps to (0, 1); width fits 2 tiles, height only the last row.
    expect(clamped.width).toBe(2 * TILE_PIXELS);
    expect(clamped.height).toBe(TILE_PIXELS);
    const full = composeAlbedo(map) as unknown as StubImageData;
    // First pixel equals tile 2's top-left (bottom-left of the full image).
    const fOff = TILE_PIXELS * full.width * 4;
    expect(Array.from(clamped.data.slice(0, 4))).toEqual(Array.from(full.data.slice(fOff, fOff + 4)));
    // Degenerate sizes still emit at least one tile.
    const tiny = composeAlbedoWindow(map, 0, 0, 0, -3) as unknown as StubImageData;
    expect(tiny.width).toBe(TILE_PIXELS);
    expect(tiny.height).toBe(TILE_PIXELS);
  });
});

describe("composeHeight", () => {
  it("emits a grayscale height image matching the grid", () => {
    const map = makeMap();
    const img = composeHeight(map) as unknown as StubImageData;
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    for (let i = 0; i < 4; i++) {
      const h = map.heights[i] ?? 0;
      expect(img.data[i * 4]).toBe(h);
      expect(img.data[i * 4 + 1]).toBe(h);
      expect(img.data[i * 4 + 2]).toBe(h);
      expect(img.data[i * 4 + 3]).toBe(255);
    }
  });
});

describe("composeMinimap", () => {
  it("emits a minimap image mapped through the palette", () => {
    const map = makeMap();
    const img = composeMinimap(map) as unknown as StubImageData;
    expect(img.width).toBe(4);
    expect(img.height).toBe(2);
    expect(img.data).toHaveLength(4 * 2 * 4);
    const [r, g, b] = palRGB(map.palette, 160);
    expect(img.data[8]).toBe(r);
    expect(img.data[9]).toBe(g);
    expect(img.data[10]).toBe(b);
    expect(img.data[11]).toBe(255);
  });
});
