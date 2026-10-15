import { describe, expect, it } from "vitest";
import {
  applyBlastToHqs,
  createHqDamage,
  createHqSpawns,
  HQ_DRY_MARGIN,
  HQ_FALLBACK_DRY_MARGIN,
  HQ_FALLBACK_SLOPE,
  HQ_FOUNDATION_MARGIN,
  HQ_HIGH_BASELINE,
  HQ_HIGH_FRACTION,
  HQ_MAX_SLOPE,
  HQ_MAX_SPAWNS,
  HQ_SPAWN_CYCLE,
  HQ_SPAWN_INTERVAL,
  hqAnchor,
  hqCellSlope,
  hqCellX,
  hqFoundationDrop,
  hqHallClear,
  hqMaxAboveSea,
  isHqDestroyed,
  isHqGround,
  placeHqs,
  spawnKindFor,
  tickHqSpawn,
  HQ_HIT_DAMAGE,
} from "./hq.js";
import { generateMap } from "../terrain/generate.js";
import type { MapPreset } from "../terrain/types.js";

function flatField(width = 64, height = 64, h = 40, seaLevel = 10) {
  return {
    heights: new Uint8Array(width * height).fill(h),
    width,
    height,
    seaLevel,
  };
}

describe("placeHqs", () => {
  it("sites one HQ per team at opposite map ends", () => {
    const sites = placeHqs(flatField(), 7);
    expect(sites).toHaveLength(2);
    expect(sites[0]!.team).toBe(0);
    expect(sites[1]!.team).toBe(1);
    expect(sites[0]!.cellX).toBe(hqCellX(64, 0));
    expect(sites[1]!.cellX).toBe(hqCellX(64, 1));
    expect(sites[0]!.cellX).toBeLessThan(sites[1]!.cellX);
    // Middle row on flat ground.
    expect(sites[0]!.cellZ).toBe(32);
  });

  it("is deterministic per seed and steps inward off flooded shores", () => {
    const a = placeHqs(flatField(), 11);
    const b = placeHqs(flatField(), 11);
    expect(a).toEqual(b);
    // The seed offsets the scan start, but flat ground still prefers mid —
    // vary the terrain instead: a flooded west column steps the site one
    // cell inward onto dry ground instead of beaching in it.
    const field = flatField();
    for (let z = 0; z < 64; z++) field.heights[z * 64 + hqCellX(64, 0)] = 0;
    const wet = placeHqs(field, 11);
    expect(wet[0]!.cellX).toBe(hqCellX(64, 0) + 1);
    const h = field.heights[wet[0]!.cellZ * 64 + wet[0]!.cellX]!;
    expect(h).toBeGreaterThan(field.seaLevel + HQ_FALLBACK_DRY_MARGIN);
  });

  it("anchors to world space like unit anchors", () => {
    const field = flatField();
    const sites = placeHqs(field, 3);
    const a = hqAnchor(field, sites[0]!, 2);
    expect(a.x).toBeLessThan(0);
    const b = hqAnchor(field, sites[1]!, 2);
    expect(b.x).toBeGreaterThan(0);
    expect(a.y).toBe(80);
    expect(b.y).toBe(80);
  });

  it("caps high ground relative to the map instead of preferring peaks", () => {
    // Mountainous relief: the cap is the roomier of the flat baseline and
    // the relief fraction, so peaks above it are rejected.
    const width = 64;
    const height = 64;
    const seaLevel = 10;
    const heights = new Uint8Array(width * height).fill(30);
    // One soaring peak column cell plus a valley alternative in the same
    // end column: the fort must take the valley, not the peak.
    const cx = hqCellX(width, 0);
    for (let z = 0; z < height; z++) heights[z * width + cx] = 30;
    heights[10 * width + cx] = 200;
    const field = { heights, width, height, seaLevel };
    const cap = hqMaxAboveSea(field);
    expect(cap).toBeCloseTo(
      Math.max(HQ_HIGH_BASELINE, (200 - seaLevel) * HQ_HIGH_FRACTION),
      6,
    );
    expect(isHqGround(field, cx, 10, cap)).toBe(false);
    expect(isHqGround(field, cx, 40, cap)).toBe(true);
    const sites = placeHqs(field, 5);
    expect(sites[0]!.cellZ).not.toBe(10);
    const h = heights[sites[0]!.cellZ * width + cx]!;
    expect(h).toBeLessThanOrEqual(seaLevel + cap);
  });

  it("rejects water with margin, steep slopes, and wet hall corridors", () => {
    const width = 32;
    const height = 32;
    const seaLevel = 75;
    const heights = new Uint8Array(width * height).fill(seaLevel + 20);
    const field = { heights, width, height, seaLevel };
    const cap = hqMaxAboveSea(field);
    const cx = hqCellX(width, 0);
    // Shore water with the old +4 margin would pass; the +8 margin rejects.
    heights[8 * width + cx] = seaLevel + HQ_DRY_MARGIN - 1;
    expect(isHqGround(field, cx, 8, cap)).toBe(false);
    // Steep cliff next to the anchor rejects.
    heights[9 * width + cx] = seaLevel + 20;
    heights[9 * width + cx + 1] = seaLevel + 20 + HQ_MAX_SLOPE + 1;
    expect(hqCellSlope(field, cx, 9)).toBeGreaterThan(HQ_MAX_SLOPE);
    expect(isHqGround(field, cx, 9, cap)).toBe(false);
    // A wet hall corridor (water under the mouth) rejects the site.
    const dir = 1;
    for (let i = 0; i <= 12; i++) heights[20 * width + cx + dir * i] = seaLevel + 20;
    heights[20 * width + cx + 6] = seaLevel + HQ_FALLBACK_DRY_MARGIN - 1;
    expect(hqHallClear(field, cx, 20, 0)).toBe(false);
  });

  it("sites every preset off water, off peaks, and on gentle hall-clear ground", () => {
    const presets: MapPreset[] = [
      "greenreach",
      "archipelago",
      "highpass",
      "caldera",
      "rivercross",
      "dustplains",
    ];
    for (const preset of presets) {
      for (const seed of [1, 7, 42]) {
        const map = generateMap(preset, seed);
        const cap = hqMaxAboveSea(map);
        const sites = placeHqs(map, map.seed);
        expect(sites).toHaveLength(2);
        for (const site of sites) {
          const h = map.heights[site.cellZ * map.width + site.cellX] ?? 0;
          // Dry with margin (strict) or at worst the relaxed shore
          // margin — never beached, never submerged.
          expect(
            h,
            `${preset} seed ${seed} team ${site.team} in water (h=${h} sea=${map.seaLevel})`,
          ).toBeGreaterThan(map.seaLevel + HQ_FALLBACK_DRY_MARGIN);
          // Below the high-ground cap (with headroom) — or, on all-high
          // halves like Ashen Pass east, within 10 of the lowest dry
          // hall-clear ground in the team's half (valley floor, not peak).
          const halfLo = site.team === 0 ? 0 : Math.floor(map.width / 2);
          const halfHi = site.team === 0 ? Math.ceil(map.width / 2) : map.width - 1;
          let halfMin = Infinity;
          for (let x = halfLo; x <= halfHi; x++) {
            for (let z = 0; z < map.height; z++) {
              const hh = map.heights[z * map.width + x] ?? 0;
              if (hh <= map.seaLevel + HQ_FALLBACK_DRY_MARGIN) continue;
              if (!hqHallClear(map, x, z, site.team)) continue;
              if (hh < halfMin) halfMin = hh;
            }
          }
          expect(
            h,
            `${preset} seed ${seed} team ${site.team} on a peak (h=${h} cap=${map.seaLevel + cap + 20} halfMin=${halfMin})`,
          ).toSatisfy(
            (v) => v <= map.seaLevel + cap + 20 || v <= halfMin + 10,
          );
          expect(hqCellSlope(map, site.cellX, site.cellZ)).toBeLessThanOrEqual(
            HQ_FALLBACK_SLOPE,
          );
          expect(hqHallClear(map, site.cellX, site.cellZ, site.team)).toBe(true);
        }
      }
    }
  });
});

describe("hqFoundationDrop", () => {
  it("returns just the burial margin on flat ground", () => {
    const field = flatField();
    const [site] = placeHqs(field, 7);
    expect(hqFoundationDrop(field, site!, 2)).toBeCloseTo(HQ_FOUNDATION_MARGIN, 9);
  });

  it("reaches the lowest footprint corner plus margin on a slope", () => {
    const field = flatField(64, 64, 40);
    const site = { team: 0 as const, cellX: hqCellX(64, 0), cellZ: 32 };
    // Downhill dip inside the hall corridor (8 cells toward the center).
    field.heights[32 * 64 + site.cellX + 8] = 20;
    expect(hqFoundationDrop(field, site, 2)).toBeCloseTo(20 * 2 + HQ_FOUNDATION_MARGIN, 9);
    // Steeper exaggeration needs a deeper skirt for the same hill.
    expect(hqFoundationDrop(field, site, 6)).toBeCloseTo(20 * 6 + HQ_FOUNDATION_MARGIN, 9);
  });

  it("ignores ground outside the footprint and never goes above the margin", () => {
    const field = flatField(64, 64, 40);
    // Anchor is the lowest cell: a far-away peak must not deepen the skirt.
    const site = { team: 1 as const, cellX: hqCellX(64, 1), cellZ: 32 };
    field.heights[0] = 200;
    expect(hqFoundationDrop(field, site, 2)).toBeCloseTo(HQ_FOUNDATION_MARGIN, 9);
  });
});

describe("applyBlastToHqs", () => {
  it("splashes with linear falloff and clamps at 1", () => {
    const damage = createHqDamage();
    const positions = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
    ];
    const touched = applyBlastToHqs(damage, positions, 0, 0, "hammer");
    expect(touched).toEqual([0]);
    expect(damage[0]).toBeCloseTo(HQ_HIT_DAMAGE.hammer, 10);
    expect(damage[1]).toBe(0);
    // Hammering the same HQ eventually destroys it, never past 1.
    for (let n = 0; n < 60; n++) applyBlastToHqs(damage, positions, 0, 0, "hammer");
    expect(damage[0]).toBe(1);
    expect(isHqDestroyed(damage[0]!)).toBe(true);
    expect(isHqDestroyed(damage[1]!)).toBe(false);
  });

  it("ignores unknown kinds and consumes no rng", () => {
    const damage = createHqDamage();
    expect(applyBlastToHqs(damage, [{ x: 0, z: 0 }], 0, 0, "bogus" as never)).toEqual([]);
    expect(damage).toEqual([0, 0]);
  });
});

describe("tickHqSpawn", () => {
  it("fires once per interval while the HQ lives", () => {
    const [state] = createHqSpawns();
    expect(state!.timer).toBe(HQ_SPAWN_INTERVAL);
    // Partial ticks never fire.
    expect(tickHqSpawn(state!, HQ_SPAWN_INTERVAL - 1, true)).toBe(false);
    expect(tickHqSpawn(state!, 1, true)).toBe(true);
    expect(state!.spawned).toBe(1);
    expect(state!.timer).toBeCloseTo(HQ_SPAWN_INTERVAL, 6);
  });

  it("stays quiet for dead HQs and past the cap", () => {
    const [state] = createHqSpawns();
    expect(tickHqSpawn(state!, 1000, false)).toBe(false);
    expect(state!.spawned).toBe(0);
    state!.spawned = HQ_MAX_SPAWNS;
    expect(tickHqSpawn(state!, 1000, true)).toBe(false);
  });

  it("cycles the spawn roster deterministically", () => {
    expect(HQ_SPAWN_CYCLE).toContain("flash");
    expect(HQ_SPAWN_CYCLE).not.toContain("commander");
    const n = HQ_SPAWN_CYCLE.length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect([0, 1, 2, n, n + 1].map(spawnKindFor)).toEqual([
      HQ_SPAWN_CYCLE[0],
      HQ_SPAWN_CYCLE[1],
      HQ_SPAWN_CYCLE[2 % n],
      HQ_SPAWN_CYCLE[0],
      HQ_SPAWN_CYCLE[1 % n],
    ]);
    // Negative indices wrap too (no undefined holes in the cycle).
    expect(spawnKindFor(-1)).toBe(HQ_SPAWN_CYCLE[(n - 1) % n]);
  });
});
