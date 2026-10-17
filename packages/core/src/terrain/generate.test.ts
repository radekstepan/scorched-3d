import { describe, expect, it } from "vitest";
import {
  featureName,
  generateMap,
  heightAt,
  MAP_HEIGHT,
  MAP_WIDTH,
  sampleHeightField,
  worldSize,
} from "./generate.js";
import { hqPadCells, hqRoadCells } from "../units/hq.js";
import { FEATURE_EMPTY, TNT_VERSION, type MapPreset, type TNTMap } from "./types.js";

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

/** Scattered boulder fields: rocks must actually appear, on legal ground. */
describe("scattered rocks", () => {
  const PRESETS: MapPreset[] = ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"];

  function rockCells(map: TNTMap): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const word = map.features[z * map.width + x] ?? FEATURE_EMPTY;
        if (word === 3 || word === 4) out.push({ x, z });
      }
    }
    return out;
  }

  function slopeOf(heights: Uint8Array, width: number, height: number, x: number, z: number): number {
    const at = (ax: number, az: number): number =>
      heights[Math.min(height - 1, az) * width + Math.min(width - 1, ax)] ?? 0;
    const corners = [at(x, z), at(x + 1, z), at(x, z + 1), at(x + 1, z + 1)];
    return Math.max(...corners) - Math.min(...corners);
  }

  it("places a modest field of rocks on every preset", () => {
    for (const preset of PRESETS) {
      const rocks = rockCells(generateMap(preset, 7));
      // Nonzero everywhere (slope scree alone left five presets barren),
      // and an order of magnitude below the ~15k-tree canopy.
      expect(rocks.length).toBeGreaterThan(0);
      expect(rocks.length).toBeLessThan(4000);
    }
  });

  it("keeps rocks on dry, gentle-or-scree ground", () => {
    for (const preset of PRESETS) {
      const map = generateMap(preset, 7);
      // Slope is measured on the pre-construction field the stamper saw:
      // HQ pad/road grading reshapes lane neighbours afterwards, so a
      // legally stamped rock beside a lane can read a finished slope in
      // the 9–16 gap. (Rock cells' own heights never change, so the dry
      // check below stays on the finished map.)
      const raw = sampleHeightField(preset, 7);
      for (const { x, z } of rockCells(map)) {
        const h = map.heights[z * map.width + x] ?? 0;
        expect(h).toBeGreaterThan(map.seaLevel + 4);
        // Scatter stones sit on gentle ground (slope < 9); steep-slope
        // scree keeps the old words on grades above 16.
        const slope = slopeOf(raw.heights, raw.width, raw.height, x, z);
        expect(slope < 9 || slope > 16).toBe(true);
      }
    }
  });

  it("keeps HQ pads and exit roads clear of rocks", () => {
    for (const preset of PRESETS) {
      const map = generateMap(preset, 7);
      for (const site of map.hqs) {
        for (const cell of [...hqPadCells(site, map.width, map.height), ...hqRoadCells(site, map.width, map.height)]) {
          const word = map.features[cell.cellZ * map.width + cell.cellX] ?? FEATURE_EMPTY;
          expect(word).not.toBe(3);
          expect(word).not.toBe(4);
        }
      }
    }
  });

  it("scatters deterministically per seed and varies across seeds", () => {
    const a = rockCells(generateMap("greenreach", 11));
    const b = rockCells(generateMap("greenreach", 11));
    expect(a).toEqual(b);
    const c = rockCells(generateMap("greenreach", 12));
    expect(c).not.toEqual(a);
  });
});
