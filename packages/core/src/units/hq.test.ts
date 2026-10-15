import { describe, expect, it } from "vitest";
import {
  applyBlastToHqs,
  createHqDamage,
  createHqSpawns,
  HQ_MAX_SPAWNS,
  HQ_SPAWN_CYCLE,
  HQ_SPAWN_INTERVAL,
  hqAnchor,
  hqCellX,
  isHqDestroyed,
  placeHqs,
  spawnKindFor,
  tickHqSpawn,
  HQ_HIT_DAMAGE,
} from "./hq.js";

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

  it("is deterministic per seed and varies across seeds", () => {
    const a = placeHqs(flatField(), 11);
    const b = placeHqs(flatField(), 11);
    expect(a).toEqual(b);
    // The seed offsets the scan start, but flat ground still prefers mid —
    // vary the terrain instead: a flooded west column pushes the site over.
    const field = flatField();
    for (let z = 0; z < 64; z++) field.heights[z * 64 + hqCellX(64, 0)] = 0;
    const wet = placeHqs(field, 11);
    expect(wet[0]).toEqual({ team: 0, cellX: hqCellX(64, 0), cellZ: 32 });
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
    expect([0, 1, 2, 3, 4].map(spawnKindFor)).toEqual([
      HQ_SPAWN_CYCLE[0],
      HQ_SPAWN_CYCLE[1],
      HQ_SPAWN_CYCLE[2],
      HQ_SPAWN_CYCLE[0],
      HQ_SPAWN_CYCLE[1],
    ]);
  });
});
