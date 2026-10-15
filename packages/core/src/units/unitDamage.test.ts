import { describe, expect, it } from "vitest";
import {
  applyBlastToUnits,
  charMix,
  createUnitDamage,
  isDestroyed,
  isHeavilyDamaged,
  isSmoking,
  UNIT_HIT_DAMAGE,
  UNIT_HEAVY_DAMAGE,
  UNIT_KILL_DAMAGE,
  UNIT_SMOKE_DAMAGE,
} from "./unitDamage.js";
import { BLAST_RADIUS } from "./destruction.js";

describe("createUnitDamage", () => {
  it("starts all-pristine and zeros", () => {
    expect(createUnitDamage(3)).toEqual([0, 0, 0]);
    expect(createUnitDamage(0)).toEqual([]);
    expect(createUnitDamage(-5)).toEqual([]);
  });
});

describe("thresholds", () => {
  it("smokes before heavy damage, char saturates at 1", () => {
    expect(UNIT_SMOKE_DAMAGE).toBeLessThan(UNIT_HEAVY_DAMAGE);
    expect(isSmoking(UNIT_SMOKE_DAMAGE)).toBe(true);
    expect(isSmoking(UNIT_SMOKE_DAMAGE - 1e-9)).toBe(false);
    expect(isHeavilyDamaged(UNIT_HEAVY_DAMAGE)).toBe(true);
    expect(isHeavilyDamaged(UNIT_HEAVY_DAMAGE - 1e-9)).toBe(false);
    expect(charMix(0)).toBe(0);
    expect(charMix(0.4)).toBeGreaterThan(0);
    expect(charMix(0.4)).toBeLessThan(1);
    expect(charMix(1)).toBe(1);
  });
});

describe("unit death", () => {
  it("destroys only at full exhaustion (kill == the clamp)", () => {
    expect(UNIT_KILL_DAMAGE).toBe(1);
    expect(isDestroyed(0.999)).toBe(false);
    expect(isDestroyed(1)).toBe(true);
    expect(isDestroyed(1.5)).toBe(true);
  });

  it("crosses to destroyed through accumulated blasts, then pins at 1", () => {
    const damage = createUnitDamage(1);
    let kills = 0;
    for (let i = 0; i < 50 && kills === 0; i++) {
      const before = damage[0]!;
      applyBlastToUnits(damage, [{ x: 0, z: 0 }], 0, 0, "hammer");
      if (!isDestroyed(before) && isDestroyed(damage[0]!)) kills++;
    }
    // Hammer point-blank 0.16 → ~7 direct hits to exhaust.
    expect(kills).toBe(1);
    expect(damage[0]).toBe(1);
    // Further shells keep it pinned: the transition fires exactly once.
    for (let i = 0; i < 10; i++) {
      const before = damage[0]!;
      applyBlastToUnits(damage, [{ x: 0, z: 0 }], 0, 0, "hammer");
      if (!isDestroyed(before) && isDestroyed(damage[0]!)) kills++;
    }
    expect(kills).toBe(1);
    expect(damage[0]).toBe(1);
  });
});

describe("applyBlastToUnits", () => {
  const line = [
    { x: 0, z: 0 },
    { x: 1000, z: 0 },
  ];

  it("splashes the hull at ground zero with the full point-blank hit", () => {
    const damage = createUnitDamage(2);
    const touched = applyBlastToUnits(damage, line, 0, 0, "hammer");
    expect(touched).toEqual([0]);
    expect(damage[0]).toBeCloseTo(UNIT_HIT_DAMAGE.hammer!, 12);
    expect(damage[1]).toBe(0);
  });

  it("falls off linearly to zero at the blast radius edge", () => {
    const radius = BLAST_RADIUS.hammer!;
    for (const frac of [0.25, 0.5, 0.75]) {
      const damage = createUnitDamage(1);
      applyBlastToUnits(damage, [{ x: radius * frac, z: 0 }], 0, 0, "hammer");
      expect(damage[0]).toBeCloseTo(UNIT_HIT_DAMAGE.hammer! * (1 - frac), 12);
    }
    const edge = createUnitDamage(1);
    const touched = applyBlastToUnits(edge, [{ x: radius * 1.5, z: 0 }], 0, 0, "hammer");
    expect(touched).toEqual([]);
    expect(edge[0]).toBe(0);
  });

  it("hits hardest first (nearest-first order) and accumulates across blasts", () => {
    const damage = createUnitDamage(2);
    const pts = [
      { x: 30, z: 0 },
      { x: 5, z: 0 },
    ];
    const touched = applyBlastToUnits(damage, pts, 0, 0, "stump");
    expect(touched).toEqual([1, 0]);
    const first = damage[1]!;
    expect(first).toBeGreaterThan(damage[0]!);
    applyBlastToUnits(damage, pts, 0, 0, "stump");
    expect(damage[1]).toBeCloseTo(Math.min(1, first * 2), 12);
  });

  it("clamps at 1 no matter how many shells land", () => {
    const damage = createUnitDamage(1);
    for (let i = 0; i < 50; i++) {
      applyBlastToUnits(damage, [{ x: 0, z: 0 }], 0, 0, "hammer");
    }
    expect(damage[0]).toBe(1);
  });

  it("replays deterministically (no rng consumed)", () => {
    const pts = [
      { x: 10, z: -20 },
      { x: 40, z: 30 },
      { x: -15, z: 5 },
    ];
    const run = (): number[] => {
      const d = createUnitDamage(3);
      applyBlastToUnits(d, pts, 5, 5, "commander");
      applyBlastToUnits(d, pts, -10, 0, "flash");
      return d;
    };
    expect(run()).toEqual(run());
  });

  it("ignores unknown/degenerate inputs without touching state", () => {
    const damage = createUnitDamage(2);
    expect(applyBlastToUnits([], [], 0, 0, "hammer")).toEqual([]);
    expect(applyBlastToUnits(damage, [], 0, 0, "hammer")).toEqual([]);
    expect(damage).toEqual([0, 0]);
  });
});
