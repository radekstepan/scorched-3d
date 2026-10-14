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
  ROUTE_WAYPOINTS,
  sampleGround,
  SLOW_SCALE,
  spacingScale,
  worldFromCell,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import { isWalkable } from "./pathfinding.js";
import type { SeatField } from "./terrain.js";
import { UNIT_KINDS } from "./types.js";

const PRESETS = ["greenreach", "archipelago", "highpass", "caldera"] as const;
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
            expect(Math.max(h00, h10, h01) - Math.min(h00, h10, h01)).toBeLessThanOrEqual(24);
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
  it("steps the whole column with spacing from live positions", () => {
    const kinds = ["flash", "stump", "hammer"] as const;
    const routes: RoutePoint[][] = [flatRoute(), flatRoute(600), flatRoute(900)];
    const movers: Mover[] = [
      { x: 0, z: 0, hull: 0, leg: 1 },
      // Second unit parked right ahead: both hold instead of stacking.
      { x: 0, z: 20, hull: 0, leg: 1 },
      // Third unit far from the pair: free to patrol.
      { x: 900, z: 900, hull: Math.PI, leg: 3 },
    ];
    const next = advanceMovers([...kinds], movers, routes, 0.05);
    expect(next).toHaveLength(3);
    expect(next[0]!.x).toBeCloseTo(0, 9);
    expect(next[0]!.z).toBeCloseTo(0, 9);
    expect(next[1]!.x).toBeCloseTo(0, 9);
    expect(next[1]!.z).toBeCloseTo(20, 9);
    const travelled = Math.hypot(next[2]!.x - 900, next[2]!.z - 900);
    expect(travelled).toBeGreaterThan(0);
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
