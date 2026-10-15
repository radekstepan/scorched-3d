import { describe, expect, it } from "vitest";
import {
  craterDepthAt,
  craterFalloff,
  effectiveBlastDist,
  type Crater,
} from "./destruction.js";
import {
  PREDICT_MAX_STEPS,
  predictDrivenPath,
  type RoutePoint,
} from "./movement.js";
import { treesIntersectSegment, treesOnSegment, type TreeStand } from "./combat.js";

/**
 * Hot-loop sweep guards (task 52): the per-tick fast paths below were
 * optimized for allocation/arithmetic cost, so these tests pin their
 * contracts deterministically — equivalence with the naive reference plus
 * bounded simulation steps. No wall-clock assertions: operation counts and
 * value equality only.
 */

function naiveCraterDepthAt(craters: readonly Crater[], x: number, z: number): number {
  // Reference without the squared-distance rim early-out: every crater pays
  // the sqrt/warp even when far past its rim.
  let total = 0;
  for (const c of craters) {
    if (!(c.radius > 0) || !(c.depth > 0)) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const skew = c.skew ?? 0;
    const t =
      skew > 0
        ? effectiveBlastDist(dx, dz, { sx: c.sx ?? 0, sz: c.sz ?? 0, skew }) / c.radius
        : Math.sqrt(dx * dx + dz * dz) / c.radius;
    const f = craterFalloff(t);
    if (f > 0) total += c.depth * f;
  }
  return Math.min(total, 1.2);
}

describe("craterDepthAt rim early-out", () => {
  const craters: Crater[] = [
    { x: 0, z: 0, radius: 40, depth: 0.6 },
    { x: 500, z: -200, radius: 60, depth: 0.5 },
    { x: -300, z: 400, radius: 50, depth: 0.6, sx: 1, sz: 0, skew: 0.45 },
    { x: 1000, z: 1000, radius: 30, depth: 0.2 },
  ];

  it("matches the naive reference inside, on, and past every rim", () => {
    const probes: [number, number][] = [
      [0, 0],
      [39.999, 0],
      [40, 0],
      [40.001, 0],
      [500, -200],
      [-300, 400],
      [-300 + 50 * 1.45, 400],
      [-300 + 50 * 1.46, 400],
      [2000, 2000],
      [123.456, -789.012],
    ];
    for (const [x, z] of probes) {
      expect(craterDepthAt(craters, x, z)).toBe(naiveCraterDepthAt(craters, x, z));
    }
  });

  it("stays exact on stacked overlapping bowls", () => {
    const stacked: Crater[] = [
      { x: 10, z: 10, radius: 40, depth: 0.6 },
      { x: 10, z: 10, radius: 40, depth: 0.6 },
      { x: 10, z: 10, radius: 40, depth: 0.6 },
    ];
    expect(craterDepthAt(stacked, 10, 10)).toBe(naiveCraterDepthAt(stacked, 10, 10));
    expect(craterDepthAt(stacked, 10 + 40, 10)).toBe(naiveCraterDepthAt(stacked, 10 + 40, 10));
  });
});

describe("treesIntersectSegment boolean probe", () => {
  const stands: TreeStand[] = [
    { x: 0, z: -150, groundY: 0, standing: true },
    { x: 400, z: -150, groundY: 0, standing: true },
    { x: 0, z: 150, groundY: 0, standing: false },
  ];

  it("agrees with treesOnSegment on hits and misses", () => {
    const cases: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }][] = [
      [{ x: 0, y: 60, z: -300 }, { x: 0, y: 10, z: 0 }],
      [{ x: 0, y: 80, z: -300 }, { x: 0, y: 10, z: 0 }],
      [{ x: 500, y: 60, z: -300 }, { x: 500, y: 10, z: 0 }],
      [{ x: 0, y: 60, z: 300 }, { x: 0, y: 10, z: 0 }],
      [{ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }],
    ];
    for (const [a, b] of cases) {
      expect(treesIntersectSegment(a, b, stands)).toBe(treesOnSegment(a, b, stands).length > 0);
    }
    expect(treesIntersectSegment({ x: 0, y: 60, z: -300 }, { x: 0, y: 10, z: 0 }, [])).toBe(false);
  });
});

describe("predictDrivenPath step bound", () => {
  it("never emits more points than maxSteps + 1", () => {
    // A long patrol loop that cannot finish inside a tiny budget.
    const route: RoutePoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: 4000 },
      { x: 4000, z: 4000 },
      { x: 4000, z: 0 },
    ];
    const mover = { x: 0, z: 0, hull: 0, leg: 1 };
    for (const maxSteps of [1, 10, 137]) {
      const path = predictDrivenPath("flash", mover, route, null, 0.25, maxSteps);
      expect(path.length).toBeLessThanOrEqual(Math.floor(maxSteps) + 1);
    }
    // The default budget is the documented cap: a full loop truncates there.
    const full = predictDrivenPath("flash", mover, route, null);
    expect(full.length).toBeLessThanOrEqual(PREDICT_MAX_STEPS + 1);
  });
});
