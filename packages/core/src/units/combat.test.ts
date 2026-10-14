import { describe, expect, it } from "vitest";
import { mulberry32 } from "../terrain/noise.js";
import {
  flightDuration,
  MAX_EXPLOSIONS,
  MAX_SHOTS,
  muzzleForward,
  muzzleHeight,
  nextShotDelay,
  pickSkirmishPair,
  projectilePosition,
  SHOT_DELAY_MAX,
  SHOT_DELAY_MIN,
  WEAPON_PROFILES,
} from "./combat.js";
import { UNIT_KINDS } from "./types.js";

describe("pickSkirmishPair", () => {
  it("returns null with fewer than two units", () => {
    const rng = mulberry32(1);
    expect(pickSkirmishPair(0, rng)).toBeNull();
    expect(pickSkirmishPair(1, rng)).toBeNull();
  });

  it("always picks distinct in-range indices", () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 500; n++) {
      const pair = pickSkirmishPair(6, rng)!;
      expect(pair.attacker).toBeGreaterThanOrEqual(0);
      expect(pair.attacker).toBeLessThan(6);
      expect(pair.target).toBeGreaterThanOrEqual(0);
      expect(pair.target).toBeLessThan(6);
      expect(pair.target).not.toBe(pair.attacker);
    }
  });

  it("covers every ordered pair uniformly enough (no dead slots)", () => {
    const rng = mulberry32(42);
    const seen = new Set<string>();
    for (let n = 0; n < 2000; n++) {
      const pair = pickSkirmishPair(4, rng)!;
      seen.add(`${pair.attacker}>${pair.target}`);
    }
    // 4 * 3 = 12 ordered pairs; all must appear.
    expect(seen.size).toBe(12);
  });

  it("is deterministic for a seeded rng", () => {
    const a = pickSkirmishPair(6, mulberry32(99));
    const b = pickSkirmishPair(6, mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe("nextShotDelay", () => {
  it("stays inside the scheduler window", () => {
    const rng = mulberry32(3);
    for (let n = 0; n < 200; n++) {
      const d = nextShotDelay(rng);
      expect(d).toBeGreaterThanOrEqual(SHOT_DELAY_MIN);
      expect(d).toBeLessThanOrEqual(SHOT_DELAY_MAX);
    }
  });

  it("honours custom bounds", () => {
    const rng = mulberry32(5);
    for (let n = 0; n < 100; n++) {
      const d = nextShotDelay(rng, 2, 3);
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(3);
    }
  });
});

describe("flightDuration", () => {
  it("scales with distance over speed", () => {
    expect(flightDuration(1000, 500)).toBeCloseTo(2.0);
    expect(flightDuration(0, 500)).toBe(0.18);
  });

  it("clamps pathological inputs", () => {
    expect(flightDuration(100000, 10)).toBe(3.0);
    expect(flightDuration(100, 0)).toBe(0.5);
    expect(flightDuration(100, -5)).toBe(0.5);
  });
});

describe("projectilePosition", () => {
  const start = { x: 0, y: 10, z: 0 };
  const end = { x: 100, y: 20, z: 0 };

  it("hits the endpoints exactly", () => {
    const p0 = projectilePosition(start, end, 0, 50);
    const p1 = projectilePosition(start, end, 1, 50);
    expect(p0.x).toBeCloseTo(0, 10);
    expect(p0.y).toBeCloseTo(10, 10);
    expect(p0.z).toBeCloseTo(0, 10);
    expect(p1.x).toBeCloseTo(100, 10);
    expect(p1.y).toBeCloseTo(20, 10);
    expect(p1.z).toBeCloseTo(0, 10);
  });

  it("lifts by the full arc at mid-flight", () => {
    const mid = projectilePosition(start, end, 0.5, 50);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(15 + 50);
  });

  it("is linear with zero arc", () => {
    const mid = projectilePosition(start, end, 0.25, 0);
    expect(mid).toEqual({ x: 25, y: 12.5, z: 0 });
  });

  it("clamps t outside [0, 1]", () => {
    expect(projectilePosition(start, end, -2, 50)).toEqual(projectilePosition(start, end, 0, 50));
    expect(projectilePosition(start, end, 9, 50)).toEqual(projectilePosition(start, end, 1, 50));
  });
});

describe("weapon profiles", () => {
  it("covers every unit kind with sane values", () => {
    for (const kind of UNIT_KINDS) {
      const p = WEAPON_PROFILES[kind];
      expect(p.speed).toBeGreaterThan(0);
      expect(p.arc).toBeGreaterThanOrEqual(0);
      expect(p.flashTime).toBeGreaterThan(0);
    }
  });

  it("gives artillery the slowest, highest-arcing shot", () => {
    const arcs = UNIT_KINDS.map((k) => WEAPON_PROFILES[k]!.arc);
    expect(WEAPON_PROFILES.hammer!.arc).toBe(Math.max(...arcs));
    expect(WEAPON_PROFILES.hammer!.speed).toBeLessThan(WEAPON_PROFILES.flash!.speed);
  });

  it("keeps perf caps sane", () => {
    expect(MAX_SHOTS).toBeGreaterThan(0);
    expect(MAX_SHOTS).toBeLessThanOrEqual(12);
    expect(MAX_EXPLOSIONS).toBeGreaterThanOrEqual(MAX_SHOTS);
  });

  it("gives every kind a positive muzzle offset", () => {
    for (const kind of UNIT_KINDS) {
      expect(muzzleHeight(kind)).toBeGreaterThan(0);
      expect(muzzleForward(kind)).toBeGreaterThan(0);
    }
  });
});
