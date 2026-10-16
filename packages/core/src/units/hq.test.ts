import { describe, expect, it } from "vitest";
import {
  applyBlastToHqs,
  clearHqLanes,
  createHqDamage,
  createHqSpawns,
  HQ_DRY_MARGIN,
  HQ_FALLBACK_DRY_MARGIN,
  HQ_FALLBACK_SLOPE,
  HQ_FOUNDATION_MARGIN,
  HQ_HALL_CELLS,
  HQ_HIGH_BASELINE,
  HQ_HIGH_FRACTION,
  HQ_MAX_SLOPE,
  HQ_MAX_SPAWNS,
  HQ_PAD_FRONT_EXTRA,
  HQ_PAD_HALF_WIDTH,
  HQ_PAD_REAR,
  HQ_ROAD_EXTRA,
  HQ_ROAD_HALF_WIDTH,
  HQ_SPAWN_INTERVAL,
  HQ_SPAWN_MAX_INTERVAL,
  HQ_SPAWN_MIN_INTERVAL,
  HQ_SPAWN_ROSTER,
  hqAnchor,
  hqCellSlope,
  hqCellX,
  hqFoundationDrop,
  hqHallClear,
  hqMaxAboveSea,
  hqPadCells,
  hqRoadCells,
  hqSpawnStrength,
  isHqDestroyed,
  isHqGround,
  levelHqPads,
  pickNextSpawnUnit,
  placeHqs,
  spawnIntervalFor,
  spawnWeightFor,
  tickHqSpawn,
  HQ_HIT_DAMAGE,
} from "./hq.js";
import { BLAST_RADIUS } from "./destruction.js";
import { UNIT_HIT_DAMAGE } from "./unitDamage.js";
import { mulberry32 } from "../terrain/noise.js";
import { generateMap } from "../terrain/generate.js";
import { FEATURE_EMPTY, FEATURE_FRINGE, worldHeight, type MapPreset } from "../terrain/types.js";

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
    expect(a.y).toBe(worldHeight(40, 2));
    expect(b.y).toBe(worldHeight(40, 2));
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
        // The shipped forts: the ground works were built for exactly these.
        const sites = map.hqs;
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
    expect(hqFoundationDrop(field, site, 2)).toBeCloseTo(worldHeight(20, 2) + HQ_FOUNDATION_MARGIN, 9);
    // Steeper exaggeration needs a deeper skirt for the same hill.
    expect(hqFoundationDrop(field, site, 6)).toBeCloseTo(worldHeight(20, 6) + HQ_FOUNDATION_MARGIN, 9);
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
  it("releases a random kind per interval while the HQ lives", () => {
    const [state] = createHqSpawns();
    expect(state!.timer).toBe(HQ_SPAWN_INTERVAL);
    // Partial ticks release nothing and draw no rng.
    let draws = 0;
    const counting = (rng: () => number): (() => number) => () => {
      draws++;
      return rng();
    };
    expect(tickHqSpawn(state!, HQ_SPAWN_INTERVAL - 1, true, counting(mulberry32(7)))).toBeNull();
    expect(draws).toBe(0);
    const kind = tickHqSpawn(state!, 1, true, mulberry32(7));
    expect(kind).not.toBeNull();
    expect(HQ_SPAWN_ROSTER).toContain(kind);
    expect(state!.spawned).toBe(1);
    // The clock rearms for the released kind's own build time.
    expect(state!.timer).toBeCloseTo(spawnIntervalFor(kind!), 9);
  });

  it("draws the same kind for the same seed", () => {
    const [a] = createHqSpawns();
    const [b] = createHqSpawns();
    const ka = tickHqSpawn(a!, HQ_SPAWN_INTERVAL, true, mulberry32(21));
    const kb = tickHqSpawn(b!, HQ_SPAWN_INTERVAL, true, mulberry32(21));
    expect(ka).toBe(kb);
  });

  it("stays quiet for dead HQs and past the cap, drawing no rng", () => {
    const [state] = createHqSpawns();
    const throwing = (): number => {
      throw new Error("rng must not be drawn while silent");
    };
    expect(tickHqSpawn(state!, 1000, false, throwing)).toBeNull();
    expect(state!.spawned).toBe(0);
    state!.spawned = HQ_MAX_SPAWNS;
    expect(tickHqSpawn(state!, 1000, true, throwing)).toBeNull();
  });

  it("fields the line roster but never commanders", () => {
    expect(HQ_SPAWN_ROSTER).toEqual(["peewee", "flash", "stump", "hammer"]);
    expect(HQ_SPAWN_ROSTER).not.toContain("commander");
  });
});

describe("hqSpawnStrength", () => {
  it("ranks peewee < flash < stump < hammer as splash-weighted punch", () => {
    for (const kind of HQ_SPAWN_ROSTER) {
      expect(hqSpawnStrength(kind)).toBeCloseTo(UNIT_HIT_DAMAGE[kind]! * BLAST_RADIUS[kind]!, 12);
    }
    const order = HQ_SPAWN_ROSTER.map(hqSpawnStrength);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(hqSpawnStrength("commander")).toBeGreaterThan(0);
  });
});

describe("spawnWeightFor", () => {
  it("weighs weaker units heavier, commanders zero", () => {
    expect(spawnWeightFor("peewee")).toBe(1);
    expect(spawnWeightFor("flash")).toBeLessThan(1);
    expect(spawnWeightFor("stump")).toBeLessThan(spawnWeightFor("flash"));
    expect(spawnWeightFor("hammer")).toBeLessThan(spawnWeightFor("stump"));
    expect(spawnWeightFor("hammer")).toBeGreaterThan(0);
    expect(spawnWeightFor("commander")).toBe(0);
    expect(spawnWeightFor("bogus" as never)).toBe(0);
  });
});

describe("spawnIntervalFor", () => {
  it("builds stronger units slower, bounded by the min/max build times", () => {
    expect(spawnIntervalFor("peewee")).toBe(HQ_SPAWN_MIN_INTERVAL);
    expect(spawnIntervalFor("hammer")).toBe(HQ_SPAWN_MAX_INTERVAL);
    expect(spawnIntervalFor("flash")).toBeGreaterThan(spawnIntervalFor("peewee"));
    expect(spawnIntervalFor("stump")).toBeGreaterThan(spawnIntervalFor("flash"));
    expect(spawnIntervalFor("hammer")).toBeGreaterThan(spawnIntervalFor("stump"));
    // Unknown kinds fall back to the legacy cadence.
    expect(spawnIntervalFor("commander")).toBe(HQ_SPAWN_INTERVAL);
    expect(spawnIntervalFor("bogus" as never)).toBe(HQ_SPAWN_INTERVAL);
  });
});

describe("faster production cadence", () => {
  it("pins the doubled cadence in absolute seconds", () => {
    // Reinforcements must arrive about twice as fast as the legacy 40 s /
    // 30–70 s pacing: first release at 20 s, per-kind builds 15–35 s.
    expect(HQ_SPAWN_INTERVAL).toBe(20);
    expect(HQ_SPAWN_MIN_INTERVAL).toBe(15);
    expect(HQ_SPAWN_MAX_INTERVAL).toBe(35);
    expect(spawnIntervalFor("peewee")).toBe(15);
    expect(spawnIntervalFor("hammer")).toBe(35);
    for (const kind of ["flash", "stump"] as const) {
      expect(spawnIntervalFor(kind)).toBeGreaterThan(15);
      expect(spawnIntervalFor(kind)).toBeLessThan(35);
    }
  });

  it("fields the full cap well inside the old worst case", () => {
    // Old pacing needed up to 40 + 3 × 70 = 250 s for all 4 releases; the
    // doubled cadence caps at 20 + 3 × 35 = 125 s for every seed.
    for (const seed of [1, 7, 42, 99, 1234]) {
      const [state] = createHqSpawns();
      const rng = mulberry32(seed);
      let clock = 0;
      let lastRelease = -1;
      for (let n = 0; n < 400 && state!.spawned < HQ_MAX_SPAWNS; n++) {
        if (tickHqSpawn(state!, 1, true, rng) !== null) lastRelease = clock + 1;
        clock += 1;
      }
      expect(state!.spawned).toBe(HQ_MAX_SPAWNS);
      expect(lastRelease).toBeGreaterThan(0);
      expect(lastRelease).toBeLessThanOrEqual(HQ_SPAWN_INTERVAL + 3 * HQ_SPAWN_MAX_INTERVAL);
    }
  });
});

describe("pickNextSpawnUnit", () => {
  it("pins roster bands with stub rolls", () => {
    // Weights peewee 1 / flash ≈0.58 / stump ≈0.32 / hammer ≈0.12 read
    // cumulative bands [0, .494) / [.494, .782) / [.782, .939) / [.939, 1).
    expect(pickNextSpawnUnit(() => 0)).toBe("peewee");
    expect(pickNextSpawnUnit(() => 0.5)).toBe("flash");
    expect(pickNextSpawnUnit(() => 0.8)).toBe("stump");
    expect(pickNextSpawnUnit(() => 0.95)).toBe("hammer");
    expect(pickNextSpawnUnit(() => 0.999999)).toBe("hammer");
  });

  it("consumes exactly one draw, so seeded streams replay", () => {
    let draws = 0;
    const rng = mulberry32(99);
    const counting = (): number => {
      draws++;
      return rng();
    };
    const first = pickNextSpawnUnit(counting);
    expect(draws).toBe(1);
    expect(pickNextSpawnUnit(mulberry32(99))).toBe(first);
  });

  it("covers the roster but favors the weak over many draws", () => {
    const rng = mulberry32(1234);
    const counts: Record<string, number> = { peewee: 0, flash: 0, stump: 0, hammer: 0 };
    const N = 2000;
    for (let n = 0; n < N; n++) counts[pickNextSpawnUnit(rng)]!++;
    for (const kind of HQ_SPAWN_ROSTER) expect(counts[kind]).toBeGreaterThan(0);
    expect(counts.peewee).toBeGreaterThan(counts.flash!);
    expect(counts.flash).toBeGreaterThan(counts.stump!);
    expect(counts.stump).toBeGreaterThan(counts.hammer!);
    // Spot-check the mix against the weights (wide tolerance — bounded
    // randomness, not an exact shuffle).
    expect(counts.peewee! / N).toBeGreaterThan(0.35);
    expect(counts.hammer! / N).toBeLessThan(0.15);
  });
});

describe("hq exit lanes", () => {
  it("lays the pad and road toward the map center per team", () => {
    const w = 64;
    const h = 64;
    const west = { team: 0 as const, cellX: 5, cellZ: 32 };
    const pad = hqPadCells(west, w, h);
    const padXs = pad.map((c) => c.cellX);
    const padZs = pad.map((c) => c.cellZ);
    expect(Math.min(...padXs)).toBe(5 - HQ_PAD_REAR);
    expect(Math.max(...padXs)).toBe(5 + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA);
    expect(Math.min(...padZs)).toBe(32 - HQ_PAD_HALF_WIDTH);
    expect(Math.max(...padZs)).toBe(32 + HQ_PAD_HALF_WIDTH);
    // Full rectangle, no gaps.
    expect(pad).toHaveLength(
      (HQ_PAD_REAR + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1) * (HQ_PAD_HALF_WIDTH * 2 + 1),
    );
    // The road picks up past the hall mouth and runs further in.
    const road = hqRoadCells(west, w, h);
    const roadXs = road.map((c) => c.cellX);
    const roadZs = road.map((c) => c.cellZ);
    expect(Math.min(...roadXs)).toBe(5 + HQ_HALL_CELLS + 1);
    expect(Math.max(...roadXs)).toBe(5 + HQ_HALL_CELLS + HQ_ROAD_EXTRA);
    expect(Math.min(...roadZs)).toBe(32 - HQ_ROAD_HALF_WIDTH);
    expect(Math.max(...roadZs)).toBe(32 + HQ_ROAD_HALF_WIDTH);
    expect(road).toHaveLength(HQ_ROAD_EXTRA * (HQ_ROAD_HALF_WIDTH * 2 + 1));
    // The east works mirrors toward -x.
    const east = { team: 1 as const, cellX: 58, cellZ: 10 };
    const epadXs = hqPadCells(east, w, h).map((c) => c.cellX);
    expect(Math.max(...epadXs)).toBe(58 + HQ_PAD_REAR);
    expect(Math.min(...epadXs)).toBe(58 - HQ_HALL_CELLS - HQ_PAD_FRONT_EXTRA);
    const eroadXs = hqRoadCells(east, w, h).map((c) => c.cellX);
    expect(Math.max(...eroadXs)).toBe(58 - HQ_HALL_CELLS - 1);
    expect(Math.min(...eroadXs)).toBe(58 - HQ_HALL_CELLS - HQ_ROAD_EXTRA);
  });

  it("clamps lanes to the grid at map edges", () => {
    const site = { team: 0 as const, cellX: 1, cellZ: 0 };
    const cells = [...hqPadCells(site, 8, 8), ...hqRoadCells(site, 8, 8)];
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.cellX).toBeGreaterThanOrEqual(0);
      expect(c.cellX).toBeLessThan(8);
      expect(c.cellZ).toBeGreaterThanOrEqual(0);
      expect(c.cellZ).toBeLessThan(8);
    }
  });

  it("levels pads to the anchor height and leaves the rest alone", () => {
    const width = 64;
    const height = 32;
    // A steady uphill grade toward the map center: the pad must cut it flat.
    const heights = new Uint8Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) heights[z * width + x] = 40 + x;
    }
    const field = { heights, width, height, seaLevel: 10 };
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    const anchor = 40 + 5;
    levelHqPads(field, [site]);
    for (const c of hqPadCells(site, width, height)) {
      expect(field.heights[c.cellZ * width + c.cellX]).toBe(anchor);
    }
    // Outside the pad the grade survives (a cell past the road end).
    const farX = 5 + HQ_HALL_CELLS + HQ_ROAD_EXTRA + 1;
    expect(field.heights[16 * width + farX]).toBe(40 + farX);
    // Leveling is a no-op on an already-flat pad.
    levelHqPads(field, [site]);
    for (const c of hqPadCells(site, width, height)) {
      expect(field.heights[c.cellZ * width + c.cellX]).toBe(anchor);
    }
  });

  it("clears lanes of every feature word and leaves the rest alone", () => {
    const width = 32;
    const height = 32;
    const heights = new Uint8Array(width * height).fill(40);
    // Woods everywhere, with rocks, a metal deposit, and fringe mixed in.
    const features = new Uint16Array(width * height).fill(0);
    features[16 * width + 8] = 3;
    features[16 * width + 9] = 4;
    features[17 * width + 8] = 5;
    features[17 * width + 9] = FEATURE_FRINGE;
    const field = { heights, width, height, seaLevel: 10, features };
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    clearHqLanes(field, [site]);
    for (const c of [...hqPadCells(site, width, height), ...hqRoadCells(site, width, height)]) {
      expect(field.features[c.cellZ * width + c.cellX]).toBe(FEATURE_EMPTY);
    }
    // Outside the lanes the woods stand.
    expect(field.features[0]).toBe(0);
    expect(field.features[height * width - 1]).toBe(0);
  });

  it("ships leveled, cleared, dirt-painted lanes for its own forts", () => {
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
        expect(map.hqs).toHaveLength(2);
        const tileW = map.width / 2;
        for (const site of map.hqs) {
          const anchor = map.heights[site.cellZ * map.width + site.cellX] ?? 0;
          const lane = [...hqPadCells(site, map.width, map.height), ...hqRoadCells(site, map.width, map.height)];
          expect(lane.length).toBeGreaterThan(0);
          for (const c of hqPadCells(site, map.width, map.height)) {
            expect(
              map.heights[c.cellZ * map.width + c.cellX],
              `${preset} seed ${seed} team ${site.team} pad not level`,
            ).toBe(anchor);
          }
          for (const c of lane) {
            expect(
              map.features[c.cellZ * map.width + c.cellX],
              `${preset} seed ${seed} team ${site.team} feature blocks the lane`,
            ).toBe(FEATURE_EMPTY);
            const tile = map.tileMap[(c.cellZ >> 1) * tileW + (c.cellX >> 1)] ?? 0;
            expect(
              map.tileKinds[tile],
              `${preset} seed ${seed} team ${site.team} lane tile not dirt`,
            ).toBe("dirt");
          }
          // The finished ground still satisfies the siting guards.
          expect(hqHallClear(map, site.cellX, site.cellZ, site.team)).toBe(true);
        }
      }
    }
  });
});
