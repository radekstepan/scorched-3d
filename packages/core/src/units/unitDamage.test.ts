import { describe, expect, it } from "vitest";
import {
  applyBlastToUnits,
  charMix,
  createUnitDamage,
  HUSK_DECAY_DURATION,
  HUSK_EMBER_END,
  HUSK_SINK_DEPTH,
  HUSK_SMOKE_END,
  huskDecay,
  huskEmbers,
  huskSink,
  huskSmokes,
  isDestroyed,
  isHeavilyDamaged,
  isHuskGone,
  isSmoking,
  UNIT_HIT_DAMAGE,
  UNIT_HEAVY_DAMAGE,
  UNIT_KILL_DAMAGE,
  UNIT_SMOKE_DAMAGE,
} from "./unitDamage.js";
import { BLAST_RADIUS, MAX_BLAST_SKEW } from "./destruction.js";

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

describe("husk decay", () => {
  it("decays slowly: fresh at the kill, gone only after the full duration", () => {
    // A wreck must smoulder on the field for a good while, not pop away.
    expect(HUSK_DECAY_DURATION).toBeGreaterThanOrEqual(30);
    expect(huskDecay(0)).toBe(0);
    expect(huskDecay(-5)).toBe(0);
    expect(huskDecay(Number.NaN)).toBe(0);
    expect(huskDecay(HUSK_DECAY_DURATION / 2)).toBeCloseTo(0.5, 12);
    expect(huskDecay(HUSK_DECAY_DURATION)).toBe(1);
    expect(huskDecay(HUSK_DECAY_DURATION * 3)).toBe(1);
    expect(isHuskGone(0)).toBe(false);
    expect(isHuskGone(HUSK_DECAY_DURATION - 1e-6)).toBe(false);
    expect(isHuskGone(HUSK_DECAY_DURATION)).toBe(true);
    expect(isHuskGone(HUSK_DECAY_DURATION + 100)).toBe(true);
  });

  it("sinks linearly to the full depth, clamped at both ends", () => {
    expect(HUSK_SINK_DEPTH).toBeGreaterThan(0);
    expect(huskSink(0)).toBe(0);
    expect(huskSink(0.5)).toBeCloseTo(HUSK_SINK_DEPTH / 2, 12);
    expect(huskSink(1)).toBe(HUSK_SINK_DEPTH);
    expect(huskSink(-1)).toBe(0);
    expect(huskSink(2)).toBe(HUSK_SINK_DEPTH);
    // Monotonic: the husk never resurfaces mid-decay.
    let prev = -Infinity;
    for (const d of [0, 0.1, 0.35, 0.7, 0.99, 1]) {
      const s = huskSink(d);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("gutters embers first, then smoke, then the husk itself", () => {
    // Fire dies while smoke lingers; both end long before the husk is gone.
    expect(HUSK_EMBER_END).toBeGreaterThan(0);
    expect(HUSK_EMBER_END).toBeLessThan(HUSK_SMOKE_END);
    expect(HUSK_SMOKE_END).toBeLessThan(1);
    expect(huskEmbers(0)).toBe(true);
    expect(huskSmokes(0)).toBe(true);
    const mid = (HUSK_EMBER_END + HUSK_SMOKE_END) / 2;
    expect(huskEmbers(mid)).toBe(false);
    expect(huskSmokes(mid)).toBe(true);
    const late = (HUSK_SMOKE_END + 1) / 2;
    expect(huskEmbers(late)).toBe(false);
    expect(huskSmokes(late)).toBe(false);
    // Fresh kills always read as smouldering wrecks through the damage view.
    expect(huskDecay(0)).toBe(0);
    expect(huskSmokes(huskDecay(1))).toBe(true);
    expect(huskSmokes(huskDecay(HUSK_DECAY_DURATION))).toBe(false);
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

describe("slope-aware blast splash (gradient wash)", () => {
  it("shields uphill hulls and reaches downhill ones", () => {
    const slope = { sx: 1, sz: 0, skew: MAX_BLAST_SKEW };
    const radius = BLAST_RADIUS.hammer!;
    // 70 world units out: inside the 64-radius blast downhill (eff 48),
    // far outside it uphill (eff 127).
    const down = createUnitDamage(1);
    expect(applyBlastToUnits(down, [{ x: 70, z: 0 }], 0, 0, "hammer", slope)).toEqual([0]);
    expect(down[0]!).toBeGreaterThan(0);
    const up = createUnitDamage(1);
    expect(applyBlastToUnits(up, [{ x: -70, z: 0 }], 0, 0, "hammer", slope)).toEqual([]);
    expect(up[0]).toBe(0);
    expect(radius).toBe(64);
  });

  it("hits downhill harder than uphill at the same plan distance", () => {
    const slope = { sx: 1, sz: 0, skew: MAX_BLAST_SKEW };
    // 30 out both ways: both inside (eff 20.7 / 54.5), downhill hits harder.
    const down = createUnitDamage(1);
    applyBlastToUnits(down, [{ x: 30, z: 0 }], 0, 0, "hammer", slope);
    const up = createUnitDamage(1);
    applyBlastToUnits(up, [{ x: -30, z: 0 }], 0, 0, "hammer", slope);
    expect(down[0]!).toBeGreaterThan(up[0]!);
    expect(up[0]!).toBeGreaterThan(0);
  });

  it("stays symmetric without a wash", () => {
    const a = createUnitDamage(1);
    applyBlastToUnits(a, [{ x: 60, z: 0 }], 0, 0, "hammer");
    const b = createUnitDamage(1);
    applyBlastToUnits(b, [{ x: -60, z: 0 }], 0, 0, "hammer");
    expect(a[0]).toBe(b[0]);
  });
});
