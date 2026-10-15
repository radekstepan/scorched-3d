import { describe, expect, it } from "vitest";
import { generateMap } from "../terrain/generate.js";
import { FEATURE_EMPTY } from "../terrain/types.js";
import { placeUnits, teamOf, teamSpan, unitAnchor, UNIT_COUNT, type UnitField } from "./place.js";
import { TEAM_DEFS, TEAM_IDS, UNIT_DEFS, UNIT_KINDS } from "./types.js";

const PRESETS = ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"] as const;
const SEEDS = [1, 7, 0xa11ce, 123456];

function fieldOf(preset: (typeof PRESETS)[number], seed: number): UnitField {
  const map = generateMap(preset, seed);
  return {
    heights: map.heights,
    features: map.features,
    width: map.width,
    height: map.height,
    seaLevel: map.seaLevel,
  };
}

describe("placeUnits", () => {
  it("places a full roster deterministically for the same seed", () => {
    for (const preset of PRESETS) {
      const field = fieldOf(preset, 42);
      const a = placeUnits(field, 42);
      const b = placeUnits(field, 42);
      expect(a).toEqual(b);
      expect(a).toHaveLength(UNIT_COUNT);
    }
  });

  it("covers every unit kind in the default roster", () => {
    const field = fieldOf("greenreach", 9);
    const kinds = new Set(placeUnits(field, 9).map((u) => u.kind));
    expect(kinds.size).toBe(UNIT_KINDS.length);
  });

  it("honours a custom count", () => {
    const field = fieldOf("greenreach", 9);
    expect(placeUnits(field, 9, 2)).toHaveLength(2);
    expect(placeUnits(field, 9, 10)).toHaveLength(10);
  });

  it("puts every unit on dry, gentle, unoccupied, in-bounds ground", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        for (const u of map.units) {
          expect(u.cellX).toBeGreaterThanOrEqual(8);
          expect(u.cellX).toBeLessThan(map.width - 8);
          expect(u.cellZ).toBeGreaterThanOrEqual(8);
          expect(u.cellZ).toBeLessThan(map.height - 8);
          // Dry land with margin above the waterline.
          expect(map.heights[u.cellZ * map.width + u.cellX]).toBeGreaterThan(map.seaLevel + 4);
          // Gentle ground even after the relaxed pass.
          const h00 = map.heights[u.cellZ * map.width + u.cellX] ?? 0;
          const h10 = map.heights[u.cellZ * map.width + Math.min(map.width - 1, u.cellX + 1)] ?? 0;
          const h01 =
            map.heights[Math.min(map.height - 1, u.cellZ + 1) * map.width + u.cellX] ?? 0;
          expect(Math.max(h00, h10, h01) - Math.min(h00, h10, h01)).toBeLessThanOrEqual(24);
          // No trees, rocks, or metal pads under the hull.
          expect(map.features[u.cellZ * map.width + u.cellX]).toBe(FEATURE_EMPTY);
          expect(u.rotation).toBeGreaterThanOrEqual(0);
          expect(u.rotation).toBeLessThan(Math.PI * 2);
        }
        // Units keep their distance so silhouettes never overlap.
        for (let i = 0; i < map.units.length; i++) {
          for (let j = i + 1; j < map.units.length; j++) {
            const a = map.units[i]!;
            const b = map.units[j]!;
            expect(Math.hypot(a.cellX - b.cellX, a.cellZ - b.cellZ)).toBeGreaterThanOrEqual(10);
          }
        }
      }
    }
  });

  it("regenerates different-but-valid placements per seed", () => {
    const field = fieldOf("greenreach", 1);
    const layouts = [11, 22, 33].map((s) => JSON.stringify(placeUnits(field, s)));
    expect(new Set(layouts).size).toBe(layouts.length);
  });

  it("snaps anchors to the terrain surface under exaggeration", () => {
    const map = generateMap("greenreach", 0xa11ce);
    for (const u of map.units) {
      const anchor = unitAnchor(map, u, 3.6);
      expect(anchor.x).toBeCloseTo((u.cellX - (map.width - 1) / 2) * 16);
      expect(anchor.z).toBeCloseTo((u.cellZ - (map.height - 1) / 2) * 16);
      expect(anchor.y).toBe((map.heights[u.cellZ * map.width + u.cellX] ?? 0) * 3.6);
      // Never underwater: anchor height clears the exaggerated waterline.
      expect(anchor.y).toBeGreaterThan(map.seaLevel * 3.6);
    }
  });
});

describe("generateMap units", () => {
  it("ships a deterministic roster with every map", () => {
    const a = generateMap("caldera", 555);
    const b = generateMap("caldera", 555);
    expect(a.units).toEqual(b.units);
    expect(a.units).toHaveLength(UNIT_COUNT);
  });

  it("re-places units when the seed changes", () => {
    const a = generateMap("highpass", 100);
    const b = generateMap("highpass", 101);
    expect(JSON.stringify(a.units)).not.toBe(JSON.stringify(b.units));
  });
});

describe("UNIT_DEFS", () => {
  it("defines every kind with a nanolathe catalog name and distinct colors", () => {
    const colors = new Set<number>();
    for (const kind of UNIT_KINDS) {
      const def = UNIT_DEFS[kind];
      expect(def.unitName).toMatch(/^(ARM|COR)/);
      expect(def.name.length).toBeGreaterThan(0);
      colors.add(def.color);
    }
    expect(colors.size).toBe(UNIT_KINDS.length);
  });
});

describe("teamOf", () => {
  it("splits even rosters exactly, first half west", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => teamOf(i, 6))).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("sends an odd tail slot east so nobody goes unassigned", () => {
    expect([0, 1, 2, 3, 4].map((i) => teamOf(i, 5))).toEqual([0, 0, 0, 1, 1]);
    expect(teamOf(0, 1)).toBe(0); // solo hull musters west
    expect(teamOf(1, 1)).toBe(1);
  });

  it("refuses garbage indices and counts", () => {
    expect(teamOf(-1, 6)).toBe(0);
    expect(teamOf(2.5, 6)).toBe(0);
    expect(teamOf(0, 0)).toBe(0);
  });
});

describe("teamSpan", () => {
  it("splits the map at the middle column with a demilitarized gap", () => {
    const [w0, w1] = teamSpan(128, 0);
    const [e0, e1] = teamSpan(128, 1);
    expect(w0).toBe(8);
    expect(w1).toBeLessThan(64);
    expect(e0).toBeGreaterThan(64);
    expect(e1).toBe(120);
    // West stays west of east with room between.
    expect(w1).toBeLessThan(e0);
  });
});

describe("placeUnits even teams", () => {
  it("defines two distinctly colored sides", () => {
    expect(TEAM_IDS).toEqual([0, 1]);
    expect(TEAM_DEFS[0].color).not.toBe(TEAM_DEFS[1].color);
    for (const t of TEAM_IDS) {
      expect(TEAM_DEFS[t].name.length).toBeGreaterThan(0);
    }
  });

  it("musters even halves on opposite sides of the map", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        const west = map.units.filter((u) => u.team === 0);
        const east = map.units.filter((u) => u.team === 1);
        expect(west).toHaveLength(UNIT_COUNT / 2);
        expect(east).toHaveLength(UNIT_COUNT / 2);
        const mid = map.width / 2;
        for (const u of west) expect(u.cellX).toBeLessThan(mid);
        for (const u of east) expect(u.cellX).toBeGreaterThanOrEqual(mid);
      }
    }
  });

  it("keeps team placement deterministic per seed", () => {
    const a = generateMap("greenreach", 77);
    const b = generateMap("greenreach", 77);
    expect(a.units.map((u) => u.team)).toEqual(b.units.map((u) => u.team));
  });

  it("splits custom counts with the tail slot east", () => {
    const field = fieldOf("greenreach", 9);
    expect(placeUnits(field, 9, 2).map((u) => u.team)).toEqual([0, 1]);
    expect(placeUnits(field, 9, 5).map((u) => u.team)).toEqual([0, 0, 0, 1, 1]);
  });
});
