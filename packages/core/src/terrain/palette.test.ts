import { describe, expect, it } from "vitest";
import { buildPalette, palRGB, TILE_RAMPS } from "./palette.js";
import type { TileKind } from "./types.js";

describe("buildPalette", () => {
  it("builds a 256-entry RGB table", () => {
    const pal = buildPalette();
    expect(pal).toHaveLength(256 * 3);
  });

  it("pins index 0 to black and index 255 to white", () => {
    const pal = buildPalette();
    expect(palRGB(pal, 0)).toEqual([0, 0, 0]);
    expect(palRGB(pal, 255)).toEqual([255, 255, 255]);
  });

  it("is deterministic across builds", () => {
    expect(buildPalette()).toEqual(buildPalette());
  });

  it("ramps from the documented dark to light endpoints", () => {
    const pal = buildPalette();
    // deep greens run 1..16 from [8,16,8] toward [36,64,24] (index 16 is
    // then overwritten by the grass ramp start).
    expect(palRGB(pal, 1)).toEqual([8, 16, 8]);
    expect(palRGB(pal, 16)).toEqual([28, 52, 16]);
    // sand run 96..111 from [140,116,64] to [228,208,148]
    expect(palRGB(pal, 96)).toEqual([140, 116, 64]);
    expect(palRGB(pal, 111)).toEqual([228, 208, 148]);
  });

  it("ramps monotonically between endpoints", () => {
    const pal = buildPalette();
    // green channel of the grass ramp should rise from index 16 to 47.
    let prev = -1;
    for (let i = 16; i < 48; i++) {
      const g = pal[i * 3 + 1] ?? 0;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(palRGB(pal, 16)).toEqual([28, 52, 16]);
    expect(palRGB(pal, 47)).toEqual([92, 132, 40]);
  });
});

describe("TILE_RAMPS", () => {
  const kinds: TileKind[] = [
    "deep",
    "shallow",
    "wetSand",
    "sand",
    "dirt",
    "grass",
    "lush",
    "darkGrass",
    "rock",
    "cliff",
    "metal",
  ];

  it("covers every tile kind", () => {
    expect(Object.keys(TILE_RAMPS).sort()).toEqual([...kinds].sort());
  });

  it("stays inside the 0..254 palette range with valid specks", () => {
    for (const kind of kinds) {
      const ramp = TILE_RAMPS[kind];
      expect(ramp.start).toBeGreaterThanOrEqual(0);
      expect(ramp.count).toBeGreaterThan(0);
      expect(ramp.start + ramp.count).toBeLessThanOrEqual(255);
      expect(ramp.specks.length).toBeGreaterThan(0);
      for (const speck of ramp.specks) {
        expect(speck).toBeGreaterThanOrEqual(0);
        expect(speck).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("palRGB", () => {
  it("reads the RGB triple at a palette index", () => {
    const pal = buildPalette();
    const i = 100;
    expect(palRGB(pal, i)).toEqual([pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]]);
  });
});
