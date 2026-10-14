import { describe, expect, it } from "vitest";
import { generateMap } from "../terrain/generate.js";
import {
  advanceMover,
  ARRIVE_RADIUS,
  hasOrder,
  holdMover,
  orderMover,
  planRoutes,
  type Mover,
  type RoutePoint,
} from "./movement.js";
import {
  findCellPath,
  findWorldPath,
  formationOffsets,
  formationTargets,
  FORMATION_MIN_SEPARATION,
  hasLineOfSight,
  isWalkable,
  nearestWalkable,
  octileHeuristic,
  PATH_FORMATION_SPACING,
  pathWorldToCell,
  smoothCellPath,
  snappedFormationTargets,
  type PathGrid,
} from "./pathfinding.js";

/** Flat dry field: every cell walkable. */
function flatGrid(w = 24, h = 24, height = 100, sea = 0): PathGrid {
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(height), seaLevel: sea };
}

/** Field with a vertical water stripe at column `x0` below `gapEnd` (dry gap on top). */
function stripedGrid(w = 24, h = 24, x0 = 12, gapEnd = 3): PathGrid {
  const heights = new Uint8Array(w * h).fill(100);
  for (let z = gapEnd; z < h; z++) heights[z * w + x0] = 0;
  return { width: w, height: h, heights, seaLevel: 50 };
}

describe("isWalkable", () => {
  it("accepts dry gentle ground, rejects water and steep cells", () => {
    const grid = flatGrid();
    expect(isWalkable(grid, 5, 5)).toBe(true);
    expect(isWalkable(grid, -1, 5)).toBe(false);
    expect(isWalkable(grid, 5, 99)).toBe(false);
    const wet = stripedGrid();
    expect(isWalkable(wet, 12, 5)).toBe(false);
    expect(isWalkable(wet, 10, 5)).toBe(true);
    // Shoreline cells read as steep: the slope probe touches the water
    // neighbour (same semantics as placement in `place.ts`).
    expect(isWalkable(wet, 11, 5)).toBe(false);
  });

  it("matches patrol-route acceptance on real maps", () => {
    // Route waypoints are filtered to dry + gentle ground, so every one of
    // them must be walkable. (Raw spawn cells can be steeper: the placement
    // scoring fallback tolerates rough ground to never ship a short roster.)
    const map = generateMap("greenreach", 7);
    const routes = planRoutes(map, map.units, 7);
    for (const route of routes) {
      for (const wp of route) {
        const cx = Math.round(wp.x / 16 + (map.width - 1) / 2);
        const cz = Math.round(wp.z / 16 + (map.height - 1) / 2);
        expect(isWalkable(map, cx, cz)).toBe(true);
      }
    }
  });
});

describe("findCellPath", () => {
  it("runs straight across open ground", () => {
    const grid = flatGrid();
    const path = findCellPath(grid, { cellX: 2, cellZ: 2 }, { cellX: 8, cellZ: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ cellX: 2, cellZ: 2 });
    expect(path![path!.length - 1]).toEqual({ cellX: 8, cellZ: 2 });
    // Pure diagonal-free straight run: one cell per step.
    expect(path).toHaveLength(7);
  });

  it("reaches a diagonal goal with diagonal steps", () => {
    const grid = flatGrid();
    const path = findCellPath(grid, { cellX: 2, cellZ: 2 }, { cellX: 5, cellZ: 5 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(4);
    expect(path![path!.length - 1]).toEqual({ cellX: 5, cellZ: 5 });
  });

  it("detours around water instead of crossing it", () => {
    // Gap at the top row only: the path must climb around the stripe end.
    const grid = stripedGrid(24, 24, 12);
    const path = findCellPath(grid, { cellX: 4, cellZ: 20 }, { cellX: 20, cellZ: 20 });
    expect(path).not.toBeNull();
    for (const c of path!) {
      expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
    }
    // No straight run: the stripe forces a climb through the dry gap.
    expect(path!.length).toBeGreaterThan(17);
  });

  it("never cuts corners through blocked orthogonal cells", () => {
    // Checkerboard of water: no diagonal step is legal anywhere, so the
    // start cell (even parity island) has no legal move at all.
    const w = 9;
    const h = 9;
    const heights = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) heights[z * w + x] = (x + z) % 2 === 0 ? 100 : 0;
    }
    const grid: PathGrid = { width: w, height: h, heights, seaLevel: 50 };
    const path = findCellPath(grid, { cellX: 4, cellZ: 4 }, { cellX: 6, cellZ: 4 });
    expect(path).toBeNull();
  });

  it("returns null on a fully blocked map", () => {
    const grid: PathGrid = { width: 8, height: 8, heights: new Uint8Array(64), seaLevel: 50 };
    expect(findCellPath(grid, { cellX: 1, cellZ: 1 }, { cellX: 6, cellZ: 6 })).toBeNull();
  });

  it("is deterministic across repeated searches", () => {
    const map = generateMap("archipelago", 42);
    const a = findCellPath(map, { cellX: 30, cellZ: 30 }, { cellX: 90, cellZ: 90 });
    const b = findCellPath(map, { cellX: 30, cellZ: 30 }, { cellX: 90, cellZ: 90 });
    expect(a).toEqual(b);
  });

  it("uses an admissible octile heuristic", () => {
    expect(octileHeuristic(3, 0)).toBeCloseTo(3, 10);
    expect(octileHeuristic(3, 4)).toBeCloseTo(4 + (Math.SQRT2 - 1) * 3, 10);
    expect(octileHeuristic(0, 0)).toBe(0);
  });
});

describe("smoothing", () => {
  it("collapses an open-ground zigzag to its endpoints", () => {
    const grid = flatGrid();
    const cells = [
      { cellX: 2, cellZ: 2 },
      { cellX: 2, cellZ: 6 },
      { cellX: 6, cellZ: 6 },
      { cellX: 6, cellZ: 2 },
    ];
    expect(smoothCellPath(grid, cells)).toEqual([
      { cellX: 2, cellZ: 2 },
      { cellX: 6, cellZ: 2 },
    ]);
  });

  it("keeps the detour when water blocks the shortcut", () => {
    const grid = stripedGrid(24, 24, 12);
    // Legs around the top end of the stripe: the direct shortcut crosses water.
    const around = [
      { cellX: 4, cellZ: 10 },
      { cellX: 4, cellZ: 1 },
      { cellX: 20, cellZ: 1 },
      { cellX: 20, cellZ: 10 },
    ];
    expect(hasLineOfSight(grid, around[0]!, around[3]!)).toBe(false);
    const smoothed = smoothCellPath(grid, around);
    expect(smoothed.length).toBeGreaterThanOrEqual(3);
    expect(smoothed[0]).toEqual(around[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(around[3]);
    for (const c of smoothed) expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
  });

  it("leaves short paths alone", () => {
    const grid = flatGrid();
    expect(smoothCellPath(grid, [])).toEqual([]);
    const one = [{ cellX: 3, cellZ: 3 }];
    expect(smoothCellPath(grid, one)).toEqual(one);
  });
});

describe("nearestWalkable", () => {
  it("returns the input when already walkable, else the closest open cell", () => {
    const grid = stripedGrid();
    expect(nearestWalkable(grid, 5, 5)).toEqual({ cellX: 5, cellZ: 5 });
    // Shoreline cells read as steep, so the search steps one cell further:
    // ring scan hits smaller z first, landing on (13, 4).
    const near = nearestWalkable(grid, 12, 5);
    expect(near).toEqual({ cellX: 13, cellZ: 4 });
    expect(isWalkable(grid, near.cellX, near.cellZ)).toBe(true);
  });
});

describe("findWorldPath", () => {
  /** First walkable cell scanning inward from a corner (deterministic). */
  function scanForLand(grid: PathGrid, fromStart: boolean): { x: number; z: number } {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let x = 8; x < grid.width - 8; x++) xs.push(x);
    for (let z = 8; z < grid.height - 8; z++) zs.push(z);
    if (!fromStart) {
      xs.reverse();
      zs.reverse();
    }
    for (const z of zs) {
      for (const x of xs) {
        if (isWalkable(grid, x, z)) {
          return {
            x: (x - (grid.width - 1) / 2) * 16,
            z: (z - (grid.height - 1) / 2) * 16,
          };
        }
      }
    }
    throw new Error("no land");
  }

  it("routes across a real map with walkable waypoints only", () => {
    const map = generateMap("greenreach", 11);
    const from = scanForLand(map, true);
    const to = scanForLand(map, false);
    const a = findWorldPath(map, from, to);
    const b = findWorldPath(map, from, to);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const wp of a) {
      const cx = Math.round(wp.x / 16 + (map.width - 1) / 2);
      const cz = Math.round(wp.z / 16 + (map.height - 1) / 2);
      expect(isWalkable(map, cx, cz)).toBe(true);
    }
  });

  it("still returns a fallback goal when no route exists", () => {
    const grid: PathGrid = { width: 8, height: 8, heights: new Uint8Array(64), seaLevel: 50 };
    const path = findWorldPath(grid, { x: 0, z: 0 }, { x: 100, z: 100 });
    expect(path).toHaveLength(1);
  });
});

describe("formation", () => {
  it("fans units around the clicked point without stacking", () => {
    const center = { x: 100, z: -200 };
    const targets = formationTargets(center, 6);
    expect(targets).toHaveLength(6);
    expect(targets[0]).toEqual(center);
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const d = Math.hypot(targets[i]!.x - targets[j]!.x, targets[i]!.z - targets[j]!.z);
        expect(d).toBeGreaterThanOrEqual(PATH_FORMATION_SPACING * 0.99);
      }
    }
  });

  it("is deterministic and centered on the click", () => {
    expect(formationOffsets(6)).toEqual(formationOffsets(6));
    expect(formationOffsets(0)).toEqual([]);
    const single = formationTargets({ x: 5, z: 5 }, 1);
    expect(single).toEqual([{ x: 5, z: 5 }]);
  });

  it("snaps every slot onto walkable, separated ground on a real map", () => {
    const map = generateMap("greenreach", 7);
    // Click the first walkable cell scanning inward: open ground, so the
    // separation guarantee must hold without rescue fallbacks.
    let center = { x: 0, z: 0 };
    outer: for (let z = 8; z < map.height - 8; z++) {
      for (let x = 8; x < map.width - 8; x++) {
        if (isWalkable(map, x, z)) {
          center = { x: (x - (map.width - 1) / 2) * 16, z: (z - (map.height - 1) / 2) * 16 };
          break outer;
        }
      }
    }
    const goals = snappedFormationTargets(map, center, 6);
    expect(goals).toHaveLength(6);
    expect(snappedFormationTargets(map, center, 6)).toEqual(goals);
    expect(snappedFormationTargets(map, center, 0)).toEqual([]);
    for (const g of goals) {
      const cell = pathWorldToCell(map, g.x, g.z);
      expect(isWalkable(map, cell.cellX, cell.cellZ)).toBe(true);
    }
    for (let i = 0; i < goals.length; i++) {
      for (let j = i + 1; j < goals.length; j++) {
        const d = Math.hypot(goals[i]!.x - goals[j]!.x, goals[i]!.z - goals[j]!.z);
        expect(d).toBeGreaterThanOrEqual(FORMATION_MIN_SEPARATION);
      }
    }
  });

  it("seats shoreline water-click goals onto separated land", () => {
    // Synthetic shore: land x<12, water x>=12. The click sits over water but
    // every slot has land inside snap radius, so each goal must seat onto
    // walkable ground (one cell inland — shoreline cells read steep, the
    // same parity placement relies on) with full separation, spreading the
    // fan along the shore instead of stacking it on one snap cell.
    const w = 32;
    const h = 32;
    const heights = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) heights[z * w + x] = x < 12 ? 100 : 0;
    }
    const grid: PathGrid = { width: w, height: h, heights, seaLevel: 50 };
    const center = { x: (16 - (w - 1) / 2) * 16, z: (16 - (h - 1) / 2) * 16 };
    expect(isWalkable(grid, 16, 16)).toBe(false);
    const goals = snappedFormationTargets(grid, center, 4);
    expect(goals).toHaveLength(4);
    expect(snappedFormationTargets(grid, center, 4)).toEqual(goals);
    for (const g of goals) {
      const cell = pathWorldToCell(grid, g.x, g.z);
      expect(isWalkable(grid, cell.cellX, cell.cellZ)).toBe(true);
    }
    for (let i = 0; i < goals.length; i++) {
      for (let j = i + 1; j < goals.length; j++) {
        const d = Math.hypot(goals[i]!.x - goals[j]!.x, goals[i]!.z - goals[j]!.z);
        expect(d).toBeGreaterThanOrEqual(FORMATION_MIN_SEPARATION);
      }
    }
  });

  it("re-seats slots that would snap onto one shared cell", () => {
    // One walkable cell in a water grid: every geometric slot snaps to it,
    // so the rescue scan must spread the goals apart.
    const grid: PathGrid = { width: 32, height: 32, heights: new Uint8Array(32 * 32), seaLevel: 50 };
    grid.heights[16 * 32 + 16] = 100;
    grid.heights[16 * 32 + 17] = 100;
    grid.heights[17 * 32 + 16] = 100;
    grid.heights[17 * 32 + 17] = 100;
    const center = { x: (16 - 15.5) * 16, z: (16 - 15.5) * 16 };
    const goals = snappedFormationTargets(grid, center, 3, 8);
    expect(goals).toHaveLength(3);
    // Tiny island: separation may be impossible — but every goal must still
    // be the shared walkable snap (documented fallback), deterministically.
    expect(snappedFormationTargets(grid, center, 3, 8)).toEqual(goals);
    for (const g of goals) {
      const cell = pathWorldToCell(grid, g.x, g.z);
      expect(isWalkable(grid, cell.cellX, cell.cellZ)).toBe(true);
    }
  });
});

describe("move orders in advanceMover", () => {
  const route: RoutePoint[] = [
    { x: 0, z: 0 },
    { x: 0, z: 400 },
  ];

  it("leaves patrol and drives the ordered waypoints", () => {
    let mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    mover = orderMover(mover, [{ x: 400, z: 0 }]);
    expect(hasOrder(mover)).toBe(true);
    const before = { ...mover };
    const next = advanceMover("flash", mover, route, 0.5);
    // Patrol leg 1 points +Z; the order points +X: the unit turns east.
    expect(next.x).toBeGreaterThan(before.x);
    expect(next.leg).toBe(before.leg);
  });

  it("advances the cursor on waypoint arrival and holds at the end", () => {
    let mover: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    mover = orderMover(mover, [
      { x: ARRIVE_RADIUS / 2, z: 0 },
      { x: 400, z: 0 },
    ]);
    mover = advanceMover("flash", mover, route, 0.05);
    expect(mover.order?.at).toBe(1);
    expect(hasOrder(mover)).toBe(true);
    // Park at the final waypoint: arrival clears the order into a hold.
    mover = { ...mover, x: 400, z: 0 };
    mover = advanceMover("flash", mover, route, 0.05);
    expect(hasOrder(mover)).toBe(false);
    expect(mover.hold).toBe(true);
    const parked = { ...mover };
    mover = advanceMover("flash", mover, route, 1);
    expect(mover.x).toBeCloseTo(parked.x, 9);
    expect(mover.z).toBeCloseTo(parked.z, 9);
  });

  it("holds patrol while held and resumes only on a new order", () => {
    let mover: Mover = holdMover({ x: 0, z: 0, hull: 0, leg: 1 });
    const held = advanceMover("flash", mover, route, 1);
    expect(held.x).toBe(0);
    expect(held.z).toBe(0);
    mover = orderMover(held, [{ x: 0, z: 200 }]);
    const next = advanceMover("flash", mover, route, 0.5);
    expect(next.z).toBeGreaterThan(0);
    expect(next.hold).not.toBe(true);
  });

  it("treats an empty order as a hold, keeping old movers patrolling", () => {
    const plain: Mover = { x: 0, z: 0, hull: 0, leg: 1 };
    expect(hasOrder(plain)).toBe(false);
    const held = orderMover(plain, []);
    expect(hasOrder(held)).toBe(false);
    expect(advanceMover("flash", held, route, 1)).toEqual({ ...held });
    // Movers without orders or holds patrol exactly as before.
    const next = advanceMover("flash", plain, route, 0.5);
    expect(next.z).toBeGreaterThan(0);
  });
});

/** Field with a steep (not wet) ridge at column `x0` below `gapEnd`. */
function ridgedGrid(w = 24, h = 24, x0 = 12, gapEnd = 3): PathGrid {
  const heights = new Uint8Array(w * h).fill(100);
  for (let z = gapEnd; z < h; z++) heights[z * w + x0] = 200;
  return { width: w, height: h, heights, seaLevel: 50 };
}

describe("steep slopes", () => {
  it("treats steep cells as unwalkable, like water", () => {
    const grid = ridgedGrid();
    // The ridge column reads steep through the slope probe; its dry
    // neighbours read steep too where they touch it (same shoreline parity
    // as water in `place.ts`).
    expect(isWalkable(grid, 12, 10)).toBe(false);
    expect(isWalkable(grid, 11, 10)).toBe(false);
    expect(isWalkable(grid, 10, 10)).toBe(true);
    // The dry gap above the ridge stays passable.
    expect(isWalkable(grid, 12, 1)).toBe(true);
  });

  it("detours around a steep ridge instead of climbing it", () => {
    // Gap at the top only: the path must climb around the ridge end, the
    // same shape as the water detour but gated on slope, not depth.
    const grid = ridgedGrid(24, 24, 12);
    const path = findCellPath(grid, { cellX: 4, cellZ: 20 }, { cellX: 20, cellZ: 20 });
    expect(path).not.toBeNull();
    for (const c of path!) {
      expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
    }
    expect(path!.length).toBeGreaterThan(17);
  });

  it("keeps the steep detour through smoothing", () => {
    const grid = ridgedGrid(24, 24, 12);
    const around = [
      { cellX: 4, cellZ: 10 },
      { cellX: 4, cellZ: 1 },
      { cellX: 20, cellZ: 1 },
      { cellX: 20, cellZ: 10 },
    ];
    expect(hasLineOfSight(grid, around[0]!, around[3]!)).toBe(false);
    const smoothed = smoothCellPath(grid, around);
    expect(smoothed.length).toBeGreaterThanOrEqual(3);
    for (const c of smoothed) expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
  });

  it("keeps smoothed legs off steep ground on real maps", () => {
    // Real-map case: string-pulling must not cut back through steep cells
    // the search paid to go around — so sample every smoothed leg densely,
    // not just its waypoints.
    for (const preset of ["greenreach", "archipelago", "highpass", "caldera"] as const) {
      const map = generateMap(preset, 11);
      const walkables: { x: number; z: number }[] = [];
      for (let z = 8; z < map.height - 8 && walkables.length < 2; z += 3) {
        for (let x = 8; x < map.width - 8 && walkables.length < 2; x += 3) {
          if (!isWalkable(map, x, z)) continue;
          const first = walkables[0];
          if (first && Math.hypot(x - first.x, z - first.z) < 60) continue;
          walkables.push({ x, z });
        }
      }
      expect(walkables).toHaveLength(2);
      const toWorld = (c: { x: number; z: number }): { x: number; z: number } => ({
        x: (c.x - (map.width - 1) / 2) * 16,
        z: (c.z - (map.height - 1) / 2) * 16,
      });
      const path = findWorldPath(map, toWorld(walkables[0]!), toWorld(walkables[1]!));
      expect(path.length).toBeGreaterThan(0);
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const dist = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(dist / 8));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = Math.round((a.x + (b.x - a.x) * t) / 16 + (map.width - 1) / 2);
          const cz = Math.round((a.z + (b.z - a.z) * t) / 16 + (map.height - 1) / 2);
          expect(isWalkable(map, cx, cz)).toBe(true);
        }
      }
    }
  });
});
