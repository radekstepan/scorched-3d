import { describe, expect, it } from "vitest";
import { CELL_PIXELS } from "../terrain/types.js";
import { generateMap } from "../terrain/generate.js";
import { HULL_TURN_RATE } from "./facing.js";
import {
  advanceMover,
  advanceMovers,
  ARRIVE_RADIUS,
  BLOCKED_SKIP_AFTER,
  cellFromWorld,
  hasOrder,
  initMover,
  MOVE_SPEED,
  orderMover,
  planRoutes,
  predictDrivenPath,
  ROUTE_WAYPOINTS,
  sampleGround,
  separationVector,
  SEPARATION_RADIUS,
  SEPARATION_SIDESTEP,
  SLOW_SCALE,
  spacingScale,
  STOP_RADIUS,
  stunMover,
  worldFromCell,
  type CrushContext,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import { addScorchMark, createDamageField, type DamageField } from "./destruction.js";
import { STUN_MAX_DURATION } from "./impact.js";
import { findWorldPath, isWalkable } from "./pathfinding.js";
import type { SeatField } from "./terrain.js";
import { CRUSH_DRAG, TREE_DRAG, trunkBlockedAt } from "./terrain.js";
import { UNIT_KINDS } from "./types.js";

const PRESETS = ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"] as const;
const SEEDS = [1, 7, 0xa11ce, 123456];

function flatRoute(len = 400): RoutePoint[] {
  return [
    { x: 0, z: 0 },
    { x: 0, z: len },
    { x: len, z: len },
    { x: len, z: 0 },
  ];
}

describe("planRoutes", () => {
  it("plans one looping route per unit, deterministically per seed", () => {
    for (const preset of PRESETS) {
      const map = generateMap(preset, 42);
      const a = planRoutes(map, map.units, 42);
      const b = planRoutes(map, map.units, 42);
      expect(a).toEqual(b);
      expect(a).toHaveLength(map.units.length);
      for (const route of a) expect(route).toHaveLength(ROUTE_WAYPOINTS);
    }
  });

  it("anchors waypoint 0 at the unit spawn", () => {
    const map = generateMap("greenreach", 9);
    const routes = planRoutes(map, map.units, 9);
    map.units.forEach((u, i) => {
      const spawn = worldFromCell(map, u.cellX, u.cellZ);
      expect(routes[i]![0]!.x).toBeCloseTo(spawn.x);
      expect(routes[i]![0]!.z).toBeCloseTo(spawn.z);
    });
  });

  it("keeps every waypoint on dry, gentle, in-bounds ground", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        const routes = planRoutes(map, map.units, seed);
        for (const route of routes) {
          for (const wp of route) {
            const { cellX, cellZ } = cellFromWorld(map, wp.x, wp.z);
            expect(cellX).toBeGreaterThanOrEqual(0);
            expect(cellX).toBeLessThan(map.width);
            expect(map.heights[cellZ * map.width + cellX]).toBeGreaterThan(map.seaLevel + 4);
            const h00 = map.heights[cellZ * map.width + cellX] ?? 0;
            const h10 = map.heights[cellZ * map.width + Math.min(map.width - 1, cellX + 1)] ?? 0;
            const h01 = map.heights[Math.min(map.height - 1, cellZ + 1) * map.width + cellX] ?? 0;
            expect(Math.max(h00, h10, h01) - Math.min(h00, h10, h01)).toBeLessThanOrEqual(15);
          }
        }
      }
    }
  });

  it("spreads waypoints so patrols actually travel", () => {
    const map = generateMap("greenreach", 7);
    const routes = planRoutes(map, map.units, 7);
    for (const route of routes) {
      const span = Math.max(
        ...route.map((wp) => Math.hypot(wp.x - route[0]!.x, wp.z - route[0]!.z)),
      );
      // Waypoints sit ≥12 cells apart, so non-degenerate loops span cells.
      expect(span).toBeGreaterThan(12 * 16 - ARRIVE_RADIUS);
    }
  });

  it("varies routes per seed without touching unit placement", () => {
    const map = generateMap("greenreach", 1);
    const a = JSON.stringify(planRoutes(map, map.units, 11));
    const b = JSON.stringify(planRoutes(map, map.units, 22));
    expect(a).not.toBe(b);
    // Same unit roster either way: routes read the field, never reseed it.
    expect(map.units).toEqual(generateMap("greenreach", 1).units);
  });
});

describe("advanceMover", () => {
  it("drives forward along the hull at per-kind speed when lined up", () => {
    // Hull 0 faces +Z; target straight ahead at +Z.
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
      const next = advanceMover(kind, mover, flatRoute(), 1);
      expect(next.x).toBeCloseTo(0, 6);
      expect(next.z).toBeCloseTo(MOVE_SPEED[kind], 6);
      expect(next.hull).toBeCloseTo(0, 10);
    }
    // Fast scouts outrun slow guns.
    expect(MOVE_SPEED.flash).toBeGreaterThan(MOVE_SPEED.stump);
    expect(MOVE_SPEED.stump).toBeGreaterThan(MOVE_SPEED.commander);
    expect(MOVE_SPEED.commander).toBeGreaterThan(MOVE_SPEED.hammer);
  });

  it("never snaps the hull: one step respects the turn-rate cap", () => {
    // Dead-astern target: desired yaw PI away from hull 0.
    for (const kind of UNIT_KINDS) {
      const mover: Mover = { x: 0, z: 400, hull: 0, leg: 0 };
      const route: RoutePoint[] = [
        { x: 0, z: 400 },
        { x: 0, z: -400 },
      ];
      const dt = 0.05;
      const next = advanceMover(kind, mover, route, dt);
      expect(Math.abs(next.hull - mover.hull)).toBeLessThanOrEqual(
        (HULL_TURN_RATE[kind] ?? 2) * dt + 1e-9,
      );
      // Velocity stays along the hull (forward), never sideways to the goal.
      const stepX = next.x - mover.x;
      const stepZ = next.z - mover.z;
      const travel = Math.atan2(stepX, stepZ);
      expect(Math.abs(travel - next.hull)).toBeLessThan(1e-6);
    }
  });

  it("slows in turns (alignment grip) instead of cornering at full speed", () => {
    const straight: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const turning: Mover = { x: 0, z: 400, hull: 0, leg: 0 };
    const route: RoutePoint[] = [
      { x: 0, z: 400 },
      { x: 0, z: -400 },
    ];
    const dt = 0.05;
    const fast = advanceMover("flash", straight, flatRoute(), dt);
    const slow = advanceMover("flash", turning, route, dt);
    const fastStep = Math.hypot(fast.x - straight.x, fast.z - straight.z);
    const slowStep = Math.hypot(slow.x - turning.x, slow.z - turning.z);
    expect(slowStep).toBeLessThan(fastStep * 0.6);
  });

  it("rotates to the next patrol waypoint on arrival, looping forever", () => {
    const route = flatRoute();
    let mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const seen = new Set<number>();
    // Walk the whole loop twice: every leg index must be steered toward.
    for (let n = 0; n < 4000; n++) {
      seen.add(mover.leg);
      mover = advanceMover("flash", mover, route, 0.05);
      if (seen.size === route.length) break;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("holds degenerate routes and non-positive dt without moving", () => {
    const mover: Mover = { x: 5, z: 5, hull: 1, leg: 0 };
    expect(advanceMover("stump", mover, [{ x: 5, z: 5 }], 0.05)).toEqual(mover);
    expect(advanceMover("stump", mover, flatRoute(), 0)).toEqual(mover);
    expect(advanceMover("stump", mover, flatRoute(), -1)).toEqual(mover);
  });
});

describe("hit-stun hesitation", () => {
  it("stuns by dealt damage and leaves misses untouched", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    // A miss returns the move untouched (no stun key appears).
    expect(stunMover(mover, 0)).toEqual(mover);
    expect(stunMover(mover, -0.2)).toEqual(mover);
    // A flash point-blank chip hesitates ~0.3 s; a hammer point-blank hit
    // lands the max beat.
    expect(stunMover(mover, 0.06).stun).toBeCloseTo(0.3, 12);
    expect(stunMover(mover, 0.16).stun).toBe(STUN_MAX_DURATION);
  });

  it("refreshes re-hits under the cap instead of parking the hull", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1, stun: 0.2 };
    // A fading chip refreshed by a heavy lands the heavy's beat...
    expect(stunMover(mover, 0.16).stun).toBe(STUN_MAX_DURATION);
    // ...while a chip landing mid-heavy never shortens the clock.
    expect(stunMover({ ...mover, stun: STUN_MAX_DURATION }, 0.001).stun).toBe(
      STUN_MAX_DURATION,
    );
  });

  it("holds the drive while stunned, still turns, then resumes exactly", () => {
    const route = flatRoute();
    // Hull spun halfway around: it must turn back toward the leg, not drive.
    let mover: Mover = { x: 0, z: 0, hull: Math.PI, leg: 1, stun: 0.5 };
    const dt = 0.05;
    const turned = advanceMover("flash", mover, route, dt);
    expect(turned.x).toBe(0);
    expect(turned.z).toBe(0);
    expect(Math.abs(turned.hull - Math.PI)).toBeLessThan(Math.PI);
    expect(turned.hull).not.toBeCloseTo(Math.PI, 6);
    expect(turned.stun).toBeCloseTo(0.45, 12);
    expect(turned.leg).toBe(1);
    // Run out the clock: the key drops (not zero — absent, like `stuck`)
    // and the hull drives again.
    mover = turned;
    let ticks = 0;
    while (mover.stun !== undefined && ticks < 20) {
      mover = advanceMover("flash", mover, route, dt);
      ticks++;
    }
    expect(mover.stun).toBeUndefined();
    expect(ticks).toBeLessThanOrEqual(11);
    const parked = { x: mover.x, z: mover.z };
    mover = advanceMover("flash", mover, route, dt);
    expect(Math.hypot(mover.x - parked.x, mover.z - parked.z)).toBeGreaterThan(0);
  });

  it("freezes the order cursor while stunned (no waypoint skipping)", () => {
    let mover: Mover = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [
      { x: 0, z: 400 },
      { x: 400, z: 400 },
    ]);
    mover = stunMover(mover, 0.16);
    const at = mover.order!.at;
    const stepped = advanceMover("flash", mover, [], 0.05);
    expect(stepped.order!.at).toBe(at);
    expect(stepped.x).toBe(0);
    expect(stepped.z).toBe(0);
    expect(hasOrder(stepped)).toBe(true);
  });

  it("keeps a non-positive dt a pure no-op on stunned hulls", () => {
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1, stun: 0.5 };
    expect(advanceMover("flash", mover, flatRoute(), 0)).toBe(mover);
    expect(advanceMover("flash", mover, flatRoute(), -1)).toBe(mover);
  });

  it("still separates stunned hulls (the crowd jostles, drive stays held)", () => {
    const kinds = ["flash", "flash"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600)];
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1, stun: 0.8 },
      { x: 0, z: 20, hull: 0, leg: 1 },
    ];
    const next = advanceMovers([...kinds], movers, routes, 0.05);
    // The pair opened past its 20-unit hold even though hull 0 never drove.
    const gap = Math.hypot(next[0]!.x - next[1]!.x, next[0]!.z - next[1]!.z);
    expect(gap).toBeGreaterThan(20);
    // And the stun clock still ticked down through the shove.
    expect(next[0]!.stun).toBeCloseTo(0.75, 12);
  });
});

describe("spacingScale", () => {
  const line = [
    { x: 0, z: 0 },
    { x: 500, z: 0 },
  ];

  it("stops inside stop radius so units never stack", () => {
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 10, z: 0 }])).toBe(0);
  });

  it("crawls inside slow radius and runs free beyond it", () => {
    expect(spacingScale(0, line)).toBe(1);
    expect(spacingScale(0, [{ x: 0, z: 0 }, { x: 50, z: 0 }])).toBe(SLOW_SCALE);
  });

  it("ignores the unit itself", () => {
    expect(spacingScale(0, [{ x: 0, z: 0 }])).toBe(1);
    expect(spacingScale(5, [{ x: 0, z: 0 }])).toBe(1);
  });
});

describe("advanceMovers", () => {
  it("separates stopped pairs instead of pinning them forever", () => {
    const kinds = ["flash", "stump", "hammer"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600), flatRoute(900)];
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1 },
      // Second unit parked right ahead, inside the mutual spacing stop: the
      // old drive-only rule held both at scale 0 forever. Separation must
      // open the gap even though forward drive still refuses to close it.
      { x: 0, z: 20, hull: 0, leg: 1 },
      // Third unit far from the pair: free to patrol.
      { x: 900, z: 900, hull: Math.PI, leg: 3 },
    ];
    const before = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    const next = advanceMovers([...kinds], movers, routes, 0.05);
    expect(next).toHaveLength(3);
    const after = Math.hypot(next[0]!.x - next[1]!.x, next[0]!.z - next[1]!.z);
    expect(after).toBeGreaterThan(before);
    // The pair opens radially (head-on on the Z line) while counter-stepping
    // sideways to open a passing lane — never mirrored, never purely axial.
    expect(next[0]!.z).toBeLessThan(0);
    expect(next[1]!.z).toBeGreaterThan(20);
    expect(next[0]!.x).toBeGreaterThan(0);
    expect(next[1]!.x).toBeLessThan(0);
    const travelled = Math.hypot(next[2]!.x - 900, next[2]!.z - 900);
    expect(travelled).toBeGreaterThan(0);
  });

  it("keeps degenerate dt a pure no-op (no separation shove)", () => {
    const kinds = ["flash", "stump"] as const;
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1 },
      { x: 0, z: 5, hull: 0, leg: 1 },
    ];
    const routes: RoutePoint[][] = [flatRoute(), flatRoute()];
    expect(advanceMovers([...kinds], movers, routes, 0)).toEqual(movers);
    expect(advanceMovers([...kinds], movers, routes, -1)).toEqual(movers);
  });
});

describe("world/cell helpers", () => {
  it("round-trips world and cell coordinates", () => {
    const map = generateMap("greenreach", 3);
    for (const u of map.units) {
      const w = worldFromCell(map, u.cellX, u.cellZ);
      expect(cellFromWorld(map, w.x, w.z)).toEqual({ cellX: u.cellX, cellZ: u.cellZ });
      expect(sampleGround(map, w.x, w.z)).toBe(map.heights[u.cellZ * map.width + u.cellX]);
    }
  });

  it("seeds movers at the spawn waypoint steering at leg 1", () => {
    const route = flatRoute();
    const m = initMover(route, 1.2);
    expect(m.x).toBe(route[0]!.x);
    expect(m.z).toBe(route[0]!.z);
    expect(m.hull).toBe(1.2);
    expect(m.leg).toBe(1);
  });
});

describe("separationVector", () => {
  it("pushes nothing when alone or beyond the radius", () => {
    expect(separationVector(0, [{ x: 0, z: 0 }])).toEqual({ x: 0, z: 0 });
    expect(separationVector(0, [{ x: 0, z: 0 }, { x: 500, z: 0 }])).toEqual({ x: 0, z: 0 });
    expect(separationVector(0, [{ x: 0, z: 0 }, { x: SEPARATION_RADIUS, z: 0 }])).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("pushes along the pair axis with a sidestep, mirrored pair-wise", () => {
    // Neighbour 10 west of self: unit radial shove +x plus the sidestep
    // (perp of the away axis), at SEPARATION_SIDESTEP weight.
    const push = separationVector(0, [
      { x: 0, z: 0 },
      { x: -10, z: 0 },
    ]);
    expect(push.x).toBeCloseTo(1, 9);
    expect(push.z).toBeCloseTo(SEPARATION_SIDESTEP, 9);
    // The neighbour sees the exact negation: symmetric, deterministic, so
    // the pair counter-steps instead of mirroring into a backup loop.
    const mirror = separationVector(1, [
      { x: 0, z: 0 },
      { x: -10, z: 0 },
    ]);
    expect(mirror.x).toBeCloseTo(-push.x, 9);
    expect(mirror.z).toBeCloseTo(-push.z, 9);
  });

  it("splits coincident hulls along deterministic headings", () => {
    const pair = [
      { x: 7, z: -3 },
      { x: 7, z: -3 },
    ];
    const a = separationVector(0, pair);
    const b = separationVector(1, pair);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(1, 9);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(1, 9);
    // Repeatable: same indices, same headings.
    expect(separationVector(0, pair)).toEqual(a);
    expect(separationVector(1, pair)).toEqual(b);
  });
});

/** Flat, dry, gentle field: every cell walkable, so only spacing matters. */
function openField(): SeatField {
  const w = 64;
  const h = 64;
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0 };
}

describe("adjacent-unit deadlock", () => {
  it("drives two adjacent ordered units to their goals (no permanent hold)", () => {
    const field = openField();
    const kinds = ["flash", "flash"] as const;
    let movers: Mover[] = [
      { x: -10, z: 0, hull: 0, leg: 0 },
      { x: 10, z: 0, hull: 0, leg: 0 },
    ];
    // Side-by-side pair ordered due north on parallel lanes: the old
    // drive-only rule read spacing 0 both ways and parked them forever.
    movers = [
      orderMover(movers[0]!, [{ x: -10, z: 400 }]),
      orderMover(movers[1]!, [{ x: 10, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    // Lanes 20 apart keep the pair inside each other's slow zone most of
    // the trip, so this needs a long horizon: what matters is continuous
    // progress to arrival, never a permanent hold.
    for (let n = 0; n < 2400; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    // Both arrived instead of grinding inside the stop radius.
    expect(hasOrder(movers[0]!)).toBe(false);
    expect(hasOrder(movers[1]!)).toBe(false);
    expect(movers[0]!.z).toBeGreaterThan(400 - ARRIVE_RADIUS);
    expect(movers[1]!.z).toBeGreaterThan(400 - ARRIVE_RADIUS);
  });

  it("opens coincident patrol hulls past the stop radius", () => {
    const field = openField();
    const kinds = ["stump", "stump"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600)];
    let movers: Mover[] = [
      { x: 50, z: 50, hull: 0, leg: 1 },
      { x: 50, z: 50, hull: Math.PI, leg: 1 },
    ];
    const dt = 1 / 60;
    for (let n = 0; n < 300; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    const gap = Math.hypot(movers[0]!.x - movers[1]!.x, movers[0]!.z - movers[1]!.z);
    expect(gap).toBeGreaterThan(STOP_RADIUS * 0.8);
  });

  it("lets units parked inside scorch (brown-hole) cells drive out", () => {
    // Scorch marks are renderer decals: recording one must not mutate the
    // heightfield or walkability, so "stuck in a brown hole" can only ever
    // be the spacing deadlock above, never the scorch itself.
    const field = openField();
    const before = field.heights.slice();
    const marks = addScorchMark([], { x: 0, z: 0, radius: 46, intensity: 0.8 });
    expect(marks).toHaveLength(1);
    expect(field.heights).toEqual(before);
    const mark = marks[0]!;
    for (const [x, z] of [[-10, 0], [10, 0], [0, 0]] as const) {
      const { cellX, cellZ } = cellFromWorld(field, x, z);
      expect(Math.hypot(x - mark.x, z - mark.z)).toBeLessThan(mark.radius);
      expect(isWalkable(field, cellX, cellZ)).toBe(true);
    }
    const kinds = ["commander", "hammer"] as const;
    let movers: Mover[] = [
      orderMover({ x: -10, z: 0, hull: 0, leg: 0 }, [{ x: -30, z: 400 }]),
      orderMover({ x: 10, z: 0, hull: 0, leg: 0 }, [{ x: 30, z: 400 }]),
    ];
    const routes: RoutePoint[][] = [[], []];
    const dt = 1 / 60;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers([...kinds], movers, routes, dt, field);
    }
    for (const m of movers) {
      expect(hasOrder(m)).toBe(false);
      expect(Math.hypot(m.x - mark.x, m.z - mark.z)).toBeGreaterThan(mark.radius);
    }
  });
});

/** Synthetic field: flat 100 plateau, steep 40/cell ramp wall east of x=16. */
function walledField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(100);
  for (let z = 0; z < h; z++) {
    for (let x = 17; x < w; x++) heights[z * w + x] = 100 + (x - 16) * 40;
  }
  return { width: w, height: h, heights, seaLevel: 0 };
}

/** Flat dry field with a tree belt across the middle rows. */
function woodedField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h).fill(100);
  const features = new Uint16Array(w * h).fill(0xffff);
  for (let z = 8; z <= 15; z++) {
    for (let x = 5; x < w - 5; x++) features[z * w + x] = 0;
  }
  return { width: w, height: h, heights, seaLevel: 0, features };
}

/** Gentle eastward ramp (4 raw per cell): walkable, but dragging. */
function rampField(): SeatField {
  const w = 40;
  const h = 24;
  const heights = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) heights[z * w + x] = 60 + x * 4;
  }
  return { width: w, height: h, heights, seaLevel: 0 };
}

function worldX(field: SeatField, cellX: number): number {
  return (cellX - (field.width - 1) / 2) * CELL_PIXELS;
}

describe("steep-slope clamp", () => {
  it("holds position (turning in place) instead of climbing a wall", () => {
    const field = walledField();
    const z = 0;
    // Ordered due east into the wall: hull faces the target, X/Z pin.
    let mover: Mover = { x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, [{ x: worldX(field, 35), z }]);
    const pinned = { x: mover.x, z: mover.z };
    for (let n = 0; n < 300; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
    }
    // Never entered the wall: still west of it, order still live.
    expect(mover.x).toBeLessThan(worldX(field, 16));
    expect(mover.z).toBeCloseTo(pinned.z, 9);
    expect(hasOrder(mover)).toBe(true);
    // Hull kept turning toward the target instead of freezing.
    expect(mover.hull).toBeCloseTo(Math.PI / 2, 6);
    // Same order without terrain knowledge drives straight through.
    let free: Mover = { x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 };
    free = orderMover(free, [{ x: worldX(field, 35), z }]);
    for (let n = 0; n < 300; n++) {
      free = advanceMover("flash", free, [], 1 / 60);
    }
    expect(free.x).toBeGreaterThan(worldX(field, 16));
  });

  it("lets patrol skip a leg pinned against steep ground", () => {
    const field = walledField();
    const z = 0;
    // Patrol leg straight into the wall from nearby walkable ground.
    const route: RoutePoint[] = [
      { x: worldX(field, 14), z },
      { x: worldX(field, 35), z },
    ];
    let mover: Mover = { x: worldX(field, 14), z, hull: Math.PI / 2, leg: 1 };
    const dt = 1 / 60;
    const ticks = Math.ceil(BLOCKED_SKIP_AFTER / dt) + 300;
    let skipped = false;
    for (let n = 0; n < ticks; n++) {
      mover = advanceMover("stump", mover, route, dt, 1, field);
      // The hull never clips into the wall while pinned or skipping.
      const { cellX } = cellFromWorld(field, mover.x, mover.z);
      expect(cellX).toBeLessThan(16);
      if (mover.leg === 0) skipped = true;
    }
    expect(skipped).toBe(true);
  });

  it("keeps patrols on walkable ground on a real map", () => {
    // Real-map case (not synthetic flat): patrol legs cut straight across
    // whatever the waypoints straddle, so the clamp + skip must hold on
    // generated terrain with real slopes and shorelines.
    const map = generateMap("greenreach", 7);
    const routes = planRoutes(map, map.units, 7);
    const kinds = map.units.map((u) => u.kind);
    // Seed on filtered (walkable) waypoints, steering at the next leg.
    let movers: Mover[] = routes.map((route) => {
      const wp = route[1] ?? route[0]!;
      expect(
        isWalkable(map, cellFromWorld(map, wp.x, wp.z).cellX, cellFromWorld(map, wp.x, wp.z).cellZ),
      ).toBe(true);
      return { x: wp.x, z: wp.z, hull: 0, leg: 2 % route.length };
    });
    const start = movers.map((m) => ({ ...m }));
    const dt = 1 / 60;
    for (let n = 0; n < 3600; n++) {
      movers = advanceMovers(kinds, movers, routes, dt, map);
      for (const m of movers) {
        const { cellX, cellZ } = cellFromWorld(map, m.x, m.z);
        expect(isWalkable(map, cellX, cellZ)).toBe(true);
      }
    }
    // The column actually travelled instead of grinding in place.
    const travel = movers.reduce(
      (sum, m, i) => sum + Math.hypot(m.x - start[i]!.x, m.z - start[i]!.z),
      0,
    );
    expect(travel).toBeGreaterThan(0);
  });
});

describe("rough-terrain drag", () => {
  it("matches terrain-less speed on flat open ground, bit for bit", () => {
    const field = openField();
    const mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    const route = flatRoute();
    const dt = 0.05;
    const free = advanceMover("flash", mover, route, dt);
    const seated = advanceMover("flash", mover, route, dt, 1, field);
    expect(seated.x).toBe(free.x);
    expect(seated.z).toBe(free.z);
    expect(seated.hull).toBe(free.hull);
  });

  it("climbs grades slower than the flat, steeper slower still", () => {
    const z = 0;
    const drive = (field: SeatField, ticks: number): number => {
      const startX = worldX(field, 5);
      let mover: Mover = { x: startX, z, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(field, 30), z }]);
      for (let n = 0; n < ticks; n++) {
        mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
      }
      return mover.x - startX;
    };
    const ticks = 200;
    const flat = drive(openField(), ticks);
    const gentle = drive(rampField(), ticks);
    expect(gentle).toBeLessThan(flat);
    // Deterministic: the same drag replays exactly.
    expect(drive(rampField(), ticks)).toBe(gentle);
  });

  it("pushes around single trees slower, but still arrives", () => {
    // One isolated trunk on the lane: the order routes around it instead of
    // through it, arriving without ever entering the keepout.
    const w = 40;
    const h = 24;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    features[11 * w + 18] = 0;
    const field: SeatField = { width: w, height: h, heights, seaLevel: 0, features };
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    const from = { x: worldX(field, 10), z };
    const to = { x: worldX(field, 26), z };
    const path = findWorldPath(field, from, to);
    let mover: Mover = { x: from.x, z: from.z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, path);
    for (let n = 0; n < 3600; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field);
      expect(trunkBlockedAt(field, mover.x, mover.z, "flash")).toBe(false);
    }
    expect(hasOrder(mover)).toBe(false);
  });

  it("crushes through the tree belt slowly, felling trees, and arrives", () => {
    // A solid tree belt is no longer a wall of keepouts: a straight order
    // into it crushes a lane through the wood at a crawl instead of holding
    // at the first trunk line. Pathfound orders still route around when they
    // can (see below); the crush is for lanes that must go through.
    const field = woodedField();
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    // Crush points: the lane row (z=11) in fid order. Adjacent rows still
    // slow the hull through canopy proximity, but only lane trees fall.
    const rowTrees: { x: number; z: number }[] = [];
    for (let x = 5; x < field.width - 5; x++) rowTrees.push({ x: worldX(field, x), z });
    const run = (damage: DamageField, ticks: number): { mover: Mover; felled: number[] } => {
      const felled: number[] = [];
      const crush: CrushContext = {
        field: damage,
        points: rowTrees,
        onCrush: (f) => felled.push(...f),
      };
      let mover: Mover = { x: worldX(field, 2), z, hull: Math.PI / 2, leg: 0 };
      mover = orderMover(mover, [{ x: worldX(field, 37), z }]);
      for (let n = 0; n < ticks; n++) {
        mover = advanceMover("flash", mover, [], 1 / 60, 1, field, crush);
      }
      return { mover, felled };
    };
    // Full drive: arrives through the belt, felling the lane behind it.
    const damage = createDamageField(rowTrees.length, 0);
    const full = run(damage, 7200);
    expect(hasOrder(full.mover)).toBe(false);
    expect(full.mover.x).toBeGreaterThan(worldX(field, 37) - ARRIVE_RADIUS - 1);
    expect(full.felled.length).toBeGreaterThan(0);
    for (const fid of full.felled) expect(damage.trees[fid]).toBe("toppled");
    // Fresh lanes labour: over fixed ticks the first pass (crushing at
    // CRUSH_DRAG under canopy drag) covers less ground than a second pass
    // over its own fallen trunks — which still trails open ground, where
    // even the canopy proximity drag is absent.
    const fresh = createDamageField(rowTrees.length, 0);
    const first = run(fresh, 600);
    const second = run(fresh, 600);
    // `run` always starts at the same X: compare covered distance instead.
    const startX = worldX(field, 2);
    expect(first.mover.x - startX).toBeGreaterThan(0);
    expect(second.mover.x - startX).toBeGreaterThan(first.mover.x - startX);
    // And both trail the same order on open ground (same-size field, so
    // world coordinates match exactly).
    let openMover: Mover = { x: startX, z, hull: Math.PI / 2, leg: 0 };
    openMover = orderMover(openMover, [{ x: worldX(field, 37), z }]);
    const open: SeatField = {
      width: field.width,
      height: field.height,
      heights: new Uint8Array(field.width * field.height).fill(100),
      seaLevel: 0,
    };
    for (let n = 0; n < 600; n++) {
      openMover = advanceMover("flash", openMover, [], 1 / 60, 1, open);
    }
    expect(openMover.x - startX).toBeGreaterThan(second.mover.x - startX);
    // Crushing reads much slower than brushing canopy: the fresh pass crawls
    // at CRUSH_DRAG under the TREE_DRAG proximity it also pays.
    expect(CRUSH_DRAG * TREE_DRAG).toBeLessThan(TREE_DRAG);
  });

  it("routes pathfound orders around tree belts, crushing only grazes", () => {
    // Smoothing still steers legs around standing trunks when it can — but
    // the hulls no longer slide around wood they graze while cornering, so
    // a detour may fell a tree or two on its arcs where the old clamp would
    // have slid. A detour stays a detour (not a plough): far fewer falls
    // than driving the lane straight through.
    const field = woodedField();
    const z = (11 - (field.height - 1) / 2) * CELL_PIXELS;
    const from = { x: worldX(field, 2), z };
    const to = { x: worldX(field, 37), z };
    const path = findWorldPath(field, from, to);
    // A real detour, not a straight drive through the belt.
    expect(path.length).toBeGreaterThan(1);
    const points: { x: number; z: number }[] = [];
    for (let cz = 8; cz <= 15; cz++) {
      for (let cx = 5; cx < field.width - 5; cx++) {
        points.push({
          x: (cx - (field.width - 1) / 2) * CELL_PIXELS,
          z: (cz - (field.height - 1) / 2) * CELL_PIXELS,
        });
      }
    }
    const damage = createDamageField(points.length, 0);
    const felled: number[] = [];
    const crush: CrushContext = { field: damage, points, onCrush: (f) => felled.push(...f) };
    let mover: Mover = { x: from.x, z: from.z, hull: Math.PI / 2, leg: 0 };
    mover = orderMover(mover, path);
    for (let n = 0; n < 7200; n++) {
      mover = advanceMover("flash", mover, [], 1 / 60, 1, field, crush);
    }
    expect(hasOrder(mover)).toBe(false);
    // Grazes only: a straight lane plough fells the whole row (~30), the
    // detour only clips corner arcs.
    expect(felled.length).toBeLessThan(10);
  });

  it("crushes out a spawn parked on a trunk instead of grinding", () => {
    // An isolated trunk under the spawn (relaxed placement permits it):
    // the hull simply drives out, felling the trunk beneath it — no
    // push-out ease needed, since wood never pins.
    const w = 32;
    const h = 32;
    const features = new Uint16Array(w * h).fill(0xffff);
    features[16 * w + 16] = 0;
    const field: SeatField = { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
    const x = (16 - (w - 1) / 2) * CELL_PIXELS;
    const z = (16 - (h - 1) / 2) * CELL_PIXELS;
    expect(trunkBlockedAt(field, x, z, "stump")).toBe(true);
    const kinds = ["stump"] as const;
    const routes: RoutePoint[][] = [[{ x, z }, { x, z: z + 400 }]];
    const drive = (damage: DamageField, felled: number[]): Mover[] => {
      const crush: CrushContext = { field: damage, points: [{ x, z }], onCrush: (f) => felled.push(...f) };
      let movers: Mover[] = [{ x, z, hull: 0, leg: 1 }];
      for (let n = 0; n < 600; n++) {
        movers = advanceMovers([...kinds], movers, routes, 1 / 60, field, crush);
      }
      return movers;
    };
    const damage = createDamageField(1, 0);
    const felled: number[] = [];
    const movers = drive(damage, felled);
    // Felled the spawn tree on the way out and drove south down the route.
    expect(felled).toEqual([0]);
    expect(damage.trees[0]).toBe("toppled");
    expect(movers[0]!.z).toBeGreaterThan(z);
    // Deterministic: the same crush replays exactly.
    const replayDamage = createDamageField(1, 0);
    const replay = drive(replayDamage, []);
    expect(replay[0]).toEqual(movers[0]);
  });

  it("keeps patrol waypoints off standing trunks on real maps", () => {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const map = generateMap(preset, seed);
        const routes = planRoutes(map, map.units, seed);
        for (const route of routes) {
          route.forEach((wp, i) => {
            if (i === 0) return; // waypoint 0 is the spawn, exempt by design
            const { cellX, cellZ } = cellFromWorld(map, wp.x, wp.z);
            expect(map.features[cellZ * map.width + cellX]).toBeGreaterThan(2);
          });
        }
      }
    }
  });
});

describe("predictDrivenPath", () => {
  it("stays silent for holders, hold-routes, and empty orders", () => {
    const route = flatRoute();
    const held: Mover = { x: 0, z: 0, hull: 0, leg: 1, hold: true };
    expect(predictDrivenPath("flash", held, route)).toEqual([]);
    const holdRoute: RoutePoint[] = [
      { x: 5, z: 5 },
      { x: 5, z: 5 },
    ];
    expect(predictDrivenPath("flash", { x: 5, z: 5, hull: 0, leg: 1 }, holdRoute)).toEqual([]);
    expect(predictDrivenPath("flash", { x: 0, z: 0, hull: 0, leg: 0 }, [])).toEqual([]);
    const emptied = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, []);
    expect(predictDrivenPath("flash", emptied, route)).toEqual([]);
    expect(predictDrivenPath("flash", { x: 0, z: 0, hull: 0, leg: 1 }, route, null, 0)).toEqual([]);
  });

  it("runs an order from the live position to the destination", () => {
    const mover = orderMover({ x: 0, z: 0, hull: 0, leg: 0 }, [
      { x: 0, z: 200 },
      { x: 200, z: 200 },
    ]);
    const path = predictDrivenPath("flash", mover, []);
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual({ x: 0, z: 0 });
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - 200, last.z - 200)).toBeLessThanOrEqual(ARRIVE_RADIUS);
  });

  it("walks a full patrol loop, passing near every waypoint", () => {
    const route = flatRoute();
    const mover: Mover = { x: 0, z: 50, hull: 0, leg: 1 };
    const path = predictDrivenPath("stump", mover, route);
    expect(path.length).toBeGreaterThan(10);
    expect(path[0]).toEqual({ x: 0, z: 50 });
    // The driven line cuts corners but still visits each waypoint's
    // neighbourhood (arrival radius plus one sim stride of slack).
    for (const wp of route) {
      const near = path.some((p) => Math.hypot(p.x - wp.x, p.z - wp.z) < ARRIVE_RADIUS + 30);
      expect(near).toBe(true);
    }
  });

  it("curves off the waypoint chord when the hull starts crosswise", () => {
    const route = flatRoute();
    // Hull faces +X while the leg runs +Z: the grip drives it forward along
    // the hull as it turns, so the driven line must bulge off the chord.
    const mover: Mover = { x: 0, z: 0, hull: Math.PI / 2, leg: 1 };
    const path = predictDrivenPath("flash", mover, route);
    expect(path.length).toBeGreaterThan(5);
    const bulge = Math.max(...path.slice(0, 12).map((p) => Math.abs(p.x)));
    expect(bulge).toBeGreaterThan(5);
  });

  it("refuses the wall and ends the trail there instead of crossing it", () => {
    const field = walledField();
    const z = 0;
    const mover = orderMover({ x: worldX(field, 10), z, hull: Math.PI / 2, leg: 0 }, [
      { x: worldX(field, 35), z },
    ]);
    const before = JSON.parse(JSON.stringify(mover)) as Mover;
    const path = predictDrivenPath("flash", mover, [], field);
    // Never entered the wall, never arrived — the stall rule ends the trail
    // where the hull pins, well short of the destination.
    for (const p of path) expect(p.x).toBeLessThan(worldX(field, 16));
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - worldX(field, 35), last.z - z)).toBeGreaterThan(ARRIVE_RADIUS);
    // Pure: neither the mover nor the field moved.
    expect(mover).toEqual(before);
  });

  it("is deterministic for the same live state", () => {
    const route = flatRoute();
    const mover = orderMover({ x: 10, z: 20, hull: 1.2, leg: 0 }, [{ x: 300, z: 300 }]);
    expect(predictDrivenPath("hammer", mover, route)).toEqual(predictDrivenPath("hammer", mover, route));
  });
});
