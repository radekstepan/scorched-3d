import { describe, expect, it } from "vitest";
import {
  applyBlastToHqs,
  clearHqLanes,
  createHqDamage,
  createHqSpawns,
  HQ_DRY_MARGIN,
  HQ_EXIT_MAX_STEP,
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
  HQ_SPAWN_SHARE_FAST,
  HQ_SPAWN_SHARE_SLOW,
  gradeHqExits,
  hqAnchor,
  hqCellSlope,
  hqCellX,
  hqFoundationDrop,
  hqHallClear,
  hqMaxAboveSea,
  hqPadCells,
  hqPadTop,
  hqRoadCells,
  hqSpawnStrength,
  isHqDestroyed,
  isHqGround,
  isHqRoadCell,
  levelHqPads,
  pickNextSpawnUnit,
  placeHqs,
  spawnIntervalFor,
  spawnIntervalScale,
  spawnWeightFor,
  tickHqSpawn,
  HQ_HIT_DAMAGE,
} from "./hq.js";
import { BLAST_RADIUS } from "./destruction.js";
import { PATH_MAX_SLOPE } from "./pathfinding.js";
import { UNIT_HIT_DAMAGE } from "./unitDamage.js";
import { mulberry32 } from "../terrain/noise.js";
import { classifyTile, generateMap, sampleHeightField } from "../terrain/generate.js";
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
        // Siting invariants are measured on the raw pre-construction
        // heightfield — the ground the siter saw — because construction
        // raises pads UP to their local top afterwards.
        const raw = sampleHeightField(preset, seed);
        const cap = hqMaxAboveSea(raw);
        const sites = placeHqs(raw, seed);
        expect(sites).toHaveLength(2);
        // The shipped map builds its forts from exactly these sites.
        expect(generateMap(preset, seed).hqs).toEqual(sites);
        for (const site of sites) {
          const h = raw.heights[site.cellZ * raw.width + site.cellX] ?? 0;
          // Dry with margin (strict) or at worst the relaxed shore
          // margin — never beached, never submerged.
          expect(
            h,
            `${preset} seed ${seed} team ${site.team} in water (h=${h} sea=${raw.seaLevel})`,
          ).toBeGreaterThan(raw.seaLevel + HQ_FALLBACK_DRY_MARGIN);
          // Below the high-ground cap (with headroom) — or, on all-high
          // halves like Ashen Pass east, within 10 of the lowest dry
          // hall-clear ground in the team's half (valley floor, not peak).
          const halfLo = site.team === 0 ? 0 : Math.floor(raw.width / 2);
          const halfHi = site.team === 0 ? Math.ceil(raw.width / 2) : raw.width - 1;
          let halfMin = Infinity;
          for (let x = halfLo; x <= halfHi; x++) {
            for (let z = 0; z < raw.height; z++) {
              const hh = raw.heights[z * raw.width + x] ?? 0;
              if (hh <= raw.seaLevel + HQ_FALLBACK_DRY_MARGIN) continue;
              if (!hqHallClear(raw, x, z, site.team)) continue;
              if (hh < halfMin) halfMin = hh;
            }
          }
          expect(
            h,
            `${preset} seed ${seed} team ${site.team} on a peak (h=${h} cap=${raw.seaLevel + cap + 20} halfMin=${halfMin})`,
          ).toSatisfy(
            (v) => v <= raw.seaLevel + cap + 20 || v <= halfMin + 10,
          );
          expect(hqCellSlope(raw, site.cellX, site.cellZ)).toBeLessThanOrEqual(
            HQ_FALLBACK_SLOPE,
          );
          expect(hqHallClear(raw, site.cellX, site.cellZ, site.team)).toBe(true);
        }
      }
    }
  });

  it("trades map-end columns for inland flats instead of building a works hill", () => {
    // A shore ramp at the west end (dry, gentle per cell, hall-clear)
    // rising onto a flat steppe: the old outermost-low scorer took the ramp
    // foot and filled a 24-unit hill; the lift price must step the fort
    // inland onto the flat, where the pad needs no fill at all.
    const width = 96;
    const height = 64;
    const seaLevel = 10;
    const heights = new Uint8Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        heights[z * width + x] = Math.min(24 + 2 * Math.max(0, x - hqCellX(width, 0)), 48);
      }
    }
    const field = { heights, width, height, seaLevel };
    const sites = placeHqs(field, 7);
    const west = sites[0]!;
    expect(west.team).toBe(0);
    // First fully-flat column past the ramp: anchor on the steppe, no fill.
    expect(west.cellX).toBe(hqCellX(width, 0) + 12);
    expect(west.cellZ).toBe(height >> 1);
    const anchor = heights[west.cellZ * width + west.cellX]!;
    expect(hqPadTop(field, west) - anchor).toBe(0);
    // The flat east end still sites at the outermost column.
    expect(sites[1]!.cellX).toBe(hqCellX(width, 1));
  });

  it("seats Dust Plains forts inland on natural steppe with no works hill", () => {
    // Regression: map-end anchors on the shore ramp (sea + 9) filled a
    // 15–21 unit pad hill. The lift price must pull both forts further
    // inland, onto ground already high enough that leveling is a touch-up,
    // not a hill.
    for (const seed of [1, 7, 42, 3, 99]) {
      const raw = sampleHeightField("dustplains", seed);
      const sites = placeHqs(raw, seed);
      // The shipped map builds its forts from exactly these sites.
      expect(generateMap("dustplains", seed).hqs).toEqual(sites);
      for (const site of sites) {
        const endX = hqCellX(raw.width, site.team);
        const anchor = raw.heights[site.cellZ * raw.width + site.cellX] ?? 0;
        const lift = hqPadTop(raw, site) - anchor;
        expect(
          Math.abs(site.cellX - endX),
          `dustplains seed ${seed} team ${site.team} still on the shore ramp`,
        ).toBeGreaterThanOrEqual(18);
        expect(
          anchor,
          `dustplains seed ${seed} team ${site.team} anchor too low (h=${anchor})`,
        ).toBeGreaterThanOrEqual(raw.seaLevel + 20);
        expect(
          lift,
          `dustplains seed ${seed} team ${site.team} still builds a hill (lift=${lift})`,
        ).toBeLessThanOrEqual(4);
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

  it("builds faster with more ground, slower with less, legacy at even", () => {
    const [even] = createHqSpawns();
    const kind = tickHqSpawn(even!, HQ_SPAWN_INTERVAL, true, mulberry32(21));
    const base = spawnIntervalFor(kind!);
    expect(even!.timer).toBeCloseTo(base, 9);

    // Same seed, same kind — only the territory share differs.
    const [ahead] = createHqSpawns();
    const kindAhead = tickHqSpawn(ahead!, HQ_SPAWN_INTERVAL, true, mulberry32(21), 1);
    expect(kindAhead).toBe(kind);
    expect(ahead!.timer).toBeCloseTo(base * HQ_SPAWN_SHARE_FAST, 9);

    const [behind] = createHqSpawns();
    const kindBehind = tickHqSpawn(behind!, HQ_SPAWN_INTERVAL, true, mulberry32(21), 0);
    expect(kindBehind).toBe(kind);
    expect(behind!.timer).toBeCloseTo(base * HQ_SPAWN_SHARE_SLOW, 9);
    // A shut-out side still rearms a finite clock — never starved.
    expect(behind!.timer).toBeLessThan(base * 2);
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

describe("spawnIntervalScale", () => {
  it("is 1.0 at even ground, fast at full hold, slow at none", () => {
    expect(spawnIntervalScale(0.5)).toBeCloseTo(1, 9);
    expect(spawnIntervalScale(1)).toBe(HQ_SPAWN_SHARE_FAST);
    expect(spawnIntervalScale(0)).toBe(HQ_SPAWN_SHARE_SLOW);
    // Symmetric: as far below 1.0 ahead as above it behind.
    expect(1 - spawnIntervalScale(1)).toBeCloseTo(spawnIntervalScale(0) - 1, 9);
    expect(spawnIntervalScale(0.75)).toBeLessThan(1);
    expect(spawnIntervalScale(0.25)).toBeGreaterThan(1);
  });

  it("clamps out-of-range and non-finite shares to the nearest bound", () => {
    expect(spawnIntervalScale(-2)).toBe(HQ_SPAWN_SHARE_SLOW);
    expect(spawnIntervalScale(99)).toBe(HQ_SPAWN_SHARE_FAST);
    expect(spawnIntervalScale(Number.NaN)).toBeCloseTo(1, 9);
  });
});

describe("production cadence", () => {
  it("pins the 20 s peewee cadence in absolute seconds", () => {
    // Per-kind builds scale by 4/3 off the old 15–35 s pacing (peewee
    // 15 → 20 s): first release still at 20 s, builds 20–46⅔ s.
    expect(HQ_SPAWN_INTERVAL).toBe(20);
    expect(HQ_SPAWN_MIN_INTERVAL).toBe(20);
    expect(HQ_SPAWN_MAX_INTERVAL).toBe(140 / 3);
    expect(spawnIntervalFor("peewee")).toBe(20);
    expect(spawnIntervalFor("hammer")).toBe(HQ_SPAWN_MAX_INTERVAL);
    // Mid-roster builds keep their relative ratios (each exactly 4/3 ×
    // the old ≈18.2 / ≈22.0 s interpolation).
    expect(spawnIntervalFor("flash")).toBeCloseTo(24.3, 1);
    expect(spawnIntervalFor("stump")).toBeCloseTo(29.3, 1);
    for (const kind of ["flash", "stump"] as const) {
      expect(spawnIntervalFor(kind)).toBeGreaterThan(20);
      expect(spawnIntervalFor(kind)).toBeLessThan(140 / 3);
    }
  });

  it("fields the full cap within the rescaled worst case", () => {
    // Old pacing needed up to 20 + 3 × 35 = 125 s for all 4 releases;
    // the rescaled cadence caps at 20 + 3 × 140/3 = 160 s for every seed.
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
    // Weights peewee 1 / flash ≈0.28 / stump ≈0.15 / hammer ≈0.06 read
    // cumulative bands [0, .672) / [.672, .859) / [.859, .961) / [.961, 1).
    expect(pickNextSpawnUnit(() => 0)).toBe("peewee");
    expect(pickNextSpawnUnit(() => 0.5)).toBe("peewee");
    expect(pickNextSpawnUnit(() => 0.7)).toBe("flash");
    expect(pickNextSpawnUnit(() => 0.9)).toBe("stump");
    expect(pickNextSpawnUnit(() => 0.97)).toBe("hammer");
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

  it("matches the enumerated exit lane cell for cell", () => {
    // The arithmetic road test must agree with the enumerated lane exactly
    // for both facings — siting prices every candidate through it.
    const w = 64;
    const h = 64;
    for (const team of [0, 1] as const) {
      const site = { team, cellX: team === 0 ? 5 : 58, cellZ: 32 };
      const lane = new Set(hqRoadCells(site, w, h).map((c) => c.cellZ * w + c.cellX));
      expect(lane.size).toBeGreaterThan(0);
      for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
          expect(isHqRoadCell(site, x, z)).toBe(lane.has(z * w + x));
        }
      }
    }
  });

  it("prices the pad top off the pad plus apron, never the driveway", () => {
    const width = 64;
    const height = 32;
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    // Flat pad: the top is the anchor, no lift.
    const heights = new Uint8Array(width * height).fill(40);
    const field = { heights, width, height, seaLevel: 10 };
    expect(hqPadTop(field, site)).toBe(40);
    // A spike on the driveway past the mouth is the ramp's job, not fill.
    const mouth = 5 + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA;
    heights[16 * width + mouth + 5] = 200;
    expect(isHqRoadCell(site, mouth + 5, 16)).toBe(true);
    expect(hqPadTop(field, site)).toBe(40);
    // A spike on the apron ring counts: the pad must rise to meet it.
    heights[(16 + HQ_PAD_HALF_WIDTH + 1) * width + 5] = 90;
    expect(hqPadTop(field, site)).toBe(90);
  });

  it("levels pads UP to the pad-plus-apron top and leaves the rest alone", () => {
    const width = 64;
    const height = 32;
    // A steady uphill grade toward the map center: the low anchor must rise
    // to the top of its pad + apron ring instead of digging the works into
    // a pit at the anchor height.
    const heights = new Uint8Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) heights[z * width + x] = 40 + x;
    }
    const field = { heights, width, height, seaLevel: 10 };
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    // One past the pad's front column: the apron cell just past the front
    // corner counts (it sits beside the road mouth, outside the road's
    // half-width) — only the driveway columns themselves are excluded as
    // the mouth-wall ramp job, not pad fill.
    const top = 40 + 5 + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1;
    levelHqPads(field, [site]);
    for (const c of hqPadCells(site, width, height)) {
      expect(field.heights[c.cellZ * width + c.cellX]).toBe(top);
    }
    // The anchor cell itself rises with the pad.
    expect(field.heights[16 * width + 5]).toBe(top);
    // Outside the pad the grade survives (a cell past the road end).
    const farX = 5 + HQ_HALL_CELLS + HQ_ROAD_EXTRA + 1;
    expect(field.heights[16 * width + farX]).toBe(40 + farX);
    // Leveling is a no-op on an already-flat pad.
    levelHqPads(field, [site]);
    for (const c of hqPadCells(site, width, height)) {
      expect(field.heights[c.cellZ * width + c.cellX]).toBe(top);
    }
  });

  it("grades the exit driveway to capped steps: ramps walls, fills drops", () => {
    const width = 64;
    const height = 32;
    const seaLevel = 10;
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    // Flat pad at 60, then a cliff wall (+30 in one cell) past the mouth.
    const heights = new Uint8Array(width * height).fill(60);
    const mouth = 5 + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA;
    for (let x = mouth + 1; x < width; x++) heights[16 * width + x] = 90;
    const field = { heights, width, height, seaLevel };
    gradeHqExits(field, [site]);
    // The wall becomes a ramp: every step out capped at HQ_EXIT_MAX_STEP.
    let prev = 60;
    for (let i = HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
      const h = field.heights[16 * width + 5 + i] ?? 0;
      expect(h - prev).toBeLessThanOrEqual(HQ_EXIT_MAX_STEP);
      expect(h - prev).toBeGreaterThanOrEqual(-HQ_EXIT_MAX_STEP);
      prev = h;
    }
    expect(prev).toBe(90); // the ramp rejoins flat high ground within the road.
    // The full road width benches to the one center profile (flat across).
    for (let dz = -HQ_ROAD_HALF_WIDTH; dz <= HQ_ROAD_HALF_WIDTH; dz++) {
      expect(field.heights[(16 + dz) * width + mouth + 1]).toBe(field.heights[16 * width + mouth + 1]);
    }
    // The pad itself is untouched by grading.
    for (const c of hqPadCells(site, width, height)) {
      expect(field.heights[c.cellZ * width + c.cellX]).toBe(60);
    }
    // Grading is idempotent: a second pass changes nothing.
    const snap = Uint8Array.from(field.heights);
    gradeHqExits(field, [site]);
    expect(field.heights).toEqual(snap);
  });

  it("fills a wet dip past the mouth up to a causeway, never below", () => {
    const width = 64;
    const height = 32;
    const seaLevel = 10;
    const site = { team: 0 as const, cellX: 5, cellZ: 16 };
    // Flat pad at 60, then a plunge to water (8) past the mouth.
    const heights = new Uint8Array(width * height).fill(60);
    const mouth = 5 + HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA;
    for (let x = mouth + 1; x < mouth + 6; x++) heights[16 * width + x] = 8;
    const field = { heights, width, height, seaLevel };
    gradeHqExits(field, [site]);
    let prev = 60;
    for (let i = HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
      const h = field.heights[16 * width + 5 + i] ?? 0;
      expect(Math.abs(h - prev)).toBeLessThanOrEqual(HQ_EXIT_MAX_STEP);
      prev = h;
    }
    // The dip is an embankment now (dry): down at the cap, then back up
    // at the cap once natural ground returns, rejoining 60 five cells on.
    expect(field.heights[16 * width + mouth + 1]).toBe(60 - HQ_EXIT_MAX_STEP);
    expect(field.heights[16 * width + mouth + 6]).toBe(40);
    expect(field.heights[16 * width + mouth + 10]).toBe(60);
  });

  it("grades the mirrored east driveway toward the map center", () => {
    const width = 64;
    const height = 32;
    const site = { team: 1 as const, cellX: 58, cellZ: 16 };
    // Flat pad at 60, then a cliff wall (+30) west of the mouth.
    const heights = new Uint8Array(width * height).fill(60);
    const mouth = 58 - HQ_HALL_CELLS - HQ_PAD_FRONT_EXTRA;
    for (let x = mouth - 1; x >= 0; x--) heights[16 * width + x] = 90;
    const field = { heights, width, height, seaLevel: 10 };
    gradeHqExits(field, [site]);
    let prev = 60;
    for (let i = HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
      const h = field.heights[16 * width + 58 - i] ?? 0;
      expect(Math.abs(h - prev)).toBeLessThanOrEqual(HQ_EXIT_MAX_STEP);
      prev = h;
    }
    expect(prev).toBe(90);
  });

  it("keeps the driveway step inside the climb gate the movers drive", () => {
    // The contract with terrain.ts/pathfinding.ts: a graded step must read
    // walkable, with wide margin (half the hard gate or better).
    expect(HQ_EXIT_MAX_STEP).toBeLessThanOrEqual(PATH_MAX_SLOPE / 2);
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

  it("ships leveled dirt pads and cleared unpainted exit lanes for its own forts", () => {
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
          const pad = hqPadCells(site, map.width, map.height);
          const road = hqRoadCells(site, map.width, map.height);
          const lane = [...pad, ...road];
          expect(lane.length).toBeGreaterThan(0);
          for (const c of pad) {
            expect(
              map.heights[c.cellZ * map.width + c.cellX],
              `${preset} seed ${seed} team ${site.team} pad not level`,
            ).toBe(anchor);
          }
          // The works clears its local ground: no non-road neighbor of the
          // pad stands above the pad top (the mouth wall is the graded
          // ramp's job, asserted below, not a burial).
          const padKeys = new Set(pad.map((c) => c.cellZ * map.width + c.cellX));
          const roadKeys = new Set(road.map((c) => c.cellZ * map.width + c.cellX));
          for (const key of padKeys) {
            const cx = key % map.width;
            const cz = Math.floor(key / map.width);
            for (let dz = -1; dz <= 1; dz++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = cx + dx;
                const nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.height) continue;
                const nk = nz * map.width + nx;
                if (padKeys.has(nk) || roadKeys.has(nk)) continue;
                expect(
                  map.heights[nk] ?? 0,
                  `${preset} seed ${seed} team ${site.team} ground above the pad at (${nx},${nz})`,
                ).toBeLessThanOrEqual(anchor);
              }
            }
          }
          // The driveway out is always climbable: every centerline step from
          // the pad seam to the road end stays within the graded cap.
          {
            const dir = site.team === 0 ? 1 : -1;
            let prev = anchor;
            for (let i = HQ_HALL_CELLS + HQ_PAD_FRONT_EXTRA + 1; i <= HQ_HALL_CELLS + HQ_ROAD_EXTRA; i++) {
              const x = site.cellX + dir * i;
              if (x < 0 || x >= map.width) break;
              const h = map.heights[site.cellZ * map.width + x] ?? 0;
              expect(
                Math.abs(h - prev),
                `${preset} seed ${seed} team ${site.team} driveway wall at +${i}`,
              ).toBeLessThanOrEqual(HQ_EXIT_MAX_STEP);
              prev = h;
            }
          }
          for (const c of lane) {
            expect(
              map.features[c.cellZ * map.width + c.cellX],
              `${preset} seed ${seed} team ${site.team} feature blocks the lane`,
            ).toBe(FEATURE_EMPTY);
          }
          // The construction pad reads seated in dirt; the exit lane past
          // it keeps the natural ground — cleared of trees, never painted.
          const padTiles = new Set(pad.map((c) => (c.cellZ >> 1) * tileW + (c.cellX >> 1)));
          for (const c of pad) {
            const tile = map.tileMap[(c.cellZ >> 1) * tileW + (c.cellX >> 1)] ?? 0;
            expect(
              map.tileKinds[tile],
              `${preset} seed ${seed} team ${site.team} pad tile not dirt`,
            ).toBe("dirt");
          }
          for (const c of road) {
            const tix = (c.cellZ >> 1) * tileW + (c.cellX >> 1);
            if (padTiles.has(tix)) continue; // shared tile: the pad dirt wins.
            const tile = map.tileMap[tix] ?? 0;
            const natural = classifyTile(
              map.heights,
              map.width,
              map.height,
              map.seaLevel,
              (c.cellX >> 1) * 2,
              (c.cellZ >> 1) * 2,
              map.seed,
            );
            expect(
              map.tileKinds[tile],
              `${preset} seed ${seed} team ${site.team} exit lane repainted (${natural} expected)`,
            ).toBe(natural);
          }
          // The finished ground still satisfies the siting guards.
          expect(hqHallClear(map, site.cellX, site.cellZ, site.team)).toBe(true);
        }
      }
    }
  });
});
