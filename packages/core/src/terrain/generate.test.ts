import { describe, expect, it } from "vitest";
import {
  featureName,
  generateMap,
  heightAt,
  MAP_HEIGHT,
  MAP_WIDTH,
  worldSize,
} from "./generate.js";
import { FEATURE_EMPTY, TNT_VERSION } from "./types.js";

/** Guards the terrain pipeline after the move into @scorched-3d/core. */
describe("generateMap", () => {
  it("builds the 320x256 attribute grid for every preset", () => {
    for (const preset of ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"] as const) {
      const map = generateMap(preset, 0xa11ce);
      expect(map.width).toBe(MAP_WIDTH);
      expect(map.height).toBe(MAP_HEIGHT);
      expect(map.version).toBe(TNT_VERSION);
      expect(map.heights).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
      expect(map.features).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
      expect(map.tileMap).toHaveLength((MAP_WIDTH / 2) * (MAP_HEIGHT / 2));
      expect(map.tiles.length).toBeGreaterThan(0);
      expect(map.minimap.width).toBe(252);
      expect(map.minimap.height).toBe(252);
      expect(map.minimap.pixels).toHaveLength(252 * 252);
    }
  });

  it("spans double the classic world extent", () => {
    const map = generateMap("greenreach", 0xa11ce);
    // 2x the classic 160x128 grid: (320-1)*16 by (256-1)*16 world units.
    expect(worldSize(map)).toEqual({ worldW: 5104, worldD: 4080 });
  });

  it("is deterministic for the same preset and seed", () => {
    const a = generateMap("greenreach", 1234);
    const b = generateMap("greenreach", 1234);
    expect(a.heights).toEqual(b.heights);
    expect(a.features).toEqual(b.features);
    expect(a.tileMap).toEqual(b.tileMap);
    expect(a.hqs).toEqual(b.hqs);
  });

  it("varies with the seed", () => {
    const a = generateMap("greenreach", 1);
    const b = generateMap("greenreach", 2);
    expect(a.heights).not.toEqual(b.heights);
  });

  it("keeps heights in the 0-255 byte range", () => {
    const map = generateMap("caldera", 7);
    for (const h of map.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(255);
    }
  });

  it("resolves world helpers consistently", () => {
    const map = generateMap("greenreach", 0xa11ce);
    expect(worldSize(map)).toEqual({
      worldW: (map.width - 1) * 16,
      worldD: (map.height - 1) * 16,
    });
    expect(heightAt(map, 10, 20)).toBe(map.heights[20 * map.width + 10]);
    // Out-of-range lookups clamp instead of throwing.
    expect(heightAt(map, -5, -5)).toBe(map.heights[0]);
    // Empty cells have no feature name.
    const emptyIdx = map.features.indexOf(FEATURE_EMPTY);
    if (emptyIdx >= 0) {
      const x = emptyIdx % map.width;
      const z = Math.floor(emptyIdx / map.width);
      expect(featureName(map, x, z)).toBeNull();
    }
  });
});
