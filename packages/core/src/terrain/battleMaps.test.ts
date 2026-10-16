import { describe, expect, it } from "vitest";
import { generateMap } from "./generate.js";
import { findCellPath, isWalkable } from "../units/pathfinding.js";
import { startingUnitCount } from "../units/place.js";
import { FEATURE_EMPTY } from "./types.js";

/** Battle-map guards: rivers must be fordable, plains must stay open. */
describe("battle maps", () => {
  it("carves a real river through rivercross with dry land on both banks", () => {
    const map = generateMap("rivercross", 0xa11ce);
    let interiorWater = 0;
    let interior = 0;
    let westDry = 0;
    let eastDry = 0;
    for (let z = 16; z < map.height - 16; z++) {
      for (let x = 16; x < map.width - 16; x++) {
        interior++;
        const h = map.heights[z * map.width + x] ?? 0;
        if (h <= map.seaLevel) interiorWater++;
        if (h > map.seaLevel + 4) {
          if (x < map.width / 2 - 20) westDry++;
          if (x > map.width / 2 + 20) eastDry++;
        }
      }
    }
    // A visible river, but both banks stay mostly open maneuver ground.
    expect(interiorWater / interior).toBeGreaterThan(0.03);
    expect(interiorWater / interior).toBeLessThan(0.3);
    expect(westDry).toBeGreaterThan(0);
    expect(eastDry).toBeGreaterThan(0);
  });

  it("fords connect the banks: armor can path west to east", () => {
    for (const seed of [1, 7, 0xa11ce]) {
      const map = generateMap("rivercross", seed);
      const west = firstWalkable(map, 10, 50, 10, map.height - 10);
      const east = firstWalkable(map, map.width - 50, map.width - 10, 10, map.height - 10);
      expect(west, `no west-bank footing on seed ${seed}`).toBeDefined();
      expect(east, `no east-bank footing on seed ${seed}`).toBeDefined();
      const path = findCellPath(map, west!, east!);
      expect(path, `banks disconnected on seed ${seed}`).not.toBeNull();
    }
  });

  it("keeps ford causeways free of standing trees", () => {
    const map = generateMap("rivercross", 0xa11ce);
    // Causeway-height cells (just above the waterline) must never hold a
    // trunk: crossings stay open maneuver ground.
    for (let z = 8; z < map.height - 8; z++) {
      for (let x = 8; x < map.width - 8; x++) {
        const h = map.heights[z * map.width + x] ?? 0;
        if (h > map.seaLevel + 4 && h < map.seaLevel + 8) {
          expect(map.features[z * map.width + x]).toBe(FEATURE_EMPTY);
        }
      }
    }
  });

  it("grows forest on the rivercross heights but keeps armor room", () => {
    const map = generateMap("rivercross", 7);
    let trees = 0;
    for (const f of map.features) if (f !== FEATURE_EMPTY) trees++;
    expect(trees).toBeGreaterThan(200);
  });

  it("keeps dustplains wide open with only a small pond", () => {
    const map = generateMap("dustplains", 0xa11ce);
    let walkable = 0;
    let water = 0;
    let total = 0;
    // Proportional insets (same normalized survey window at any grid size)
    // so the edge-sea ring outside the playable interior never leaks in.
    const mx = Math.round(map.width * 0.05);
    const mz = Math.round(map.height * 0.0625);
    for (let z = mz; z < map.height - mz; z++) {
      for (let x = mx; x < map.width - mx; x++) {
        total++;
        const h = map.heights[z * map.width + x] ?? 0;
        if (h <= map.seaLevel) water++;
        if (isWalkable(map, x, z)) walkable++;
      }
    }
    // Open tank country: overwhelmingly drivable, water just the pond.
    expect(walkable / total).toBeGreaterThan(0.8);
    expect(water / total).toBeLessThan(0.08);
  });

  it("scatters only sparse copses across dustplains", () => {
    const map = generateMap("dustplains", 7);
    const green = generateMap("rivercross", 7);
    const trees = (m: typeof map): number => {
      let n = 0;
      for (const f of m.features) if (f !== FEATURE_EMPTY) n++;
      return n;
    };
    expect(trees(map)).toBeGreaterThan(0);
    expect(trees(map)).toBeLessThan(trees(green));
  });

  it("is deterministic per seed and varies across seeds", () => {
    for (const preset of ["rivercross", "dustplains"] as const) {
      const a = generateMap(preset, 4242);
      const b = generateMap(preset, 4242);
      expect(a.heights).toEqual(b.heights);
      expect(a.features).toEqual(b.features);
      expect(generateMap(preset, 4243).heights).not.toEqual(a.heights);
    }
  });

  it("ships a full unit roster on both new maps", () => {
    for (const preset of ["rivercross", "dustplains"] as const) {
      for (const seed of [1, 7, 0xa11ce]) {
        const map = generateMap(preset, seed);
        expect(map.units).toHaveLength(startingUnitCount(preset));
        for (const u of map.units) {
          expect(map.heights[u.cellZ * map.width + u.cellX]).toBeGreaterThan(map.seaLevel + 4);
        }
      }
    }
  });
});

function firstWalkable(
  map: Parameters<typeof isWalkable>[0],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): { cellX: number; cellZ: number } | undefined {
  for (let z = z0; z < z1; z += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (isWalkable(map, x, z)) return { cellX: x, cellZ: z };
    }
  }
  return undefined;
}
