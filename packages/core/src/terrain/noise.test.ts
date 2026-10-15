import { describe, expect, it } from "vitest";
import {
  clamp,
  fbm,
  hash2,
  lerp,
  mulberry32,
  ridged,
  smoothstep,
  valueNoise,
  warpFbm,
} from "./noise.js";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("pins a known first value", () => {
    expect(mulberry32(1234)()).toBe(0.07329497812315822);
  });

  it("stays in [0, 1) and varies across seeds", () => {
    const rng = mulberry32(99);
    let seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBe(100);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("hash2", () => {
  it("is deterministic and pins a known value", () => {
    expect(hash2(5, -3, 99)).toBe(0.10089634172618389);
    expect(hash2(5, -3, 99)).toBe(hash2(5, -3, 99));
  });

  it("stays in [0, 1) and is sensitive to each input", () => {
    const base = hash2(10, 20, 30);
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(1);
    expect(hash2(11, 20, 30)).not.toBe(base);
    expect(hash2(10, 21, 30)).not.toBe(base);
    expect(hash2(10, 20, 31)).not.toBe(base);
  });
});

describe("lerp / clamp / smoothstep", () => {
  it("lerps between endpoints", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it("clamps to the inclusive range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });

  it("smoothsteps with clamped edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("valueNoise", () => {
  it("pins a known value", () => {
    expect(valueNoise(1.5, 2.25, 7)).toBe(0.5945599601811864);
  });

  it("hits the lattice hash exactly on integer coordinates", () => {
    expect(valueNoise(4, 9, 7)).toBe(hash2(4, 9, 7));
  });

  it("stays in [0, 1] over a grid sweep", () => {
    for (let x = -4; x <= 4; x += 0.5) {
      for (let y = -4; y <= 4; y += 0.5) {
        const v = valueNoise(x, y, 42);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("fbm / ridged / warpFbm", () => {
  it("pins known values", () => {
    expect(fbm(1.5, 2.25, 7)).toBe(0.6377360806862623);
    expect(ridged(1.5, 2.25, 7)).toBe(0.45446265097790217);
    expect(warpFbm(1.5, 2.25, 7)).toBe(0.6702296878717581);
  });

  it("reduces to valueNoise with a single octave", () => {
    expect(fbm(1.5, 2.25, 7, 1)).toBe(valueNoise(1.5, 2.25, 7));
  });

  it("stays in [0, 1] and finite across a sweep", () => {
    for (const fn of [fbm, ridged, warpFbm]) {
      for (let x = -8; x <= 8; x += 2) {
        for (let y = -8; y <= 8; y += 2) {
          const v = fn(x * 0.37, y * 0.53, 1234);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is deterministic per seed", () => {
    expect(fbm(3.1, 4.2, 5)).toBe(fbm(3.1, 4.2, 5));
    expect(ridged(3.1, 4.2, 5)).toBe(ridged(3.1, 4.2, 5));
    expect(warpFbm(3.1, 4.2, 5)).toBe(warpFbm(3.1, 4.2, 5));
  });
});
