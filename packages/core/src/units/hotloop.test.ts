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
  spacingScale,
  type RoutePoint,
} from "./movement.js";
import {
  countTreesOnSegment,
  firingSidestep,
  orbitStrafe,
  treesIntersectSegment,
  treesOnSegment,
  type TreeStand,
} from "./combat.js";
import { HUNT_ENGAGE_RADIUS } from "./retaliation.js";
import {
  acquireStrategicHunt,
  chooseTarget,
  pickStrategicTarget,
  squadFocus,
} from "./strategy.js";
import {
  canSpot,
  canSpotPoint,
  createSpotCache,
  type SightContext,
} from "./visibility.js";

/**
 * Hot-loop sweep guards (task 52, extended by the AI sweep): the per-tick
 * fast paths below were optimized for allocation/arithmetic cost, so these
 * tests pin their contracts deterministically — equivalence with the naive
 * reference plus bounded simulation steps. No wall-clock assertions:
 * operation counts and value equality only.
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

describe("countTreesOnSegment capped counting", () => {
  const stands: TreeStand[] = [
    { x: 0, z: -150, groundY: 0, standing: true },
    { x: 0, z: -50, groundY: 0, standing: true },
    { x: 0, z: 50, groundY: 0, standing: true },
    { x: 400, z: -150, groundY: 0, standing: true },
    { x: 0, z: 150, groundY: 0, standing: false },
  ];
  const segs: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }][] = [
    [{ x: 0, y: 30, z: -300 }, { x: 0, y: 10, z: 300 }],
    [{ x: 0, y: 60, z: -300 }, { x: 0, y: 10, z: 0 }],
    [{ x: 500, y: 60, z: -300 }, { x: 500, y: 10, z: 0 }],
    [{ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }],
  ];

  it("matches the list length exactly with the default limit", () => {
    for (const [a, b] of segs) {
      expect(countTreesOnSegment(a, b, stands)).toBe(treesOnSegment(a, b, stands).length);
    }
    expect(countTreesOnSegment(segs[0]![0], segs[0]![1], [])).toBe(0);
  });

  it("returns exact counts at or under the cap, cap + 1 past it", () => {
    const [a, b] = segs[0]!;
    const total = treesOnSegment(a, b, stands).length;
    expect(total).toBeGreaterThan(2);
    expect(countTreesOnSegment(a, b, stands, total)).toBe(total);
    expect(countTreesOnSegment(a, b, stands, total - 1)).toBe(total);
    expect(countTreesOnSegment(a, b, stands, 1)).toBe(2);
    expect(countTreesOnSegment(a, b, stands, 0)).toBe(1);
  });

  it("treats junk limits as a zero cap", () => {
    const [a, b] = segs[0]!;
    expect(countTreesOnSegment(a, b, stands, -3)).toBe(1);
    expect(countTreesOnSegment(a, b, stands, Number.NaN)).toBe(1);
    const [c, d] = segs[2]!;
    expect(countTreesOnSegment(c, d, stands, -1)).toBe(0);
  });
});

describe("SpotCache memoization", () => {
  const positions = [
    { x: 0, z: 0 },
    { x: 500, z: 0 },
    { x: 0, z: 600 },
  ];
  const stands: TreeStand[] = [{ x: 250, z: 0, groundY: 100, standing: true }];

  function countingSight(extra?: Partial<SightContext>): { sight: SightContext; probes: () => number } {
    let probes = 0;
    const sight: SightContext = {
      groundY: (x: number, z: number) => {
        probes++;
        return 100 + 0.001 * (x + z);
      },
      trees: stands,
      eyeY: [112, 115, 112],
      kinds: ["flash", "stump", "flash"],
      cache: createSpotCache(),
      ...extra,
    };
    return { sight, probes: () => probes };
  }

  it("replays repeat pair asks without re-probing the surface", () => {
    const { sight, probes } = countingSight();
    const first = canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, sight);
    const afterFirst = probes();
    expect(afterFirst).toBeGreaterThan(0);
    for (let k = 0; k < 5; k++) {
      expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, sight)).toBe(first);
    }
    expect(probes()).toBe(afterFirst);
    // The reverse direction is its own verdict, then replays too.
    const back = canSpot(1, 0, positions, HUNT_ENGAGE_RADIUS, sight);
    const afterBack = probes();
    expect(afterBack).toBeGreaterThan(afterFirst);
    expect(canSpot(1, 0, positions, HUNT_ENGAGE_RADIUS, sight)).toBe(back);
    expect(probes()).toBe(afterBack);
  });

  it("recomputes on a different gate, moved endpoints, or new eye heights", () => {
    const { sight, probes } = countingSight();
    const first = canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, sight);
    const base = probes();
    // A different notice gate is a different question.
    expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS + 400, sight)).toBe(first);
    expect(probes()).toBeGreaterThan(base);
    const afterGate = probes();
    expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS + 400, sight)).toBe(first);
    expect(probes()).toBe(afterGate);
    // Moved endpoints never read the old verdict.
    const moved = [...positions];
    moved[1] = { x: 520, z: 10 };
    canSpot(0, 1, moved, HUNT_ENGAGE_RADIUS, sight);
    expect(probes()).toBeGreaterThan(afterGate);
  });

  it("drops entries when the surface or the tree snapshot swaps", () => {
    const shared = countingSight();
    const first = canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, shared.sight);
    const base = shared.probes();
    expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, shared.sight)).toBe(first);
    expect(shared.probes()).toBe(base);
    const reswapped: SightContext = {
      ...shared.sight,
      trees: [...stands, { x: 260, z: 5, groundY: 100, standing: true }],
    };
    canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, reswapped);
    expect(shared.probes()).toBeGreaterThan(base);
  });

  it("replays repeat fort asks without re-marching", () => {
    const { sight, probes } = countingSight();
    const first = canSpotPoint(0, positions, 900, 100, 118, HUNT_ENGAGE_RADIUS, sight);
    const afterFirst = probes();
    expect(afterFirst).toBeGreaterThan(0);
    for (let k = 0; k < 5; k++) {
      expect(canSpotPoint(0, positions, 900, 100, 118, HUNT_ENGAGE_RADIUS, sight)).toBe(first);
    }
    expect(probes()).toBe(afterFirst);
    // A second fort is its own entry; both replay.
    const second = canSpotPoint(0, positions, -800, -50, 118, HUNT_ENGAGE_RADIUS, sight);
    const afterSecond = probes();
    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(canSpotPoint(0, positions, 900, 100, 118, HUNT_ENGAGE_RADIUS, sight)).toBe(first);
    expect(canSpotPoint(0, positions, -800, -50, 118, HUNT_ENGAGE_RADIUS, sight)).toBe(second);
    expect(probes()).toBe(afterSecond);
  });

  it("matches the cache-less verdicts pair for pair", () => {
    const cached = countingSight();
    const plain: SightContext = { ...cached.sight, cache: null };
    const spots: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ];
    for (const [s, f] of spots) {
      expect(canSpot(s, f, positions, HUNT_ENGAGE_RADIUS, cached.sight)).toBe(
        canSpot(s, f, positions, HUNT_ENGAGE_RADIUS, plain),
      );
    }
    const forts: [number, number][] = [[900, 100], [-800, -50], [250, 0]];
    for (const [tx, tz] of forts) {
      expect(canSpotPoint(0, positions, tx, tz, 118, HUNT_ENGAGE_RADIUS, cached.sight)).toBe(
        canSpotPoint(0, positions, tx, tz, 118, HUNT_ENGAGE_RADIUS, plain),
      );
    }
  });
});

describe("acquireStrategicHunt precomputed focus", () => {
  const foes = [
    { x: 0, z: 0 },
    { x: 300, z: 0 },
    { x: 600, z: 0 },
    { x: 900, z: 0 },
  ];
  const teams = [0, 0, 1, 1];
  const alive = [true, true, true, true];
  const anchor = { x: 0, z: 0 };

  it("acquires identically with a precomputed or a scanned focus", () => {
    const threatSets = [
      [undefined, undefined, undefined, undefined],
      [{ attacker: 2, x: 600, z: 0, ttl: 9 }, undefined, undefined, undefined],
      [
        { attacker: 2, x: 600, z: 0, ttl: 9 },
        { attacker: 2, x: 600, z: 0, ttl: 9 },
        undefined,
        undefined,
      ],
      [
        { attacker: 2, x: 600, z: 0, ttl: 9 },
        { attacker: 3, x: 900, z: 0, ttl: 9 },
        undefined,
        undefined,
      ],
    ] as const;
    for (const threats of threatSets) {
      const focus = squadFocus(0, [...threats], teams, alive);
      const mover = { x: 0, z: 0, hull: 0, leg: 1, threat: undefined };
      const scanned = acquireStrategicHunt(mover, 0, teams, foes, alive, anchor, [...threats]);
      const known = acquireStrategicHunt(mover, 0, teams, foes, alive, anchor, [...threats], undefined, undefined, undefined, focus);
      expect(known).toEqual(scanned);
    }
  });

  it("recomputes when the hint is missing or junk", () => {
    const threats = [{ attacker: 2, x: 600, z: 0, ttl: 9 }, undefined, undefined, undefined] as const;
    const mover = { x: 0, z: 0, hull: 0, leg: 1, threat: undefined };
    const expected = acquireStrategicHunt(mover, 0, teams, foes, alive, anchor, [...threats]);
    for (const hint of [undefined, null, Number.NaN, 1.5, -2]) {
      const got = acquireStrategicHunt(mover, 0, teams, foes, alive, anchor, [...threats], undefined, undefined, undefined, hint);
      expect(got).toEqual(expected);
    }
  });
});

describe("pickStrategicTarget focus tally", () => {
  const positions = [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 800, z: 0 },
  ];
  const teams = [0, 1, 1];
  const alive = [true, true, true];

  it("reads any iterable of pending aims like the old array", () => {
    const pending = [1, 1, 2, 1, 2];
    const fromArray = pickStrategicTarget(0, positions, teams, alive, { focusCounts: pending });
    function* gen(): Generator<number> {
      yield* pending;
    }
    expect(pickStrategicTarget(0, positions, teams, alive, { focusCounts: gen() })).toBe(fromArray);
    expect(
      pickStrategicTarget(0, positions, teams, alive, { focusCounts: new Map([[7, 1], [8, 1], [9, 2], [10, 1], [11, 2]]).values() }),
    ).toBe(fromArray);
  });

  it("piles onto the tallied focus instead of splitting shots", () => {
    const hp = [1, 0.9, 0.9];
    const split = pickStrategicTarget(0, positions, teams, alive, { hp, focusCounts: [] });
    const focused = pickStrategicTarget(0, positions, teams, alive, { hp, focusCounts: [2, 2, 2] });
    expect(split).toBe(1);
    expect(focused).toBe(2);
  });
});

describe("firingSidestep open-lane hold", () => {
  const self = { x: 0, y: 30, z: 0 };
  const target = { x: 400, y: 30, z: 0 };

  it("holds on an open unshared lane without scanning candidates", () => {
    expect(firingSidestep(self, target, [])).toBeNull();
    expect(firingSidestep(self, target, [], { allies: [] })).toBeNull();
  });

  it("still flanks a stacked open lane and still shuffles out of wood", () => {
    // An ally on the same target pulls the step to the far side even with
    // zero wood anywhere: the flank is the improvement.
    const flank = firingSidestep(self, target, [], { allies: [{ x: 0, z: 100 }] });
    expect(flank).not.toBeNull();
    // Wood on the seat still earns a sidestep with no allies at all.
    const tree: TreeStand = { x: 0, z: 0, groundY: 0, standing: true };
    expect(firingSidestep(self, target, [tree])).not.toBeNull();
  });
});

describe("orbitStrafe capped lanes", () => {
  const self = { x: 0, y: 30, z: 0 };
  const target = { x: 400, y: 30, z: 0 };

  it("mirrors around blocked ground and never worsens the lane", () => {
    const wood: TreeStand[] = [
      { x: 200, z: 0, groundY: 8, standing: true },
      { x: 200, z: 40, groundY: 8, standing: true },
    ];
    // Preferred side blocked: the mirror answers instead of holding.
    const mirrored = orbitStrafe(self, target, wood, {
      selfIndex: 0,
      targetIndex: 0,
      blocked: (_x: number, z: number) => z > 0,
    });
    expect(mirrored).not.toBeNull();
    expect(mirrored!.z).toBeLessThan(0);
    // Both sides blocked: hold, exactly like the uncapped scan.
    expect(orbitStrafe(self, target, wood, { blocked: () => true })).toBeNull();
  });
});

describe("squared-gate edges", () => {
  it("keeps the zero-leash coincident admit in chooseTarget", () => {
    const positions = [
      { x: 100, z: 100 },
      { x: 100, z: 100 },
      { x: 500, z: 100 },
    ];
    const teams = [0, 1, 1];
    const alive = [true, true, true];
    // A foe standing exactly on the anchor is admitted by a zero leash;
    // anything off it is refused.
    expect(
      chooseTarget(0, positions, teams, alive, { anchor: { x: 100, z: 100 }, leash: 0 }),
    ).toBe(1);
    expect(
      chooseTarget(0, positions, teams, alive, { anchor: { x: 0, z: 0 }, leash: 0 }),
    ).toBe(-1);
    expect(
      chooseTarget(0, positions, teams, alive, { anchor: { x: 100, z: 100 }, leash: -5 }),
    ).toBe(-1);
  });

  it("gates nothing on non-positive spacing radii", () => {
    const positions = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ];
    expect(spacingScale(0, positions, 0, 0)).toBe(1);
    expect(spacingScale(0, positions, -10, -10)).toBe(1);
    expect(spacingScale(0, positions, Number.NaN, Number.NaN)).toBe(1);
    // Positive radii still stop and slow exactly as before.
    expect(spacingScale(0, positions, 30, 72)).toBe(0);
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 50, z: 0 }], 30, 72)).toBe(0.5);
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 500, z: 0 }], 30, 72)).toBe(1);
  });
});
